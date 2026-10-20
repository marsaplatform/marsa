import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { SiteBackend } from "./backend/types.js";
import { APP_VERSION, PRODUCT_NAME } from "./brand.js";
import type { Config } from "./config.js";
import { UploadError } from "./errors.js";
import { type FileInput, fromFilesArray, type UploadEntry } from "./ingest.js";
import type { AuditEntry } from "./members.js";
import { isBlocked, mimeFor } from "./mime.js";
import type { RateLimiter } from "./rate-limit.js";
import type { SiteMeta, SiteStore } from "./store.js";
import type { TeamStore } from "./teams.js";
import { bearer, hashToken, safeEqual } from "./tokens.js";

/**
 * One MCP server per space: POST /mcp/s/<siteId> speaks MCP over Streamable
 * HTTP (JSON responses, stateless; no SSE stream). Clients authenticate with a
 * per-space token created on the site's dashboard page: `marsa_mcp_…`, scoped
 * read-only ("ro") or read-write ("rw"). Only the SHA-256 of a token is stored,
 * in the site's meta.json, so tokens die with the site.
 */

export type McpScope = "ro" | "rw";
export interface McpToken {
  id: string;
  name: string;
  scope: McpScope;
  hash: string;
  prefix: string;
  createdAt: string;
}

export const MCP_TOKEN_PREFIX = "marsa_mcp_";
export const MAX_MCP_TOKENS = 10;
export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
const TEXT_CAP = 256 * 1024;
const KEY_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const FILE_ID_RE = /^[A-Za-z0-9._-]{1,36}$/;

export function cleanTokenName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/\s+/g, " ");
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  if (!s || s.length > 60 || /[\u0000-\u001f\u007f]/.test(s)) return null;
  return s;
}

