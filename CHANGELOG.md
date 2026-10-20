# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

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
