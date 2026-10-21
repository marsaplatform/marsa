import { randomBytes } from "node:crypto";
import { AwsClient } from "aws4fetch";
import type { CloudflareConfig } from "../config.js";
import { mimeFor } from "../mime.js";
import type { BackendFile, SiteBackend } from "./types.js";

type FetchFn = (input: Request | string | URL, init?: RequestInit) => Promise<Response>;

export interface CloudflareDeps {
  /** HTTP client (tests pass a mock). Defaults to the global fetch. */
  fetch?: FetchFn;
  /** Wait used between retries (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
  /** Clock for new file ids and createdAt (tests pass a fixed one). */
  now?: () => number;
}

const FILE_ID_RE = /^[A-Za-z0-9._-]{1,36}$/;
/** Workers KV list pages hold 10..1000 keys. */
const KV_PAGE = 1000;
/** Workers KV bulk delete takes up to 10,000 keys per call. */
const KV_BULK = 10_000;
const S3_PAGE = 1000;
const RETRIES = 2;

/** Thrown for any unexpected Cloudflare answer. Never carries credentials. */
export class CloudflareError extends Error {
  constructor(
    readonly service: "kv" | "r2",
    readonly status: number,
    detail: string,
  ) {
    super(`Cloudflare ${service.toUpperCase()} request failed (${status}): ${detail}`);
  }
}

/** KV key for a site's key: "<siteId>/<key>" (site ids and keys never contain "/"). */
export const kvKeyName = (siteId: string, key: string) => `${siteId}/${key}`;

/**
 * R2 object key for a file: "<siteId>/<fileId>/<percent-encoded name>". The
 * site prefix scopes every list/purge to one site; the file id keeps the
 * id-based API (two uploads with the same name stay two files); encoding the
 * name keeps keys plain ASCII so listings never need XML/Unicode escaping.
 */
export const r2ObjectKey = (siteId: string, fileId: string, name: string) =>
  `${siteId}/${fileId}/${encodeURIComponent(name)}`;

/** RFC 3986 encoding of one path segment (what S3 signing expects). */
const enc = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const unxml = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, e: string) => {
    switch (e) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
        return String.fromCodePoint(
          e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1)),
        );
    }
  });

const tag = (xml: string, name: string): string | undefined => {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m?.[1] === undefined ? undefined : unxml(m[1]);
};

export interface ListedObject {
  key: string;
  size: number;
  lastModified: string;
}

/** Sortable, unguessable file id: "f" + base36 time + 16 hex chars (26 chars). */
export function newFileId(now: number): string {
  return `f${now.toString(36).padStart(9, "0")}${randomBytes(8).toString("hex")}`;
}

/**
 * Cloudflare implementation, using only Cloudflare's public HTTP APIs from
 * Node (no Worker needed):
 * - KV values live in one Workers KV namespace (REST API), keyed "<siteId>/<key>".
 * - Files live in one R2 bucket (S3-compatible API, SigV4 via aws4fetch),
 *   keyed "<siteId>/<fileId>/<name>".
 * All calls carry server-side credentials only; browsers reach the data
 * exclusively through Marsa's own authorized routes.
 */
export class CloudflareBackend implements SiteBackend {
  readonly kind = "cloudflare";
  private readonly fetchFn: FetchFn;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly s3: AwsClient;

  constructor(
    private readonly cfg: CloudflareConfig,
    deps: CloudflareDeps = {},
  ) {
    this.fetchFn = deps.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = deps.now ?? Date.now;
    this.s3 = new AwsClient({
      accessKeyId: cfg.r2AccessKeyId,
      secretAccessKey: cfg.r2SecretAccessKey,
      service: "s3",
      region: "auto",
      retries: 0,
    });
  }

