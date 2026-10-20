# Marsa

**Marsa is the harbor where your AI agent's work lands.**
Turn any static page, HTML report or prototype into a shareable link in seconds, with no account.

*Marsa* (مَرسى) is Arabic for "harbor". Upload a folder, some files or a `.zip` from the browser,
`curl`, an AI agent or CI. You get back a public link that **expires on its own** and a private
**edit token** to update, extend or delete it. It's one Node.js process and one data folder, with no
database, and it's MIT licensed.

> [العربية ↓](#بالعربي)

## Why Marsa

- **Agents produce HTML, people need links.** Reports, dashboards and prototypes are easier to review
  in a browser than as a code block. One HTTP call turns them into a URL.
- **No account wall.** Whoever gets the link can open it, and whoever uploads doesn't have to sign up.
  The edit token is the only credential.
- **Nothing lingers.** Every link has an expiry (1 hour to 7 days by default). Expired sites are deleted
  from disk by a background sweeper.
- **Small enough to own.** Self-host it in one command, read the whole codebase in an afternoon, and
  build on it.

## Do I need to install anything?

| You want to… | You need |
| --- | --- |
| Use a Marsa instance someone runs | **Nothing.** Upload in the browser or call the API. |
| Host your own Marsa | **Only Marsa**, one Docker command (below). No database, no other services. All publishing features work without anything else. |
| Give pages and agents data/file storage | The **optional** backend: an [Appwrite](https://appwrite.io) project, either **Appwrite Cloud** (nothing to install) or **self-hosted Appwrite**, connected with env vars. Off by default. |

Without any `APPWRITE_*` variables, Marsa starts normally and the backend routes answer
`503 BACKEND_NOT_CONFIGURED`.

## Features

- **Upload from the browser** by dragging files, a folder or a ZIP onto the page at `/` or `/new`.
- **Deploy API** at `POST /api/sites`, accepting a ZIP, multipart files or JSON `files[]`. The response
  includes `url`, `expiresAt`, `id` and `editToken`.
- **Expiring links** with a configurable TTL (default 24h, max 7d). A link never outlives created + max.
- **Token management**: replace the files (`PUT`), change the expiry (`PATCH`) or delete (`DELETE`).
  Only a SHA-256 of the token is stored.
- **Made for agents**: `/llms.txt` (instructions with this instance's URL and limits), `/openapi.json`
  (OpenAPI 3.1), a ready-made prompt and deploy scripts.
- **Abuse limits**: per-file, per-site and file-count caps, per-IP rate limits, blocked server-side and
  executable types, zip-slip and zip-bomb guards, and dotfiles are stripped.
- **Sandboxed serving**: uploaded pages get a `sandbox` CSP (opaque origin), `nosniff`, `noindex`
  and `frame-ancestors 'none'`.
- **Bilingual UI and docs**: English and Arabic (RTL), server-rendered. The guide is at `/docs` and `/ar/docs`.
- **Optional admin API** behind `ADMIN_TOKEN`: list and delete any site, and run the sweeper.
- **Optional data/files backend** (Appwrite): per-site KV and files, a browser SDK at `/sdk.js`, and
  automatic cleanup when a site goes away.

## Who it's for

- **Agent builders**: give your agent one call that returns a link instead of pasting HTML into chat.
- **Developers showing clients**: send a clickable prototype without hosting setup or client accounts.
- **CI previews**: post a preview link of every pull request's static build, which expires by itself.
- **Teachers and students**: students hand in HTML/CSS assignments as links, and teachers review them in a browser.
- **Temporary event pages**: a schedule and RSVP page for a meetup that's gone next week.

Fictional sample sites for each case are in [`examples/`](examples).

## Quick start

With Docker (from a clone of this repo):

```bash
docker compose up -d --build          # http://localhost:8080, data in the "marsa-data" volume
```

or without compose: `docker build -t marsa . && docker run -d -p 8080:8080 -v marsa-data:/data marsa`

With Node.js 20+:

```bash
npm install
npm run dev                           # http://localhost:8080, reloads on change
# production: npm run build && npm start
```

## Usage

### Browser

Open the home page, drop files (or a folder or a `.zip`), pick an expiry and copy the link. The
browser remembers your uploads and their tokens under **Your drops in this browser**, so you can
delete them later. See [Getting started](docs/getting-started.md).

### API

```bash
(cd my-site && zip -qr ../site.zip .)
curl -s -X POST "http://localhost:8080/api/sites?ttlHours=24" \
  -H "Content-Type: application/zip" --data-binary @site.zip
# {"id":"k3v9x2mq7a","url":"http://localhost:8080/s/k3v9x2mq7a/","expiresAt":"…","editToken":"marsa_…",…}

curl -s -X POST http://localhost:8080/api/sites -H "Content-Type: application/json" \
  -d '{"ttlHours": 6, "files": [{"path": "index.html", "content": "<h1>Hello</h1>"}]}'
```

The full reference with error codes is in [docs/api.md](docs/api.md), and the machine-readable spec is at `/openapi.json`.

### AI agents

Point the agent at `https://<your-instance>/llms.txt`, or paste the prompt from
[`examples/agent/prompt.md`](examples/agent/prompt.md). In code:

```js
const res = await fetch("http://localhost:8080/api/sites", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ttlHours: 24, files: [{ path: "index.html", content: html }] }),
});
const { url, expiresAt, id, editToken } = await res.json();
```

Shell, Node.js and Python deploy scripts are in [`examples/agent/`](examples/agent). More details
are in [docs/agents.md](docs/agents.md).

### Managing with the token

```bash
curl -s -X PUT    "$BASE/api/sites/$ID" -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/zip" --data-binary @site.zip                         # replace files
curl -s -X PATCH  "$BASE/api/sites/$ID" -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" -d '{"ttlHours": 48}'                           # change expiry
curl -s -X DELETE "$BASE/api/sites/$ID" -H "Authorization: Bearer $TOKEN"                # delete now
```

A wrong token and a missing site both return `404`. See [docs/managing.md](docs/managing.md).

## Optional data & files backend (Appwrite)

For pages and agents that need to store a little state (KV) or files, Marsa can proxy per-site
storage to Appwrite. Here's what it adds:

- `GET/PUT/DELETE /api/sites/:id/kv/:key`, plus `GET /api/sites/:id/kv` to list keys
- `POST/GET /api/sites/:id/files` and `GET/DELETE /api/sites/:id/files/:fileId`
- `/sdk.js` for pages: `marsa.kv.get(key)`, `marsa.files.list()`, and writes after `marsa.auth(token)`
- Writes always need the edit token. Reads are public while the site is live (`BACKEND_PUBLIC_READ=true`).
- Data is purged from Appwrite when the site expires or is deleted. The Appwrite API key never reaches browsers.

Setup (placeholders):

```bash
APPWRITE_ENDPOINT=https://appwrite.example.com/v1   # or your Appwrite Cloud endpoint
APPWRITE_PROJECT_ID=your-project-id
APPWRITE_API_KEY=your-server-api-key
APPWRITE_DATABASE_ID=marsa
```

```bash
node --env-file=.env scripts/appwrite-setup.mjs     # creates the table, columns, index and bucket
```

You must set all four required values or none; a partial config stops startup with a message. The full
guide is in [docs/backend.md](docs/backend.md).

## Configuration

All settings are environment variables, and all are optional. See [`.env.example`](.env.example).

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Listen address |
| `PUBLIC_URL` | `http://localhost:$PORT` | Base for share links, docs and `/llms.txt` |
| `DATA_DIR` | `./data` (`/data` in Docker) | Where sites are stored |
| `DEFAULT_TTL_HOURS` / `MIN_TTL_HOURS` / `MAX_TTL_HOURS` | `24` / `1` / `168` | Link lifetime |
| `SWEEP_INTERVAL_SECONDS` | `60` | How often expired sites are deleted |
| `MAX_FILE_MB` / `MAX_SITE_MB` / `MAX_FILES` | `10` / `25` / `500` | Size and count caps |
| `UPLOADS_PER_HOUR` | `20` | Creates, updates and backend file uploads per IP per hour |
| `API_REQUESTS_PER_MINUTE` | `120` | Any `/api` request per IP per minute |
| `TRUST_PROXY` | `false` | Use `X-Real-IP` / the last `X-Forwarded-For` hop as the client IP |
| `ADMIN_TOKEN` | empty (off) | Enables `/api/admin/*` (min. 24 chars) |
| `APPWRITE_ENDPOINT` / `APPWRITE_PROJECT_ID` / `APPWRITE_API_KEY` / `APPWRITE_DATABASE_ID` | empty (off) | Optional backend; set all four or none |
| `APPWRITE_KV_TABLE_ID` / `APPWRITE_BUCKET_ID` | `marsa_kv` / `marsa_files` | Backend table and bucket |
| `BACKEND_PUBLIC_READ` | `true` | Public reads of a live site's KV and files |
| `BACKEND_MAX_VALUE_KB` / `BACKEND_MAX_KEYS` / `BACKEND_MAX_FILES` | `64` / `1000` / `100` | Backend caps per site |

## Security and limits

- **Everything uploaded is public to anyone with the link.** Site ids are random but aren't passwords.
- Uploaded pages are served under `/s/<id>/` with `Content-Security-Policy: sandbox …`. They run with
  an opaque origin, so they can't read the app's storage or the uploader's tokens, and can't call the
  API as the visitor. App pages use a strict CSP with no inline code.
- Uploads are validated before anything is written: declared ZIP sizes are checked before inflating,
  along with path traversal, blocked types (`.php`, `.py`, `.sh`, `.exe`, …), dotfiles and the caps above.
- Edit tokens are 256-bit random values. Only their SHA-256 is stored, and comparisons are constant-time.
- Client IPs are used only as in-memory rate-limit keys and are never stored or logged.
- Rate limits are per process. Run a single instance, or add limits at your proxy.
- See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## Architecture

```
          browser / curl / AI agent / CI
                       │ HTTP
┌──────────────────────▼───────────────────────────────────┐
│ Hono app (src/app.ts)                                    │
│  pages  /, /ar, /new, /docs     ui.ts, i18n.ts, docs.ts  │
│  agent  /llms.txt, /openapi.json, /sdk.js                │
│  api    /api/sites…  rate-limit.ts, tokens.ts            │
│           └ ingest.ts → paths.ts, mime.ts, caps          │
│  serve  /s/<id>/*    sandbox CSP (security.ts)           │
│  opt.   /api/sites/:id/kv|files  backend/routes.ts       │
└──────────┬──────────────────────────────┬────────────────┘
           │ store.ts (staged + rename)   │ backend/appwrite.ts (node-appwrite)
   DATA_DIR/sites/<id>/meta.json          ▼
   DATA_DIR/sites/<id>/files/…      Appwrite: marsa_kv table, marsa_files bucket
           ▲
  index.ts + sweep.ts: delete expired sites (and their backend data) every minute
```

- Each site is a folder with a `meta.json` (expiry, file list, token hash). Writes are staged in
  `DATA_DIR/tmp` and swapped in with `rename()`.
- UI strings live in `src/i18n.ts`, and pages are rendered per language on the server.
- The backend is an interface (`src/backend/types.ts`) with an Appwrite implementation. Tests use an
  in-memory one and a mocked node-appwrite client.

```
src/       app index config brand ui assets i18n docs llms openapi sdk sweep
           ingest paths mime store tokens rate-limit security client-ip errors
src/backend/  types appwrite routes
docs/      guides served at /docs        examples/  sample sites, CI workflow, agent scripts
test/      vitest suites                 scripts/   smoke.mjs, appwrite-setup.mjs, rename.mjs
```

## Contributing

```bash
npm install
npm run lint && npm run typecheck && npm test
npm run build && (npm start &) && npm run smoke
```

Keep it small: one process, no required services. UI text must be in English and Arabic. See
[CONTRIBUTING.md](CONTRIBUTING.md), the [CHANGELOG](CHANGELOG.md) and the issue/PR templates.

## License and why open source

[MIT](LICENSE). Marsa is derived from [canvas-drop](https://github.com/markpasternak/canvas-drop) (MIT);
see [NOTICE](NOTICE).

Marsa is open source because a place to drop work should be one you control:

- **Self-host** it next to your agents, on your own domain, with your own limits.
- **Own your data.** Uploads live in a folder on your server (plus your Appwrite project if you enable
  the backend), and they're deleted when they expire.
- **Build on it.** It's small, typed and tested. Fork it, embed it in your agent platform, or add
  storage drivers.

---

<div dir="rtl">

## بالعربي

**Marsa هو المرسى اللي شغل الـ AI agent بتاعك بيرسى فيه.**
حوّل أي صفحة ثابتة أو تقرير HTML أو نموذج أولي لرابط تشاركه في ثواني، من غير حساب.

### ليه Marsa؟
- الـ agents بتطلّع HTML، والناس محتاجة روابط. طلب HTTP واحد بيحوّل الشغل لرابط.
- من غير حسابات: اللي معاه الرابط يفتحه، واللي بيرفع مش محتاج يسجّل. مفتاح التعديل هو كل اللي محتاجه.
- مفيش حاجة بتفضل: كل رابط ليه مدة، وبعدها الملفات بتتمسح.
- صغير وتقدر تمتلكه: بتشغّله بأمر واحد، وكوده يتقري في يوم.

### محتاج أنزّل حاجة؟
- **لو بتستخدم نسخة شغالة**: ولا حاجة. ارفع من المتصفح أو استخدم الـ API.
- **لو هتشغّل نسختك**: Marsa بس، بأمر Docker واحد. من غير قاعدة بيانات ولا خدمات تانية، وكل مميزات النشر شغالة.
- **الـ backend الاختياري للبيانات والملفات**: محتاج Appwrite، سواء Appwrite Cloud من غير تنزيل أو Appwrite على سيرفرك، وبيتربط بمتغيرات البيئة. ومقفول افتراضيًا، والـ routes بتاعته بترد `503 BACKEND_NOT_CONFIGURED`.

### المميزات
رفع بالسحب والإفلات، وAPI للنشر (ZIP أو ملفات أو JSON)، وروابط بتنتهي لوحدها، ومفتاح للتعديل والمسح، و`/llms.txt` و`/openapi.json` للـ agents، وحدود ضد الإساءة، وعرض آمن جوه sandbox، وواجهة ودليل بالعربي والإنجليزي، ولوحة أدمن اختيارية، وbackend اختياري (KV وملفات) عن طريق Appwrite.

### لمين؟
اللي بيبنوا agents، والمطورين اللي بيعرضوا شغل على عملاء، ومعاينات الـ CI، والمدرّسين والطلبة، وصفحات الإيفنتات المؤقتة. وفي `examples/` أمثلة وهمية لكل حالة.

### التشغيل السريع

</div>

```bash
docker compose up -d --build      # http://localhost:8080
# أو بـ Node.js 20+
npm install && npm run dev
```

<div dir="rtl">

### الاستخدام
- **المتصفح**: افتح الصفحة الرئيسية (`/ar`)، اسحب الملفات، اختار المدة، وانسخ الرابط.
- **الـ API**: `POST /api/sites` بملف zip أو JSON، والرد فيه `url` و`editToken`.
- **الـ agents**: وجّه الـ agent لـ `/llms.txt` أو ادّيله البرومبت اللي في `examples/agent/prompt.md`.
- **الإدارة**: `PUT` و`PATCH` و`DELETE` على `/api/sites/<id>` بالهيدر `Authorization: Bearer <editToken>`.

الدليل الكامل بالعربي في [`docs/ar/guide.md`](docs/ar/guide.md) وعلى `/ar/docs`.

### الإعدادات والأمان
كل الإعدادات متغيرات بيئة اختيارية (الجدول فوق و`.env.example`). أي حاجة بتترفع بتبقى متاحة لأي حد معاه الرابط، والصفحات بتشتغل جوه sandbox، والمفاتيح بتتخزن كـ hash بس، والـ IP مش بيتسجّل.

### إزاي تساهم
اعمل fork، وبعدين `npm install`، واعمل التعديل ومعاه اختبار، وخلي نصوص الواجهة بالعربي والإنجليزي، وشغّل `npm run lint && npm run typecheck && npm test`، وافتح Pull Request.

### الترخيص وليه مفتوح المصدر
MIT، ومبني على canvas-drop (MIT). مفتوح المصدر علشان تشغّله عندك، وبياناتك تفضل معاك، وتبني عليه.

</div>
