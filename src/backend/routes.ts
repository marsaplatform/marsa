import { Buffer } from "node:buffer";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Config } from "../config.js";
import { isBlocked, mimeFor } from "../mime.js";
import { SITE_CSP } from "../security.js";
import type { SiteMeta, SiteStore } from "../store.js";
import { can, credentialOf, hasEditBearer, type TeamAuth } from "../team-auth.js";
import type { TeamStore } from "../teams.js";
import { bearer, hashToken, safeEqual } from "../tokens.js";
import type { SiteBackend } from "./types.js";

const KEY_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const FILE_ID_RE = /^[A-Za-z0-9._-]{1,36}$/;

export interface BackendRouteDeps {
  config: Config;
  store: SiteStore;
  backend: SiteBackend | null;
  teams: TeamStore;
  now: () => number;
  /** Counts a write against the per-IP upload limit; returns a 429 response or null. */
  uploadRate: (c: Context) => Promise<Response | null>;
  /** Team key / agent key resolver (0.14.0): kv:read / kv:write on the team's own sites. */
  teamAuth?: TeamAuth;
}

const err = (c: Context, status: number, code: string, message: string) =>
  c.json({ error: { code, message } }, status as 400);

/**
 * Optional per-site backend: KV values and files, proxied server-side to the
 * configured store (Cloudflare Workers KV + R2). Only sites of a team with backend access may
 * use it (403 BACKEND_NOT_ALLOWED otherwise, unless BACKEND_GUEST_ACCESS=true). Reads are public when BACKEND_PUBLIC_READ=true
 * (the default; the data is as public as the site), writes always need the
 * site's edit token. With no backend configured, allowed sites get 503
 * BACKEND_NOT_CONFIGURED. CORS is open because uploaded pages run in a sandbox
 * (opaque origin) and auth is a bearer token, never a cookie.
 */
