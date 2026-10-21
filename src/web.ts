import { randomBytes } from "node:crypto";
import type { Context, Hono, MiddlewareHandler } from "hono";
import {
  ACTIVITY_MAX,
  activityRow,
  queryActivity,
  readActivityQuery,
  sendActivity,
} from "./activity-export.js";
import { AgentKeyError, type AgentKeyStore } from "./agent-keys.js";
import { NoteError, type NoteStore } from "./agent-notes.js";
import { probeBackend } from "./backend/health.js";
import type { SiteBackend } from "./backend/types.js";
import type { BackupService } from "./backup.js";
import { APP_VERSION } from "./brand.js";
import type { PermReport } from "./cf-permissions.js";
import { clientIp } from "./client-ip.js";
import type { Config } from "./config.js";
import { UploadError } from "./errors.js";
import { actorText, type Lang, STRINGS } from "./i18n.js";
import type { UploadEntry } from "./ingest.js";
import { addMcpToken, cleanTokenName, MAX_MCP_TOKENS } from "./mcp.js";
import {
  type Actor,
  type AuditEntry,
  burnPasswordCheck,
  cleanMemberName,
  cleanUsername,
  isRole,
  MAX_INVITES,
  MAX_MEMBERS,
  type Member,
  type MemberRole,
  MemberStore,
  passwordProblem,
  roleRank,
  verifyPassword,
} from "./members.js";
import { type NotificationCenter, PLATFORM, WebhookError } from "./notify.js";
import type { RateLimiter } from "./rate-limit.js";
import {
  RecipeError,
  type RecipeStore,
  recipeHtml,
  recipeSkeleton,
  servedLang,
  summaryOf,
} from "./recipes.js";
import { type RepoChecker, RepoError, type RepoLink, readRepo } from "./repo-status.js";
import { fingerprint, type Session, type Sessions, sameOrigin } from "./session.js";
import type { SiteMeta, SiteStore } from "./store.js";
import { type TeamLifecycle, TeamLifecycleError } from "./team-lifecycle.js";
import { cleanTeamName, type Team, type TeamPatch, type TeamStore } from "./teams.js";
import { hashToken, newEditToken, safeEqual } from "./tokens.js";
import {
  ADMIN_CTX,
  type AdminSiteRow,
  type AdminStats,
  type AuditView,
  adminActivityHtml,
  adminNotificationsHtml,
  adminSettingsHtml,
  adminSitesHtml,
  adminTeamsHtml,
  adminWorkersHtml,
  bellHtml,
  dashRecipeHtml,
  dashRecipesHtml,
  type Flash,
  joinHtml,
  K14,
  localePath,
  loginHtml,
  membersHtml,
  messageHtml,
  R14,
  type TeamSiteRow,
  teamActivityHtml,
  teamAgentsHtml,
  teamCtx,
  teamHtml,
  teamNotificationsHtml,
  teamSettingsHtml,
  teamSitesHtml,
  teamUploader,
  teamWorkersHtml,
  V14,
  WS,
} from "./ui.js";
import {
  adminTeamHtml,
  type BackendBrowser,
  DX,
  siteDetailHtml,
  workerDetailHtml,
} from "./ui-detail.js";
import { type InsightRow, IX, mcpServersHtml } from "./ui-insight.js";
import {
  backupsSection,
  lifecycleText,
  signOutAllSection,
  teamExportSection,
  trashSection,
} from "./ui-lifecycle.js";
import { NX, notesHtml } from "./ui-notes.js";
import { intervalForm, OX, permsSection } from "./ui-ops.js";
import type { UserKeyOps } from "./user-key-routes.js";
import { UserKeyError, type UserKeyStore } from "./user-keys.js";
import type { VisitCounter, VisitSummary } from "./visits.js";
import { healthRule } from "./worker-health.js";
import { insightOf, type ProbeCache, stackLabel } from "./worker-insight.js";
import type { WorkerOps } from "./worker-ops.js";
import { versionMeta } from "./worker-versions.js";
import {
  PLATFORM_AUDIT,
  WorkerError,
  type WorkerRec,
  type WorkerService,
  workerView,
} from "./workers.js";
import {
  ADMIN_ACTOR,
  applyTeamWorkers,
  codeDownload,
  readTeamWorkers,
  teamWorkersInfo,
} from "./workers-routes.js";

const ACTIVITY_KINDS = ["member", "key", "api", "mcp", "admin"] as const;
/** A valid actor-kind filter from a query string, or "" for all. */
const activityKind = (raw: string | undefined): string =>
  (ACTIVITY_KINDS as readonly string[]).includes(raw ?? "") ? (raw as string) : "";
/** Free-text match on an activity entry (who, what, detail, site), case-insensitive. */
function matchesAudit(e: AuditView, q: string, lang: Lang): boolean {
  if (!q) return true;
  const n = q.toLowerCase();
  const t = STRINGS[lang].members;
  return [
    e.who,
    actorText(lang, e.who),
    e.action,
    t.actions[e.action] ?? "",
    e.detail ?? "",
    e.site?.title ?? "",
  ].some((x) => x.toLowerCase().includes(n));
}

export interface WebDeps {
  config: Config;
  store: SiteStore;
  teams: TeamStore;
  backend: SiteBackend | null;
  sessions: Sessions;
  limiter: RateLimiter;
  now: () => number;
  appPage: (c: Context, html: string, status?: number) => Response;
  uploadLimit: MiddlewareHandler;
  uploadRate: (c: Context) => Promise<Response | null>;
  readUpload: (c: Context) => Promise<{ entries: UploadEntry[]; ttl?: unknown }>;
  createSite: (
    entries: UploadEntry[],
    ttl: unknown,
    team: Team | null,
  ) => Promise<{ meta: SiteMeta; token: string }>;
  replaceSite: (meta: SiteMeta, entries: UploadEntry[]) => Promise<SiteMeta>;
  extendSite: (meta: SiteMeta, ttl: unknown) => Promise<SiteMeta>;
  deleteSite: (id: string) => Promise<void>;
  ceilingOf: (meta: SiteMeta) => number;
  setPermanent: (meta: SiteMeta, on: boolean) => Promise<SiteMeta>;
  quotaOf: (team: Team) => { sites: number; bytes: number };
  usageOf: (team: Team, except?: string) => Promise<{ sites: number; bytes: number }>;
  visits: VisitCounter;
  members: MemberStore;
  audit: (e: Omit<AuditEntry, "at" | "teamId"> & { teamId?: string }) => Promise<void>;
  siteUrl: (id: string) => string;
  invalidateDirectory: () => void;
  siteCounts: () => Promise<Map<string, number>>;
  workers: WorkerService;
  agentKeys: AgentKeyStore;
  notify: NotificationCenter;
  recipes: RecipeStore;
  userKeys: UserKeyStore;
  userKeyOps: UserKeyOps;
  /** Preview image of a space for the dashboard: its cover, or the drawn placeholder. */
  previewImage?: (
    m: SiteMeta,
    teamId: string | null,
  ) => Promise<{ type: string; body: Uint8Array | string }>;
  /** 0.15.1: cached read-only MCP tools/list probes and GitHub repo checks. */
  mcpProbe?: ProbeCache;
  /** Agent notes (0.15.1). */
  notes?: NoteStore;
  repoChecker?: RepoChecker;
  /** 0.15.2: env view, health, analytics/logs, permission checklists. */
  ops?: WorkerOps;
  /** 0.16.0: team export, trash and restore. */
  lifecycle?: TeamLifecycle;
  /** 0.16.0: daily encrypted backups. */
  backups?: BackupService | null;
}

/** "NAME=value" lines into an object (blank lines and # comments skipped). */
function envLines(raw: string): Record<string, string> | string {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;
    const i = l.indexOf("=");
    if (i < 1) return l.slice(0, 40);
    out[l.slice(0, i).trim()] = l.slice(i + 1);
  }
  return out;
}

const LOGIN_WINDOW = 15 * 60_000;
const FLASH_TTL = 5 * 60_000;
const KV_PREVIEW = 20;
const VALUE_PREVIEW = 160;
const VALUE_FULL = 6000;

/** One KV row for the dashboard: a one-line preview plus a pretty-printed (capped) full value. */
function kvRow(key: string, v: string | undefined) {
  if (v === undefined) return { key };
  let pretty = v;
  try {
    pretty = JSON.stringify(JSON.parse(v), null, 2);
  } catch {
    // stored values are JSON; fall back to the raw text
  }
  const oneLine = v.replace(/\s+/g, " ");
  return {
    key,
    bytes: Buffer.byteLength(v),
    preview: oneLine.length > VALUE_PREVIEW ? `${oneLine.slice(0, VALUE_PREVIEW)}…` : oneLine,
    full: pretty.length > VALUE_FULL ? `${pretty.slice(0, VALUE_FULL)}\n…` : pretty,
    truncated: pretty.length > VALUE_FULL,
  };
}

/**
 * Browser routes: team sign-in and dashboard (/login, /team) and the admin
 * console (/admin/login, /admin, /admin/sites), in English and under /ar.
 *
 * Everything is server-rendered HTML with plain forms (works without
 * JavaScript); the page script only adds drag-and-drop, folder uploads,
 * confirmations and copy buttons. Every POST checks the Origin and a CSRF
 * token, and answers with a 303 redirect (or JSON when the script asks).
 */
