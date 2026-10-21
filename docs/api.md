# API reference

Base URL: `https://marsa.example.com`. A machine-readable spec is at
[`/openapi.json`](https://marsa.example.com/openapi.json).

All responses are JSON. Errors look like:

```json
{ "error": { "code": "BLOCKED_FILE_TYPE", "message": "file type not allowed: run.sh", "path": "run.sh" } }
```

Authenticated calls use `Authorization: Bearer <token>`: the site's **edit token**, or the
instance's **admin token** for `/api/admin/*`.

## Create a site: `POST /api/sites`

Three body formats. `ttlHours` is optional everywhere (query string or body) and is clamped to the
instance's min/max.

**A ZIP** (best for agents and scripts):

```bash
(cd my-site && zip -qr ../site.zip .)
curl -s -X POST "https://marsa.example.com/api/sites?ttlHours=24" \
  -H "Content-Type: application/zip" --data-binary @site.zip
```

**JSON files** (handy when you generate the HTML in code):

```bash
curl -s -X POST https://marsa.example.com/api/sites \
  -H "Content-Type: application/json" \
  -d '{"ttlHours": 6, "files": [
        {"path": "index.html", "content": "<h1>Hello</h1><img src=\"dot.png\">"},
        {"path": "dot.png", "content": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "encoding": "base64"}
      ]}'
```

**Multipart** (what the browser uploader sends): repeated `files` fields, optional matching `paths`
fields with the relative path of each file, optional `ttlHours`.

```bash
curl -s -X POST https://marsa.example.com/api/sites \
  -F "files=@index.html" -F "paths=index.html" \
  -F "files=@style.css"  -F "paths=css/style.css" \
  -F "ttlHours=72"
```

Response `201`:

```json
{ "id": "k3v9x2mq7a", "url": "https://marsa.example.com/s/k3v9x2mq7a/", "expiresAt": "…",
  "editToken": "marsa_…", "fileCount": 2, "totalBytes": 1234, "createdAt": "…", "updatedAt": "…",
  "files": { "index.html": { "size": 120, "mime": "text/html; charset=utf-8" } } }
```

## Read, update, extend, delete

| Call | Body | Result |
| --- | --- | --- |
| `GET /api/sites/:id` | none | `200` site metadata |
| `PUT /api/sites/:id` | same formats as create | `200`; replaces **all** files, same link, same expiry |
| `PATCH /api/sites/:id` | `{"ttlHours": 24}` | `200`; new expiry = now + ttl, never later than created + max TTL |
| `DELETE /api/sites/:id` | none | `204`; files removed now |

```bash
TOKEN="marsa_…"; ID="k3v9x2mq7a"
curl -s -X PUT    "https://marsa.example.com/api/sites/$ID" -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/zip" --data-binary @site.zip
curl -s -X PATCH  "https://marsa.example.com/api/sites/$ID" -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" -d '{"ttlHours": 48}'
curl -s -X DELETE "https://marsa.example.com/api/sites/$ID" -H "Authorization: Bearer $TOKEN"
```

A wrong token and a missing site both return `404` on purpose, so ids can't be probed.

## Public info

| Call | Result |
| --- | --- |
| `GET /api/config` | Limits of this instance (TTL range, size caps, uploads per hour) |
| `GET /healthz` | `{"ok": true}` |
| `GET /openapi.json` | OpenAPI 3.1 spec |
| `GET /llms.txt` | Plain-text instructions for AI agents |
| `GET /s/:id/...` | The published site |

## Admin (only when `ADMIN_TOKEN` is set)

| Call | Result |
| --- | --- |
| `GET /api/admin/backend/check` | Live check of the KV and file stores (`{enabled, kind, kv:{ok,status?,error?}, files:{…}}`) |
| `GET /api/admin/sites` | All sites with sizes and expiry (no tokens) |
| `DELETE /api/admin/sites/:id` | Remove any site |
| `POST /api/admin/sweep` | Delete expired sites now |
| `GET /api/admin/teams` | Teams with live site counts (no keys) |
| `POST /api/admin/teams` | Create a team `{"name", "backend"?, "directory"?}`; the response has its key, once |
| `PATCH /api/admin/teams/:id` | Change `name`, `backend` or `directory` |
| `POST /api/admin/teams/:id/rotate` | New team key; the old one stops working |
| `GET /api/admin/teams/:id/export` | The team as a zip (members without passwords, activity, spaces and files, data, Workers with code and versions, agent keys without secrets, recipes, notes, notifications) |
| `DELETE /api/admin/teams/:id?confirm=<name or id>` | Move a team to the trash for 7 days (an export is saved, Workers are turned off, keys stop working). `?sites=delete` also deletes its sites when it is purged; `?purge=now` deletes it for good at once |
| `GET /api/admin/trash` | Deleted teams waiting out the grace period |
| `GET /api/admin/trash/:id/export` | The export saved when the team was deleted |
| `POST /api/admin/trash/:id/restore` | Bring the team back (keys, members, Workers) |
| `DELETE /api/admin/trash/:id?confirm=<name or id>` | Delete it for good now |
| `GET /api/admin/backups` | Backup status: last run, last good run, kept backups, next run, last restore test |
| `POST /api/admin/backups/run` | Take a backup now (encrypted, uploaded, read back and checked) |
| `POST /api/admin/backups/test-restore` | Restore the newest backup into a scratch folder, check it, delete the folder |
| `POST /api/admin/sessions/end-all` | End every admin session (they survive restarts otherwise) |

If `ADMIN_TOKEN` is empty, these routes answer `404`. The browser console for teams is at `/admin`;
see [Teams](teams.md).

## Teams and the directory

- Upload with `X-Team-Key: <team key>` (or `Authorization: Bearer <team key>`) on `POST /api/sites`
  to attach the site to a team. A wrong key answers `401 INVALID_TEAM_KEY`.
- `GET /api/directory`: public JSON of live sites of listed teams, grouped by team (cached 30 s).
- An [agent key](agent-keys.md) (`marsa_agent_…`, 0.14.0) works wherever the team key does, limited
  to its scopes: `spaces:write` to publish/replace/extend/delete the team's sites, `spaces:read` for
  `GET /api/sites/:id` and `GET /api/teams/:team/sites`, `kv:read`/`kv:write` for the team's KV and
  files. Outside its scopes: `403 INSUFFICIENT_SCOPE`.
- `GET /api/teams/:team/sites` (team key or `spaces:read`): the team's live sites.
- Agent keys, invite links, notifications and webhooks: see [Agent keys and alerts](agent-keys.md).

## Error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `EMPTY_UPLOAD` | 400 | No usable files after dropping dotfiles |
| `INVALID_REQUEST` | 400 | Unsupported content type or malformed body |
| `INVALID_PATH` / `ZIP_SLIP_REJECTED` | 400 | Absolute path or `..` in a file path |
| `INVALID_ZIP` | 400 | The archive can't be read |
| `INVALID_ENCODING` | 400 | `encoding` isn't `utf8` or `base64` |
| `FILE_TOO_LARGE` / `SITE_TOO_LARGE` / `TOO_MANY_FILES` / `ZIP_BOMB_REJECTED` | 413 | A size or count cap was hit |
| `BLOCKED_FILE_TYPE` | 415 | Server script or executable in the upload |
| `NOT_FOUND` | 404 | Unknown site, wrong token, or admin disabled |
| `EXPIRED` | 410 | The link has expired |
| `UNAUTHORIZED` | 401 | Wrong admin token |
| `INVALID_TEAM_KEY` | 401 | Unknown or rotated team key on upload |
| `BACKEND_NOT_ALLOWED` | 403 | The site isn't in a team with backend access |
| `BACKEND_NOT_CONFIGURED` | 503 | Allowed, but the instance has no data/files backend configured |
| `BACKEND_UNAVAILABLE` | 503 | The data/files store failed (e.g. its credentials were rejected); retry later (`Retry-After`) or tell the admin |
| `INSUFFICIENT_SCOPE` | 403 | An agent key without the scope this call needs |
| `TEAM_KEY_REQUIRED` | 403 | The call needs the team key itself (activity, export, webhook); agent keys can't use it |
| `RATE_LIMITED` | 429 | Slow down; see the `Retry-After` header |

## Recipes and Worker API keys (0.14.0)

- `GET /api/recipes?lang=en|ar`: built-in and platform recipes (plus your team's with a team/agent key). `GET /api/recipes/<slug>?lang=ar&format=md`: one recipe as markdown (JSON without `format=md`).
- `PUT|DELETE /api/teams/<team>/recipes/<slug>`: team recipes (team key, or an agent key with `spaces:write`). Body: `{"title_en","title_ar","summary_en","summary_ar","body_en","body_ar","tags"}`.
- `GET|POST /api/teams/<team>/workers/<name>/keys`, `PUT …/keys/settings`, `DELETE …/keys/<id>`: end-user API keys for a Worker (see [Workers](workers.md)).
- `POST /api/keys/verify` (Bearer = the Worker's `MARSA_KEYS_SECRET`) and `GET /api/keys/helper.v2.js` (`/api/keys/helper.js` redirects there): used by the Worker.

## Activity and team export (0.16.0)

- `GET /api/teams/<team>/activity` (team key only; agent keys get `403 TEAM_KEY_REQUIRED`): the team's activity log, newest first, as `{entries, count}`. Filters: `since` / `until` (ISO time or epoch ms), `action` (exact, or a prefix ending in `-`, e.g. `worker-`), `site`, `limit` (default 500, max 5000). `format=csv` or `format=jsonl` downloads the same rows.
- `GET /api/admin/activity?team=<id>|platform` (admin): one team's log, the platform log, or every log without `team`. Same filters and formats; rows carry `team` (the team name).
- `GET /api/teams/<team>/export` (team key only): a zip with the team's sites and files, Workers and versions, KV and uploads, members, agent keys, recipes, notes, notifications and the activity log. No key, token or secret value is included. The admin's `GET /api/admin/teams/<id>/export` returns the same zip.

```bash
curl -s "https://marsa.example.com/api/teams/sanad/activity?action=worker-&format=csv" \
  -H "X-Team-Key: $MARSA_TEAM_KEY" -o activity.csv
```

## Everything else

The full list of routes, including the admin API, webhooks, notifications, Worker operations
(`…/env`, `…/secrets/<NAME>`, `…/health`, `…/logs`, `…/usage`, `…/versions/<n>`) and agent keys, is in
[`/openapi.json`](https://marsa.example.com/openapi.json). A test keeps it in sync with the server.
