# Managing a site with its token

There are no accounts in Marsa. The **edit token** returned at upload is the only key to a site.
Marsa stores just its SHA-256 hash, so keep the token somewhere safe if you need it later.

## In the browser

The uploader saves each site you create (link, expiry, token) in your browser's `localStorage`.
The **Your drops in this browser** list lets you open or delete them. Clearing browser data forgets
the tokens, but the sites stay up until they expire.

## With the API

```bash
TOKEN="marsa_…"; ID="k3v9x2mq7a"; BASE=https://marsa.example.com

# See what's live
curl -s "$BASE/api/sites/$ID" -H "Authorization: Bearer $TOKEN"

# Replace every file (link and expiry stay the same)
curl -s -X PUT "$BASE/api/sites/$ID" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/zip" --data-binary @site.zip

# Change the expiry to 48 hours from now (capped at created + MAX_TTL_HOURS)
curl -s -X PATCH "$BASE/api/sites/$ID" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"ttlHours": 48}'

# Delete right now
curl -s -X DELETE "$BASE/api/sites/$ID" -H "Authorization: Bearer $TOKEN"
```

## Rules

- A link can never live longer than its creation time plus the instance's `MAX_TTL_HOURS`
  (7 days by default), however often you extend it.
- Once a site has expired it can't be revived: upload it again for a new link.
- Updating counts towards the per-hour upload limit.
- Lost the token? Wait for expiry, or ask the instance operator, who can delete any site with the
  admin token.
