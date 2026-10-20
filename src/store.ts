import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { mimeFor } from "./mime.js";

export interface SiteFile {
  size: number;
  mime: string;
}

export interface SiteMeta {
  id: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  tokenHash: string;
  /** Set when the site was uploaded with a team key. Guest uploads have none. */
  teamId?: string;
  /** <title> of index.html, if any (shown in the public directory). */
  title?: string;
  fileCount: number;
  totalBytes: number;
  files: Record<string, SiteFile>;
}

/** Public view of a site (never includes the token hash). */
export function publicMeta(m: SiteMeta) {
  const { tokenHash: _omit, ...rest } = m;
  return rest;
}

const ID_RE = /^[a-z0-9]{6,32}$/;

/**
 * Filesystem-backed site store:
 *   <dataDir>/sites/<id>/meta.json
 *   <dataDir>/sites/<id>/files/<path>
 * Writes are staged in <dataDir>/tmp and swapped in with rename().
 */
export class SiteStore {
  private readonly sitesDir: string;
  private readonly tmpDir: string;

  constructor(dataDir: string) {
    const root = resolve(dataDir);
    this.sitesDir = join(root, "sites");
    this.tmpDir = join(root, "tmp");
  }

  async init(): Promise<void> {
    await mkdir(this.sitesDir, { recursive: true });
    await rm(this.tmpDir, { recursive: true, force: true });
    await mkdir(this.tmpDir, { recursive: true });
  }

  private siteDir(id: string): string {
    if (!ID_RE.test(id)) throw new Error("invalid site id");
    return join(this.sitesDir, id);
  }

  async exists(id: string): Promise<boolean> {
    return (await this.get(id)) !== null;
  }

  async get(id: string): Promise<SiteMeta | null> {
    if (!ID_RE.test(id)) return null;
    try {
      return JSON.parse(await readFile(join(this.siteDir(id), "meta.json"), "utf8")) as SiteMeta;
    } catch {
      return null;
    }
  }

  async list(): Promise<SiteMeta[]> {
    let ids: string[] = [];
    try {
      ids = await readdir(this.sitesDir);
    } catch {
      return [];
    }
    const metas = await Promise.all(ids.map((id) => this.get(id)));
    return metas.filter((m): m is SiteMeta => m !== null);
  }

  private async writeMeta(dir: string, meta: SiteMeta): Promise<void> {
    const tmp = join(this.tmpDir, `meta-${randomBytes(6).toString("hex")}.json`);
    await writeFile(tmp, JSON.stringify(meta, null, 2));
    await rename(tmp, join(dir, "meta.json"));
  }

  /** Create a new site or atomically replace an existing site's files. */
  async put(
    meta: Omit<SiteMeta, "files" | "fileCount" | "totalBytes">,
    files: Map<string, Uint8Array>,
  ): Promise<SiteMeta> {
    const dir = this.siteDir(meta.id);
    const stage = join(this.tmpDir, `${meta.id}-${randomBytes(6).toString("hex")}`);
    const index: Record<string, SiteFile> = {};
    let total = 0;
    for (const [path, bytes] of files) {
      const target = resolve(stage, path);
      if (!target.startsWith(stage + sep)) throw new Error(`unsafe path: ${path}`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
      index[path] = { size: bytes.byteLength, mime: mimeFor(path) };
      total += bytes.byteLength;
    }
    const full: SiteMeta = { ...meta, files: index, fileCount: files.size, totalBytes: total };

    await mkdir(dir, { recursive: true });
    const filesDir = join(dir, "files");
    const old = join(this.tmpDir, `old-${meta.id}-${randomBytes(6).toString("hex")}`);
    await rename(filesDir, old).catch(() => undefined);
    await rename(stage, filesDir);
    await this.writeMeta(dir, full);
    await rm(old, { recursive: true, force: true });
    return full;
  }

  async updateMeta(meta: SiteMeta): Promise<void> {
    await this.writeMeta(this.siteDir(meta.id), meta);
  }

  /** Absolute path of a stored file, or null if it isn't part of the site. */
  filePath(meta: SiteMeta, path: string): string | null {
    if (!Object.hasOwn(meta.files, path)) return null;
    const base = join(this.siteDir(meta.id), "files");
    const target = resolve(base, path);
    return target.startsWith(base + sep) ? target : null;
  }

  async delete(id: string): Promise<void> {
    await rm(this.siteDir(id), { recursive: true, force: true });
  }

  /** Delete every expired site; returns the ids removed. */
  async sweepExpired(now = Date.now()): Promise<string[]> {
    const removed: string[] = [];
    for (const m of await this.list()) {
      if (Date.parse(m.expiresAt) <= now) {
        await this.delete(m.id);
        removed.push(m.id);
      }
    }
    return removed;
  }
}
