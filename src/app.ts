import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { AgentKeyStore } from "./agent-keys.js";
import { NoteStore } from "./agent-notes.js";
import { mountAgentInviteRoutes, mountAgentRoutes } from "./agent-routes.js";
import { APP_CSS, APP_JS, fontAsset } from "./assets.js";
import { CloudflareBackend, CloudflareError } from "./backend/cloudflare.js";
import { probeBackend } from "./backend/health.js";
import { mountBackendRoutes } from "./backend/routes.js";
import type { SiteBackend } from "./backend/types.js";
import { BackupService, type BlobStore, DirBlobStore, r2BlobStore } from "./backup.js";
import { APP_NAME, APP_VERSION } from "./brand.js";
import { CloudflareWorkersApi, type FetchFn } from "./cf-workers.js";
import { clientIp } from "./client-ip.js";
import type { Config } from "./config.js";
import { COVER_MAX_BYTES, type Cover, looksLike, pickCover } from "./cover.js";
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
import { mountMcpRoutes } from "./mcp.js";
import {
  type Actor,
  type AuditEntry,
  INVITE_TTL_DEFAULT,
  INVITE_TTL_MAX,
  isRole,
  MAX_INVITES,
  MemberStore,
  publicInvite,
  publicMember,
} from "./members.js";
import { type NavAccount, withNavAccount } from "./nav-state.js";
import { leaveNote, mountAdminNoteRoutes, mountNoteRoutes, noteView } from "./notes-routes.js";
import { NotificationCenter, type NotifyDeps } from "./notify.js";
import { openapi } from "./openapi.js";
import { mountOpsRoutes } from "./ops-routes.js";
import { RateLimiter } from "./rate-limit.js";
import { mountAdminRecipeRoutes, mountRecipeRoutes } from "./recipe-routes.js";
import { loadBuiltinRecipes, RecipeStore, recipeHtml, servedLang, summaryOf } from "./recipes.js";
import { RepoChecker, RepoError, type RepoLink, readRepo } from "./repo-status.js";
import { SDK_JS } from "./sdk.js";
import { SecretBox } from "./secrets.js";
import { APP_CSP, baseHeaders, SITE_CSP } from "./security.js";
import { Sessions } from "./session.js";
import { starterFor } from "./starters.js";
import { PERMANENT_EXPIRES, publicMeta, type SiteMeta, type SiteStore } from "./store.js";
import { removeSite, sweepExpired } from "./sweep.js";
import {
  can,
  credentialOf,
  hasEditBearer,
  makeTeamAuth,
  scopeError,
  type TeamCred,
} from "./team-auth.js";
import { TeamLifecycle, TeamLifecycleError } from "./team-lifecycle.js";
import {
  cleanTeamName,
  isTeamKey,
  publicTeam,
  type Team,
  type TeamPatch,
  TeamStore,
} from "./teams.js";
import { bearer, hashToken, newEditToken, newSiteId, safeEqual } from "./tokens.js";
import {
  type Directory,
  docPageHtml,
  docsIndexHtml,
  FAVICON_SVG,
  goneHtml,
  landingHtml,
  newHtml,
  notFoundHtml,
  placeholderSvg,
  privacyHtml,
  recipePageHtml,
  recipesIndexHtml,
} from "./ui.js";
import { mountUserKeyRoutes, userKeyOps } from "./user-key-routes.js";
import { UserKeyStore } from "./user-keys.js";
import { VisitCounter } from "./visits.js";
import { mountWebRoutes } from "./web.js";
import { ProbeCache } from "./worker-insight.js";
import { WorkerOps } from "./worker-ops.js";
import { PLATFORM_AUDIT, WorkerService } from "./workers.js";
import { ADMIN_ACTOR, mountWorkerRoutes } from "./workers-routes.js";

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
  /** Optional data/files backend (Cloudflare KV + R2). null/omitted = off. */
  backend?: SiteBackend | null;
  /** Teams (admin-managed). Loaded from <dataDir>/teams.json when omitted. */
  teams?: TeamStore;
  limiter?: RateLimiter;
  /** Browser sessions (team dashboard, admin). Built from config when omitted. */
  sessions?: Sessions;
  /** Page-view counter. Built from config when omitted (the caller flushes it). */
  visits?: VisitCounter;
  /** Team members, invites and the audit log. Loaded from <dataDir> when omitted. */
  members?: MemberStore;
  /** Team Workers (0.12.0). Built from config when omitted. */
  workers?: WorkerService;
  /** fetch used for the Cloudflare API and Worker probes (tests inject a fake). */
  cfFetch?: FetchFn;
  /** Agent keys and invites (0.14.0). Loaded from <dataDir> when omitted. */
  agentKeys?: AgentKeyStore;
  /** Notification center + webhooks (0.14.0). Built from config when omitted. */
  notify?: NotificationCenter;
  /** Overrides for the webhook sender (tests: fetch, retry delays). */
  notifyOpts?: Partial<NotifyDeps>;
  /** Receives the services the caller may need (index.ts runs the alert ticker). */
  expose?: (s: {
    agentKeys: AgentKeyStore;
    notify: NotificationCenter;
    userKeys: UserKeyStore;
    recipes: RecipeStore;
    ops: WorkerOps;
    lifecycle?: TeamLifecycle;
    backups?: BackupService;
    workers?: WorkerService;
  }) => void;
  /** Agent recipes (0.14.0). Built from docs/recipes + <dataDir> when omitted. */
  recipes?: RecipeStore;
  /** End-user API keys for team Workers (0.14.0). */
  userKeys?: UserKeyStore;
  /** 0.15.1: MCP tools/list probes and GitHub repo checks (tests inject fakes). */
  mcpProbe?: ProbeCache;
  repoChecker?: RepoChecker;
  /** 0.15.2: health checks, analytics, env view (tests inject one with a fake fetch). */
  ops?: WorkerOps;
  /** 0.16.0: encrypted backups (tests inject one with a directory store). */
  backups?: BackupService;
  now?: () => number;
}

