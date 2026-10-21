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

Send the team key as `X-Team-Key: marsa_team_…` (or `Authorization: Bearer marsa_team_…`). `<team>` is the team's slug or id. An [agent key](agent-keys.md) works too: reads need `workers:read`, changes need `workers:deploy`.

| Method | Path | What |
| --- | --- | --- |
| `GET` | `/api/teams/<team>/workers` | List Workers and the quota |
| `PUT` | `/api/teams/<team>/workers/<name>` | Create or redeploy (JSON, or the raw script as `application/javascript`) |
| `POST` | `/api/teams/<team>/workers` | Create (JSON with `name`); `409 EXISTS` if it exists |
| `GET` | `/api/teams/<team>/workers/<name>` | One Worker plus a live check (`live.status`); `?probe=0` skips it |
| `DELETE` | `/api/teams/<team>/workers/<name>` | Delete it (route, DNS record, script) and its stored versions |
| `GET` | `/api/teams/<team>/workers/<name>/versions` | Stored versions, newest first (no code) |
| `GET` | `/api/teams/<team>/workers/<name>/versions/<n>` | One version with its vars (never secret values) |
| `GET` | `/api/teams/<team>/workers/<name>/versions/<n>/code` | Download the code of a version |
| `POST` | `/api/teams/<team>/workers/<name>/redeploy` | One-click redeploy of the newest stored version (`{"note"?}`) |
| `POST` | `/api/teams/<team>/workers/<name>/rollback` | Deploy an older version again: `{"version": 2, "note"?}` |

JSON body: `{"name": "hello", "code": "<ES module>", "vars": {"NAME": "value"}, "secrets": {"API_KEY": "…"}}`.

- `code` must be one ES module (`export default { async fetch(request, env) { … } }`), up to the team's size limit.
- `vars` are plain-text env vars (visible to the team). Omit `vars` on a redeploy to keep the current ones. Up to 32 vars, **32 KB each and 64 KB in total** (0.14.0; was 5 KB). Cloudflare limits one binding to 5 KB, so larger vars are delivered in a small generated module that a wrapper merges into `env`; the Worker sees them as normal `env.NAME` strings. That needs an object default export (`export default { fetch… }`), not a class.
- `note` (optional, 200 characters) is stored with the version; with a raw-script upload send it as the `X-Marsa-Note` header.
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

## Versions, one-click redeploy and rollback (0.14.0)

Every successful deploy is stored as a version on the Spaces server: the code, the plain vars, the **names** of the secrets (never their values), who deployed it, when, its size and SHA-256, and the note. The last **10** per Worker are kept (in `<DATA_DIR>/worker-versions/`, mode 600) and deleted with the Worker.

- **Redeploy** (one click on the Workers page, or `POST …/redeploy`) deploys the newest stored version again with the same code and vars. Secrets stay as they are on Cloudflare.
- **Roll back to this** (Versions page, with a confirmation, or `POST …/rollback`) deploys an older version's code and vars. It is recorded as a new version (`action: "rollback"`, `from: <n>`). If the old version used secrets that are not set now, the answer lists them in `missingSecrets`.
- **Download code** on the Versions page, or `GET …/versions/<n>/code`.
- Workers deployed before 0.14.0 show "No stored version — the next deploy will be saved".
- Deploy, redeploy, rollback and delete raise a notification for the team's owners (see [Agent keys and alerts](agent-keys.md)).

## The Worker page (0.15.0)

`/team/workers/<name>` (admins: `/admin/teams/<id>/workers/<name>`) has tabs:

- **Overview**: status, live URL (copy/open), the MCP endpoint when the code serves `/mcp`, the last deploy and who did it, size, SHA-256, var and secret **names**, a health check, and API-key requests in the last 7 days (shown only when the Worker uses Marsa API keys).
- **Versions**: roll back or download any stored version.
- **API keys**: keys for the Worker's users.
- **Settings**: require API keys and limits, edit env vars, set or remove secrets (values are write-only and never shown), disable/enable, delete. Saving vars or secrets redeploys the latest stored code and creates a new version. A Worker disabled by the admin can only be re-enabled by the admin.
- **Activity**: deploys, rollbacks, settings and key changes for this Worker.

The admin view is read-only for code and settings; admins can disable, enable or delete.

## Compatibility flags and service bindings (0.15.0)

Deploys (`PUT …/workers/<name>`, the `deploy_worker` MCP tool) accept these optional fields:

- `compatibilityDate`: `YYYY-MM-DD`, from 2021-11-03 up to today. `null` sets the platform default (`WORKERS_COMPAT_DATE`).
- `compatibilityFlags`: from an allowlist: `global_fetch_strictly_public`, `nodejs_compat`, `nodejs_als`. Anything else returns `400`.
- `bindings`: service bindings to other Workers of the **same team**, `[{"name":"NEWS","worker":"news"}]`. In code, call `env.NEWS.fetch(request)`. `worker` is the short name of one of your team's Workers. Spaces refuses script names, other teams' Workers, non-Spaces scripts, the Worker itself, names that clash with a var or secret, `MARSA_*` names, and any field other than `name`/`worker`.

If you omit a field, the current value is kept. `[]` clears flags or bindings. The settings are stored with each version, so a rollback restores them. `POST …/workers/<name>/runtime` (or `set_worker_runtime`, or the Settings tab) changes only these settings: it redeploys the newest stored code and does not touch the bound Worker. Deleting a Worker that another Worker binds to returns `409 WORKER_BOUND`.

Why this exists: a plain `fetch()` from a Worker to another hostname on the same zone goes to the zone's origin, not to that Worker. A binding makes a direct call. `global_fetch_strictly_public` makes the request go out through the internet instead.

