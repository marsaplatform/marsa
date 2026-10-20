import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ADMIN_JS, APP_CSS, APP_JS } from "./assets.js";
import { mountBackendRoutes } from "./backend/routes.js";
import type { SiteBackend } from "./backend/types.js";
import { APP_NAME } from "./brand.js";
import { clientIp } from "./client-ip.js";
import type { Config } from "./config.js";
import { type DocPage, loadDocs } from "./docs.js";
import { UploadError } from "./errors.js";
import type { Lang } from "./i18n.js";
import {
  type FileInput,
  fromFilesArray,
  fromZip,
  type Limits,
  prepareSite,
  type UploadEntry,
} from "./ingest.js";
import { llmsTxt } from "./llms.js";
import { openapi } from "./openapi.js";
import { RateLimiter } from "./rate-limit.js";
import { SDK_JS } from "./sdk.js";
import { APP_CSP, baseHeaders, SITE_CSP } from "./security.js";
import { publicMeta, type SiteMeta, type SiteStore } from "./store.js";
import { removeSite, sweepExpired } from "./sweep.js";
import { cleanTeamName, isTeamKey, publicTeam, type Team, TeamStore } from "./teams.js";
import { bearer, hashToken, newEditToken, newSiteId, safeEqual } from "./tokens.js";
import {
  adminHtml,
  type Directory,
  docPageHtml,
  docsIndexHtml,
  FAVICON_SVG,
  goneHtml,
  landingHtml,
  newHtml,
  notFoundHtml,
} from "./ui.js";

const HOUR = 60 * 60 * 1000;

/** The page title from index.html, used as the card title in the public directory. */
function titleOf(files: Map<string, Uint8Array>): { title?: string } {
  const html = files.get("index.html");
  if (!html) return {};
  const head = new TextDecoder().decode(html.subarray(0, 64 * 1024));
  const raw = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? "";
  const title = raw
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return title ? { title } : {};
}

export interface AppDeps {
  config: Config;
  store: SiteStore;
  /** Rendered guide pages; loaded from docs/ when omitted. */
  docs?: DocPage[];
  /** Optional data/files backend (Appwrite). null/omitted = off. */
  backend?: SiteBackend | null;
  /** Teams (admin-managed). Loaded from <dataDir>/teams.json when omitted. */
  teams?: TeamStore;
  limiter?: RateLimiter;
  now?: () => number;
}

function apiError(c: Context, status: number, code: string, message: string) {
  return c.json({ error: { code, message } }, status as 400);
}

