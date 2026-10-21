import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Scope } from "./agent-keys.js";
import type { Config } from "./config.js";
import type { Actor, MemberStore } from "./members.js";
import type { RateLimiter } from "./rate-limit.js";
import { can, scopeError, type TeamAuth, type TeamCred } from "./team-auth.js";
import type { Team, TeamStore } from "./teams.js";
import { ALLOWED_COMPAT_FLAGS } from "./worker-config.js";
import { type JobKind, type JobStore, jobView } from "./worker-jobs.js";
import { versionMeta } from "./worker-versions.js";
import {
  type DeployHooks,
  listedWorker,
  PLATFORM_AUDIT,
  type VarValuesPolicy,
  varValuesHeaders,
  varValuesNotice,
  WorkerError,
  type WorkerRec,
  type WorkerService,
  type WorkerView,
  workerView,
} from "./workers.js";

export interface WorkerRouteDeps {
  config: Config;
  teams: TeamStore;
  members: MemberStore;
  workers: WorkerService;
  limiter: RateLimiter;
  now: () => number;
  teamAuth: TeamAuth;
  /** 0.15.1: is this a live space of the team (for linking a Worker to its page)? */
  siteOfTeam?: (teamId: string, siteId: string) => Promise<boolean>;
  /** 0.17.0: deploy jobs (202 + status polling). */
  jobs: JobStore;
}

const err = (c: Context, status: number, code: string, message: string) =>
  c.json({ error: { code, message } }, status as 400);

export const ADMIN_ACTOR: Actor = { kind: "admin", label: "admin" };

/** Turn a thrown WorkerError into a JSON error; rethrow anything else. */
export function workerErr(c: Context, e: unknown) {
  if (e instanceof WorkerError) return err(c, e.status, e.code, e.message);
  throw e;
}

/** The public view of a team's Workers state (no secrets). */
export function teamWorkersInfo(svc: WorkerService, team: Team) {
  return {
    enabled: svc.enabledFor(team),
    configured: svc.configured,
    slug: team.slug ?? null,
    quota: { ...svc.quotaOf(team), crons: svc.cronQuotaOf(team), kvWorkers: svc.kvQuotaOf(team) },
    allowedCompatibilityFlags: [...ALLOWED_COMPAT_FLAGS],
    workers: svc.list(team.id).map(workerView),
  };
}

/** 0.16.0: GET /api/teams/:team/workers, where var values follow the deprecation policy. */
export function teamWorkersList(
  svc: WorkerService,
  team: Team,
  policy: VarValuesPolicy,
  publicUrl: string,
) {
  const notice = varValuesNotice(policy, publicUrl);
  return {
    ...teamWorkersInfo(svc, team),
    workers: svc.list(team.id).map((r) => listedWorker(r, policy)),
    ...(notice ? { deprecations: [notice] } : {}),
  };
}

/** Parse the admin's per-team Workers form/JSON into a patch, or an error message. */
export function readTeamWorkers(
  svc: WorkerService,
  team: Team,
  body: Record<string, unknown>,
):
  | {
      enabled?: boolean;
      slug?: string;
      maxWorkers?: number | null;
      maxWorkerKb?: number | null;
      maxCrons?: number | null;
      maxKvWorkers?: number | null;
    }
  | string {
  const out: {
    enabled?: boolean;
    slug?: string;
    maxWorkers?: number | null;
    maxWorkerKb?: number | null;
    maxCrons?: number | null;
    maxKvWorkers?: number | null;
  } = {};
  if ("enabled" in body) {
    if (typeof body.enabled !== "boolean") return "enabled must be true or false";
    out.enabled = body.enabled;
  }
  if ("slug" in body && body.slug !== undefined && body.slug !== "") {
    const slug = String(body.slug).trim().toLowerCase();
    const p = svc.slugProblem(slug, team.id);
    if (p) return p;
    out.slug = slug;
  }
  const MAX = { maxWorkers: 100, maxWorkerKb: 10_240, maxCrons: 250, maxKvWorkers: 100 };
  for (const k of ["maxWorkers", "maxWorkerKb", "maxCrons", "maxKvWorkers"] as const) {
    if (!(k in body)) continue;
    const v = body[k];
    if (v === null || v === 0 || v === "") out[k] = null;
    else if (typeof v === "number" && Number.isInteger(v) && v > 0 && v <= MAX[k]) out[k] = v;
    else return `${k}: a whole number, or null for the default`;
  }
  const slug = out.slug ?? team.slug;
  if ((out.enabled ?? team.workers) && !slug) return "slug is required to enable Workers";
  return out;
}

