# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

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