export function mountWebRoutes(app: Hono, d: WebDeps): void {
  const { config, store, teams, backend, sessions, limiter, now } = d;

  // ---- one-shot flash messages, bound to the session that caused them ------
  const flashes = new Map<string, { flash: Flash; sid: string; exp: number }>();
  const putFlash = (s: Session, flash: Flash): string => {
    const t = now();
    for (const [k, v] of flashes) if (v.exp <= t) flashes.delete(k);
    const id = randomBytes(9).toString("base64url");
    flashes.set(id, { flash, sid: s.sid, exp: t + FLASH_TTL });
    return id;
  };
  const takeFlash = (c: Context, s: Session): Flash | null => {
    const id = c.req.query("f");
    if (!id) return null;
    const v = flashes.get(id);
    if (!v || v.sid !== s.sid || v.exp <= now()) return null;
    flashes.delete(id);
    return v.flash;
  };

  const page = (c: Context, html: string, status = 200) => {
    // The bell in the dashboard top bar: unread notifications for owners and the admin.
    const bell = /<!--marsa:bell:(team|admin):(en|ar)-->/.exec(html);
    if (bell) {
      const [mark, kind, bl] = bell as unknown as [string, "team" | "admin", Lang];
      let out = "";
      if (kind === "admin" && adminSession(c))
        out = bellHtml(bl, "admin", d.notify.unread(null, null));
      if (kind === "team") {
        const ts = teamSession(c);
        if (ts && ts.role === "owner") {
          out = bellHtml(bl, "team", d.notify.unread(ts.team.id, ts.member?.id ?? "key"));
        }
      }
      html = html.replace(mark, out);
    }
    const res = d.appPage(c, html, status);
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    return res;
  };
  const wantsJson = (c: Context) => (c.req.header("accept") ?? "").includes("application/json");

  /** Redirect after a POST (or JSON for the page script). */
  /**
   * 0.15.0: a form may say where to go back to (`back` = a dashboard path), so actions on
   * a detail page return to that page. Only same-site dashboard paths are accepted.
   */
  const backTo = new WeakMap<Context, string>();
  const safeBack = (raw: string): string | null =>
    /^\/(ar\/)?(team|admin)(\/[A-Za-z0-9._~\-/]*)?(\?[A-Za-z0-9=&_-]*)?$/.test(raw) &&
    !raw.includes("//") &&
    !raw.includes("..")
      ? raw
      : null;
  const done = (c: Context, s: Session, target: string, flash?: Flash) => {
    const to = backTo.get(c) ?? target;
    const hashAt = to.indexOf("#");
    const path = hashAt < 0 ? to : to.slice(0, hashAt);
    const hash = hashAt < 0 ? "" : to.slice(hashAt);
    const url = flash
      ? `${path}${path.includes("?") ? "&" : "?"}f=${putFlash(s, flash)}${hash}`
      : to;
    if (wantsJson(c)) return c.json({ ok: flash?.kind !== "err", redirect: url });
    return c.redirect(url, 303);
  };

  const formOf = async (c: Context): Promise<FormData | null> => {
    const type = (c.req.header("content-type") ?? "").toLowerCase();
    if (
      !type.startsWith("application/x-www-form-urlencoded") &&
      !type.startsWith("multipart/form-data")
    ) {
      return null;
    }
    try {
      return await c.req.formData();
    } catch {
      return null;
    }
  };
  const field = (f: FormData | null, k: string) => {
    const v = f?.get(k);
    return typeof v === "string" ? v : "";
  };

  const forbidden = (c: Context, lang: Lang, back: string) => {
    const t = STRINGS[lang];
    if (wantsJson(c)) return c.json({ error: { code: "CSRF", message: t.badRequest } }, 403);
    return page(
      c,
      messageHtml(lang, config, "403", t.badRequest, "", {
        href: back,
        label: t.common.cancel,
      }),
      403,
    );
  };

  /** Origin + CSRF check for a signed-in POST. Returns the parsed form. */
  async function guardPost(
    c: Context,
    s: Session,
    lang: Lang,
    back: string,
  ): Promise<FormData | Response> {
    if (!sameOrigin(c, config.publicUrl)) return forbidden(c, lang, back);
    const form = await formOf(c);
    const token = c.req.header("x-csrf-token") || field(form, "_csrf");
    if (!sessions.checkCsrf(s, token)) return forbidden(c, lang, back);
    const wanted = safeBack(field(form, "back"));
    if (wanted) backTo.set(c, wanted);
    return form ?? new FormData();
  }

  const loginRate = (c: Context) =>
    limiter.hit(
      `login:${clientIp(c, config.trustProxy)}`,
      config.sessions.loginAttemptsPer15Min,
      LOGIN_WINDOW,
    );

  // ---- who is signed in -----------------------------------------------------------
  const { members } = d;
  /** Session fingerprint of a member: a password change, "sign out everywhere" or removal ends it. */
  const memberFp = (m: Member) => fingerprint(`member:${m.id}:${m.passwordHash}:${m.epoch}`);
  interface TeamCtx {
    s: Session;
    team: Team;
    member: Member | null;
    role: MemberRole;
    actor: Actor;
  }
  function teamSession(c: Context): TeamCtx | null {
    const s = sessions.read(c);
    if (s?.role !== "team") return null;
    const team = teams.get(s.teamId);
    if (!team) return null;
    if (s.memberId) {
      const m = members.get(s.memberId);
      if (!m || m.teamId !== team.id || !safeEqual(s.fp, memberFp(m))) return null;
      return {
        s,
        team,
        member: m,
        role: m.role,
        actor: { kind: "member", label: m.name, memberId: m.id },
      };
    }
    // Team-key sign-in acts as an owner. A rotated key or a deleted team ends the session.
    if (!safeEqual(s.fp, fingerprint(team.keyHash))) return null;
    return { s, team, member: null, role: "owner", actor: { kind: "key", label: "team key" } };
  }
  const meOf = (ts: TeamCtx) => ({
    name: ts.member?.name ?? "",
    role: ts.role,
    viaKey: !ts.member,
  });
  const auditView = (e: AuditEntry, titles?: Map<string, string>): AuditView => ({
    at: e.at,
    who: e.actor.label,
    kind: e.actor.kind,
    action: e.action,
    ...(e.detail ? { detail: e.detail } : {}),
    ...(e.siteId
      ? {
          site: titles?.has(e.siteId)
            ? { id: e.siteId, title: titles.get(e.siteId) ?? e.siteId }
            : null,
        }
      : {}),
  });
  function adminSession(c: Context): Session | null {
    const s = sessions.read(c);
    if (s?.role !== "admin" || !config.adminToken) return null;
    return safeEqual(s.fp, fingerprint(config.adminToken)) ? s : null;
  }

  const teamRow = (m: SiteMeta, team: Team): TeamSiteRow => ({
    id: m.id,
    title: m.title || m.id,
    url: d.siteUrl(m.id),
    createdAt: m.createdAt,
    expiresAt: m.expiresAt,
    totalBytes: m.totalBytes,
    fileCount: m.fileCount,
    listed: team.directory && !m.unlisted,
    unlisted: !!m.unlisted,
    permanent: !!m.permanent,
    ...repoOfSite(m),
  });
  // 0.15.1: a space's linked repo and its cached (background) GitHub status.
  function repoOfSite(m: SiteMeta) {
    if (!m.repo) return {};
    d.repoChecker?.touch(m.repo);
    return { repo: m.repo, repoStatus: d.repoChecker?.get(m.repo) ?? null };
  }
  const withVisits = async <T extends { id: string; visits?: VisitSummary }>(rows: T[]) => {
    if (!d.visits.enabled) return rows;
    await Promise.all(
      rows.map(async (r) => {
        r.visits = await d.visits.summary(r.id);
      }),
    );
    return rows;
  };
  const teamInfo = async (team: Team) => ({
    team,
    quota: d.quotaOf(team),
    usage: await d.usageOf(team),
  });

  const live = (m: SiteMeta) => Date.parse(m.expiresAt) > now();

  // ---- 0.15.1: what each Worker is (type, stack, tools), its repo and its space ----------
  const codeCache = new Map<string, string | null>();
  const latestCode = async (r: WorkerRec): Promise<string | null> => {
    const k = `${r.id}@${r.version ?? 0}`;
    if (codeCache.has(k)) return codeCache.get(k) ?? null;
    const v = r.version ? await d.workers.getVersion(r, r.version).catch(() => null) : null;
    codeCache.set(k, v?.code ?? null);
    return v?.code ?? null;
  };
  const slugOf = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  /** Manual link, then declared spaceSlug (a space id), then a space titled like the Worker. */
  const spaceOf = (r: WorkerRec, sites: SiteMeta[], admin: boolean): InsightRow["space"] => {
    const mine = sites.filter((m) => m.teamId === r.teamId && live(m));
    const pick = (m: SiteMeta | undefined, how: "manual" | "declared" | "name") =>
      m
        ? {
            id: m.id,
            title: m.title || m.id,
            href: admin ? `/admin/sites/${m.id}` : `/team/sites/${m.id}`,
            url: d.siteUrl(m.id),
            how,
          }
        : null;
    if (r.spaceId) {
      const m = mine.find((x) => x.id === r.spaceId);
      if (m) return pick(m, "manual");
    }
    if (r.meta?.spaceSlug) {
      const m = mine.find((x) => x.id === r.meta?.spaceSlug);
      if (m) return pick(m, "declared");
    }
    return pick(
      mine.find(
        (x) => x.title && (slugOf(x.title) === r.name || slugOf(x.title).startsWith(`${r.name}-`)),
      ),
      "name",
    );
  };
  const insightRow = async (
    r: WorkerRec,
    sites: SiteMeta[],
    admin: boolean,
  ): Promise<InsightRow> => {
    const code = await latestCode(r);
    const probe = d.mcpProbe?.get(r.id, r.version) ?? null;
    const ins = insightOf(r.meta, code, r.url, probe);
    if (ins.endpoint && r.status === "active" && ins.source.tools !== "declared")
      d.mcpProbe?.touch(r.id, r.version, ins.endpoint);
    d.repoChecker?.touch(r.repo);
    return {
      kind: ins.kind,
      kindSource: ins.source.kind,
      language: ins.language,
      stack: stackLabel(ins),
      toolsCount: ins.toolsCount,
      toolsSource: ins.source.tools,
      toolNames: ins.toolNames,
      endpoint: ins.endpoint,
      probeAt: probe?.at ?? null,
      probeNote:
        probe && !probe.ok
          ? (probe.note ?? (probe.status ? `HTTP ${probe.status}` : "error"))
          : null,
      repo: r.repo ?? null,
      repoStatus: d.repoChecker?.get(r.repo) ?? null,
      space: spaceOf(r, sites, admin),
    };
  };
  /** The dashboard preview image (private: only for signed-in viewers of the space). */
  const previewResponse = async (c: Context, m: SiteMeta, team: Team | null) => {
    if (!d.previewImage) return c.body(null, 404);
    const img = await d.previewImage(m, team?.id ?? null);
    c.header("Content-Type", img.type);
    c.header("Cache-Control", "private, max-age=300");
    c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cross-Origin-Resource-Policy", "same-origin");
    return c.body(img.body as never);
  };

  for (const prefix of ["", "/ar"] as const) {
    const lang: Lang = prefix ? "ar" : "en";
    const t = STRINGS[lang];
    const href = (p: string) => localePath(lang, p);

    // ---- team sign-in -------------------------------------------------------------
    app.get(`${prefix}/login`, (c) => {
      if (teamSession(c)) return c.redirect(href("/team"), 303);
      const notice = c.req.query("out") ? t.login.signedOut : undefined;
      const error = c.req.query("expired") ? t.login.expired : undefined;
      return page(
        c,
        loginHtml(lang, config, { kind: "team", csrf: sessions.loginCsrf(c), notice, error }),
      );
    });

    app.post(`${prefix}/login`, async (c) => {
      const render = (error: string, status: number) =>
        page(
          c,
          loginHtml(lang, config, { kind: "team", csrf: sessions.loginCsrf(c), error }),
          status,
        );
      const r = loginRate(c);
      if (!r.allowed) {
        c.header("Retry-After", String(r.retryAfterSec));
        return render(t.login.limited, 429);
      }
      const form = await formOf(c);
      if (!sameOrigin(c, config.publicUrl) || !sessions.checkLoginCsrf(c, field(form, "_csrf"))) {
        return render(t.login.csrf, 403);
      }
      if (form?.has("username")) {
        const username = cleanUsername(field(form, "username"));
        const pw = field(form, "password");
        const m = username ? members.byUsername(username) : null;
        if (!m || !teams.get(m.teamId)) {
          await burnPasswordCheck(pw);
          return render(t.members.invalidMember, 401);
        }
        if (!(await verifyPassword(pw, m.passwordHash)))
          return render(t.members.invalidMember, 401);
        const fresh = (await members.touchLogin(m.id)) ?? m;
        sessions.start(c, "team", memberFp(fresh), fresh.teamId, fresh.id);
        await d.audit({
          teamId: fresh.teamId,
          actor: { kind: "member", label: fresh.name, memberId: fresh.id },
          action: "sign-in",
        });
        return c.redirect(href("/team"), 303);
      }
      const team = teams.byTeamKey(field(form, "key").trim());
      if (!team) return render(t.login.invalid, 401);
      sessions.start(c, "team", fingerprint(team.keyHash), team.id);
      return c.redirect(href("/team"), 303);
    });

    app.post(`${prefix}/logout`, async (c) => {
      const s = sessions.read(c);
      if (s) {
        const form = await formOf(c);
        if (!sameOrigin(c, config.publicUrl) || !sessions.checkCsrf(s, field(form, "_csrf"))) {
          return forbidden(c, lang, href("/"));
        }
        sessions.end(c, s);
        return c.redirect(href(s.role === "admin" ? "/admin/login?out=1" : "/login?out=1"), 303);
      }
      return c.redirect(href("/login"), 303);
    });

    // ---- team dashboard -----------------------------------------------------------
    const needTeam = (c: Context, min: MemberRole = "viewer"): TeamCtx | Response => {
      const ts = teamSession(c);
      if (ts) {
        if (roleRank[ts.role] >= roleRank[min]) return ts;
        if (wantsJson(c)) {
          return c.json({ error: { code: "FORBIDDEN", message: t.members.notAllowed } }, 403);
        }
        return done(c, ts.s, href("/team"), { kind: "err", text: t.members.notAllowed });
      }
      if (wantsJson(c)) {
        return c.json({ error: { code: "UNAUTHORIZED", message: t.login.expired } }, 401);
      }
      return c.redirect(href(sessions.hasCookie(c) ? "/login?expired=1" : "/login"), 303);
    };
    const ownSite = async (c: Context, team: Team) => {
      const m = await store.get(c.req.param("id") ?? "");
      return m && m.teamId === team.id && live(m) ? m : null;
    };
    const notYours = (c: Context, s: Session) =>
      done(c, s, href("/team"), { kind: "err", text: t.team.notYours });
    const uploadErr = (err: unknown): string => {
      if (err instanceof UploadError)
        return err.path ? `${err.message} (${err.path})` : err.message;
      throw err;
    };

    const teamSites = async (team: Team) => {
      const sites = (await store.list())
        .filter((m) => m.teamId === team.id && live(m))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((m) => teamRow(m, team));
      await withVisits(sites);
      return sites;
    };
    const siteTitles = async (team: Team) =>
      new Map(
        (await store.list())
          .filter((m) => m.teamId === team.id)
          .map((m) => [m.id, m.title || m.id]),
      );
    const workersSummary = (team: Team) => {
      const enabled = d.workers.enabledFor(team);
      return {
        enabled,
        count: d.workers.list(team.id).length,
        max: d.workers.quotaOf(team).workers,
        kb: d.workers.quotaOf(team).kb,
      };
    };

    /** Data for a Worker detail page (team and admin views share it). */
    const workerDetailData = async (
      rec: NonNullable<ReturnType<typeof d.workers.find>>,
      tab: string,
      admin = false,
      c?: Context,
    ) => {
      const q = (k: string) => c?.req.query(k) ?? "";
      const ops = d.ops;
      const opsData: NonNullable<Parameters<typeof workerDetailHtml>[2]["ops"]> = {};
      if (ops) {
        opsData.healthCell = ops.health.cell(rec.id);
        const refresh = q("refresh") === "1";
        if (tab === "env") {
          opsData.env = await ops.envView(rec, refresh);
          const name = q("name");
          if (/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) opsData.prefill = name;
        } else if (tab === "health") {
          opsData.health = ops.health.view(rec.id);
          opsData.healthTarget = {
            path: rec.meta?.healthPath ?? "",
            expect: rec.meta?.healthExpect ?? "",
          };
        } else if (tab === "logs")
          opsData.logs = await ops.analytics.logs(rec.script, !!rec.logs, refresh);
        else if (tab === "usage") {
          const range = (["24h", "7d", "30d"] as const).find((r) => r === q("range")) ?? "24h";
          opsData.usage = {
            range,
            series: await ops.analytics.usage(rec.script, range, refresh),
            keys: ops.keyUsage(rec, range === "30d" ? 30 : range === "7d" ? 7 : 1),
          };
        }
      }
      const allSites = await store.list();
      const insight = await insightRow(rec, allSites, admin);
      const spaces = allSites
        .filter((m) => m.teamId === rec.teamId && live(m))
        .map((m) => ({ id: m.id, title: m.title || m.id }));
      const versions = (await d.workers.listVersions(rec)).map(versionMeta);
      const latest = versions.length ? await d.workers.getVersion(rec, versions[0]?.n ?? 0) : null;
      const keys = await d.userKeyOps.view(rec);
      const nameRe = new RegExp(`^${rec.name.replace(/[^a-z0-9-]/g, "")}($|[ :])`);
      const audit = members
        .entries(rec.teamId, undefined, 300)
        .filter((e) => /^(worker-|user-key)/.test(e.action) && nameRe.test(e.detail ?? ""))
        .slice(0, 100)
        .map((e) => auditView(e));
      const view = workerView(rec);
      return {
        worker: view,
        disabledBy: rec.status === "disabled" ? (rec.disabledBy ?? "admin") : null,
        versions,
        // The live check runs on the overview only (it calls the Worker).
        health:
          tab === "overview" || tab === ""
            ? rec.status === "active"
              ? await d.workers.probe(rec)
              : null
            : null,
        mcp:
          insight.endpoint ??
          (latest && rec.url && /["'`]\/mcp\b/.test(latest.code)
            ? `${rec.url.replace(/\/$/, "")}/mcp`
            : null),
        insight,
        spaces,
        keys: {
          settings: keys.settings,
          keys: keys.keys,
          verifyUrl: keys.verifyUrl,
          helperUrl: keys.helperUrl,
        },
        audit,
        teamWorkers: d.workers.list(rec.teamId).map((w) => w.name),
        ops: opsData,
      };
    };

    app.get(`${prefix}/team`, async (c) => {
      const ts = needTeam(c);
      if (ts instanceof Response) return ts;
      const { s, team } = ts;
      const sites = await teamSites(team);
      const titles = new Map(sites.map((x) => [x.id, x.title]));
      return page(
        c,
        teamHtml(lang, config, {
          ...(await teamInfo(team)),
          me: meOf(ts),
          backendConfigured: !!backend,
          sites,
          csrf: sessions.csrfFor(s),
          flash: takeFlash(c, s),
          overview: {
            audit: members.entries(team.id, undefined, 8).map((e) => auditView(e, titles)),
            members: members.count(team.id),
            invites: members.listInvites(team.id).length,
            workers: workersSummary(team),
          },
        }),
      );
    });

    app.get(`${prefix}/team/sites`, async (c) => {
      const ts = needTeam(c);
      if (ts instanceof Response) return ts;
      const { s, team } = ts;
      return page(
        c,
        teamSitesHtml(lang, config, {
          ...(await teamInfo(team)),
          me: meOf(ts),
          backendConfigured: !!backend,
          sites: await teamSites(team),
          csrf: sessions.csrfFor(s),
          flash: takeFlash(c, s),
        }),
      );
    });

    app.get(`${prefix}/team/activity/export`, async (c) => {
      const ts = needTeam(c);
      if (ts instanceof Response) return ts;
      const { query, format } = readActivityQuery((k) => c.req.query(k));
      const rows = queryActivity(members, [ts.team.id], { ...query, limit: ACTIVITY_MAX }).map(
        (e) => activityRow(e),
      );
      return sendActivity(
        c,
        rows,
        format === "json" ? "csv" : format,
        `activity-${ts.team.slug ?? ts.team.id}`,
      );
    });

    app.get(`${prefix}/team/activity`, async (c) => {
      const ts = needTeam(c);
      if (ts instanceof Response) return ts;
      const { s, team } = ts;
      const kind = activityKind(c.req.query("kind"));
      const q = (c.req.query("q") ?? "").trim().slice(0, 80);
      const titles = await siteTitles(team);
      const audit = members
        .entries(team.id, undefined, 1000)
        .map((e) => auditView(e, titles))
        .filter((e) => (!kind || e.kind === kind) && matchesAudit(e, q, lang))
        .slice(0, 300);
      return page(
        c,
        teamActivityHtml(lang, config, {
          ...(await teamInfo(team)),
          me: meOf(ts),
          backendConfigured: !!backend,
          sites: [],
          audit,
          kind,
          q,
          csrf: sessions.csrfFor(s),
          flash: takeFlash(c, s),
        }),
      );
    });

    app.get(`${prefix}/team/settings`, async (c) => {
      const ts = needTeam(c);
      if (ts instanceof Response) return ts;
      const { s, team } = ts;
      return page(
        c,
        teamSettingsHtml(lang, config, {
          ...(await teamInfo(team)),
          me: meOf(ts),
          backendConfigured: !!backend,
          sites: [],
          meId: ts.member?.id ?? null,
          keyPrefix: team.keyPrefix,
          slug: team.slug ?? null,
          workers: workersSummary(team),
          extra:
            ts.role === "owner"
              ? teamExportSection(lang, href("/team/settings/export")) +
                signOutAllSection(
                  lang,
                  href("/team/settings/signout-everyone"),
                  sessions.csrfFor(s),
                  "team",
                  sessions.endedAllAt(`team:${team.id}`),
                )
              : "",
          csrf: sessions.csrfFor(s),
          flash: takeFlash(c, s),
        }),
      );
    });

    app.post(`${prefix}/team/sites`, d.uploadLimit, async (c) => {
      const ts = needTeam(c, "editor");
      if (ts instanceof Response) return ts;
      const { s, team } = ts;
      const form = await guardPost(c, s, lang, href("/team"));
      if (form instanceof Response) return form;
      const limited = await d.uploadRate(c);
      if (limited) return done(c, s, href("/team"), { kind: "err", text: t.tooMany });
      try {
        const { entries, ttl } = await d.readUpload(c);
        const { meta } = await d.createSite(entries, ttl, team);
        await d.audit({
          teamId: team.id,
          siteId: meta.id,
          actor: ts.actor,
          action: "publish",
          detail: meta.title,
        });
        return done(c, s, href("/team"), {
          kind: "ok",
          text: t.team.published,
          link: d.siteUrl(meta.id),
        });
      } catch (err) {
        return done(c, s, href("/team"), { kind: "err", text: uploadErr(err) });
      }
    });

    /** Everything a space detail page shows (team and admin views share it). */
    const siteDetailData = async (m: SiteMeta, team: Team | null) => {
      let backendBrowser: BackendBrowser = {
        state: "off",
        ...(team?.backend && !backend ? { reason: t.team.backendNotConfigured } : {}),
      };
      if (backend && (team?.backend || config.backend.guestAccess)) {
        const base = `${config.publicUrl}/api/sites/${m.id}/files`;
        try {
          const [keys, files] = await Promise.all([
            backend.kvList(m.id, config.backend.maxKeys),
            backend.filesList(m.id, config.backend.maxFiles),
          ]);
          const shown = keys.slice(0, KV_PREVIEW);
          const values = await Promise.all(shown.map((k) => backend.kvGet(m.id, k)));
          backendBrowser = {
            state: "on",
            kv: shown.map((key, i) => kvRow(key, values[i])),
            totalKeys: keys.length,
            otherKeys: keys.slice(shown.length),
            moreKeys: Math.max(0, keys.length - shown.length),
            files: files.map((f) => ({ ...f, url: `${base}/${f.id}` })),
          };
        } catch (err) {
          console.error(`[dashboard] backend read for ${m.id} failed`, err);
          backendBrowser = {
            state: "on",
            kv: [],
            totalKeys: 0,
            otherKeys: [],
            moreKeys: 0,
            files: [],
            error: t.team.failed,
          };
        }
      }
      const row = team
        ? teamRow(m, team)
        : { ...teamRow(m, { directory: false } as Team), listed: false };
      const site = {
        ...row,
        visits: d.visits.enabled ? await d.visits.summary(m.id) : undefined,
        files: Object.entries(m.files)
          .map(([p, f]) => [p, f.size] as [string, number])
          .sort((a, b) => a[0].localeCompare(b[0])),
        ceiling: new Date(d.ceilingOf(m)).toISOString(),
      };
      const mcp = {
        endpoint: `${config.publicUrl}/mcp/s/${m.id}`,
        tokens: (m.mcpTokens ?? []).map(({ id, name, scope, prefix, createdAt }) => ({
          id,
          name,
          scope,
          prefix,
          createdAt,
        })),
      };
      const audit = team ? members.entries(team.id, m.id, 50).map((e) => auditView(e)) : [];
      return { site, backendBrowser, mcp, audit };
    };
    const previewVersion = (m: SiteMeta) => encodeURIComponent(m.updatedAt);

    app.get(`${prefix}/team/spaces/:id`, (c) =>
      c.redirect(href(`/team/sites/${encodeURIComponent(c.req.param("id") ?? "")}`), 301),
    );
    app.get(`${prefix}/team/sites/:id`, async (c) => {
      const ts = needTeam(c);
      if (ts instanceof Response) return ts;
      const { s, team } = ts;
      const m = await ownSite(c, team);
      if (!m) return notYours(c, s);
      const data = await siteDetailData(m, team);
      const editor = roleRank[ts.role] >= roleRank.editor;
      const csrf = sessions.csrfFor(s);
      return page(
        c,
        siteDetailHtml(lang, config, {
          kind: "team",
          tab: c.req.query("tab") ?? "overview",
          base: `/team/sites/${m.id}`,
          ctx: teamCtx(lang, { team, me: meOf(ts) }),
          csrf,
          flash: takeFlash(c, s),
          canEdit: editor,
          owner: { id: team.id, name: team.name },
          teamPermanent: team.permanent,
          teamDirectory: team.directory,
          ...data,
          preview: href(`/team/sites/${m.id}/preview?v=${previewVersion(m)}`),
          replaceForm: editor
            ? teamUploader(
                lang,
                config,
                csrf,
                href(`/team/sites/${m.id}/replace`),
                t.team.replace,
                t.team.replaceHelp,
                t.team.replace,
                false,
                true,
              )
            : "",
        }),
      );
    });
    app.get(`${prefix}/team/sites/:id/preview`, async (c) => {
      const ts = teamSession(c);
      if (!ts) return c.body(null, 404);
      const m = await ownSite(c, ts.team);
      if (!m) return c.body(null, 404);
      return previewResponse(c, m, ts.team);
    });

    /** A POST on one of the team's own sites. */
    const sitePost = (
      path: string,
      fn: (
        c: Context,
        ctx: {
          s: Session;
          team: Team;
          m: SiteMeta;
          form: FormData;
          back: string;
          log: (action: string, detail?: string) => void;
        },
      ) => Promise<Response>,
      upload = false,
    ) => {
      const handler = async (c: Context) => {
        const ts = needTeam(c, "editor");
        if (ts instanceof Response) return ts;
        const { s, team } = ts;
        const back = href(`/team/sites/${c.req.param("id")}`);
        const form = await guardPost(c, s, lang, back);
        if (form instanceof Response) return form;
        const m = await ownSite(c, team);
        if (!m) return notYours(c, s);
        const log = (action: string, detail?: string) =>
          d.audit({
            teamId: team.id,
            siteId: m.id,
            actor: ts.actor,
            action,
            ...(detail ? { detail } : {}),
          });
        return fn(c, { s, team, m, form, back, log });
      };
      if (upload) app.post(`${prefix}/team/sites/:id/${path}`, d.uploadLimit, handler);
      else app.post(`${prefix}/team/sites/:id/${path}`, handler);
    };

    sitePost(
      "replace",
      async (c, { s, m, back, log }) => {
        const limited = await d.uploadRate(c);
        if (limited) return done(c, s, back, { kind: "err", text: t.tooMany });
        try {
          const { entries } = await d.readUpload(c);
          await d.replaceSite(m, entries);
          await log("replace");
          return done(c, s, back, { kind: "ok", text: t.team.replaced, link: d.siteUrl(m.id) });
        } catch (err) {
          return done(c, s, back, { kind: "err", text: uploadErr(err) });
        }
      },
      true,
    );

    sitePost("extend", async (c, { s, m, form, back, log }) => {
      try {
        const out = await d.extendSite(m, field(form, "ttlHours"));
        await log(
          out.permanent ? "permanent" : "extend",
          out.permanent ? undefined : out.expiresAt,
        );
        return done(c, s, back, {
          kind: "ok",
          text: out.permanent ? t.team.madePermanent : t.team.extended,
        });
      } catch (err) {
        return done(c, s, back, { kind: "err", text: uploadErr(err) });
      }
    });

    sitePost("permanent", async (c, { s, team, m, back, log }) => {
      if (!team.permanent)
        return done(c, s, back, { kind: "err", text: t.team.permanentNotAllowed });
      await d.setPermanent(m, true);
      await log("permanent");
      return done(c, s, back, { kind: "ok", text: t.team.madePermanent });
    });

    sitePost("delete", async (c, { s, m, log }) => {
      await d.deleteSite(m.id);
      await log("delete", m.title || m.id);
      return done(c, s, href("/team"), { kind: "ok", text: t.team.deleted });
    });

    sitePost("listing", async (c, { s, m, form, back, log }) => {
      if (field(form, "listed") === "1") delete m.unlisted;
      else m.unlisted = true;
      await log(m.unlisted ? "listing-off" : "listing-on");
      m.updatedAt = new Date(now()).toISOString();
      await store.updateMeta(m);
      d.invalidateDirectory();
      return done(c, s, back, { kind: "ok", text: t.team.listingSaved });
    });

    sitePost("repo", async (c, { s, m, form, back, log }) => {
      const url = field(form, "repoUrl").trim();
      if (!url) delete m.repo;
      else {
        try {
          m.repo = readRepo({
            url,
            branch: field(form, "branch").trim() || undefined,
            commitSha: field(form, "commitSha").trim() || undefined,
          }) as RepoLink;
        } catch (e) {
          if (e instanceof RepoError) return done(c, s, back, { kind: "err", text: e.message });
          throw e;
        }
        d.repoChecker?.touch(m.repo);
      }
      await log("repo");
      m.updatedAt = new Date(now()).toISOString();
      await store.updateMeta(m);
      return done(c, s, back, { kind: "ok", text: IX[lang].linksSaved });
    });

    sitePost("mcp", async (c, { s, m, form, back, log }) => {
      const name = cleanTokenName(field(form, "name"));
      const scope = field(form, "scope") === "rw" ? "rw" : "ro";
      if (!name) return done(c, s, back, { kind: "err", text: t.badRequest });
      if ((m.mcpTokens ?? []).length >= MAX_MCP_TOKENS) {
        return done(c, s, back, { kind: "err", text: t.mcp.tooMany });
      }
      const { secret } = addMcpToken(m, name, scope, now());
      await store.updateMeta(m);
      await log("mcp-token", `${name} (${scope})`);
      return done(c, s, `${back}?tab=mcp`, {
        kind: "ok",
        text: t.mcp.created,
        secret: { label: `${t.mcp.tokens}: ${name}`, note: t.mcp.createdNote, value: secret },
      });
    });

    sitePost("mcp/:tid/delete", async (c, { s, m, back, log }) => {
      const tid = c.req.param("tid");
      const gone = (m.mcpTokens ?? []).find((x) => x.id === tid);
      if (gone) await log("mcp-revoke", gone.name);
      m.mcpTokens = (m.mcpTokens ?? []).filter((x) => x.id !== tid);
      if (!m.mcpTokens.length) delete m.mcpTokens;
      await store.updateMeta(m);
      return done(c, s, `${back}?tab=mcp`, { kind: "ok", text: t.mcp.revoked });
    });

    const backendFor = (team: Team) =>
      backend && (team.backend || config.backend.guestAccess) ? backend : null;

    sitePost("kv/delete", async (c, { s, team, m, form, back, log }) => {
      const b = backendFor(team);
      const key = field(form, "key");
      if (b && /^[A-Za-z0-9._:-]{1,128}$/.test(key)) {
        await b.kvDelete(m.id, key);
        await log("kv-delete", key);
      }
      return done(c, s, back, { kind: "ok", text: t.team.keyDeleted });
    });

    sitePost("files/delete", async (c, { s, team, m, form, back, log }) => {
      const b = backendFor(team);
      const id = field(form, "fileId");
      if (b && /^[A-Za-z0-9._-]{1,36}$/.test(id)) {
        await b.fileDelete(m.id, id);
        await log("file-delete", id);
      }
      return done(c, s, back, { kind: "ok", text: t.team.fileDeleted });
    });

    sitePost("token", async (c, { s, m, back, log }) => {
      const token = newEditToken();
      m.tokenHash = hashToken(token);
      await store.updateMeta(m);
      await log("edit-token-rotate");
      return done(c, s, `${back}?tab=settings`, {
        kind: "ok",
        text: DX[lang].tokenDone,
        secret: { label: DX[lang].tokenNew, note: DX[lang].tokenDone, value: token },
      });
    });

    // ---- members ----------------------------------------------------------------------
    const membersBack = href("/team/members");
    app.get(`${prefix}/team/members`, async (c) => {
      const ts = needTeam(c);
      if (ts instanceof Response) return ts;
      const { s, team } = ts;
      const titles = new Map(
        (await store.list())
          .filter((m) => m.teamId === team.id)
          .map((m) => [m.id, m.title || m.id]),
      );
      return page(
        c,
        membersHtml(lang, config, {
          ...(await teamInfo(team)),
          backendConfigured: !!backend,
          sites: [],
          me: meOf(ts),
          meId: ts.member?.id ?? null,
          members: members.list(team.id).map((m) => ({
            id: m.id,
            name: m.name,
            username: m.username,
            role: m.role,
            createdAt: m.createdAt,
            ...(m.lastLoginAt ? { lastLoginAt: m.lastLoginAt } : {}),
          })),
          invites: ts.role === "owner" ? members.listInvites(team.id).map((i) => ({ ...i })) : [],
          audit: members.entries(team.id, undefined, 100).map((e) => auditView(e, titles)),
          csrf: sessions.csrfFor(s),
          flash: takeFlash(c, s),
        }),
      );
    });

    /** A POST on the members page; owner-only unless `min` says otherwise. */
    const teamPost = (
      path: string,
      fn: (c: Context, ctx: TeamCtx & { form: FormData }) => Promise<Response>,
      min: MemberRole = "owner",
    ) => {
      app.post(`${prefix}${path}`, async (c) => {
        const ts = needTeam(c, min);
        if (ts instanceof Response) return ts;
        const form = await guardPost(c, ts.s, lang, membersBack);
        if (form instanceof Response) return form;
        return fn(c, { ...ts, form });
      });
    };

    const inviteTtl = (raw: string) => ([24, 72, 168].includes(Number(raw)) ? Number(raw) : 72);
    const inviteFlash = (token: string): Flash => ({
      kind: "ok",
      text: t.members.inviteCreated,
      secret: {
        label: t.members.inviteLink,
        note: t.members.inviteNote,
        value: `${config.publicUrl}${lang === "ar" ? "/ar" : ""}/join/${token}`,
      },
    });

    teamPost("/team/members/invite", async (c, { s, team, form, actor }) => {
      const role = field(form, "role");
      if (!isRole(role)) return done(c, s, membersBack, { kind: "err", text: t.badRequest });
      if (members.listInvites(team.id).length >= MAX_INVITES) {
        return done(c, s, membersBack, { kind: "err", text: t.members.tooManyInvites });
      }
      if (members.count(team.id) >= MAX_MEMBERS) {
        return done(c, s, membersBack, { kind: "err", text: t.members.tooManyMembers });
      }
      const { token } = await members.createInvite(
        team.id,
        role,
        inviteTtl(field(form, "ttlHours")),
        actor.label,
      );
      await d.audit({ teamId: team.id, actor, action: "invite", detail: t.members.roles[role] });
      return done(c, s, membersBack, inviteFlash(token));
    });

    teamPost("/team/members/invites/:iid/delete", async (c, { s, team, actor }) => {
      const inv = members.listInvites(team.id).find((i) => i.id === c.req.param("iid"));
      if (inv) {
        await members.revokeInvite(inv.id);
        await d.audit({
          teamId: team.id,
          actor,
          action: "invite-revoke",
          detail: t.members.roles[inv.role],
        });
      }
      return done(c, s, membersBack, { kind: "ok", text: t.members.inviteRevoked });
    });

    const otherMember = (c: Context, ts: TeamCtx) => {
      const m = members.get(c.req.param("mid"));
      if (!m || m.teamId !== ts.team.id) return { err: t.notFound };
      if (ts.member?.id === m.id) return { err: t.members.notSelf };
      return { m };
    };
    teamPost("/team/members/:mid/role", async (c, ctx) => {
      const r = otherMember(c, ctx);
      if (!r.m) return done(c, ctx.s, membersBack, { kind: "err", text: r.err ?? t.notFound });
      const role = field(ctx.form, "role");
      if (!isRole(role)) return done(c, ctx.s, membersBack, { kind: "err", text: t.badRequest });
      await members.setRole(r.m.id, role);
      await d.audit({
        teamId: ctx.team.id,
        actor: ctx.actor,
        action: "member-role",
        detail: `${r.m.name} → ${t.members.roles[role]}`,
      });
      return done(c, ctx.s, membersBack, { kind: "ok", text: t.members.roleSaved });
    });
    teamPost("/team/members/:mid/delete", async (c, ctx) => {
      const r = otherMember(c, ctx);
      if (!r.m) return done(c, ctx.s, membersBack, { kind: "err", text: r.err ?? t.notFound });
      await members.remove(r.m.id);
      await d.audit({
        teamId: ctx.team.id,
        actor: ctx.actor,
        action: "member-remove",
        detail: r.m.name,
      });
      return done(c, ctx.s, membersBack, { kind: "ok", text: t.members.removed });
    });

    const pwError = (p: ReturnType<typeof passwordProblem>) =>
      p === "short" ? t.members.short : p === "long" ? t.members.long : t.members.same;

    const settingsBack = href("/team/settings");
    teamPost(
      "/team/account/password",
      async (c, { s, team, member, form, actor }) => {
        if (!member) return done(c, s, settingsBack, { kind: "err", text: t.members.keyAccount });
        if (!(await verifyPassword(field(form, "current"), member.passwordHash))) {
          return done(c, s, settingsBack, { kind: "err", text: t.members.wrongPassword });
        }
        const pw = field(form, "password");
        const problem = passwordProblem(pw, member.username);
        if (problem) return done(c, s, settingsBack, { kind: "err", text: pwError(problem) });
        if (pw !== field(form, "confirm")) {
          return done(c, s, settingsBack, { kind: "err", text: t.members.mismatch });
        }
        const fresh = await members.setPassword(member.id, pw);
        if (!fresh) return done(c, s, settingsBack, { kind: "err", text: t.notFound });
        // Keep this browser signed in; every other session of the member ends.
        const ns = sessions.start(c, "team", memberFp(fresh), team.id, fresh.id);
        await d.audit({ teamId: team.id, actor, action: "password" });
        return done(c, ns, settingsBack, { kind: "ok", text: t.members.passwordChanged });
      },
      "viewer",
    );

    teamPost(
      "/team/account/signout-all",
      async (c, { s, team, member, actor }) => {
        if (!member) return done(c, s, settingsBack, { kind: "err", text: t.members.keyAccount });
        const fresh = await members.endSessions(member.id);
        if (!fresh) return done(c, s, settingsBack, { kind: "err", text: t.notFound });
        const ns = sessions.start(c, "team", memberFp(fresh), team.id, fresh.id);
        await d.audit({ teamId: team.id, actor, action: "signout-all" });
        return done(c, ns, settingsBack, { kind: "ok", text: t.members.signedOutAll });
      },
      "viewer",
    );

    app.get(`${prefix}/team/settings/export`, async (c) => {
      const ts = needTeam(c, "owner");
      if (ts instanceof Response) return ts;
      if (!d.lifecycle) return c.notFound();
      const ex = await d.lifecycle.exportTeam(ts.team);
      await d.audit({ teamId: ts.team.id, actor: ts.actor, action: "team-export" });
      c.header("Content-Type", "application/zip");
      c.header("Content-Disposition", `attachment; filename="${ex.file}"`);
      c.header("Cache-Control", "no-store");
      return c.body(new Uint8Array(ex.zip));
    });

    teamPost("/team/settings/signout-everyone", async (c, { s, team, actor }) => {
      sessions.endAll(`team:${team.id}`);
      sessions.end(c, s);
      await d.audit({ teamId: team.id, actor, action: "sessions-end-all" });
      return c.redirect(href("/login?out=1"), 303);
    });

    // ---- team Workers (0.12.0) -------------------------------------------------------
    const workersBack = href("/team/workers");
    app.get(`${prefix}/team/workers`, async (c) => {
      const ts = needTeam(c);
      if (ts instanceof Response) return ts;
      const { s, team } = ts;
      const base = teamWorkersInfo(d.workers, team);
      const rich = await workerList(d.workers.list(team.id));
      const info = {
        ...base,
        workers: base.workers.map((w) => rich.find((r) => r.id === w.id) ?? w),
      };
      return page(
        c,
        teamWorkersHtml(lang, config, {
          ...(await teamInfo(team)),
          backendConfigured: !!backend,
          sites: [],
          me: meOf(ts),
          info,
          zone: d.workers.settingsView().zoneName,
          redeploy: (c.req.query("redeploy") ?? "").slice(0, 30),
          csrf: sessions.csrfFor(s),
          flash: takeFlash(c, s),
        }),
      );
    });
    // 0.15.1: notes the team's agents left for the admin (read-only here).
    app.get(`${prefix}/team/notes`, async (c) => {
      const ts = needTeam(c);
      if (ts instanceof Response) return ts;
      const { s, team } = ts;
      await d.notes?.ready();
      const info = await teamInfo(team);
      return page(
        c,
        notesHtml(lang, config, {
          kind: "team",
          csrf: sessions.csrfFor(s),
          ctx: teamCtx(lang, { ...info, me: meOf(ts) }),
          flash: takeFlash(c, s),
          notes: d.notes?.list({ teamId: team.id }, 300) ?? [],
          teams: [{ id: team.id, name: team.name }],
        }),
      );
    });
    // 0.15.1: every Worker of the team detected or declared as an MCP server.
    app.get(`${prefix}/team/mcp`, async (c) => {
      const ts = needTeam(c);
      if (ts instanceof Response) return ts;
      const { s, team } = ts;
      const info = await teamInfo(team);
      return page(
        c,
        mcpServersHtml(lang, config, {
          kind: "team",
          csrf: sessions.csrfFor(s),
          ctx: teamCtx(lang, { ...info, me: meOf(ts) }),
          flash: takeFlash(c, s),
          rows: await workerList(d.workers.list(team.id)),
          canEdit: roleRank[ts.role] >= roleRank.editor,
        }),
      );
    });
    const workerPost = (
      path: string,
      fn: (c: Context, ctx: TeamCtx & { form: FormData }) => Promise<Response>,
    ) => {
      app.post(`${prefix}${path}`, async (c) => {
        const ts = needTeam(c, "editor");
        if (ts instanceof Response) return ts;
        const form = await guardPost(c, ts.s, lang, workersBack);
        if (form instanceof Response) return form;
        return fn(c, { ...ts, form });
      });
    };
    workerPost("/team/workers/deploy", async (c, { s, team, form, actor }) => {
      const f = form.get("file");
      let code = field(form, "code");
      if (f && typeof f !== "string" && f.size > 0) code = await f.text();
      const varsRaw = field(form, "vars").trim();
      const vars = varsRaw ? envLines(varsRaw) : undefined;
      const secretsRaw = envLines(field(form, "secrets"));
      if (typeof vars === "string" || typeof secretsRaw === "string") {
        return done(c, s, workersBack, { kind: "err", text: t.badRequest });
      }
      const secrets: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(secretsRaw)) secrets[k] = v === "" ? null : v;
      try {
        const w = await d.workers.deploy(
          team,
          {
            name: field(form, "name"),
            code,
            ...(vars ? { vars } : {}),
            secrets,
            note: field(form, "note"),
          },
          actor,
        );
        return done(c, s, workersBack, {
          kind: "ok",
          text: WS[lang].deployed1,
          ...(w.url ? { link: w.url } : {}),
        });
      } catch (e) {
        if (e instanceof WorkerError)
          return done(c, s, workersBack, { kind: "err", text: e.message });
        throw e;
      }
    });
    workerPost("/team/workers/:name/delete", async (c, { s, team, actor }) => {
      const rec = d.workers.find(team.id, c.req.param("name") ?? "");
      if (!rec) return done(c, s, workersBack, { kind: "err", text: t.notFound });
      try {
        await d.workers.remove(rec, actor);
      } catch (e) {
        if (e instanceof WorkerError)
          return done(c, s, workersBack, { kind: "err", text: e.message });
        throw e;
      }
      return done(c, s, workersBack, { kind: "ok", text: WS[lang].deleted });
    });

    // ---- Worker versions, one-click redeploy, rollback (0.14.0) ------------------------
    const v14 = V14[lang];
    workerPost("/team/workers/:name/redeploy", async (c, { s, team, actor }) => {
      const rec = d.workers.find(team.id, c.req.param("name") ?? "");
      if (!rec) return done(c, s, workersBack, { kind: "err", text: t.notFound });
      try {
        const w = await d.workers.redeploy(team, rec, actor);
        return done(c, s, workersBack, {
          kind: "ok",
          text: v14.redeployed,
          ...(w.url ? { link: w.url } : {}),
        });
      } catch (e) {
        if (e instanceof WorkerError)
          return done(c, s, workersBack, { kind: "err", text: e.message });
        throw e;
      }
    });
    workerPost("/team/workers/:name/rollback", async (c, { s, team, form, actor }) => {
      const rec = d.workers.find(team.id, c.req.param("name") ?? "");
      if (!rec) return done(c, s, workersBack, { kind: "err", text: t.notFound });
      const back = href(`/team/workers/${rec.name}?tab=versions`);
      const n = Number(field(form, "version"));
      try {
        const r = await d.workers.rollback(team, rec, n, actor);
        return done(c, s, back, {
          kind: "ok",
          text: r.missingSecrets.length
            ? v14.missingSecrets(r.missingSecrets.join(", "))
            : v14.rolledBack(n),
        });
      } catch (e) {
        if (e instanceof WorkerError) return done(c, s, back, { kind: "err", text: e.message });
        throw e;
      }
    });
    app.get(`${prefix}/team/workers/:name/versions`, (c) =>
      c.redirect(
        href(`/team/workers/${encodeURIComponent(c.req.param("name") ?? "")}?tab=versions`),
        301,
      ),
    );
    app.get(`${prefix}/team/workers/:name/versions/:n/code`, async (c) => {
      const ts = needTeam(c, "editor");
      if (ts instanceof Response) return ts;
      const rec = d.workers.find(ts.team.id, c.req.param("name") ?? "");
      const v = rec ? await d.workers.getVersion(rec, Number(c.req.param("n"))) : null;
      if (!rec || !v) return done(c, ts.s, workersBack, { kind: "err", text: t.notFound });
      return codeDownload(c, rec.name, v.n, v.code);
    });

    // ---- Worker detail (0.15.0) ---------------------------------------------------------
    app.get(`${prefix}/team/workers/:name`, async (c) => {
      const ts = needTeam(c);
      if (ts instanceof Response) return ts;
      const { s, team } = ts;
      const rec = d.workers.find(team.id, c.req.param("name") ?? "");
      if (!rec) return done(c, s, workersBack, { kind: "err", text: t.notFound });
      const tab = c.req.query("tab") ?? "overview";
      return page(
        c,
        workerDetailHtml(lang, config, {
          kind: "team",
          tab,
          base: `/team/workers/${rec.name}`,
          team: { id: team.id, name: team.name },
          ctx: teamCtx(lang, { team, me: meOf(ts) }),
          csrf: sessions.csrfFor(s),
          flash: takeFlash(c, s),
          ...(await workerDetailData(rec, tab, false, c)),
          canEdit: roleRank[ts.role] >= roleRank.editor,
        }),
      );
    });
    const workerEdit = (
      path: string,
      fn: (
        c: Context,
        ctx: TeamCtx & {
          form: FormData;
          rec: NonNullable<ReturnType<typeof d.workers.find>>;
          back: string;
        },
      ) => Promise<Response>,
    ) =>
      workerPost(`/team/workers/:name/${path}`, async (c, ctx) => {
        const rec = d.workers.find(ctx.team.id, c.req.param("name") ?? "");
        if (!rec) return done(c, ctx.s, workersBack, { kind: "err", text: t.notFound });
        const back = href(`/team/workers/${rec.name}?tab=settings`);
        try {
          return await fn(c, { ...ctx, rec, back });
        } catch (e) {
          if (e instanceof WorkerError)
            return done(c, ctx.s, back, { kind: "err", text: e.message });
          throw e;
        }
      });
    workerEdit("vars", async (c, { s, team, form, actor, rec, back }) => {
      const vars = envLines(field(form, "vars"));
      if (typeof vars === "string") return done(c, s, back, { kind: "err", text: t.badRequest });
      const w = await d.workers.editEnv(team, rec, { vars }, actor);
      return done(c, s, back, {
        kind: "ok",
        text: v14.redeployed,
        ...(w.url ? { link: w.url } : {}),
      });
    });
    workerEdit("secrets", async (c, { s, team, form, actor, rec, back }) => {
      const raw = envLines(field(form, "secrets"));
      if (typeof raw === "string" || !Object.keys(raw).length)
        return done(c, s, back, { kind: "err", text: t.badRequest });
      const secrets: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(raw)) secrets[k] = v === "" ? null : v;
      const w = await d.workers.editEnv(team, rec, { secrets }, actor);
      return done(c, s, back, {
        kind: "ok",
        text: v14.redeployed,
        ...(w.url ? { link: w.url } : {}),
      });
    });
    // ---- 0.15.2: vars & secrets, health, logs (team side) ------------------------------
    const opsEdit = async (
      c: Context,
      s: Session,
      what: "secret" | "var" | "health" | "logs",
      rec: NonNullable<ReturnType<typeof d.workers.find>>,
      form: FormData,
      actor: Actor,
      back: string,
    ): Promise<Response> => {
      const op = field(form, "op");
      const name = field(form, "name").trim();
      const ops = d.ops;
      if (!ops) return done(c, s, back, { kind: "err", text: t.badRequest });
      const ox = OX[lang];
      if (what === "secret") {
        const lim = limiter.hit(`secrets:${rec.teamId}`, 60, 3_600_000);
        if (!lim.allowed) return done(c, s, back, { kind: "err", text: t.badRequest });
        if (op === "delete") await d.workers.deleteSecretNamed(rec, name, actor);
        else await d.workers.setSecret(rec, name, field(form, "value"), actor);
        ops.forgetEnv(rec.id);
        return done(c, s, back, {
          kind: "ok",
          text: `${name}: ${op === "delete" ? ox.del : ox.saveSecret} ✓`,
        });
      }
      if (what === "var") {
        const team = teams.get(rec.teamId);
        if (!team) return done(c, s, back, { kind: "err", text: t.notFound });
        await d.workers.setVar(
          team,
          rec,
          name,
          op === "delete" ? null : field(form, "value"),
          actor,
        );
        ops.forgetEnv(rec.id);
        return done(c, s, back, { kind: "ok", text: v14.redeployed });
      }
      if (what === "health") {
        if (op === "on" || op === "off") {
          await ops.health.setEnabled(rec.id, op === "on");
          await d.workers.auditOf(
            rec,
            actor,
            op === "on" ? "worker-health-on" : "worker-health-off",
          );
        } else if (op === "target") {
          const meta: Record<string, unknown> = { ...(rec.meta ?? {}) };
          for (const k of ["healthPath", "healthExpect"] as const) {
            const v = field(form, k).trim();
            if (v) meta[k] = v;
            else delete meta[k];
          }
          try {
            await d.workers.setLinks(rec, { meta }, actor);
          } catch (e) {
            if (e instanceof WorkerError) return done(c, s, back, { kind: "err", text: e.message });
            throw e;
          }
          const fresh = d.workers.get(rec.id) ?? rec;
          await d.workers.auditOf(fresh, actor, "worker-health-target", healthRule(fresh));
          return done(c, s, back, { kind: "ok", text: t.admin.saved });
        } else if (op === "check" && rec.status === "active" && rec.url) {
          const lim = limiter.hit(`health-now:${rec.id}`, 12, 3_600_000);
          if (!lim.allowed) return done(c, s, back, { kind: "err", text: t.badRequest });
          await ops.code(rec);
          await ops.health.checkOne(rec);
        }
        return done(c, s, back, { kind: "ok", text: IX[lang].refreshed });
      }
      await d.workers.setLogs(rec, op === "on", actor);
      return done(c, s, back, { kind: "ok", text: op === "on" ? ox.logsOn : ox.logsOff });
    };
    for (const what of ["secret", "var", "health", "logs"] as const) {
      workerEdit(what, async (c, { s, rec, form, actor, back: settingsBack }) =>
        opsEdit(c, s, what, rec, form, actor, localBack(form, settingsBack)),
      );
    }
    workerEdit("probe", async (c, { s, rec, form, back: settingsBack }) => {
      const back = localBack(form, settingsBack);
      const ins = await insightRow(rec, [], false);
      if (ins.endpoint && d.mcpProbe) await d.mcpProbe.refresh(rec.id, rec.version, ins.endpoint);
      if (rec.repo && d.repoChecker) await d.repoChecker.check(rec.repo);
      return done(c, s, back, { kind: "ok", text: IX[lang].refreshed });
    });
    workerEdit("links", async (c, { s, team, form, actor, rec, back }) => {
      const repoUrl = field(form, "repoUrl").trim();
      const spaceId = field(form, "spaceId").trim();
      if (spaceId) {
        const m = await store.get(spaceId).catch(() => null);
        if (!m || m.teamId !== team.id)
          return done(c, s, back, { kind: "err", text: t.badRequest });
      }
      // Keep what the deploy declared (toolsCount, spaceSlug); the form owns these three.
      const meta: Record<string, unknown> = { ...(rec.meta ?? {}) };
      for (const k of ["kind", "language", "framework"]) {
        const v = field(form, k).trim();
        if (v) meta[k] = v;
        else delete meta[k];
      }
      await d.workers.setLinks(
        rec,
        {
          repo: repoUrl
            ? {
                url: repoUrl,
                branch: field(form, "branch").trim(),
                commitSha: field(form, "commitSha").trim(),
              }
            : null,
          spaceId: spaceId || null,
          // The form sets the declared type/stack; empty = detect from the code.
          meta: Object.keys(meta).length ? meta : null,
        },
        actor,
      );
      if (rec.repo || repoUrl) void d.repoChecker?.touch(d.workers.get(rec.id)?.repo);
      return done(c, s, back, { kind: "ok", text: IX[lang].linksSaved });
    });
    workerEdit("runtime", async (c, { s, team, form, actor, rec, back }) => {
      const lines = envLines(field(form, "bindings"));
      if (typeof lines === "string") return done(c, s, back, { kind: "err", text: t.badRequest });
      const w = await d.workers.editRuntime(
        team,
        rec,
        {
          compatibilityDate: field(form, "compatibilityDate").trim() || null,
          compatibilityFlags: form.getAll("compatibilityFlags").map(String),
          bindings: Object.entries(lines).map(([name, worker]) => ({
            name,
            worker: worker.trim(),
          })),
        },
        actor,
      );
      return done(c, s, back, {
        kind: "ok",
        text: v14.redeployed,
        ...(w.url ? { link: w.url } : {}),
      });
    });
    for (const [act, off] of [
      ["disable", true],
      ["enable", false],
    ] as const) {
      workerEdit(act, async (c, { s, actor, rec, back }) => {
        // A Worker the admin disabled stays off until the admin enables it.
        if (rec.status === "disabled" && (rec.disabledBy ?? "admin") === "admin")
          return done(c, s, back, { kind: "err", text: DX[lang].disabledByAdmin });
        if (off === (rec.status === "disabled")) return done(c, s, back);
        await d.workers.setDisabled(rec, off, actor);
        return done(c, s, back, { kind: "ok", text: t.admin.saved });
      });
    }

    // ---- agent keys and invites (0.14.0) ---------------------------------------------
    const agentsBack = href("/team/agents");
    const keyInput = (form: FormData) => {
      const exp = field(form, "expiry");
      return {
        name: field(form, "name"),
        description: field(form, "description"),
        scopes: form.getAll("scopes").map(String),
        expiresInDays: exp === "custom" ? field(form, "customDays") : exp,
      };
    };
    const keyErr = (c: Context, s: Session, e: unknown) => {
      if (e instanceof AgentKeyError)
        return done(c, s, agentsBack, { kind: "err", text: e.message });
      throw e;
    };
    app.get(`${prefix}/team/agents`, async (c) => {
      const ts = needTeam(c);
      if (ts instanceof Response) return ts;
      const { s, team } = ts;
      await d.agentKeys.ready();
      const owner = ts.role === "owner";
      return page(
        c,
        teamAgentsHtml(lang, config, {
          ...(await teamInfo(team)),
          backendConfigured: !!backend,
          sites: [],
          me: meOf(ts),
          keys: owner ? d.agentKeys.list(team.id).map((k) => d.agentKeys.view(k)) : [],
          invites: owner
            ? d.agentKeys.openInvites(team.id).map((i) => d.agentKeys.inviteView(i))
            : [],
          isOwner: owner,
          csrf: sessions.csrfFor(s),
          flash: takeFlash(c, s),
        }),
      );
    });
    const agentPost = (
      path: string,
      fn: (c: Context, ctx: TeamCtx & { form: FormData }) => Promise<Response>,
    ) => {
      app.post(`${prefix}${path}`, async (c) => {
        const ts = needTeam(c, "owner");
        if (ts instanceof Response) return ts;
        const form = await guardPost(c, ts.s, lang, agentsBack);
        if (form instanceof Response) return form;
        return fn(c, { ...ts, form });
      });
    };
    agentPost("/team/agents", async (c, { s, team, form, actor }) => {
      try {
        const { key, secret } = await d.agentKeys.create(team.id, keyInput(form), actor.label);
        await d.audit({
          teamId: team.id,
          actor,
          action: "agent-key-create",
          detail: `${key.name} (${key.prefix}…)`,
        });
        return done(c, s, agentsBack, {
          kind: "ok",
          text: v14.keyCreated,
          secret: { label: v14.keySecret, note: v14.keyNote, value: secret },
        });
      } catch (e) {
        return keyErr(c, s, e);
      }
    });
    agentPost("/team/agents/invite", async (c, { s, team, form, actor }) => {
      try {
        const { invite, secret } = await d.agentKeys.createInvite(
          team.id,
          keyInput(form),
          actor.label,
        );
        await d.audit({ teamId: team.id, actor, action: "agent-invite", detail: invite.name });
        return done(c, s, agentsBack, {
          kind: "ok",
          text: v14.inviteCreated,
          secret: {
            label: v14.inviteLabel,
            note: v14.inviteNote,
            value: `${config.publicUrl}/agent-invite/${secret}`,
          },
        });
      } catch (e) {
        return keyErr(c, s, e);
      }
    });
    agentPost("/team/agents/:id/revoke", async (c, { s, team, actor }) => {
      const k = await d.agentKeys.revoke(team.id, c.req.param("id") ?? "", actor.label);
      if (!k) return done(c, s, agentsBack, { kind: "err", text: t.notFound });
      await d.audit({
        teamId: team.id,
        actor,
        action: "agent-key-revoke",
        detail: `${k.name} (${k.prefix}…)`,
      });
      return done(c, s, agentsBack, { kind: "ok", text: v14.revoked });
    });
    agentPost("/team/agents/invites/:id/cancel", async (c, { s, team }) => {
      const ok = await d.agentKeys.revokeInvite(team.id, c.req.param("id") ?? "");
      return done(c, s, agentsBack, ok ? undefined : { kind: "err", text: t.notFound });
    });

    // ---- Worker API keys for end users (0.14.0) ---------------------------------------
    const k14 = K14[lang];
    app.get(`${prefix}/team/workers/:name/keys`, (c) =>
      c.redirect(
        href(`/team/workers/${encodeURIComponent(c.req.param("name") ?? "")}?tab=keys`),
        301,
      ),
    );
    const ukPost = (
      path: string,
      fn: (
        c: Context,
        ctx: TeamCtx & {
          form: FormData;
          rec: NonNullable<ReturnType<typeof d.workers.find>>;
          back: string;
        },
      ) => Promise<Response>,
    ) => {
      app.post(`${prefix}${path}`, async (c) => {
        const ts = needTeam(c, "editor");
        if (ts instanceof Response) return ts;
        const rec = d.workers.find(ts.team.id, c.req.param("name") ?? "");
        const back = rec ? href(`/team/workers/${rec.name}?tab=keys`) : workersBack;
        const form = await guardPost(c, ts.s, lang, back);
        if (form instanceof Response) return form;
        if (!rec) return done(c, ts.s, workersBack, { kind: "err", text: t.notFound });
        try {
          return await fn(c, { ...ts, form, rec, back });
        } catch (e) {
          if (e instanceof UserKeyError || e instanceof WorkerError)
            return done(c, ts.s, back, { kind: "err", text: e.message });
          throw e;
        }
      });
    };
    ukPost("/team/workers/:name/keys", async (c, { s, team, form, actor, rec, back }) => {
      const r = await d.userKeyOps.create(
        team,
        rec,
        {
          label: field(form, "label"),
          email: field(form, "email"),
          expiresInDays: field(form, "expiresInDays") || "never",
          perMinute: field(form, "perMinute"),
          perDay: field(form, "perDay"),
          tools: field(form, "tools"),
        },
        actor,
      );
      return done(c, s, back, {
        kind: "ok",
        text: k14.created,
        secret: { label: k14.secretLabel, note: k14.secretNote, value: r.secret },
      });
    });
    ukPost("/team/workers/:name/keys/settings", async (c, { s, team, form, actor, rec, back }) => {
      await d.userKeyOps.configure(
        team,
        rec,
        {
          required: field(form, "required") === "on",
          perMinute: field(form, "perMinute"),
          perDay: field(form, "perDay"),
        },
        actor,
      );
      return done(c, s, back, { kind: "ok", text: k14.settingsSaved });
    });
    ukPost("/team/workers/:name/keys/:id/revoke", async (c, { s, team, actor, rec, back }) => {
      const k = await d.userKeyOps.revoke(team, rec, c.req.param("id") ?? "", actor);
      return done(
        c,
        s,
        back,
        k ? { kind: "ok", text: k14.revoked } : { kind: "err", text: t.notFound },
      );
    });

    // ---- recipes (0.14.0) --------------------------------------------------------------
    const r14 = R14[lang];
    const skeleton = { en: recipeSkeleton("en"), ar: recipeSkeleton("ar") };
    const recipeInput = (form: FormData) => ({
      title_en: field(form, "title_en"),
      title_ar: field(form, "title_ar"),
      summary_en: field(form, "summary_en"),
      summary_ar: field(form, "summary_ar"),
      body_en: field(form, "body_en"),
      body_ar: field(form, "body_ar"),
      tags: field(form, "tags"),
    });
    const tRecipes = href("/team/recipes");
    app.get(`${prefix}/team/recipes`, async (c) => {
      const ts = needTeam(c);
      if (ts instanceof Response) return ts;
      await d.recipes.ready();
      return page(
        c,
        dashRecipesHtml(lang, config, {
          ...(await teamInfo(ts.team)),
          me: meOf(ts),
          kind: "team",
          list: d.recipes.visible(ts.team.id).map((r) => summaryOf(r, lang)),
          canWrite: roleRank[ts.role] >= roleRank.editor,
          csrf: sessions.csrfFor(ts.s),
          flash: takeFlash(c, ts.s),
          skeleton,
        }),
      );
    });
    app.get(`${prefix}/team/recipes/:slug`, async (c) => {
      const ts = needTeam(c);
      if (ts instanceof Response) return ts;
      await d.recipes.ready();
      const r = d.recipes.get(c.req.param("slug") ?? "", ts.team.id);
      if (!r) return done(c, ts.s, tRecipes, { kind: "err", text: t.notFound });
      const served = servedLang(r, lang);
      return page(
        c,
        dashRecipeHtml(lang, config, {
          ...(await teamInfo(ts.team)),
          me: meOf(ts),
          kind: "team",
          list: [],
          recipe: r,
          html: recipeHtml(r, served),
          served,
          canWrite: r.scope === "team" && roleRank[ts.role] >= roleRank.editor,
          csrf: sessions.csrfFor(ts.s),
          flash: takeFlash(c, ts.s),
          skeleton,
        }),
      );
    });
    const recipePost = (
      path: string,
      fn: (c: Context, ctx: TeamCtx & { form: FormData }) => Promise<Response>,
    ) => {
      app.post(`${prefix}${path}`, async (c) => {
        const ts = needTeam(c, "editor");
        if (ts instanceof Response) return ts;
        const form = await guardPost(c, ts.s, lang, tRecipes);
        if (form instanceof Response) return form;
        try {
          return await fn(c, { ...ts, form });
        } catch (e) {
          if (e instanceof RecipeError)
            return done(c, ts.s, tRecipes, { kind: "err", text: e.message });
          throw e;
        }
      });
    };
    recipePost("/team/recipes", async (c, { s, team, form, actor }) => {
      await d.recipes.ready();
      const r = await d.recipes.save1(team.id, field(form, "slug"), recipeInput(form), actor.label);
      await d.audit({
        teamId: team.id,
        actor,
        action: "recipe-save",
        detail: `${r.slug} v${r.version}`,
      });
      return done(c, s, href(`/team/recipes/${r.slug}`), {
        kind: "ok",
        text: r14.saved(r.version),
      });
    });
    recipePost("/team/recipes/:slug/delete", async (c, { s, team, actor }) => {
      await d.recipes.ready();
      const slug = c.req.param("slug") ?? "";
      const ok = await d.recipes.remove(team.id, slug);
      if (ok) await d.audit({ teamId: team.id, actor, action: "recipe-delete", detail: slug });
      return done(
        c,
        s,
        tRecipes,
        ok ? { kind: "ok", text: r14.deleted } : { kind: "err", text: t.notFound },
      );
    });

    // ---- notification center + team webhook (0.14.0) ---------------------------------
    const alertsBack = href("/team/notifications");
    const rowsFor = (teamId: string | null, who: string | null) =>
      d.notify.forViewer(teamId, who).map((n) => ({
        ...n,
        ...(teamId === null
          ? { teamName: n.teamId === PLATFORM ? null : (teams.get(n.teamId)?.name ?? n.teamId) }
          : {}),
      }));
    app.get(`${prefix}/team/notifications`, async (c) => {
      const ts = needTeam(c, "owner");
      if (ts instanceof Response) return ts;
      const { s, team } = ts;
      await d.notify.ready();
      const who = ts.member?.id ?? "key";
      return page(
        c,
        teamNotificationsHtml(lang, config, {
          ...(await teamInfo(team)),
          backendConfigured: !!backend,
          sites: [],
          me: meOf(ts),
          notices: rowsFor(team.id, who),
          unread: d.notify.unread(team.id, who),
          hook: d.notify.hook(team.id),
          canManage: true,
          csrf: sessions.csrfFor(s),
          flash: takeFlash(c, s),
        }),
      );
    });
    const alertPost = (
      path: string,
      fn: (c: Context, ctx: TeamCtx & { form: FormData }) => Promise<Response>,
    ) => {
      app.post(`${prefix}${path}`, async (c) => {
        const ts = needTeam(c, "owner");
        if (ts instanceof Response) return ts;
        const form = await guardPost(c, ts.s, lang, alertsBack);
        if (form instanceof Response) return form;
        return fn(c, { ...ts, form });
      });
    };
    alertPost("/team/notifications/read", async (c, { s, team, member }) => {
      await d.notify.markRead(team.id, member?.id ?? "key");
      return done(c, s, alertsBack);
    });
    const hookErr = (c: Context, s: Session, back: string, e: unknown) => {
      if (e instanceof WebhookError) return done(c, s, back, { kind: "err", text: e.message });
      throw e;
    };
    const hookSaved = (secret: string): Flash => ({
      kind: "ok",
      text: v14.hookSaved,
      secret: { label: v14.hookSecret, note: v14.hookSecretNote, value: secret },
    });
    const testFlash = (last: { ok: boolean; status: number | null } | null | undefined): Flash =>
      last?.ok
        ? { kind: "ok", text: v14.hookTestOk(last.status ?? 200) }
        : { kind: "err", text: v14.hookTestFail(last?.status ?? null) };
    alertPost("/team/notifications/webhook", async (c, { s, team, form, actor }) => {
      try {
        const r = await d.notify.setHook(team.id, field(form, "url"));
        await d.audit({
          teamId: team.id,
          actor,
          action: "webhook-set",
          detail: new URL(r.hook.url).host,
        });
        return done(c, s, alertsBack, hookSaved(r.secret));
      } catch (e) {
        return hookErr(c, s, alertsBack, e);
      }
    });
    alertPost("/team/notifications/webhook/test", async (c, { s, team, actor }) => {
      const r = limiter.hit(`whtest:${team.id}`, 10, 3_600_000);
      if (!r.allowed) return done(c, s, alertsBack, { kind: "err", text: t.badRequest });
      return done(c, s, alertsBack, testFlash(await d.notify.test(team.id, actor.label)));
    });
    alertPost("/team/notifications/webhook/delete", async (c, { s, team, actor }) => {
      await d.notify.clearHook(team.id);
      await d.audit({ teamId: team.id, actor, action: "webhook-clear" });
      return done(c, s, alertsBack, { kind: "ok", text: v14.hookRemoved });
    });

    // ---- joining with an invite link -------------------------------------------------
    const joinInvalid = (c: Context) =>
      page(
        c,
        messageHtml(lang, config, "404", t.members.inviteInvalid, t.members.inviteInvalidSub, {
          href: href("/login"),
          label: t.login.title,
        }),
        404,
      );
    app.get(`${prefix}/join/:token`, (c) => {
      const inv = members.findInvite(c.req.param("token"));
      const team = inv && teams.get(inv.teamId);
      if (!inv || !team) return joinInvalid(c);
      c.header("Referrer-Policy", "no-referrer");
      return page(
        c,
        joinHtml(lang, config, {
          team: team.name,
          role: inv.role,
          csrf: sessions.loginCsrf(c),
          action: href(`/join/${c.req.param("token")}`),
        }),
      );
    });
    app.post(`${prefix}/join/:token`, async (c) => {
      const token = c.req.param("token");
      const inv = members.findInvite(token);
      const team = inv && teams.get(inv.teamId);
      if (!inv || !team) return joinInvalid(c);
      const form = await formOf(c);
      const values = { username: field(form, "username"), name: field(form, "name") };
      const render = (error: string, status: number) =>
        page(
          c,
          joinHtml(lang, config, {
            team: team.name,
            role: inv.role,
            csrf: sessions.loginCsrf(c),
            action: href(`/join/${token}`),
            error,
            values,
          }),
          status,
        );
      const r = loginRate(c);
      if (!r.allowed) {
        c.header("Retry-After", String(r.retryAfterSec));
        return render(t.login.limited, 429);
      }
      if (!sameOrigin(c, config.publicUrl) || !sessions.checkLoginCsrf(c, field(form, "_csrf"))) {
        return render(t.login.csrf, 403);
      }
      const username = cleanUsername(values.username);
      if (!username) return render(t.members.badUsername, 400);
      const name = cleanMemberName(values.name);
      if (!name) return render(t.members.badName, 400);
      const pw = field(form, "password");
      const problem = passwordProblem(pw, username);
      if (problem) return render(pwError(problem), 400);
      if (pw !== field(form, "confirm")) return render(t.members.mismatch, 400);
      if (members.byUsername(username)) return render(t.members.taken, 409);
      if (members.count(team.id) >= MAX_MEMBERS) return render(t.members.tooManyMembers, 409);
      let m: Member | null;
      try {
        m = await members.redeem(token, username, name, pw);
      } catch (err) {
        if ((err as Error).message === MemberStore.TAKEN) return render(t.members.taken, 409);
        throw err;
      }
      if (!m) return joinInvalid(c);
      const s = sessions.start(c, "team", memberFp(m), m.teamId, m.id);
      await d.audit({
        teamId: m.teamId,
        actor: { kind: "member", label: m.name, memberId: m.id },
        action: "member-join",
        detail: t.members.roles[m.role],
      });
      return done(c, s, href("/team"), { kind: "ok", text: t.members.joined2 });
    });

    // ---- admin ----------------------------------------------------------------------
    app.get(`${prefix}/admin/login`, (c) => {
      if (adminSession(c)) return c.redirect(href("/admin"), 303);
      const notice = c.req.query("out") ? t.login.signedOut : undefined;
      const error = c.req.query("expired") ? t.login.expired : undefined;
      return page(
        c,
        loginHtml(lang, config, {
          kind: "admin",
          csrf: sessions.loginCsrf(c),
          notice,
          error,
          disabled: !config.adminToken,
        }),
        config.adminToken ? 200 : 404,
      );
    });

    app.post(`${prefix}/admin/login`, async (c) => {
      const render = (error: string, status: number) =>
        page(
          c,
          loginHtml(lang, config, {
            kind: "admin",
            csrf: sessions.loginCsrf(c),
            error,
            disabled: !config.adminToken,
          }),
          status,
        );
      if (!config.adminToken) return render(t.admin.disabled, 404);
      const r = loginRate(c);
      if (!r.allowed) {
        c.header("Retry-After", String(r.retryAfterSec));
        return render(t.login.limited, 429);
      }
      const form = await formOf(c);
      if (!sameOrigin(c, config.publicUrl) || !sessions.checkLoginCsrf(c, field(form, "_csrf"))) {
        return render(t.login.csrf, 403);
      }
      if (!safeEqual(field(form, "token").trim(), config.adminToken)) {
        return render(lang === "ar" ? "رمز المسؤول غير صحيح." : "Wrong admin token.", 401);
      }
      sessions.start(c, "admin", fingerprint(config.adminToken));
      return c.redirect(href("/admin"), 303);
    });

    const needAdmin = (c: Context) => {
      const s = adminSession(c);
      if (s) return s;
      return c.redirect(
        href(sessions.hasCookie(c) ? "/admin/login?expired=1" : "/admin/login"),
        303,
      );
    };

    app.get(`${prefix}/admin`, async (c) => {
      const s = needAdmin(c);
      if (s instanceof Response) return s;
      const counts = await d.siteCounts();
      const liveSites = (await store.list()).filter((m) => live(m));
      const vrows = liveSites.map((m) => ({ id: m.id }) as { id: string; visits?: VisitSummary });
      await withVisits(vrows);
      const counting = vrows.some((x) => x.visits);
      const cf = d.workers.settingsView();
      const stats: AdminStats = {
        sites: liveSites.length,
        bytes: liveSites.reduce((n, m) => n + m.totalBytes, 0),
        guests: liveSites.filter((m) => !teams.get(m.teamId)).length,
        permanent: liveSites.filter((m) => m.permanent).length,
        views30: counting ? vrows.reduce((n, x) => n + (x.visits?.views30 ?? 0), 0) : null,
        views7: counting ? vrows.reduce((n, x) => n + (x.visits?.views7 ?? 0), 0) : null,
        workers: d.workers.list().length,
        workersTeams: teams.list().filter((x) => x.workers).length,
        ...(d.ops
          ? {
              down: d.workers
                .list()
                .filter((r) => d.ops?.health.cell(r.id).state === "down")
                .map((r) => r.name),
            }
          : {}),
        members: teams.list().reduce((n, x) => n + members.count(x.id), 0),
      };
      return page(
        c,
        adminTeamsHtml(lang, config, {
          stats,
          cfConfigured: cf.configured,
          teams: teams.list().map((x) => ({
            id: x.id,
            name: x.name,
            backend: x.backend,
            directory: x.directory,
            permanent: x.permanent,
            quotaSites: d.quotaOf(x).sites,
            quotaMb: Math.round(d.quotaOf(x).bytes / 1024 / 1024),
            customQuota: !!(x.maxSites || x.maxMb),
            keyPrefix: x.keyPrefix,
            createdAt: x.createdAt,
            liveSites: counts.get(x.id) ?? 0,
            members: members.count(x.id),
            workers: !!x.workers,
            slug: x.slug ?? null,
            workerCount: d.workers.list(x.id).length,
          })),
          csrf: sessions.csrfFor(s),
          flash: takeFlash(c, s),
          backendConfigured: !!backend,
        }),
      );
    });

    const adminPost = (
      path: string,
      fn: (c: Context, ctx: { s: Session; form: FormData }) => Promise<Response>,
    ) => {
      app.post(`${prefix}${path}`, async (c) => {
        const s = needAdmin(c);
        if (s instanceof Response) return s;
        const form = await guardPost(c, s, lang, href("/admin"));
        if (form instanceof Response) return form;
        return fn(c, { s, form });
      });
    };
    const keyFlash = (text: string, key: string): Flash => ({
      kind: "ok",
      text,
      secret: { label: t.admin.newKey, note: t.admin.newKeyNote, value: key },
    });

    adminPost("/admin/teams", async (c, { s, form }) => {
      const name = cleanTeamName(field(form, "name"));
      if (!name) return done(c, s, href("/admin"), { kind: "err", text: t.badRequest });
      const backendOn = field(form, "backend") === "1";
      const { team: created, key } = await teams.create(
        name,
        backendOn,
        now(),
        field(form, "directory") === "1",
        {
          // Permanent links follow backend access unless the admin says otherwise.
          permanent: form.has("permanent") ? field(form, "permanent") === "1" : backendOn,
        },
      );
      d.invalidateDirectory();
      await d.audit({
        teamId: created.id,
        actor: ADMIN_ACTOR,
        action: "team-create",
        detail: name,
      });
      await d.audit({
        teamId: PLATFORM_AUDIT,
        actor: ADMIN_ACTOR,
        action: "team-create",
        detail: name,
      });
      return done(c, s, href("/admin"), keyFlash(t.admin.created, key));
    });

    adminPost("/admin/teams/:id/update", async (c, { s, form }) => {
      const patch: TeamPatch = {};
      // The team detail form sends every checkbox (features=1); the overview toggles send one field.
      const all = field(form, "features") === "1";
      for (const k of ["backend", "directory", "permanent"] as const) {
        const v = field(form, k);
        if (all) patch[k] = form.getAll(k).includes("1");
        else if (v === "1" || v === "0") patch[k] = v === "1";
      }
      for (const k of ["maxSites", "maxMb"] as const) {
        if (!form.has(k)) continue;
        const raw = field(form, k).trim();
        const n = Number(raw);
        if (raw === "" || n === 0) patch[k] = null;
        else if (Number.isInteger(n) && n > 0 && n <= 100_000) patch[k] = n;
        else return done(c, s, href("/admin"), { kind: "err", text: t.badRequest });
      }
      if (form.has("name")) {
        const name = cleanTeamName(field(form, "name"));
        if (name) patch.name = name;
      }
      const team = await teams.update(c.req.param("id") ?? "", patch, now());
      if (!team) return done(c, s, href("/admin"), { kind: "err", text: t.notFound });
      d.invalidateDirectory();
      await d.audit({
        teamId: team.id,
        actor: ADMIN_ACTOR,
        action: "team-update",
        detail: patchDetail(patch),
      });
      return done(c, s, href("/admin"), { kind: "ok", text: t.admin.saved });
    });

    adminPost("/admin/teams/:id/invite", async (c, { s, form }) => {
      const id = c.req.param("id") ?? "";
      if (!teams.get(id)) return done(c, s, href("/admin"), { kind: "err", text: t.notFound });
      const role = field(form, "role") || "owner";
      if (!isRole(role)) return done(c, s, href("/admin"), { kind: "err", text: t.badRequest });
      if (members.listInvites(id).length >= MAX_INVITES) {
        return done(c, s, href("/admin"), { kind: "err", text: t.members.tooManyInvites });
      }
      const { token } = await members.createInvite(
        id,
        role,
        inviteTtl(field(form, "ttlHours")),
        "admin",
      );
      await d.audit({
        teamId: id,
        actor: { kind: "admin", label: "admin" },
        action: "invite",
        detail: t.members.roles[role],
      });
      return done(c, s, href("/admin"), inviteFlash(token));
    });

    adminPost("/admin/teams/:id/rotate", async (c, { s }) => {
      const r = await teams.rotate(c.req.param("id") ?? "", now());
      if (!r) return done(c, s, href("/admin"), { kind: "err", text: t.notFound });
      await d.audit({ teamId: r.team.id, actor: ADMIN_ACTOR, action: "team-key-rotate" });
      return done(c, s, href("/admin"), keyFlash(t.admin.rotated, r.key));
    });

    // ---- 0.16.0: team export, soft delete, trash, backups, sign out everywhere --------------
    const lc = lifecycleText(lang);
    const settingsHref = href("/admin/settings");
    const day = (iso: string) =>
      new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium" }).format(
        new Date(iso),
      );
    const lifecycleErr = (c: Context, s: Session, back: string, e: unknown) => {
      if (e instanceof TeamLifecycleError) {
        const text =
          e.code === "CONFIRM_MISMATCH" ? lc.mismatch : e.status === 404 ? t.notFound : e.message;
        return done(c, s, back, { kind: "err", text });
      }
      if (e instanceof WorkerError) return done(c, s, back, { kind: "err", text: e.message });
      throw e;
    };
    const zipResponse = (c: Context, ex: { file: string; zip: Uint8Array | Buffer }) => {
      c.header("Content-Type", "application/zip");
      c.header("Content-Disposition", `attachment; filename="${ex.file}"`);
      c.header("Cache-Control", "no-store");
      return c.body(new Uint8Array(ex.zip));
    };

    adminPost("/admin/teams/:id/delete", async (c, { s, form }) => {
      const id = c.req.param("id") ?? "";
      const back = href(`/admin/teams/${id}?tab=settings`);
      if (!d.lifecycle) return done(c, s, back, { kind: "err", text: t.notFound });
      try {
        const tr = await d.lifecycle.softDelete(id, ADMIN_ACTOR, {
          deleteSites: field(form, "sites") === "delete",
          confirm: field(form, "confirm"),
        });
        return done(c, s, `${settingsHref}#trash`, {
          kind: "ok",
          text: lc.moved(day(tr.purgeAfter)),
        });
      } catch (e) {
        return lifecycleErr(c, s, back, e);
      }
    });

    app.get(`${prefix}/admin/teams/:id/export`, async (c) => {
      const s = needAdmin(c);
      if (s instanceof Response) return s;
      const team = teams.get(c.req.param("id") ?? "");
      if (!team || !d.lifecycle) return c.notFound();
      const ex = await d.lifecycle.exportTeam(team);
      await d.audit({ teamId: team.id, actor: ADMIN_ACTOR, action: "team-export" });
      return zipResponse(c, ex);
    });

    app.get(`${prefix}/admin/trash/:id/export`, async (c) => {
      const s = needAdmin(c);
      if (s instanceof Response) return s;
      const ex = await d.lifecycle?.trashedExport(c.req.param("id") ?? "");
      if (!ex) return c.notFound();
      return zipResponse(c, ex);
    });

    adminPost("/admin/trash/:id/restore", async (c, { s }) => {
      const id = c.req.param("id") ?? "";
      if (!d.lifecycle) return done(c, s, settingsHref, { kind: "err", text: t.notFound });
      try {
        await d.lifecycle.restore(id, ADMIN_ACTOR);
        return done(c, s, href(`/admin/teams/${id}`), { kind: "ok", text: lc.restored });
      } catch (e) {
        return lifecycleErr(c, s, `${settingsHref}#trash`, e);
      }
    });

    adminPost("/admin/trash/:id/purge", async (c, { s, form }) => {
      const id = c.req.param("id") ?? "";
      if (!d.lifecycle) return done(c, s, settingsHref, { kind: "err", text: t.notFound });
      try {
        await d.lifecycle.purge(id, ADMIN_ACTOR, field(form, "confirm"));
        return done(c, s, `${settingsHref}#trash`, { kind: "ok", text: lc.purged });
      } catch (e) {
        return lifecycleErr(c, s, `${settingsHref}#trash`, e);
      }
    });

    adminPost("/admin/backups/run", async (c, { s }) => {
      const back = `${settingsHref}#backups`;
      if (!d.backups?.enabled) return done(c, s, back, { kind: "err", text: lc.backupsOff });
      const r = await d.backups.run("manual");
      await d.audit({
        teamId: PLATFORM_AUDIT,
        actor: ADMIN_ACTOR,
        action: r.ok ? "backup-run" : "backup-fail",
        detail: r.ok ? r.key : r.error,
      });
      return done(c, s, back, {
        kind: r.ok ? "ok" : "err",
        text: r.ok
          ? lc.backupOk(`${Math.round(((r.bytes ?? 0) / 1024 / 1024) * 10) / 10} MB`)
          : lc.backupFail(r.error ?? "?"),
      });
    });

    adminPost("/admin/backups/test-restore", async (c, { s }) => {
      const back = `${settingsHref}#backups`;
      if (!d.backups?.enabled) return done(c, s, back, { kind: "err", text: lc.backupsOff });
      const r = await d.backups.testRestore();
      await d.audit({
        teamId: PLATFORM_AUDIT,
        actor: ADMIN_ACTOR,
        action: "backup-restore-test",
        detail: r.ok ? `ok, ${r.files ?? 0} files` : `failed: ${r.error ?? "?"}`,
      });
      return done(c, s, back, {
        kind: r.ok ? "ok" : "err",
        text: r.ok
          ? lc.restoreOk((r.files ?? 0).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB"))
          : lc.restoreFail(r.error ?? "?"),
      });
    });

    adminPost("/admin/sessions/end-all", async (c, { s }) => {
      sessions.endAll("admin");
      sessions.end(c, s);
      await d.audit({ teamId: PLATFORM_AUDIT, actor: ADMIN_ACTOR, action: "sessions-end-all" });
      return c.redirect(href("/admin/login?out=1"), 303);
    });

    // ---- admin: team, Worker and space detail pages (0.15.0) ---------------------------
    const adminTeamRows = async (team: Team) => {
      const sites = (await store.list())
        .filter((m) => m.teamId === team.id && live(m))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((m) => teamRow(m, team));
      await withVisits(sites);
      return sites;
    };
    const workerList = async (recs: ReturnType<typeof d.workers.list>, admin = false) => {
      const sites = await store.list();
      // Sparklines come from a cached snapshot (refreshed in the background, never blocking).
      const snap =
        d.ops && d.workers.configured && recs.length
          ? d.ops.analytics.snapshot(recs.map((r) => r.script))
          : null;
      return Promise.all(
        recs.map(async (r) => {
          const team = teams.get(r.teamId);
          const v = await d.userKeyOps.view(r).catch(() => null);
          const active = v ? v.keys.filter((k) => k.state === "active").length : 0;
          return {
            ...workerView(r),
            team: { id: r.teamId, name: team?.name ?? null },
            keysOn: !!v?.settings.required,
            keysCount: active,
            requests7: v?.keys.length ? v.keys.reduce((n, k) => n + k.usage.last7d, 0) : null,
            insight: await insightRow(r, sites, admin),
            ...(d.ops ? { health: d.ops.health.cell(r.id), spark: snap?.[r.script] ?? null } : {}),
          };
        }),
      );
    };
    app.get(`${prefix}/admin/teams/:id`, async (c) => {
      const s = needAdmin(c);
      if (s instanceof Response) return s;
      const team = teams.get(c.req.param("id") ?? "");
      if (!team) return done(c, s, href("/admin"), { kind: "err", text: t.notFound });
      await d.agentKeys.ready();
      const sites = await adminTeamRows(team);
      const usage = await d.usageOf(team);
      const wq = d.workers.quotaOf(team);
      return page(
        c,
        adminTeamHtml(lang, config, {
          tab: c.req.query("tab") ?? "overview",
          team: {
            id: team.id,
            name: team.name,
            slug: team.slug ?? null,
            keyPrefix: team.keyPrefix,
            createdAt: team.createdAt,
            backend: team.backend,
            directory: team.directory,
            permanent: team.permanent,
            workers: !!team.workers,
            maxSites: team.maxSites ?? null,
            maxMb: team.maxMb ?? null,
            maxWorkers: team.maxWorkers ?? null,
            maxWorkerKb: team.maxWorkerKb ?? null,
          },
          quota: { ...d.quotaOf(team), workers: wq.workers, kb: wq.kb },
          usage,
          views7: d.visits.enabled ? sites.reduce((n, x) => n + (x.visits?.views7 ?? 0), 0) : null,
          views30: d.visits.enabled
            ? sites.reduce((n, x) => n + (x.visits?.views30 ?? 0), 0)
            : null,
          members: members.list(team.id).map((m) => ({
            id: m.id,
            name: m.name,
            username: m.username,
            role: m.role,
            createdAt: m.createdAt,
            lastLoginAt: m.lastLoginAt ?? null,
          })),
          invites: members.listInvites(team.id).length,
          sites: sites.map((x) => ({ ...x, owner: { id: team.id, name: team.name } })),
          workers: await workerList(d.workers.list(team.id), true),
          agentKeys: d.agentKeys.list(team.id).map((k) => d.agentKeys.view(k)),
          audit: members.entries(team.id, undefined, 100).map((e) => auditView(e)),
          cfConfigured: d.workers.settingsView().configured,
          csrf: sessions.csrfFor(s),
          flash: takeFlash(c, s),
        }),
      );
    });
    const adminWorker = (c: Context) => {
      const team = teams.get(c.req.param("id") ?? "");
      const rec = team ? d.workers.find(team.id, c.req.param("name") ?? "") : null;
      return team && rec ? { team, rec } : null;
    };
    app.get(`${prefix}/admin/teams/:id/workers/:name`, async (c) => {
      const s = needAdmin(c);
      if (s instanceof Response) return s;
      const x = adminWorker(c);
      if (!x) return done(c, s, href("/admin/workers"), { kind: "err", text: t.notFound });
      const tab = c.req.query("tab") ?? "overview";
      return page(
        c,
        workerDetailHtml(lang, config, {
          kind: "admin",
          tab,
          base: `/admin/teams/${x.team.id}/workers/${x.rec.name}`,
          team: { id: x.team.id, name: x.team.name },
          ctx: ADMIN_CTX(lang),
          csrf: sessions.csrfFor(s),
          flash: takeFlash(c, s),
          ...(await workerDetailData(x.rec, tab, true, c)),
          canEdit: true,
        }),
      );
    });
    app.get(`${prefix}/admin/teams/:id/workers/:name/versions/:n/code`, async (c) => {
      const s = needAdmin(c);
      if (s instanceof Response) return s;
      const x = adminWorker(c);
      const v = x ? await d.workers.getVersion(x.rec, Number(c.req.param("n"))) : null;
      if (!x || !v) return done(c, s, href("/admin/workers"), { kind: "err", text: t.notFound });
      return codeDownload(c, x.rec.name, v.n, v.code);
    });
    const adminMember = (c: Context) => {
      const m = members.get(c.req.param("mid") ?? "");
      return m && m.teamId === c.req.param("id") ? m : null;
    };
    adminPost("/admin/teams/:id/members/:mid/role", async (c, { s, form }) => {
      const m = adminMember(c);
      const role = field(form, "role");
      if (!m) return done(c, s, href("/admin"), { kind: "err", text: t.notFound });
      if (!isRole(role)) return done(c, s, href("/admin"), { kind: "err", text: t.badRequest });
      await members.setRole(m.id, role);
      await d.audit({
        teamId: m.teamId,
        actor: ADMIN_ACTOR,
        action: "member-role",
        detail: `${m.name} → ${t.members.roles[role]}`,
      });
      return done(c, s, href(`/admin/teams/${m.teamId}?tab=members`), {
        kind: "ok",
        text: t.members.roleSaved,
      });
    });
    adminPost("/admin/teams/:id/members/:mid/delete", async (c, { s }) => {
      const m = adminMember(c);
      if (!m) return done(c, s, href("/admin"), { kind: "err", text: t.notFound });
      await members.remove(m.id);
      await d.audit({
        teamId: m.teamId,
        actor: ADMIN_ACTOR,
        action: "member-remove",
        detail: m.name,
      });
      return done(c, s, href(`/admin/teams/${m.teamId}?tab=members`), {
        kind: "ok",
        text: t.members.removed,
      });
    });
    adminPost("/admin/teams/:id/agents/:kid/revoke", async (c, { s }) => {
      const id = c.req.param("id") ?? "";
      await d.agentKeys.ready();
      const k = teams.get(id)
        ? await d.agentKeys.revoke(id, c.req.param("kid") ?? "", "admin")
        : null;
      if (!k) return done(c, s, href("/admin"), { kind: "err", text: t.notFound });
      await d.audit({
        teamId: id,
        actor: ADMIN_ACTOR,
        action: "agent-key-revoke",
        detail: `${k.name} (${k.prefix}…)`,
      });
      return done(c, s, href(`/admin/teams/${id}?tab=agents`), { kind: "ok", text: v14.revoked });
    });

    app.get(`${prefix}/admin/spaces/:id`, (c) =>
      c.redirect(href(`/admin/sites/${encodeURIComponent(c.req.param("id") ?? "")}`), 301),
    );
    app.get(`${prefix}/admin/sites/:id`, async (c) => {
      const s = needAdmin(c);
      if (s instanceof Response) return s;
      const m = await store.get(c.req.param("id") ?? "");
      if (!m) return done(c, s, href("/admin/sites"), { kind: "err", text: t.notFound });
      const team = teams.get(m.teamId) ?? null;
      const data = await siteDetailData(m, team);
      const audit = members.entries(team?.id ?? PLATFORM_AUDIT, m.id, 50).map((e) => auditView(e));
      return page(
        c,
        siteDetailHtml(lang, config, {
          kind: "admin",
          tab: c.req.query("tab") ?? "overview",
          base: `/admin/sites/${m.id}`,
          ctx: ADMIN_CTX(lang),
          csrf: sessions.csrfFor(s),
          flash: takeFlash(c, s),
          canEdit: true,
          owner: team ? { id: team.id, name: team.name } : null,
          teamPermanent: !!team?.permanent,
          teamDirectory: !!team?.directory,
          ...data,
          audit,
          preview: href(`/admin/sites/${m.id}/preview?v=${previewVersion(m)}`),
        }),
      );
    });
    app.get(`${prefix}/admin/sites/:id/preview`, async (c) => {
      if (!adminSession(c)) return c.body(null, 404);
      const m = await store.get(c.req.param("id") ?? "");
      if (!m) return c.body(null, 404);
      return previewResponse(c, m, teams.get(m.teamId) ?? null);
    });
    adminPost("/admin/sites/:id/token", async (c, { s }) => {
      const m = await store.get(c.req.param("id") ?? "");
      if (!m) return done(c, s, href("/admin/sites"), { kind: "err", text: t.notFound });
      const token = newEditToken();
      m.tokenHash = hashToken(token);
      await store.updateMeta(m);
      await d.audit({
        teamId: teams.get(m.teamId) ? m.teamId : PLATFORM_AUDIT,
        siteId: m.id,
        actor: ADMIN_ACTOR,
        action: "edit-token-rotate",
      });
      return done(c, s, href(`/admin/sites/${m.id}?tab=settings`), {
        kind: "ok",
        text: DX[lang].tokenDone,
        secret: { label: DX[lang].tokenNew, note: DX[lang].tokenDone, value: token },
      });
    });

    // ---- admin: notification center + platform webhook (0.14.0) ------------------------
    const aAlerts = href("/admin/notifications");
    app.get(`${prefix}/admin/notifications`, async (c) => {
      const s = needAdmin(c);
      if (s instanceof Response) return s;
      await d.notify.ready();
      return page(
        c,
        adminNotificationsHtml(lang, config, {
          notices: rowsFor(null, null),
          unread: d.notify.unread(null, null),
          hook: d.notify.hook(PLATFORM),
          canManage: true,
          csrf: sessions.csrfFor(s),
          flash: takeFlash(c, s),
        }),
      );
    });
    adminPost("/admin/notifications/read", async (c, { s }) => {
      await d.notify.markRead(null, null);
      return done(c, s, aAlerts);
    });
    adminPost("/admin/notifications/webhook", async (c, { s, form }) => {
      try {
        const r = await d.notify.setHook(PLATFORM, field(form, "url"));
        await d.audit({
          teamId: PLATFORM_AUDIT,
          actor: ADMIN_ACTOR,
          action: "webhook-set",
          detail: new URL(r.hook.url).host,
        });
        return done(c, s, aAlerts, hookSaved(r.secret));
      } catch (e) {
        return hookErr(c, s, aAlerts, e);
      }
    });
    adminPost("/admin/notifications/webhook/test", async (c, { s }) =>
      done(c, s, aAlerts, testFlash(await d.notify.test(PLATFORM, "admin"))),
    );
    adminPost("/admin/notifications/webhook/delete", async (c, { s }) => {
      await d.notify.clearHook(PLATFORM);
      await d.audit({ teamId: PLATFORM_AUDIT, actor: ADMIN_ACTOR, action: "webhook-clear" });
      return done(c, s, aAlerts, { kind: "ok", text: v14.hookRemoved });
    });

    // ---- admin: platform recipes (0.14.0) ------------------------------------------------
    const aRecipes = href("/admin/recipes");
    const aSkeleton = { en: recipeSkeleton("en"), ar: recipeSkeleton("ar") };
    app.get(`${prefix}/admin/recipes`, async (c) => {
      const s = needAdmin(c);
      if (s instanceof Response) return s;
      await d.recipes.ready();
      return page(
        c,
        dashRecipesHtml(lang, config, {
          kind: "admin",
          list: d.recipes.visible(null).map((r) => summaryOf(r, lang)),
          canWrite: true,
          csrf: sessions.csrfFor(s),
          flash: takeFlash(c, s),
          skeleton: aSkeleton,
        }),
      );
    });
    app.get(`${prefix}/admin/recipes/:slug`, async (c) => {
      const s = needAdmin(c);
      if (s instanceof Response) return s;
      await d.recipes.ready();
      const r = d.recipes.get(c.req.param("slug") ?? "", null);
      if (!r) return done(c, s, aRecipes, { kind: "err", text: t.notFound });
      const served = servedLang(r, lang);
      return page(
        c,
        dashRecipeHtml(lang, config, {
          kind: "admin",
          list: [],
          recipe: r,
          html: recipeHtml(r, served),
          served,
          canWrite: r.scope === "platform",
          csrf: sessions.csrfFor(s),
          flash: takeFlash(c, s),
          skeleton: aSkeleton,
        }),
      );
    });
    adminPost("/admin/recipes", async (c, { s, form }) => {
      await d.recipes.ready();
      try {
        const r = await d.recipes.save1(
          null,
          field(form, "slug"),
          {
            title_en: field(form, "title_en"),
            title_ar: field(form, "title_ar"),
            summary_en: field(form, "summary_en"),
            summary_ar: field(form, "summary_ar"),
            body_en: field(form, "body_en"),
            body_ar: field(form, "body_ar"),
            tags: field(form, "tags"),
          },
          "admin",
        );
        await d.audit({
          teamId: PLATFORM_AUDIT,
          actor: ADMIN_ACTOR,
          action: "recipe-save",
          detail: `${r.slug} v${r.version}`,
        });
        return done(c, s, href(`/admin/recipes/${r.slug}`), {
          kind: "ok",
          text: R14[lang].saved(r.version),
        });
      } catch (e) {
        if (e instanceof RecipeError) return done(c, s, aRecipes, { kind: "err", text: e.message });
        throw e;
      }
    });
    adminPost("/admin/recipes/:slug/delete", async (c, { s }) => {
      await d.recipes.ready();
      const ok = await d.recipes.remove(null, c.req.param("slug") ?? "");
      if (ok)
        await d.audit({
          teamId: PLATFORM_AUDIT,
          actor: ADMIN_ACTOR,
          action: "recipe-delete",
          detail: c.req.param("slug") ?? "",
        });
      return done(
        c,
        s,
        aRecipes,
        ok ? { kind: "ok", text: R14[lang].deleted } : { kind: "err", text: t.notFound },
      );
    });

    // ---- admin: Workers (0.12.0) ------------------------------------------------------
    const wBack = href("/admin/workers");
    app.get(`${prefix}/admin/notes`, async (c) => {
      const s = needAdmin(c);
      if (s instanceof Response) return s;
      await d.notes?.ready();
      return page(
        c,
        notesHtml(lang, config, {
          kind: "admin",
          csrf: sessions.csrfFor(s),
          ctx: ADMIN_CTX(lang),
          flash: takeFlash(c, s),
          notes: d.notes?.list({}, 500) ?? [],
          teams: teams.list().map((x) => ({ id: x.id, name: x.name })),
        }),
      );
    });
    adminPost("/admin/notes/:id", async (c, { s, form }) => {
      const back = localBack(form, href("/admin/notes"));
      if (!d.notes) return done(c, s, back, { kind: "err", text: t.notFound });
      try {
        const n = await d.notes.update(
          c.req.param("id") ?? "",
          {
            ...(form.has("status") ? { status: field(form, "status") } : {}),
            ...(form.has("reply") ? { reply: field(form, "reply") } : {}),
          },
          "admin",
        );
        await d.audit({
          teamId: n.teamId,
          actor: ADMIN_ACTOR,
          action: "note-update",
          detail: n.status,
        });
      } catch (e) {
        if (e instanceof NoteError) return done(c, s, back, { kind: "err", text: e.message });
        throw e;
      }
      return done(c, s, back, { kind: "ok", text: NX[lang].saved });
    });
    app.get(`${prefix}/admin/mcp`, async (c) => {
      const s = needAdmin(c);
      if (s instanceof Response) return s;
      return page(
        c,
        mcpServersHtml(lang, config, {
          kind: "admin",
          csrf: sessions.csrfFor(s),
          ctx: ADMIN_CTX(lang),
          flash: takeFlash(c, s),
          rows: await workerList(d.workers.list(), true),
          canEdit: true,
        }),
      );
    });
    app.get(`${prefix}/admin/workers`, async (c) => {
      const s = needAdmin(c);
      if (s instanceof Response) return s;
      return page(
        c,
        adminWorkersHtml(lang, config, {
          settings: d.workers.settingsView(),
          teams: teams.list().map((x) => ({
            id: x.id,
            name: x.name,
            workers: !!x.workers,
            slug: x.slug ?? null,
            maxWorkers: x.maxWorkers ?? null,
            maxWorkerKb: x.maxWorkerKb ?? null,
            quota: d.workers.quotaOf(x),
            count: d.workers.list(x.id).length,
          })),
          workers: await workerList(d.workers.list(), true),
          audit: members.entries(PLATFORM_AUDIT, undefined, 30).map((e) => auditView(e)),
          csrf: sessions.csrfFor(s),
          flash: takeFlash(c, s),
        }),
      );
    });
    const sBack = href("/admin/settings");
    const wErr = (c: Context, s: Session, e: unknown, back: string) => {
      if (e instanceof WorkerError) return done(c, s, back, { kind: "err", text: e.message });
      throw e;
    };
    const wPost = (
      path: string,
      fn: (c: Context, ctx: { s: Session; form: FormData; back: string }) => Promise<Response>,
      fixedBack?: string,
    ) => {
      app.post(`${prefix}${path}`, async (c) => {
        const s = needAdmin(c);
        if (s instanceof Response) return s;
        const form = await guardPost(c, s, lang, fixedBack ?? wBack);
        if (form instanceof Response) return form;
        // Inline controls on the overview send back=admin to return there.
        const back = fixedBack ?? (field(form, "back") === "admin" ? href("/admin") : wBack);
        try {
          return await fn(c, { s, form, back });
        } catch (e) {
          return wErr(c, s, e, back);
        }
      });
    };
    wPost(
      "/admin/workers/settings",
      async (c, { s, form }) => {
        const token = field(form, "token").trim();
        await d.workers.saveSettings(
          {
            ...(token ? { token } : {}),
            accountId: field(form, "accountId"),
            zone: field(form, "zone"),
          },
          ADMIN_ACTOR,
        );
        return done(c, s, sBack, { kind: "ok", text: WS[lang].saved });
      },
      sBack,
    );
    wPost(
      "/admin/workers/settings/verify",
      async (c, { s }) => {
        const v = await d.workers.verifySettings();
        return done(c, s, sBack, {
          kind: v.status === "active" ? "ok" : "err",
          text: WS[lang].verifiedFlash(v.status ?? "?"),
        });
      },
      sBack,
    );
    wPost(
      "/admin/workers/settings/clear",
      async (c, { s }) => {
        await d.workers.clearSettings(ADMIN_ACTOR);
        return done(c, s, sBack, { kind: "ok", text: WS[lang].cleared });
      },
      sBack,
    );
    wPost("/admin/workers/teams/:id", async (c, { s, form, back }) => {
      const team = teams.get(c.req.param("id") ?? "");
      if (!team) return done(c, s, back, { kind: "err", text: t.notFound });
      const num = (k: string) => {
        const raw = field(form, k).trim();
        return raw === "" ? null : Number(raw);
      };
      // Only fields present in the form change: the overview's on/off toggle
      // must not reset the quotas.
      const patch = readTeamWorkers(d.workers, team, {
        enabled: field(form, "enabled") === "1",
        ...(field(form, "slug").trim() ? { slug: field(form, "slug") } : {}),
        ...(form.has("maxWorkers") ? { maxWorkers: num("maxWorkers") } : {}),
        ...(form.has("maxWorkerKb") ? { maxWorkerKb: num("maxWorkerKb") } : {}),
      });
      if (typeof patch === "string") return done(c, s, back, { kind: "err", text: patch });
      await applyTeamWorkers(
        { teams, workers: d.workers },
        team,
        patch,
        now(),
        ADMIN_ACTOR,
        d.audit as never,
      );
      return done(c, s, back, { kind: "ok", text: WS[lang].teamSaved });
    });
    for (const [act, off] of [
      ["disable", true],
      ["enable", false],
    ] as const) {
      wPost(`/admin/workers/:id/${act}`, async (c, { s }) => {
        const rec = d.workers.get(c.req.param("id") ?? "");
        if (!rec) return done(c, s, wBack, { kind: "err", text: t.notFound });
        await d.workers.setDisabled(rec, off, ADMIN_ACTOR);
        return done(c, s, wBack, { kind: "ok", text: t.admin.saved });
      });
    }
    // 0.15.1: re-run the read-only tools/list probe now (never calls a tool).
    wPost("/admin/workers/:id/probe", async (c, { s, form }) => {
      const wBack = localBack(form, href("/admin/mcp"));
      const rec = d.workers.get(c.req.param("id") ?? "");
      if (!rec) return done(c, s, wBack, { kind: "err", text: t.notFound });
      const ins = await insightRow(rec, [], true);
      if (ins.endpoint && d.mcpProbe) await d.mcpProbe.refresh(rec.id, rec.version, ins.endpoint);
      if (rec.repo && d.repoChecker) await d.repoChecker.check(rec.repo);
      return done(c, s, wBack, { kind: "ok", text: IX[lang].refreshed });
    });
    for (const what of ["secret", "var", "health", "logs"] as const) {
      wPost(`/admin/workers/:id/${what}`, async (c, { s, form }) => {
        const rec = d.workers.get(c.req.param("id") ?? "");
        const back = localBack(form, wBack);
        if (!rec) return done(c, s, back, { kind: "err", text: t.notFound });
        return opsEdit(c, s, what, rec, form, ADMIN_ACTOR, back);
      });
    }
    // 0.15.2: token permission checklist (recheck = fresh read-only probes) + interval.
    wPost(
      "/admin/settings/permissions",
      async (c, { s }) => {
        const reps = await Promise.all([
          d.ops?.workersPermissions(true).catch(() => null),
          d.ops?.backendPermissions(true).catch(() => null),
        ]);
        await d.audit({
          teamId: PLATFORM_AUDIT,
          actor: ADMIN_ACTOR,
          action: "permissions-recheck",
          detail: permDetail(reps),
        });
        return done(c, s, `${sBack}#permissions`, { kind: "ok", text: IX[lang].refreshed });
      },
      sBack,
    );
    wPost(
      "/admin/settings/health-interval",
      async (c, { s, form }) => {
        try {
          const sec = await d.ops?.health.setInterval(Number(field(form, "intervalSec")));
          await d.audit({
            teamId: PLATFORM_AUDIT,
            actor: ADMIN_ACTOR,
            action: "health-interval",
            detail: `${sec}s`,
          });
        } catch (e) {
          if (e instanceof RangeError) return done(c, s, sBack, { kind: "err", text: e.message });
          throw e;
        }
        return done(c, s, sBack, { kind: "ok", text: t.admin.saved });
      },
      sBack,
    );
    wPost("/admin/workers/:id/delete", async (c, { s }) => {
      const rec = d.workers.get(c.req.param("id") ?? "");
      if (!rec) return done(c, s, wBack, { kind: "err", text: t.notFound });
      await d.workers.remove(rec, ADMIN_ACTOR);
      return done(c, s, wBack, { kind: "ok", text: WS[lang].deleted });
    });

    app.get(`${prefix}/admin/activity/export`, async (c) => {
      const s = needAdmin(c);
      if (s instanceof Response) return s;
      const raw = c.req.query("team") ?? "";
      const ids =
        raw === "platform"
          ? [PLATFORM_AUDIT]
          : raw && teams.get(raw)
            ? [raw]
            : [PLATFORM_AUDIT, ...teams.list().map((x) => x.id)];
      const { query, format } = readActivityQuery((k) => c.req.query(k));
      const name = (id: string) => (id === PLATFORM_AUDIT ? null : (teams.get(id)?.name ?? null));
      const rows = queryActivity(members, ids, { ...query, limit: ACTIVITY_MAX }).map((e) =>
        activityRow(e, name),
      );
      return sendActivity(c, rows, format === "json" ? "csv" : format, `activity-${raw || "all"}`);
    });

    app.get(`${prefix}/admin/activity`, async (c) => {
      const s = needAdmin(c);
      if (s instanceof Response) return s;
      const all = teams.list();
      const rawTeam = c.req.query("team") ?? "";
      const team = rawTeam === "platform" || teams.get(rawTeam) ? rawTeam : "";
      const kind = activityKind(c.req.query("kind"));
      const q = (c.req.query("q") ?? "").trim().slice(0, 80);
      const ids = team
        ? [team === "platform" ? PLATFORM_AUDIT : team]
        : [PLATFORM_AUDIT, ...all.map((x) => x.id)];
      const titles = new Map((await store.list()).map((m) => [m.id, m.title || m.id]));
      const audit = ids
        .flatMap((id) => {
          const tm = id === PLATFORM_AUDIT ? null : teams.get(id);
          return members.entries(id, undefined, 500).map((e) => ({
            ...auditView(e, titles),
            team: tm ? { id: tm.id, name: tm.name } : null,
          }));
        })
        .filter(
          (e) =>
            (!kind || e.kind === kind) &&
            (matchesAudit(e, q, lang) ||
              (!!q && !!e.team?.name.toLowerCase().includes(q.toLowerCase()))),
        )
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 300);
      return page(
        c,
        adminActivityHtml(lang, config, {
          audit,
          teams: all.map((x) => ({ id: x.id, name: x.name })),
          team,
          kind,
          q,
          csrf: sessions.csrfFor(s),
          flash: takeFlash(c, s),
        }),
      );
    });

    app.get(`${prefix}/admin/settings`, async (c) => {
      const s = needAdmin(c);
      if (s instanceof Response) return s;
      return page(
        c,
        adminSettingsHtml(lang, config, {
          settings: d.workers.settingsView(),
          server: {
            version: APP_VERSION,
            publicUrl: config.publicUrl,
            backend: !!backend,
            secretsKey: !!config.secretsKey,
            sessionKey: !config.sessions.ephemeral,
            maxUploadMb: Math.round(config.maxSiteBytes / 1024 / 1024),
            teamSites: config.teamMaxSites,
            teamMb: Math.round(config.teamMaxBytes / 1024 / 1024),
            workersMax: config.workers.defaultMax,
            workerKb: config.workers.defaultMaxKb,
            health: backend ? await probeBackend(backend) : null,
          },
          extra: d.ops
            ? permsSection(
                lang,
                d.workers.configured
                  ? permOrPending(d.ops.permissionsNow("workers"), "workers")
                  : null,
                permOrPending(d.ops.permissionsNow("backend"), "backend"),
                href("/admin/settings/permissions"),
                sessions.csrfFor(s),
                href("/admin/settings"),
                intervalForm(
                  lang,
                  href("/admin/settings/health-interval"),
                  sessions.csrfFor(s),
                  href("/admin/settings"),
                  d.ops.health.interval,
                ),
              )
            : "",
          lifecycle: [
            d.backups
              ? backupsSection(lang, await d.backups.status(), sessions.csrfFor(s), settingsHref)
              : "",
            trashSection(
              lang,
              teams.listTrash().map((tr) => ({
                id: tr.team.id,
                name: tr.team.name,
                deletedAt: tr.deletedAt,
                purgeAfter: tr.purgeAfter,
                deletedBy: tr.deletedBy,
                deleteSites: tr.deleteSites,
                workersTurnedOff: tr.disabledWorkers.length,
                hasExport: !!tr.exportFile,
              })),
              sessions.csrfFor(s),
              settingsHref,
            ),
            signOutAllSection(
              lang,
              href("/admin/sessions/end-all"),
              sessions.csrfFor(s),
              "admin",
              sessions.endedAllAt("admin"),
            ),
          ].join(""),
          csrf: sessions.csrfFor(s),
          flash: takeFlash(c, s),
        }),
      );
    });

    const ownerFilter = (raw: string | undefined) =>
      raw === "guest" || raw === "permanent" || (raw && teams.get(raw)) ? raw : "all";

    app.get(`${prefix}/admin/sites`, async (c) => {
      const s = needAdmin(c);
      if (s instanceof Response) return s;
      const owner = ownerFilter(c.req.query("owner"));
      const sites = (await store.list())
        .filter((m) => live(m))
        .filter((m) =>
          owner === "all"
            ? true
            : owner === "guest"
              ? !teams.get(m.teamId)
              : owner === "permanent"
                ? !!m.permanent
                : m.teamId === owner,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((m) => {
          const tm = teams.get(m.teamId);
          return {
            id: m.id,
            title: m.title || m.id,
            url: d.siteUrl(m.id),
            owner: tm?.name ?? null,
            ownerId: tm?.id ?? null,
            createdAt: m.createdAt,
            expiresAt: m.expiresAt,
            totalBytes: m.totalBytes,
            fileCount: m.fileCount,
            permanent: !!m.permanent,
            ...repoOfSite(m),
          } as AdminSiteRow;
        });
      await withVisits(sites);
      return page(
        c,
        adminSitesHtml(lang, config, {
          sites,
          teams: teams.list().map((x) => ({ id: x.id, name: x.name })),
          owner,
          csrf: sessions.csrfFor(s),
          flash: takeFlash(c, s),
        }),
      );
    });

    adminPost("/admin/sites/:id/permanent", async (c, { s, form }) => {
      const owner = ownerFilter(field(form, "owner"));
      const back = href(`/admin/sites${owner === "all" ? "" : `?owner=${owner}`}`);
      const m = await store.get(c.req.param("id") ?? "");
      if (!m || !live(m)) return done(c, s, back, { kind: "err", text: t.notFound });
      const on = field(form, "permanent") === "1";
      if (on && !teams.get(m.teamId)) return done(c, s, back, { kind: "err", text: t.badRequest });
      await d.setPermanent(m, on);
      await d.audit({
        teamId: m.teamId,
        siteId: m.id,
        actor: ADMIN_ACTOR,
        action: on ? "permanent" : "permanent-off",
        detail: m.title,
      });
      return done(c, s, back, { kind: "ok", text: on ? t.team.madePermanent : t.admin.revoked });
    });

    adminPost("/admin/sites/:id/delete", async (c, { s, form }) => {
      const owner = ownerFilter(field(form, "owner"));
      const back = href(`/admin/sites${owner === "all" ? "" : `?owner=${owner}`}`);
      const id = c.req.param("id") ?? "";
      const gone = await store.get(id);
      if (!gone) return done(c, s, back, { kind: "err", text: t.notFound });
      await d.deleteSite(id);
      await d.audit({
        teamId: teams.get(gone.teamId) ? gone.teamId : PLATFORM_AUDIT,
        siteId: id,
        actor: ADMIN_ACTOR,
        action: "delete",
        detail: gone.title || id,
      });
      return done(c, s, back, { kind: "ok", text: t.admin.siteDeleted });
    });
  }
}

