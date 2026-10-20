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
| `ADMIN_TOKEN` | empty (admin off) | Bearer token for `/api/admin/*`, at least 24 characters |

Generate an admin token with `openssl rand -hex 32`.

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

- Open `/admin` with the same token to manage **teams**: team keys, backend access per team, and
  which teams appear in the public directory on the homepage. See [Teams](teams.md).

## Backups and upgrades

All state is in `DATA_DIR` (`sites/<id>/meta.json` plus `sites/<id>/files/`, and `teams.json`). Back it up as plain
files. To upgrade, pull the new code and rebuild the container; the data format is versionless JSON.
