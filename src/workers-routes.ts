import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Config } from "./config.js";
import type { Actor, MemberStore } from "./members.js";
import type { RateLimiter } from "./rate-limit.js";
import { isTeamKey, type Team, type TeamStore } from "./teams.js";
import { bearer } from "./tokens.js";
import {
  PLATFORM_AUDIT,
  WorkerError,
  type WorkerRec,
  type WorkerService,
  workerView,
} from "./workers.js";

export interface WorkerRouteDeps {
  config: Config;
  teams: TeamStore;
  members: MemberStore;
  workers: WorkerService;
  limiter: RateLimiter;
  now: () => number;
}

const err = (c: Context, status: number, code: string, message: string) =>
  c.json({ error: { code, message } }, status as 400);

export const ADMIN_ACTOR: Actor = { kind: "admin", label: "admin" };
const KEY_ACTOR: Actor = { kind: "api", label: "team key" };

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
    quota: svc.quotaOf(team),
    workers: svc.list(team.id).map(workerView),
  };
}

/** Parse the admin's per-team Workers form/JSON into a patch, or an error message. */
export function readTeamWorkers(
  svc: WorkerService,
  team: Team,
  body: Record<string, unknown>,
):
  | { enabled?: boolean; slug?: string; maxWorkers?: number | null; maxWorkerKb?: number | null }
  | string {
  const out: {
    enabled?: boolean;
    slug?: string;
    maxWorkers?: number | null;
    maxWorkerKb?: number | null;
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
  for (const k of ["maxWorkers", "maxWorkerKb"] as const) {
    if (!(k in body)) continue;
    const v = body[k];
    if (v === null || v === 0 || v === "") out[k] = null;
    else if (
      typeof v === "number" &&
      Number.isInteger(v) &&
      v > 0 &&
      v <= (k === "maxWorkers" ? 100 : 10_240)
    )
      out[k] = v;
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
  const teamOf = (c: Context): Team | Response => {
    const header = c.req.header("x-team-key")?.trim();
    const auth = bearer(c.req.header("authorization"));
    const key = header || (auth && isTeamKey(auth) ? auth : "");
    const team = key ? teams.byTeamKey(key) : null;
    if (!team) {
      return err(c, 401, "UNAUTHORIZED", "send the team key (X-Team-Key or Authorization: Bearer)");
    }
    const want = c.req.param("team") ?? "";
    if (want !== team.id && want !== team.slug) {
      return err(c, 404, "NOT_FOUND", "this key does not belong to that team");
    }
    return team;
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
    };
  };

  app.get("/api/teams/:team/workers", (c) => {
    const team = teamOf(c);
    if (team instanceof Response) return team;
    return c.json(teamWorkersInfo(svc, team));
  });
  app.post("/api/teams/:team/workers", limit, async (c) => {
    const team = teamOf(c);
    if (team instanceof Response) return team;
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
      return c.json({ worker: await svc.deploy(team, input, KEY_ACTOR) }, 201);
    } catch (e) {
      return workerErr(c, e);
    }
  });
  app.put("/api/teams/:team/workers/:name", limit, async (c) => {
    const team = teamOf(c);
    if (team instanceof Response) return team;
    const limited = deployRate(c, team);
    if (limited) return limited;
    try {
      const existed = !!svc.find(team.id, c.req.param("name"));
      const w = await svc.deploy(team, await readDeploy(c, c.req.param("name")), KEY_ACTOR);
      return c.json({ worker: w }, existed ? 200 : 201);
    } catch (e) {
      return workerErr(c, e);
    }
  });
  app.get("/api/teams/:team/workers/:name", async (c) => {
    const team = teamOf(c);
    if (team instanceof Response) return team;
    const rec = svc.find(team.id, c.req.param("name"));
    if (!rec) return err(c, 404, "NOT_FOUND", "no such Worker");
    const live = c.req.query("probe") === "0" ? null : await svc.probe(rec);
    return c.json({ worker: workerView(rec), ...(live ? { live } : {}) });
  });
  app.delete("/api/teams/:team/workers/:name", async (c) => {
    const team = teamOf(c);
    if (team instanceof Response) return team;
    const rec = svc.find(team.id, c.req.param("name"));
    if (!rec) return err(c, 404, "NOT_FOUND", "no such Worker");
    try {
      await svc.remove(rec, KEY_ACTOR);
      return c.body(null, 204);
    } catch (e) {
      return workerErr(c, e);
    }
  });

  // ---- admin API (the /api/admin/* guard runs first) ---------------------------------------
  const readBody = async (c: Context) =>
    ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const adminRec = (c: Context): WorkerRec | Response =>
    svc.get(c.req.param("id") ?? "") ?? err(c, 404, "NOT_FOUND", "worker not found");
  const adminView = (r: WorkerRec) => ({
    ...workerView(r),
    team: { id: r.teamId, name: teams.get(r.teamId)?.name ?? null },
  });

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
  app.get("/api/admin/workers", (c) =>
    c.json({ settings: svc.settingsView(), workers: svc.list().map(adminView) }),
  );
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
