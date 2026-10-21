# Self-hosting

Marsa is one Node.js process and one data folder. No database, no external services.

## One command

```bash
docker compose up -d --build
```

Open `http://localhost:8080`. Sites are stored in the `marsa-data` Docker volume.

Without compose:

```bash
docker build -t marsa . && docker run -d --name marsa -p 8080:8080 -v marsa-data:/data marsa
```

Without Docker (Node.js 20+):

```bash
npm ci && npm run build && npm start
```

## Configuration

Every setting is an environment variable with a safe default. Copy
[`.env.example`](../.env.example) to `.env` (compose and `npm run dev` read it).

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Listen address |
| `PUBLIC_URL` | `http://localhost:$PORT` | Base URL used in share links, docs and `/llms.txt` |
| `DATA_DIR` | `./data` (`/data` in Docker) | Where sites are stored |
| `DEFAULT_TTL_HOURS` | `24` | Lifetime when the uploader doesn't choose |
| `MIN_TTL_HOURS` / `MAX_TTL_HOURS` | `1` / `168` | Allowed lifetime range; a link never outlives created + max |
| `SWEEP_INTERVAL_SECONDS` | `60` | How often expired sites are deleted |
| `MAX_FILE_MB` / `MAX_SITE_MB` / `MAX_FILES` | `10` / `25` / `500` | Size and count caps |
| `UPLOADS_PER_HOUR` | `20` | Creates + updates per client IP per hour |
| `API_REQUESTS_PER_MINUTE` | `120` | Any `/api` request per client IP per minute |
| `TRUST_PROXY` | `false` | Read the client IP from `X-Real-IP` / the last `X-Forwarded-For` hop |
| `ADMIN_TOKEN` | empty (admin off) | Bearer token for `/api/admin/*` and the admin sign-in, at least 24 characters |
| `SESSION_SECRET` | random per start | HMAC key for sign-in cookies and CSRF tokens, at least 32 characters |
| `SESSION_TTL_HOURS` / `ADMIN_SESSION_TTL_HOURS` | `168` / `12` | Team / admin session lifetime |
| `LOGIN_ATTEMPTS_PER_15_MIN` | `10` | Sign-in attempts per client IP per 15 minutes |
| `TEAM_MAX_SITES` | `50` | Default quota: live sites per team (admin can override per team) |
| `TEAM_MAX_MB` | `200` | Default quota: MB across a team's live sites (admin can override per team) |
| `OPERATOR_NAME` / `OPERATOR_ADDRESS` / `OPERATOR_LAW` / `OPERATOR_EMAIL` | marsaplatform / Bologna, Italy / Italy / info@marsaplatform.com | Data controller shown in the privacy policy (`/privacy`). **Set these when you self-host.** |
| `OPERATOR_AUTHORITY` / `OPERATOR_AUTHORITY_URL` | Italian Garante / https://www.garanteprivacy.it | Supervisory authority named in the privacy policy |
| `OPERATOR_CLOUDFLARE_DPA` | empty (a marked placeholder) | The Cloudflare data processing agreement named in the privacy policy (a URL or reference) |
| `VISITS` | `true` | Count page views per site per day, privately (see [Teams](teams.md#visit-counts)) |
| `VISITS_RETENTION_DAYS` | `90` | Days of visit counts kept (minimum 31) |
| `VISITS_FLUSH_SECONDS` | `60` | How often buffered counts are written to disk |
| `MCP_REQUESTS_PER_MINUTE` | `60` | MCP requests per space token per minute (see [MCP](mcp.md)) |
| `MCP_WRITES_PER_HOUR` | `60` | MCP write tool calls per token per hour |
| `MCP_KV_WRITES_PER_DAY` | `500` | MCP `kv_put`/`kv_delete` calls per day, instance-wide (KV free plan: 1000/day) |
| `FEATURED_SITES` | empty | Site ids for the home page's Featured card, comma-separated (first live one). Empty = newest listed page |

Generate an admin token and a session secret with `openssl rand -hex 32`. Without `SESSION_SECRET`
everyone is signed out whenever the container restarts. Serve the app over HTTPS: session cookies are
then `Secure` and use the `__Host-` prefix. Set `TRUST_PROXY=true` behind your reverse proxy so the
sign-in rate limit sees real client IPs.

Nothing else is required. The optional [data & files backend](backend.md) adds `CLOUDFLARE_*`, `R2_*` and
`BACKEND_*` variables; leave them empty and Marsa runs as a pure static host
(the backend routes answer `503 BACKEND_NOT_CONFIGURED`).

## Behind a reverse proxy

Terminate HTTPS at your proxy, forward to port 8080, and set:

```bash
PUBLIC_URL=https://marsa.example.com
TRUST_PROXY=true
```

Caddy example:

```text
marsa.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

Set your proxy's request body limit at least as high as `MAX_SITE_MB` × 1.4.

## Running a public instance

- Uploaded pages are served under `/s/<id>/` with a `sandbox` Content-Security-Policy, so they get
  an opaque origin and can't touch the app. Giving Marsa its own domain adds another layer.
- Rate limits live in memory in one process. Run a single instance, or add limits at the proxy.
- Keep `MAX_TTL_HOURS` short and caps small; that's what keeps abuse cheap to handle.
- With `ADMIN_TOKEN` set you can list and remove any site:

```bash
curl -s https://marsa.example.com/api/admin/sites -H "Authorization: Bearer $ADMIN_TOKEN"
curl -s -X DELETE https://marsa.example.com/api/admin/sites/k3v9x2mq7a -H "Authorization: Bearer $ADMIN_TOKEN"
```

- Sign in at `/admin/login` with the same token to manage **teams** (team keys, backend access per
  team, which teams appear in the public directory on the homepage) and to see or delete **all live
  sites**. Team members sign in at `/login` with their team key. See [Teams](teams.md).

## Backups and upgrades

All state is in `DATA_DIR` (`sites/<id>/meta.json` plus `sites/<id>/files/`, `teams.json` and the other JSON
files). To upgrade, pull the new code and rebuild the container; the data format is versionless JSON.

### Daily encrypted backups (0.16.0)

Once a day (at `BACKUP_HOUR_UTC`) Spaces packs the whole data folder, compresses it, encrypts it with
AES-256-GCM and uploads it. With the Cloudflare backend configured it goes to the same R2 bucket under
`_marsa-backups/` (off the server); otherwise to `BACKUP_DIR` if set. Every backup is downloaded again and
checked (hash of every file). Retention: the newest backup of each of the last 14 days plus one per week for
8 weeks. A failure raises a bell notification for the admin (and the platform webhook). Status, "Back up now",
"Test a restore" and these steps are on **Admin › Settings › Backups**.

The key is derived (HKDF-SHA256) from `BACKUP_KEY`, or from `MARSA_SECRETS_KEY` when no separate key is
set. It is never stored with the backups: **keep it somewhere else**, a backup cannot be opened without it.

Restore (always into a new, empty folder; the live data is never overwritten):

```bash
docker compose exec marsa node dist/backup-cli.js list
docker compose exec marsa node dist/backup-cli.js verify            # newest, or give a key
docker compose exec marsa node dist/backup-cli.js restore _marsa-backups/2026-10/marsa-<time>.msb /data/tmp/restore
docker compose stop marsa
mv /var/lib/marsa-data/tmp/restore /var/lib/marsa-data.restored
mv /var/lib/marsa-data /var/lib/marsa-data.old && mv /var/lib/marsa-data.restored /var/lib/marsa-data
docker compose start marsa
```

(Replace `marsa` with your compose service name and `/var/lib/marsa-data` with the host folder of `/data`.)

| Variable | Default | Meaning |
| --- | --- | --- |
| `BACKUPS` | `true` | Daily backups on/off |
| `BACKUP_KEY` | `MARSA_SECRETS_KEY` | Secret the backup key is derived from (at least 32 characters) |
| `BACKUP_DIR` | empty | Local folder for backups when there is no R2 backend (not off-site) |
| `BACKUP_HOUR_UTC` | `1` | Hour of the daily run |
| `BACKUP_KEEP_DAILY` / `BACKUP_KEEP_WEEKLY` | `14` / `8` | Retention |
| `BACKUP_MAX_MB` | `2048` | Refuse to back up more than this |

### Deleting a team (0.16.0)

Deleting a team needs its name typed again. It first saves an export (zip), turns its Workers off, and moves the
team to **Deleted teams** for 7 days: its keys, sessions and agent keys stop working and its spaces leave the
directory. Restore brings everything back. After 7 days it is deleted for good (Workers, data, and its spaces if
you asked); the export is kept 30 more days in `DATA_DIR/trash/`.

### Sessions

Sign-outs are stored in `DATA_DIR/sessions.json`, so a signed-out cookie stays dead after a restart.
**Sign out everywhere** (admin Settings, or a team owner's Settings) ends every session of that scope.
