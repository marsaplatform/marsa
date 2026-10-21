/**
 * 0.16.0: OpenAPI entries for routes that had none (the admin API, webhooks, notifications,
 * Worker operations, activity and export). Kept as a compact table; a test checks that every
 * registered /api route has an entry.
 */
type Auth = "admin" | "team" | "teamOnly" | "public";
type Row = [method: string, path: string, summary: string, auth: Auth, more?: string];

const ROWS: Row[] = [
  // Activity and export (0.16.0)
  [
    "get",
    "/api/teams/{team}/activity",
    "The team's activity log (team key only). ?since&until&action (exact or prefix ending in -)&site&limit (≤5000)&format=json|jsonl|csv",
    "teamOnly",
  ],
  [
    "get",
    "/api/teams/{team}/export",
    "Download everything the team has on Spaces as a zip (team key only; no secrets)",
    "teamOnly",
  ],
  [
    "get",
    "/api/admin/activity",
    "Activity logs: ?team=<id>|platform (none = every log), since, until, action, site, limit, format=json|jsonl|csv",
    "admin",
  ],
  // Webhooks and notifications
  [
    "get",
    "/api/teams/{team}/webhook",
    "The team's webhook (URL only; the signing secret is shown once when set)",
    "teamOnly",
  ],
  ["delete", "/api/teams/{team}/webhook", "Remove the team's webhook", "teamOnly"],
  [
    "post",
    "/api/teams/{team}/webhook/test",
    "Send a signed test delivery to the team's webhook",
    "teamOnly",
  ],
  ["post", "/api/teams/{team}/notifications/read", "Mark the team's notifications read", "team"],
  ["get", "/api/admin/webhook", "The platform webhook (admin)", "admin"],
  [
    "put",
    "/api/admin/webhook",
    'Set the platform webhook: {"url": "https://…"}; returns the signing secret once',
    "admin",
  ],
  ["delete", "/api/admin/webhook", "Remove the platform webhook", "admin"],
  ["post", "/api/admin/webhook/test", "Send a test delivery to the platform webhook", "admin"],
  [
    "get",
    "/api/admin/notifications",
    "Platform notifications and the unread count (admin)",
    "admin",
  ],
  ["post", "/api/admin/notifications/read", "Mark the platform notifications read", "admin"],
  // Agent keys and invites
  [
    "delete",
    "/api/teams/{team}/agent-keys/{id}",
    "Revoke an agent key (team key only)",
    "teamOnly",
  ],
  [
    "delete",
    "/api/teams/{team}/agent-invites/{id}",
    "Cancel an unclaimed agent invite link (team key only)",
    "teamOnly",
  ],
  ["get", "/api/admin/teams/{id}/agent-keys", "A team's agent keys (admin; no secrets)", "admin"],
  [
    "post",
    "/api/admin/teams/{id}/agent-keys",
    'Create an agent key for a team: {"name", "scopes", "expiresInDays"}; the secret is returned once',
    "admin",
  ],
  [
    "delete",
    "/api/admin/teams/{id}/agent-keys/{kid}",
    "Revoke a team's agent key (admin)",
    "admin",
  ],
  // Members and invites (admin)
  ["get", "/api/admin/teams/{id}/members", "A team's members and open invites (admin)", "admin"],
  [
    "post",
    "/api/admin/teams/{id}/invites",
    'Invite a member: {"role": "owner|editor|viewer"}; returns the one-time link',
    "admin",
  ],
  ["delete", "/api/admin/teams/{id}/invites/{iid}", "Revoke an invite (admin)", "admin"],
  ["delete", "/api/admin/teams/{id}/members/{mid}", "Remove a member (admin)", "admin"],
  // Notes and recipes (admin)
  [
    "get",
    "/api/admin/notes",
    "Agent notes from every team: ?team, status, severity (admin)",
    "admin",
  ],
  [
    "patch",
    "/api/admin/notes/{id}",
    'Reply to or change a note: {"status"?, "reply"?} (admin)',
    "admin",
  ],
  ["put", "/api/admin/recipes/{slug}", "Create or update a platform recipe (admin)", "admin"],
  ["delete", "/api/admin/recipes/{slug}", "Delete a platform recipe (admin)", "admin"],
  // Backend checks (admin)
  [
    "get",
    "/api/admin/backend/check",
    "Read/write probe of the data and files backend (admin)",
    "admin",
  ],
  [
    "get",
    "/api/admin/backend/permissions",
    "Permission checklist of the backend token (read-only probes; ?refresh=1)",
    "admin",
  ],
  // Workers (admin)
  ["get", "/api/admin/workers", "Every team Worker (admin)", "admin"],
  [
    "get",
    "/api/admin/workers/settings",
    "Cloudflare connection for team Workers (token never returned)",
    "admin",
  ],
  [
    "put",
    "/api/admin/workers/settings",
    'Set the Cloudflare connection: {"token", "accountId"?, "zone"?} (write-only token)',
    "admin",
  ],
  ["delete", "/api/admin/workers/settings", "Remove the Cloudflare connection", "admin"],
  ["post", "/api/admin/workers/settings/verify", "Verify the stored Cloudflare token", "admin"],
  [
    "get",
    "/api/admin/workers/permissions",
    "Permission checklist of the Workers token (read-only probes; ?refresh=1)",
    "admin",
  ],
  ["get", "/api/admin/workers/health-settings", "Health check interval in seconds", "admin"],
  [
    "put",
    "/api/admin/workers/health-settings",
    'Set the health check interval: {"intervalSec": 60-3600}',
    "admin",
  ],
  [
    "put",
    "/api/admin/teams/{id}/workers",
    'Turn Workers on/off for a team and set its slug and limits: {"enabled", "slug"?, "maxWorkers"?, "maxWorkerKb"?}',
    "admin",
  ],
  ["delete", "/api/admin/workers/{id}", "Delete any team's Worker (admin)", "admin"],
  [
    "post",
    "/api/admin/workers/{id}/disable",
    "Disable a Worker (keeps it, stops serving)",
    "admin",
  ],
  ["post", "/api/admin/workers/{id}/enable", "Re-enable a disabled Worker", "admin"],
  [
    "get",
    "/api/admin/workers/{id}/env",
    "A Worker's vars, secrets and bindings (names and status only)",
    "admin",
  ],
  [
    "put",
    "/api/admin/workers/{id}/secrets/{secret}",
    'Set or rotate a Worker secret: {"value"} (write-only)',
    "admin",
  ],
  ["delete", "/api/admin/workers/{id}/secrets/{secret}", "Remove a Worker secret", "admin"],
  ["get", "/api/admin/workers/{id}/health", "A Worker's health history", "admin"],
  [
    "post",
    "/api/admin/workers/{id}/health",
    '{"enabled"?: bool, "check"?: true, "healthPath"?, "healthExpect"?}',
    "admin",
  ],
  ["get", "/api/admin/workers/{id}/logs", "Recent errors (24h) and Workers Logs lines", "admin"],
  ["post", "/api/admin/workers/{id}/logs", 'Turn Workers Logs on/off: {"enabled": bool}', "admin"],
  ["get", "/api/admin/workers/{id}/usage", "Requests, errors and CPU: ?range=24h|7d|30d", "admin"],
  // Worker versions and helpers
  [
    "get",
    "/api/teams/{team}/workers/{name}/versions/{n}",
    "One stored version of a Worker, with its code (workers:read)",
    "team",
  ],
  ["get", "/api/keys/helper.js", "Browser helper for Worker end-user API keys (v1)", "public"],
  ["get", "/api/keys/helper.v2.js", "Browser helper for Worker end-user API keys (v2)", "public"],
];