/** Apply a per-team Workers change. Turning Workers off removes the team's Workers. */
export async function applyTeamWorkers(
  d: { teams: TeamStore; workers: WorkerService },
  team: Team,
  patch: Exclude<ReturnType<typeof readTeamWorkers>, string>,
  now: number,
  actor: Actor,
  audit: (e: { teamId: string; actor: Actor; action: string; detail?: string }) => Promise<void>,
): Promise<{ team: Team; removed: number }> {
  let removed = 0;
  if (patch.enabled === false && d.workers.list(team.id).length) {
    removed = await d.workers.teardownTeam(team.id, actor);
  }
  const next = await d.teams.update(
    team.id,
    {
      ...(patch.enabled !== undefined ? { workers: patch.enabled } : {}),
      ...(patch.slug ? { slug: patch.slug } : {}),
      ...(patch.maxWorkers !== undefined ? { maxWorkers: patch.maxWorkers } : {}),
      ...(patch.maxWorkerKb !== undefined ? { maxWorkerKb: patch.maxWorkerKb } : {}),
      ...(patch.maxCrons !== undefined ? { maxCrons: patch.maxCrons } : {}),
      ...(patch.maxKvWorkers !== undefined ? { maxKvWorkers: patch.maxKvWorkers } : {}),
    },
    now,
  );
  if (patch.enabled !== undefined && patch.enabled !== !!team.workers) {
    await audit({
      teamId: team.id,
      actor,
      action: patch.enabled ? "workers-on" : "workers-off",
      ...(patch.enabled ? { detail: next?.slug ?? "" } : {}),
    });
  }
  return { team: next ?? team, removed };
}

/**
 * Team Workers over HTTP:
 * - Team API (agents, with the team key): /api/teams/:team/workers[/:name]
 * - Admin API (ADMIN_TOKEN, mounted after the /api/admin/* guard): settings, all Workers,
 *   per-team enablement.
 */