  /** Retries rate limits (KV allows 1 write/s per key) and transient 5xx answers. */
  private async withRetry(send: () => Promise<Response>): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await send();
      if ((res.status !== 429 && res.status < 500) || attempt >= RETRIES) return res;
      const after = Number(res.headers.get("retry-after"));
      await res.body?.cancel().catch(() => {});
      await this.sleep(
        Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 3000) : 500 * 2 ** attempt,
      );
    }
  }

  // ---- Workers KV (REST API) ---------------------------------------------------

  private kv(path: string, init: RequestInit = {}): Promise<Response> {
    const url = `${this.cfg.apiBase}/accounts/${this.cfg.accountId}/storage/kv/namespaces/${this.cfg.kvNamespaceId}${path}`;
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.cfg.apiToken}`);
    return this.withRetry(() => this.fetchFn(url, { ...init, headers }));
  }

  private async kvFail(res: Response): Promise<never> {
    let detail = res.statusText || "error";
    try {
      const j = (await res.json()) as { errors?: { code?: number; message?: string }[] };
      const e = j.errors?.[0];
      if (e) detail = `${e.code ?? ""} ${e.message ?? ""}`.trim();
    } catch {
      // not JSON
    }
    throw new CloudflareError("kv", res.status, detail);
  }

  private async kvNames(siteId: string, limit = Number.POSITIVE_INFINITY): Promise<string[]> {
    const prefix = `${siteId}/`;
    const names: string[] = [];
    let cursor = "";
    do {
      const q = new URLSearchParams({ prefix, limit: String(KV_PAGE) });
      if (cursor) q.set("cursor", cursor);
      const res = await this.kv(`/keys?${q}`);
      if (!res.ok) await this.kvFail(res);
      const j = (await res.json()) as {
        result?: { name: string }[];
        result_info?: { cursor?: string };
      };
      for (const k of j.result ?? []) {
        if (k.name.startsWith(prefix)) names.push(k.name);
      }
      cursor = j.result_info?.cursor ?? "";
    } while (cursor && names.length < limit);
    return names;
  }

  async kvList(siteId: string, limit: number): Promise<string[]> {
    const cut = siteId.length + 1;
    return (await this.kvNames(siteId, limit))
      .map((n) => n.slice(cut))
      .sort()
      .slice(0, limit);
  }

  async kvCount(siteId: string): Promise<number> {
    return (await this.kvNames(siteId)).length;
  }

  async kvGet(siteId: string, key: string): Promise<string | undefined> {
    const res = await this.kv(`/values/${enc(kvKeyName(siteId, key))}`);
    if (res.status === 404) {
      await res.body?.cancel().catch(() => {});
      return undefined;
    }
    if (!res.ok) await this.kvFail(res);
    return new TextDecoder().decode(await res.arrayBuffer());
  }

  async kvSet(siteId: string, key: string, json: string): Promise<void> {
    const res = await this.kv(`/values/${enc(kvKeyName(siteId, key))}`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: new TextEncoder().encode(json),
    });
    if (!res.ok) await this.kvFail(res);
  }

  async kvDelete(siteId: string, key: string): Promise<boolean> {
    // KV's DELETE succeeds for missing keys too; look first so the API can answer 404.
    if ((await this.kvGet(siteId, key)) === undefined) return false;
    const res = await this.kv(`/values/${enc(kvKeyName(siteId, key))}`, { method: "DELETE" });
    if (res.status === 404) return false;
    if (!res.ok) await this.kvFail(res);
    return true;
  }

  private async kvBulkDelete(names: string[]): Promise<void> {
    for (let i = 0; i < names.length; i += KV_BULK) {
      let batch = names.slice(i, i + KV_BULK);
      for (let attempt = 0; batch.length > 0; attempt++) {
        const res = await this.kv("/bulk/delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(batch),
        });
        if (!res.ok) await this.kvFail(res);
        const j = (await res.json()) as { result?: { unsuccessful_keys?: string[] } };
        batch = j.result?.unsuccessful_keys ?? [];
        if (batch.length > 0 && attempt >= RETRIES) {
          throw new CloudflareError("kv", 200, `${batch.length} key(s) could not be deleted`);
        }
      }
    }
  }

  // ---- R2 (S3-compatible API) --------------------------------------------------

  private r2(path: string, init: RequestInit = {}): Promise<Response> {
    const url = `${this.cfg.r2Endpoint}/${this.cfg.r2Bucket}${path}`;
    return this.withRetry(async () => this.fetchFn(await this.s3.sign(url, init)));
  }

  private objectPath = (key: string) => `/${key.split("/").map(enc).join("/")}`;

  private async r2Fail(res: Response, what: string): Promise<never> {
    let code = res.statusText || "error";
    try {
      code = tag(await res.text(), "Code") ?? code;
    } catch {
      // no body
    }
    throw new CloudflareError("r2", res.status, `${what}: ${code}`);
  }

  private async listObjects(prefix: string, limit: number): Promise<ListedObject[]> {
    const out: ListedObject[] = [];
    let token = "";
    do {
      const q = new URLSearchParams({
        "list-type": "2",
        prefix,
        "max-keys": String(Math.max(1, Math.min(S3_PAGE, limit - out.length))),
      });
      if (token) q.set("continuation-token", token);
      const res = await this.r2(`?${q}`);
      if (!res.ok) await this.r2Fail(res, "list");
      const xml = await res.text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const block = m[1] ?? "";
        const key = tag(block, "Key");
        if (!key?.startsWith(prefix)) continue;
        out.push({
          key,
          size: Number(tag(block, "Size") ?? 0),
          lastModified: tag(block, "LastModified") ?? "",
        });
      }
      token = tag(xml, "IsTruncated") === "true" ? (tag(xml, "NextContinuationToken") ?? "") : "";
    } while (token && out.length < limit);
    return out;
  }

  /** "<siteId>/<fileId>/<encoded name>" -> BackendFile, or null for foreign keys. */
  private toFile(siteId: string, o: ListedObject): BackendFile | null {
    const parts = o.key.split("/");
    if (parts.length !== 3 || parts[0] !== siteId) return null;
    const [, id = "", encoded = ""] = parts;
    let name: string;
    try {
      name = decodeURIComponent(encoded);
    } catch {
      return null;
    }
    if (!FILE_ID_RE.test(id) || !name) return null;
    const createdAt = o.lastModified ? new Date(o.lastModified).toISOString() : "";
    return { id, name, size: o.size, mime: mimeFor(name), createdAt };
  }

  /** The single object of one file, or null (also for invalid ids). */
  private async findFile(siteId: string, fileId: string) {
    if (!FILE_ID_RE.test(fileId)) return null;
    const [o] = await this.listObjects(`${siteId}/${fileId}/`, 1);
    const file = o && this.toFile(siteId, o);
    return file && o ? { file, key: o.key } : null;
  }

  async filesList(siteId: string, limit: number): Promise<BackendFile[]> {
    const objects = await this.listObjects(`${siteId}/`, limit);
    return objects
      .map((o) => this.toFile(siteId, o))
      .filter((f): f is BackendFile => f !== null)
      .slice(0, limit);
  }

  async fileUpload(
    siteId: string,
    name: string,
    bytes: Uint8Array,
    mime: string,
  ): Promise<BackendFile> {
    const now = this.now();
    const id = newFileId(now);
    const res = await this.r2(this.objectPath(r2ObjectKey(siteId, id, name)), {
      method: "PUT",
      headers: { "content-type": mime || "application/octet-stream" },
      body: new Uint8Array(bytes),
    });
    if (!res.ok) await this.r2Fail(res, "upload");
    await res.body?.cancel().catch(() => {});
    return {
      id,
      name,
      size: bytes.byteLength,
      mime: mimeFor(name),
      createdAt: new Date(now).toISOString(),
    };
  }

  async fileGet(siteId: string, fileId: string) {
    const found = await this.findFile(siteId, fileId);
    if (!found) return null;
    const res = await this.r2(this.objectPath(found.key));
    if (res.status === 404) return null;
    if (!res.ok) await this.r2Fail(res, "download");
    return { file: found.file, bytes: new Uint8Array(await res.arrayBuffer()) };
  }

  async fileDelete(siteId: string, fileId: string): Promise<boolean> {
    const found = await this.findFile(siteId, fileId);
    if (!found) return false;
    await this.deleteObject(found.key);
    return true;
  }

  private async deleteObject(key: string): Promise<void> {
    const res = await this.r2(this.objectPath(key), { method: "DELETE" });
    // S3 answers 204 for deletes, including already-missing objects.
    if (!res.ok && res.status !== 404) await this.r2Fail(res, "delete");
    await res.body?.cancel().catch(() => {});
  }

  // ---- raw objects for platform backups (0.16.0), under a "_marsa-…/" prefix ----------
  /** Store one object (whole body; backups are a few MB). */
  async blobPut(key: string, bytes: Uint8Array): Promise<void> {
    const res = await this.r2(this.objectPath(key), {
      method: "PUT",
      body: bytes as unknown as BodyInit,
      headers: { "content-type": "application/octet-stream" },
    });
    if (!res.ok) await this.r2Fail(res, "upload");
    await res.body?.cancel().catch(() => {});
  }

  async blobGet(key: string): Promise<Uint8Array | null> {
    const res = await this.r2(this.objectPath(key));
    if (res.status === 404) return null;
    if (!res.ok) await this.r2Fail(res, "download");
    return new Uint8Array(await res.arrayBuffer());
  }

  blobList(prefix: string, limit = 5000): Promise<ListedObject[]> {
    return this.listObjects(prefix, limit);
  }

  blobDelete(key: string): Promise<void> {
    return this.deleteObject(key);
  }

  async purgeSite(siteId: string): Promise<void> {
    await this.kvBulkDelete(await this.kvNames(siteId));
    for (;;) {
      const objects = await this.listObjects(`${siteId}/`, S3_PAGE);
      if (objects.length === 0) break;
      for (let i = 0; i < objects.length; i += 10) {
        await Promise.all(objects.slice(i, i + 10).map((o) => this.deleteObject(o.key)));
      }
      if (objects.length < S3_PAGE) break;
    }
  }
}
