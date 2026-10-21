---
title: Using site KV and files
summary: Store small JSON and uploads next to a published page: limits, key design, the browser SDK, and retries on 503 BACKEND_UNAVAILABLE.
version: 1
updated: 2026-10-21
tags: kv, files, sites
order: 4
---
## Goal

Give a static page or an agent a small, durable data store: JSON values in **site KV** and uploaded files in **site files**, both scoped to one site and backed by Cloudflare Workers KV and R2.

## When to use

- A page needs state: a counter, a sign-up list you will export, a cached feed, a config the agent updates.
- An agent publishes a report and attaches the source files.
- Not for: large datasets (use a file or an upstream API), private data (reads are public by default), or high write rates (KV allows about one write per second per key).

## Steps

1. **Check it is on.** The site must belong to a team with the data/files backend enabled (the admin turns it on per team). `GET /api/sites/<id>/kv` should answer 200, not `403 BACKEND_NOT_ALLOWED`.
2. **Know the limits:** values up to 64 KB of JSON; 1000 keys and 100 files per site; files up to the instance's max file size; keys are 1–128 chars of `A-Z a-z 0-9 . _ : -`. Cloudflare's REST limit (1,200 calls per 5 minutes for the whole instance) is shared by all sites.
3. **Design keys** like paths with `:` or `.`: `config`, `feed:latest`, `items:2026-10-21`, `stats.daily`. One value per thing you read together; don't put a growing list in one key (it will hit 64 KB) and don't create one key per page view (it will hit 1000 keys).
4. **Read from the page** with the SDK (no token needed for reads):
   ```html
   <!-- inside your published site: /sdk.js knows which site it is on -->
   <script src="/sdk.js"></script>
   <script>
     marsa.kv.get("config").then((cfg) => { /* render */ }).catch(() => { /* show "temporarily unavailable" */ });
   </script>
   ```
5. **Write from an agent or script** with the site's edit token (or the team/agent key with `kv:write`), never from the public page:
   ```sh
   curl -s -X PUT "https://marsa.example.com/api/sites/<id>/kv/config" \
     -H "Authorization: Bearer $MARSA_EDIT_TOKEN" -H "Content-Type: application/json" \
     -d '{"value": {"title": "Weekly feed", "updated": "2026-10-21"}}'
   ```
6. **Retry on 503.** When the storage backend is unreachable, Spaces answers `503 BACKEND_UNAVAILABLE` (with `Retry-After`). Treat it as temporary: retry with backoff (1 s, 2 s, 4 s, max 3–4 tries), then show a friendly "data temporarily unavailable" and keep the page working. `429 RATE_LIMITED` means slow down: honour `Retry-After`.
7. **Files:** upload with `POST /api/sites/<id>/files` (multipart field `file`), list with `GET …/files`, link with the returned `url`. Delete what you no longer need; files count against the 100-file cap.

## Starter template

```js
// kv.js: tiny client with retries for 503/429 (Node 18+, Deno, Workers)
const BASE = "https://marsa.example.com/api/sites";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function kv(site, method, key, value, token) {
  const url = `${BASE}/${site}/kv/${encodeURIComponent(key)}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        "user-agent": "my-agent/1.0",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(value !== undefined ? { body: JSON.stringify({ value }) } : {}),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 503 || res.status === 429) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || 1000 * 2 ** attempt;
      await sleep(Math.min(wait, 10_000));
      continue;
    }
    if (res.status === 404 && method === "GET") return null;
    if (!res.ok) throw new Error(`KV ${method} ${key}: ${res.status} ${await res.text()}`);
    return method === "GET" ? (await res.json()).value : true;
  }
  throw new Error("storage temporarily unavailable (503), try again later");
}

// usage:
// await kv("<id>", "PUT", "feed:latest", { items: [...] }, process.env.MARSA_EDIT_TOKEN);
// const feed = await kv("<id>", "GET", "feed:latest");
```

## Checklist before deploy

- [ ] `GET /api/sites/<id>/kv` answers 200 for the site.
- [ ] No token in the published page; writes happen from an agent/script.
- [ ] Nothing private stored (reads are public by default).
- [ ] Each value stays well under 64 KB; the number of keys is bounded.
- [ ] Reads and writes retry on 503/429 and the page has a fallback message.
- [ ] Old keys/files are deleted by the job that creates them.

## Common pitfalls

- **One ever-growing key** (a log in one value) hits `VALUE_TOO_LARGE`; shard by date.
- **One key per visitor/event** hits `TOO_MANY_KEYS`; aggregate.
- **Writing the same key many times per second**: KV accepts ~1 write per second per key; batch.
- **Edit token in client JS**: anyone can then overwrite or delete your data. Rotate it if it leaked (re-publish).
- **Treating 503 as fatal**: storage outages happen; retry and degrade gracefully.
- **Expecting instant global reads**: KV is eventually consistent; a value written now can take up to ~60 s to show everywhere.
