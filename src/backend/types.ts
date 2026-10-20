/** Storage-agnostic contract for the optional per-site data/files backend. */
export interface BackendFile {
  id: string;
  name: string;
  size: number;
  mime: string;
  createdAt: string;
}

export interface SiteBackend {
  readonly kind: string;
  kvList(siteId: string, limit: number): Promise<string[]>;
  kvCount(siteId: string): Promise<number>;
  /** The stored JSON text, or undefined if the key doesn't exist. */
  kvGet(siteId: string, key: string): Promise<string | undefined>;
  kvSet(siteId: string, key: string, json: string): Promise<void>;
  kvDelete(siteId: string, key: string): Promise<boolean>;
  filesList(siteId: string, limit: number): Promise<BackendFile[]>;
  fileUpload(siteId: string, name: string, bytes: Uint8Array, mime: string): Promise<BackendFile>;
  /** File metadata + bytes, or null when the id doesn't exist or belongs to another site. */
  fileGet(siteId: string, fileId: string): Promise<{ file: BackendFile; bytes: Uint8Array } | null>;
  fileDelete(siteId: string, fileId: string): Promise<boolean>;
  /** Remove every KV entry and file of a site (on expiry or delete). */
  purgeSite(siteId: string): Promise<void>;
}
