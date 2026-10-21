# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.17.0] - 2026-10-21

### Added
- **Deploy jobs.** Every Worker deploy (create, redeploy, rollback, runtime change) is a job in a per-team
  queue, so one team's slow deploy no longer holds up the others. Requests still wait and answer `200/201`
  as before (up to 60 s, `WORKER_DEPLOY_WAIT_SEC`); a slower deploy answers `202` with
  `{"job": {"id", "status", "statusUrl"}}`, `Location` and `Retry-After`. `?wait=0…90`, `?async=1` or
  `Prefer: respond-async` choose the wait. New `GET /api/teams/<team>/jobs/<id>` and `GET …/jobs?worker=`.
  Jobs are kept 7 days; a job cut off by a restart becomes `interrupted`. Every failed deploy is written to
  the team's activity log (`worker-deploy-fail`, with the code and message).
- **Pre-deploy checks with esbuild**: `400 SYNTAX_ERROR` (line and column), `MISSING_MODULE` (unbundled
  imports; `cloudflare:*` and `node:*` are allowed), `NOT_A_MODULE`. Any default-export form is accepted.
- **Post-deploy health probe**: deploy answers and jobs include `health: {path, status, ms, ok}` from one
  request to `meta.healthPath` (or `/`). `?health=0` skips it. The MCP `deploy_worker` tool returns it too.
