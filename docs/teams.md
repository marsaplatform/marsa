# Teams, backend access and the public directory

Marsa has no user accounts. When an instance has an `ADMIN_TOKEN`, the operator can create
**teams** instead. Each team gets a **team key**, and the admin decides two things per team:

- **Backend access**: may the team's sites use the optional KV and files routes
  (`/api/sites/:id/kv`, `/api/sites/:id/files`)?
- **Show in public directory** (on by default): are the team's live sites listed on the homepage?

Guest uploads (no team key) keep working exactly as before. They never get backend access and are
never listed.

## Signing in

Marsa Spaces has two browser sign-ins. Both create a **signed session cookie** (HMAC-SHA256 with
`SESSION_SECRET`, `HttpOnly`, `Secure` on HTTPS with the `__Host-` prefix, `SameSite=Lax`). No key or
token is stored in the browser.

| Who | Where | With | Session |
| --- | --- | --- | --- |
| Team member | `/login` (Arabic `/ar/login`) | the team key | `SESSION_TTL_HOURS` (default 7 days) |
| Admin | `/admin/login` (Arabic `/ar/admin/login`) | `ADMIN_TOKEN` | `ADMIN_SESSION_TTL_HOURS` (default 12 hours) |

- Sign-in attempts are rate-limited per client IP (`LOGIN_ATTEMPTS_PER_15_MIN`, default 10).
- Every form that changes something carries a CSRF token bound to the session, and the request must
  come from this instance (Origin / `Sec-Fetch-Site`). Uploaded pages run in a sandbox and can't use
  the session.
- **Sign out** ends the session at once. Rotating a team key or deleting the team signs its members
  out; changing `ADMIN_TOKEN` or `SESSION_SECRET` signs everyone out.
- Without `SESSION_SECRET`, a random secret is generated at start, so sessions end on every restart.
  Set one in production: `openssl rand -hex 32`.

## The team dashboard

After signing in, a team member lands on `/team` (or `/ar/team`):

- **Status**: the team name, how many sites are live, whether *data and files* are on for the team (and
  whether the server has a backend configured), and whether the team is listed on the home page.
- **Live sites**: title, link, expiry, size and home-page visibility, with **Manage** and **Delete**.
- **Publish a new site**: drag and drop files, a folder or one `.zip`, or pick them, then choose when
  it expires (within the instance limits).
- **Manage a site** (`/team/sites/<id>`): copy the link, **extend** the expiry (never past created +
  `MAX_TTL_HOURS`), **hide from / show on the home page**, **replace the files** (same link), **delete**,
  see the published files, and, for teams with backend access, a small **browser of the site's KV
  values and uploaded files** with delete buttons.
- **Snippets for agents**: a `curl` call and a prompt using `$MARSA_TEAM_KEY` (never the real key).

Team sites are managed through the session: nobody on the team needs the per-site edit token.
Every site still has one (only its hash is stored), so scripts keep using `PUT/PATCH/DELETE
/api/sites/:id` with the token returned at upload time. Sites a team published through the API with
`X-Team-Key` appear in its dashboard too.

## The admin console

Sign in at `/admin/login` with `ADMIN_TOKEN`. The console has two tabs:

1. **Teams** (`/admin`): create a team (name, *Data and files*, *On home page*). The **team key is
   shown once** after creating or rotating; Marsa stores only its SHA-256. Each row has switches for
   *Data and files* and *On home page* (they apply to the next request), **New key** (the old key and
   its sessions stop at once) and **Delete** (optionally with its sites; otherwise they stay up as
   ordinary links until they expire).
2. **All sites** (`/admin/sites`): every live site with its owner (a team or *Guest*), link, expiry and
   size. Filter by team or guests only, and delete any site.

## Uploading as a team

Send the team key with the upload, in `X-Team-Key` (or `Authorization: Bearer <team key>`):

```bash
curl -s -X POST "https://marsa.example.com/api/sites?ttlHours=72" \
  -H "X-Team-Key: $TEAM_KEY" \
  -H "Content-Type: application/zip" --data-binary @site.zip
# => { "id": "…", "url": "…", "editToken": "…", "team": { "id": "t_…", "name": "…", "backend": true }, … }
```

