# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.11.1] - 2026-10-20

### Fixed
- The login page intro mentions member accounts as well as the team key.
- The members table's name column, and the "Signed in as team key · Owner" line, read correctly.
- Activity entries show expiry dates as local times instead of raw ISO strings.

## [0.11.0] - 2026-10-20

### Added
- **Team members.** The admin, or a team owner, creates **single-use, expiring invite links**: 24 h,
  72 h (default) or 7 days, at most 20 pending per team. There is no email provider: whoever opens the
  link picks a username, a display name and a password, and is signed in.
  - Passwords are hashed with scrypt (N=2¹⁵, r=8, p=1). Invite tokens are stored only as SHA-256.
  - Usernames are unique on the instance. A team can have up to 50 members.
- **Roles:**
  - **owner**: everything, including members.
  - **editor**: publish and manage sites, and MCP tokens.
  - **viewer**: read-only.
  - The server enforces roles on every route, and the UI hides what a role can't do.
- **Sessions per member.** A member session is bound to that member's password and epoch, so it
  ends on a password change, on *Sign out everywhere else* and on removal.
- **Members page** (`/team/members`):
  - the people with their roles, joined and last sign-in dates;
  - role changes and removal (owners);
  - pending invites;
  - *Your account* (change password, sign out everywhere else);
  - the team's activity log.
- **Audit log.**
  - Covers dashboard actions, API calls (team key or edit token), MCP writes, invites, joins and role
    changes.
  - The site page shows the last 30 entries for the site; the team keeps the last 500 in
    `audit.json`.
- **Admin:** a *Members* column with an invite form in the console. API:
  - `POST /api/admin/teams/:id/invites`
  - `GET /api/admin/teams/:id/members`
  - `DELETE /api/admin/teams/:id/members/:mid`
  - `DELETE /api/admin/teams/:id/invites/:iid`
  - Team delete purges members, invites and the log.

### Unchanged (migration)
- The team key keeps working for `X-Team-Key` uploads and the API.
- Browser sign-in with the key still works and acts as an **owner**, so existing teams need no
  migration. The login page now offers a member sign-in first and the team key below it.

### Changed
- Arabic sparkline label uses Arabic-Indic digits throughout.

## [0.10.0] - 2026-10-20

### Added
- **Visit counts with privacy built in.** Page views are counted per site per UTC day when an HTML
  page under `/s/<id>/` is served.
  - Nothing is collected beyond the count: no cookies, no IP addresses or user agents stored, no third
    parties, and nothing injected into pages.
  - Bots, link previews, headless browsers, scripts, prefetches, `HEAD` and asset requests aren't
    counted.
- **Approximate visitors**: a distinct `sha256(hourly in-memory salt + site + IP + UA)` within each
  hour. The salt is never stored. Do Not Track and GPC count as views only.
- Counts are buffered in memory and flushed to `sites/<id>/visits.json` every `VISITS_FLUSH_SECONDS`
  (60) and on shutdown. They don't use KV.
  - Retention is `VISITS_RETENTION_DAYS` (90). `VISITS=false` turns counting off.
  - Counts are removed with the site, whether it is deleted or swept.
- **Where they show:**
  - Dashboard: a sparkline plus 7- and 30-day views for each site.
  - Site page: a *Visits* section with a 30-day bar chart and views and visitors for today, 7 days and
    30 days.
  - Admin *All sites*: the same column, plus a 30-day total.
- Docs: *Visit counts* in `docs/teams.md` and the Arabic guide. The privacy notes are updated.

## [0.9.1] - 2026-10-20

### Fixed
- The Claude Code snippet on the site page keeps its `\` line continuations (it was rendered on one line).

## [0.9.0] - 2026-10-20

### Added
- **MCP per space.** Every site has a Streamable HTTP MCP endpoint at `/mcp/s/<siteId>` (stateless JSON;
  protocol versions 2025-11-25, 2025-06-18 and 2025-03-26; `initialize`, `ping`, `tools/list` and
  `tools/call`).
- **Scoped tokens** are created, listed and revoked in the new **MCP access** section of the site page.
  - A token is `marsa_mcp_…`, it is shown once and only a SHA-256 hash is stored.
  - Scopes are read-only and read-write, with up to 10 tokens per site.
  - Tokens are never exposed by `GET /api/sites/<id>`.
- **Read-only tools:** `get_site_info`, `list_files` and `read_file` (text files up to 256 KB). With the
  backend: `kv_list`, `kv_get` and `list_uploads`.
- **Read-write tools:** `replace_site_files`. With the backend: `kv_put`, `kv_delete`, `upload_file` and
  `delete_file`.
- Backend tools only appear for teams with backend access.
- The site page has copy-ready snippets for Cursor, Claude Code and VS Code, with a placeholder token.
- **Limits:**
  - `MCP_REQUESTS_PER_MINUTE` (60 per token).
  - `MCP_WRITES_PER_HOUR` (60 per token).
  - `MCP_KV_WRITES_PER_DAY` (500 for the whole instance, half of Cloudflare KV's free 1000 writes a day).
- **Protections:** the Origin check, the MCP-Protocol-Version check and rejecting batches.
- Docs: `docs/mcp.md`, an Arabic section, `llms.txt` and the env reference.

### Fixed
- Flash redirects to an in-page anchor keep the flash parameter before the `#fragment`.

