import { createHash, randomBytes } from "node:crypto";
import { Client, Query, Storage, TablesDB } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import type { AppwriteConfig } from "../config.js";
import { mimeFor } from "../mime.js";
import type { BackendFile, SiteBackend } from "./types.js";

/** The subset of node-appwrite's TablesDB we use (lets tests pass a mock). */
export type TablesApi = Pick<
  TablesDB,
  "getRow" | "upsertRow" | "deleteRow" | "listRows" | "deleteRows"
>;
/** The subset of node-appwrite's Storage we use. */
export type StorageApi = Pick<
  Storage,
  "createFile" | "getFile" | "getFileDownload" | "deleteFile" | "listFiles"
>;

interface KvRow {
  siteId: string;
  key: string;
  value: string;
}

const isNotFound = (err: unknown) => (err as { code?: number } | null)?.code === 404;

/** Deterministic 36-char row id (Appwrite's max), so a key maps to exactly one row. */
export function kvRowId(siteId: string, key: string): string {
  return `k${createHash("sha256").update(`${siteId}\n${key}`).digest("hex").slice(0, 35)}`;
}

const PAGE = 100;

/**
 * Appwrite implementation. KV entries are rows in one table
 * (siteId, key, value); files live in one bucket, named "<siteId>/<name>".
 * All calls use the server API key; nothing here is reachable from browsers
 * except through Marsa's own authorized routes.
 */
export class AppwriteBackend implements SiteBackend {
  readonly kind = "appwrite";
  private readonly tables: TablesApi;
  private readonly storage: StorageApi;

  constructor(
    private readonly cfg: AppwriteConfig,
    deps?: { tables: TablesApi; storage: StorageApi },
  ) {
    if (deps) {
      this.tables = deps.tables;
      this.storage = deps.storage;
    } else {
      const client = new Client()
        .setEndpoint(cfg.endpoint)
        .setProject(cfg.projectId)
        .setKey(cfg.apiKey);
      this.tables = new TablesDB(client);
      this.storage = new Storage(client);
    }
  }

  private get t() {
    return { databaseId: this.cfg.databaseId, tableId: this.cfg.kvTableId };
  }

  async kvList(siteId: string, limit: number): Promise<string[]> {
    const keys: string[] = [];
    let cursor: string | undefined;
    while (keys.length < limit) {
      const queries = [
        Query.equal("siteId", siteId),
        Query.limit(Math.min(PAGE, limit - keys.length)),
      ];
      if (cursor) queries.push(Query.cursorAfter(cursor));
      const res = await this.tables.listRows({ ...this.t, queries });
      const rows = res.rows as unknown as (KvRow & { $id: string })[];
      for (const r of rows) keys.push(r.key);
      if (rows.length < PAGE) break;
      cursor = rows[rows.length - 1]?.$id;
    }
    return keys.sort();
  }

  async kvCount(siteId: string): Promise<number> {
    const res = await this.tables.listRows({
      ...this.t,
      queries: [Query.equal("siteId", siteId), Query.limit(1)],
      total: true,
    });
    return res.total;
  }

  async kvGet(siteId: string, key: string): Promise<string | undefined> {
    try {
      const row = (await this.tables.getRow({
        ...this.t,
        rowId: kvRowId(siteId, key),
      })) as unknown as KvRow;
      return row.siteId === siteId && row.key === key ? row.value : undefined;
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }

  async kvSet(siteId: string, key: string, json: string): Promise<void> {
    await this.tables.upsertRow({
      ...this.t,
      rowId: kvRowId(siteId, key),
      data: { siteId, key, value: json },
    });
  }

  async kvDelete(siteId: string, key: string): Promise<boolean> {
    try {
      await this.tables.deleteRow({ ...this.t, rowId: kvRowId(siteId, key) });
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  private toFile(
    siteId: string,
    f: { $id: string; name: string; sizeOriginal: number; $createdAt: string },
  ): BackendFile {
    const name = f.name.slice(siteId.length + 1);
    return { id: f.$id, name, size: f.sizeOriginal, mime: mimeFor(name), createdAt: f.$createdAt };
  }

  async filesList(siteId: string, limit: number): Promise<BackendFile[]> {
    const res = await this.storage.listFiles({
      bucketId: this.cfg.bucketId,
      queries: [Query.startsWith("name", `${siteId}/`), Query.limit(Math.min(limit, 5000))],
    });
    return res.files
      .filter((f) => f.name.startsWith(`${siteId}/`))
      .map((f) => this.toFile(siteId, f));
  }

  async fileUpload(
    siteId: string,
    name: string,
    bytes: Uint8Array,
    _mime: string,
  ): Promise<BackendFile> {
    const fileId = `f${randomBytes(12).toString("hex")}`;
    const f = await this.storage.createFile({
      bucketId: this.cfg.bucketId,
      fileId,
      file: InputFile.fromBuffer(bytes, `${siteId}/${name}`),
    });
    return this.toFile(siteId, f);
  }

  async fileGet(siteId: string, fileId: string) {
    try {
      const f = await this.storage.getFile({ bucketId: this.cfg.bucketId, fileId });
      if (!f.name.startsWith(`${siteId}/`)) return null; // another site's file
      const buf = await this.storage.getFileDownload({ bucketId: this.cfg.bucketId, fileId });
      return { file: this.toFile(siteId, f), bytes: new Uint8Array(buf) };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async fileDelete(siteId: string, fileId: string): Promise<boolean> {
    try {
      const f = await this.storage.getFile({ bucketId: this.cfg.bucketId, fileId });
      if (!f.name.startsWith(`${siteId}/`)) return false;
      await this.storage.deleteFile({ bucketId: this.cfg.bucketId, fileId });
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  async purgeSite(siteId: string): Promise<void> {
    await this.tables.deleteRows({ ...this.t, queries: [Query.equal("siteId", siteId)] });
    for (;;) {
      const files = await this.filesList(siteId, PAGE);
      if (files.length === 0) break;
      for (const f of files) {
        await this.storage
          .deleteFile({ bucketId: this.cfg.bucketId, fileId: f.id })
          .catch((err) => {
            if (!isNotFound(err)) throw err;
          });
      }
      if (files.length < PAGE) break;
    }
  }
}
