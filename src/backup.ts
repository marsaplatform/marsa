import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

/**
 * Encrypted platform backups (0.16.0).
 *
 * Once a day the whole data directory (teams, members, sites, Workers records
 * and versions, keys, audit log, notes, health history, trash exports) is packed
 * into one archive, gzipped and sealed with AES-256-GCM, then stored off the
 * server in R2 under `_marsa-backups/`. Retention keeps the newest backup of each
 * of the last 14 days and of each of the last 8 ISO weeks. Every run is verified by
 * reading the object back, decrypting it and checking every file's SHA-256.
 *
 * File format (`.msb`): "MSB1" | iv(12) | tag(16) | AES-256-GCM(gzip(archive)).
 * Archive: "MSBA1\n" | u32 manifestLength | manifest JSON | file bytes, in order.
 * The key is HKDF-SHA256(BACKUP_KEY, or MARSA_SECRETS_KEY, "marsa-backup-v1").
 */

export const BACKUP_PREFIX = "_marsa-backups/";
const MAGIC = Buffer.from("MSB1");
const ARCHIVE_MAGIC = Buffer.from("MSBA1\n");
/** Never in a backup: temp files, and local backups themselves. */
const SKIP_DIRS = new Set(["tmp", "backups"]);

export interface BlobStore {
  readonly kind: "r2" | "dir";
  /** Shown to the admin: "R2 bucket marsa-spaces-files" / "directory /backups". */
  readonly where: string;
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  list(prefix: string): Promise<{ key: string; size: number; lastModified: string }[]>;
  delete(key: string): Promise<void>;
}

/** Local-directory store: for self-hosters without R2, and for tests. Not off-site. */
export class DirBlobStore implements BlobStore {
  readonly kind = "dir" as const;
  readonly where: string;
  constructor(private readonly root: string) {
    this.where = `directory ${resolve(root)}`;
  }
  private path(key: string) {
    const p = resolve(this.root, key);
    if (!p.startsWith(resolve(this.root) + sep)) throw new Error("bad key");
    return p;
  }
  async put(key: string, bytes: Uint8Array) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(`${p}.tmp`, bytes, { mode: 0o600 });
    await rename(`${p}.tmp`, p);
  }
  async get(key: string) {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch {
      return null;
    }
  }
  async list(prefix: string) {
    const out: { key: string; size: number; lastModified: string }[] = [];
    const walk = async (dir: string) => {
      let names: string[] = [];
      try {
        names = await readdir(dir);
      } catch {
        return;
      }
      for (const n of names) {
        const full = join(dir, n);
        const st = await stat(full);
        if (st.isDirectory()) await walk(full);
        else if (!n.endsWith(".tmp")) {
          const key = relative(this.root, full).split(sep).join("/");
          if (key.startsWith(prefix))
            out.push({ key, size: st.size, lastModified: st.mtime.toISOString() });
        }
      }
    };
    await walk(resolve(this.root));
    return out;
  }
  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
}

/** The R2 bucket of the data/files backend, as a BlobStore. */
export function r2BlobStore(
  r2: {
    blobPut(k: string, b: Uint8Array): Promise<void>;
    blobGet(k: string): Promise<Uint8Array | null>;
    blobList(p: string): Promise<{ key: string; size: number; lastModified: string }[]>;
    blobDelete(k: string): Promise<void>;
  },
  bucket: string,
): BlobStore {
  return {
    kind: "r2",
    where: `R2 bucket ${bucket}`,
    put: (k, b) => r2.blobPut(k, b),
    get: (k) => r2.blobGet(k),
    list: (p) => r2.blobList(p),
    delete: (k) => r2.blobDelete(k),
  };
}

export const backupKey = (secret: string): Buffer =>
  Buffer.from(hkdfSync("sha256", secret, "marsa-backup", "marsa-backup-v1", 32));

interface ManifestFile {
  p: string;
  size: number;
  sha256: string;
  mode: number;
}
export interface Manifest {
  format: "marsa-backup";
  version: 1;
  app: string;
  createdAt: string;
  files: ManifestFile[];
  bytes: number;
}

/** Every file under dir (skipping tmp/ and backups/), sorted. */
async function collect(root: string): Promise<{ rel: string; full: string; mode: number }[]> {
  const out: { rel: string; full: string; mode: number }[] = [];
  const walk = async (dir: string) => {
    for (const n of (await readdir(dir)).sort()) {
      const full = join(dir, n);
      const st = await stat(full).catch(() => null);
      if (!st) continue; // removed while we walked
      const rel = relative(root, full).split(sep).join("/");
      if (st.isDirectory()) {
        if (dir === root && SKIP_DIRS.has(n)) continue;
        await walk(full);
      } else if (st.isFile() && !n.endsWith(".tmp")) {
        out.push({ rel, full, mode: st.mode & 0o777 });
      }
    }
  };
  await walk(root);
  return out;
}