export function mountBackendRoutes(app: Hono, deps: BackendRouteDeps): void {
  const { config, store, backend, teams, now, uploadRate } = deps;
  const limits = config.backend;

  for (const p of [
    "/api/sites/:id/kv",
    "/api/sites/:id/kv/*",
    "/api/sites/:id/files",
    "/api/sites/:id/files/*",
  ]) {
    app.use(p, async (c, next) => {
      c.header("Access-Control-Allow-Origin", "*");
      c.header("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS");
      c.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
      c.header("Access-Control-Max-Age", "600");
      if (c.req.method === "OPTIONS") return c.body(null, 204);
      // Access is decided per site, before anything else: only sites of a team
      // the admin marked "backend: on" (or every site, with BACKEND_GUEST_ACCESS).
      // Checked on every request, so toggling a team off takes effect at once.
      const meta = await store.get(c.req.param("id") ?? "");
      if (!meta) return err(c, 404, "NOT_FOUND", "site not found or token invalid");
      if (Date.parse(meta.expiresAt) <= now()) {
        return err(c, 410, "EXPIRED", "this link has expired");
      }
      if (!limits.guestAccess && !teams.get(meta.teamId)?.backend) {
        return err(
          c,
          403,
          "BACKEND_NOT_ALLOWED",
          "This site may not use the data/files backend. Only sites uploaded with the key of a team that the admin gave backend access can use it.",
        );
      }
      if (!backend) {
        return err(
          c,
          503,
          "BACKEND_NOT_CONFIGURED",
          "This Marsa instance has no data/files backend. Static publishing works; set the CLOUDFLARE_* and R2_* variables to enable KV and files.",
        );
      }
      await next();
    });
  }
  if (!backend) return;

  /** The live site, after the read/write policy check. */
  async function site(c: Context, write: boolean): Promise<SiteMeta | Response> {
    const meta = await store.get(c.req.param("id") ?? "");
    // The team key or an agent key with kv:read / kv:write works on the team's own sites.
    if (deps.teamAuth && credentialOf(c) && !hasEditBearer(c)) {
      const cred = await deps.teamAuth(c);
      if (!meta || !cred || cred === "invalid" || cred.team.id !== meta.teamId) {
        return err(c, 404, "NOT_FOUND", "site not found or token invalid");
      }
      const scope = write ? "kv:write" : "kv:read";
      if (!can(cred, scope)) {
        return err(c, 403, "INSUFFICIENT_SCOPE", `this agent key does not have the ${scope} scope`);
      }
      if (Date.parse(meta.expiresAt) <= now())
        return err(c, 410, "EXPIRED", "this link has expired");
      return meta;
    }
    const token = bearer(c.req.header("authorization"));
    const tokenOk = !!meta && !!token && safeEqual(hashToken(token), meta.tokenHash);
    if (!meta || ((write || !limits.publicRead) && !tokenOk)) {
      return err(c, 404, "NOT_FOUND", "site not found or token invalid");
    }
    if (Date.parse(meta.expiresAt) <= now()) return err(c, 410, "EXPIRED", "this link has expired");
    return meta;
  }

  const key = (c: Context): string | null => {
    const k = c.req.param("key") ?? "";
    return KEY_RE.test(k) ? k : null;
  };

  // ---- KV --------------------------------------------------------------------
  app.get("/api/sites/:id/kv", async (c) => {
    const m = await site(c, false);
    if (m instanceof Response) return m;
    return c.json({ keys: await backend.kvList(m.id, limits.maxKeys) });
  });

  app.get("/api/sites/:id/kv/:key", async (c) => {
    const m = await site(c, false);
    if (m instanceof Response) return m;
    const k = key(c);
    if (!k) return err(c, 400, "INVALID_KEY", "keys are 1-128 chars of A-Z a-z 0-9 . _ : -");
    const json = await backend.kvGet(m.id, k);
    if (json === undefined) return err(c, 404, "KEY_NOT_FOUND", "no such key");
    c.header("Content-Type", "application/json; charset=utf-8");
    return c.body(`{"key":${JSON.stringify(k)},"value":${json}}`);
  });

  app.put(
    "/api/sites/:id/kv/:key",
    bodyLimit({
      maxSize: limits.maxValueBytes + 1024,
      onError: (c) => err(c, 413, "VALUE_TOO_LARGE", "value too large"),
    }),
    async (c) => {
      const m = await site(c, true);
      if (m instanceof Response) return m;
      const k = key(c);
      if (!k) return err(c, 400, "INVALID_KEY", "keys are 1-128 chars of A-Z a-z 0-9 . _ : -");
      let body: { value?: unknown };
      try {
        body = await c.req.json();
      } catch {
        return err(c, 400, "INVALID_REQUEST", 'send JSON: {"value": <any JSON>}');
      }
      if (!body || typeof body !== "object" || !("value" in body)) {
        return err(c, 400, "INVALID_REQUEST", 'send JSON: {"value": <any JSON>}');
      }
      const json = JSON.stringify(body.value);
      if (Buffer.byteLength(json) > limits.maxValueBytes) {
        return err(
          c,
          413,
          "VALUE_TOO_LARGE",
          `values are limited to ${limits.maxValueBytes} bytes`,
        );
      }
      if (
        (await backend.kvGet(m.id, k)) === undefined &&
        (await backend.kvCount(m.id)) >= limits.maxKeys
      ) {
        return err(c, 413, "TOO_MANY_KEYS", `a site can hold ${limits.maxKeys} keys`);
      }
      await backend.kvSet(m.id, k, json);
      return c.json({ key: k, value: body.value });
    },
  );

  app.delete("/api/sites/:id/kv/:key", async (c) => {
    const m = await site(c, true);
    if (m instanceof Response) return m;
    const k = key(c);
    if (!k) return err(c, 400, "INVALID_KEY", "keys are 1-128 chars of A-Z a-z 0-9 . _ : -");
    return (await backend.kvDelete(m.id, k))
      ? c.body(null, 204)
      : err(c, 404, "KEY_NOT_FOUND", "no such key");
  });

  // ---- files -------------------------------------------------------------------
  app.get("/api/sites/:id/files", async (c) => {
    const m = await site(c, false);
    if (m instanceof Response) return m;
    const files = await backend.filesList(m.id, limits.maxFiles);
    const base = `${config.publicUrl}/api/sites/${m.id}/files`;
    return c.json({ files: files.map((f) => ({ ...f, url: `${base}/${f.id}` })) });
  });

  app.post(
    "/api/sites/:id/files",
    bodyLimit({
      maxSize: config.maxFileBytes + 64 * 1024,
      onError: (c) => err(c, 413, "FILE_TOO_LARGE", "file too large"),
    }),
    async (c) => {
      const m = await site(c, true);
      if (m instanceof Response) return m;
      const limited = await uploadRate(c);
      if (limited) return limited;
      let name: string;
      let bytes: Uint8Array;
      const type = (c.req.header("content-type") ?? "").toLowerCase();
      if (type.startsWith("multipart/form-data")) {
        const form = await c.req.formData();
        const f = form.get("file");
        if (!f || typeof f === "string")
          return err(c, 400, "INVALID_REQUEST", 'send one multipart field named "file"');
        name = String(form.get("name") || f.name);
        bytes = new Uint8Array(await f.arrayBuffer());
      } else {
        name = c.req.query("name") ?? "";
        bytes = new Uint8Array(await c.req.arrayBuffer());
      }
      name = name.replace(/\\/g, "/").split("/").pop() ?? "";
      if (!/^[^\0]{1,200}$/.test(name) || name.startsWith(".")) {
        return err(c, 400, "INVALID_PATH", "a file name (1-200 chars, not a dotfile) is required");
      }
      if (isBlocked(name))
        return err(c, 415, "BLOCKED_FILE_TYPE", `file type not allowed: ${name}`);
      if (bytes.byteLength === 0) return err(c, 400, "EMPTY_UPLOAD", "the file is empty");
      if (bytes.byteLength > config.maxFileBytes)
        return err(c, 413, "FILE_TOO_LARGE", "file too large");
      if ((await backend.filesList(m.id, limits.maxFiles)).length >= limits.maxFiles) {
        return err(c, 413, "TOO_MANY_FILES", `a site can hold ${limits.maxFiles} files`);
      }
      const file = await backend.fileUpload(m.id, name, bytes, mimeFor(name));
      return c.json(
        { file: { ...file, url: `${config.publicUrl}/api/sites/${m.id}/files/${file.id}` } },
        201,
      );
    },
  );

  app.get("/api/sites/:id/files/:fileId", async (c) => {
    const m = await site(c, false);
    if (m instanceof Response) return m;
    const fileId = c.req.param("fileId");
    if (!FILE_ID_RE.test(fileId)) return err(c, 404, "FILE_NOT_FOUND", "no such file");
    const got = await backend.fileGet(m.id, fileId);
    if (!got) return err(c, 404, "FILE_NOT_FOUND", "no such file");
    const h = new Headers({
      "Content-Type": mimeFor(got.file.name),
      "Content-Security-Policy": SITE_CSP,
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(got.file.name)}`,
    });
    return new Response(Buffer.from(got.bytes), { status: 200, headers: h });
  });

  app.delete("/api/sites/:id/files/:fileId", async (c) => {
    const m = await site(c, true);
    if (m instanceof Response) return m;
    const fileId = c.req.param("fileId");
    if (!FILE_ID_RE.test(fileId)) return err(c, 404, "FILE_NOT_FOUND", "no such file");
    return (await backend.fileDelete(m.id, fileId))
      ? c.body(null, 204)
      : err(c, 404, "FILE_NOT_FOUND", "no such file");
  });
}