function apiError(c: Context, status: number, code: string, message: string) {
  return c.json({ error: { code, message } }, status as 400);
}

export function createApp({
  config,
  store,
  now = Date.now,
  limiter = new RateLimiter(now),
  docs = loadDocs(config.publicUrl),
  backend = null,
  teams = new TeamStore(config.dataDir),
  sessions,
  visits = new VisitCounter(config.dataDir, config.visits, now),
  members = new MemberStore(config.dataDir, now),
  cfFetch,
  workers,
  agentKeys = new AgentKeyStore(config.dataDir, now, config.secretsKey || config.sessions.secret),
  notify,
  notifyOpts = {},
  expose,
  recipes = new RecipeStore(config.dataDir, loadBuiltinRecipes(config.publicUrl), now),
  userKeys = new UserKeyStore(config.dataDir, now),
  mcpProbe,
  repoChecker,
  ops,
  backups: backupsDep,
}: AppDeps) {
  const probes = mcpProbe ?? new ProbeCache(cfFetch ?? ((i, init) => fetch(i, init)), now);
  const repos =
    repoChecker ?? new RepoChecker((i, init) => fetch(i, init), now, config.githubToken);
  const notices =
    notify ??
    new NotificationCenter(config.dataDir, {
      box: config.secretsKey ? new SecretBox(config.secretsKey) : null,
      now,
      allowPrivate: config.webhookAllowPrivate,
      publicUrl: config.publicUrl,
      teamName: (id) => {
        const t = teams.get(id);
        return t ? { name: t.name, ...(t.slug ? { slug: t.slug } : {}) } : null;
      },
      ...notifyOpts,
    });
  members.onLog = (e) => notices.fromAudit(e);
  void userKeys.ready().catch((e) => console.error("[user-keys] load failed", e?.message));
  void recipes.ready().catch((e) => console.error("[recipes] load failed", e?.message));
  void agentKeys.ready().catch((e) => console.error("[agent-keys] load failed", e?.message));
  void notices.ready().catch((e) => console.error("[notify] load failed", e?.message));
  const agentNotes = new NoteStore(config.dataDir, now);
  void agentNotes.ready().catch((e) => console.error("[notes] load failed", e?.message));
  const teamAuth = makeTeamAuth({
    teams,
    agentKeys,
    notify: notices,
    trustProxy: config.trustProxy,
  });
  /** The team/agent credential each request used (for audit labels). */
  const credOf = new WeakMap<Context, TeamCred>();
  const workerSvc =
    workers ??
    new WorkerService(config.dataDir, {
      box: config.secretsKey ? new SecretBox(config.secretsKey) : null,
      api: new CloudflareWorkersApi(config.workers.apiBase, cfFetch),
      teams,
      limits: config.workers,
      now,
      probe: cfFetch ?? ((i, init) => fetch(i, init)),
      audit: async (e) => {
        if (e.teamId === PLATFORM_AUDIT || teams.get(e.teamId)) await members.log(e);
      },
    });
  const workerOps =
    ops ??
    new WorkerOps({
      dataDir: config.dataDir,
      workers: workerSvc,
      userKeys,
      fetch: cfFetch ?? ((i, init) => fetch(i, init)),
      now,
      probes,
      notify: notices,
      healthIntervalSec: config.workers.healthIntervalSec,
      backend,
      backendConfig: config.cloudflare,
    });
  void workerOps.health.ready().catch((e) => console.error("[health] load failed", e?.message));
  expose?.({ agentKeys, notify: notices, userKeys, recipes, ops: workerOps });
  workerSvc.onRemove = (rec) => {
    void workerOps.health.purge(rec.id).catch(() => {});
    return userKeys.purgeWorker(rec.id);
  };
  const ukOps = userKeyOps({
    config,
    teams,
    members,
    workers: workerSvc,
    userKeys,
    notify: notices,
  });
  /** Record an action on a team's site (or the team) in its audit log. */
  const audit = async (e: Omit<AuditEntry, "at" | "teamId"> & { teamId?: string }) => {
    if (e.teamId && teams.get(e.teamId)) await members.log({ ...e, teamId: e.teamId });
  };
  /** Who is calling the API: the team key, or a site's edit token. */
  const apiActor = (c: Context): Actor =>
    credOf.get(c)?.actor ??
    (c.req.header("x-team-key") || isTeamKey(bearer(c.req.header("authorization")) ?? "")
      ? { kind: "api", label: "team key" }
      : { kind: "api", label: "edit token" });
  store.onDelete((id) => visits.purge(id));
  const session = sessions ?? new Sessions(config, now);
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
    if (err instanceof CloudflareError) {
      // The data/files store failed (e.g. Cloudflare rejected the server's
      // credentials). Say so instead of a generic 500, so agents can tell an
      // outage of the store from a bug in their request.
      c.header("Retry-After", "60");
      return apiError(
        c,
        503,
        "BACKEND_UNAVAILABLE",
        `the data/files store is unavailable (${err.service.toUpperCase()} ${err.status}); try again later or tell the admin`,
      );
    }
    return apiError(c, 500, "INTERNAL", "unexpected server error");
  });

  // ---- baseline headers + API rate limit ----------------------------------
  app.use("*", async (c, next) => {
    await teams.ready();
    await members.ready();
    await workerSvc.ready();
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
  async function readUpload(
    c: Context,
  ): Promise<{ entries: UploadEntry[]; ttl?: unknown; repo?: RepoLink }> {
    const r = await readUploadRaw(c);
    const q = c.req.query("repoUrl");
    const raw =
      r.repo ??
      (q
        ? {
            url: q,
            ...(c.req.query("branch") ? { branch: c.req.query("branch") } : {}),
            ...(c.req.query("commitSha") ? { commitSha: c.req.query("commitSha") } : {}),
          }
        : undefined);
    try {
      const repo = readRepo(raw);
      return { entries: r.entries, ttl: r.ttl, ...(repo ? { repo } : {}) };
    } catch (e) {
      if (e instanceof RepoError) throw new UploadError("INVALID_REQUEST", e.message);
      throw e;
    }
  }
  async function readUploadRaw(
    c: Context,
  ): Promise<{ entries: UploadEntry[]; ttl?: unknown; repo?: unknown }> {
    const type = (c.req.header("content-type") ?? "").toLowerCase();
    const queryTtl =
      c.req.query("permanent") === "1" || c.req.query("permanent") === "true"
        ? "permanent"
        : (c.req.query("ttlHours") ?? c.req.query("ttl"));
    if (type.startsWith("application/json")) {
      let body: { files?: FileInput[]; ttlHours?: unknown; permanent?: unknown; repo?: unknown };
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
      const ttl = body.permanent === true ? "permanent" : (body.ttlHours ?? queryTtl);
      return { entries: fromFilesArray(body.files), ttl, repo: body.repo };
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
    // 0.14.0: the team key or an agent key (spaces:read / spaces:write) on the team's sites.
    const raw = hasEditBearer(c) ? "" : credentialOf(c);
    if (raw) {
      const cred = await teamAuth(c, raw);
      if (!meta || !cred || cred === "invalid" || cred.team.id !== meta.teamId) {
        return apiError(c, 404, "NOT_FOUND", "site not found or token invalid");
      }
      const scope = c.req.method === "GET" ? "spaces:read" : "spaces:write";
      if (!can(cred, scope)) return scopeError(c, scope);
      if (Date.parse(meta.expiresAt) <= now()) {
        return apiError(c, 410, "EXPIRED", "this link has expired");
      }
      credOf.set(c, cred);
      return meta;
    }
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
  async function uploadTeam(c: Context): Promise<Team | null | Response> {
    const raw = credentialOf(c);
    if (!raw) return null;
    const cred = await teamAuth(c, raw);
    if (!cred || cred === "invalid") {
      return apiError(
        c,
        401,
        "INVALID_TEAM_KEY",
        "unknown, rotated, revoked or expired key (omit it to upload as a guest)",
      );
    }
    if (!can(cred, "spaces:write")) return scopeError(c, "spaces:write");
    credOf.set(c, cred);
    return cred.team;
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

  // ---- 0.16.0: team trash (export, soft delete, restore, purge) and backups ----------------
  const lifecycle = new TeamLifecycle({
    dataDir: config.dataDir,
    teams,
    members,
    agentKeys,
    notify: notices,
    userKeys,
    recipes,
    agentNotes,
    workers: workerSvc,
    store,
    backend,
    sessions: session,
    deleteSite: (id) => deleteSite(id),
    invalidateDirectory,
    audit: (e) => members.log(e),
    onPurge: async (teamId) => {
      for (const w of workerSvc.list(teamId)) await workerOps.health.purge(w.id).catch(() => {});
    },
    now,
  });
  const backupStore: BlobStore | null =
    backend instanceof CloudflareBackend && config.cloudflare
      ? r2BlobStore(backend, config.cloudflare.r2Bucket)
      : config.backup.dir
        ? new DirBlobStore(config.backup.dir)
        : null;
  const backups =
    backupsDep ??
    new BackupService({
      dataDir: config.dataDir,
      store: config.backup.enabled ? backupStore : null,
      secret: config.backup.secret,
      app: APP_VERSION,
      hourUtc: config.backup.hourUtc,
      keepDaily: config.backup.keepDaily,
      keepWeekly: config.backup.keepWeekly,
      maxBytes: config.backup.maxBytes,
      now,
      onFail: (run) =>
        void notices
          .add({ teamId: PLATFORM_AUDIT, kind: "backup-failed", detail: run.error ?? "error" })
          .catch(() => {}),
    });
  expose?.({
    agentKeys,
    notify: notices,
    userKeys,
    recipes,
    ops: workerOps,
    lifecycle,
    backups,
    workers: workerSvc,
  });
  // Cover picks are memoised per site version, so a rebuild only re-reads changed sites.
  const coverMemo = new Map<string, { v: string; cover: Cover | null }>();
  async function coverOf(m: SiteMeta): Promise<Cover | null> {
    const hit = coverMemo.get(m.id);
    if (hit && hit.v === m.updatedAt) return hit.cover;
    let head: Uint8Array | null = null;
    const index = store.filePath(m, "index.html");
    if (index) {
      const fh = await open(index, "r").catch(() => null);
      if (fh) {
        try {
          const buf = new Uint8Array(128 * 1024);
          const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
          head = buf.subarray(0, bytesRead);
        } finally {
          await fh.close();
        }
      }
    }
    const cover = pickCover(m, head, config.publicUrl);
    coverMemo.set(m.id, { v: m.updatedAt, cover });
    return cover;
  }
  const coverUrl = (m: SiteMeta) =>
    `/covers/${m.id}?v=${createHash("sha256").update(m.updatedAt).digest("hex").slice(0, 10)}`;

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
        if (!m.teamId || m.unlisted || !listed.has(m.teamId)) continue;
        byTeam.set(m.teamId, [...(byTeam.get(m.teamId) ?? []), m]);
      }
      const seen = new Set<string>();
      const teamsOut: Directory["teams"] = [];
      for (const team of listed.values()) {
        const metas = (byTeam.get(team.id) ?? []).sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt),
        );
        const sites: Directory["teams"][number]["sites"] = [];
        for (const m of metas) {
          seen.add(m.id);
          const cover = await coverOf(m);
          sites.push({
            id: m.id,
            title: m.title || m.id,
            url: siteUrl(m.id),
            createdAt: m.createdAt,
            expiresAt: m.expiresAt,
            cover: cover ? coverUrl(m) : null,
          });
        }
        teamsOut.push({ id: team.id, name: team.name, sites });
      }
      for (const id of coverMemo.keys()) if (!seen.has(id)) coverMemo.delete(id);
      dirCache = { at: t, teams: teamsOut.sort((a, b) => a.name.localeCompare(b.name)) };
    }
    // Expiry is re-checked on every read, so a cached entry never outlives its link.
    const live = dirCache.teams
      .map((team) => ({
        ...team,
        sites: team.sites.filter((x) => Date.parse(x.expiresAt) > t).slice(0, 60),
      }))
      .filter((team) => team.sites.length > 0);
    const ids = new Set(live.flatMap((team) => team.sites.map((x) => x.id)));
    const featured = config.featuredSites.filter((id) => ids.has(id));
    if (featured.length === 0 && live.length > 0) {
      // Nothing pinned (or the pinned sites are gone): spotlight the newest page.
      const newest = live
        .flatMap((team) => team.sites)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (newest) featured.push(newest.id);
    }
    return { generatedAt: new Date(t).toISOString(), featured, teams: live };
  }

  // ---- site operations shared by the API and the dashboard ----------------
  /** "permanent" (or true) asks for no expiry. */
  const wantsPermanent = (ttl: unknown) =>
    ttl === true || (typeof ttl === "string" && ttl.trim().toLowerCase() === "permanent");
  const quotaOf = (team: Team) => ({
    sites: team.maxSites ?? config.teamMaxSites,
    bytes: team.maxMb ? team.maxMb * 1024 * 1024 : config.teamMaxBytes,
  });
  /** Live sites and bytes a team uses now (optionally leaving one site out). */
  async function usageOf(team: Team, except?: string) {
    let sites = 0;
    let bytes = 0;
    for (const m of await store.list()) {
      if (m.teamId !== team.id || m.id === except || Date.parse(m.expiresAt) <= now()) continue;
      sites++;
      bytes += m.totalBytes;
    }
    return { sites, bytes };
  }
  async function checkQuota(team: Team, addBytes: number, newSite: boolean, except?: string) {
    const q = quotaOf(team);
    const u = await usageOf(team, except);
    if (newSite && u.sites + 1 > q.sites) {
      throw new UploadError(
        "TEAM_QUOTA_EXCEEDED",
        `this team already has ${u.sites} live sites (quota ${q.sites}); delete one first`,
      );
    }
    if (u.bytes + addBytes > q.bytes) {
      const mb = (n: number) => `${Math.ceil(n / 1024 / 1024)} MB`;
      throw new UploadError(
        "TEAM_QUOTA_EXCEEDED",
        `this upload would bring the team to ${mb(u.bytes + addBytes)} (quota ${mb(q.bytes)})`,
      );
    }
  }
  const bytesOf = (files: Map<string, Uint8Array>) =>
    [...files.values()].reduce((n, b) => n + b.byteLength, 0);
  const permanentFor = (team: Team | null) => {
    if (!team?.permanent) {
      throw new UploadError(
        "PERMANENT_NOT_ALLOWED",
        "only teams the admin allows can publish permanent sites",
      );
    }
  };

  async function createSite(
    entries: UploadEntry[],
    ttl: unknown,
    team: Team | null,
    repo?: RepoLink,
  ) {
    const permanent = wantsPermanent(ttl);
    if (permanent) permanentFor(team);
    const files = prepareSite(entries, limits);
    if (team) await checkQuota(team, bytesOf(files), true);
    let id = newSiteId();
    while (await store.exists(id)) id = newSiteId();
    // Every site gets an edit token; only its hash is stored. Team sites are
    // also managed from the team's dashboard session, without the token.
    const token = newEditToken();
    const ts = now();
    const meta = await store.put(
      {
        id,
        createdAt: new Date(ts).toISOString(),
        updatedAt: new Date(ts).toISOString(),
        expiresAt: permanent
          ? PERMANENT_EXPIRES
          : new Date(ts + clampTtl(ttl) * HOUR).toISOString(),
        ...(permanent ? { permanent: true } : {}),
        tokenHash: hashToken(token),
        ...(team ? { teamId: team.id } : {}),
        ...(repo ? { repo } : {}),
        ...titleOf(files),
      },
      files,
    );
    if (team) invalidateDirectory();
    return { meta, token };
  }
  async function replaceSite(meta: SiteMeta, entries: UploadEntry[]) {
    const files = prepareSite(entries, limits);
    const team = teams.get(meta.teamId);
    if (team) await checkQuota(team, bytesOf(files), false, meta.id);
    const { title: _old, ...rest } = meta;
    const updated = await store.put(
      { ...rest, ...titleOf(files), updatedAt: new Date(now()).toISOString() },
      files,
    );
    invalidateDirectory();
    return updated;
  }
  /** A link can never outlive (start of its timed life) + MAX_TTL_HOURS. */
  const ceilingOf = (meta: SiteMeta) =>
    Date.parse(meta.ttlFrom ?? meta.createdAt) + config.maxTtlHours * HOUR;
  /** Turn permanence on, or off (the site then gets MAX_TTL_HOURS from now). */
  async function setPermanent(meta: SiteMeta, on: boolean) {
    const ts = new Date(now()).toISOString();
    if (on) {
      meta.permanent = true;
      meta.expiresAt = PERMANENT_EXPIRES;
      delete meta.ttlFrom;
    } else if (meta.permanent) {
      delete meta.permanent;
      meta.ttlFrom = ts;
      meta.expiresAt = new Date(now() + config.maxTtlHours * HOUR).toISOString();
    }
    meta.updatedAt = ts;
    await store.updateMeta(meta);
    invalidateDirectory();
    return meta;
  }
  /** Change the expiry; "permanent" asks for none (team permitting). */
  async function extendSite(meta: SiteMeta, ttl: unknown) {
    if (wantsPermanent(ttl)) {
      permanentFor(teams.get(meta.teamId));
      return setPermanent(meta, true);
    }
    if (meta.permanent) {
      // Back to a timed link: its life (and ceiling) starts now.
      delete meta.permanent;
      meta.ttlFrom = new Date(now()).toISOString();
    }
    meta.expiresAt = new Date(
      Math.min(now() + clampTtl(ttl) * HOUR, ceilingOf(meta)),
    ).toISOString();
    meta.updatedAt = new Date(now()).toISOString();
    await store.updateMeta(meta);
    invalidateDirectory();
    return meta;
  }
  async function deleteSite(id: string) {
    await removeSite(store, backend, id);
    invalidateDirectory();
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
    const team = await uploadTeam(c);
    if (team instanceof Response) return team;
    const limited = await uploadRate(c);
    if (limited) return limited;
    const { entries, ttl, repo } = await readUpload(c);
    const { meta, token } = await createSite(entries, ttl, team, repo);
    if (team)
      await audit({
        teamId: team.id,
        siteId: meta.id,
        actor: apiActor(c),
        action: "publish",
        detail: meta.title,
      });
    return c.json({ ...view(meta), editToken: token }, 201);
  });

  /** 0.14.0: a team's live sites, for the team key or an agent key with spaces:read. */
  app.get("/api/teams/:team/sites", async (c) => {
    const cred = await teamAuth(c);
    if (!cred || cred === "invalid") {
      return apiError(c, 401, "UNAUTHORIZED", "send the team key or an agent key");
    }
    const want = c.req.param("team");
    if (want !== cred.team.id && want !== cred.team.slug) {
      return apiError(c, 404, "NOT_FOUND", "this key does not belong to that team");
    }
    if (!can(cred, "spaces:read")) return scopeError(c, "spaces:read");
    const t = now();
    const sites = (await store.list())
      .filter((m) => m.teamId === cred.team.id && Date.parse(m.expiresAt) > t)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((m) => {
        const { files: _f, ...rest } = view(m);
        return rest;
      });
    return c.json({ team: { id: cred.team.id, slug: cred.team.slug ?? null }, sites });
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
    const out = await replaceSite(meta, entries);
    await audit({ teamId: meta.teamId, siteId: meta.id, actor: apiActor(c), action: "replace" });
    return c.json(view(out));
  });

  /** Change the expiry. A link can never outlive createdAt + MAX_TTL_HOURS. */
  app.patch("/api/sites/:id", async (c) => {
    const meta = await authorizeSite(c);
    if (meta instanceof Response) return meta;
    const body = (await c.req.json().catch(() => ({}))) as {
      ttlHours?: unknown;
      permanent?: unknown;
      repo?: unknown;
    };
    if ("repo" in body) {
      let repo: RepoLink | null | undefined;
      try {
        repo = readRepo(body.repo);
      } catch (e) {
        if (e instanceof RepoError) return apiError(c, 400, "INVALID_REQUEST", e.message);
        throw e;
      }
      if (repo) meta.repo = repo;
      else delete meta.repo;
      meta.updatedAt = new Date(now()).toISOString();
      await store.updateMeta(meta);
      await audit({
        teamId: meta.teamId,
        siteId: meta.id,
        actor: apiActor(c),
        action: "repo",
        detail: repo?.url ?? "-",
      });
      if (body.ttlHours === undefined && body.permanent === undefined) return c.json(view(meta));
    }
    const ttl = body.permanent === true ? "permanent" : body.ttlHours;
    const out = await extendSite(meta, ttl);
    await audit({
      teamId: meta.teamId,
      siteId: meta.id,
      actor: apiActor(c),
      action: ttl === "permanent" ? "permanent" : "extend",
      detail: out.expiresAt,
    });
    return c.json(view(out));
  });

  app.delete("/api/sites/:id", async (c) => {
    const meta = await authorizeSite(c);
    if (meta instanceof Response) return meta;
    await removeSite(store, backend, meta.id);
    invalidateDirectory();
    await audit({
      teamId: meta.teamId,
      siteId: meta.id,
      actor: apiActor(c),
      action: "delete",
      detail: meta.title,
    });
    return c.body(null, 204);
  });

  // ---- one MCP server per space ---------------------------------------------
  mountMcpRoutes(app, {
    config,
    store,
    teams,
    backend,
    limiter,
    now,
    siteUrl,
    replaceSite,
    audit,
    workers: workerSvc,
    teamAuth,
    recipes,
    userKeyOps: ukOps,
    ops: workerOps,
    leaveNote: async (team, input, who) => {
      const r = await leaveNote(
        { notes: agentNotes, notify: notices, limiter },
        team,
        input,
        "mcp",
        who,
      );
      return "retryAfterSec" in r ? r : noteView(r);
    },
  });

  // ---- optional per-site data/files backend --------------------------------
  mountBackendRoutes(app, { config, store, backend, teams, now, uploadRate, teamAuth });
  const agentDeps = { config, teams, members, agentKeys, notify: notices, limiter, teamAuth };
  mountAgentInviteRoutes(app, agentDeps);
  const recipeDeps = { publicUrl: config.publicUrl, recipes, members, teamAuth };
  mountRecipeRoutes(app, recipeDeps);
  mountUserKeyRoutes(
    app,
    { config, teams, members, workers: workerSvc, userKeys, notify: notices, limiter, teamAuth },
    ukOps,
  );

  // ---- optional self-host admin (enabled only when ADMIN_TOKEN is set) -----
  app.use("/api/admin/*", async (c, next) => {
    const token = bearer(c.req.header("authorization"));
    if (!config.adminToken) return apiError(c, 404, "NOT_FOUND", "admin API is disabled");
    if (!token || !safeEqual(token, config.adminToken)) {
      return apiError(c, 401, "UNAUTHORIZED", "invalid admin token");
    }
    await next();
  });
  mountWorkerRoutes(app, {
    config,
    teams,
    members,
    workers: workerSvc,
    limiter,
    now,
    teamAuth,
    siteOfTeam: async (teamId, siteId) => {
      const m = await store.get(siteId).catch(() => null);
      return !!m && m.teamId === teamId;
    },
  });
  mountOpsRoutes(app, { teams, workers: workerSvc, ops: workerOps, limiter, teamAuth });
  mountAgentRoutes(app, agentDeps);
  mountAdminRecipeRoutes(app, recipeDeps);
  const noteDeps = { teams, notes: agentNotes, notify: notices, limiter, teamAuth };
  mountNoteRoutes(app, noteDeps);
  mountAdminNoteRoutes(app, noteDeps);
  app.get("/api/admin/backend/check", async (c) =>
    c.json(backend ? { enabled: true, ...(await probeBackend(backend)) } : { enabled: false }),
  );

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
  /** Admin: make a team site permanent, or revoke it ({ "permanent": true | false }). */
  app.patch("/api/admin/sites/:id", async (c) => {
    const meta = await store.get(c.req.param("id"));
    if (!meta || Date.parse(meta.expiresAt) <= now()) {
      return apiError(c, 404, "NOT_FOUND", "site not found");
    }
    const body = await readBody(c);
    if (typeof body.permanent !== "boolean") {
      return apiError(c, 400, "INVALID_REQUEST", "permanent must be true or false");
    }
    if (body.permanent && !teams.get(meta.teamId)) {
      return apiError(c, 403, "PERMANENT_NOT_ALLOWED", "guest sites cannot be permanent");
    }
    const { files: _files, ...rest } = view(await setPermanent(meta, body.permanent));
    return c.json(rest);
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
    quota: { sites: quotaOf(t).sites, mb: Math.round(quotaOf(t).bytes / 1024 / 1024) },
    ...(counts ? { liveSites: counts.get(t.id) ?? 0 } : {}),
    members: members.count(t.id),
  });
  const readFlags = (body: Record<string, unknown>, c: Context) => {
    const out: TeamPatch = {};
    if ("name" in body) {
      const name = cleanTeamName(body.name);
      if (!name) return apiError(c, 400, "INVALID_REQUEST", "name: 1-80 characters");
      out.name = name;
    }
    for (const k of ["backend", "directory", "permanent"] as const) {
      if (k in body) {
        if (typeof body[k] !== "boolean") {
          return apiError(c, 400, "INVALID_REQUEST", `${k} must be true or false`);
        }
        out[k] = body[k] as boolean;
      }
    }
    for (const k of ["maxSites", "maxMb"] as const) {
      if (k in body) {
        const v = body[k];
        if (v === null || v === 0) out[k] = null;
        else if (typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 100_000) out[k] = v;
        else
          return apiError(
            c,
            400,
            "INVALID_REQUEST",
            `${k}: a whole number, or null for the default`,
          );
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
      {
        ...(f.permanent !== undefined ? { permanent: f.permanent } : {}),
        ...(f.maxSites ? { maxSites: f.maxSites } : {}),
        ...(f.maxMb ? { maxMb: f.maxMb } : {}),
      },
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
    await audit({ teamId: r.team.id, actor: ADMIN_ACTOR, action: "team-key-rotate" });
    return c.json({ team: teamView(r.team), key: r.key });
  });
  // Members and invites (no email: the admin hands the invite link over).
  app.get("/api/admin/teams/:id/members", (c) => {
    const id = c.req.param("id");
    if (!teams.get(id)) return apiError(c, 404, "NOT_FOUND", "team not found");
    return c.json({
      members: members.list(id).map(publicMember),
      invites: members.listInvites(id).map(publicInvite),
    });
  });
  app.post("/api/admin/teams/:id/invites", async (c) => {
    const id = c.req.param("id");
    if (!teams.get(id)) return apiError(c, 404, "NOT_FOUND", "team not found");
    const body = (await c.req.json().catch(() => ({}))) as { role?: unknown; ttlHours?: unknown };
    const role = body.role === undefined ? "owner" : body.role;
    if (!isRole(role))
      return apiError(c, 400, "BAD_REQUEST", '"role" must be owner, editor or viewer');
    const ttl = body.ttlHours === undefined ? INVITE_TTL_DEFAULT : Number(body.ttlHours);
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > INVITE_TTL_MAX) {
      return apiError(c, 400, "BAD_REQUEST", `"ttlHours" must be 1-${INVITE_TTL_MAX}`);
    }
    if (members.listInvites(id).length >= MAX_INVITES) {
      return apiError(c, 409, "TOO_MANY_INVITES", `a team can have ${MAX_INVITES} pending invites`);
    }
    const { invite, token } = await members.createInvite(id, role, ttl, "admin");
    await audit({
      teamId: id,
      actor: { kind: "admin", label: "admin" },
      action: "invite",
      detail: role,
    });
    return c.json({ invite: publicInvite(invite), url: `${config.publicUrl}/join/${token}` }, 201);
  });
  app.delete("/api/admin/teams/:id/invites/:iid", async (c) => {
    const inv = members.listInvites(c.req.param("id")).find((i) => i.id === c.req.param("iid"));
    if (!inv) return apiError(c, 404, "NOT_FOUND", "invite not found");
    await members.revokeInvite(inv.id);
    return c.body(null, 204);
  });
  app.delete("/api/admin/teams/:id/members/:mid", async (c) => {
    const m = members.get(c.req.param("mid"));
    if (!m || m.teamId !== c.req.param("id"))
      return apiError(c, 404, "NOT_FOUND", "member not found");
    await members.remove(m.id);
    await audit({
      teamId: m.teamId,
      actor: { kind: "admin", label: "admin" },
      action: "member-remove",
      detail: m.name,
    });
    return c.body(null, 204);
  });

  // 0.16.0: DELETE moves the team to the trash for 7 days (export first, Workers off).
  // ?confirm=<team name or id> is required; ?sites=delete also deletes its sites at purge;
  // ?purge=now deletes everything at once (same confirm).
  const lifecycleFail = (c: Context, e: unknown) => {
    if (e instanceof TeamLifecycleError) return apiError(c, e.status, e.code, e.message);
    throw e;
  };
  app.delete("/api/admin/teams/:id", async (c) => {
    const id = c.req.param("id");
    const confirm = c.req.query("confirm");
    try {
      const tr = await lifecycle.softDelete(id, ADMIN_ACTOR, {
        deleteSites: c.req.query("sites") === "delete",
        confirm,
      });
      if (c.req.query("purge") === "now") {
        const r = await lifecycle.purge(id, ADMIN_ACTOR, confirm);
        return c.json({ deleted: id, purged: true, ...r });
      }
      return c.json({
        deleted: id,
        purged: false,
        trash: {
          deletedAt: tr.deletedAt,
          purgeAfter: tr.purgeAfter,
          deleteSites: tr.deleteSites,
          workersTurnedOff: tr.disabledWorkers.length,
          export: `/api/admin/trash/${id}/export`,
        },
      });
    } catch (e) {
      return lifecycleFail(c, e);
    }
  });

  app.get("/api/admin/teams/:id/export", async (c) => {
    const team = teams.get(c.req.param("id"));
    if (!team) return apiError(c, 404, "NOT_FOUND", "team not found");
    const ex = await lifecycle.exportTeam(team);
    await members.log({ teamId: team.id, actor: ADMIN_ACTOR, action: "team-export" });
    c.header("Content-Type", "application/zip");
    c.header("Content-Disposition", `attachment; filename="${ex.file}"`);
    c.header("Cache-Control", "no-store");
    return c.body(new Uint8Array(ex.zip));
  });

  app.get("/api/admin/trash", (c) =>
    c.json({
      teams: teams.listTrash().map((tr) => ({
        team: publicTeam(tr.team),
        deletedAt: tr.deletedAt,
        purgeAfter: tr.purgeAfter,
        deletedBy: tr.deletedBy,
        deleteSites: tr.deleteSites,
        workersTurnedOff: tr.disabledWorkers.length,
        hasExport: !!tr.exportFile,
      })),
    }),
  );
  app.get("/api/admin/trash/:id/export", async (c) => {
    const ex = await lifecycle.trashedExport(c.req.param("id"));
    if (!ex) return apiError(c, 404, "NOT_FOUND", "no export for that team");
    c.header("Content-Type", "application/zip");
    c.header("Content-Disposition", `attachment; filename="${ex.file}"`);
    c.header("Cache-Control", "no-store");
    return c.body(new Uint8Array(ex.zip));
  });
  app.post("/api/admin/trash/:id/restore", async (c) => {
    try {
      const r = await lifecycle.restore(c.req.param("id"), ADMIN_ACTOR);
      return c.json({ team: publicTeam(r.team), workersOn: r.workersOn, failed: r.failed });
    } catch (e) {
      return lifecycleFail(c, e);
    }
  });
  app.delete("/api/admin/trash/:id", async (c) => {
    try {
      const confirm = c.req.query("confirm") ?? "";
      return c.json({
        purged: c.req.param("id"),
        ...(await lifecycle.purge(c.req.param("id"), ADMIN_ACTOR, confirm)),
      });
    } catch (e) {
      return lifecycleFail(c, e);
    }
  });

  // ---- 0.16.0: backups and sessions -----------------------------------------------------
  app.get("/api/admin/backups", async (c) => c.json({ backups: await backups.status() }));
  app.post("/api/admin/backups/run", async (c) => {
    const run = await backups.run("manual");
    await members.log({
      teamId: PLATFORM_AUDIT,
      actor: ADMIN_ACTOR,
      action: run.ok ? "backup-run" : "backup-fail",
      ...(run.key ? { detail: run.key } : run.error ? { detail: run.error } : {}),
    });
    return c.json({ run }, run.ok ? 200 : 502);
  });
  app.post("/api/admin/backups/test-restore", async (c) => {
    const r = await backups.testRestore();
    await members.log({
      teamId: PLATFORM_AUDIT,
      actor: ADMIN_ACTOR,
      action: "backup-restore-test",
      detail: r.ok ? `${r.files} files OK` : (r.error ?? "failed"),
    });
    return c.json({ restoreTest: r }, r.ok ? 200 : 502);
  });
  app.post("/api/admin/sessions/end-all", async (c) => {
    session.endAll("admin");
    await members.log({ teamId: PLATFORM_AUDIT, actor: ADMIN_ACTOR, action: "sessions-end-all" });
    return c.json({ ok: true });
  });

  // ---- the app's own UI ---------------------------------------------------
  const appPage = (c: Context, html: string, status = 200) => {
    c.header("Content-Security-Policy", APP_CSP);
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "same-origin");
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

  // Header link: "Team dashboard" / "Admin console" instead of "Team sign-in" when a valid session exists.
  app.use("*", async (c, next) => {
    if ((c.req.method !== "GET" && c.req.method !== "HEAD") || !session.hasCookie(c)) return next();
    const p = c.req.path;
    if (
      p.startsWith("/api/") ||
      p.startsWith("/s/") ||
      p.startsWith("/mcp/") ||
      p.startsWith("/assets/") ||
      p.startsWith("/covers/")
    )
      return next();
    const s = session.read(c);
    let account: NavAccount = null;
    if (s?.role === "admin" && config.adminToken) account = "admin";
    else if (s?.role === "team" && s.teamId && teams.get(s.teamId)) {
      const m = s.memberId ? members.get(s.memberId) : null;
      if (!s.memberId || m?.teamId === s.teamId) account = "team";
    }
    return withNavAccount(account, () => next());
  });

  app.get("/", async (c) => appPage(c, landingHtml("en", config, await directory())));
  app.get("/ar", async (c) => appPage(c, landingHtml("ar", config, await directory())));
  app.get("/ar/", (c) => c.redirect("/ar", 301));
  app.get("/new", (c) => appPage(c, newHtml("en", config)));
  app.get("/ar/new", (c) => appPage(c, newHtml("ar", config)));
  // Team dashboard, sign-in and the admin console (server-rendered, session cookies).
  mountWebRoutes(app, {
    config,
    store,
    teams,
    backend,
    sessions: session,
    limiter,
    now,
    appPage,
    uploadLimit,
    uploadRate,
    readUpload,
    createSite,
    replaceSite,
    extendSite,
    deleteSite,
    ceilingOf,
    setPermanent,
    quotaOf,
    usageOf,
    visits,
    members,
    audit,
    siteUrl,
    invalidateDirectory,
    siteCounts,
    workers: workerSvc,
    agentKeys,
    notify: notices,
    recipes,
    userKeys,
    userKeyOps: ukOps,
    mcpProbe: probes,
    repoChecker: repos,
    lifecycle,
    backups,
    ops: workerOps,
    notes: agentNotes,
    previewImage: async (meta, teamId) => {
      const cover = await coverOf(meta);
      const path = cover ? store.filePath(meta, cover.path) : null;
      const body = cover && path ? await readFile(path).catch(() => null) : null;
      if (cover && body && body.byteLength <= COVER_MAX_BYTES && looksLike(cover.mime, body))
        return { type: cover.mime, body: new Uint8Array(body) };
      return {
        type: "image/svg+xml; charset=utf-8",
        body: placeholderSvg(meta.title || meta.id, teamId ?? meta.id),
      };
    },
  });
  app.get("/privacy", (c) => appPage(c, privacyHtml("en", config)));
  app.get("/ar/privacy", (c) => appPage(c, privacyHtml("ar", config)));
  for (const prefix of ["", "/ar"] as const) {
    const lang: Lang = prefix ? "ar" : "en";
    app.get(`${prefix}/docs/recipes`, async (c) => {
      await recipes.ready();
      return appPage(
        c,
        recipesIndexHtml(
          lang,
          config,
          recipes.visible(null).map((r) => summaryOf(r, lang)),
        ),
      );
    });
    app.get(`${prefix}/docs/recipes/:slug`, async (c) => {
      await recipes.ready();
      const r = recipes.get(c.req.param("slug"), null);
      if (!r) return appPage(c, notFoundHtml(lang, config), 404);
      const served = servedLang(r, lang);
      return appPage(
        c,
        recipePageHtml(
          lang,
          config,
          r,
          recipeHtml(r, served),
          served,
          recipes.visible(null).map((x) => summaryOf(x, lang)),
          (() => {
            const s = r.scope === "builtin" ? starterFor(r.slug) : null;
            return s
              ? {
                  name: s.name,
                  zip: `/api/recipes/${r.slug}/starter.zip`,
                  tree: s.tree,
                  count: s.files.length,
                }
              : null;
          })(),
        ),
      );
    });
  }
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
  app.get("/assets/fonts/zad/:file", (c) => {
    const font = fontAsset(c.req.param("file"));
    if (!font) return apiError(c, 404, "NOT_FOUND", "no such font");
    c.header("Content-Type", font.type);
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return c.body(font.body as unknown as ArrayBuffer);
  });
  app.get("/assets/app.css", asset("text/css; charset=utf-8", APP_CSS));

  // ---- directory covers (images that are already part of a listed site) ---
  app.get("/covers/:id", async (c) => {
    const id = c.req.param("id");
    const notFound = () => {
      c.header("Cache-Control", "public, max-age=60");
      return c.body(null, 404);
    };
    const listed = (await directory()).teams.some((team) => team.sites.some((x) => x.id === id));
    if (!listed) return notFound();
    const meta = await store.get(id);
    if (!meta) return notFound();
    const cover = await coverOf(meta);
    const path = cover ? store.filePath(meta, cover.path) : null;
    const body = cover && path ? await readFile(path).catch(() => null) : null;
    if (!cover || !body || body.byteLength > COVER_MAX_BYTES || !looksLike(cover.mime, body)) {
      // No usable image: serve the same drawn placeholder the directory shows.
      const team = (await directory()).teams.find((t) => t.sites.some((x) => x.id === id));
      const title = team?.sites.find((x) => x.id === id)?.title || meta.title || id;
      const svg = placeholderSvg(title, team?.id ?? id);
      c.header("Cache-Control", "public, max-age=300");
      c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      c.header("Cross-Origin-Resource-Policy", "same-origin");
      c.header("Content-Type", "image/svg+xml; charset=utf-8");
      c.header("Content-Disposition", "inline");
      return c.body(svg);
    }
    const etag = `"${createHash("sha256").update(`${meta.updatedAt}:${cover.path}`).digest("hex").slice(0, 16)}"`;
    c.header("ETag", etag);
    c.header("Cache-Control", "public, max-age=300");
    c.header("Content-Security-Policy", "default-src 'none'; sandbox");
    c.header("Cross-Origin-Resource-Policy", "same-origin");
    if (c.req.header("if-none-match") === etag) return c.body(null, 304);
    c.header("Content-Type", cover.mime);
    c.header("Content-Disposition", "inline");
    return c.body(new Uint8Array(body) as unknown as ArrayBuffer);
  });

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
    if (
      status === 200 &&
      c.req.method === "GET" &&
      h.get("Content-Type")?.startsWith("text/html")
    ) {
      const purpose = `${c.req.header("sec-purpose") ?? ""} ${c.req.header("purpose") ?? ""} ${c.req.header("x-moz") ?? ""}`;
      if (!/prefetch|prerender/i.test(purpose)) {
        visits.record(id, {
          ip:
            (config.trustProxy && c.req.header("cf-connecting-ip")?.trim()) ||
            clientIp(c, config.trustProxy),
          ua: c.req.header("user-agent") ?? "",
          noTrack: c.req.header("dnt") === "1" || c.req.header("sec-gpc") === "1",
        });
      }
    }
    return new Response(body, { status, headers: h });
  });

  app.notFound((c) =>
    c.req.path.startsWith("/api/")
      ? apiError(c, 404, "NOT_FOUND", "no such route")
      : appPage(c, notFoundHtml(langOf(c), config), 404),
  );

  return app;
}
