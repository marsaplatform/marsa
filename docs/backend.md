# Optional data & files backend (Appwrite)

Static publishing is all most people need, and it **never requires a backend**. When a page or an
agent also needs to **store a little data** (a counter, form results, a JSON state blob) or
**files** (uploaded images, generated exports), Marsa can proxy those to
[Appwrite](https://appwrite.io), an open-source backend server.

## Do I need to install anything?

| You want to… | You need |
| --- | --- |
| Use someone's Marsa instance | Nothing. Upload in the browser or call the API. |
| Host your own Marsa | Only Marsa: `docker compose up -d --build`. No database, no Appwrite. |
| Give pages/agents KV and files | An Appwrite project, either **Appwrite Cloud** (nothing to install) or a **self-hosted Appwrite**, connected with four env vars. |

With no `APPWRITE_*` variables set, Marsa starts normally, the log says
`data/files backend: off (static publishing only)`, `/api/config` reports `"backend": {"enabled": false}`,
and every backend route answers:

```json
HTTP 503
{ "error": { "code": "BACKEND_NOT_CONFIGURED",
  "message": "This Marsa instance has no data/files backend. Static publishing works; set the APPWRITE_* variables to enable KV and files." } }
```

## Who may use it

Only sites uploaded with the key of a **team** that the admin gave **backend access** (see
[Teams](teams.md)). Guest uploads and sites of other teams get `403 BACKEND_NOT_ALLOWED`. Allowed
sites on an instance without Appwrite get the `503` above. Set `BACKEND_GUEST_ACCESS=true` to let
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
- When the site expires or is deleted, its KV rows and files are **removed from Appwrite**.
- The Appwrite **API key never leaves the server**. Browsers only talk to Marsa.
- Limits: `BACKEND_MAX_VALUE_KB` (64) per value, `BACKEND_MAX_KEYS` (1000) and `BACKEND_MAX_FILES` (100)
  per site, `MAX_FILE_MB` per file; file uploads count toward `UPLOADS_PER_HOUR`; blocked file types
  are rejected like in site uploads; downloads are served with the sandbox CSP.

## Setup

### 1. Get an Appwrite project

- **Appwrite Cloud**: create a free project at [cloud.appwrite.io](https://cloud.appwrite.io). Your endpoint
  is shown in the project settings (for example `https://<region>.cloud.appwrite.io/v1`).
- **Self-hosted**: follow the official
  [self-hosting guide](https://appwrite.io/docs/advanced/self-hosting). Appwrite runs as its own
  multi-container stack, so it isn't bundled into Marsa's compose file; run it next to Marsa and use
  its URL, e.g. `https://appwrite.example.com/v1`.

### 2. Create an API key

In the Appwrite console: **Project → Overview → Integrations → API keys → Create**. Grant only:
`databases.read`, `databases.write`, `tables.read`, `tables.write`, `rows.read`, `rows.write`,
`buckets.read`, `buckets.write`, `files.read`, `files.write`.

### 3. Configure Marsa

In `.env` (placeholders shown):

```bash
APPWRITE_ENDPOINT=https://appwrite.example.com/v1
APPWRITE_PROJECT_ID=your-project-id
APPWRITE_API_KEY=your-server-api-key
APPWRITE_DATABASE_ID=marsa
# optional
APPWRITE_KV_TABLE_ID=marsa_kv
APPWRITE_BUCKET_ID=marsa_files
BACKEND_PUBLIC_READ=true
```

Set all four required values or none: a partial config stops Marsa at startup with a message naming
the missing ones.

### 4. Create the table and bucket

```bash
node --env-file=.env scripts/appwrite-setup.mjs
```

It creates (or keeps, if they exist) the database, a `marsa_kv` table with `siteId`, `key` and `value`
columns plus an index on `siteId`, and a `marsa_files` bucket. Neither has any public permissions:
only the API key can reach them. Restart Marsa; the log should say `data/files backend: appwrite (…)`.

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

## Data layout in Appwrite

- Table `marsa_kv`: one row per (site, key); row id = `k` + 35 hex chars of `sha256(siteId + "\n" + key)`;
  columns `siteId`, `key`, `value` (JSON text).
- Bucket `marsa_files`: file name `<siteId>/<original name>`.

If a cleanup call to Appwrite fails (for example Appwrite is down at expiry time), Marsa logs
`[backend] purge of <id> failed`. Such leftovers can be found by `siteId` / name prefix and removed in
the Appwrite console.
