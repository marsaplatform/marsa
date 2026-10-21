import type { Context, Hono } from "hono";
import {
  AGENT_INVITE_TTL_HOURS,
  type AgentInvite,
  AgentKeyError,
  type AgentKeyStore,
  SCOPES,
} from "./agent-keys.js";
import { clientIp } from "./client-ip.js";
import type { Config } from "./config.js";
import type { Actor, MemberStore } from "./members.js";
import { type NotificationCenter, noticeText, PLATFORM, WebhookError } from "./notify.js";
import type { RateLimiter } from "./rate-limit.js";
import type { TeamAuth, TeamCred } from "./team-auth.js";
import type { Team, TeamStore } from "./teams.js";

export interface AgentRouteDeps {
  config: Config;
  teams: TeamStore;
  members: MemberStore;
  agentKeys: AgentKeyStore;
  notify: NotificationCenter;
  limiter: RateLimiter;
  teamAuth: TeamAuth;
}

const err = (c: Context, status: number, code: string, message: string) =>
  c.json({ error: { code, message } }, status as 400);

export function agentErr(c: Context, e: unknown) {
  if (e instanceof AgentKeyError) return err(c, e.status, e.code, e.message);
  if (e instanceof WebhookError) return err(c, 400, e.code, e.message);
  throw e;
}

/** The ten rules every invited agent sees first (0.15.1). */
export const TOP_RULES = [
  "Never put keys, tokens or passwords in code, vars, repos, notes or logs: secrets go in the deploy `secrets` field.",
  "Start from the MCP-on-Worker starter; keep its structure (src/tools/<tool>.ts, src/lib/http.ts, tests).",
  "Run `npm run check` (typecheck, tests, build, size) before every deploy.",
  "Deploy one Workers ES module with `export default { fetch }`, through the Spaces API, with a `note`, `meta` and `repo`.",
  "Every upstream fetch: a fixed User-Agent, a timeout and retries on 429/5xx.",
  "Tools: verb_noun names, typed and described inputs (zod), Arabic input, pagination with nextCursor, `isError` results instead of throwing.",
  "Stateless MCP: POST /mcp with JSON responses, GET /mcp → 405, /health → 200.",
  "After deploying, verify live: initialize, tools/list and one sample call (npm run smoke).",
  "Call other team Workers with a service binding (or global_fetch_strictly_public), never another team's Workers.",
  "Hit a problem, or a recipe is wrong? Leave a note (POST /api/teams/<team>/notes or the MCP tool leave_note) instead of working around the platform.",
] as const;

