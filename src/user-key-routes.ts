import type { Context, Hono } from "hono";
import type { Scope } from "./agent-keys.js";
import type { Config } from "./config.js";
import type { Actor, MemberStore } from "./members.js";
import type { NotificationCenter } from "./notify.js";
import type { RateLimiter } from "./rate-limit.js";
import { can, scopeError, type TeamAuth, type TeamCred } from "./team-auth.js";
import type { Team, TeamStore } from "./teams.js";
import { bearer } from "./tokens.js";
import { keysHelperSource, UserKeyError, type UserKeyStore } from "./user-keys.js";
import { WorkerError, type WorkerRec, type WorkerService } from "./workers.js";

/**
 * End-user API keys for team Workers (0.14.0): shared operations (HTTP API, dashboard,
 * space MCP) and the routes, including the verify endpoint the Worker calls.
 */
export interface UserKeyDeps {
  config: Config;
  teams: TeamStore;
  members: MemberStore;
  workers: WorkerService;
  userKeys: UserKeyStore;
  notify: NotificationCenter;
  limiter: RateLimiter;
  teamAuth: TeamAuth;
}

export const verifyUrl = (config: Config) => `${config.publicUrl}/api/keys/verify`;

export function userKeyOps(d: Omit<UserKeyDeps, "limiter" | "teamAuth">) {
  const audit = (teamId: string, actor: Actor, action: string, detail?: string) =>
    d.members.log({ teamId, actor, action, ...(detail ? { detail } : {}) });
  d.userKeys.onSpike = (e) => {
    const rec = d.workers.get(e.workerId);
    void d.notify
      .add({
        teamId: e.teamId,
        kind: "user-key-spike",
        detail: `${rec?.name ?? e.workerId}: ${e.count}+ requests refused (429) today`,
      })
      .catch(() => {});
  };
  return {
    async view(rec: WorkerRec) {
      await d.userKeys.ready();
      return {
        worker: rec.name,
        settings: d.userKeys.settingsView(rec.id),
        verifyUrl: verifyUrl(d.config),
        helperUrl: `${d.config.publicUrl}/api/keys/helper.js`,
        keys: d.userKeys.list(rec.id).map((k) => d.userKeys.view(k)),
      };
    },
    async configure(team: Team, rec: WorkerRec, input: Record<string, unknown>, actor: Actor) {
      await d.userKeys.ready();
      const { settings, verifier } = await d.userKeys.configure(team.id, rec.id, input);
      if (verifier) {
        try {
          await d.workers.putSystemSecrets(rec, {
            MARSA_KEYS_URL: verifyUrl(d.config),
            MARSA_KEYS_SECRET: verifier,
          });
        } catch (e) {
          await d.userKeys.dropVerifier(rec.id);
          throw e;
        }
      }
      await audit(
        team.id,
        actor,
        "user-keys-settings",
        `${rec.name}: ${settings.required ? "required" : "off"}, ${settings.perMinute}/min, ${settings.perDay}/day`,
      );
      return d.userKeys.settingsView(rec.id);
    },
    async create(team: Team, rec: WorkerRec, input: Record<string, unknown>, actor: Actor) {
      await d.userKeys.ready();
      const { key, secret } = await d.userKeys.create(team.id, rec.id, input, actor.label);
      await audit(team.id, actor, "user-key-create", `${rec.name}: ${key.label} (${key.prefix}…)`);
      return { key: d.userKeys.view(key), secret };
    },
    async revoke(team: Team, rec: WorkerRec, id: string, actor: Actor) {
      await d.userKeys.ready();
      const k = await d.userKeys.revoke(rec.id, id, actor.label);
      if (!k) return null;
      await audit(team.id, actor, "user-key-revoke", `${rec.name}: ${k.label} (${k.prefix}…)`);
      return d.userKeys.view(k);
    },
  };
}
export type UserKeyOps = ReturnType<typeof userKeyOps>;

const err = (c: Context, status: number, code: string, message: string) =>
  c.json({ error: { code, message } }, status as 400);

