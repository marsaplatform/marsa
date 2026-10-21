/**
 * 0.15.2 API: vars & secrets (names only, write-only values), health, logs, usage, and the
 * admin token-permission checklists. Team routes take the team key or an agent key with
 * the right scope; admin routes sit behind the /api/admin guard.
 */
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Scope } from "./agent-keys.js";
import type { Actor } from "./members.js";
import type { RateLimiter } from "./rate-limit.js";
import { can, scopeError, type TeamAuth, type TeamCred } from "./team-auth.js";
import type { Team, TeamStore } from "./teams.js";
import { USAGE_RANGES, type UsageRange } from "./worker-analytics.js";
import type { WorkerOps } from "./worker-ops.js";
import { WorkerError, type WorkerRec, type WorkerService } from "./workers.js";

export interface OpsRouteDeps {
  teams: TeamStore;
  workers: WorkerService;
  ops: WorkerOps;
  limiter: RateLimiter;
  teamAuth: TeamAuth;
  /** 0.16.0: platform/team audit log writer (admin actions). */
  audit?: (e: { teamId: string; actor: Actor; action: string; detail?: string }) => Promise<void>;
}

const err = (c: Context, status: number, code: string, message: string) =>
  c.json({ error: { code, message } }, status as 400);
const ADMIN: Actor = { kind: "admin", label: "admin" };

const fail = (c: Context, e: unknown) => {
  if (e instanceof WorkerError) return err(c, e.status, e.code, e.message);
  if (e instanceof RangeError) return err(c, 400, "INVALID_REQUEST", e.message);
  throw e;
};

/** Health + usage + logs in one payload shape (shared by team and admin). */
export async function usagePayload(
  ops: WorkerOps,
  rec: WorkerRec,
  range: UsageRange,
  force = false,
) {
  const days = range === "30d" ? 30 : range === "7d" ? 7 : 1;
  return {
    worker: rec.name,
    range,
    cloudflare: await ops.analytics.usage(rec.script, range, force),
    keys: ops.keyUsage(rec, days),
  };
}

