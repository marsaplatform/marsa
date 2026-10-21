import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Scope } from "./agent-keys.js";
import { NoteError, type NoteInput, readNote } from "./agent-notes.js";
import type { SiteBackend } from "./backend/types.js";
import { APP_VERSION, PRODUCT_NAME } from "./brand.js";
import type { Config } from "./config.js";
import { UploadError } from "./errors.js";
import { type FileInput, fromFilesArray, type UploadEntry } from "./ingest.js";
import type { AuditEntry } from "./members.js";
import { isBlocked, mimeFor } from "./mime.js";
import type { RateLimiter } from "./rate-limit.js";
import { type RecipeStore, recipeMarkdown, servedLang, summaryOf } from "./recipes.js";
import type { SiteMeta, SiteStore } from "./store.js";
import { isAgentKey, type TeamAuth } from "./team-auth.js";
import type { Team, TeamStore } from "./teams.js";
import { bearer, hashToken, safeEqual } from "./tokens.js";
import type { UserKeyOps } from "./user-key-routes.js";
import { UserKeyError } from "./user-keys.js";
import { ALLOWED_COMPAT_FLAGS } from "./worker-config.js";
import type { WorkerOps } from "./worker-ops.js";
import { versionMeta } from "./worker-versions.js";
import { listedWorker, varValuesNotice, WorkerError, type WorkerService } from "./workers.js";

/**
 * One MCP server per space: POST /mcp/s/<siteId> speaks MCP over Streamable
 * HTTP (JSON responses, stateless; no SSE stream). Clients authenticate with a
 * per-space token created on the site's dashboard page: `marsa_mcp_…`, scoped
 * read-only ("ro") or read-write ("rw"). Only the SHA-256 of a token is stored,
 * in the site's meta.json, so tokens die with the site.
 */

/** Optional runtime settings shared by deploy_worker and set_worker_runtime (0.15.0). */
const RUNTIME_PROPS = {
  compatibilityDate: {
    type: ["string", "null"],
    description: "YYYY-MM-DD (null = the platform default). Omit to keep the current one.",
  },
  compatibilityFlags: {
    type: "array",
    items: { type: "string", enum: [...ALLOWED_COMPAT_FLAGS] },
    description:
      "Allowlisted Cloudflare flags, e.g. global_fetch_strictly_public (fetch() to a public hostname on the same zone goes out through the internet, not to the origin) or nodejs_compat. [] clears them; omit to keep.",
  },
  bindings: {
    type: "array",
    items: {
      type: "object",
      properties: { name: { type: "string" }, worker: { type: "string" } },
      required: ["name", "worker"],
      additionalProperties: false,
    },
    description:
      'Service bindings to other Workers of THIS team: [{"name":"NEWS","worker":"news"}] gives env.NEWS.fetch(…). [] clears them; omit to keep.',
  },
};
const runtimeArgs = (a: Record<string, unknown>) => ({
  ...("compatibilityDate" in a ? { compatibilityDate: a.compatibilityDate } : {}),
  ...("compatibilityFlags" in a ? { compatibilityFlags: a.compatibilityFlags } : {}),
  ...("bindings" in a ? { bindings: a.bindings } : {}),
});

/** Optional declared metadata and source repo (0.15.1): shown in the tables and MCP servers page. */
const LINK_PROPS = {
  requiredEnv: {
    type: ["array", "null"],
    items: { type: "string" },
    maxItems: 50,
    description:
      "0.15.2: env names the code needs (vars or secrets). Missing ones are flagged on the Worker page.",
  },
  meta: {
    type: ["object", "null"],
    properties: {
      kind: { type: "string", enum: ["mcp", "web", "other"] },
      language: { type: "string", enum: ["typescript", "javascript", "python"] },
      framework: { type: "string", description: "e.g. hono" },
      toolsCount: { type: "integer", minimum: 0, maximum: 500 },
      spaceSlug: { type: "string", description: "id of this team's Space page for the Worker" },
    },
    additionalProperties: false,
    description: "Declared type/stack/tool count. null clears; omit to keep.",
  },
  repo: {
    type: ["object", "null"],
    properties: {
      url: { type: "string", description: "https://github.com/org/repo" },
      branch: { type: "string" },
      commitSha: { type: "string", description: "7-40 hex: the deployed commit" },
    },
    required: ["url"],
    additionalProperties: false,
    description:
      "Source repo; the dashboard checks it read-only on GitHub (public/private, synced/behind). null clears.",
  },
};