/** Onboarding for an agent invite: what an agent needs to start, before it claims a key. */
export function inviteOnboarding(config: Config, team: Team, inv: AgentInvite, token: string) {
  const base = config.publicUrl;
  const ref = team.slug ?? team.id;
  const claim = `${base}/agent-invite/${token}/claim`;
  return {
    product: "Marsa Spaces",
    team: { id: team.id, name: team.name, slug: team.slug ?? null },
    startHere: {
      stack:
        "MCP servers and APIs: TypeScript + Hono + the official MCP SDK (@modelcontextprotocol/sdk + zod) on a Spaces Worker, deployed through the Spaces API (no wrangler). Bun is fine locally; deploy ONE Workers ES module. Python (FastMCP) only for self-hosted servers that need heavy data libraries.",
      starter: `${base}/api/recipes/mcp-server-on-worker/starter.zip`,
      starterTree: `${base}/api/recipes/mcp-server-on-worker/starter`,
      recipe: `${base}/api/recipes/mcp-server-on-worker?format=md`,
      rules: TOP_RULES,
      changes: [
        {
          since: "0.16.0",
          what: `Plain var values leave GET …/workers, GET …/workers/<name> and MCP list_workers on ${new Date(config.workers.varValuesSunset).toISOString()}. Read varNames; ask with ?includeValues=1 (needs workers:deploy) or list_workers {"includeValues": true} when you need values.`,
          docs: `${base}/docs/workers#var-values`,
        },
      ],
      notes: {
        url: `${base}/api/teams/${ref}/notes`,
        how: 'POST {"severity":"info|bug|blocker|suggestion","stage":"deploy|build|runtime|recipe|other","category","message","target":{"type":"space|worker|mcp|recipe","id"},"version","agent"} with your key; MCP: leave_note. Read replies with GET.',
      },
    },
    invite: {
      name: inv.name,
      description: inv.description || null,
      scopes: inv.scopes,
      keyLifetimeDays: inv.keyDays,
      linkExpiresAt: inv.expiresAt,
      oneTime: true,
    },
    claim: {
      method: "POST",
      url: claim,
      note: "Returns the agent key ONCE. Store it as a secret (e.g. MARSA_AGENT_KEY); the link stops working after the claim.",
    },
    api: {
      base: `${base}/api`,
      auth: "Send the key as X-Team-Key: <key> or Authorization: Bearer <key>",
      openapi: `${base}/openapi.json`,
    },
    docs: {
      index: `${base}/docs`,
      agents: `${base}/docs/agents`,
      agentKeys: `${base}/docs/agent-keys`,
      workers: `${base}/docs/workers`,
      api: `${base}/docs/api`,
      mcp: `${base}/docs/mcp`,
      llms: `${base}/llms.txt`,
      recipes: `${base}/docs/recipes`,
    },
    recipes: {
      note: "Step-by-step playbooks. Read the security rules first. As markdown: GET <api>/recipes/<slug>?format=md (add ?lang=ar for Arabic); your team's own recipes are listed too when you send your key.",
      list: `${base}/api/recipes`,
      start: [
        { slug: "agent-security-rules", url: `${base}/api/recipes/agent-security-rules?format=md` },
        { slug: "mcp-server-on-worker", url: `${base}/api/recipes/mcp-server-on-worker?format=md` },
        {
          slug: "protect-mcp-with-keys",
          url: `${base}/api/recipes/protect-mcp-with-keys?format=md`,
        },
        { slug: "site-kv-and-files", url: `${base}/api/recipes/site-kv-and-files?format=md` },
        {
          slug: "bilingual-project-page",
          url: `${base}/api/recipes/bilingual-project-page?format=md`,
        },
        {
          slug: "python-mcp-self-hosted",
          url: `${base}/api/recipes/python-mcp-self-hosted?format=md`,
        },
        { slug: "agent-notes", url: `${base}/api/recipes/agent-notes?format=md` },
      ],
    },
    examples: {
      claim: `curl -s -X POST "${claim}"`,
      listSpaces: `curl -s "${base}/api/teams/${ref}/sites" -H "X-Team-Key: $MARSA_AGENT_KEY"`,
      publish: `curl -s -X POST "${base}/api/sites" -H "X-Team-Key: $MARSA_AGENT_KEY" -H "Content-Type: application/json" -d '{"files":[{"path":"index.html","content":"<h1>Hello</h1>"}]}'`,
      listWorkers: `curl -s "${base}/api/teams/${ref}/workers" -H "X-Team-Key: $MARSA_AGENT_KEY"`,
      deployWorker: `curl -s -X PUT "${base}/api/teams/${ref}/workers/hello" -H "X-Team-Key: $MARSA_AGENT_KEY" -H "Content-Type: application/javascript" --data-binary @worker.js`,
    },
    mcp: {
      note: "One MCP server per space. With the mcp scope, the agent key works as the bearer token.",
      config: {
        mcpServers: {
          "marsa-space": {
            url: `${base}/mcp/s/<siteId>`,
            headers: { Authorization: "Bearer <MARSA_AGENT_KEY>" },
          },
        },
      },
    },
  };
}

export function onboardingMarkdown(o: ReturnType<typeof inviteOnboarding>): string {
  const ex = o.examples;
  return `# Marsa Spaces: agent invite for ${o.team.name}

You were invited to work with the team **${o.team.name}** (slug \`${o.team.slug ?? o.team.id}\`) on Marsa Spaces.

- Key name: ${o.invite.name}${o.invite.description ? `\n- Purpose: ${o.invite.description}` : ""}
- Scopes: ${o.invite.scopes.map((s) => `\`${s}\``).join(", ")}
- Key lifetime: ${o.invite.keyLifetimeDays} days
- This link is single-use and expires at ${o.invite.linkExpiresAt}

## Start here

- **Stack:** ${o.startHere.stack}
- **Starter (builds, tests, deploy script):** ${o.startHere.starter} (tree: ${o.startHere.starterTree})
- **Recipe:** ${o.startHere.recipe}

