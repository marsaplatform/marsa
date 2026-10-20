import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { APP_NAME } from "./brand.js";
import { clientIp } from "./client-ip.js";
import type { Config } from "./config.js";
import { UploadError } from "./errors.js";
import {
  type FileInput,
  fromFilesArray,
  fromZip,
  type Limits,
  prepareSite,
  type UploadEntry,
} from "./ingest.js";
import { RateLimiter } from "./rate-limit.js";
import { APP_CSP, baseHeaders, SITE_CSP } from "./security.js";
import { publicMeta, type SiteMeta, type SiteStore } from "./store.js";
import { bearer, hashToken, newEditToken, newSiteId, safeEqual } from "./tokens.js";
import { APP_CSS, APP_JS, goneHtml, indexHtml, notFoundHtml } from "./ui.js";

const HOUR = 60 * 60 * 1000;

export interface AppDeps {
  config: Config;
  store: SiteStore;
  limiter?: RateLimiter;
  now?: () => number;
}

function apiError(c: Context, status: number, code: string, message: string) {
  return c.json({ error: { code, message } }, status as 400);
}

export function createApp({ config, store, limiter = new RateLimiter(), now = Date.now }: AppDeps) {
  const app = new Hono();
  const limits: Limits = {
    maxFileBytes: config.maxFileBytes,
    maxSiteBytes: config.maxSiteBytes,
    maxFiles: config.maxFiles,
  };

  const clampTtl = (raw: unknown): number => {
    const n = Number(raw);
    const hours = Number.isFinite(n) && n > 0 ? n : config.defaultTtlHours;
    return Math.min(Math.max(hours, config.minTtlHours), config.maxTtlHours);
  };

  app.onError((err, c) => {
    if (err instanceof UploadError) {
      return c.json(
        { error: { code: err.code, message: err.message, path: err.path } },
        err.status,
      );
    }
    console.error(err);
    return apiError(c, 500, "INTERNAL", "unexpected server error");
  });

  // ---- baseline headers + API rate limit ----------------------------------
  app.use("*", async (c, next) => {
    await next();
    baseHeaders(c.res.headers);
  });
  app.use("/api/*", async (c, next) => {
    const r = limiter.hit(
      `api:${clientIp(c, config.trustProxy)}`,
      config.apiRequestsPerMinute,
      60_000,
    );
    if (!r.allowed) {
      c.header("Retry-After", String(r.retryAfterSec));
      return apiError(c, 429, "RATE_LIMITED", "too many requests, slow down");
    }
    await next();
  });

  const uploadLimit = bodyLimit({
    // JSON/base64 bodies are ~4/3 the raw size; allow some multipart overhead.
    maxSize: Math.ceil(config.maxSiteBytes * 1.4) + 1024 * 1024,
    onError: (c) => apiError(c, 413, "SITE_TOO_LARGE", "request body too large"),
  });

  const uploadRate = async (c: Context) => {
    const r = limiter.hit(`upload:${clientIp(c, config.trustProxy)}`, config.uploadsPerHour, HOUR);
    if (!r.allowed) {
      c.header("Retry-After", String(r.retryAfterSec));
      return apiError(c, 429, "RATE_LIMITED", "upload limit reached for this hour");
    }
    return null;
  };

  /** Parse any supported upload body into raw entries + an optional TTL. */
  async function readUpload(c: Context): Promise<{ entries: UploadEntry[]; ttl?: unknown }> {
    const type = (c.req.header("content-type") ?? "").toLowerCase();
    const queryTtl = c.req.query("ttlHours") ?? c.req.query("ttl");
    if (type.startsWith("application/json")) {
      let body: { files?: FileInput[]; ttlHours?: unknown };
      try {
        body = await c.req.json();
      } catch {
        throw new UploadError("INVALID_REQUEST", "body is not valid JSON");
      }
      if (!Array.isArray(body?.files)) {
        throw new UploadError(
          "INVALID_REQUEST",
          "expected { files: [{ path, content, encoding? }] }",
        );
      }
      return { entries: fromFilesArray(body.files), ttl: body.ttlHours ?? queryTtl };
    }
    if (type.startsWith("application/zip") || type.startsWith("application/octet-stream")) {
      const buf = Buffer.from(await c.req.arrayBuffer());
      return { entries: await fromZip(buf, limits), ttl: queryTtl };
    }
    if (type.startsWith("multipart/form-data")) {
      const form = await c.req.formData();
      const files = form.getAll("files").filter((f): f is File => typeof f !== "string");
      const paths = form.getAll("paths").map(String);
      const entries: UploadEntry[] = [];
      for (const [i, f] of files.entries()) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const name = paths[i] || f.name;
        if (files.length === 1 && /\.zip$/i.test(name)) {
          entries.push(...(await fromZip(Buffer.from(bytes), limits)));
        } else {
          entries.push({ path: name, bytes });
        }
      }
      return { entries, ttl: form.get("ttlHours") ?? queryTtl };
    }
    throw new UploadError(
      "INVALID_REQUEST",
      "send multipart/form-data (files), application/zip, or application/json",
    );
  }

  async function authorizeSite(c: Context): Promise<SiteMeta | Response> {
    const meta = await store.get(c.req.param("id") ?? "");
    const token = bearer(c.req.header("authorization"));
    if (!meta || !token || !safeEqual(hashToken(token), meta.tokenHash)) {
      // Same answer for "no such site" and "wrong token": no existence oracle.
      return apiError(c, 404, "NOT_FOUND", "site not found or token invalid");
    }
    if (Date.parse(meta.expiresAt) <= now()) {
      return apiError(c, 410, "EXPIRED", "this link has expired");
    }
    return meta;
  }

  const siteUrl = (id: string) => `${config.publicUrl}/s/${id}/`;
  const view = (m: SiteMeta) => ({ ...publicMeta(m), url: siteUrl(m.id) });

  // ---- public API ---------------------------------------------------------
  app.get("/healthz", (c) => c.json({ ok: true }));

  app.get("/api/config", (c) =>
    c.json({
      name: APP_NAME,
      ttlHours: {
        default: config.defaultTtlHours,
        min: config.minTtlHours,
        max: config.maxTtlHours,
      },
      maxFileBytes: config.maxFileBytes,
      maxSiteBytes: config.maxSiteBytes,
      maxFiles: config.maxFiles,
      uploadsPerHour: config.uploadsPerHour,
    }),
  );

  app.post("/api/sites", uploadLimit, async (c) => {
    const limited = await uploadRate(c);
    if (limited) return limited;
    const { entries, ttl } = await readUpload(c);
    const files = prepareSite(entries, limits);
    let id = newSiteId();
    while (await store.exists(id)) id = newSiteId();
    const token = newEditToken();
    const ts = now();
    const meta = await store.put(
      {
        id,
        createdAt: new Date(ts).toISOString(),
        updatedAt: new Date(ts).toISOString(),
        expiresAt: new Date(ts + clampTtl(ttl) * HOUR).toISOString(),
        tokenHash: hashToken(token),
      },
      files,
    );
    return c.json({ ...view(meta), editToken: token }, 201);
  });

  app.get("/api/sites/:id", async (c) => {
    const meta = await authorizeSite(c);
    return meta instanceof Response ? meta : c.json(view(meta));
  });

  app.put("/api/sites/:id", uploadLimit, async (c) => {
    const meta = await authorizeSite(c);
    if (meta instanceof Response) return meta;
    const limited = await uploadRate(c);
    if (limited) return limited;
    const { entries } = await readUpload(c);
    const files = prepareSite(entries, limits);
    const updated = await store.put({ ...meta, updatedAt: new Date(now()).toISOString() }, files);
    return c.json(view(updated));
  });

  /** Change the expiry. A link can never outlive createdAt + MAX_TTL_HOURS. */
  app.patch("/api/sites/:id", async (c) => {
    const meta = await authorizeSite(c);
    if (meta instanceof Response) return meta;
    const body = (await c.req.json().catch(() => ({}))) as { ttlHours?: unknown };
    const ceiling = Date.parse(meta.createdAt) + config.maxTtlHours * HOUR;
    meta.expiresAt = new Date(
      Math.min(now() + clampTtl(body.ttlHours) * HOUR, ceiling),
    ).toISOString();
    meta.updatedAt = new Date(now()).toISOString();
    await store.updateMeta(meta);
    return c.json(view(meta));
  });

  app.delete("/api/sites/:id", async (c) => {
    const meta = await authorizeSite(c);
    if (meta instanceof Response) return meta;
    await store.delete(meta.id);
    return c.body(null, 204);
  });

  // ---- optional self-host admin (enabled only when ADMIN_TOKEN is set) -----
  app.use("/api/admin/*", async (c, next) => {
    const token = bearer(c.req.header("authorization"));
    if (!config.adminToken) return apiError(c, 404, "NOT_FOUND", "admin API is disabled");
    if (!token || !safeEqual(token, config.adminToken)) {
      return apiError(c, 401, "UNAUTHORIZED", "invalid admin token");
    }
    await next();
  });
  app.get("/api/admin/sites", async (c) => {
    const sites = (await store.list()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return c.json({
      count: sites.length,
      totalBytes: sites.reduce((s, m) => s + m.totalBytes, 0),
      sites: sites.map((m) => {
        const { files: _files, ...rest } = view(m);
        return rest;
      }),
    });
  });
  app.delete("/api/admin/sites/:id", async (c) => {
    const id = c.req.param("id");
    if (!(await store.exists(id))) return apiError(c, 404, "NOT_FOUND", "site not found");
    await store.delete(id);
    return c.body(null, 204);
  });
  app.post("/api/admin/sweep", async (c) => c.json({ removed: await store.sweepExpired(now()) }));

  // ---- the app's own UI ---------------------------------------------------
  const appPage = (c: Context, html: string, status = 200) => {
    c.header("Content-Security-Policy", APP_CSP);
    c.header("X-Frame-Options", "DENY");
    return c.html(html, status as 200);
  };
  app.get("/", (c) => appPage(c, indexHtml()));
  app.get("/favicon.ico", (c) => c.body(null, 204));
  app.get("/assets/app.js", (c) => {
    c.header("Content-Type", "text/javascript; charset=utf-8");
    c.header("Cache-Control", "no-cache");
    return c.body(APP_JS);
  });
  app.get("/assets/app.css", (c) => {
    c.header("Content-Type", "text/css; charset=utf-8");
    c.header("Cache-Control", "no-cache");
    return c.body(APP_CSS);
  });

  // ---- serving uploaded sites --------------------------------------------
  app.get("/s/:id", (c) => c.redirect(`/s/${c.req.param("id")}/`, 301));
  app.get("/s/:id/*", async (c) => {
    const id = c.req.param("id");
    const meta = await store.get(id);
    if (!meta) return appPage(c, notFoundHtml(), 404);
    if (Date.parse(meta.expiresAt) <= now()) return appPage(c, goneHtml(), 410);

    const prefix = `/s/${id}/`;
    let rel: string;
    try {
      rel = decodeURIComponent(new URL(c.req.url).pathname.slice(prefix.length));
    } catch {
      return appPage(c, notFoundHtml(), 400);
    }
    const candidates =
      rel === "" || rel.endsWith("/")
        ? [`${rel}index.html`]
        : [rel, `${rel}/index.html`, `${rel}.html`];
    let path: string | null = null;
    let found: string | undefined;
    for (const cand of candidates) {
      path = store.filePath(meta, cand);
      if (path) {
        found = cand;
        break;
      }
    }
    let status = 200;
    if (!path || !found) {
      path = store.filePath(meta, "404.html");
      if (!path) return appPage(c, notFoundHtml(), 404);
      found = "404.html";
      status = 404;
    }
    if (found !== rel && found.endsWith("index.html") && rel !== "" && !rel.endsWith("/")) {
      return c.redirect(`${prefix}${rel}/`, 301); // keep relative links working
    }
    const body = await readFile(path);
    const h = new Headers();
    h.set("Content-Type", meta.files[found]?.mime ?? "text/plain; charset=utf-8");
    h.set("Content-Security-Policy", SITE_CSP);
    h.set("Cache-Control", "public, max-age=60");
    // Sandboxed pages have an opaque origin, so their own module scripts,
    // fonts and fetch() calls are cross-origin: allow read access.
    h.set("Access-Control-Allow-Origin", "*");
    h.set("X-Robots-Tag", "noindex, nofollow");
    return new Response(body, { status, headers: h });
  });

  app.notFound((c) =>
    c.req.path.startsWith("/api/")
      ? apiError(c, 404, "NOT_FOUND", "no such route")
      : appPage(c, notFoundHtml(), 404),
  );

  return app;
}