export type McpScope = "ro" | "rw";
export interface McpToken {
  id: string;
  name: string;
  scope: McpScope;
  hash: string;
  prefix: string;
  createdAt: string;
  /** Set when an agent key (0.14.0) is used instead of a space token: its scopes. */
  agentScopes?: Scope[];
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
  /** Team Workers (tools appear only when the admin enabled Workers for the space's team). */
  workers?: WorkerService;
  /** Team/agent key resolver (0.14.0): an agent key with the mcp scope works as the token. */
  teamAuth?: TeamAuth;
  /** Agent recipes (0.14.0): list_recipes / get_recipe for every token. */
  recipes?: RecipeStore;
  /** Worker API keys for end users (0.14.0). */
  userKeyOps?: UserKeyOps;
  /** Agent notes (0.15.1): leave_note stores one for the space's team (rate-limited). */
  leaveNote?: (
    team: Team,
    input: NoteInput,
    who: string,
  ) => Promise<{ id: string; status: string } | { retryAfterSec: number }>;
  /** 0.15.2: env view, health, usage, logs. */
  ops?: WorkerOps;
}

/** The agent-key scope a tool needs. */
function toolScope(t: { write?: boolean; needsBackend?: boolean; needsWorkers?: boolean }): Scope {
  if (t.needsWorkers) return t.write ? "workers:deploy" : "workers:read";
  if (t.needsBackend) return t.write ? "kv:write" : "kv:read";
  return t.write ? "spaces:write" : "spaces:read";
}
const allowedFor = (token: McpToken, t: Parameters<typeof toolScope>[0] & { noScope?: boolean }) =>
  !!t.noScope || !token.agentScopes || token.agentScopes.includes(toolScope(t));