export function createApp({
  config,
  store,
  limiter = new RateLimiter(),
  now = Date.now,
  docs = loadDocs(config.publicUrl),
  backend = null,
  teams = new TeamStore(config.dataDir),
}: AppDeps) {
  const app = new Hono();
  /** Language for pages outside the /ar tree: Arabic if the browser prefers it. */
  const langOf = (c: Context): Lang => {
    if (/^\/ar(\/|$)/.test(c.req.path)) return "ar";
    return /^\s*ar\b/i.test(c.req.header("accept-language") ?? "") ? "ar" : "en";
  };
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
    await teams.ready();
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

  /**
   * The team an upload belongs to. X-Team-Key, or an Authorization bearer that
   * looks like a team key, must be valid; no key at all means a guest upload.
   */
  function uploadTeam(c: Context): Team | null | Response {
    const header = c.req.header("x-team-key")?.trim();
    const auth = bearer(c.req.header("authorization"));
    const key = header || (auth && isTeamKey(auth) ? auth : "");
    if (!key) return null;
    return (
      teams.byTeamKey(key) ??
      apiError(
        c,
        401,
        "INVALID_TEAM_KEY",
        "unknown or rotated team key (omit it to upload as a guest)",
      )
    );
  }

  const siteUrl = (id: string) => `${config.publicUrl}/s/${id}/`;
  const view = (m: SiteMeta) => {
    const t = teams.get(m.teamId);
    return {
      ...publicMeta(m),
      url: siteUrl(m.id),
      team: t ? { id: t.id, name: t.name, backend: t.backend } : null,
    };
  };

  // ---- public directory of live team sites (cached briefly) ---------------
  let dirCache: { at: number; teams: Directory["teams"] } | null = null;
  const DIR_TTL = 30_000;
  const invalidateDirectory = () => {
    dirCache = null;
  };
  async function directory(): Promise<Directory> {
    const t = now();
    if (!dirCache || t - dirCache.at > DIR_TTL) {
      const listed = new Map(
        teams
          .list()
          .filter((x) => x.directory)
          .map((x) => [x.id, x]),
      );
      const byTeam = new Map<string, SiteMeta[]>();
      for (const m of await store.list()) {
        if (!m.teamId || !listed.has(m.teamId)) continue;
        byTeam.set(m.teamId, [...(byTeam.get(m.teamId) ?? []), m]);
      }
      dirCache = {
        at: t,
        teams: [...listed.values()]
          .map((team) => ({
            id: team.id,
            name: team.name,
            sites: (byTeam.get(team.id) ?? [])
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((m) => ({
                id: m.id,
                title: m.title || m.id,
                url: siteUrl(m.id),
                createdAt: m.createdAt,
                expiresAt: m.expiresAt,
              })),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    }
    // Expiry is re-checked on every read, so a cached entry never outlives its link.
    const live = dirCache.teams
      .map((team) => ({
        ...team,
        sites: team.sites.filter((x) => Date.parse(x.expiresAt) > t).slice(0, 60),
      }))
      .filter((team) => team.sites.length > 0);
    return { generatedAt: new Date(t).toISOString(), teams: live };
  }

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
      teams: { uploadHeader: "X-Team-Key" },
      backend: backend
        ? {
            enabled: true,
            access: config.backend.guestAccess ? "everyone" : "teams",
            kind: backend.kind,
            publicRead: config.backend.publicRead,
            maxValueBytes: config.backend.maxValueBytes,
            maxKeys: config.backend.maxKeys,
            maxFiles: config.backend.maxFiles,
          }
        : { enabled: false, access: config.backend.guestAccess ? "everyone" : "teams" },
    }),
  );

  app.get("/api/directory", async (c) => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Cache-Control", "public, max-age=30");
    return c.json(await directory());
  });

  app.post("/api/sites", uploadLimit, async (c) => {
    const team = uploadTeam(c);
    if (team instanceof Response) return team;
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
        ...(team ? { teamId: team.id } : {}),
        ...titleOf(files),
      },
      files,
    );
    if (team) invalidateDirectory();
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
    const { title: _old, ...rest } = meta;
    const updated = await store.put(
      { ...rest, ...titleOf(files), updatedAt: new Date(now()).toISOString() },
      files,
    );
    invalidateDirectory();
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
    invalidateDirectory();
    return c.json(view(meta));
  });

  app.delete("/api/sites/:id", async (c) => {
    const meta = await authorizeSite(c);
    if (meta instanceof Response) return meta;
    await removeSite(store, backend, meta.id);
    invalidateDirectory();
    return c.body(null, 204);
  });

  // ---- optional per-site data/files backend --------------------------------
  mountBackendRoutes(app, { config, store, backend, teams, now, uploadRate });

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
    await removeSite(store, backend, id);
    invalidateDirectory();
    return c.body(null, 204);
  });
  app.post("/api/admin/sweep", async (c) => {
    const removed = await sweepExpired(store, backend, now());
    invalidateDirectory();
    return c.json({ removed });
  });

  // Teams: who may use the backend, and who is listed in the public directory.
  const siteCounts = async () => {
    const counts = new Map<string, number>();
    for (const m of await store.list()) {
      if (m.teamId && Date.parse(m.expiresAt) > now()) {
        counts.set(m.teamId, (counts.get(m.teamId) ?? 0) + 1);
      }
    }
    return counts;
  };
  const teamView = (t: Team, counts?: Map<string, number>) => ({
    ...publicTeam(t),
    ...(counts ? { liveSites: counts.get(t.id) ?? 0 } : {}),
  });
  const readFlags = (body: Record<string, unknown>, c: Context) => {
    const out: { name?: string; backend?: boolean; directory?: boolean } = {};
    if ("name" in body) {
      const name = cleanTeamName(body.name);
      if (!name) return apiError(c, 400, "INVALID_REQUEST", "name: 1-80 characters");
      out.name = name;
    }
    for (const k of ["backend", "directory"] as const) {
      if (k in body) {
        if (typeof body[k] !== "boolean") {
          return apiError(c, 400, "INVALID_REQUEST", `${k} must be true or false`);
        }
        out[k] = body[k] as boolean;
      }
    }
    return out;
  };
  const readBody = async (c: Context) =>
    ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;

  app.get("/api/admin/teams", async (c) => {
    const counts = await siteCounts();
    return c.json({ teams: teams.list().map((t) => teamView(t, counts)) });
  });
  app.post("/api/admin/teams", async (c) => {
    const body = await readBody(c);
    if (!("name" in body)) return apiError(c, 400, "INVALID_REQUEST", "name is required");
    const f = readFlags(body, c);
    if (f instanceof Response) return f;
    const { team, key } = await teams.create(
      f.name as string,
      f.backend ?? false,
      now(),
      f.directory ?? true,
    );
    invalidateDirectory();
    return c.json({ team: teamView(team), key }, 201);
  });
  app.patch("/api/admin/teams/:id", async (c) => {
    const f = readFlags(await readBody(c), c);
    if (f instanceof Response) return f;
    const team = await teams.update(c.req.param("id"), f, now());
    if (!team) return apiError(c, 404, "NOT_FOUND", "team not found");
    invalidateDirectory();
    return c.json({ team: teamView(team) });
  });
  app.post("/api/admin/teams/:id/rotate", async (c) => {
    const r = await teams.rotate(c.req.param("id"), now());
    if (!r) return apiError(c, 404, "NOT_FOUND", "team not found");
    return c.json({ team: teamView(r.team), key: r.key });
  });
  app.delete("/api/admin/teams/:id", async (c) => {
    const id = c.req.param("id");
    if (!teams.get(id)) return apiError(c, 404, "NOT_FOUND", "team not found");
    // ?sites=delete also removes the team's sites; otherwise they stay up as
    // ordinary links (no backend, not in the directory) until they expire.
    let removedSites = 0;
    if (c.req.query("sites") === "delete") {
      for (const m of await store.list()) {
        if (m.teamId === id) {
          await removeSite(store, backend, m.id);
          removedSites++;
        }
      }
    }
    await teams.delete(id);
    invalidateDirectory();
    return c.json({ deleted: id, removedSites });
  });

  // ---- the app's own UI ---------------------------------------------------
  const appPage = (c: Context, html: string, status = 200) => {
    c.header("Content-Security-Policy", APP_CSP);
    c.header("X-Frame-Options", "DENY");
    c.header("Cache-Control", "no-cache");
    return c.html(html, status as 200);
  };
  const asset = (type: string, body: string) => (c: Context) => {
    c.header("Content-Type", type);
    c.header("Cache-Control", "public, max-age=300");
    return c.body(body);
  };
  const publicText = (c: Context, type: string, body: string) => {
    c.header("Content-Type", type);
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Cache-Control", "public, max-age=300");
    return c.body(body);
  };

  app.get("/", async (c) => appPage(c, landingHtml("en", config, await directory())));
  app.get("/ar", async (c) => appPage(c, landingHtml("ar", config, await directory())));
  app.get("/ar/", (c) => c.redirect("/ar", 301));
  app.get("/new", (c) => appPage(c, newHtml("en", config)));
  app.get("/ar/new", (c) => appPage(c, newHtml("ar", config)));
  // Admin console (static page; every action needs the ADMIN_TOKEN, sent by its script).
  const adminPage = (lang: Lang) => (c: Context) => {
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("Cache-Control", "no-store");
    return appPage(c, adminHtml(lang, config));
  };
  app.get("/admin", adminPage("en"));
  app.get("/ar/admin", adminPage("ar"));
  app.get("/docs", (c) => appPage(c, docsIndexHtml("en", config, docs)));
  app.get("/ar/docs", (c) => appPage(c, docsIndexHtml("ar", config, docs)));
  for (const prefix of ["", "/ar"] as const) {
    const lang: Lang = prefix ? "ar" : "en";
    app.get(`${prefix}/docs/:slug`, (c) => {
      const doc = docs.find((d) => d.slug === c.req.param("slug"));
      if (!doc) return appPage(c, notFoundHtml(lang, config), 404);
      return appPage(c, docPageHtml(lang, config, doc, docs));
    });
  }
  app.get("/llms.txt", (c) => publicText(c, "text/plain; charset=utf-8", llmsTxt(config)));
  app.get("/openapi.json", (c) =>
    publicText(c, "application/json; charset=utf-8", JSON.stringify(openapi(config), null, 2)),
  );
  app.get("/robots.txt", (c) =>
    publicText(c, "text/plain; charset=utf-8", "User-agent: *\nDisallow: /s/\nDisallow: /api/\n"),
  );
  app.get("/favicon.svg", asset("image/svg+xml", FAVICON_SVG));
  app.get("/favicon.ico", (c) => c.redirect("/favicon.svg", 302));
  app.get("/sdk.js", (c) => {
    c.header("Access-Control-Allow-Origin", "*");
    return asset("text/javascript; charset=utf-8", SDK_JS)(c);
  });
  app.get("/assets/app.js", asset("text/javascript; charset=utf-8", APP_JS));
  app.get("/assets/admin.js", asset("text/javascript; charset=utf-8", ADMIN_JS));
  app.get("/assets/app.css", asset("text/css; charset=utf-8", APP_CSS));

  // ---- serving uploaded sites --------------------------------------------
  app.get("/s/:id", (c) => c.redirect(`/s/${c.req.param("id")}/`, 301));
  app.get("/s/:id/*", async (c) => {
    const id = c.req.param("id");
    const meta = await store.get(id);
    if (!meta) return appPage(c, notFoundHtml(langOf(c), config), 404);
    if (Date.parse(meta.expiresAt) <= now()) return appPage(c, goneHtml(langOf(c), config), 410);

    const prefix = `/s/${id}/`;
    let rel: string;
    try {
      rel = decodeURIComponent(new URL(c.req.url).pathname.slice(prefix.length));
    } catch {
      return appPage(c, notFoundHtml(langOf(c), config), 400);
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
      if (!path) return appPage(c, notFoundHtml(langOf(c), config), 404);
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
      : appPage(c, notFoundHtml(langOf(c), config), 404),
  );

  return app;
}
