# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.6.0] - 2026-10-20

### Added
- **Team sign-in** at `/login` and `/ar/login`: paste the team key to get a signed session cookie
  (HMAC-SHA256 with `SESSION_SECRET`, `HttpOnly`, `Secure` + `__Host-` prefix on HTTPS, `SameSite=Lax`,
  7 days by default). Sign-in is rate-limited per IP; sign-out revokes the session; rotating a team key
  or deleting the team ends its sessions.
- **Team dashboard** at `/team`: status (live sites, data/files on or off and whether the server has a
  backend, home-page listing), the team's live sites (title, link, expiry, size, listing), publishing by
  drag and drop or file/ZIP/folder pick with an expiry picker, and per site (`/team/sites/<id>`):
  replace files, extend, hide from or show on the home page, delete, the published file list and a KV
  and files browser (read and delete) for teams with backend access. Copy-ready agent snippets use a
  `$MARSA_TEAM_KEY` placeholder. Team sites are managed from the session; edit tokens stay hashed.
- **Admin sign-in** at `/admin/login` (same session mechanism, separate admin role, 12 hours), the
  teams console as server-rendered forms, and **All sites** (`/admin/sites`) with a team/guest filter
  and delete.
- Per-site `unlisted` flag: teams can hide one site from the public directory.
- CSRF protection on every state-changing form (session-bound token or double-submit cookie on sign-in
  forms) plus an Origin / `Sec-Fetch-Site` check.
- New settings: `SESSION_SECRET`, `SESSION_TTL_HOURS`, `ADMIN_SESSION_TTL_HOURS`,
  `LOGIN_ATTEMPTS_PER_15_MIN`.

### Changed
- **New design aligned with marsaplatform.com**: the Zad typeface (self-hosted from `public/fonts/zad`,
  SIL OFL-1.1), the platform palette (light and dark), a shared header (logo, Home, Publish, Guide,
  Team sign-in, language switch, mobile menu) and a footer linking back to marsaplatform.com. The
  product is named "مساحات مرسى / Marsa Spaces" in the UI; Arabic copy is in Modern Standard Arabic.
- Polished empty states, error pages (403/404/410/429) and focus styles; mixed Arabic/Latin text is
  isolated with `bdi` / `dir`.
- App pages send `Referrer-Policy: same-origin` (uploaded sites keep `no-referrer`).

### Removed
- The paste-the-token-in-a-tab admin page and `/assets/admin.js`. The `/api/admin/*` bearer API is
  unchanged.

## [0.5.0] - 2026-10-20

### Changed
- **The optional data/files backend now runs on Cloudflare instead of Appwrite.** KV values live in a
  Workers KV namespace (REST API, keys `<siteId>/<key>`), files in an R2 bucket (S3-compatible API,
  objects `<siteId>/<fileId>/<name>`), called straight from Node; no Worker needed. The HTTP API,
  status codes, the 403/503 rules, `BACKEND_PUBLIC_READ` and the purge on delete/expiry are unchanged.
- Configuration: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_KV_NAMESPACE_ID`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (all five or none), optional `R2_BUCKET`
  (default `marsa-files`) and `R2_ENDPOINT`.
- New `scripts/cloudflare-setup.mjs` (idempotent) creates the KV namespace and the R2 bucket and can
  derive the R2 S3 keys from the API token.

### Removed
- Appwrite support: `src/backend/appwrite.ts`, the `node-appwrite` dependency,
  `scripts/appwrite-setup.mjs` and the `APPWRITE_*` variables. Data stored in Appwrite is not migrated.

## [0.4.0] - 2026-10-20

### Added
- **Teams**, managed by the operator: admin API `/api/admin/teams` (list, create, update, rotate key,
  delete) and a bilingual admin console at `/admin` and `/ar/admin`. Team keys are shown once and
  stored as SHA-256 in `DATA_DIR/teams.json`.
- Uploads with `X-Team-Key` (or a `Bearer marsa_team_…`) belong to that team; a bad key is
  `401 INVALID_TEAM_KEY`. Guest uploads are unchanged.
- **Public directory** of live team sites, grouped by team: a section on the homepage (`/`, `/ar`)
  and `GET /api/directory` (cached 30 s). Per-team "show in public directory" switch (default on).
  The page `<title>` is stored as the card title.
- Docs: `docs/teams.md`, API/OpenAPI/llms.txt updates, Arabic guide section.

### Changed
- The data/files backend is now **only for sites of teams with backend access**; other sites get
  `403 BACKEND_NOT_ALLOWED`. `BACKEND_GUEST_ACCESS=true` restores the 0.3 behaviour.
- Owner views of a site include `team` (`null` for guests).

## [0.3.0] - 2026-10-20

### Added
- Optional per-site data/files backend backed by Appwrite (Cloud or self-hosted), off by default:
  KV (`/api/sites/:id/kv[/:key]`) and files (`/api/sites/:id/files[/:fileId]`), writes with the
  edit token, public reads by default (`BACKEND_PUBLIC_READ`), per-site caps, CORS for sandboxed pages.
- Browser SDK at `/sdk.js` (`marsa.kv.*`, `marsa.files.*`, `marsa.auth()`).
- Site deletion and expiry also purge the site's backend data.
- `scripts/appwrite-setup.mjs` creates the table, columns, index and bucket.
- Docs: `docs/backend.md`, a "Do I need to install anything?" section, Arabic guide section;
  backend routes in `/openapi.json` and `/llms.txt`; `examples/backend-notes`.
- Without `APPWRITE_*` config every backend route answers `503 BACKEND_NOT_CONFIGURED`;
  a partial config fails at startup naming the missing variables.

## [0.2.0] - 2026-10-20

### Added
- Landing page at `/` (English) and `/ar` (Arabic, RTL): the idea, why, how it works, use cases,
  agent snippet, live uploader, limits and privacy, self-hosting. Light and dark themes,
  keyboard and screen-reader friendly, no inline scripts or styles.
- Standalone uploader at `/new` and `/ar/new`.
- In-app guide at `/docs` and `/ar/docs`, rendered from `docs/*.md`: getting started, API,
  AI agents, managing with the token, use cases, self-hosting, and a full Arabic guide.
  The placeholder instance URL in docs is replaced with `PUBLIC_URL`.
- `/llms.txt` with agent instructions and this instance's limits.
- `/openapi.json` (OpenAPI 3.1) describing the API.
- `/robots.txt` that keeps uploaded sites and the API out of search engines; `/favicon.svg`.
- `examples/`: fictional sample sites for an agent report, a client prototype, an event page,
  a class assignment and a CI build preview; a GitHub Actions workflow for PR previews;
  an agent prompt and deploy scripts (shell, Node.js, Python).
- Issue and pull request templates, this changelog.
- Tests for the new pages, docs, llms.txt, OpenAPI, and that every example site publishes.

### Fixed
- Rate limiting now reads the real socket address under `@hono/node-server` 2.x
  (previously every direct client shared one "unknown" bucket).

## [0.1.0] - 2026-10-20

### Added
- Guest upload of files, folders or a ZIP from the browser; deploy API (`POST /api/sites`)
  accepting ZIP, multipart or JSON.
- Expiring links with configurable TTL and a background sweeper.
- Edit/delete token per site (`GET`/`PUT`/`PATCH`/`DELETE /api/sites/:id`), stored hashed.
- Abuse limits: size and file-count caps, per-IP rate limits, blocked file types, zip-slip and
  zip-bomb guards, sandboxed serving with strict headers.
- Optional admin API enabled by `ADMIN_TOKEN`.
- Docker image and compose file, CI with lint, typecheck, tests, smoke test and gitleaks.