export function userKeyErr(c: Context, e: unknown) {
  if (e instanceof UserKeyError || e instanceof WorkerError)
    return err(c, e.status, e.code, e.message);
  throw e;
}

export function mountUserKeyRoutes(app: Hono, d: UserKeyDeps, ops: UserKeyOps): void {
  const { config, workers, userKeys, limiter } = d;

  const workerOf = async (
    c: Context,
    scope: Scope,
  ): Promise<{ cred: TeamCred; rec: WorkerRec } | Response> => {
    const cred = await d.teamAuth(c);
    if (!cred || cred === "invalid")
      return err(c, 401, "UNAUTHORIZED", "send the team key or an agent key");
    const want = c.req.param("team") ?? "";
    if (want !== cred.team.id && want !== cred.team.slug)
      return err(c, 404, "NOT_FOUND", "this key does not belong to that team");
    if (!can(cred, scope)) return scopeError(c, scope);
    const rec = workers.find(cred.team.id, c.req.param("name") ?? "");
    if (!rec) return err(c, 404, "NOT_FOUND", "no such Worker");
    return { cred, rec };
  };
  const body = async (c: Context) =>
    ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;

  app.get("/api/teams/:team/workers/:name/keys", async (c) => {
    const w = await workerOf(c, "workers:read");
    if (w instanceof Response) return w;
    return c.json(await ops.view(w.rec));
  });
  app.put("/api/teams/:team/workers/:name/keys/settings", async (c) => {
    const w = await workerOf(c, "workers:deploy");
    if (w instanceof Response) return w;
    try {
      return c.json({
        settings: await ops.configure(w.cred.team, w.rec, await body(c), w.cred.actor),
      });
    } catch (e) {
      return userKeyErr(c, e);
    }
  });
  app.post("/api/teams/:team/workers/:name/keys", async (c) => {
    const w = await workerOf(c, "workers:deploy");
    if (w instanceof Response) return w;
    try {
      return c.json(await ops.create(w.cred.team, w.rec, await body(c), w.cred.actor), 201);
    } catch (e) {
      return userKeyErr(c, e);
    }
  });
  app.delete("/api/teams/:team/workers/:name/keys/:id", async (c) => {
    const w = await workerOf(c, "workers:deploy");
    if (w instanceof Response) return w;
    const v = await ops.revoke(w.cred.team, w.rec, c.req.param("id"), w.cred.actor);
    if (!v) return err(c, 404, "NOT_FOUND", "no such key");
    return c.json({ key: v });
  });

  // ---- called by the Worker --------------------------------------------------------------
  app.post("/api/keys/verify", async (c) => {
    c.header("Cache-Control", "no-store");
    await userKeys.ready();
    const s = userKeys.workerByVerifier(bearer(c.req.header("authorization")) ?? "");
    if (!s) return err(c, 401, "UNAUTHORIZED", "send the Worker's MARSA_KEYS_SECRET as Bearer");
    const guard = limiter.hit(`ukv:${s.workerId}`, 20_000, 60_000);
    if (!guard.allowed) {
      c.header("Retry-After", String(guard.retryAfterSec));
      return err(c, 429, "RATE_LIMITED", "too many key checks for this Worker");
    }
    const b = await body(c);
    if (!s.required) {
      // Keys turned off: the Worker should let everyone in.
      return c.json({ allow: true, status: 200, code: "OK", required: false, cacheSeconds: 60 });
    }
    const r = userKeys.verify(s, b.key, b.tool, b.uses);
    // The answer is 200 with allow/deny in the body, so a Worker can relay r.status.
    if (r.retryAfter) c.header("Retry-After", String(r.retryAfter));
    return c.json({ ...r, required: true });
  });
  app.get("/api/keys/helper.js", (c) => {
    c.header("Content-Type", "text/javascript; charset=utf-8");
    c.header("Cache-Control", "public, max-age=3600");
    return c.body(keysHelperSource(config.publicUrl));
  });
}
