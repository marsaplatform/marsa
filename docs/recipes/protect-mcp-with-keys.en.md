---
title: Protect your MCP with Spaces keys
summary: Turn on "Require API keys" for a Worker, hand out per-user keys with rate limits and tool lists, and check them with a 40-line helper.
version: 2
updated: 2026-10-21
tags: mcp, workers, security, keys
order: 5
---
## Goal

Only people you gave a key to can call your MCP server (or any team Worker), each with their own rate limit (per minute and per day), optional allowed tools, expiry, usage stats and one-click revoke. Spaces stores the keys (hashed) and counts usage; your Worker asks Spaces on each request.

## When to use

- Your MCP calls paid or rate-limited upstreams, or you want to know who uses it.
- You want to share with partners without opening it to the whole internet.

## How it works

1. You turn on **Require API keys** for the Worker (Team → Workers → *API keys*, or the API). Spaces injects two Worker secrets: `MARSA_KEYS_URL` (the verify endpoint) and `MARSA_KEYS_SECRET` (a per-Worker verifier, never shown).
2. You create keys for your users (`msk_…`, shown once, stored hashed). Each key can have its own per-minute/per-day limits (otherwise the Worker defaults apply), an expiry and a list of allowed tools.
3. Your Worker reads the caller's key (`Authorization: Bearer msk_…` or `X-Api-Key`) and calls `POST $MARSA_KEYS_URL` with `{key, tool, uses}`. Spaces answers `allow`, `status` (200/401/403/429), `remaining` and `tools`, and counts the request.
4. By default the helper asks Spaces on **every** request, so limits are exact. Caching is opt-in: `requireKey(request, env, { cache: 30 })` keeps an allow for up to 30 s (never past the minute quota or Spaces' `cacheSeconds`) and reports the cached uses on the next check.

**Honest limits:** counting happens in the Spaces server (in memory, saved every ~15 s), so a Spaces restart can lose a few seconds of counts. If you turn caching on, each Worker isolate keeps its own cache and Cloudflare may run several isolates at once, so a key can go over its per-minute limit by up to its remaining quota per isolate within the cache window (in a live test at 3/min, 4–5 requests got through before the 429s). If Spaces is unreachable the helper fails closed (503) unless you pass `failOpen: true`.

## Steps

1. Deploy your MCP Worker as usual (see *MCP server on a Spaces Worker*).
2. Add the helper to your code (it has no dependencies):
   ```sh
   curl -s https://marsa.example.com/api/keys/helper.v2.js > marsa-keys.js
   cat marsa-keys.js worker.js > bundle.js   # or import it and bundle with esbuild
   ```
3. Call `requireKey()` at the top of `/mcp` (and pass the tool name for `tools/call`, so per-key tool lists apply).
4. Redeploy, then turn on **Require API keys** and set the Worker defaults (e.g. 60/min, 5000/day).
5. Create a key per user (label + optional email), send it to them privately, and tell them to send it as `Authorization: Bearer <key>` (MCP clients: a `headers` entry in the server config).
6. Watch usage (requests today / 7 days, last used, 429s) on the API keys tab. Spaces notifies owners when a key is created or revoked and when 429s spike (10, 100, 1000 a day).

API equivalents (team key or an agent key with `workers:deploy`; reads need `workers:read`):

```sh
T=https://marsa.example.com/api/teams/<team>/workers/<name>
curl -s -X PUT  $T/keys/settings -H "X-Team-Key: $K" -H 'content-type: application/json' -d '{"required":true,"perMinute":60,"perDay":5000}'
curl -s -X POST $T/keys -H "X-Team-Key: $K" -H 'content-type: application/json' -d '{"label":"Partner A","email":"a@example.org","expiresInDays":90,"perMinute":30,"tools":["search_items"]}'
curl -s        $T/keys -H "X-Team-Key: $K"          # list + usage
curl -s -X DELETE $T/keys/<keyId> -H "X-Team-Key: $K" # revoke
```

The space MCP has the same as tools: `list_user_keys`, `create_user_key`, `revoke_user_key`.

## Starter template

```js
// worker.js (after the helper from /api/keys/helper.v2.js)
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
    if (url.pathname !== "/mcp") return new Response("not found", { status: 404 });
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const msg = await request.clone().json().catch(() => null);
    const tool = msg?.method === "tools/call" ? String(msg.params?.name ?? "") : "";
    const gate = await requireKey(request, env, { tool });
    if (!gate.ok) return gate.response; // 401 no/invalid/revoked/expired key, 403 tool not allowed, 429 over limit
    return handleMcp(msg, env, gate.keyId); // your JSON-RPC handler
  },
};
```

## Checklist before deploy

- [ ] The helper is in the bundle and `/mcp` calls `requireKey()` before any work.
- [ ] `tools/call` passes the tool name; `initialize`/`tools/list` work for any valid key.
- [ ] Require API keys is ON and the Worker defaults are set.
- [ ] Live: no key → 401; a valid key → 200; over the limit → 429; revoked key → 401.
- [ ] Keys were sent to users privately; none appear in code, vars, pages or chat logs.

## Common pitfalls

- **Turning keys on before the helper is deployed**: the Worker still answers everyone (Spaces cannot block requests the Worker does not check).
- **Checking the key after doing the work**: always gate first.
- **Logging the `Authorization` header** in the Worker: never log keys.
- **Turning on `cache` and expecting exact counts**: leave `cache` off (the default) when the limit must be exact; use `{ cache: 30 }` only for high-traffic Workers that can accept some overshoot.
- **Using an old copy of the helper** (from `/api/keys/helper.js` before 0.14.1): it caches by default. Download `/api/keys/helper.v2.js` again.
- **Using `failOpen: true`** on something expensive: if Spaces is unreachable everyone gets in.
