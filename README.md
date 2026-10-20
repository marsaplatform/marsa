# Marsa

**Drop a static site, get a link. No account needed.**

*Marsa* (مَرسى) is Arabic for "harbor": the place where your (or your agent's) work lands.

Marsa is a small, self-hostable service for trying out static hosting with zero
friction. Drag in a folder, some files or a `.zip` (or call the API from a script
or an AI agent) and you get a shareable link. The link **expires on its own**
(1 hour to 7 days by default), and you get an **edit/delete token** to update or
remove it before then.

It is the lightweight, open-source little sibling of a full canvas-hosting
platform: no accounts, no teams, no database. It's one Node process and a data folder.

> [العربية ↓](#بالعربي)

## Features

- **Guest upload**: drag-and-drop files, folders or a ZIP in the browser. No sign-up.
- **Deploy API**: `POST /api/sites` with a ZIP, multipart files or JSON `files[]`.
- **Expiring links**: configurable TTL (default 24h, max 7d); a background sweeper deletes expired sites.
- **Edit/delete token**: replace content (`PUT`), change expiry (`PATCH`, never past created + max TTL), or delete (`DELETE`).
- **Abuse limits**: per-file / per-site / file-count caps, per-IP upload and API rate limits,
  blocked server-side and executable file types, zip-slip and zip-bomb guards, dotfiles stripped.
- **Safe serving**: uploaded pages get a `sandbox` CSP (opaque origin, so they can't touch the app),
  `frame-ancestors 'none'`, `nosniff`, `noindex`.
- **Optional admin**: set `ADMIN_TOKEN` to list or delete sites over the API.
- **Bilingual UI**: English and Arabic (RTL).

## Quick start

Requires Node.js 20+ (22 LTS recommended).

```bash
npm install
cp .env.example .env      # optional, every value has a default
npm run dev               # http://localhost:8080
```

Production build:

```bash
npm run build && npm start
```

Docker:

```bash
docker compose up -d --build   # http://localhost:8080, data in the "marsa-data" volume
```

Behind a reverse proxy (Caddy, nginx, Traefik), set `PUBLIC_URL=https://your.domain` and
`TRUST_PROXY=true` so links and rate limits use the right host and client IP.

## API

| Method & path | Auth | What it does |
| --- | --- | --- |
| `POST /api/sites` | none | Create a site. Body: `application/zip`, `multipart/form-data` (`files`, optional `paths`, `ttlHours`) or JSON `{ ttlHours?, files: [{ path, content, encoding?: "utf8"\|"base64" }] }`. `?ttlHours=` also works. Returns `{ id, url, expiresAt, editToken, ... }`. |
| `GET /api/sites/:id` | edit token | Site metadata. |
| `PUT /api/sites/:id` | edit token | Replace all files (same body formats). |
| `PATCH /api/sites/:id` | edit token | `{ ttlHours }` to change the expiry (capped at created + `MAX_TTL_HOURS`). |
| `DELETE /api/sites/:id` | edit token | Delete now. |
| `GET /api/config` | none | Public limits, used by the UI. |
| `GET /api/admin/sites` | admin token | List all sites (only when `ADMIN_TOKEN` is set). |
| `DELETE /api/admin/sites/:id` | admin token | Delete any site. |
| `POST /api/admin/sweep` | admin token | Run the expiry sweeper now. |
| `GET /s/:id/...` | none | The published site. |
| `GET /healthz` | none | Liveness. |

Tokens are sent as `Authorization: Bearer <token>`. Edit tokens are stored only as SHA-256 hashes.

```bash
# Deploy a folder from a script or AI agent
(cd my-site && zip -r ../site.zip .)
curl -s -X POST -H "Content-Type: application/zip" --data-binary @site.zip \
  "http://localhost:8080/api/sites?ttlHours=24"
```

Errors look like `{ "error": { "code": "BLOCKED_FILE_TYPE", "message": "...", "path": "x.php" } }`.

## Configuration

All settings are environment variables; see [`.env.example`](.env.example).

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Listen address |
| `PUBLIC_URL` | `http://localhost:$PORT` | Base for share links |
| `DATA_DIR` | `./data` | Storage folder |
| `DEFAULT_TTL_HOURS` / `MIN_TTL_HOURS` / `MAX_TTL_HOURS` | `24` / `1` / `168` | Link lifetime |
| `SWEEP_INTERVAL_SECONDS` | `60` | How often expired sites are deleted |
| `MAX_FILE_MB` / `MAX_SITE_MB` / `MAX_FILES` | `10` / `25` / `500` | Size and count caps |
| `UPLOADS_PER_HOUR` | `20` | Uploads + updates per IP per hour |
| `API_REQUESTS_PER_MINUTE` | `120` | Any `/api` call per IP per minute |
| `TRUST_PROXY` | `false` | Trust `X-Real-IP` / last `X-Forwarded-For` hop |
| `ADMIN_TOKEN` | *(empty: admin off)* | Admin bearer token, at least 24 chars |

### Security notes

- Every uploaded site is **public to anyone with the link**. The id is random, but it is not a password.
- Sites are served from the same host under `/s/<id>/` with a `sandbox` CSP, which isolates them
  from the app. For extra isolation you can put Marsa on its own domain.
- Rate limits are in-memory and per-process; run a single instance or add limits at your proxy.

## Project layout

```
src/
  index.ts        server entry: config, store, sweeper, HTTP listener
  app.ts          routes: API, admin, UI, site serving
  brand.ts        project name (one place to rename)
  config.ts       env parsing and validation
  ingest.ts       ZIP / multipart / JSON ingestion + limits
  paths.ts        path normalization, zip-slip guard
  mime.ts         MIME map and blocked file types
  store.ts        filesystem store (data/sites/<id>/{meta.json,files/})
  rate-limit.ts   in-process fixed-window limiter
  security.ts     CSP and security headers
  tokens.ts       ids, edit tokens, constant-time compare
  ui.ts           upload page, CSS and client JS
test/             vitest suites
scripts/          smoke.mjs (e2e against a running server), rename.mjs
```

## Roadmap / future work

- Optional per-site backend (key-value storage and file uploads), as in the full platform.
- Pluggable storage (S3-compatible).
- Optional captcha / proof-of-work for public instances.
- Custom slugs and password-protected links.
- "Upgrade to a full account" hand-off to a full hosting platform.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: `npm install`, make your change with a test,
then `npm run lint && npm run typecheck && npm test` before opening a PR.

## License

[MIT](LICENSE). Marsa is derived from [canvas-drop](https://github.com/markpasternak/canvas-drop) (MIT);
see [NOTICE](NOTICE) for attribution.

---

<div dir="rtl">

## بالعربي

### Marsa إيه؟
**Marsa** (مَرسى، يعني المكان اللي الشغل بيرسى فيه) خدمة صغيرة مفتوحة المصدر تقدر تشغّلها على سيرفرك، وبتخلّي أي حد يجرّب استضافة المواقع الثابتة من غير حساب ومن غير ما يدفع. تسحب فولدر أو ملفات أو ملف `zip` في المتصفح، أو تبعتهم من سكريبت أو AI agent عن طريق الـ API، وتاخد **رابط تشاركه**.
الرابط **بيتمسح لوحده** لما مدته تخلص (من ساعة لحد 7 أيام)، ومعاه **مفتاح تعديل ومسح** تقدر تحدّث بيه الموقع أو تمسحه قبل كده.

### المميزات
- رفع من غير تسجيل، بالسحب والإفلات لملفات أو فولدر أو ZIP.
- API للنشر: `POST /api/sites`.
- روابط بتنتهي تلقائيًا، ومدتها تتظبط من الإعدادات.
- حماية من الإساءة: حد أقصى لحجم الملف والموقع وعدد الملفات، وحد لعدد الرفعات لكل IP، ومنع أنواع الملفات الخطرة زي php وexe، وحماية من zip-slip وzip bomb.
- عرض آمن: كل موقع مرفوع بيتعرض جوه `sandbox`، فمايقدرش يوصل للتطبيق نفسه.
- لوحة أدمن اختيارية عن طريق `ADMIN_TOKEN`.
- الواجهة بالعربي والإنجليزي.

### التشغيل السريع
محتاج Node.js 20 أو أحدث.

</div>

```bash
npm install
cp .env.example .env
npm run dev        # http://localhost:8080
# أو بـ Docker:
docker compose up -d --build
```

<div dir="rtl">

### الإعدادات
كل الإعدادات متغيرات بيئة، وكلها موجودة في `.env.example` بقيم افتراضية آمنة. أهمها:
`PUBLIC_URL` (رابط الموقع العام)، و`DEFAULT_TTL_HOURS` و`MAX_TTL_HOURS` (مدة الرابط)، و`MAX_SITE_MB` (أقصى حجم)، و`UPLOADS_PER_HOUR` (عدد الرفعات لكل IP)، و`ADMIN_TOKEN` (لو سبته فاضي، لوحة الأدمن بتبقى مقفولة).
لو شغّال ورا reverse proxy، خلي `TRUST_PROXY=true`.

### إزاي تساهم
1. اعمل fork وفرع جديد.
2. `npm install`
3. اعمل التعديل وضيف له اختبار في `test/`.
4. شغّل `npm run lint && npm run typecheck && npm test`.
5. افتح Pull Request واشرح فيه التعديل. التفاصيل في [CONTRIBUTING.md](CONTRIBUTING.md).

### الترخيص
MIT، والمشروع مبني على canvas-drop (MIT)، والتفاصيل في ملف NOTICE.

</div>