/** Pack a directory into the plain archive. */
export async function packDir(
  root: string,
  app: string,
  now: number,
  maxBytes = Number.POSITIVE_INFINITY,
): Promise<{ archive: Buffer; manifest: Manifest }> {
  const files: ManifestFile[] = [];
  const parts: Buffer[] = [];
  let total = 0;
  for (const f of await collect(resolve(root))) {
    const data = await readFile(f.full).catch(() => null);
    if (!data) continue;
    total += data.length;
    if (total > maxBytes)
      throw new Error(
        `data directory is larger than BACKUP_MAX_MB (${Math.round(maxBytes / 1048576)} MB)`,
      );
    files.push({
      p: f.rel,
      size: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
      mode: f.mode,
    });
    parts.push(data);
  }
  const manifest: Manifest = {
    format: "marsa-backup",
    version: 1,
    app,
    createdAt: new Date(now).toISOString(),
    files,
    bytes: total,
  };
  const mj = Buffer.from(JSON.stringify(manifest), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(mj.length);
  return { archive: Buffer.concat([ARCHIVE_MAGIC, len, mj, ...parts]), manifest };
}

export function seal(archive: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(gzipSync(archive, { level: 6 })), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), data]);
}

export function unseal(blob: Uint8Array, key: Buffer): Buffer {
  const b = Buffer.from(blob);
  if (b.length < 32 || !b.subarray(0, 4).equals(MAGIC)) throw new Error("not a Marsa backup");
  const d = createDecipheriv("aes-256-gcm", key, b.subarray(4, 16));
  d.setAuthTag(b.subarray(16, 32));
  let plain: Buffer;
  try {
    plain = Buffer.concat([d.update(b.subarray(32)), d.final()]);
  } catch {
    throw new Error("cannot decrypt: wrong key (BACKUP_KEY / MARSA_SECRETS_KEY) or damaged file");
  }
  return gunzipSync(plain);
}

/** Read the archive; check every file's hash. */
export function readArchive(archive: Buffer): { manifest: Manifest; file: (i: number) => Buffer } {
  if (!archive.subarray(0, ARCHIVE_MAGIC.length).equals(ARCHIVE_MAGIC))
    throw new Error("not a Marsa backup archive");
  const ml = archive.readUInt32BE(ARCHIVE_MAGIC.length);
  const start = ARCHIVE_MAGIC.length + 4;
  const manifest = JSON.parse(archive.subarray(start, start + ml).toString("utf8")) as Manifest;
  const offsets: number[] = [];
  let off = start + ml;
  for (const f of manifest.files) {
    offsets.push(off);
    off += f.size;
  }
  if (off !== archive.length) throw new Error("archive is truncated or has extra bytes");
  return {
    manifest,
    file: (i) => {
      const f = manifest.files[i] as ManifestFile;
      const data = archive.subarray(offsets[i] as number, (offsets[i] as number) + f.size);
      if (createHash("sha256").update(data).digest("hex") !== f.sha256)
        throw new Error(`checksum mismatch: ${f.p}`);
      return data;
    },
  };
}

/** Check a sealed backup end to end without writing anything. */
export function verifyBlob(blob: Uint8Array, key: Buffer): Manifest {
  const { manifest, file } = readArchive(unseal(blob, key));
  for (let i = 0; i < manifest.files.length; i++) file(i);
  return manifest;
}

/** Restore a sealed backup into an EMPTY directory (never over live data). */
export async function restoreTo(blob: Uint8Array, key: Buffer, target: string): Promise<Manifest> {
  const dir = resolve(target);
  const existing = await readdir(dir).catch(() => [] as string[]);
  if (existing.length) throw new Error(`${dir} is not empty: restore into a new, empty directory`);
  const { manifest, file } = readArchive(unseal(blob, key));
  for (let i = 0; i < manifest.files.length; i++) {
    const f = manifest.files[i] as ManifestFile;
    const out = resolve(dir, f.p);
    if (!out.startsWith(dir + sep)) throw new Error(`unsafe path in backup: ${f.p}`);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, file(i), { mode: f.mode & 0o700 ? f.mode : 0o600 });
  }
  return manifest;
}

// ---- retention ------------------------------------------------------------------------
const isoWeek = (d: Date): string => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
};

