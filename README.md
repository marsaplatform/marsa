# Marsa

**A harbor for your work. Land it, share it, let it go.**

*Marsa* (مَرسى) is Arabic for "harbor": the place where your (or your AI agent's) work lands.
Drop a folder, some files or a `.zip` (from the browser, a script, an AI agent or CI) and get a
shareable link in seconds. **No account.** Links **expire on their own** (1 hour to 7 days by
default), and an **edit token** lets you update, extend or delete before then.

One Node.js process, one data folder, no database. MIT licensed.

> [العربية ↓](#بالعربي)

## Quick start

```bash
docker compose up -d --build        # http://localhost:8080
```

or with Node.js 20+:

```bash
npm install
npm run dev                         # http://localhost:8080 (reloads on change)
```

Publish something:

```bash
(cd examples/event-page && zip -qr ../../site.zip .)
curl -s -X POST "http://localhost:8080/api/sites?ttlHours=24" \
  -H "Content-Type: application/zip" --data-binary @site.zip
# => {"url":"http://localhost:8080/s/k3v9x2mq7a/","expiresAt":"…","editToken":"marsa_…", …}
```

## What's inside

| Route | What it is |
| --- | --- |
| `/` · `/ar` | Landing page in English / Arabic with a live uploader |
| `/new` · `/ar/new` | Just the uploader |
| `/docs` · `/ar/docs` | The guide, rendered from [`docs/`](docs) |
| `/llms.txt` | Instructions for AI agents, with this instance's URL and limits |
| `/openapi.json` | OpenAPI 3.1 spec of the API |
| `/api/sites` … | The API: create, read, replace, extend, delete ([reference](docs/api.md)) |
| `/api/admin/*` | Optional admin API, enabled by `ADMIN_TOKEN` |
| `/s/<id>/` | Published sites, served in a browser sandbox |

## Guides

- [Getting started](docs/getting-started.md): browser upload and what makes a valid site
- [API reference](docs/api.md): every endpoint with curl examples and error codes
- [AI agents](docs/agents.md): a prompt to paste, plus shell / Node.js / Python snippets
- [Managing a site](docs/managing.md): update, extend or delete with the edit token
- [Use cases](docs/use-cases.md): agent reports, client prototypes, event pages, class assignments, CI previews
- [Self-hosting](docs/self-hosting.md): Docker, configuration, reverse proxy, admin
- [دليل بالعربي](docs/ar/guide.md)

Sample sites for every use case, a GitHub Actions workflow for PR previews and agent deploy
scripts are in [`examples/`](examples).

## Configuration

Environment variables, all optional; see [`.env.example`](.env.example) and
[self-hosting](docs/self-hosting.md#configuration).

| Variable | Default | Meaning |
| --- | --- | --- |
| `PUBLIC_URL` | `http://localhost:$PORT` | Base for share links, docs and `/llms.txt` |
| `DEFAULT_TTL_HOURS` / `MIN_TTL_HOURS` / `MAX_TTL_HOURS` | `24` / `1` / `168` | Link lifetime |
| `MAX_FILE_MB` / `MAX_SITE_MB` / `MAX_FILES` | `10` / `25` / `500` | Size and count caps |
| `UPLOADS_PER_HOUR` / `API_REQUESTS_PER_MINUTE` | `20` / `120` | Per-IP rate limits |
| `TRUST_PROXY` | `false` | Read the client IP from proxy headers |
| `ADMIN_TOKEN` | empty (off) | Enables `/api/admin/*` |
| `PORT` / `HOST` / `DATA_DIR` | `8080` / `0.0.0.0` / `./data` | Server and storage |

## Architecture

```
            browser / script / AI agent / CI
                         │  HTTP
┌────────────────────────▼───────────────────────────────┐
│ Hono app (src/app.ts)                                  │
│  pages: /, /ar, /new, /docs  ← ui.ts, i18n.ts, docs.ts │
│  /llms.txt, /openapi.json    ← llms.ts, openapi.ts     │
│  /api/*  ── rate-limit.ts ── tokens.ts (hash, compare) │
│     └─ ingest.ts: zip / multipart / JSON → paths.ts,   │
│        mime.ts checks → size & count caps              │
│  /s/<id>/*  → sandbox CSP + nosniff (security.ts)      │
└────────────────────────┬───────────────────────────────┘
                         │ store.ts (staged writes, atomic rename)
              DATA_DIR/sites/<id>/meta.json
              DATA_DIR/sites/<id>/files/…
                         ▲
        index.ts: sweeper deletes expired sites every minute
```

- **No database.** Each site is a folder with a `meta.json` (expiry, file list, SHA-256 of the
  edit token). Writes are staged in `DATA_DIR/tmp` and swapped in with `rename()`.
- **Isolation.** Sites are served with `Content-Security-Policy: sandbox …`, so each page gets an
  opaque origin and can't read the app's storage or call its API as the visitor. App pages use a
  strict CSP with no inline code.
- **Abuse limits** are checked before anything is written: declared ZIP sizes before inflating,
  path traversal, dotfiles, blocked types, per-file / per-site / count caps, per-IP rate limits.
- **i18n.** All UI strings are in `src/i18n.ts` (English and Arabic); pages are server-rendered per
  language, so there's no flash of untranslated text.

```
src/        app.ts index.ts config.ts brand.ts ui.ts assets.ts i18n.ts docs.ts llms.ts openapi.ts
            ingest.ts paths.ts mime.ts store.ts tokens.ts rate-limit.ts security.ts client-ip.ts errors.ts
docs/       guides (served at /docs)          examples/  sample sites, CI workflow, agent scripts
test/       vitest suites                     scripts/   smoke.mjs (e2e), rename.mjs
```

## Development

```bash
npm run lint && npm run typecheck && npm test
npm run build && npm start &  npm run smoke     # end-to-end check against a running server
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [CHANGELOG](CHANGELOG.md). Security reports:
[SECURITY.md](SECURITY.md). To rename the project, run `node scripts/rename.mjs "New Name"`.

## Roadmap

- Optional per-site backend (key-value and files) for pages and agents
- Pluggable storage (S3-compatible)
- Optional captcha / proof-of-work for busy public instances
- Custom slugs and password-protected links

## License

[MIT](LICENSE). Derived from [canvas-drop](https://github.com/markpasternak/canvas-drop) (MIT);
see [NOTICE](NOTICE).

---

<div dir="rtl">

## بالعربي

### Marsa إيه؟
**Marsa** (مَرسى، يعني المكان اللي الشغل بيرسى فيه) خدمة صغيرة مفتوحة المصدر. انت أو الـ AI agent بتاعك ترفعوا فولدر أو ملفات أو ملف `zip`، من المتصفح أو سكريبت أو الـ CI، وتاخدوا **رابط تشاركوه** في ثواني. **من غير حساب**، والرابط **بيتمسح لوحده** لما مدته تخلص (من ساعة لحد 7 أيام)، ومعاه **مفتاح تعديل** تحدّث بيه الموقع أو تمدّه أو تمسحه.

### التشغيل السريع

</div>

```bash
docker compose up -d --build     # http://localhost:8080
# أو بـ Node.js 20+
npm install && npm run dev
```

<div dir="rtl">

### فيه إيه؟
- الصفحة الرئيسية بالعربي على `/ar` وبالإنجليزي على `/`، وفيها رفع مباشر.
- الدليل على `/ar/docs` و`/docs`، والدليل العربي الكامل في [`docs/ar/guide.md`](docs/ar/guide.md).
- تعليمات للـ AI agents على `/llms.txt`، ومواصفات الـ API على `/openapi.json`.
- أمثلة جاهزة في [`examples/`](examples): تقرير من agent، ونموذج أولي لعميل، وصفحة إيفنت، وواجب دراسي، ومعاينة من الـ CI. وكل الأسماء والبيانات فيها وهمية.

### الإعدادات
كل الإعدادات متغيرات بيئة، وقيمها الافتراضية في `.env.example`. أهمها `PUBLIC_URL` و`MAX_TTL_HOURS` و`MAX_SITE_MB` و`UPLOADS_PER_HOUR` و`ADMIN_TOKEN`.

### إزاي تساهم
1. اعمل fork وفرع جديد، وبعدين `npm install`.
2. اعمل التعديل وضيف له اختبار في `test/`، وخلي نصوص الواجهة بالعربي والإنجليزي في `src/i18n.ts`.
3. شغّل `npm run lint && npm run typecheck && npm test`.
4. افتح Pull Request. التفاصيل في [CONTRIBUTING.md](CONTRIBUTING.md).

### الترخيص
MIT، والمشروع مبني على canvas-drop (MIT)، والتفاصيل في ملف NOTICE.

</div>