## [0.8.0] - 2026-10-20

### Added
- **Permanent sites.** Teams with the new per-team `permanent` flag can publish sites with no expiry
  (`ttlHours=permanent`, `?permanent=1` or `"permanent": true`), or convert one with **Make
  permanent** on the site page / `PATCH /api/sites/<id> {"permanent": true}`. The flag defaults to the
  team's backend access and the admin toggles it in the console or with `PATCH /api/admin/teams/<id>`.
  Guests keep the 1 h – `MAX_TTL_HOURS` TTL.
- A permanent site has `"permanent": true` and `expiresAt` `9999-12-31T00:00:00.000Z` (a real date, so
  every liveness check, and older releases after a rollback, keep working). The sweeper skips it
  explicitly. Pages show a **Permanent** badge instead of a date.
- Admin: **Permanent sites** filter and **Revoke permanent** on *All sites*;
  `PATCH /api/admin/sites/<id> {"permanent": true|false}`. Revoking gives `MAX_TTL_HOURS` from now.
  Turning a permanent site back into a timed one restarts its TTL ceiling (`ttlFrom`).
- **Team quotas**: `TEAM_MAX_SITES` (default 50 live sites) and `TEAM_MAX_MB` (default 200 MB) per
  team, overridable per team (`maxSites` / `maxMb`, *Quota* fields in the console). Uploads and
  replaces over the quota answer `403 TEAM_QUOTA_EXCEEDED`. The dashboard shows usage.

## [0.7.0] - 2026-10-20

### Added
- **Image cards in the public directory.** Every team page on the home page is a card with a 16:9
  preview. The picture is an image already inside the site: `cover.(png|jpg|jpeg|webp|avif|gif)` at
  its root, else a local `og:image` / `twitter:image`, else the first local `<img>` in `index.html`
  (raster only, max 2 MB; nothing external is fetched and no headless browser runs). Sites without one
  get a drawn placeholder (first letter of the title, a colour per team, light and dark).
- `GET /covers/<id>`: serves that image for listed, live sites only, after checking its magic bytes,
  with `default-src 'none'; sandbox`, `nosniff`, `ETag` and a 5-minute cache. Picks are memoised per
  site version.
- `/api/directory` gains `featured` (site ids) and a `cover` URL (or `null`) per site. Additive; the
  existing fields are unchanged.
- **Featured page**: a large card above the directory. `FEATURED_SITES=<id>,…` pins it; otherwise the
  newest listed page.
- Home page: hero with a "Team sign-in" button, a link to the directory and live counts (teams
  publishing, live pages, longest link life); a "How it works" strip with icons right under it (it
  replaces the old How it works section further down). Team headings get a coloured initial.

### Docs
- `docs/teams.md` and the Arabic guide: how a team sets its cover image, and `FEATURED_SITES`.

## [0.6.3] - 2026-10-20

### Fixed
- Pages now load `/assets/app.css?v=<hash>` and `/assets/app.js?v=<hash>` (hash of their content).
  The assets are cached for 4 hours, so behind a CDN (Cloudflare) a deploy could keep serving the old
  CSS/JS for hours; the new URL changes whenever the content does.

## [0.6.2] - 2026-10-20

### Changed
- **Single-site view (`/team/sites/<id>`) redesign.** The page heading now carries "Open site" and
  "Copy link"; link, expiry, size and home-page listing sit in one "Link, expiry and visibility" panel
  with Extend / Show-Hide on one side and Delete set apart. The replace-files drop zone is compact.
  Published files and the data-and-files browser each get a full-width section (before, the KV table
  was squeezed into half the page next to the file list).
- **Backend browser.** Each KV value is a one-line preview that expands (`<details>`, no script) into
  the pretty-printed JSON; each key shows its size; a summary shows the number of keys and uploaded
  files; keys beyond the first 20 are listed by name under "more keys". On phones each key is a compact
  card with Delete beside the key. Long JSON values no longer turn the page into a tall wall of
  monospace text.
- Team dashboard: the listing column is labelled "On home page" (was "Published by teams").

## [0.6.1] - 2026-10-20

### Changed
- **Admin console redesign.** `/admin` and `/admin/sites` (AR/EN) now use the same building blocks as
  the team dashboard: page heading with the section switch and sign-out beside it, a status summary
  (teams, live team sites, guest sites, whether the data-and-files backend is configured), the shared
  table, panel and form styles, and the shared empty state. Team flags (data and files, home-page
  listing) are shown as a badge with one "Turn on / Turn off" button, like a site's listing on the team
  pages. The admin-only switch, tab and filter-bar styles are gone. No routes or behaviour changed.
- On narrow screens every data table (team sites, KV keys, uploaded files, admin teams and sites) is
  shown as a stack of cards, one per row, each value labelled.

### Fixed
- Mobile pages with a table no longer scroll sideways: the visually hidden table caption could escape
  the table's scroll box and widen the page.

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