export function mountWorkerRoutes(app: Hono, d: WorkerRouteDeps): void {
  const { teams, workers: svc, limiter, members } = d;
  const audit = async (e: { teamId: string; actor: Actor; action: string; detail?: string }) => {
    if (e.teamId === PLATFORM_AUDIT || teams.get(e.teamId)) await members.log(e);
  };

  // ---- team API ------------------------------------------------------------------------
  const teamOf = async (c: Context, scope: Scope): Promise<TeamCred | Response> => {
    const cred = await d.teamAuth(c);
    if (!cred || cred === "invalid") {
      return err(
        c,
        401,
        "UNAUTHORIZED",
        "send the team key or an agent key (X-Team-Key or Authorization: Bearer)",
      );
    }
    const want = c.req.param("team") ?? "";
    if (want !== cred.team.id && want !== cred.team.slug) {
      return err(c, 404, "NOT_FOUND", "this key does not belong to that team");
    }
    if (!can(cred, scope)) return scopeError(c, scope);
    return cred;
  };
  /** 0.16.0: may this caller see var values in lists (?includeValues=1 + workers:deploy)? */
  const valuesPolicy = (c: Context, cred: TeamCred | null): VarValuesPolicy => ({
    includeValues:
      /^(1|true|yes)$/i.test(c.req.query("includeValues") ?? "") &&
      (cred === null || can(cred, "workers:deploy")),
    now: d.now(),
    sunset: d.config.workers.varValuesSunset,
  });
  const withDeprecation = (c: Context, p: VarValuesPolicy) => {
    for (const [k, v] of Object.entries(varValuesHeaders(p, d.config.publicUrl))) c.header(k, v);
  };
  const MAX_BODY = 12 * 1024 * 1024;
  const limit = bodyLimit({
    maxSize: MAX_BODY,
    onError: (c) => err(c, 413, "SCRIPT_TOO_LARGE", "request body too large"),
  });
  const deployRate = (c: Context, team: Team) => {
    const r = limiter.hit(`workers:${team.id}`, 60, 3_600_000);
    if (r.allowed) return null;
    c.header("Retry-After", String(r.retryAfterSec));
    return err(c, 429, "RATE_LIMITED", "deploy limit reached for this hour");
  };
  const readDeploy = async (c: Context, name?: string) => {
    const type = (c.req.header("content-type") ?? "").toLowerCase();
    if (/^(application|text)\/javascript/.test(type)) {
      return { name, code: await c.req.text() };
    }
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      throw new WorkerError(
        400,
        "INVALID_REQUEST",
        'send JSON {"name","code","vars"?,"secrets"?} or the script as application/javascript',
      );
    }
    return {
      name: name ?? body.name,
      code: body.code,
      ...("vars" in body ? { vars: body.vars } : {}),
      ...("secrets" in body ? { secrets: body.secrets } : {}),
      ...("note" in body ? { note: body.note } : {}),
      ...("compatibilityDate" in body ? { compatibilityDate: body.compatibilityDate } : {}),
      ...("compatibilityFlags" in body ? { compatibilityFlags: body.compatibilityFlags } : {}),
      ...("bindings" in body ? { bindings: body.bindings } : {}),
      ...("meta" in body ? { meta: body.meta } : {}),
      ...("repo" in body ? { repo: body.repo } : {}),
      ...("requiredEnv" in body ? { requiredEnv: body.requiredEnv } : {}),
      ...("crons" in body ? { crons: body.crons } : {}),
      ...("storage" in body ? { storage: body.storage } : {}),
    };
  };

  // ---- 0.17.0: every deploy is a job; answer when done, or 202 + job after the wait --------
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const runDeploy = async (
    c: Context,
    cr: TeamCred,
    worker: string,
    kind: JobKind,
    okStatus: number,
    run: (hooks: DeployHooks) => Promise<{ worker: WorkerView; extra?: Record<string, unknown> }>,
  ) => {
    const asyncWanted =
      /^(1|true|yes)$/i.test(c.req.query("async") ?? "") ||
      /\brespond-async\b/i.test(c.req.header("prefer") ?? "");
    let waitMs = asyncWanted ? 0 : d.config.workers.deployWaitSec * 1000;
    const w = c.req.query("wait");
    if (w !== undefined && /^\d{1,3}$/.test(w)) waitMs = Math.min(90, Number(w)) * 1000;
    const probeHealth = c.req.query("health") !== "0";
    const job = await d.jobs.create(cr.team.id, worker, kind, cr.actor.label);
    let accepted = false;
    let onAccepted: () => void = () => {};
    const acc = new Promise<void>((r) => {
      onAccepted = r;
    });
    const p = run({
      accepted: () => {
        accepted = true;
        onAccepted();
      },
      started: () => void d.jobs.started(job.id),
    });
    const finished = p.then(
      async (out) => {
        const health = probeHealth
          ? await svc.healthAfterDeploy(out.worker).catch(() => null)
          : null;
        await d.jobs.succeeded(job.id, {
          version: out.worker.version,
          health,
          ...(out.extra ? { extra: out.extra } : {}),
        });
        return { out, health };
      },
      async (e) => {
        const er =
          e instanceof WorkerError
            ? { status: e.status, code: e.code, message: e.message }
            : { status: 500, code: "INTERNAL", message: "deploy failed" };
        if (accepted) await d.jobs.failed(job.id, er);
        else await d.jobs.drop(job.id);
        throw e;
      },
    );
    finished.catch(() => {});
    // Validation errors (400s) are answered right away, before any 202.
    try {
      await Promise.race([acc, p]);
    } catch (e) {
      await finished.catch(() => {});
      return workerErr(c, e);
    }
    const ref = c.req.param("team") ?? cr.team.id;
    const r = await Promise.race([
      finished.then(
        (x) => ({ done: true as const, x }),
        (e: unknown) => ({ done: true as const, e }),
      ),
      sleep(waitMs).then(() => ({ done: false as const })),
    ]);
    c.header("X-Marsa-Job", job.id);
    if (r.done && "x" in r) {
      const j = await d.jobs.get(cr.team.id, job.id);
      return c.json(
        {
          worker: r.x.out.worker,
          ...(r.x.out.extra ?? {}),
          health: r.x.health,
          job: j ? jobView(j, d.config.publicUrl, ref) : null,
        },
        okStatus as 200,
      );
    }
    if (r.done && "e" in r) return workerErr(c, r.e);
    const j = await d.jobs.get(cr.team.id, job.id);
    const view = jobView(j ?? job, d.config.publicUrl, ref);
    c.header("Location", view.statusUrl);
    c.header("Retry-After", "5");
    return c.json(
      {
        job: view,
        message: `the deploy continues in the background; poll ${view.statusUrl}`,
      },
      202,
    );
  };

  app.get("/api/teams/:team/workers", async (c) => {
    const cr = await teamOf(c, "workers:read");
    if (cr instanceof Response) return cr;
    const p = valuesPolicy(c, cr);
    withDeprecation(c, p);
    return c.json(teamWorkersList(svc, cr.team, p, d.config.publicUrl));
  });
  app.post("/api/teams/:team/workers", limit, async (c) => {
    const cr = await teamOf(c, "workers:deploy");
    if (cr instanceof Response) return cr;
    const team = cr.team;
    const limited = deployRate(c, team);
    if (limited) return limited;
    try {
      const input = await readDeploy(c);
      if (typeof input.name === "string" && svc.find(team.id, input.name.trim())) {
        return err(
          c,
          409,
          "EXISTS",
          "a Worker with this name exists; PUT /api/teams/<team>/workers/<name> to redeploy",
        );
      }
      const wname = typeof input.name === "string" ? input.name.trim() : "";
      return await runDeploy(c, cr, wname, "deploy", 201, async (hooks) => ({
        worker: await svc.deploy(team, input, cr.actor, { hooks }),
      }));
    } catch (e) {
      return workerErr(c, e);
    }
  });
  app.put("/api/teams/:team/workers/:name", limit, async (c) => {
    const cr = await teamOf(c, "workers:deploy");
    if (cr instanceof Response) return cr;
    const limited = deployRate(c, cr.team);
    if (limited) return limited;
    try {
      const existed = !!svc.find(cr.team.id, c.req.param("name"));
      const input = await readDeploy(c, c.req.param("name"));
      const note = c.req.header("x-marsa-note");
      const finalInput = note && input.note === undefined ? { ...input, note } : input;
      return await runDeploy(
        c,
        cr,
        c.req.param("name"),
        existed ? "redeploy" : "deploy",
        existed ? 200 : 201,
        async (hooks) => ({ worker: await svc.deploy(cr.team, finalInput, cr.actor, { hooks }) }),
      );
    } catch (e) {
      return workerErr(c, e);
    }
  });
  app.get("/api/teams/:team/workers/:name", async (c) => {
    const cr = await teamOf(c, "workers:read");
    if (cr instanceof Response) return cr;
    const rec = svc.find(cr.team.id, c.req.param("name"));
    if (!rec) return err(c, 404, "NOT_FOUND", "no such Worker");
    const live = c.req.query("probe") === "0" ? null : await svc.probe(rec);
    const p = valuesPolicy(c, cr);
    withDeprecation(c, p);
    const notice = varValuesNotice(p, d.config.publicUrl);
    return c.json({
      worker: listedWorker(rec, p),
      ...(live ? { live } : {}),
      ...(notice ? { deprecations: [notice] } : {}),
    });
  });
  app.delete("/api/teams/:team/workers/:name", async (c) => {
    const cr = await teamOf(c, "workers:deploy");
    if (cr instanceof Response) return cr;
    const rec = svc.find(cr.team.id, c.req.param("name"));
    if (!rec) return err(c, 404, "NOT_FOUND", "no such Worker");
    try {
      await svc.remove(rec, cr.actor);
      return c.body(null, 204);
    } catch (e) {
      return workerErr(c, e);
    }
  });

  // ---- versions, one-click redeploy, rollback (0.14.0) ----------------------------------
  const recOf = async (c: Context, scope: Scope) => {
    const cr = await teamOf(c, scope);
    if (cr instanceof Response) return cr;
    const rec = svc.find(cr.team.id, c.req.param("name") ?? "");
    if (!rec) return err(c, 404, "NOT_FOUND", "no such Worker");
    return { cr, rec };
  };
  app.get("/api/teams/:team/workers/:name/versions", async (c) => {
    const r = await recOf(c, "workers:read");
    if (r instanceof Response) return r;
    const versions = (await svc.listVersions(r.rec)).map(versionMeta);
    return c.json({
      worker: r.rec.name,
      current: r.rec.version ?? null,
      versions,
      ...(versions.length ? {} : { note: "no stored version — the next deploy will be saved" }),
    });
  });
  app.get("/api/teams/:team/workers/:name/versions/:n", async (c) => {
    const r = await recOf(c, "workers:read");
    if (r instanceof Response) return r;
    const v = await svc.getVersion(r.rec, Number(c.req.param("n")));
    if (!v) return err(c, 404, "VERSION_NOT_FOUND", "no such stored version");
    return c.json({ version: { ...versionMeta(v), vars: v.vars } });
  });
  app.get("/api/teams/:team/workers/:name/versions/:n/code", async (c) => {
    const r = await recOf(c, "workers:read");
    if (r instanceof Response) return r;
    const v = await svc.getVersion(r.rec, Number(c.req.param("n")));
    if (!v) return err(c, 404, "VERSION_NOT_FOUND", "no such stored version");
    return codeDownload(c, r.rec.name, v.n, v.code);
  });
  // 0.15.0: compatibility date/flags and service bindings without sending code again.
  app.post("/api/teams/:team/workers/:name/runtime", async (c) => {
    const r = await recOf(c, "workers:deploy");
    if (r instanceof Response) return r;
    const limited = deployRate(c, r.cr.team);
    if (limited) return limited;
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return err(
        c,
        400,
        "INVALID_REQUEST",
        'send JSON {"compatibilityDate"?, "compatibilityFlags"?, "bindings"?, "crons"?, "storage"?}',
      );
    }
    const change: Record<string, unknown> = {};
    for (const k of ["compatibilityDate", "compatibilityFlags", "bindings", "crons", "storage"])
      if (k in body) change[k] = body[k];
    try {
      return await runDeploy(c, r.cr, r.rec.name, "runtime", 200, async (hooks) => ({
        worker: await svc.editRuntime(r.cr.team, r.rec, change, r.cr.actor, hooks),
      }));
    } catch (e) {
      return workerErr(c, e);
    }
  });
  // 0.17.0: read the runtime settings of one Worker (the counterpart of the POST above).
  app.get("/api/teams/:team/workers/:name/runtime", async (c) => {
    const r = await recOf(c, "workers:read");
    if (r instanceof Response) return r;
    return c.json({
      runtime: svc.runtimeView(r.rec),
      allowedCompatibilityFlags: [...ALLOWED_COMPAT_FLAGS],
    });
  });
  // 0.17.0: deploy jobs.
  app.get("/api/teams/:team/jobs", async (c) => {
    const cr = await teamOf(c, "workers:read");
    if (cr instanceof Response) return cr;
    const ref = c.req.param("team") ?? cr.team.id;
    const list = await d.jobs.list(cr.team.id, c.req.query("worker") || undefined, 50);
    return c.json({ jobs: list.map((j) => jobView(j, d.config.publicUrl, ref)) });
  });
  app.get("/api/teams/:team/jobs/:id", async (c) => {
    const cr = await teamOf(c, "workers:read");
    if (cr instanceof Response) return cr;
    const j = await d.jobs.get(cr.team.id, c.req.param("id") ?? "");
    if (!j) return err(c, 404, "NOT_FOUND", "no such job for this team");
    if (!j.status.match(/succeeded|failed|interrupted/)) c.header("Retry-After", "5");
    return c.json({ job: jobView(j, d.config.publicUrl, c.req.param("team") ?? cr.team.id) });
  });
  // 0.15.1: metadata only (no redeploy): declared meta, repo link, linked space.
  app.post("/api/teams/:team/workers/:name/links", async (c) => {
    const r = await recOf(c, "workers:deploy");
    if (r instanceof Response) return r;
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body))
      return err(c, 400, "INVALID_REQUEST", 'send JSON {"meta"?, "repo"?, "spaceId"?}');
    let spaceId: string | null | undefined;
    if ("spaceId" in body) {
      if (body.spaceId === null || body.spaceId === "") spaceId = null;
      else if (
        typeof body.spaceId === "string" &&
        (await d.siteOfTeam?.(r.cr.team.id, body.spaceId))
      )
        spaceId = body.spaceId;
      else return err(c, 400, "INVALID_REQUEST", "spaceId: one of this team's spaces");
    }
    try {
      return c.json({
        worker: await svc.setLinks(
          r.rec,
          {
            ...("meta" in body ? { meta: body.meta } : {}),
            ...("repo" in body ? { repo: body.repo } : {}),
            ...("requiredEnv" in body ? { requiredEnv: body.requiredEnv } : {}),
            ...(spaceId !== undefined ? { spaceId } : {}),
          },
          r.cr.actor,
        ),
      });
    } catch (e) {
      return workerErr(c, e);
    }
  });
  app.post("/api/teams/:team/workers/:name/redeploy", async (c) => {
    const r = await recOf(c, "workers:deploy");
    if (r instanceof Response) return r;
    const limited = deployRate(c, r.cr.team);
    if (limited) return limited;
    const body = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    try {
      return await runDeploy(c, r.cr, r.rec.name, "redeploy", 200, async (hooks) => ({
        worker: await svc.redeploy(r.cr.team, r.rec, r.cr.actor, body.note, hooks),
      }));
    } catch (e) {
      return workerErr(c, e);
    }
  });
  app.post("/api/teams/:team/workers/:name/rollback", async (c) => {
    const r = await recOf(c, "workers:deploy");
    if (r instanceof Response) return r;
    const limited = deployRate(c, r.cr.team);
    if (limited) return limited;
    const body = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    if (!Number.isInteger(body.version)) {
      return err(c, 400, "INVALID_REQUEST", 'send JSON {"version": <n>, "note"?: "…"}');
    }
    try {
      return await runDeploy(c, r.cr, r.rec.name, "rollback", 200, async (hooks) => {
        const out = await svc.rollback(
          r.cr.team,
          r.rec,
          body.version as number,
          r.cr.actor,
          body.note,
          hooks,
        );
        return { worker: out.worker, extra: { missingSecrets: out.missingSecrets } };
      });
    } catch (e) {
      return workerErr(c, e);
    }
  });

  // ---- admin API (the /api/admin/* guard runs first) ---------------------------------------
  const readBody = async (c: Context) =>
    ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const adminRec = (c: Context): WorkerRec | Response =>
    svc.get(c.req.param("id") ?? "") ?? err(c, 404, "NOT_FOUND", "worker not found");

  app.get("/api/admin/workers/settings", (c) => c.json({ settings: svc.settingsView() }));
  app.put("/api/admin/workers/settings", async (c) => {
    try {
      return c.json({ settings: await svc.saveSettings(await readBody(c), ADMIN_ACTOR) });
    } catch (e) {
      return workerErr(c, e);
    }
  });
  app.post("/api/admin/workers/settings/verify", async (c) => {
    try {
      return c.json({ settings: await svc.verifySettings() });
    } catch (e) {
      return workerErr(c, e);
    }
  });
  app.delete("/api/admin/workers/settings", async (c) => {
    try {
      await svc.clearSettings(ADMIN_ACTOR);
      return c.body(null, 204);
    } catch (e) {
      return workerErr(c, e);
    }
  });
  // 0.17.0: the Browser Integrity Check exception for team Worker hosts (one config rule).
  app.get("/api/admin/workers/bic", (c) => c.json({ bic: svc.bicView() }));
  app.put("/api/admin/workers/bic", async (c) => {
    const body = await readBody(c);
    if (typeof body.enabled !== "boolean")
      return err(c, 400, "INVALID_REQUEST", 'send JSON {"enabled": true|false}');
    try {
      return c.json({ bic: await svc.setBic(body.enabled, ADMIN_ACTOR) });
    } catch (e) {
      return workerErr(c, e);
    }
  });
  app.get("/api/admin/workers", (c) => {
    const p = valuesPolicy(c, null);
    withDeprecation(c, p);
    const notice = varValuesNotice(p, d.config.publicUrl);
    return c.json({
      settings: svc.settingsView(),
      workers: svc.list().map((r) => ({
        ...listedWorker(r, p),
        team: { id: r.teamId, name: teams.get(r.teamId)?.name ?? null },
      })),
      ...(notice ? { deprecations: [notice] } : {}),
    });
  });
  for (const [path, off] of [
    ["disable", true],
    ["enable", false],
  ] as const) {
    app.post(`/api/admin/workers/:id/${path}`, async (c) => {
      const rec = adminRec(c);
      if (rec instanceof Response) return rec;
      try {
        return c.json({ worker: await svc.setDisabled(rec, off, ADMIN_ACTOR) });
      } catch (e) {
        return workerErr(c, e);
      }
    });
  }
  app.delete("/api/admin/workers/:id", async (c) => {
    const rec = adminRec(c);
    if (rec instanceof Response) return rec;
    try {
      await svc.remove(rec, ADMIN_ACTOR);
      return c.body(null, 204);
    } catch (e) {
      return workerErr(c, e);
    }
  });
  app.put("/api/admin/teams/:id/workers", async (c) => {
    const team = teams.get(c.req.param("id"));
    if (!team) return err(c, 404, "NOT_FOUND", "team not found");
    const patch = readTeamWorkers(svc, team, await readBody(c));
    if (typeof patch === "string") return err(c, 400, "INVALID_REQUEST", patch);
    try {
      const r = await applyTeamWorkers(d, team, patch, d.now(), ADMIN_ACTOR, audit);
      return c.json({ ...teamWorkersInfo(svc, r.team), removed: r.removed });
    } catch (e) {
      return workerErr(c, e);
    }
  });
}

/** A stored version's code as a download. */
export function codeDownload(c: Context, name: string, n: number, code: string) {
  c.header("Content-Type", "text/javascript; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="${name}-v${n}.js"`);
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  return c.body(code);
}