/** Keys to keep: newest per day for `daily` days, newest per ISO week for `weekly` weeks. */
export function retain(
  keys: { key: string; at: number }[],
  daily: number,
  weekly: number,
): Set<string> {
  const sorted = [...keys].sort((a, b) => b.at - a.at);
  const keep = new Set<string>();
  const days = new Set<string>();
  const weeks = new Set<string>();
  for (const k of sorted) {
    const d = new Date(k.at);
    const day = d.toISOString().slice(0, 10);
    if (!days.has(day) && days.size < daily) {
      days.add(day);
      keep.add(k.key);
    }
    const wk = isoWeek(d);
    if (!weeks.has(wk) && weeks.size < weekly) {
      weeks.add(wk);
      keep.add(k.key);
    }
  }
  return keep;
}

const keyTime = (key: string): number => {
  const m = key.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.msb$/);
  if (!m?.[1]) return Number.NaN;
  const iso = m[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, "T$1:$2:$3.$4Z");
  return Date.parse(iso);
};

// ---- service ----------------------------------------------------------------------------
export interface BackupRun {
  at: string;
  ok: boolean;
  key?: string;
  /** Sealed size in bytes. */
  bytes?: number;
  /** Size of the data before compression. */
  dataBytes?: number;
  files?: number;
  ms?: number;
  verified?: boolean;
  deleted?: number;
  trigger: "schedule" | "manual";
  error?: string;
}

export interface BackupStatus {
  enabled: boolean;
  where: string | null;
  offsite: boolean;
  /** Why backups are off (no key / no store). */
  reason: string | null;
  last: BackupRun | null;
  lastOk: BackupRun | null;
  history: BackupRun[];
  kept: { key: string; at: string; bytes: number }[];
  schedule: { hourUtc: number; keepDaily: number; keepWeekly: number };
  nextDue: string | null;
  restoreTest: { at: string; ok: boolean; files?: number; error?: string } | null;
}

export interface BackupOptions {
  dataDir: string;
  store: BlobStore | null;
  secret: string;
  app: string;
  hourUtc: number;
  keepDaily: number;
  keepWeekly: number;
  maxBytes: number;
  now?: () => number;
  /** Told about failures (the bell + webhook). */
  onFail?: (run: BackupRun) => void;
}

export class BackupService {
  private readonly statusFile: string;
  private state: {
    history: BackupRun[];
    restoreTest: BackupStatus["restoreTest"];
    kept: BackupStatus["kept"];
  } = {
    history: [],
    restoreTest: null,
    kept: [],
  };
  private running: Promise<BackupRun> | null = null;
  private loaded: Promise<void> | null = null;
  private readonly key: Buffer | null;
  private readonly now: () => number;

  constructor(private readonly o: BackupOptions) {
    this.statusFile = join(resolve(o.dataDir), "backup-status.json");
    this.key = o.secret && o.secret.length >= 32 ? backupKey(o.secret) : null;
    this.now = o.now ?? Date.now;
  }

  get enabled(): boolean {
    return !!this.key && !!this.o.store;
  }

  private async load() {
    this.loaded ??= (async () => {
      try {
        this.state = { ...this.state, ...JSON.parse(await readFile(this.statusFile, "utf8")) };
      } catch {
        // first run
      }
    })();
    return this.loaded;
  }