Top 10 rules:

${o.startHere.rules.map((r, i) => `${i + 1}. ${r}`).join("\n")}

API changes:

${o.startHere.changes.map((ch) => `- **${ch.since}:** ${ch.what} (${ch.docs})`).join("\n")}

## 1. Claim your key (once)

\`\`\`sh
${ex.claim}
\`\`\`

The response contains \`key\`, shown only once. Keep it secret (for example as \`MARSA_AGENT_KEY\`).

## 2. Call the API

Base: ${o.api.base} · OpenAPI: ${o.api.openapi}
${o.api.auth}.

\`\`\`sh
${ex.listSpaces}
${ex.publish}
${ex.listWorkers}
${ex.deployWorker}
\`\`\`

Calls outside your scopes get 403 \`INSUFFICIENT_SCOPE\`.

## 3. MCP (optional, needs the \`mcp\` scope)

${o.mcp.note}

\`\`\`json
${JSON.stringify(o.mcp.config, null, 2)}
\`\`\`

## 4. Recipes (read before you build)

${o.recipes.note}

${o.recipes.start.map((r) => `- \`${r.slug}\`: ${r.url}`).join("\n")}
- All recipes: ${o.recipes.list} · ${o.docs.recipes}

## Docs

- ${o.docs.agentKeys}
- ${o.docs.agents}
- ${o.docs.api}
- ${o.docs.workers}
- ${o.docs.mcp}
- ${o.docs.llms}
`;
}

export function mountAgentRoutes(app: Hono, d: AgentRouteDeps): void {
  const { config, teams, agentKeys, notify, limiter, members } = d;
  const audit = (teamId: string, actor: Actor, action: string, detail?: string) =>
    members.log({ teamId, actor, action, ...(detail ? { detail } : {}) });
  const ADMIN: Actor = { kind: "admin", label: "admin" };

  /** Team-key only: managing keys, webhooks and alerts is an owner's job. */
  const ownerOf = async (c: Context): Promise<TeamCred | Response> => {
    const cred = await d.teamAuth(c);
    if (!cred || cred === "invalid") {
      return err(c, 401, "UNAUTHORIZED", "send the team key (X-Team-Key or Authorization: Bearer)");
    }
    const want = c.req.param("team") ?? "";
    if (want !== cred.team.id && want !== cred.team.slug) {
      return err(c, 404, "NOT_FOUND", "this key does not belong to that team");
    }
    if (cred.kind !== "team") {
      return err(c, 403, "TEAM_KEY_REQUIRED", "agent keys cannot manage keys, webhooks or alerts");
    }
    return cred;
  };
  const body = async (c: Context) =>
    ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;

  // ---- agent keys (team key) ---------------------------------------------------------------
  const keysOf = (teamId: string) => agentKeys.list(teamId).map((k) => agentKeys.view(k));
  app.get("/api/teams/:team/agent-keys", async (c) => {
    const o = await ownerOf(c);
    if (o instanceof Response) return o;
    return c.json({
      scopes: SCOPES,
      keys: keysOf(o.team.id),
      invites: agentKeys.openInvites(o.team.id).map((i) => agentKeys.inviteView(i)),
    });
  });
  app.post("/api/teams/:team/agent-keys", async (c) => {
    const o = await ownerOf(c);
    if (o instanceof Response) return o;
    try {
      const { key, secret } = await agentKeys.create(o.team.id, await body(c), o.actor.label);
      await audit(o.team.id, o.actor, "agent-key-create", `${key.name} (${key.prefix}…)`);
      return c.json({ key: agentKeys.view(key), secret }, 201);
    } catch (e) {
      return agentErr(c, e);
    }
  });
  app.delete("/api/teams/:team/agent-keys/:id", async (c) => {
    const o = await ownerOf(c);
    if (o instanceof Response) return o;
    const k = await agentKeys.revoke(o.team.id, c.req.param("id"), o.actor.label);
    if (!k) return err(c, 404, "NOT_FOUND", "no such agent key");
    await audit(o.team.id, o.actor, "agent-key-revoke", `${k.name} (${k.prefix}…)`);
    return c.json({ key: agentKeys.view(k) });
  });
  app.post("/api/teams/:team/agent-invites", async (c) => {
    const o = await ownerOf(c);
    if (o instanceof Response) return o;
    try {
      const { invite, secret } = await agentKeys.createInvite(
        o.team.id,
        await body(c),
        o.actor.label,
      );
      await audit(o.team.id, o.actor, "agent-invite", invite.name);
      return c.json(
        { invite: agentKeys.inviteView(invite), url: `${config.publicUrl}/agent-invite/${secret}` },
        201,
      );
    } catch (e) {
      return agentErr(c, e);
    }
  });
  app.delete("/api/teams/:team/agent-invites/:id", async (c) => {
    const o = await ownerOf(c);
    if (o instanceof Response) return o;
    if (!(await agentKeys.revokeInvite(o.team.id, c.req.param("id"))))
      return err(c, 404, "NOT_FOUND", "no such invite");
    return c.body(null, 204);
  });

  // ---- notifications + webhook (team key) -----------------------------------------------
  const noticeJson = (teamId: string | null, who: string | null) =>
    notify.forViewer(teamId, who).map((n) => ({
      id: n.id,
      at: n.at,
      kind: n.kind,
      team: n.teamId === PLATFORM ? null : n.teamId,
      actor: n.actor ?? null,
      detail: n.detail ?? null,
      text: noticeText("en", n),
      unread: n.unread,
    }));
  app.get("/api/teams/:team/notifications", async (c) => {
    const o = await ownerOf(c);
    if (o instanceof Response) return o;
    return c.json({
      unread: notify.unread(o.team.id, "key"),
      notifications: noticeJson(o.team.id, "key"),
    });
  });
  app.post("/api/teams/:team/notifications/read", async (c) => {
    const o = await ownerOf(c);
    if (o instanceof Response) return o;
    await notify.markRead(o.team.id, "key");
    return c.body(null, 204);
  });
  app.get("/api/teams/:team/webhook", async (c) => {
    const o = await ownerOf(c);
    if (o instanceof Response) return o;
    return c.json({ webhook: notify.hook(o.team.id) });
  });
  app.put("/api/teams/:team/webhook", async (c) => {
    const o = await ownerOf(c);
    if (o instanceof Response) return o;
    try {
      const r = await notify.setHook(o.team.id, (await body(c)).url);
      await audit(o.team.id, o.actor, "webhook-set", r.hook.url.replace(/\?.*$/, ""));
      return c.json({ webhook: r.hook, secret: r.secret });
    } catch (e) {
      return agentErr(c, e);
    }
  });
  app.delete("/api/teams/:team/webhook", async (c) => {
    const o = await ownerOf(c);
    if (o instanceof Response) return o;
    await notify.clearHook(o.team.id);
    await audit(o.team.id, o.actor, "webhook-clear");
    return c.body(null, 204);
  });
  app.post("/api/teams/:team/webhook/test", async (c) => {
    const o = await ownerOf(c);
    if (o instanceof Response) return o;
    const r = limiter.hit(`whtest:${o.team.id}`, 10, 3_600_000);
    if (!r.allowed) return err(c, 429, "RATE_LIMITED", "test limit reached for this hour");
    const last = await notify.test(o.team.id, o.actor.label);
    if (!last) return err(c, 404, "NOT_FOUND", "no webhook is set");
    return c.json({ delivery: last });
  });

  // ---- admin (after the /api/admin/* guard) ----------------------------------------------
  app.get("/api/admin/notifications", (c) =>
    c.json({ unread: notify.unread(null, null), notifications: noticeJson(null, null) }),
  );
  app.post("/api/admin/notifications/read", async (c) => {
    await notify.markRead(null, null);
    return c.body(null, 204);
  });
  app.get("/api/admin/webhook", (c) => c.json({ webhook: notify.hook(PLATFORM) }));
  app.put("/api/admin/webhook", async (c) => {
    try {
      const r = await notify.setHook(PLATFORM, (await body(c)).url);
      await audit(PLATFORM, ADMIN, "webhook-set", r.hook.url.replace(/\?.*$/, ""));
      return c.json({ webhook: r.hook, secret: r.secret });
    } catch (e) {
      return agentErr(c, e);
    }
  });
  app.delete("/api/admin/webhook", async (c) => {
    await notify.clearHook(PLATFORM);
    await audit(PLATFORM, ADMIN, "webhook-clear");
    return c.body(null, 204);
  });
  app.post("/api/admin/webhook/test", async (c) => {
    const last = await notify.test(PLATFORM, "admin");
    if (!last) return err(c, 404, "NOT_FOUND", "no webhook is set");
    return c.json({ delivery: last });
  });
  app.get("/api/admin/teams/:id/agent-keys", (c) => {
    const t = teams.get(c.req.param("id"));
    if (!t) return err(c, 404, "NOT_FOUND", "team not found");
    return c.json({ keys: keysOf(t.id) });
  });
  app.post("/api/admin/teams/:id/agent-keys", async (c) => {
    const t = teams.get(c.req.param("id"));
    if (!t) return err(c, 404, "NOT_FOUND", "team not found");
    try {
      const { key, secret } = await agentKeys.create(t.id, await body(c), "admin");
      await audit(t.id, ADMIN, "agent-key-create", `${key.name} (${key.prefix}…)`);
      return c.json({ key: agentKeys.view(key), secret }, 201);
    } catch (e) {
      return agentErr(c, e);
    }
  });
  app.delete("/api/admin/teams/:id/agent-keys/:kid", async (c) => {
    const k = await agentKeys.revoke(c.req.param("id"), c.req.param("kid"), "admin");
    if (!k) return err(c, 404, "NOT_FOUND", "no such agent key");
    await audit(k.teamId, ADMIN, "agent-key-revoke", `${k.name} (${k.prefix}…)`);
    return c.json({ key: agentKeys.view(k) });
  });
}

/**
 * The public, one-time agent invite link. Mounted outside /api so the URL reads well;
 * the secret in the path is the only credential. Rate-limited per IP.
 */
export function mountAgentInviteRoutes(app: Hono, d: AgentRouteDeps): void {
  const { config, teams, agentKeys, limiter, members } = d;
  const rate = (c: Context) => {
    const r = limiter.hit(`ainv:${clientIp(c, config.trustProxy)}`, 30, 3_600_000);
    if (r.allowed) return null;
    c.header("Retry-After", String(r.retryAfterSec));
    return err(c, 429, "RATE_LIMITED", "too many invite requests, try again later");
  };
  const gone = (c: Context) =>
    err(c, 404, "INVITE_INVALID", "this agent invite link is invalid, expired or already used");
  const noStore = (c: Context) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("Referrer-Policy", "no-referrer");
  };

  app.get("/agent-invite/:token", async (c) => {
    noStore(c);
    const limited = rate(c);
    if (limited) return limited;
    await agentKeys.ready();
    const token = c.req.param("token");
    const inv = agentKeys.findInvite(token);
    const team = inv ? teams.get(inv.teamId) : null;
    if (!inv || !team) return gone(c);
    const o = inviteOnboarding(config, team, inv, token);
    const wantsJson =
      c.req.query("format") === "json" ||
      (/application\/json/i.test(c.req.header("accept") ?? "") &&
        !/text\/markdown/i.test(c.req.header("accept") ?? ""));
    if (wantsJson) return c.json(o);
    c.header("Content-Type", "text/markdown; charset=utf-8");
    return c.body(onboardingMarkdown(o));
  });
  app.post("/agent-invite/:token/claim", async (c) => {
    noStore(c);
    const limited = rate(c);
    if (limited) return limited;
    await agentKeys.ready();
    try {
      const out = await agentKeys.claim(c.req.param("token"));
      const team = out ? teams.get(out.key.teamId) : null;
      if (!out || !team) return gone(c);
      await members.log({
        teamId: team.id,
        actor: { kind: "api", label: `agent key ${out.key.name}` },
        action: "agent-invite-claim",
        detail: `${out.key.name} (${out.key.prefix}…)`,
      });
      return c.json(
        {
          key: out.secret,
          keyId: out.key.id,
          prefix: out.key.prefix,
          scopes: out.key.scopes,
          expiresAt: out.key.expiresAt,
          team: { id: team.id, name: team.name, slug: team.slug ?? null },
          api: `${config.publicUrl}/api`,
          note: "Shown once. Send it as X-Team-Key or Authorization: Bearer.",
        },
        201,
      );
    } catch (e) {
      return agentErr(c, e);
    }
  });
}

export { AGENT_INVITE_TTL_HOURS };