- A wrong or rotated team key answers `401 INVALID_TEAM_KEY` (it never silently falls back to guest).
- The site is managed from the team dashboard, or with its **edit token** through the API. The team
  key itself is only for creating sites and for signing in.
- The `<title>` of `index.html` becomes the card title in the directory (else the site id).

## Permanent sites and quotas

By default every link expires (1 hour to `MAX_TTL_HOURS`). A team the admin allows can also publish
**permanent** sites that never expire and are never swept.

- **Who:** the per-team flag *Permanent* (admin console, or `"permanent": true` in the admin API). It
  defaults to the team's *Data and files* (backend) access, because those are the teams that run
  real apps; the admin can turn it on or off for any team. Guests can never publish permanent sites.
- **Publish permanent:** pick **Permanent (no expiry)** in the dashboard's expiry picker, or send
  `?ttlHours=permanent` (also `?permanent=1`, or `"ttlHours": "permanent"` / `"permanent": true` in a
  JSON upload) with the team key.
- **Convert:** **Make permanent** on the site page, or `PATCH /api/sites/<id>` with
  `{"permanent": true}` and the edit token. To make it a timed link again pick a time and press
  **Extend** (or `PATCH` with `{"ttlHours": N}`); its maximum lifetime then counts from that moment.
- **Admin:** *All sites* has a **Permanent sites** filter and a **Revoke permanent** button; the
  API is `PATCH /api/admin/sites/<id>` with `{"permanent": false}` (or `true` for any team site).
  A revoked site gets `MAX_TTL_HOURS` from now, so its team has time to react.
- In the API a permanent site has `"permanent": true` and `expiresAt` `9999-12-31T00:00:00.000Z`
  (a real date, so clients that compare dates keep working).

**Quotas** keep permanent from meaning unbounded. Each team may have at most `TEAM_MAX_SITES` live
sites (default 50) using at most `TEAM_MAX_MB` (default 200 MB) in total, permanent or not. The admin
can override both per team (the *Quota* fields in the console, or `maxSites` / `maxMb` in the admin
API; empty, `0` or `null` goes back to the default). An upload or a replace that would go over answers
`403 TEAM_QUOTA_EXCEEDED`; the dashboard shows the team's usage. Guest uploads are limited as before
(size limits, uploads per hour, and they expire).

Size the quotas to your disk: every team's quota together should fit the data volume with room for
guest uploads.

## Visit counts

The dashboard shows each site's page views for the last 7 and 30 days, with a sparkline. The site
page adds a per-day chart and approximate visitor counts. *All sites* in the admin console shows the
same figures for every site.

- **Private by design.** Counting happens on this server: no cookies, no IP addresses or user agents
  stored, no third parties, and nothing added to the published pages.
- **What counts:** successful `GET` requests for HTML pages under `/s/<id>/`. Assets don't count,
  and neither do bots, link-preview fetchers (WhatsApp, Telegram, Slack…), headless browsers,
  scripts (`curl`, `python-requests`…) or prefetches.
- **Visitors (approx.):** within one UTC hour, a visitor is a distinct `sha256(hourly salt + site +
  IP + user agent)`. The salt is random, held in memory only and replaced every hour, so the hashes
  can't be linked across hours or recomputed later. Only the daily totals are kept, so one person
  who comes back in a later hour counts again. With Do Not Track or Global Privacy Control, a visit
  counts as a view only.
- **Storage:** counts are buffered in memory and flushed every `VISITS_FLUSH_SECONDS` (60 s), and on
  shutdown, to `sites/<id>/visits.json` as `{"v":1,"days":{"YYYY-MM-DD":[views,visitors]}}`.
  - They never touch the KV backend and its daily write limit.
  - Days older than `VISITS_RETENTION_DAYS` (90) are dropped.
  - Deleting a site, or its expiry, deletes its counts.
- If the server crashes, up to one flush interval of counts can be lost. Set `VISITS=false` to turn
  counting off.

## Who may use the backend