export function mountOpsRoutes(app: Hono, d: OpsRouteDeps): void {
  const { workers: svc, ops, limiter } = d;
  const small = bodyLimit({
    maxSize: 16 * 1024,
    onError: (c) => err(c, 413, "TOO_LARGE", "request body too large"),
  });

  const recOf = async (
    c: Context,
    scopes: Scope[],
  ): Promise<{ cr: TeamCred; rec: WorkerRec } | Response> => {
    const cred = await d.teamAuth(c);
    if (!cred || cred === "invalid")
      return err(
        c,
        401,
        "UNAUTHORIZED",
        "send the team key or an agent key (X-Team-Key or Authorization: Bearer)",
      );
    const want = c.req.param("team") ?? "";
    if (want !== cred.team.id && want !== cred.team.slug)
      return err(c, 404, "NOT_FOUND", "this key does not belong to that team");
    if (!scopes.some((s) => can(cred, s))) return scopeError(c, scopes[0] as Scope);
    const rec = svc.find(cred.team.id, c.req.param("name") ?? "");
    if (!rec) return err(c, 404, "NOT_FOUND", "no such Worker");
    return { cr: cred, rec };
  };
  const teamOfRec = (rec: WorkerRec): Team | null => d.teams.get(rec.teamId);
  const secretRate = (c: Context, teamId: string) => {
    const r = limiter.hit(`secrets:${teamId}`, 60, 3_600_000);
    if (r.allowed) return null;
    c.header("Retry-After", String(r.retryAfterSec));
    return err(c, 429, "RATE_LIMITED", "secret changes are limited to 60 per hour");
  };
  const bodyValue = async (c: Context): Promise<unknown> => {
    const b = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    return b && typeof b === "object" ? b.value : undefined;
  };
  const rangeOf = (c: Context): UsageRange => {
    const r = c.req.query("range") as UsageRange;
    return USAGE_RANGES.includes(r) ? r : "24h";
  };
  const forced = (c: Context) => c.req.query("refresh") === "1";

  // ---- shared handlers (team + admin) ---------------------------------------------------
  const env = async (c: Context, rec: WorkerRec) =>
    c.json({ worker: rec.name, env: await ops.envView(rec, forced(c)) });
  const putSecret = async (c: Context, rec: WorkerRec, actor: Actor) => {
    const limited = secretRate(c, rec.teamId);
    if (limited) return limited;
    try {
      const r = await svc.setSecret(rec, c.req.param("secret"), await bodyValue(c), actor);
      ops.forgetEnv(rec.id);
      // Echo the name only: the value is never returned.
      return c.json({ ok: true, name: r.name, rotated: r.rotated });
    } catch (e) {
      return fail(c, e);
    }
  };
  const delSecret = async (c: Context, rec: WorkerRec, actor: Actor) => {
    const limited = secretRate(c, rec.teamId);
    if (limited) return limited;
    try {
      const r = await svc.deleteSecretNamed(rec, c.req.param("secret"), actor);
      ops.forgetEnv(rec.id);
      return c.json({ ok: true, name: r.name, deleted: true });
    } catch (e) {
      return fail(c, e);
    }
  };
  const health = (c: Context, rec: WorkerRec) =>
    c.json({ worker: rec.name, health: ops.health.view(rec.id) });
  const editHealth = async (c: Context, rec: WorkerRec, actor: Actor) => {
    const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    if ("enabled" in b) {
      if (typeof b.enabled !== "boolean")
        return err(c, 400, "INVALID_REQUEST", "enabled: true or false");
      await ops.health.setEnabled(rec.id, b.enabled);
      await svc.auditOf(rec, actor, b.enabled ? "worker-health-on" : "worker-health-off");
    }
    if (b.check === true) {
      if (rec.status !== "active" || !rec.url)
        return err(c, 409, "NOT_ACTIVE", "the Worker is not active");
      const r = limiter.hit(`health-now:${rec.id}`, 12, 3_600_000);
      if (!r.allowed) return err(c, 429, "RATE_LIMITED", "at most 12 manual checks per hour");
      await ops.code(rec);
      await ops.health.checkOne(rec);
    }
    return c.json({ worker: rec.name, health: ops.health.view(rec.id) });
  };
  const logs = async (c: Context, rec: WorkerRec) =>
    c.json({
      worker: rec.name,
      logsEnabled: !!rec.logs,
      logs: await ops.analytics.logs(rec.script, !!rec.logs, forced(c)),
    });
  const editLogs = async (c: Context, rec: WorkerRec, actor: Actor) => {
    const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    if (typeof b.enabled !== "boolean")
      return err(c, 400, "INVALID_REQUEST", 'send {"enabled": true|false}');
    try {
      const w = await svc.setLogs(rec, b.enabled, actor);
      return c.json({ worker: rec.name, logsEnabled: w.logs });
    } catch (e) {
      return fail(c, e);
    }
  };
  const usage = async (c: Context, rec: WorkerRec) =>
    c.json(await usagePayload(ops, rec, rangeOf(c), forced(c)));

  // ---- team API --------------------------------------------------------------------------
  const T = "/api/teams/:team/workers/:name";
  app.get(`${T}/env`, async (c) => {
    const r = await recOf(c, ["workers:read"]);
    return r instanceof Response ? r : env(c, r.rec);
  });
  app.put(`${T}/secrets/:secret`, small, async (c) => {
    const r = await recOf(c, ["workers:secrets", "workers:deploy"]);
    return r instanceof Response ? r : putSecret(c, r.rec, r.cr.actor);
  });
  app.delete(`${T}/secrets/:secret`, async (c) => {
    const r = await recOf(c, ["workers:secrets", "workers:deploy"]);
    return r instanceof Response ? r : delSecret(c, r.rec, r.cr.actor);
  });
  for (const method of ["put", "delete"] as const) {
    app[method](`${T}/vars/:var`, small, async (c) => {
      const r = await recOf(c, ["workers:deploy"]);
      if (r instanceof Response) return r;
      const team = teamOfRec(r.rec);
      if (!team) return err(c, 404, "NOT_FOUND", "no such team");
      const lim = limiter.hit(`workers:${team.id}`, 60, 3_600_000);
      if (!lim.allowed) return err(c, 429, "RATE_LIMITED", "deploy limit reached for this hour");
      try {
        let value: string | null = null;
        if (method === "put") {
          const v = await bodyValue(c);
          if (typeof v !== "string") return err(c, 400, "INVALID_REQUEST", 'send {"value": "..."}');
          value = v;
        }
        const w = await svc.setVar(team, r.rec, c.req.param("var"), value, r.cr.actor);
        ops.forgetEnv(r.rec.id);
        return c.json({ ok: true, name: c.req.param("var"), version: w.version });
      } catch (e) {
        return fail(c, e);
      }
    });
  }
  app.get(`${T}/health`, async (c) => {
    const r = await recOf(c, ["workers:read"]);
    return r instanceof Response ? r : health(c, r.rec);
  });
  app.post(`${T}/health`, small, async (c) => {
    const r = await recOf(c, ["workers:deploy"]);
    return r instanceof Response ? r : editHealth(c, r.rec, r.cr.actor);
  });
  app.get(`${T}/logs`, async (c) => {
    const r = await recOf(c, ["workers:read"]);
    return r instanceof Response ? r : logs(c, r.rec);
  });
  app.post(`${T}/logs`, small, async (c) => {
    const r = await recOf(c, ["workers:deploy"]);
    return r instanceof Response ? r : editLogs(c, r.rec, r.cr.actor);
  });
  app.get(`${T}/usage`, async (c) => {
    const r = await recOf(c, ["workers:read"]);
    return r instanceof Response ? r : usage(c, r.rec);
  });

  // ---- admin API ---------------------------------------------------------------------------
  const adminRec = (c: Context) => svc.get(c.req.param("id") ?? "");
  const A = "/api/admin/workers/:id";
  const withAdmin =
    (fn: (c: Context, rec: WorkerRec) => Promise<Response> | Response) => async (c: Context) => {
      const rec = adminRec(c);
      if (!rec) return err(c, 404, "NOT_FOUND", "no such Worker");
      return fn(c, rec);
    };
  app.get("/api/admin/workers/permissions", async (c) => {
    try {
      return c.json({ permissions: await ops.workersPermissions(forced(c)) });
    } catch (e) {
      return fail(c, e);
    }
  });
  app.get("/api/admin/backend/permissions", async (c) =>
    c.json({ permissions: await ops.backendPermissions(forced(c)) }),
  );
  app.get("/api/admin/workers/health-settings", (c) =>
    c.json({ intervalSec: ops.health.interval }),
  );
  app.put("/api/admin/workers/health-settings", small, async (c) => {
    const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    try {
      const intervalSec = await ops.health.setInterval(b.intervalSec);
      await d.audit?.({
        teamId: "_platform",
        actor: { kind: "admin", label: "admin" },
        action: "health-interval",
        detail: `${intervalSec}s`,
      });
      return c.json({ intervalSec });
    } catch (e) {
      return fail(c, e);
    }
  });
  app.get(`${A}/env`, withAdmin(env));
  app.put(
    `${A}/secrets/:secret`,
    small,
    withAdmin((c, rec) => putSecret(c, rec, ADMIN)),
  );
  app.delete(
    `${A}/secrets/:secret`,
    withAdmin((c, rec) => delSecret(c, rec, ADMIN)),
  );
  app.get(`${A}/health`, withAdmin(health));
  app.post(
    `${A}/health`,
    small,
    withAdmin((c, rec) => editHealth(c, rec, ADMIN)),
  );
  app.get(`${A}/logs`, withAdmin(logs));
  app.post(
    `${A}/logs`,
    small,
    withAdmin((c, rec) => editLogs(c, rec, ADMIN)),
  );
  app.get(`${A}/usage`, withAdmin(usage));
}
