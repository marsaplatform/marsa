# Team Workers

Teams can deploy small [Cloudflare Workers](https://developers.cloudflare.com/workers/) (APIs, webhooks, MCP servers) through Marsa Spaces. The platform admin connects **one** Cloudflare API token; Spaces deploys on each team's behalf, so **no team or agent ever sees or needs a Cloudflare key**.

## How it works

- **Admin, once:** in the admin console → **Settings** (`/admin/settings`), paste a Cloudflare API token (permissions: *Account · Workers Scripts: Edit*, *Zone · Workers Routes: Edit*, *Zone · DNS: Edit*), the account id (optional) and the zone (e.g. `marsaplatform.com`). The token is verified with Cloudflare, encrypted at rest (AES-256-GCM with `MARSA_SECRETS_KEY`) and is **write-only**: the console shows only "set (…last 4)" and a **Verify** button. No API ever returns it.
- **Admin, per team:** turn **Workers** on, give the team a **slug** (2-20 lowercase letters/digits, e.g. `sanad`) and optional quotas (default 3 Workers, 1024 KB per script).
- **Names are forced:** a Worker called `hello` of team `sanad` is the script `team-sanad-hello` at `https://sanad-hello.<zone>` (a proxied `AAAA 100::` DNS record + a route `sanad-hello.<zone>/*`). With no zone configured, Workers get a `workers.dev` address.
- **Safety:** Spaces only modifies or deletes scripts, routes and DNS records it created (tracked in `workers.json`). Before creating anything it checks that the script name, the hostname (any DNS record) and the route are free, and refuses with `409 NAME_TAKEN` / `409 HOST_TAKEN` otherwise.
- **Roles:** owners and editors deploy and delete from **Team dashboard → Workers**; viewers can only look. Agents use the team key (API) or a read-write space MCP token (tools).
- **Teardown:** turning Workers off for a team, or deleting the team, deletes all its Workers (route, DNS record, script). The admin can also **Disable** a Worker (its route is removed, the script stays) and **Enable** it again.
- **Audit:** deploys, redeploys, deletes and admin changes are written to the team's activity log; token changes to the platform log on the admin Workers page. Secrets are never logged.

## API (team key)

Send the team key as `X-Team-Key: marsa_team_…` (or `Authorization: Bearer marsa_team_…`). `<team>` is the team's slug or id.

| Method | Path | What |
| --- | --- | --- |
| `GET` | `/api/teams/<team>/workers` | List Workers and the quota |
| `PUT` | `/api/teams/<team>/workers/<name>` | Create or redeploy (JSON, or the raw script as `application/javascript`) |
| `POST` | `/api/teams/<team>/workers` | Create (JSON with `name`); `409 EXISTS` if it exists |
| `GET` | `/api/teams/<team>/workers/<name>` | One Worker plus a live check (`live.status`); `?probe=0` skips it |
| `DELETE` | `/api/teams/<team>/workers/<name>` | Delete it (route, DNS record, script) |

JSON body: `{"name": "hello", "code": "<ES module>", "vars": {"NAME": "value"}, "secrets": {"API_KEY": "…"}}`.

- `code` must be one ES module (`export default { async fetch(request, env) { … } }`), up to the team's size limit.
- `vars` are plain-text env vars (visible to the team). Omit `vars` on a redeploy to keep the current ones.
- `secrets` are write-only Worker secrets (only their names are shown). `null` removes one.
- Names: 1-30 characters, `a-z`, `0-9` and single hyphens, not at the ends.

```bash
export MARSA_TEAM_KEY=marsa_team_…        # keep it secret

cat > worker.js <<'JS'
export default {
  async fetch(request, env) {
    return Response.json({ hello: env.WHO ?? "world" });
  },
};
JS

# Create or redeploy (raw script)
curl -s -X PUT "https://marsa.example.com/api/teams/sanad/workers/hello" \
  -H "X-Team-Key: $MARSA_TEAM_KEY" \
  -H "Content-Type: application/javascript" --data-binary @worker.js

# With env vars and a secret (JSON)
jq -n --rawfile code worker.js \
  '{code: $code, vars: {WHO: "Sanad"}, secrets: {UPSTREAM_TOKEN: "…"}}' |
curl -s -X PUT "https://marsa.example.com/api/teams/sanad/workers/hello" \
  -H "X-Team-Key: $MARSA_TEAM_KEY" -H "Content-Type: application/json" --data-binary @-

# List, check, delete
curl -s "https://marsa.example.com/api/teams/sanad/workers" -H "X-Team-Key: $MARSA_TEAM_KEY"
curl -s "https://marsa.example.com/api/teams/sanad/workers/hello" -H "X-Team-Key: $MARSA_TEAM_KEY"
curl -s -X DELETE "https://marsa.example.com/api/teams/sanad/workers/hello" -H "X-Team-Key: $MARSA_TEAM_KEY"
```

Errors: `401 UNAUTHORIZED` (no/unknown key), `404` (key of another team, unknown Worker), `403 WORKERS_NOT_ALLOWED` (not enabled for the team), `400 INVALID_NAME` / `NOT_A_MODULE` / `INVALID_REQUEST`, `413 SCRIPT_TOO_LARGE`, `409 WORKER_QUOTA` / `NAME_TAKEN` / `HOST_TAKEN` / `EXISTS`, `429 RATE_LIMITED` (60 deploys per team per hour), `502 CLOUDFLARE_ERROR` (Cloudflare's message, scrubbed), `503 WORKERS_NOT_CONFIGURED`.

## MCP tools

When Workers are on for the team, a space's MCP server (see [MCP per space](mcp.md)) also offers `list_workers` (read-only tokens) and `deploy_worker` / `delete_worker` (read-write tokens), with the same rules as the API.

## Admin API

All with `Authorization: Bearer $ADMIN_TOKEN`:

- `GET /api/admin/workers/settings`, `PUT /api/admin/workers/settings` (`{"token","accountId"?,"zone"?}`), `POST /api/admin/workers/settings/verify`, `DELETE /api/admin/workers/settings` (only when no team Workers exist).
- `PUT /api/admin/teams/<id>/workers` (`{"enabled", "slug", "maxWorkers", "maxWorkerKb"}`); `enabled: false` deletes the team's Workers.
- `GET /api/admin/workers`, `POST /api/admin/workers/<id>/disable|enable`, `DELETE /api/admin/workers/<id>`.

## Server configuration

| Variable | Default | |
| --- | --- | --- |
| `MARSA_SECRETS_KEY` | (empty) | Required for Workers: >= 32 random characters (`openssl rand -hex 32`). Keep it out of backups of the data dir. |
| `WORKERS_DEFAULT_MAX` | `3` | Workers per team unless the admin sets a quota |
| `WORKER_MAX_KB` | `1024` | Script size per team unless the admin sets a quota |
| `WORKERS_COMPAT_DATE` | `2025-09-01` | Cloudflare compatibility date for deployed scripts |

Not included yet: live log tailing (use the Cloudflare dashboard), bindings other than plain vars and secrets (KV, D1, R2, Durable Objects), and multi-file bundles (bundle first, e.g. with `esbuild --bundle --format=esm`).