type Json = Record<string, unknown>;
interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  annotations?: Json;
  write?: boolean;
  needsBackend?: boolean;
  needsWorkers?: boolean;
  /** Needs no agent-key scope (recipes). */
  noScope?: boolean;
  /** Only listed when this returns true. */
  when?: () => boolean;
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
    {
      name: "list_workers",
      title: "List team Workers",
      description:
        "The Cloudflare Workers this space's team deployed through Marsa Spaces (name, URL, status, env var names, secret names), and the team's quota. No Cloudflare key is needed: Spaces deploys on the team's behalf. Plain var values are deprecated in this list (see deprecations); pass includeValues: true when you really need them.",
      inputSchema: obj({
        includeValues: {
          type: "boolean",
          description:
            "Also return plain var values (they leave the default list after the deprecation period).",
        },
      }),
      annotations: { readOnlyHint: true },
      needsWorkers: true,
      run: async (a, { meta }) => {
        const team = teams.get(meta.teamId);
        const w = d.workers as WorkerService;
        if (!team) throw new ToolError("this space has no team");
        const policy = {
          includeValues: a.includeValues === true,
          now: now(),
          sunset: config.workers.varValuesSunset,
        };
        const notice = varValuesNotice(policy, config.publicUrl);
        return ok({
          slug: team.slug,
          quota: w.quotaOf(team),
          workers: w.list(team.id).map((r) => listedWorker(r, policy)),
          ...(notice ? { deprecations: [notice] } : {}),
        });
      },
    },
    {
      name: "deploy_worker",
      title: "Deploy a Worker",
      description:
        "Create or redeploy a Cloudflare Worker for this space's team. `code` is one ES module (export default { async fetch(request, env) { … } }). It is published at https://<team-slug>-<name>.<platform domain> (script team-<slug>-<name>). `vars` are plain env vars (shown in listings); `secrets` are write-only (null removes one). Omitting `vars` on a redeploy keeps the current ones. Declare `meta` (kind/language/framework/toolsCount) and `repo` so the dashboard shows them. If a deploy fails in a way you cannot fix, call leave_note.",
      inputSchema: obj(
        {
          name: { type: "string", description: "1-30 chars: a-z 0-9 and single hyphens" },
          code: { type: "string", description: "The Worker's JavaScript ES module" },
          vars: { type: "object", additionalProperties: { type: "string" } },
          secrets: { type: "object", additionalProperties: { type: ["string", "null"] } },
          ...RUNTIME_PROPS,
          ...LINK_PROPS,
        },
        ["name", "code"],
      ),
      annotations: { destructiveHint: false },
      write: true,
      needsWorkers: true,
      run: async (a, { meta, token }) => {
        const team = teams.get(meta.teamId);
        if (!team) throw new ToolError("this space has no team");
        try {
          const w = await (d.workers as WorkerService).deploy(
            team,
            {
              name: a.name,
              code: a.code,
              ...("vars" in a ? { vars: a.vars } : {}),
              ...("secrets" in a ? { secrets: a.secrets } : {}),
              ...runtimeArgs(a),
              ...("meta" in a ? { meta: a.meta } : {}),
              ...("repo" in a ? { repo: a.repo } : {}),
              ...("requiredEnv" in a ? { requiredEnv: a.requiredEnv } : {}),
            },
            { kind: "mcp", label: token.name },
          );
          return ok({ worker: w });
        } catch (err) {
          if (err instanceof WorkerError) return fail(`${err.code}: ${err.message}`);
          throw err;
        }
      },
    },
    {
      name: "delete_worker",
      title: "Delete a Worker",
      description: "Delete one of the team's Workers (its route, DNS record and script).",
      inputSchema: obj({ name: { type: "string" } }, ["name"]),
      annotations: { destructiveHint: true },
      write: true,
      needsWorkers: true,
      run: async (a, { meta, token }) => {
        const team = teams.get(meta.teamId);
        const w = d.workers as WorkerService;
        const rec = team ? w.find(team.id, str(a, "name")) : null;
        if (!rec) return fail("no such Worker");
        try {
          await w.remove(rec, { kind: "mcp", label: token.name });
          return ok({ deleted: rec.name });
        } catch (err) {
          if (err instanceof WorkerError) return fail(`${err.code}: ${err.message}`);
          throw err;
        }
      },
    },
    {
      name: "list_worker_versions",
      title: "List a Worker's stored versions",
      description:
        "The last stored versions of one of the team's Workers (newest first): number, when, who, action (deploy, redeploy, rollback), size, SHA-256, note, var names and secret names. Code is not included; use get_worker_version.",
      inputSchema: obj({ name: { type: "string" } }, ["name"]),
      annotations: { readOnlyHint: true },
      needsWorkers: true,
      run: async (a, { meta }) => {
        const team = teams.get(meta.teamId);
        const w = d.workers as WorkerService;
        const rec = team ? w.find(team.id, str(a, "name")) : null;
        if (!rec) return fail("no such Worker");
        const versions = (await w.listVersions(rec)).map(versionMeta);
        return ok({
          worker: rec.name,
          current: rec.version ?? null,
          versions,
          ...(versions.length ? {} : { note: "no stored version — the next deploy will be saved" }),
        });
      },
    },
    {
      name: "get_worker_version",
      title: "Read a stored Worker version",
      description: "One stored version of a Worker, with its code and vars (never secret values).",
      inputSchema: obj({ name: { type: "string" }, version: { type: "integer" } }, [
        "name",
        "version",
      ]),
      annotations: { readOnlyHint: true },
      needsWorkers: true,
      run: async (a, { meta }) => {
        const team = teams.get(meta.teamId);
        const w = d.workers as WorkerService;
        const rec = team ? w.find(team.id, str(a, "name")) : null;
        if (!rec) return fail("no such Worker");
        const v = await w.getVersion(rec, Number(a.version));
        if (!v) return fail("no such stored version");
        return ok({ version: { ...versionMeta(v), vars: v.vars, code: v.code } });
      },
    },
    {
      name: "set_worker_runtime",
      title: "Set a Worker's compatibility flags and bindings",
      description:
        "Change a Worker's compatibility date, compatibility flags (allowlisted) and service bindings to other Workers of the same team, without sending its code: the newest stored code is deployed again (a new version). The bound Workers are not changed.",
      inputSchema: obj({ name: { type: "string" }, ...RUNTIME_PROPS }, ["name"]),
      annotations: { destructiveHint: false },
      write: true,
      needsWorkers: true,
      run: async (a, { meta, token }) => {
        const team = teams.get(meta.teamId);
        const w = d.workers as WorkerService;
        const rec = team ? w.find(team.id, str(a, "name")) : null;
        if (!team || !rec) return fail("no such Worker");
        try {
          return ok({
            worker: await w.editRuntime(team, rec, runtimeArgs(a), {
              kind: "mcp",
              label: token.name,
            }),
          });
        } catch (err) {
          if (err instanceof WorkerError) return fail(`${err.code}: ${err.message}`);
          throw err;
        }
      },
    },
    {
      name: "set_worker_links",
      title: "Set a Worker's declared type, repo and Space page",
      description:
        "Without redeploying: declare the Worker's type/stack/tool count (meta), its source repo (url, branch, commitSha) and the team Space page that documents it (spaceId). Each field: omit to keep, null to clear.",
      inputSchema: obj(
        { name: { type: "string" }, ...LINK_PROPS, spaceId: { type: ["string", "null"] } },
        ["name"],
      ),
      annotations: { destructiveHint: false },
      write: true,
      needsWorkers: true,
      run: async (a, { meta, token }) => {
        const team = teams.get(meta.teamId);
        const w = d.workers as WorkerService;
        const rec = team ? w.find(team.id, str(a, "name")) : null;
        if (!team || !rec) return fail("no such Worker");
        if (typeof a.spaceId === "string") {
          const m = await d.store.get(a.spaceId).catch(() => null);
          if (!m || m.teamId !== team.id) return fail("spaceId: no such space in this team");
        }
        try {
          return ok({
            worker: await w.setLinks(
              rec,
              {
                ...("meta" in a ? { meta: a.meta } : {}),
                ...("requiredEnv" in a ? { requiredEnv: a.requiredEnv } : {}),
                ...("repo" in a ? { repo: a.repo } : {}),
                ...("spaceId" in a ? { spaceId: (a.spaceId as string | null) ?? null } : {}),
              },
              { kind: "mcp", label: token.name },
            ),
          });
        } catch (err) {
          if (err instanceof WorkerError) return fail(`${err.code}: ${err.message}`);
          throw err;
        }
      },
    },
    {
      name: "redeploy_worker",
      title: "Redeploy a Worker",
      description:
        "One-click redeploy: deploy the newest stored version of a Worker again (same code and vars; secrets are kept).",
      inputSchema: obj({ name: { type: "string" }, note: { type: "string" } }, ["name"]),
      annotations: { destructiveHint: false },
      write: true,
      needsWorkers: true,
      run: async (a, { meta, token }) => {
        const team = teams.get(meta.teamId);
        const w = d.workers as WorkerService;
        const rec = team ? w.find(team.id, str(a, "name")) : null;
        if (!team || !rec) return fail("no such Worker");
        try {
          return ok({
            worker: await w.redeploy(team, rec, { kind: "mcp", label: token.name }, a.note),
          });
        } catch (err) {
          if (err instanceof WorkerError) return fail(`${err.code}: ${err.message}`);
          throw err;
        }
      },
    },
    {
      name: "worker_env",
      title: "A Worker's vars & secrets (names only)",
      description:
        "Names, types and status (set/empty/missing/unset) of a Worker's plain vars, secrets and bindings, read live from Cloudflare. `missing` lists declared requiredEnv names that are not set (fix these); `unset` lists names the code reads without a default (env.X without ?? or ||) that are not set (info only). Never returns any value.",
      inputSchema: obj({ name: { type: "string" } }, ["name"]),
      annotations: { readOnlyHint: true },
      needsWorkers: true,
      run: async (a, { meta }) => {
        const team = teams.get(meta.teamId);
        const w = d.workers as WorkerService;
        const rec = team ? w.find(team.id, str(a, "name")) : null;
        if (!rec || !d.ops) return fail("no such Worker");
        return ok({ worker: rec.name, env: await d.ops.envView(rec) });
      },
    },
    {
      name: "set_worker_secret",
      title: "Set or rotate a Worker secret",
      description:
        "Set (or rotate) one secret on a Worker without redeploying code. Write-only: the value goes to Cloudflare and is never shown again. Pass value null to delete the secret.",
      inputSchema: obj(
        {
          name: { type: "string" },
          secret: { type: "string" },
          value: { type: ["string", "null"] },
        },
        ["name", "secret", "value"],
      ),
      annotations: { destructiveHint: true },
      write: true,
      needsWorkers: true,
      run: async (a, { meta, token }) => {
        const team = teams.get(meta.teamId);
        const w = d.workers as WorkerService;
        const rec = team ? w.find(team.id, str(a, "name")) : null;
        if (!rec) return fail("no such Worker");
        const lim = d.limiter.hit(`secrets:${rec.teamId}`, 60, 3_600_000);
        if (!lim.allowed) return fail("RATE_LIMITED: at most 60 secret changes per hour");
        const actor = { kind: "mcp" as const, label: token.name };
        try {
          const r =
            a.value === null
              ? { ...(await w.deleteSecretNamed(rec, a.secret, actor)), deleted: true }
              : await w.setSecret(rec, a.secret, a.value, actor);
          d.ops?.forgetEnv(rec.id);
          return ok({ ok: true, ...r });
        } catch (err) {
          if (err instanceof WorkerError) return fail(`${err.code}: ${err.message}`);
          throw err;
        }
      },
    },
    {
      name: "worker_status",
      title: "A Worker's health, usage and recent errors",
      description:
        "Uptime/latency from Spaces' health checks, requests/errors/CPU from Cloudflare analytics (range 24h, 7d or 30d) and recent errors (24h, secrets redacted). Read-only.",
      inputSchema: obj(
        { name: { type: "string" }, range: { type: "string", enum: ["24h", "7d", "30d"] } },
        ["name"],
      ),
      annotations: { readOnlyHint: true },
      needsWorkers: true,
      run: async (a, { meta }) => {
        const team = teams.get(meta.teamId);
        const w = d.workers as WorkerService;
        const rec = team ? w.find(team.id, str(a, "name")) : null;
        if (!rec || !d.ops) return fail("no such Worker");
        const range = (["24h", "7d", "30d"] as const).find((r) => r === a.range) ?? "24h";
        const h = d.ops.health.view(rec.id);
        const logs = await d.ops.analytics.logs(rec.script, !!rec.logs);
        return ok({
          worker: rec.name,
          health: { ...h, series: undefined, checksIn24h: h.series.length },
          usage: await d.ops.analytics.usage(rec.script, range),
          errors: { ...logs, entries: logs.entries.slice(0, 30) },
        });
      },
    },
    {
      name: "rollback_worker",
      title: "Roll a Worker back",
      description:
        "Deploy an older stored version of a Worker again (its code and vars). It is recorded as a new version. Secrets stay as they are now.",
      inputSchema: obj(
        { name: { type: "string" }, version: { type: "integer" }, note: { type: "string" } },
        ["name", "version"],
      ),
      annotations: { destructiveHint: true },
      write: true,
      needsWorkers: true,
      run: async (a, { meta, token }) => {
        const team = teams.get(meta.teamId);
        const w = d.workers as WorkerService;
        const rec = team ? w.find(team.id, str(a, "name")) : null;
        if (!team || !rec) return fail("no such Worker");
        try {
          return ok(
            await w.rollback(
              team,
              rec,
              Number(a.version),
              { kind: "mcp", label: token.name },
              a.note,
            ),
          );
        } catch (err) {
          if (err instanceof WorkerError) return fail(`${err.code}: ${err.message}`);
          throw err;
        }
      },
    },
    {
      name: "leave_note",
      title: "Leave a note for the platform admin",
      description:
        "Hit a problem (a failing deploy or build, a runtime error, an unclear or wrong recipe) or have a suggestion? Leave a short note: the Marsa admin sees it in the dashboard (blockers ring the bell) and can reply. Never put keys, tokens or passwords in it (they are removed). severity: info | bug | blocker | suggestion; stage: deploy | build | runtime | recipe | other.",
      inputSchema: obj(
        {
          severity: { type: "string", enum: ["info", "bug", "blocker", "suggestion"] },
          message: {
            type: "string",
            description: "What happened, what you expected, the error text (max 2000 chars)",
          },
          stage: { type: "string", enum: ["deploy", "build", "runtime", "recipe", "other"] },
          category: {
            type: "string",
            description: "Short label, e.g. bindings, upload, mcp-recipe",
          },
          target: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["space", "worker", "mcp", "recipe"] },
              id: { type: "string", description: "space id, Worker name, or recipe slug" },
            },
            required: ["type", "id"],
            additionalProperties: false,
          },
          version: { type: "string", description: "Deploy/version id, e.g. 4 or a commit" },
          agent: { type: "string", description: "Your agent's name" },
        },
        ["severity", "message"],
      ),
      annotations: { destructiveHint: false, readOnlyHint: false },
      noScope: true,
      when: () => !!d.leaveNote,
      run: async (a, { meta, token }) => {
        const team = meta.teamId ? teams.get(meta.teamId) : null;
        if (!team) return fail("this space has no team: notes go to a team");
        let input: NoteInput;
        try {
          input = readNote(
            { ...a, ...(a.target ? {} : { target: { type: "space", id: meta.id } }) },
            `MCP token ${token.name}`,
          );
        } catch (e) {
          if (e instanceof NoteError) return fail(e.message);
          throw e;
        }
        const r = await (d.leaveNote as NonNullable<McpDeps["leaveNote"]>)(
          team,
          input,
          `mcp:${token.id}`,
        );
        if ("retryAfterSec" in r) return fail(`RATE_LIMITED: try again in ${r.retryAfterSec}s`);
        return ok({ note: r, message: "Thanks: the admin will see it in the dashboard." });
      },
    },
    {
      name: "list_recipes",
      title: "List agent recipes",
      description:
        "Step-by-step playbooks (built-in, platform and this team's own): slug, title, summary, version, tags, languages. Read one with get_recipe. Start with mcp-server-on-worker, agent-security-rules, site-kv-and-files, bilingual-project-page, protect-mcp-with-keys.",
      inputSchema: obj({ lang: { type: "string", enum: ["en", "ar"], description: "Default en" } }),
      annotations: { readOnlyHint: true },
      noScope: true,
      when: () => !!d.recipes,
      run: async (a, { meta }) => {
        const rs = d.recipes as RecipeStore;
        await rs.ready();
        const lang = a.lang === "ar" ? "ar" : "en";
        return ok({
          recipes: rs
            .visible(meta.teamId && teams.get(meta.teamId) ? meta.teamId : null)
            .map((r) => summaryOf(r, lang)),
        });
      },
    },
    {
      name: "get_recipe",
      title: "Read an agent recipe",
      description:
        "One recipe as markdown: goal, when to use, steps, starter template, checklist before deploy, common pitfalls.",
      inputSchema: obj(
        {
          slug: { type: "string" },
          lang: {
            type: "string",
            enum: ["en", "ar"],
            description: "Default en (falls back to the other language)",
          },
        },
        ["slug"],
      ),
      annotations: { readOnlyHint: true },
      noScope: true,
      when: () => !!d.recipes,
      run: async (a, { meta }) => {
        const rs = d.recipes as RecipeStore;
        await rs.ready();
        const r = rs.get(
          str(a, "slug"),
          meta.teamId && teams.get(meta.teamId) ? meta.teamId : null,
        );
        if (!r) return fail("no such recipe; call list_recipes");
        const lang = a.lang === "ar" ? "ar" : "en";
        const markdown = recipeMarkdown(r, lang);
        return {
          content: [{ type: "text", text: markdown }],
          structuredContent: { ...summaryOf(r, lang), lang: servedLang(r, lang), markdown },
        };
      },
    },
    {
      name: "list_user_keys",
      title: "List a Worker's API keys",
      description:
        "End-user API keys of one of the team's Workers: settings (required on/off, default per-minute/per-day limits) and each key's label, prefix, state, limits, allowed tools, usage (today, 7 days, 429s) and last use. Secrets are never returned.",
      inputSchema: obj({ worker: { type: "string", description: "Worker name" } }, ["worker"]),
      annotations: { readOnlyHint: true },
      needsWorkers: true,
      when: () => !!d.userKeyOps,
      run: async (a, { meta }) => {
        const team = teams.get(meta.teamId);
        const rec = team ? (d.workers as WorkerService).find(team.id, str(a, "worker")) : null;
        if (!rec) return fail("no such Worker");
        const v = await (d.userKeyOps as UserKeyOps).view(rec);
        return ok(v);
      },
    },
    {
      name: "create_user_key",
      title: "Create a Worker API key",
      description:
        "Create an end-user API key for one of the team's Workers. Returns the key ONCE (msk_…): hand it to the user privately, never print it in logs. Optional: email, expiresInDays (omit = never), perMinute/perDay (omit = Worker default), tools (allowed tool names). Turn enforcement on with required:true on the Worker (dashboard or API).",
      inputSchema: obj(
        {
          worker: { type: "string" },
          label: { type: "string" },
          email: { type: "string" },
          expiresInDays: { type: "integer" },
          perMinute: { type: "integer" },
          perDay: { type: "integer" },
          tools: { type: "array", items: { type: "string" } },
        },
        ["worker", "label"],
      ),
      write: true,
      needsWorkers: true,
      when: () => !!d.userKeyOps,
      run: async (a, { meta, token }) => {
        const team = teams.get(meta.teamId);
        const rec = team ? (d.workers as WorkerService).find(team.id, str(a, "worker")) : null;
        if (!team || !rec) return fail("no such Worker");
        try {
          const { worker: _w, ...input } = a;
          const r = await (d.userKeyOps as UserKeyOps).create(team, rec, input, {
            kind: "mcp",
            label: token.name,
          });
          return ok({ ...r, note: "Shown once. Send it as Authorization: Bearer <key>." });
        } catch (err) {
          if (err instanceof UserKeyError) return fail(`${err.code}: ${err.message}`);
          throw err;
        }
      },
    },
    {
      name: "revoke_user_key",
      title: "Revoke a Worker API key",
      description:
        "Revoke an end-user API key by its id (uk_…). Calls with it stop at the Worker's next check.",
      inputSchema: obj({ worker: { type: "string" }, id: { type: "string" } }, ["worker", "id"]),
      annotations: { destructiveHint: true },
      write: true,
      needsWorkers: true,
      when: () => !!d.userKeyOps,
      run: async (a, { meta, token }) => {
        const team = teams.get(meta.teamId);
        const rec = team ? (d.workers as WorkerService).find(team.id, str(a, "worker")) : null;
        if (!team || !rec) return fail("no such Worker");
        const k = await (d.userKeyOps as UserKeyOps).revoke(team, rec, str(a, "id"), {
          kind: "mcp",
          label: token.name,
        });
        return k ? ok({ key: k }) : fail("no such key");
      },
    },
  ];

  function workersOn(meta: SiteMeta) {
    return !!d.workers?.configured && d.workers.enabledFor(teams.get(meta.teamId));
  }

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
    tools.filter(
      (t) =>
        (!t.write || token.scope === "rw") &&
        allowedFor(token, t) &&
        (!t.when || t.when()) &&
        (!t.needsBackend || backendOn(meta)) &&
        (!t.needsWorkers || workersOn(meta)),
    );

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
      let token = meta ? findMcpToken(meta, secret) : null;
      if (meta && !token && d.teamAuth && isAgentKey(secret)) {
        const cred = await d.teamAuth(c, secret);
        if (cred && cred !== "invalid" && cred.kind === "agent" && cred.team.id === meta.teamId) {
          if (!cred.key.scopes.includes("mcp")) {
            return httpErr(c, 403, "this agent key does not have the mcp scope");
          }
          token = {
            id: cred.key.id,
            name: cred.actor.label,
            scope: cred.key.scopes.some((x) => x.endsWith(":write") || x === "workers:deploy")
              ? "rw"
              : "ro",
            hash: cred.key.hash,
            prefix: cred.key.prefix,
            createdAt: cred.key.createdAt,
            agentScopes: cred.key.scopes,
          };
        }
      }
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
              instructions: `This server is one Marsa space (${d.siteUrl(meta.id)}). Token scope: ${token.scope === "rw" ? "read-write" : "read-only"}. Use get_site_info first. Building an MCP server? Read get_recipe mcp-server-on-worker (starter: ${d.config.publicUrl}/api/recipes/mcp-server-on-worker/starter.zip). Hit a problem or an unclear recipe? Call leave_note.`,
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
          const tool = tools.find((t) => t.name === name && (!t.when || t.when()));
          if (!tool) return c.json(rpcErr(id, -32602, `unknown tool: ${name}`));
          if (tool.write && token.scope !== "rw") {
            return c.json(rpc(id, fail("this token is read-only")));
          }
          if (!allowedFor(token, tool)) {
            return c.json(
              rpc(
                id,
                fail(`INSUFFICIENT_SCOPE: this agent key needs the ${toolScope(tool)} scope`),
              ),
            );
          }
          if (tool.needsBackend && !backendOn(meta)) {
            return c.json(
              rpc(id, fail("BACKEND_NOT_ALLOWED: this space has no data/files backend")),
            );
          }
          if (tool.needsWorkers && !workersOn(meta)) {
            return c.json(
              rpc(id, fail("WORKERS_NOT_ALLOWED: Workers are not enabled for this team")),
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
            if (tool.write && !tool.needsWorkers && !(out as { isError?: boolean }).isError) {
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
