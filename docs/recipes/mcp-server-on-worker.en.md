---
title: MCP server on a Spaces Worker
summary: Ship a remote MCP server (Streamable HTTP at /mcp) as a team Worker, with secrets, caching and a live check.
version: 2
updated: 2026-10-21
tags: mcp, workers
order: 1
---
## Goal

A public (or key-protected) MCP server at `https://<team>-<name>.marsaplatform.com/mcp` that any MCP client can add by URL. It runs as a team Worker deployed through Spaces, so nobody needs a Cloudflare account or key.

This is the shape that worked for the Atlas, Malja and Sanad news servers: one process, stateless Streamable HTTP, JSON responses, a `/health` route, and a small, well-described tool set.

## When to use

- You have data or an API that agents should query (search, lookup, a feed) and you want one URL to share.
- The work per request is short (a few upstream fetches). Long jobs, websockets or a database server are not a fit for a Worker.
- Your team has Workers turned on (ask the admin) and you hold the team key or an agent key with `workers:deploy`.

## Steps

1. **Design the tools first.** 3–7 tools, each doing one thing. Name them with verbs (`search_reports`, `get_report`). Give every parameter a type and a one-line description, and return compact JSON (ids, titles, URLs), not whole pages. Mark read-only tools with `annotations: { readOnlyHint: true }`.
2. **Structure the Worker** as ONE ES module with `export default { async fetch(request, env, ctx) { … } }` (an object, not a class). Routes:
   - `POST /mcp`: JSON-RPC (`initialize`, `notifications/initialized`, `tools/list`, `tools/call`, `ping`). Answer with `Content-Type: application/json` (stateless, no sessions).
   - `GET /mcp`: `405` (no server-sent stream). Clients handle that.
   - `GET /health`: `{"ok":true,"version":"…"}`.
   - `GET /`: a short human page or a redirect to your project page on Spaces.
3. **Bundle to a single module.** If you use npm packages, bundle (`esbuild src/index.ts --bundle --format=esm --platform=neutral --outfile=worker.js`) and check the output still has `export default`. Keep it under your team's script limit (default 1024 KB).
4. **Secrets go to Spaces, never into code.** Upstream API tokens are sent as `secrets` on deploy (write-only; the team sees only their names). Non-secret settings go in `vars` (up to 32 KB each, 64 KB total since 0.14.0; larger values are delivered through a generated module, the Worker still reads `env.NAME`).
5. **Set a fixed User-Agent** on every upstream `fetch` (for example `marsa-mcp-<name>/1.0 (+https://<your page>)`). Several public data APIs block or throttle requests without one.
6. **Cache cold-start work.** Keep parsed reference data in a module-level variable (it lives as long as the isolate), and cache upstream GET responses with `caches.default` for a few minutes. Never cache per-user answers.
7. **Fail gracefully.** If an upstream or the site KV answers `503 BACKEND_UNAVAILABLE` or times out, return a tool result with `isError: true` and a clear message ("source temporarily unavailable, try again in a minute"), not an exception. Use `AbortSignal.timeout(8000)` on fetches.
8. **Test locally** with `npx wrangler dev worker.js` (or `node --test` on your handlers), then call it with the JSON-RPC requests in the checklist.
9. **Deploy through Spaces:**
   ```sh
   curl -s -X PUT "https://marsa.example.com/api/teams/<team>/workers/<name>" \
     -H "X-Team-Key: $MARSA_AGENT_KEY" -H "Content-Type: application/json" \
     --data-binary @deploy.json   # {"code": "...", "vars": {...}, "secrets": {...}, "note": "v1"}
   ```
   Every deploy is kept as a version (last 10): you can redeploy or roll back from the dashboard, the API or MCP.
10. **Verify live** (below), then share the URL. To limit who can call it, see the recipe *Protect your MCP with Spaces keys*.

## Starter template