/** Add a token to a site (caller saves the meta). Returns the secret, shown once. */
export function addMcpToken(meta: SiteMeta, name: string, scope: McpScope, now: number) {
  const secret = `${MCP_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const tok: McpToken = {
    id: randomBytes(6).toString("hex"),
    name,
    scope,
    hash: hashToken(secret),
    prefix: secret.slice(0, MCP_TOKEN_PREFIX.length + 4),
    createdAt: new Date(now).toISOString(),
  };
  meta.mcpTokens = [...(meta.mcpTokens ?? []), tok];
  return { token: tok, secret };
}

export function findMcpToken(meta: SiteMeta, secret: string): McpToken | null {
  if (!secret.startsWith(MCP_TOKEN_PREFIX)) return null;
  const h = hashToken(secret);
  return (meta.mcpTokens ?? []).find((t) => safeEqual(t.hash, h)) ?? null;
}

export interface McpDeps {
  /** Audit log for writes (team sites only). */
  audit?: (e: Omit<AuditEntry, "at" | "teamId"> & { teamId?: string }) => Promise<void>;
  config: Config;
  store: SiteStore;
  teams: TeamStore;
  backend: SiteBackend | null;
  limiter: RateLimiter;
  now: () => number;
  siteUrl: (id: string) => string;
  replaceSite: (meta: SiteMeta, entries: UploadEntry[]) => Promise<SiteMeta>;
}

type Json = Record<string, unknown>;
interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  annotations?: Json;
  write?: boolean;
  needsBackend?: boolean;
  run: (args: Json, ctx: CallCtx) => Promise<ToolResult>;
}
interface CallCtx {
  meta: SiteMeta;
  token: McpToken;
}
interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}

class ToolError extends Error {}

const ok = (data: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  structuredContent: data,
});
const fail = (message: string): ToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});
const str = (args: Json, k: string, required = true): string => {
  const v = args[k];
  if (typeof v === "string") return v;
  if (v === undefined && !required) return "";
  throw new ToolError(`"${k}" must be a string`);
};
const obj = (props: Json, required: string[] = []): Json => ({
  type: "object",
  properties: props,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});
const TEXTISH =
  /^(text\/|application\/(json|javascript|xml|manifest\+json|ld\+json)|image\/svg\+xml)/;

export function mountMcpRoutes(app: Hono, d: McpDeps): void {
  const { config, store, teams, backend, limiter, now } = d;
  const limits = config.backend;

  const tools: Tool[] = [
    {
      name: "get_site_info",
      title: "Site info",
      description:
        "This space's title, public URL, team, expiry (or permanent), size, file count, whether the KV/files backend is on, and this token's scope.",
      inputSchema: obj({}),
      annotations: { readOnlyHint: true },
      run: async (_a, { meta, token }) => {
        const team = teams.get(meta.teamId);
        return ok({
          id: meta.id,
          title: meta.title ?? null,
          url: d.siteUrl(meta.id),
          team: team ? { id: team.id, name: team.name } : null,
          permanent: !!meta.permanent,
          expiresAt: meta.permanent ? null : meta.expiresAt,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          fileCount: meta.fileCount,
          totalBytes: meta.totalBytes,
          backend: backendOn(meta),
          scope: token.scope,
        });
      },
    },
    {
      name: "list_files",
      title: "List published files",
      description: "The static files of the published site (path, size, MIME type).",
      inputSchema: obj({}),
      annotations: { readOnlyHint: true },
      run: async (_a, { meta }) =>
        ok({
          files: Object.entries(meta.files)
            .map(([path, f]) => ({ path, size: f.size, mime: f.mime }))
            .sort((a, b) => a.path.localeCompare(b.path)),
        }),
    },
    {
      name: "read_file",
      title: "Read a published file",
      description: `Read a text file of the published site (HTML, CSS, JS, JSON, SVG, Markdown…), up to ${TEXT_CAP / 1024} KB; longer files are cut and marked truncated.`,
      inputSchema: obj({ path: { type: "string", description: "e.g. index.html" } }, ["path"]),
      annotations: { readOnlyHint: true },
      run: async (a, { meta }) => {
        const path = str(a, "path").replace(/^\/+/, "");
        const f = meta.files[path];
        const abs = Object.hasOwn(meta.files, path) ? store.filePath(meta, path) : null;
        if (!f || !abs) return fail(`no such file: ${path}`);
        if (!TEXTISH.test(f.mime) && !/\.(md|txt|csv|tsv|yml|yaml|toml)$/i.test(path)) {
          return fail(`${path} is not a text file (${f.mime}); use list_files to see it`);
        }
        const { open } = await import("node:fs/promises");
        const fh = await open(abs, "r");
        try {
          const buf = Buffer.alloc(Math.min(f.size, TEXT_CAP));
          const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
          return ok({
            path,
            mime: f.mime,
            size: f.size,
            truncated: f.size > TEXT_CAP,
            text: buf.subarray(0, bytesRead).toString("utf8"),
          });
        } finally {
          await fh.close();
        }
      },
    },
    {
      name: "replace_site_files",
      title: "Replace the published files",
      description:
        'Publish a new version of the site at the same link: the given files replace all current files. index.html is the start page. Binary files: encoding "base64".',
      inputSchema: obj(
        {
          files: {
            type: "array",
            minItems: 1,
            items: obj(
              {
                path: { type: "string" },
                content: { type: "string" },
                encoding: { type: "string", enum: ["utf8", "base64"] },
              },
              ["path", "content"],
            ),
          },
        },
        ["files"],
      ),
      annotations: { destructiveHint: true, idempotentHint: true },
      write: true,
      run: async (a, { meta }) => {
        if (!Array.isArray(a.files)) throw new ToolError('"files" must be an array');
        try {
          const out = await d.replaceSite(meta, fromFilesArray(a.files as FileInput[]));
          return ok({
            url: d.siteUrl(out.id),
            fileCount: out.fileCount,
            totalBytes: out.totalBytes,
            title: out.title ?? null,
          });
        } catch (err) {
          if (err instanceof UploadError) return fail(`${err.code}: ${err.message}`);
          throw err;
        }
      },
    },
    {
      name: "kv_list",
      title: "List KV keys",
      description:
        "Keys stored in this space's KV store (optionally only those starting with a prefix).",
      inputSchema: obj({ prefix: { type: "string" } }),
      annotations: { readOnlyHint: true },
      needsBackend: true,
      run: async (a, { meta }) => {
        const prefix = str(a, "prefix", false);
        const keys = await kv().kvList(meta.id, limits.maxKeys);
        return ok({ keys: prefix ? keys.filter((k) => k.startsWith(prefix)) : keys });
      },
    },
    {
      name: "kv_get",
      title: "Get a KV value",
      description: "The JSON value stored under a key.",
      inputSchema: obj({ key: { type: "string" } }, ["key"]),
      annotations: { readOnlyHint: true },
      needsBackend: true,
      run: async (a, { meta }) => {
        const key = validKey(str(a, "key"));
        const v = await kv().kvGet(meta.id, key);
        if (v === undefined) return fail(`no such key: ${key}`);
        return ok({ key, value: JSON.parse(v) });
      },
    },
    {
      name: "kv_put",
      title: "Set a KV value",
      description: `Store any JSON value under a key (max ${limits.maxValueBytes} bytes, ${limits.maxKeys} keys per site). Writes are rate-limited.`,
      inputSchema: obj({ key: { type: "string" }, value: { description: "any JSON value" } }, [
        "key",
        "value",
      ]),
      annotations: { idempotentHint: true },
      write: true,
      needsBackend: true,
      run: async (a, { meta }) => {
        const key = validKey(str(a, "key"));
        if (!("value" in a)) throw new ToolError('"value" is required');
        const json = JSON.stringify(a.value);
        if (Buffer.byteLength(json) > limits.maxValueBytes) {
          return fail(`VALUE_TOO_LARGE: values are limited to ${limits.maxValueBytes} bytes`);
        }
        const b = kv();
        if (
          (await b.kvGet(meta.id, key)) === undefined &&
          (await b.kvCount(meta.id)) >= limits.maxKeys
        ) {
          return fail(`TOO_MANY_KEYS: a site can hold ${limits.maxKeys} keys`);
        }
        await b.kvSet(meta.id, key, json);
        return ok({ key, stored: true });
      },
    },
    {
      name: "kv_delete",
      title: "Delete a KV key",
      description: "Remove a key from this space's KV store.",
      inputSchema: obj({ key: { type: "string" } }, ["key"]),
      annotations: { destructiveHint: true, idempotentHint: true },
      write: true,
      needsBackend: true,
      run: async (a, { meta }) => {
        const key = validKey(str(a, "key"));
        return ok({ key, deleted: await kv().kvDelete(meta.id, key) });
      },
    },
    {
      name: "list_uploads",
      title: "List uploaded files",
      description: "Files stored in this space's file storage (R2), with their public URLs.",
      inputSchema: obj({}),
      annotations: { readOnlyHint: true },
      needsBackend: true,
      run: async (_a, { meta }) => {
        const base = `${config.publicUrl}/api/sites/${meta.id}/files`;
        const files = await kv().filesList(meta.id, limits.maxFiles);
        return ok({ files: files.map((f) => ({ ...f, url: `${base}/${f.id}` })) });
      },
    },
    {
      name: "upload_file",
      title: "Upload a file",
      description: `Store a file in this space's file storage (max ${Math.round(config.maxFileBytes / 1024 / 1024)} MB). Send text, or base64 for binary.`,
      inputSchema: obj(
        {
          name: { type: "string", description: "file name, e.g. photo.jpg" },
          content: { type: "string" },
          encoding: { type: "string", enum: ["utf8", "base64"] },
        },
        ["name", "content"],
      ),
      write: true,
      needsBackend: true,
      run: async (a, { meta }) => {
        const name = (str(a, "name").replace(/\\/g, "/").split("/").pop() ?? "").trim();
        if (!/^[^\0]{1,200}$/.test(name) || name.startsWith(".")) {
          return fail("INVALID_PATH: a file name (1-200 chars, not a dotfile) is required");
        }
        if (isBlocked(name)) return fail(`BLOCKED_FILE_TYPE: ${name}`);
        const enc = a.encoding === "base64" ? "base64" : "utf8";
        const bytes = new Uint8Array(Buffer.from(str(a, "content"), enc));
        if (!bytes.byteLength) return fail("EMPTY_UPLOAD: the file is empty");
        if (bytes.byteLength > config.maxFileBytes) return fail("FILE_TOO_LARGE");
        const b = kv();
        if ((await b.filesList(meta.id, limits.maxFiles)).length >= limits.maxFiles) {
          return fail(`TOO_MANY_FILES: a site can hold ${limits.maxFiles} files`);
        }
        const f = await b.fileUpload(meta.id, name, bytes, mimeFor(name));
        return ok({ ...f, url: `${config.publicUrl}/api/sites/${meta.id}/files/${f.id}` });
      },
    },
    {
      name: "delete_file",
      title: "Delete an uploaded file",
      description: "Remove a file from this space's file storage (by id, from list_uploads).",
      inputSchema: obj({ id: { type: "string" } }, ["id"]),
      annotations: { destructiveHint: true, idempotentHint: true },
      write: true,
      needsBackend: true,
      run: async (a, { meta }) => {
        const id = str(a, "id");
        if (!FILE_ID_RE.test(id)) return fail("no such file");
        return ok({ id, deleted: await kv().fileDelete(meta.id, id) });
      },
    },
  ];

  function backendOn(meta: SiteMeta) {
    return !!backend && (limits.guestAccess || !!teams.get(meta.teamId)?.backend);
  }
  function kv(): SiteBackend {
    if (!backend) throw new ToolError("the data/files backend is not configured");
    return backend;
  }
  function validKey(k: string) {
    if (!KEY_RE.test(k)) throw new ToolError("keys are 1-128 chars of A-Z a-z 0-9 . _ : -");
    return k;
  }
  const available = (meta: SiteMeta, token: McpToken) =>
    tools.filter((t) => (!t.write || token.scope === "rw") && (!t.needsBackend || backendOn(meta)));

  const rpc = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
  const rpcErr = (id: unknown, code: number, message: string) => ({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  });
  const httpErr = (c: Context, status: number, message: string, code = -32000) =>
    c.json(rpcErr(null, code, message), status as 400);

  const path = "/mcp/s/:id";
  app.use(path, async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Methods", "POST, OPTIONS");
    c.header(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id",
    );
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  });
  // Stateless server: no server-initiated SSE stream and no sessions to end.
  for (const m of ["get", "delete"] as const) {
    app[m](path, (c) => {
      c.header("Allow", "POST, OPTIONS");
      return c.body(null, 405);
    });
  }

  app.post(
    path,
    bodyLimit({
      maxSize: Math.ceil(config.maxSiteBytes * 1.4) + 64 * 1024,
      onError: (c) => httpErr(c, 413, "request body too large"),
    }),
    async (c) => {
      // DNS-rebinding guard: a browser Origin must be this instance (agents send none).
      const origin = c.req.header("origin");
      if (origin && origin !== "null" && origin !== new URL(config.publicUrl).origin) {
        return httpErr(c, 403, "origin not allowed");
      }
      const pv = c.req.header("mcp-protocol-version");
      if (pv && !(MCP_PROTOCOL_VERSIONS as readonly string[]).includes(pv)) {
        return httpErr(c, 400, `unsupported MCP-Protocol-Version: ${pv}`);
      }
      const meta = await store.get(c.req.param("id") ?? "");
      const secret = bearer(c.req.header("authorization")) ?? "";
      const token = meta ? findMcpToken(meta, secret) : null;
      if (!meta || !token || Date.parse(meta.expiresAt) <= now()) {
        c.header("WWW-Authenticate", 'Bearer realm="marsa-mcp"');
        return httpErr(c, 401, "missing, revoked or unknown MCP token for this space");
      }
      const per = limiter.hit(`mcp:${token.hash}`, config.mcp.requestsPerMinute, 60_000);
      if (!per.allowed) {
        c.header("Retry-After", String(per.retryAfterSec));
        return httpErr(c, 429, "too many requests for this token, slow down");
      }

      let msg: Json;
      try {
        msg = await c.req.json();
      } catch {
        return c.json(rpcErr(null, -32700, "parse error"), 400);
      }
      if (Array.isArray(msg)) return c.json(rpcErr(null, -32600, "batches are not supported"), 400);
      if (msg?.jsonrpc !== "2.0" || typeof msg.method !== "string") {
        // A JSON-RPC response or garbage: nothing to do.
        return "result" in (msg ?? {}) || "error" in (msg ?? {})
          ? c.body(null, 202)
          : c.json(rpcErr(msg?.id, -32600, "invalid request"), 400);
      }
      const isNotification = !("id" in msg);
      if (isNotification) return c.body(null, 202);
      const id = msg.id;
      const params = (msg.params ?? {}) as Json;

      switch (msg.method) {
        case "initialize": {
          const asked = String(params.protocolVersion ?? "");
          const version = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked)
            ? asked
            : MCP_PROTOCOL_VERSIONS[0];
          return c.json(
            rpc(id, {
              protocolVersion: version,
              capabilities: { tools: { listChanged: false } },
              serverInfo: {
                name: "marsa-spaces",
                title: `${PRODUCT_NAME.en}: ${meta.title ?? meta.id}`,
                version: APP_VERSION,
              },
              instructions: `This server is one Marsa space (${d.siteUrl(meta.id)}). Token scope: ${token.scope === "rw" ? "read-write" : "read-only"}. Use get_site_info first.`,
            }),
          );
        }
        case "ping":
          return c.json(rpc(id, {}));
        case "tools/list":
          return c.json(
            rpc(id, {
              tools: available(meta, token).map(
                ({ name, title, description, inputSchema, annotations }) => ({
                  name,
                  title,
                  description,
                  inputSchema,
                  ...(annotations ? { annotations } : {}),
                }),
              ),
            }),
          );
        case "tools/call": {
          const name = String(params.name ?? "");
          const tool = tools.find((t) => t.name === name);
          if (!tool) return c.json(rpcErr(id, -32602, `unknown tool: ${name}`));
          if (tool.write && token.scope !== "rw") {
            return c.json(rpc(id, fail("this token is read-only")));
          }
          if (tool.needsBackend && !backendOn(meta)) {
            return c.json(
              rpc(id, fail("BACKEND_NOT_ALLOWED: this space has no data/files backend")),
            );
          }
          if (tool.write) {
            const w = limiter.hit(`mcpw:${token.hash}`, config.mcp.writesPerHour, 3_600_000);
            const isKv = tool.name === "kv_put" || tool.name === "kv_delete";
            const day = isKv
              ? limiter.hit("mcpkv:day", config.mcp.kvWritesPerDay, 86_400_000)
              : { allowed: true, retryAfterSec: 0 };
            if (!w.allowed || !day.allowed) {
              const wait = Math.max(w.retryAfterSec, day.retryAfterSec);
              return c.json(
                rpc(id, fail(`RATE_LIMITED: write limit reached; try again in ${wait} s`)),
              );
            }
          }
          const args = (params.arguments ?? {}) as Json;
          if (typeof args !== "object" || Array.isArray(args)) {
            return c.json(rpcErr(id, -32602, "arguments must be an object"));
          }
          try {
            // Fresh meta for writes that change it (replace_site_files).
            const fresh = (await store.get(meta.id)) ?? meta;
            const out = await tool.run(args, { meta: fresh, token });
            if (tool.write && !(out as { isError?: boolean }).isError) {
              await d.audit?.({
                teamId: meta.teamId,
                siteId: meta.id,
                actor: { kind: "mcp", label: token.name },
                action: `mcp:${tool.name}`,
                ...(typeof args.key === "string"
                  ? { detail: args.key }
                  : typeof args.name === "string"
                    ? { detail: args.name }
                    : {}),
              });
            }
            return c.json(rpc(id, out));
          } catch (err) {
            if (err instanceof ToolError) return c.json(rpc(id, fail(err.message)));
            console.error(`[mcp] ${tool.name} on ${meta.id} failed`, err);
            return c.json(rpc(id, fail("internal error")));
          }
        }
        default:
          return c.json(rpcErr(id, -32601, `method not found: ${msg.method}`));
      }
    },
  );
}