/** 0.16.0: a placeholder while the first permission probe runs in the background. */
function permOrPending(r: PermReport | null, token: "workers" | "backend"): PermReport {
  return r ?? { token, configured: true, checks: [], granted: 0, required: 0, at: "" };
}

/** 0.16.0: "backend on, maxSites 10" for a team update's audit entry. */
function patchDetail(p: object): string {
  return Object.entries(p)
    .map(([k, v]) => (typeof v === "boolean" ? `${k} ${v ? "on" : "off"}` : `${k} ${v ?? "-"}`))
    .join(", ")
    .slice(0, 300);
}

/** 0.16.0: "workers ok, backend 1 missing" for a permissions recheck's audit entry. */
function permDetail(
  reps: (
    | { token: string; configured: boolean; granted: number; required: number }
    | null
    | undefined
  )[],
): string {
  return reps
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => (r.configured ? `${r.token} ${r.granted}/${r.required}` : `${r.token} not set`))
    .join(", ");
}

/** A "back" field limited to this app's own dashboard pages (no open redirects). */
function localBack(form: FormData, fallback: string): string {
  const v = String(form.get("back") ?? "");
  return /^\/(?:ar\/)?(?:admin|team)(?:\/[A-Za-z0-9_.\-/]*)?(?:\?[A-Za-z0-9_=&.-]*)?$/.test(v) &&
    !v.includes("//")
    ? v
    : fallback;
}