- **Cron triggers**: `"crons": [...]` on deploy, `POST …/runtime` and the MCP tools. Five-field UTC
  expressions, at most 3 per Worker, at least 10 minutes apart (`WORKER_CRON_MIN_MINUTES`); a per-team quota
  (`WORKER_CRONS_PER_TEAM`, default 2, admin `maxCrons`) and a check against the Cloudflare account limit
  (`WORKER_CRON_ACCOUNT_MAX`, default 5, counting every script's crons). Disabling a Worker pauses them;
  deleting it removes them.
- **Private per-Worker KV storage** (opt-in): `"storage": "kv"` creates a KV namespace bound as `env.STORE`,
  used only by that Worker and deleted with it (or with `"storage": null`). Quotas per team
  (`WORKER_KV_PER_TEAM`, default 3, admin `maxKvWorkers`) and per account (`WORKER_KV_ACCOUNT_MAX`). `STORE` is
  a reserved env name while storage is on. A token without KV permission gets `503 KV_NOT_PERMITTED`.
- `GET /api/teams/<team>/workers/<name>/runtime`: the runtime settings (date, flags, bindings, crons,
  storage, var/secret names) plus the var limits and quotas.
- **Browser Integrity Check exception (code path, off by default)**: `GET|PUT /api/admin/workers/bic`
  manages one Cloudflare Configuration Rule (`bic: false`) for team Worker hostnames only, kept in sync as
  Workers come and go. It turns on only when Cloudflare accepts it; without **Zone · Config Rules: Edit** it
  answers `403 BIC_NOT_PERMITTED` and nothing changes. New optional light in the Cloudflare permission checklist.
- **Admin notes to a team**: `POST /api/admin/teams/<id>/notes` and a **Post a note to a team** form on
  Admin › Notes (EN/AR). No notification or webhook is sent.

### Changed
- Cloudflare's script validation error (10021) and "no such module"/"uncaught" upload errors are now
  `400 VALIDATION_FAILED` with Cloudflare's message, instead of `502`. Other upstream failures carry a redacted
  detail instead of an empty message.
- Docs (EN/AR), the Worker recipe, `llms.txt` and `openapi.json` cover jobs, checks, crons, storage, the
  runtime read, the var limits (32 vars, 32 KB each, 64 KB total) and the Python `urllib` User-Agent
  workaround for Cloudflare error 1010.
- Privacy policy: private Worker storage and deploy jobs.

## [0.16.1] - 2026-10-21

### Fixed
- The Workers Logs permission is now named **Account · Workers Observability: Edit (API: Write)**:
  Edit in Cloudflare's token editor, Write in its API docs. *Read* alone is refused with 403 by the logs query.
  The permission checklist, the Logs tab hints (EN/AR), the docs, the Worker recipe and llms.txt are
  corrected, and a 403 on this check now explains why and what to change.

## [0.16.0] - 2026-10-21

### Added (0.16.0a: safety)
- **Daily encrypted off-site backups**: once a day (`BACKUP_HOUR_UTC`, default 01:00 UTC) the whole data
  folder is packed, gzip-compressed and sealed with AES-256-GCM (key derived with HKDF-SHA256 from
  `BACKUP_KEY`, or `MARSA_SECRETS_KEY` when unset; never stored with the backups) and uploaded to the R2
  bucket under `_marsa-backups/` (or `BACKUP_DIR` without R2). Every upload is read back and every file hash
  checked. Retention 14 daily + 8 weekly. A failure raises an admin bell notice (and the platform webhook).
  **Admin › Settings › Backups** shows the last / last good run, kept copies, next run and the last restore
  test, with "Back up now", "Test a restore" (into a scratch folder, then deleted) and restore steps.
  `node dist/backup-cli.js list | run | verify | restore <key> <empty dir>`. Admin API:
  `GET /api/admin/backups`, `POST …/backups/run`, `POST …/backups/test-restore`.
- **Team export**: `GET /api/admin/teams/<id>/export` (and the team's Settings tab) downloads a zip with
  members (no password hashes), activity, spaces with their files and data, Workers with their code and
  stored versions, agent keys and Worker API keys (no hashes), recipes, notes and notifications.
- **Team deletion with a 7-day grace period**: deleting needs the team name typed again, saves an export
  first, turns the team's Workers off (routes removed, scripts kept) and moves the team to **Deleted
  teams**: its keys, agent keys and sessions stop working and its spaces leave the directory. Restore brings
  it all back (the Workers it turned off go back on). After 7 days the sweep deletes it for good (Workers,
  stores, and its spaces if asked); the export is kept 30 more days. Activity: `team-delete`, `team-restore`,
  `team-purge`, `team-export`. API: `DELETE /api/admin/teams/<id>?confirm=<name|id>[&sites=delete][&purge=now]`,
  `GET /api/admin/trash`, `GET …/trash/<id>/export`, `POST …/trash/<id>/restore`, `DELETE …/trash/<id>?confirm=`.
- **Sessions survive restarts**: sign-outs are stored in `DATA_DIR/sessions.json`; **Sign out everywhere**
  for the admin (Settings, `POST /api/admin/sessions/end-all`) and for team owners (team Settings).
- Docs headings have anchors (`/docs/workers#var-values`).

### Changed
- **Plain var values are leaving the Workers lists** (deprecation, nothing breaks today):
  `GET /api/teams/<team>/workers`, `GET …/workers/<name>`, `GET /api/admin/workers` and MCP `list_workers`
  now return `varNames`. Until **2026-10-28 12:00 UTC** (`VAR_VALUES_SUNSET`) they still return `vars` with
  values, flagged `varValuesDeprecated: true`, with `deprecations[]` and `Deprecation` / `Sunset` / `Link`
  headers. After that the values come only with `?includeValues=1` (agent keys need `workers:deploy`) or
  `list_workers {"includeValues": true}`. Announced with a one-time bell notice to every team with Workers
  (no webhooks), in the invite onboarding (`startHere.changes`), the MCP-server recipe (v4) and the docs.
- **Privacy policy 0.16.0** (AR + EN): health checks, Worker logs and analytics, agent notes, ended
  sessions, GitHub repository checks, the Cloudflare Web Analytics script on all pages including dashboards,
  encrypted backups in R2, the team trash and export, retention for each. The Cloudflare DPA reference is a
  clearly marked placeholder until `OPERATOR_CLOUDFLARE_DPA` is set.
- The admin teams table's Delete opens the team's Settings tab (typed confirmation) instead of deleting.

### Added (0.16.0b: polish)
- **Activity API and downloads**: `GET /api/teams/<team>/activity` (team key only; agent keys get
  `403 TEAM_KEY_REQUIRED`) and `GET /api/admin/activity?team=<id|platform>` with `since`, `until`, `action`
  (exact or `prefix-`), `site`, `limit` (≤ 5000) and `format=json|jsonl|csv` (CSV with BOM and
  formula-safe cells). CSV/JSONL buttons on the team and admin Activity pages.
- **Every admin change is logged**: team create/update, invite revoke, site delete and permanence, sweep,
  recipes, notes, health interval, permission rechecks, webhooks, sign-out-everywhere and Worker health
  targets. Actors such as "agent key X" / "MCP token X" and details ("redeploy of v4", "N expired") are
  translated in Arabic.
- **Team export for owners**: *Settings → Export team* and `GET /api/teams/<team>/export` (team key).
- **Health rules per Worker**: web Workers are up below 400, MCP servers on `initialize` (2xx/401/403)
  or a GET below 500, or your own `meta.healthPath` + `meta.healthExpect` (`2xx`, `200-299`, `200,404`,
  `<400`), set on deploy, with `POST …/links`, `POST …/health` or in the Health tab. Workers that answered
  4xx at `/` before keep the old "below 500" rule (marked) until a target is declared, so no false alarms.
- **MCP servers page**: Health and Requests · 24h columns, filter by health; the admin overview's
  **Down now** card links to `?health=down`.
- **Global search (⌘K / Ctrl+K / `/`)** in the team and admin dashboards: pages, teams, spaces, Workers,
  MCP servers, notes and the docs, keyboard-first (combobox + listbox), Arabic letter forms folded.
- **Getting-started checklist** on the team overview (first space, a teammate, an agent key, a Worker);
  ticks itself off and owners can hide it.
- **Arabic docs**: all 11 guide pages translated (`/ar/docs/<slug>`), plus `/ar/docs/glossary`. The docs
  index shows one entry per page; links inside Arabic pages stay in Arabic.
- **OpenAPI for every route**: 51 missing operations added (admin API, webhooks, notifications, Worker
  ops, activity, export); a test fails when a new `/api` route has no entry. llms.txt and the docs gain a
  "Run & observe Workers" section (worker_env, secrets, health, usage, logs, activity).
- `DISPLAY_TZ` (default `Asia/Dubai`): dashboard times and charts use it, and the browser switches them to
  the viewer's own time zone. Charts get gridlines.

### Changed (0.16.0b)
- **Env warnings are quieter**: `missing` now lists only declared (`requiredEnv`) names that are not set.
  Names the code reads without a default and nobody declared are `unset` (info only); names read with a
  default (`env.X ?? …`, `env.X || …`, destructuring defaults) are ignored.
- **Admin Settings loads fast**: the token permission checklists are cached and refreshed in the
  background (warm-up 5 s after start, then every 4 minutes) instead of probing on every page view.
- **Arabic**: one word per term (وكيل/وكلاء، خادم/خوادم MCP، وركر/وركرات، فحص الصحة), the remaining English
  strings translated, page titles in one format ("page · team · مرسى Spaces").
- **Accessibility**: labelled task-list checkboxes, focusable code blocks, one `<h1>` per page, visible labels
  on the mobile quota and Workers forms (stacked under 600 px).
- The app sends `X-Frame-Options: DENY` and `Strict-Transport-Security` with `preload` itself (a proxy in
  front may still override them); versioned assets are cached as immutable for a year.

## [0.15.2] - 2026-10-21

### Added
- **Variables & secrets tab** on the Worker page (team + admin, AR/EN): every plain var, secret,
  Spaces-managed secret and binding by name, kind, Cloudflare type, status (set / empty / missing), last
  updated and by whom, read live from the script's bindings with the platform token (Spaces' record as
  fallback). Values are never shown or returned (secrets are write-only; plain var values are no longer
  displayed anywhere in the dashboard). Set/rotate/delete one secret without a redeploy
  (`PUT|DELETE /api/teams/<team>/workers/<name>/secrets/<NAME>`, admin `…/api/admin/workers/<id>/secrets/<NAME>`,
  MCP `set_worker_secret`, and the tab's write-only form), set/delete one plain var
  (`PUT|DELETE …/vars/<NAME>`, redeploys), all recorded in the activity log by name. New agent-key scope
  `workers:secrets`. Missing names are flagged from the declared `requiredEnv` (deploy, `…/links`,
  `deploy_worker`, `set_worker_links`) and from `env.X` usage in the stored code.
- **Health monitoring**: every Spaces Worker is checked every 5 minutes (configurable 60-3600 s in admin
  Settings or `WORKER_HEALTH_INTERVAL_SEC`): a GET of its URL, or MCP `initialize` for MCP servers without
  their own auth. 7 days of checks + 30 days of daily totals; uptime 24h/7d/30d, latency chart and
  incidents on a new **Health** tab; Health column + filter in the Workers tables; down after two failed
  checks, one bell notification + webhook on down and one on recovery; per-Worker on/off and "check now".
- **Logs tab**: errors of the last 24h — hourly error counts by status from Cloudflare analytics, plus
  Workers Logs lines when turned on for the Worker (script settings only, no new code). Filters by level,
  source and kind; secret-like strings redacted and query strings dropped. Missing token permissions are
  named on the tab.
- **Usage tab**: requests, errors and median CPU for 24h / 7d / 30d (Cloudflare GraphQL
  `workersInvocationsAdaptive`, cached 5 min) as an inline SVG chart, plus requests per end-user key (Spaces'
  rate-limit counters, now kept 31 days); 24h sparklines in the Workers tables (background snapshot).
- **Token permissions checklist** in admin Settings: green / red / grey lights for each permission the
  Workers token needs (scripts, script settings & secrets, Account Analytics, Workers Observability, zone,
  routes, DNS, workers.dev, optional tail/KV/R2) and for the data/files backend (KV token, R2 keys), each
  verified by one harmless read (no writes), with what it unlocks, a progress count and a Recheck button
  (cached 5 min). Token values are never displayed. API: `GET /api/admin/workers/permissions`,
  `GET /api/admin/backend/permissions`.
- MCP tools `worker_env` (names only) and `worker_status` (health, usage, recent errors).

## [0.15.1] - 2026-10-21

### Added
- **Downloadable MCP starter** (`GET /api/recipes/mcp-server-on-worker/starter.zip`, file tree at
  `…/starter`): TypeScript + Hono + the official MCP SDK (zod, `CfWorkerJsonSchemaValidator`, stateless
  JSON Streamable HTTP), `src/tools/<tool>.ts`, `src/lib/http.ts` (fixed User-Agent, timeouts, retries),
  cache, Arabic normalisation, i18n, vitest tests, esbuild/Bun bundling, size check, wrangler-free
  `scripts/deploy.ts` (sends `meta` + `repo`) and `scripts/smoke.ts`. Shown on the recipe page.
- **Recipes**: *MCP server on a Spaces Worker* v3 (honest stack recommendation from the Atlas, Malja
  and ERX repos, folder tree, naming and tool rules, commands, checklist, live verification, versions,
  keys, bindings); *Bilingual project page* v2 (folder structure with `index.html`, `ar/index.html`,
  `assets/`, `cover.png`, repo link); new *Python MCP server, self-hosted (FastMCP)*; new *Agent notes*.
- **Invite onboarding "Start here"**: stack recommendation, starter link and the top 10 rules (JSON
  `startHere` and markdown).
- **Worker insight** in the Workers tables (admin, team, admin team detail) and the Worker Overview: type
  (MCP server / site/API / other), language and stack, MCP tool count and endpoint, Spaces-keys
  protection, size, version, with type/language/repo filters. Order: declared `meta` on deploy (API,
  MCP `deploy_worker`, UI), then code heuristics, then a cached read-only `initialize` + `tools/list`
  probe (4 s timeout, 1 h cache, never `tools/call`; admin and team "Refresh tools list").
- **Repo column** for Spaces, Workers and MCP servers, plus detail pages: optional `repo` {url, branch,
  commitSha} on deploy, `POST /api/teams/<team>/workers/<name>/links`, MCP `set_worker_links`,
  `PATCH /api/sites/<id>` and the Settings tabs. Checked read-only on GitHub (public / private / not
  found; with `GITHUB_TOKEN` on the server private and missing are told apart; the token is never shown)
  and synced / behind / diverged against the branch, cached 15 min.
- **MCP servers page** (sidebar "MCP servers" / "سيرفرات MCP", admin and team): every Worker declared or
  detected as MCP with its endpoint (copy), linked Space page (manual, declared `spaceSlug`, or same
  name), Worker page, keys status and a "User keys" button, tools, stack, repo, status and last deploy,
  with filters and search.
- **Agent notes** (sidebar "Agent notes" / "ملاحظات الإيجنتس"): agents leave notes at any stage with
  `POST /api/teams/<team>/notes` (team key or any agent key), the MCP tool `leave_note`, and read
  replies with `GET`. Fields: severity, stage, category, message, target, version, agent. 30 per hour
  per key, 16 KB, control and bidi characters stripped, anything that looks like a secret redacted,
  escaped on render. Admin: table with filters, acknowledge / resolve / reopen, reply
  (`GET /api/admin/notes`, `PATCH /api/admin/notes/<id>`). Blockers ring the bell. Teams see their own.

## [0.15.0] - 2026-10-21

### Added
- **Worker detail page** (`/team/workers/<name>`, admin `/admin/teams/<id>/workers/<name>`, AR and EN)
  with breadcrumbs and tabs: **Overview** (status, live URL with copy/open, MCP endpoint when the code
  serves `/mcp`, last deploy and by whom, size, SHA-256, var and secret *names*, health check, API-key
  requests in the last 7 days), **Versions** (roll back, download), **API keys**, **Settings**
  (require keys, limits, edit env vars, set/remove secrets, disable/enable, delete with confirmation)
  and **Activity**. Editing vars or secrets redeploys the latest stored code and is saved as a new
  version. A team cannot re-enable a Worker the admin disabled. The admin view is read-only for code.
- **Admin team detail** (`/admin/teams/<id>`): stats, members (change role, remove), spaces, Workers,
  agent keys (revoke), quotas and features including the Workers toggle, activity, and a danger zone
  (new team key, delete).
- **Space detail** (`/team/sites/<id>`, admin `/admin/sites/<id>`) with tabs: preview thumbnail (served
  privately), open/copy link, 30-day visits chart, files, a KV/uploads browser (view, delete),
  permanence and expiry, edit-token regeneration (shown once), MCP access, activity and delete.
- **Tables everywhere** (sites, recent, Workers, members, agent keys, recipes, admin teams, admin
  Workers, admin sites, activity): the whole row opens the detail page (mouse and keyboard), icon
  buttons plus a labelled ⋮ menu, more columns, sort, search, filters, pagination, empty states and a
  card view on phones.

- **Worker-to-Worker calls.** Deploys accept `compatibilityDate` and allowlisted
  `compatibilityFlags` (`global_fetch_strictly_public`, `nodejs_compat`, `nodejs_als`), plus
  `bindings`: service bindings to Workers of the **same team** only
  (`[{"name":"NEWS","worker":"news"}]` → `env.NEWS.fetch(…)`). Any other Worker, a script name,
  extra fields or another binding type is refused (400). These settings are kept on redeploy,
  stored in versions (a rollback restores them) and shown on the Worker page. To change them
  without sending code, use `POST …/workers/<name>/runtime`, the MCP tool `set_worker_runtime` or
  the Settings tab; the bound Worker is not touched. A Worker another one binds to cannot be
  deleted (`409 WORKER_BOUND`). The MCP-on-Worker recipe (v2, AR/EN) explains how to call another
  team Worker.

### Changed
- `/team/workers/<name>/versions` and `/keys` redirect to the matching tab; `/team/spaces/<id>` and
  `/admin/spaces/<id>` redirect to the space detail page.
- The Workers page is a table instead of cards; the admin overview's inline switches moved to the
  team detail page.

## [0.14.1] - 2026-10-21

### Changed
- **Exact Worker API-key limits by default.** `requireKey()` now asks Spaces on every request. Caching
  is opt-in with `requireKey(request, env, { cache: 30 })`. Each Worker isolate keeps its own cache, so
  with caching a key can go over its per-minute limit by up to its remaining quota per isolate
  (documented in the docs and the recipe, AR and EN).
- **Versioned helper URL** `/api/keys/helper.v2.js`. The old `/api/keys/helper.js` redirects there
  (302, no-cache), so CDNs cannot keep serving an old copy. The dashboard, docs and recipe use the new URL.
- **Fewer duplicate "new address" alerts for agent keys.** Uses are grouped by network (IPv4 /24,
  IPv6 /64, stored as keyed hashes). A network alerts at most once in 24 h, and is forgotten after
  30 days unused. A new network of the other IP family seen within 2 minutes of a known network (the
  same dual-stack client) is recorded without an alert. Keys from 0.14.0 adopt their next network
  without an alert.
- **Privacy policy (GDPR)** now names the controller (marsaplatform, Bologna, Italy,
  info@marsaplatform.com, Italian law). It also covers the purposes and legal bases, processors
  (Cloudflare), international transfers, retention, data-subject rights, and complaints to the Garante.
  Self-hosters set `OPERATOR_NAME`, `OPERATOR_ADDRESS`, `OPERATOR_LAW`, `OPERATOR_EMAIL`,
  `OPERATOR_AUTHORITY` and `OPERATOR_AUTHORITY_URL`.

## [0.14.0] - 2026-10-21

### Added
- **Worker versions, one-click redeploy and rollback.** Every deploy stores a version (code, vars,
  secret *names* only, who, when, size, SHA-256, note); the last 10 per Worker are kept. The Workers
  page has **Redeploy** and **Versions** (roll back with a confirmation, download the code). API:
  `GET …/workers/<name>/versions[/<n>[/code]]`, `POST …/redeploy`, `POST …/rollback`; MCP:
  `list_worker_versions`, `get_worker_version`, `redeploy_worker`, `rollback_worker`.
- **Agent keys**: per-team keys with scopes (`workers:read`, `workers:deploy`, `spaces:read`,
  `spaces:write`, `kv:read`, `kv:write`, `mcp`) and a required expiry (7/30/90 days or custom, max
  1 year). Shown once, stored hashed, prefix and last use visible, revocable. Accepted wherever the
  team key is (uploads, sites, KV/files, Workers, MCP) with the scopes enforced (`403
  INSUFFICIENT_SCOPE`). New `GET /api/teams/<team>/sites`.
- **Agent invite links**: one-time, 24 h; `GET` shows onboarding (Markdown or JSON), `POST
  …/claim` returns the key once. Rate-limited and audited.
- **Notification center**: a bell with an unread count for owners and the admin (deploys,
  rollbacks, deletes, agent keys, team key rotation, members, Cloudflare token, storage check).
  Optional team and platform **webhooks** (Slack/Discord-compatible JSON, HMAC-SHA256 signed, test
  button, 3 attempts).
- **API keys for a Worker's end users** (e.g. a team's public MCP server). Per Worker, opt-in
  **Require API keys**: Spaces sets the Worker secrets `MARSA_KEYS_URL` and `MARSA_KEYS_SECRET`;
  owners/editors create keys (`msk_…`, shown once, hashed, prefix visible) with a label, optional
  email, expiry, per-minute/per-day limits (or the Worker default), allowed tools; revoke; usage
  (today, 7 days, last use, 429s). The Worker checks each request with `POST /api/keys/verify`
  through a dependency-free helper (`/api/keys/helper.js`, `requireKey()`), which may cache an allow
  for up to 30 s and reports cached uses on the next check. API `…/workers/<name>/keys[/settings|/<id>]`,
  MCP `list_user_keys`, `create_user_key`, `revoke_user_key`, a dashboard tab, and alerts on key
  create/revoke and 429 spikes (10/100/1000 a day).
- **Agent recipes**: step-by-step playbooks (goal, when to use, steps, starter template, checklist,
  pitfalls) in Arabic and English. Five built-ins shipped in `docs/recipes/` (MCP server on a Worker,
  bilingual project page, security rules for agents, site KV & files, protecting an MCP with
  keys), plus team recipes (owners/editors, or an agent key with `spaces:write`) and platform
  recipes (admin). `GET /api/recipes[/<slug>?format=md]`, MCP `list_recipes`/`get_recipe`, a
  Recipes page in the team and admin dashboards, public `/docs/recipes`, and links in the agent
  invite onboarding.
- **Privacy policy** in English and Arabic at `/privacy` and `/ar/privacy`, linked from the footer,
  sign-in and join pages. Operator, address, jurisdiction and contact are marked placeholders.

### Changed
- A plain deploy of new code is recorded as `deploy` in the version history (one-click redeploy and
  rollback keep their own labels).
- Worker vars: 32 KB per var and 64 KB in total (was 5 KB per var). Vars over Cloudflare's 5 KB
  binding limit are delivered in a generated module merged into `env` by a small wrapper.
- Admin overview: the Workers count sits next to the Workers switch instead of under it.

## [0.13.1] - 2026-10-21

### Fixed
- When the data/files store fails (for example Cloudflare answers `401 Authentication error`
  because the server's API token lost its *Workers KV Storage* permission), the KV and files API
  now answer `503 BACKEND_UNAVAILABLE` with `Retry-After: 60` instead of a generic
  `500 INTERNAL`, so agents can tell a store outage from a bad request.

### Added
- `GET /api/admin/backend/check`: a live check of the KV and file stores with the reason when one
  fails (never includes credentials). The admin **Settings** page shows the same check.
- The server checks both stores at start and logs a clear `[backend] … FAILED` line.

## [0.13.0] - 2026-10-21

### Changed
- **Redesigned admin console and team dashboard** (same identity: Zad / IBM Plex Sans Arabic,
  Marsa green, light and dark):
  - One app shell for both: a sidebar (an off-canvas drawer on phones, RTL-correct, Esc/scrim to
    close), breadcrumbs, page titles with the page's main actions, and sign-out in the sidebar.
  - Team **Overview** (`/team`): stat cards for spaces and storage (with quota bars), views,
    members (+ pending invites) and Workers (with a quota bar); recent spaces; recent activity;
    quick publish.
  - New team pages: **Spaces** (`/team/sites`, full list with search and sortable columns),
    **Activity** (`/team/activity`, filter by actor kind and text) and **Settings**
    (`/team/settings`: team details, features, quotas and usage, API-key note, your password and
    sign-out-everywhere).
  - **Workers**: one card per Worker with status, live URL (copy), last deploy and who did it;
    quick **Redeploy** (pre-fills the deploy form) and delete; a collapsible deploy form (paste or
    upload `.js`, vars, write-only secrets); a copy-ready agent snippet with the team slug.
  - Admin **Overview** (`/admin`): platform stats (teams, spaces, Workers, views), a compact teams
    table with on/off switches (data backend, directory, permanent, Workers) and quotas inline;
    invite, key rotation (with a clear warning) and delete moved into a per-team "More" menu.
  - New admin pages: **Activity** (`/admin/activity`: every team's log plus the platform log,
    filters for team, actor kind and text) and **Settings** (`/admin/settings`: the Cloudflare
    card, still showing only the token's last 4 characters, and server configuration).
  - Feedback: confirmation dialogs for destructive actions, toasts for successes, busy states on
    submit, copy buttons for URLs, relative times ("3 hours ago" / "منذ ٣ ساعات") with the full
    date on hover. Everything still works without JavaScript.
- The overview's Workers switch changes only on/off; it never resets a team's Worker quotas.
- CSP allows the Cloudflare Web Analytics beacon (`static.cloudflareinsights.com`), which the edge
  injects and which was being blocked (a console error on every page).

## [0.12.0] - 2026-10-21

### Added
- **Team Workers.** Teams deploy Cloudflare Workers through Spaces without ever seeing a
  Cloudflare key:
  - The admin stores one Cloudflare API token (+ account and zone) under **Admin → Workers**. It is
    verified, encrypted at rest with AES-256-GCM (`MARSA_SECRETS_KEY`), write-only (only the last 4
    characters are shown) and never returned by any API or logged.
  - Per team: Workers on/off, a slug and quotas (`WORKERS_DEFAULT_MAX`=3 Workers, `WORKER_MAX_KB`=1024).
  - Forced names: script `team-<slug>-<name>`, address `https://<slug>-<name>.<zone>` (proxied
    `AAAA 100::` + a route), or workers.dev without a zone.
  - Spaces only modifies or deletes scripts, routes and DNS records it created (tracked in
    `workers.json`) and refuses names or hostnames that are already in use.
  - Team API with the team key: `GET/POST /api/teams/<team>/workers`, `GET/PUT/DELETE
    /api/teams/<team>/workers/<name>` (JSON or a raw `application/javascript` body; plain vars and
    write-only secrets).
  - Team dashboard → **Workers** (owners/editors deploy and delete; viewers read).
  - Space MCP tools `list_workers`, `deploy_worker`, `delete_worker` when Workers are on.
  - Admin: see all team Workers, disable/enable/delete them; turning Workers off or deleting a team
    removes its Workers. Activity-log entries in Arabic and English.
  - Docs: [Team Workers](docs/workers.md) and an Arabic guide section.

## [0.11.3] - 2026-10-20

### Fixed
- The site page's MCP snippets no longer widen the page on phones (375 px). The code blocks scroll
  inside their box instead.
- The Cursor snippet no longer claims to work in Claude Desktop. There is now a Claude Desktop
  snippet that uses `mcp-remote`, because the token goes in a header.

## [0.11.2] - 2026-10-20

### Fixed
- The Arabic activity log translates "team key" and "edit token" (and "admin") instead of showing
  the stored English labels.
- When you are signed in, the header (desktop and mobile menu), the footer, the home hero and the
  teams band link to **Team dashboard** (or **Admin console**) instead of "Team sign-in".
- `GET /covers/<id>` no longer 404s for a listed site without a usable cover image: it serves the
  same drawn placeholder the directory shows, as a self-contained SVG. Unlisted and unknown sites
  still answer 404.

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