  private async save() {
    await mkdir(dirname(this.statusFile), { recursive: true });
    const tmp = `${this.statusFile}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(this.state, null, 1), { mode: 0o600 });
    await rename(tmp, this.statusFile);
  }

  async status(): Promise<BackupStatus> {
    await this.load();
    const last = this.state.history[0] ?? null;
    const lastOk = this.state.history.find((r) => r.ok) ?? null;
    return {
      enabled: this.enabled,
      where: this.o.store?.where ?? null,
      offsite: this.o.store?.kind === "r2",
      reason: !this.key
        ? "set BACKUP_KEY or MARSA_SECRETS_KEY (32+ characters)"
        : !this.o.store
          ? "no backup store: configure the R2 backend or BACKUP_DIR"
          : null,
      last,
      lastOk,
      history: this.state.history.slice(0, 20),
      kept: this.state.kept,
      schedule: {
        hourUtc: this.o.hourUtc,
        keepDaily: this.o.keepDaily,
        keepWeekly: this.o.keepWeekly,
      },
      nextDue: this.enabled ? new Date(this.dueAt(lastOk)).toISOString() : null,
      restoreTest: this.state.restoreTest,
    };
  }

  /** Next scheduled run: today's (or tomorrow's) hourUtc after the last good backup. */
  private dueAt(lastOk: BackupRun | null): number {
    const t = this.now();
    if (!lastOk) return t;
    const last = Date.parse(lastOk.at);
    const d = new Date(last);
    let due = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), this.o.hourUtc);
    if (due <= last) due += 86_400_000;
    // Never more than 26 hours without a backup, whatever the hour.
    return Math.min(due, last + 26 * 3_600_000);
  }

  /** Called every few minutes: runs when a backup is due. */
  async maybeRun(): Promise<BackupRun | null> {
    if (!this.enabled) return null;
    await this.load();
    const lastOk = this.state.history.find((r) => r.ok) ?? null;
    const last = this.state.history[0];
    // After a failure, retry at most once an hour.
    if (last && !last.ok && this.now() - Date.parse(last.at) < 3_600_000) return null;
    if (this.now() < this.dueAt(lastOk)) return null;
    return this.run("schedule");
  }

  run(trigger: BackupRun["trigger"]): Promise<BackupRun> {
    this.running ??= this.doRun(trigger).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async doRun(trigger: BackupRun["trigger"]): Promise<BackupRun> {
    await this.load();
    const t0 = this.now();
    const run: BackupRun = { at: new Date(t0).toISOString(), ok: false, trigger };
    try {
      if (!this.key || !this.o.store) throw new Error("backups are not configured");
      const { archive, manifest } = await packDir(this.o.dataDir, this.o.app, t0, this.o.maxBytes);
      const sealed = seal(archive, this.key);
      const stamp = run.at.replace(/[:.]/g, "-");
      const key = `${BACKUP_PREFIX}${run.at.slice(0, 7)}/marsa-${stamp}.msb`;
      await this.o.store.put(key, sealed);
      // Verify: read it back, decrypt, check every hash.
      const back = await this.o.store.get(key);
      if (!back) throw new Error("uploaded backup could not be read back");
      const m = verifyBlob(back, this.key);
      if (m.files.length !== manifest.files.length)
        throw new Error("verification: file count differs");
      Object.assign(run, {
        ok: true,
        key,
        bytes: sealed.length,
        dataBytes: manifest.bytes,
        files: manifest.files.length,
        verified: true,
      });
      run.deleted = await this.prune();
    } catch (e) {
      run.error = (e as Error).message.slice(0, 300);
    }
    run.ms = this.now() - t0;
    this.state.history = [run, ...this.state.history].slice(0, 60);
    await this.save().catch((e) => console.error("[backup] status write failed", e?.message));
    if (run.ok)
      console.log(`[backup] ${run.key} ${run.files} files, ${run.bytes} bytes, ${run.ms} ms`);
    else {
      console.error(`[backup] failed: ${run.error}`);
      this.o.onFail?.(run);
    }
    return run;
  }

  private async prune(): Promise<number> {
    if (!this.o.store) return 0;
    const all = (await this.o.store.list(BACKUP_PREFIX))
      .map((o) => ({ ...o, at: keyTime(o.key) }))
      .filter((o) => Number.isFinite(o.at));
    const keep = retain(all, this.o.keepDaily, this.o.keepWeekly);
    let n = 0;
    for (const o of all) {
      if (keep.has(o.key)) continue;
      await this.o.store.delete(o.key);
      n++;
    }
    this.state.kept = all
      .filter((o) => keep.has(o.key))
      .sort((a, b) => b.at - a.at)
      .map((o) => ({ key: o.key, at: new Date(o.at).toISOString(), bytes: o.size }));
    return n;
  }

  /** Restore the newest backup into a scratch directory, compare, delete it (the admin's "Test restore"). */
  async testRestore(): Promise<NonNullable<BackupStatus["restoreTest"]>> {
    await this.load();
    const at = new Date(this.now()).toISOString();
    let res: NonNullable<BackupStatus["restoreTest"]>;
    const scratch = join(
      resolve(this.o.dataDir),
      "tmp",
      `restore-test-${randomBytes(4).toString("hex")}`,
    );
    try {
      if (!this.key || !this.o.store) throw new Error("backups are not configured");
      const latest = this.state.history.find((r) => r.ok && r.key);
      if (!latest?.key) throw new Error("no backup yet");
      const blob = await this.o.store.get(latest.key);
      if (!blob) throw new Error(`backup ${latest.key} is missing from the store`);
      await mkdir(scratch, { recursive: true });
      const m = await restoreTo(blob, this.key, scratch);
      const restored = await collect(scratch);
      if (restored.length !== m.files.length) throw new Error("restored file count differs");
      res = { at, ok: true, files: m.files.length };
    } catch (e) {
      res = { at, ok: false, error: (e as Error).message.slice(0, 300) };
    } finally {
      await rm(scratch, { recursive: true, force: true }).catch(() => {});
    }
    this.state.restoreTest = res;
    await this.save().catch(() => {});
    return res;
  }

  /** For the CLI. */
  get keyBytes(): Buffer | null {
    return this.key;
  }
  get blobStore(): BlobStore | null {
    return this.o.store;
  }
}