const SECURITY: Record<Auth, object[] | undefined> = {
  admin: [{ adminToken: [] }],
  team: [{ teamKey: [] }],
  teamOnly: [{ teamKey: [] }],
  public: undefined,
};

/** Merge the table into an OpenAPI paths object (existing operations win). */
export function addMorePaths(paths: Record<string, Record<string, unknown>>): void {
  for (const [method, path, summary, auth] of ROWS) {
    if (!paths[path]) paths[path] = {};
    const item = paths[path];
    if (item[method]) continue;
    const params = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    const opId = `${method}${path
      .replace(/^\/api/, "")
      .replace(/\{([^}]+)\}/g, "By-$1")
      .split(/[/.-]/)
      .filter(Boolean)
      .map((w) => w[0]?.toUpperCase() + w.slice(1))
      .join("")}`;
    item[method] = {
      summary,
      operationId: opId,
      ...(SECURITY[auth] ? { security: SECURITY[auth] } : {}),
      ...(params.length ? { parameters: params } : {}),
      ...(auth === "teamOnly"
        ? { description: "Agent keys get 403 TEAM_KEY_REQUIRED: use the team key." }
        : {}),
      responses: {
        "200": { description: "OK" },
        ...(auth !== "public" ? { "401": { description: "Missing or wrong key" } } : {}),
        ...(params.length ? { "404": { description: "Not found" } } : {}),
      },
    };
  }
}
