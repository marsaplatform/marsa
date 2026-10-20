import type { BackendFile, SiteBackend } from "../src/backend/types.js";

/** In-memory SiteBackend for tests (stands in for Appwrite). */
export class MemoryBackend implements SiteBackend {
  readonly kind = "memory";
  kv = new Map<string, Map<string, string>>();
  files = new Map<string, { site: string; file: BackendFile; bytes: Uint8Array }>();
  purged: string[] = [];
  private n = 0;

  private site(id: string) {
    let m = this.kv.get(id);
    if (!m) {
      m = new Map();
      this.kv.set(id, m);
    }
    return m;
  }
  async kvList(siteId: string, limit: number) {
    return [...this.site(siteId).keys()].sort().slice(0, limit);
  }
  async kvCount(siteId: string) {
    return this.site(siteId).size;
  }
  async kvGet(siteId: string, key: string) {
    return this.site(siteId).get(key);
  }
  async kvSet(siteId: string, key: string, json: string) {
    this.site(siteId).set(key, json);
  }
  async kvDelete(siteId: string, key: string) {
    return this.site(siteId).delete(key);
  }
  async filesList(siteId: string, limit: number) {
    return [...this.files.values()]
      .filter((f) => f.site === siteId)
      .map((f) => f.file)
      .slice(0, limit);
  }
  async fileUpload(siteId: string, name: string, bytes: Uint8Array, mime: string) {
    const file = {
      id: `f${++this.n}`,
      name,
      size: bytes.byteLength,
      mime,
      createdAt: new Date(0).toISOString(),
    };
    this.files.set(file.id, { site: siteId, file, bytes });
    return file;
  }
  async fileGet(siteId: string, fileId: string) {
    const f = this.files.get(fileId);
    return f && f.site === siteId ? { file: f.file, bytes: f.bytes } : null;
  }
  async fileDelete(siteId: string, fileId: string) {
    const f = this.files.get(fileId);
    if (!f || f.site !== siteId) return false;
    return this.files.delete(fileId);
  }
  async purgeSite(siteId: string) {
    this.purged.push(siteId);
    this.kv.delete(siteId);
    for (const [id, f] of this.files) if (f.site === siteId) this.files.delete(id);
  }
}