## Type, stack, repo and Space page (0.15.1)

Optional on deploy (`PUT`) or later with `POST /api/teams/<team>/workers/<name>/links` (MCP: `set_worker_links`, UI: the Worker's Settings tab):

```json
{ "meta": { "kind": "mcp", "language": "typescript", "framework": "hono", "toolsCount": 2, "spaceSlug": "<space id>" },
  "repo": { "url": "https://github.com/org/repo", "branch": "main", "commitSha": "<sha>" },
  "spaceId": "<space id>" }
```

Without `meta`, the dashboard guesses from the code and, for MCP servers, probes `/mcp` read-only (`initialize` + `tools/list`, cached for an hour, never `tools/call`). Repos are checked read-only on GitHub and cached for 15 minutes. If the server sets `GITHUB_TOKEN`, it can tell private repos from missing ones; the token is used only server-side. Every Worker declared or detected as MCP is listed on **MCP servers** in the dashboard.

Start from the starter template: `GET /api/recipes/mcp-server-on-worker/starter.zip`. If something fails, leave a note: `POST /api/teams/<team>/notes` (see the *Agent notes* recipe).

## Variables & secrets, health, logs and usage (0.15.2)

- **Variables & secrets** tab: names, kinds, Cloudflare types and status (set / empty / missing) for every
  var, secret and binding, read live from Cloudflare. Values are never shown or returned. Set or rotate one
  secret with `PUT /api/teams/<team>/workers/<name>/secrets/<NAME>` `{"value":"…"}` (write-only, no
  redeploy; agent keys need `workers:secrets` or `workers:deploy`), remove it with `DELETE`. Plain vars:
  `PUT|DELETE …/vars/<NAME>` (redeploys the newest stored code). Declare what the code needs with
  `"requiredEnv": ["API_KEY", …]` on deploy; missing names (declared, or seen as `env.X` in the code) are
  flagged. `GET …/env` returns the same view.
- **Health**: Spaces checks every Worker every 5 minutes (GET of the URL, or MCP `initialize` for MCP
  servers without their own auth). Two failures in a row = down: one notification (bell + webhooks) when it
  goes down and one when it recovers. `GET|POST …/health` (`{"enabled": false}` turns it off,
  `{"check": true}` checks now). The admin sets the interval in Settings.
- **Logs**: `GET …/logs` — error counts by hour and status from Cloudflare analytics, plus Workers Logs
  lines when `POST …/logs {"enabled": true}` turned them on. Secret-like strings are redacted.
- **Usage**: `GET …/usage?range=24h|7d|30d` — requests, errors, median CPU and requests per end-user key.
- The Cloudflare token needs **Account · Account Analytics: Read** for usage/error counts and
  **Account · Workers Observability: Read** for log lines; the admin Settings page checks every permission
  with read-only probes and shows green/red/grey lights.

## MCP tools

When Workers are on for the team, a space's MCP server (see [MCP per space](mcp.md)) also offers `list_workers`, `list_worker_versions` and `get_worker_version` (read-only tokens) and `deploy_worker`, `redeploy_worker`, `rollback_worker` and `delete_worker` (read-write tokens), with the same rules as the API.

## API keys for your Worker's users (0.14.0)

Protect a public MCP server (or any Worker) with per-user keys managed in Spaces. Full walkthrough: the recipe [Protect your MCP with Spaces keys](https://marsa.example.com/docs/recipes/protect-mcp-with-keys).

- Turn on **Require API keys** (Team → Workers → *API keys*, or `PUT /api/teams/<team>/workers/<name>/keys/settings` with `{"required": true, "perMinute": 60, "perDay": 5000}`). Spaces sets two Worker secrets: `MARSA_KEYS_URL` and `MARSA_KEYS_SECRET` (a per-Worker verifier; never shown). They are not listed with your own secrets, and names starting with `MARSA_KEYS_` are reserved.
- Create keys: `POST …/keys` with `{"label","email"?,"expiresInDays"?,"perMinute"?,"perDay"?,"tools"?}`. The key (`msk_…`) is returned once; Spaces keeps a SHA-256 hash and a prefix. `DELETE …/keys/<id>` revokes. `GET …/keys` lists settings, keys and usage (today, 7 days, 429s, last use).
- In the Worker, paste the helper from `/api/keys/helper.v2.js` (versioned URL; the old `/api/keys/helper.js` redirects to it) and call `await requireKey(request, env, { tool })` before any work. It reads `Authorization: Bearer <key>` or `X-Api-Key`, calls `POST /api/keys/verify`, and returns `{ ok, response }` (401 missing/invalid/revoked/expired, 403 tool not allowed, 429 over a limit with `Retry-After`).
- Counting happens in the Spaces server (memory, saved about every 15 s). By default the helper checks every request with Spaces, so limits are exact. Caching is opt-in: `requireKey(request, env, { tool, cache: 30 })` keeps an allow for up to 30 s (never beyond the remaining minute quota) and reports the cached uses on its next check. Each Worker isolate has its own cache and Cloudflare may run several at once, so with caching a key can go over its per-minute limit by up to its remaining quota per isolate (live test at 3/min: 4–5 requests got through before 429s). If Spaces is unreachable the helper fails closed (503) unless you pass `failOpen: true`.
- Owners get a notification when a key is created or revoked and when a Worker's 429s pass 10, 100 and 1000 in a day. Deleting the Worker deletes its keys.
- Scopes: reading needs `workers:read`; settings, create and revoke need `workers:deploy`. MCP tools: `list_user_keys`, `create_user_key`, `revoke_user_key`.

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
