# Optional data & files backend (Cloudflare)

Static publishing is all most people need, and it **never requires a backend**. When a page or an
agent also needs to **store a little data** (a counter, form results, a JSON state blob) or
**files** (uploaded images, generated exports), Marsa can proxy those to
[Cloudflare](https://www.cloudflare.com): values go to **Workers KV**, files to **R2**. Marsa talks to
Cloudflare's public HTTP APIs straight from Node; no Worker to deploy, nothing to install.

## Do I need to install anything?

| You want to… | You need |
| --- | --- |
| Use someone's Marsa instance | Nothing. Upload in the browser or call the API. |
| Host your own Marsa | Only Marsa: `docker compose up -d --build`. No database, no Cloudflare account. |
| Give pages/agents KV and files | A Cloudflare account (the free plan works) with one KV namespace and one R2 bucket, connected with five env vars. |

With no `CLOUDFLARE_*` / `R2_*` variables set, Marsa starts normally, the log says
`data/files backend: off (static publishing only)`, `/api/config` reports `"backend": {"enabled": false}`,
and every backend route answers:

```json
HTTP 503
{ "error": { "code": "BACKEND_NOT_CONFIGURED",
  "message": "This Marsa instance has no data/files backend. Static publishing works; set the CLOUDFLARE_* and R2_* variables to enable KV and files." } }
```

## Who may use it

Only sites uploaded with the key of a **team** that the admin gave **backend access** (see
[Teams](teams.md)). Guest uploads and sites of other teams get `403 BACKEND_NOT_ALLOWED`. Allowed
sites on an instance without the backend configured get the `503` above. Set `BACKEND_GUEST_ACCESS=true` to let
every site use the backend, as in 0.3.

## What it adds

Per site, scoped to its id and deleted together with it:

- **KV**: JSON values under short keys (`GET/PUT/DELETE /api/sites/:id/kv/:key`, `GET /api/sites/:id/kv`).
- **Files**: upload, list, download, delete (`/api/sites/:id/files`, `/api/sites/:id/files/:fileId`).
- **A browser SDK** at `/sdk.js` with `marsa.kv.*` and `marsa.files.*`.

Rules:

- **Writes always need the site's edit token** (`Authorization: Bearer …`).
- **Reads are public** while the site is live (`BACKEND_PUBLIC_READ=true`, the default): the data is as
  public as the page. Set `BACKEND_PUBLIC_READ=false` to require the token for reads too.
- When the site expires or is deleted, its KV entries and files are **removed from Cloudflare**.
- The Cloudflare **API token and R2 keys never leave the server**. Browsers only talk to Marsa.
- Limits: `BACKEND_MAX_VALUE_KB` (64) per value, `BACKEND_MAX_KEYS` (1000) and `BACKEND_MAX_FILES` (100)
  per site, `MAX_FILE_MB` per file; file uploads count toward `UPLOADS_PER_HOUR`; blocked file types
  are rejected like in site uploads; downloads are served with the sandbox CSP.

## Setup

### 1. Create a Cloudflare API token

Cloudflare dashboard → **Manage account → Account API tokens → Create token → Custom token** (a user
API token works too). Permissions, all **Account** scope, limited to your account:

| Permission | Why |
| --- | --- |
| `Workers KV Storage: Edit` | read/write/list/delete KV values; create the namespace |
| `Workers R2 Storage: Edit` | create the bucket; the S3 keys derived from this token read/write objects |

Note your **Account ID** (dashboard → Workers & Pages → right sidebar, or any zone's overview page).

### 2. Create the KV namespace and the R2 bucket

```bash
CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… node scripts/cloudflare-setup.mjs --write-env .env
```

The script is idempotent: it verifies the token, then creates (or reuses, matched by name) a KV namespace
titled `marsa-kv` and an R2 bucket `marsa-files` (override with `CLOUDFLARE_KV_TITLE` / `R2_BUCKET`). It
never touches other namespaces or buckets. It prints the namespace id, the bucket and the R2 access key
id. Secrets are never printed; `--write-env FILE` writes them into that file (mode 600) instead.

**R2 S3 credentials.** R2 objects are read and written through R2's S3-compatible API, which signs
requests with an access key pair. Cloudflare documents that any API token with R2 permissions doubles
as one: **Access Key ID = the token's id**, **Secret Access Key = the SHA-256 hex digest of the token
value** ([R2 docs: Get S3 API credentials from an API token](https://developers.cloudflare.com/r2/api/tokens/#get-s3-api-credentials-from-an-api-token)).
The setup script derives both for you. If you prefer a separate, bucket-scoped key, create one under
**R2 → Manage API tokens** (permission *Object Read & Write*, limited to the bucket) and use its
Access Key ID / Secret Access Key instead.

### 3. Configure Marsa

In `.env` (placeholders shown):

```bash
CLOUDFLARE_ACCOUNT_ID=0123456789abcdef0123456789abcdef
CLOUDFLARE_API_TOKEN=your-api-token
CLOUDFLARE_KV_NAMESPACE_ID=your-kv-namespace-id
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
# optional
R2_BUCKET=marsa-files
# R2_ENDPOINT=https://<account>.eu.r2.cloudflarestorage.com   # only for EU/FedRAMP jurisdiction buckets
BACKEND_PUBLIC_READ=true
```

Set all five required values or none: a partial config stops Marsa at startup with a message naming
the missing ones. Restart Marsa; the log should say
`data/files backend: cloudflare (KV namespace …, R2 bucket …)`.

## Using it

### From an agent or script (writes)

```bash
BASE=https://marsa.example.com; ID=k3v9x2mq7a; TOKEN="marsa_…"

curl -s -X PUT "$BASE/api/sites/$ID/kv/notes" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"value": ["Buy milk", "Ship the demo"]}'

curl -s -X POST "$BASE/api/sites/$ID/files" -H "Authorization: Bearer $TOKEN" -F "file=@chart.png"
```

### From the published page (reads)

```html
<script src="/sdk.js"></script>
<ul id="notes"></ul>
<script>
  marsa.kv.get("notes").then((notes = []) => {
    for (const n of notes) document.getElementById("notes").append(Object.assign(document.createElement("li"), { textContent: n }));
  });
  marsa.files.list().then((files) => console.log(files.map((f) => marsa.files.url(f.id))));
</script>
```

SDK reference:

| Call | Does |
| --- | --- |
| `marsa.kv.get(key)` | Value, or `undefined` if missing |
| `marsa.kv.list()` | All keys |
| `marsa.kv.set(key, value)` / `marsa.kv.delete(key)` | Needs `marsa.auth(token)` first |
| `marsa.files.list()` | `[{ id, name, size, mime, createdAt, url }]` |
| `marsa.files.url(id)` | Download URL |
| `marsa.files.upload(file, name?)` / `marsa.files.delete(id)` | Needs `marsa.auth(token)` |
| `marsa.auth(token)` | Use an edit token for writes |

**Never put an edit token in a published page**: anyone can read the source. Writes are for agents,
scripts and the owner (for example a private admin page you open locally that calls `marsa.auth()`
with a token you paste in).

Errors are thrown as `MarsaError` with `.code` (`BACKEND_NOT_CONFIGURED`, `NOT_FOUND`, `EXPIRED`,
`INVALID_KEY`, `VALUE_TOO_LARGE`, `TOO_MANY_KEYS`, `TOO_MANY_FILES`, `BLOCKED_FILE_TYPE`, `RATE_LIMITED`).

A sample page is in [`examples/backend-notes`](../examples/backend-notes).

## API

| Call | Auth | Result |
| --- | --- | --- |
| `GET /api/sites/:id/kv` | public* | `{ "keys": [...] }` |
| `GET /api/sites/:id/kv/:key` | public* | `{ "key", "value" }` or `404 KEY_NOT_FOUND` |
| `PUT /api/sites/:id/kv/:key` | edit token | body `{ "value": <any JSON> }` |
| `DELETE /api/sites/:id/kv/:key` | edit token | `204` |
| `GET /api/sites/:id/files` | public* | `{ "files": [...] }` |
| `POST /api/sites/:id/files` | edit token | multipart field `file` (optional `name`), or a raw body with `?name=` |
| `GET /api/sites/:id/files/:fileId` | public* | the file |
| `DELETE /api/sites/:id/files/:fileId` | edit token | `204` |

\* the edit token is required when `BACKEND_PUBLIC_READ=false`. Keys are 1–128 characters of
`A-Z a-z 0-9 . _ : -`.

## Data layout in Cloudflare

- **Workers KV** namespace: one entry per (site, key), named `<siteId>/<key>`, value = the JSON text.
  Listing a site's keys is a prefix list on `<siteId>/`.
- **R2** bucket: one object per file, named `<siteId>/<fileId>/<percent-encoded original name>`, stored
  with its content type. The file id (`f` + base36 time + 16 hex chars) keeps uploads with the same name
  apart and makes listings come back in upload order.
- Deleting or expiring a site removes every `<siteId>/` KV entry (bulk delete) and R2 object.

### Things to know about Cloudflare

- Calls to Workers KV go through the Cloudflare REST API, which is rate limited to
  **1,200 requests per 5 minutes** per token ([Cloudflare API limits](https://developers.cloudflare.com/fundamentals/api/reference/limits/)).
  Each KV read or write from a page costs one or two of those. R2 (S3 API) is not under that limit.
- Workers KV accepts **one write per second to the same key**; Marsa retries a rate-limited (429) or
  failed (5xx) call twice with a short back-off before giving up.
- KV is **eventually consistent**. Reads and writes through the REST API are normally immediate, but a
  list, or a read right after a bulk delete, can lag for up to about a minute. `BACKEND_MAX_KEYS` is
  therefore a soft limit.
- The free plan includes 100,000 KV reads and 1,000 KV writes per day, and 10 GB of R2 storage
  ([KV limits](https://developers.cloudflare.com/kv/platform/limits/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/)).

If a cleanup call to Cloudflare fails (for example Cloudflare is unreachable at expiry time), Marsa logs
`[backend] purge of <id> failed`. Such leftovers can be found by the `<siteId>/` prefix and removed in
the Cloudflare dashboard (KV namespace → entries, R2 bucket → objects).