| Site | Backend configured | Backend **not** configured |
| --- | --- | --- |
| Team with backend access | Works (edit token for writes) | `503 BACKEND_NOT_CONFIGURED` |
| Team without backend access | `403 BACKEND_NOT_ALLOWED` | `403 BACKEND_NOT_ALLOWED` |
| Guest upload | `403 BACKEND_NOT_ALLOWED` | `403 BACKEND_NOT_ALLOWED` |

The check runs on every request, so turning a team's access off blocks its sites at once.
Real KV/files storage still needs the `CLOUDFLARE_*` / `R2_*` variables (see [the backend guide](backend.md)).
To go back to the old open policy (every site may use the backend) set `BACKEND_GUEST_ACCESS=true`.

## The public directory

The homepage (`/` and `/ar`) shows a **Published by teams** section: one heading per listed team,
then a grid of image cards: a preview picture, the page title, the link and when it expires. Above it,
one page is **Featured** in a large card (see `FEATURED_SITES` below). The same data is public JSON at
`GET /api/directory` (cached for 30 seconds, CORS open):

```json
{ "generatedAt": "…", "featured": ["k3v9x2mq7a"],
  "teams": [ { "id": "t_…", "name": "Field notes",
    "sites": [ { "id": "k3v9x2mq7a", "title": "Weekly report",
      "url": "https://marsa.example.com/s/k3v9x2mq7a/", "createdAt": "…", "expiresAt": "…",
      "cover": "/covers/k3v9x2mq7a?v=1a2b3c4d5e" } ] } ] }
```

### Cover images (the card picture)

Marsa never takes screenshots and never downloads anything from elsewhere. The card picture is an
image that is **already in your upload**. It picks the first of:

1. a file named `cover.png`, `cover.jpg`, `cover.jpeg`, `cover.webp`, `cover.avif` or `cover.gif`
   at the root of the site (next to `index.html`);
2. the page's `<meta property="og:image" content="…">` (or `twitter:image`) in `index.html`, if it
   points to a file inside the site (`img/share.png`, `/s/<id>/img/share.png` or the full link of
   this site all work; links to other websites are ignored);
3. the first `<img src="…">` in `index.html` that points to a file inside the site.

The image must be PNG, JPEG, WebP, AVIF or GIF (not SVG) and at most 2 MB; a 1200×675 (16:9) picture
looks best. Otherwise the card shows a drawn placeholder with the first letter of the title, in a
colour of the team. To set or change a cover, add `cover.png` to the site and **replace the files**
from the team dashboard (same link) or re-upload; the card updates within 30 seconds.

Covers are served from `GET /covers/<id>` only for listed, live sites, with
`Content-Security-Policy: default-src 'none'; sandbox`, `nosniff` and a check that the file really is
the image type it claims to be.

### The featured page

`FEATURED_SITES=<id>[,<id>…]` (server environment) pins the page shown in the **Featured** card: the
first id that is live and listed. Without it (or when those pages are gone) the newest listed page is
featured. Nothing is featured when the directory is empty.

Only live (not expired) sites of teams with *Show in public directory* on appear. Guest uploads,
edit tokens, team keys and hashes are never included. Teams with no live sites are left out.

## Admin API

All calls need `Authorization: Bearer $ADMIN_TOKEN`. Keys appear only in the create and rotate
responses.

```bash
BASE=https://marsa.example.com; AUTH="Authorization: Bearer $ADMIN_TOKEN"

# List teams (with live site counts)
curl -s "$BASE/api/admin/teams" -H "$AUTH"

# Create a team with backend access, listed in the directory
curl -s -X POST "$BASE/api/admin/teams" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"name": "Research desk", "backend": true, "directory": true}'
# => 201 { "team": { "id": "t_…", … }, "key": "marsa_team_…" }

# Rename, toggle backend or directory
curl -s -X PATCH "$BASE/api/admin/teams/t_abc12345" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"backend": false}'

# New key (old one stops working)
curl -s -X POST "$BASE/api/admin/teams/t_abc12345/rotate" -H "$AUTH"

# Delete the team (add ?sites=delete to also delete its sites)
curl -s -X DELETE "$BASE/api/admin/teams/t_abc12345" -H "$AUTH"
```

Teams are stored in `DATA_DIR/teams.json` (written atomically, mode 600). Back it up with the
rest of `DATA_DIR`.
