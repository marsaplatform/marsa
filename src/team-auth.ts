import type { Context } from "hono";
import { AGENT_KEY_PREFIX, type AgentKey, type AgentKeyStore, type Scope } from "./agent-keys.js";
import { clientIp } from "./client-ip.js";
import type { Actor } from "./members.js";
import type { NotificationCenter } from "./notify.js";
import { isTeamKey, type Team, type TeamStore } from "./teams.js";
import { bearer } from "./tokens.js";

/**
 * Who is calling a team API: the team key (everything) or an agent key (its scopes).
 * Both arrive as X-Team-Key or Authorization: Bearer.
 */
export type TeamCred =
  | { kind: "team"; team: Team; actor: Actor }
  | { kind: "agent"; team: Team; key: AgentKey; actor: Actor };

export const isAgentKey = (s: string) => s.startsWith(AGENT_KEY_PREFIX);

export function can(cred: TeamCred, scope: Scope): boolean {
  return cred.kind === "team" || cred.key.scopes.includes(scope);
}

export const scopeError = (c: Context, scope: Scope) =>
  c.json(
    {
      error: {
        code: "INSUFFICIENT_SCOPE",
        message: `this agent key does not have the ${scope} scope`,
      },
    },
    403,
  );

export interface TeamAuthDeps {
  teams: TeamStore;
  agentKeys: AgentKeyStore;
  notify: NotificationCenter;
  trustProxy: boolean;
}

/** The raw credential string from the request, if it looks like a team or agent key. */
export function credentialOf(c: Context): string {
  const header = c.req.header("x-team-key")?.trim() ?? "";
  const auth = bearer(c.req.header("authorization")) ?? "";
  if (header) return header;
  return isTeamKey(auth) || isAgentKey(auth) ? auth : "";
}

/**
 * True when the request carries a site edit token as its bearer (that path wins over an
 * X-Team-Key header sent along with it, as before 0.14.0).
 */
export function hasEditBearer(c: Context): boolean {
  const auth = bearer(c.req.header("authorization")) ?? "";
  return !!auth && !isTeamKey(auth) && !isAgentKey(auth);
}

/**
 * Resolve the caller. Returns null when no key was sent, "invalid" for an unknown,
 * revoked or expired key. A used agent key records its last use and raises an
 * alert the first time it is seen from a new address (only an IP hash is kept).
 */
export function makeTeamAuth(d: TeamAuthDeps) {
  return async (c: Context, raw = credentialOf(c)): Promise<TeamCred | null | "invalid"> => {
    if (!raw) return null;
    if (isAgentKey(raw)) {
      await d.agentKeys.ready();
      const key = d.agentKeys.verify(raw);
      const team = key ? d.teams.get(key.teamId) : null;
      if (!key || !team) return "invalid";
      const use = await d.agentKeys.touch(key, clientIp(c, d.trustProxy));
      if (use.newIp) {
        void d.notify
          .add({
            teamId: team.id,
            kind: "agent-key-new-ip",
            actor: `agent key ${key.name}`,
            detail: `${key.name} (${key.prefix}…)${use.first ? " · first use" : ""} · ip#${use.ipHash.slice(0, 8)}`,
          })
          .catch(() => {});
      }
      return { kind: "agent", team, key, actor: { kind: "api", label: `agent key ${key.name}` } };
    }
    const team = isTeamKey(raw) ? d.teams.byTeamKey(raw) : null;
    if (!team) return "invalid";
    return { kind: "team", team, actor: { kind: "api", label: "team key" } };
  };
}
export type TeamAuth = ReturnType<typeof makeTeamAuth>;