```js
// worker.js: a minimal stateless MCP server (no dependencies)
const VERSION = "1.0.0";
const UA = "marsa-mcp-example/1.0 (+https://marsa.example.com)";
const TOOLS = [
  {
    name: "search_items",
    description: "Search the catalogue by keyword. Returns up to 10 {id, title, url}.",
    inputSchema: { type: "object", properties: { q: { type: "string", description: "Keywords" } }, required: ["q"] },
    annotations: { readOnlyHint: true },
  },
];
let cache = null; // module-level: survives between requests in the same isolate

async function loadData(env) {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.data;
  const res = await fetch(env.DATA_URL, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`source answered ${res.status}`);
  cache = { at: Date.now(), data: await res.json() };
  return cache.data;
}

async function callTool(name, args, env) {
  if (name !== "search_items") throw new Error(`unknown tool: ${name}`);
  const q = String(args?.q ?? "").toLowerCase();
  const data = await loadData(env);
  return data.filter((x) => x.title.toLowerCase().includes(q)).slice(0, 10);
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true, version: VERSION });
    if (url.pathname !== "/mcp") return new Response("MCP endpoint: /mcp", { status: 404 });
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
    const msg = await request.json().catch(() => null);
    if (!msg || msg.jsonrpc !== "2.0") return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
    if (msg.id === undefined) return new Response(null, { status: 202 }); // notifications
    const reply = (result) => json({ jsonrpc: "2.0", id: msg.id, result });
    switch (msg.method) {
      case "initialize":
        return reply({ protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "example", version: VERSION } });
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: TOOLS });
      case "tools/call":
        try {
          const out = await callTool(msg.params?.name, msg.params?.arguments, env);
          return reply({ content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: { items: out } });
        } catch (e) {
          return reply({ content: [{ type: "text", text: `Temporarily unavailable: ${e.message}. Try again shortly.` }], isError: true });
        }
      default:
        return json({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } });
    }
  },
};
```

## Calling another Worker of your team (0.15.0)

A Worker on `marsaplatform.com` cannot simply `fetch("https://<team>-news.marsaplatform.com")`. That host is on the same Cloudflare zone, so by default the request goes to the zone's origin instead of the other Worker. Use one of these two ways:

1. **Service binding (preferred)**: a direct call that never leaves Cloudflare and has no public round trip. You can only bind to Workers of **your own team**; Spaces refuses any other Worker or script.
   ```json
   PUT /api/teams/<team>/workers/morassel
   { "code": "…", "bindings": [{ "name": "NEWS", "worker": "news" }] }
   ```
   ```js
   const res = await env.NEWS.fetch(new Request("https://news/latest?limit=5"));
   ```
   The host in the URL is ignored; the path and query reach the other Worker as they are.
2. **Public URL**: turn on the `global_fetch_strictly_public` flag. `fetch()` then goes out through the internet like any outside client, so it passes the other Worker's API keys and limits.
   ```json
   { "code": "…", "compatibilityFlags": ["global_fetch_strictly_public"] }
   ```

To change only these settings without sending the code again, use `POST /api/teams/<team>/workers/<name>/runtime` with `{"compatibilityFlags": […], "bindings": […]}`. You can also use the MCP tool `set_worker_runtime`, or the Worker's **Settings** tab. Spaces redeploys the newest stored code as a new version and leaves the bound Worker unchanged. Allowed flags are `global_fetch_strictly_public`, `nodejs_compat` and `nodejs_als`. You can set `compatibilityDate` (YYYY-MM-DD). You cannot delete a Worker while another one binds to it (`409 WORKER_BOUND`).

## Checklist before deploy

- [ ] One module, `export default { fetch }` (object), bundle size under the team limit.
- [ ] No token, password or key anywhere in the code or in `vars`; they are `secrets`.
- [ ] Every upstream fetch has a User-Agent and a timeout.
- [ ] `/health` answers 200; `GET /mcp` answers 405; unknown paths 404.
- [ ] Tool descriptions say what comes back and how many items.
- [ ] Local run passes `initialize` and `tools/list`.
- [ ] A note on the deploy (`"note": "v1: first release"`) so the version list makes sense.
- [ ] After deploy, live checks:
  ```sh
  U=https://<team>-<name>.marsaplatform.com
  curl -s $U/health
  curl -s $U/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"1"}}}'
  curl -s $U/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
  ```

## Common pitfalls

- **`fetch()` to another team Worker returns the wrong thing or 5xx**: on the same zone, a plain fetch goes to the origin. Use a service binding or `global_fetch_strictly_public` (see above), not a VPN detour.
- **`NOT_A_MODULE`**: the code is a service-worker script (`addEventListener("fetch")`) or the bundle lost `export default`.
- **A class default export** (`export default class extends WorkerEntrypoint`) cannot receive vars over 5 KB; use an object export.
- **Var too large** (Sanad news hit the old 5 KB limit): since 0.14.0 a var can be 32 KB (64 KB total). Bigger data belongs in site KV/files or an upstream URL.
- **Streaming by default**: some MCP libraries answer with SSE and keep sessions in memory. In a Worker, use stateless JSON responses.
- **No User-Agent**: upstream returns 403/429 only in production.
- **Secrets pasted into `vars` or code**: anyone on the team can read vars, and versions keep code. Rotate the secret if it happened.
- **Every request re-downloads reference data**: cache at module level and with `caches.default`.
- **Throwing inside a tool**: the client sees a protocol error instead of a readable message; return `isError: true`.
