import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Stored versions of team Workers (0.14.0): every successful deploy keeps the code,
 * the plain vars and the NAMES of the secrets (never their values), with who, when,
 * size, SHA-256 and an optional note. The newest VERSIONS_KEEP per Worker are kept in
 * <dataDir>/worker-versions/<workerId>.json (mode 600).
 */
export const VERSIONS_KEEP = 10;
export const NOTE_MAX = 200;

export type VersionAction = "deploy" | "redeploy" | "rollback";

export interface WorkerVersion {
  n: number;
  at: string;
  by: string;
  action: VersionAction;
  /** For a rollback: the version it restored. */
  from?: number;
  note: string;
  bytes: number;
  sha256: string;
  vars: Record<string, string>;
  secretNames: string[];
  code: string;
}

export type VersionMeta = Omit<WorkerVersion, "code" | "vars"> & { varNames: string[] };

export const versionMeta = (v: WorkerVersion): VersionMeta => {
  const { code: _c, vars, ...rest } = v;
  return { ...rest, varNames: Object.keys(vars).sort() };
};

interface VersionFile {
  version: 1;
  next: number;
  versions: WorkerVersion[];
}

export function cleanNote(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return (
    raw
      // biome-ignore lint/suspicious/noControlCharactersInRegex: strip control characters
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, NOTE_MAX)
  );
}

export const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

export class WorkerVersionStore {
  private readonly dir: string;
  private readonly tmpDir: string;
  private q: Promise<unknown> = Promise.resolve();

  constructor(dataDir: string) {
    const root = resolve(dataDir);
    this.dir = join(root, "worker-versions");
    this.tmpDir = join(root, "tmp");
  }

  private file(workerId: string) {
    if (!/^w_[a-f0-9]{6,32}$/.test(workerId)) throw new Error("bad worker id");
    return join(this.dir, `${workerId}.json`);
  }

  private async read(workerId: string): Promise<VersionFile> {
    try {
      const f = JSON.parse(await readFile(this.file(workerId), "utf8")) as VersionFile;
      return { version: 1, next: f.next || 1, versions: f.versions ?? [] };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT")
        return { version: 1, next: 1, versions: [] };
      throw err;
    }
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.q.then(fn, fn);
    this.q = run.catch(() => undefined);
    return run;
  }

  /** Newest first. */
  async list(workerId: string): Promise<WorkerVersion[]> {
    return (await this.read(workerId)).versions.slice().sort((a, b) => b.n - a.n);
  }

  async get(workerId: string, n: number): Promise<WorkerVersion | null> {
    return (await this.read(workerId)).versions.find((v) => v.n === n) ?? null;
  }

  async latest(workerId: string): Promise<WorkerVersion | null> {
    return (await this.list(workerId))[0] ?? null;
  }

  add(workerId: string, v: Omit<WorkerVersion, "n">): Promise<WorkerVersion> {
    return this.serial(async () => {
      const f = await this.read(workerId);
      const entry: WorkerVersion = { n: f.next, ...v };
      f.next += 1;
      f.versions.push(entry);
      f.versions.sort((a, b) => a.n - b.n);
      if (f.versions.length > VERSIONS_KEEP)
        f.versions.splice(0, f.versions.length - VERSIONS_KEEP);
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      await mkdir(this.tmpDir, { recursive: true });
      const tmp = join(this.tmpDir, `v-${randomBytes(6).toString("hex")}.json`);
      await writeFile(tmp, JSON.stringify(f), { mode: 0o600 });
      await rename(tmp, this.file(workerId));
      return entry;
    });
  }

  remove(workerId: string): Promise<void> {
    return this.serial(() => rm(this.file(workerId), { force: true }));
  }
}
