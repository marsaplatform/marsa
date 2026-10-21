import { randomBytes } from "node:crypto";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { probeBackend } from "./backend/health.js";
import type { SiteBackend } from "./backend/types.js";
import { APP_VERSION } from "./brand.js";
import { clientIp } from "./client-ip.js";
import type { Config } from "./config.js";
import { UploadError } from "./errors.js";
import { type Lang, STRINGS } from "./i18n.js";
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
import type { RateLimiter } from "./rate-limit.js";
import { fingerprint, type Session, type Sessions, sameOrigin } from "./session.js";
import type { SiteMeta, SiteStore } from "./store.js";
import { cleanTeamName, type Team, type TeamPatch, type TeamStore } from "./teams.js";
import { safeEqual } from "./tokens.js";
import {
  type AdminSiteRow,
  type AdminStats,
  type AuditView,
  adminActivityHtml,
  adminSettingsHtml,
  adminSitesHtml,
  adminTeamsHtml,
  adminWorkersHtml,
  type Flash,
  joinHtml,
  localePath,
  loginHtml,
  membersHtml,
  messageHtml,
  type TeamSiteRow,
  teamActivityHtml,
  teamHtml,
  teamSettingsHtml,
  teamSiteHtml,
  teamSitesHtml,
  teamWorkersHtml,
  WS,
} from "./ui.js";
import type { VisitCounter, VisitSummary } from "./visits.js";
import { PLATFORM_AUDIT, WorkerError, type WorkerService, workerView } from "./workers.js";
import {
  ADMIN_ACTOR,
  applyTeamWorkers,
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
    t.actorLabels[e.who] ?? "",
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
    const res = d.appPage(c, html, status);
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    return res;
  };
  const wantsJson = (c: Context) => (c.req.header("accept") ?? "").includes("application/json");

  /** Redirect after a POST (or JSON for the page script). */
  const done = (c: Context, s: Session, to: string, flash?: Flash) => {
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
  });
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

    app.get(`${prefix}/team/sites/:id`, async (c) => {
      const ts = needTeam(c);
      if (ts instanceof Response) return ts;
      const { s, team } = ts;
      const m = await ownSite(c, team);
      if (!m) return notYours(c, s);
      let backendBrowser: Parameters<typeof teamSiteHtml>[2]["backendBrowser"] = {
        state: "off",
        ...(team.backend && !backend ? { reason: t.team.backendNotConfigured } : {}),
      };
      if (backend && (team.backend || config.backend.guestAccess)) {
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
      const site = {
        ...teamRow(m, team),
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
      return page(
        c,
        teamSiteHtml(lang, config, {
          ...(await teamInfo(team)),
          backendConfigured: !!backend,
          sites: [],
          site,
          backendBrowser,
          mcp,
          me: meOf(ts),
          audit: members.entries(team.id, m.id, 30).map((e) => auditView(e)),
          csrf: sessions.csrfFor(s),
          flash: takeFlash(c, s),
        }),
      );
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
      return done(c, s, `${back}#mcp`, {
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
      return done(c, s, `${back}#mcp`, { kind: "ok", text: t.mcp.revoked });
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
      async (c, { s, team, member }) => {
        if (!member) return done(c, s, settingsBack, { kind: "err", text: t.members.keyAccount });
        const fresh = await members.endSessions(member.id);
        if (!fresh) return done(c, s, settingsBack, { kind: "err", text: t.notFound });
        const ns = sessions.start(c, "team", memberFp(fresh), team.id, fresh.id);
        return done(c, ns, settingsBack, { kind: "ok", text: t.members.signedOutAll });
      },
      "viewer",
    );

    // ---- team Workers (0.12.0) -------------------------------------------------------
    const workersBack = href("/team/workers");
    app.get(`${prefix}/team/workers`, async (c) => {
      const ts = needTeam(c);
      if (ts instanceof Response) return ts;
      const { s, team } = ts;
      const info = teamWorkersInfo(d.workers, team);
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
          { name: field(form, "name"), code, ...(vars ? { vars } : {}), secrets },
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
      const { key } = await teams.create(name, backendOn, now(), field(form, "directory") === "1", {
        // Permanent links follow backend access unless the admin says otherwise.
        permanent: form.has("permanent") ? field(form, "permanent") === "1" : backendOn,
      });
      d.invalidateDirectory();
      return done(c, s, href("/admin"), keyFlash(t.admin.created, key));
    });

    adminPost("/admin/teams/:id/update", async (c, { s, form }) => {
      const patch: TeamPatch = {};
      for (const k of ["backend", "directory", "permanent"] as const) {
        const v = field(form, k);
        if (v === "1" || v === "0") patch[k] = v === "1";
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
      return done(c, s, href("/admin"), keyFlash(t.admin.rotated, r.key));
    });

    adminPost("/admin/teams/:id/delete", async (c, { s, form }) => {
      const id = c.req.param("id") ?? "";
      if (!teams.get(id)) return done(c, s, href("/admin"), { kind: "err", text: t.notFound });
      try {
        await d.workers.teardownTeam(id, ADMIN_ACTOR);
      } catch (e) {
        if (e instanceof WorkerError)
          return done(c, s, href("/admin"), { kind: "err", text: e.message });
        throw e;
      }
      if (field(form, "sites") === "delete") {
        for (const m of await store.list()) if (m.teamId === id) await d.deleteSite(m.id);
      }
      await teams.delete(id);
      await members.purgeTeam(id);
      d.invalidateDirectory();
      return done(c, s, href("/admin"), { kind: "ok", text: t.admin.deleted });
    });

    // ---- admin: Workers (0.12.0) ------------------------------------------------------
    const wBack = href("/admin/workers");
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
          workers: d.workers.list().map((r) => ({
            ...workerView(r),
            team: { id: r.teamId, name: teams.get(r.teamId)?.name ?? null },
          })),
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
    wPost("/admin/workers/:id/delete", async (c, { s }) => {
      const rec = d.workers.get(c.req.param("id") ?? "");
      if (!rec) return done(c, s, wBack, { kind: "err", text: t.notFound });
      await d.workers.remove(rec, ADMIN_ACTOR);
      return done(c, s, wBack, { kind: "ok", text: WS[lang].deleted });
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
            permanent: !!m.permanent,
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
      return done(c, s, back, { kind: "ok", text: on ? t.team.madePermanent : t.admin.revoked });
    });

    adminPost("/admin/sites/:id/delete", async (c, { s, form }) => {
      const owner = ownerFilter(field(form, "owner"));
      const back = href(`/admin/sites${owner === "all" ? "" : `?owner=${owner}`}`);
      const id = c.req.param("id") ?? "";
      if (!(await store.exists(id))) return done(c, s, back, { kind: "err", text: t.notFound });
      await d.deleteSite(id);
      return done(c, s, back, { kind: "ok", text: t.admin.siteDeleted });
    });
  }
}
