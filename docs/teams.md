# Teams, backend access and the public directory

Marsa has no user accounts. When an instance has an `ADMIN_TOKEN`, the operator can create
**teams** instead. Each team gets a **team key**, and the admin decides two things per team:

- **Backend access**: may the team's sites use the optional KV and files routes
  (`/api/sites/:id/kv`, `/api/sites/:id/files`)?
- **Show in public directory** (on by default): are the team's live sites listed on the homepage?

Guest uploads (no team key) keep working exactly as before. They never get backend access and are
never listed.

## The admin console

Open `https://marsa.example.com/admin` (Arabic: `/ar/admin`) and paste the instance's `ADMIN_TOKEN`.
The token is sent only to this instance's `/api/admin/*` routes and kept in this browser tab's
`sessionStorage` until you sign out or close the tab.

From the console you can:

1. **Create a team**: type a name, tick *Backend access* if the team should get KV/files, and
   leave *Show in public directory* ticked or untick it. Press **Create team**.
2. **Copy the team key** shown in the box. It is shown **once**. Marsa stores only its SHA-256.
3. **Toggle** *Backend access* or *Show in public directory* in the table. Changes apply to the
   next request.
4. **New key**: replaces the key. The old key stops working immediately; existing sites stay with
   the team.
5. **Delete**: removes the team. Its sites stay up as ordinary links (no backend, not listed) until
   they expire. Use the API with `?sites=delete` to remove them too.

## Uploading as a team

Send the team key with the upload, in `X-Team-Key` (or `Authorization: Bearer <team key>`):

```bash
curl -s -X POST "https://marsa.example.com/api/sites?ttlHours=72" \
  -H "X-Team-Key: $TEAM_KEY" \
  -H "Content-Type: application/zip" --data-binary @site.zip
# => { "id": "…", "url": "…", "editToken": "…", "team": { "id": "t_…", "name": "…", "backend": true }, … }
```

- A wrong or rotated team key answers `401 INVALID_TEAM_KEY` (it never silently falls back to guest).
- The site is then managed with its **edit token**, like any other site. The team key is only for
  creating sites.
- The `<title>` of `index.html` becomes the card title in the directory (else the site id).

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
then a grid of cards with the page title, the link and when it expires. The same data is public
JSON at `GET /api/directory` (cached for 30 seconds, CORS open):

```json
{ "generatedAt": "…",
  "teams": [ { "id": "t_…", "name": "Field notes",
    "sites": [ { "id": "k3v9x2mq7a", "title": "Weekly report",
      "url": "https://marsa.example.com/s/k3v9x2mq7a/", "createdAt": "…", "expiresAt": "…" } ] } ] }
```

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
