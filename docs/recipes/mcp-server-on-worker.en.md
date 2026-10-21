---
title: MCP server on a Spaces Worker
summary: The recommended way to build and ship a remote MCP server on Spaces. TypeScript, Hono and the official MCP SDK in a starter you can download, deployed without wrangler, with tests and a live check.
version: 4
updated: 2026-10-21
tags: mcp, workers, typescript, hono, starter
order: 1
---
## Start here

**Download the starter:** [`starter.zip`](/api/recipes/mcp-server-on-worker/starter.zip). The file tree is shown above. It builds, passes its own tests, and was deployed to a temporary team through the Spaces API before this release.

```sh
curl -sLo starter.zip https://marsa.example.com/api/recipes/mcp-server-on-worker/starter.zip
unzip starter.zip -d my-mcp && cd my-mcp && npm install && npm run check
```

## Goal

You want a remote MCP server at `https://<team>-<name>.marsaplatform.com/mcp` that any MCP client can add by URL. It runs as a team Worker deployed through Spaces, so nobody needs a Cloudflare account, token or wrangler login. It works with Spaces keys, versions, rollback, bindings and the dashboard's MCP servers page.

## Which stack (honest recommendation)

| | Recommended: **TypeScript + Hono on Workers** | Python (self-hosted) |
|---|---|---|
| Where it runs | A Spaces Worker: no server to run, global, free cold starts | Your own VM or container (see *Python MCP server, self-hosted*) |
| MCP library | `@modelcontextprotocol/sdk` (official) + zod | `mcp` / FastMCP |
| Good for | Search/lookup tools over HTTP APIs, feeds, small reference data | pandas/numpy/scikit, large files, long jobs, a database next to it |
| Limits | One ES module, CPU-time limits, no native modules, bundle ≤ team quota (1 MB default) | You run patching, TLS, uptime and scaling yourself |

What we found in real repos: **Atlas, Malja and ERX** all use the official SDK + zod. Atlas runs on Workers with `WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })`, the `CfWorkerJsonSchemaValidator` and one fresh `McpServer` per request; it uses Bun for dev and tests and wrangler to deploy. Malja and ERX use Node + tsx + vitest. **None of them uses Hono**. The starter adds Hono only for routing (`/`, `/health`, `/mcp`, 404, CORS). It costs about 56 KB and keeps the code readable as routes grow. If you prefer, plain `fetch` routing works the same way.

**Bun** is fine on your machine (`bun install`, `bun run build:bun`, `bun x vitest run`). What you deploy must always be **one Workers ES module** (`dist/worker.js` with `export default { fetch }`). Do not deploy Bun- or Node-only APIs (`Bun.*`, `fs`, `child_process`).

## Folder structure

```
my-mcp-worker/
├── src/
│   ├── index.ts            # Hono app: /, /health, POST /mcp, GET/DELETE /mcp → 405, 404; export default { fetch }
│   ├── env.d.ts            # Env bindings/vars/secrets types
│   ├── mcp/server.ts       # createServer(): a new McpServer per request; TOOL_NAMES
│   ├── tools/<tool>.ts     # one file per tool: zod input, pagination, Arabic matching, ok()/fail()
│   ├── lib/http.ts         # fetchJson(): fixed User-Agent, timeout, retries on 429/5xx, UpstreamError
│   ├── lib/cache.ts        # cached(key, ttl, fn): per-isolate memo
│   ├── lib/arabic.ts       # normalize()/matches(): alef/yaa/taa marbuta, diacritics, tatweel
│   ├── lib/result.ts       # tool result shapes
│   ├── i18n/index.ts       # ar + en messages
│   └── data/               # sample data (replace with your source)
├── test/                   # vitest: HTTP surface, initialize, tools/list, every tool, lib
├── scripts/dev.ts          # local server on :8787
├── scripts/size.mjs        # checks: one ES module with a default export, under the quota
├── scripts/deploy.ts       # PUT to the Spaces API (no wrangler) with meta + repo
├── scripts/smoke.ts        # live: /health, initialize, tools/list, one call
├── README.md / README.ar.md
├── .env.example            # MARSA_URL, MARSA_TEAM, MARSA_AGENT_KEY, WORKER_NAME
└── package.json, tsconfig.json
```

## Naming and tool design rules

- **Worker name**: 1–30 of `a-z 0-9 -`, e.g. `news`, `atlas-mcp`. The URL becomes `https://<team-slug>-<name>.marsaplatform.com`.
- **Tool names**: `verb_noun` in snake_case (`search_items`, `get_item`, `list_cities`). Use 3–7 tools, and each one does one thing.
- **Inputs**: a zod schema with `.describe()` on every field. The SDK turns it into JSON Schema for `tools/list`. Use enums for fixed choices and bounds for numbers (`limit` 1–50, default 10).
- **Arabic input**: accept Arabic and English. Normalize before matching (أ/إ/آ→ا, ى→ي, ة→ه, remove tashkeel and tatweel). Take a `lang: "ar" | "en"` for labels in the answer.
- **Pagination**: `limit` + an opaque `cursor`, and return `nextCursor` (null at the end). Never return more than about 50 items.
- **Output**: compact JSON (ids, titles, URLs, dates), in `structuredContent` and as text. No HTML pages.
- **Errors**: never throw out of a tool. Return `isError: true` with `{ code, message }` (`NOT_FOUND`, `INVALID_INPUT`, `UPSTREAM_UNAVAILABLE`, `RATE_LIMITED`) and a message the user can act on.
- **Annotations**: `readOnlyHint: true` on lookups. `destructiveHint` on anything that writes.

## Worker rules

- Routes: `POST /mcp` (stateless Streamable HTTP with JSON responses; `enableJsonResponse: true`, no session id), `GET /mcp` and `DELETE /mcp` → 405, `GET /health` → `{"ok":true,"version":"…"}`, `GET /` → a short page or a link to your Space project page.
- **Secrets** (upstream tokens) are sent as `secrets` on deploy. They are write-only and the team sees only their names. They never go in code, `vars`, the repo or the README.
- **Vars** hold non-secret settings: up to 32 KB each, 64 KB in total. Put bigger data in site KV/files or behind an upstream URL.
- Every upstream fetch uses a **fixed User-Agent**, a **timeout** (8 s) and **retries** with backoff on 429/5xx (`src/lib/http.ts`).
- Cache reference data at module level (`src/lib/cache.ts`) and GET responses with `caches.default`. Never cache per-user answers.

## Build and test locally

```sh
npm run dev       # http://localhost:8787/mcp (Node, via @hono/node-server)
npm test          # vitest: HTTP surface, initialize, tools/list, every tool
npm run build     # esbuild src/index.ts --bundle --format=esm --platform=browser --target=es2022 --minify --outfile=dist/worker.js
npm run build:bun # same output with: bun build src/index.ts --target=browser --format=esm --minify --outfile=dist/worker.js
npm run check     # typecheck + tests + build + size check (one ES module, default export, under 1 MB)
```

The starter bundle is about 400 KB: zod 253 KB, ajv 206 KB (pulled in by the SDK), SDK 183 KB, Hono 56 KB, before minification. Your team quota is shown on the Workers page.

## Deploy through Spaces (no wrangler)

`scripts/deploy.ts` runs `npm run check`, then sends `dist/worker.js` with a note, the declared metadata and the git repo:

```sh
cp .env.example .env   # MARSA_URL, MARSA_TEAM, MARSA_AGENT_KEY (needs workers:deploy), WORKER_NAME. Never commit .env
set -a; . ./.env; set +a
npm run deploy
```

What it sends, as a plain request:

```sh
curl -s -X PUT "$MARSA_URL/api/teams/$MARSA_TEAM/workers/$WORKER_NAME" \
  -H "X-Team-Key: $MARSA_AGENT_KEY" -H "content-type: application/json" \
  --data-binary @- <<JSON
{ "code": $(jq -Rs . < dist/worker.js),
  "note": "v1.2.0: add get_item",
  "vars": { "DATA_URL": "https://example.org/data.json" },
  "requiredEnv": ["DATA_URL", "UPSTREAM_TOKEN"],
  "secrets": { "UPSTREAM_TOKEN": "…from your secret store…" },
  "meta": { "kind": "mcp", "language": "typescript", "framework": "hono", "toolsCount": 2, "spaceSlug": "<space id>" },
  "repo": { "url": "https://github.com/<org>/<repo>", "branch": "main", "commitSha": "<git rev-parse HEAD>" } }
JSON
```

- **`meta`** (optional) tells the dashboard what this Worker is. Without it, Spaces guesses from the code and probes `/mcp` read-only (`initialize` + `tools/list`, cached, never `tools/call`). `kind` is `mcp`, `web` (site/API) or `other`. `spaceSlug` links the Worker to its project page on Spaces.
- **`repo`** (optional) shows the Repo column. Spaces checks GitHub read-only and caches the result: public, private or not found, and synced or behind the branch.
- **`requiredEnv`** (optional, 0.15.2) lists the env names the code needs. The Worker page's **Variables & secrets** tab flags any that are missing (plus names it sees as `env.X` in the code). Set or rotate one secret later without redeploying: `PUT /api/teams/<team>/workers/<name>/secrets/<NAME>` with `{"value":"…"}` (write-only; never returned), `DELETE` to remove it, or the MCP tool `set_worker_secret`. An agent key needs `workers:secrets` (or `workers:deploy`).
- After deploying, check `GET …/workers/<name>/health`, `…/usage?range=24h` and `…/logs` (or the MCP tool `worker_status`). If something stays broken, leave a note.
- Full log lines in `…/logs` need Workers Logs on for the Worker and the operator's Cloudflare token to have **Account · Workers Observability: Edit (API: Write)** (*Read* alone answers 403). Without it you still get error counts from analytics.
- To change `meta`, `repo` or the linked Space later without redeploying, use `POST /api/teams/<team>/workers/<name>/links`, the MCP tool `set_worker_links`, or the Worker's **Settings** tab.

With MCP (an agent connected to a Space's MCP): `deploy_worker` takes the same `code`, `vars`, `secrets`, `meta`, `repo`, `compatibilityFlags` and `bindings`.

## Live verification

```sh
URL=https://<team>-<name>.marsaplatform.com npm run smoke
# or by hand:
U=https://<team>-<name>.marsaplatform.com
curl -s $U/health
curl -s $U/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"1"}}}'
curl -s $U/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
curl -s $U/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_items","arguments":{"query":"مكتبة","limit":3}}}'
```

The Worker then appears under **MCP servers** in the dashboard, with its endpoint, tool count, stack, repo status and keys.

## Pre-deploy checklist

- [ ] `npm run check` passes: typecheck, tests, build, and the size check (one ES module with `export default { fetch }`).
- [ ] No token, password or key in code, `vars`, the repo, the README or tests. They go in `secrets`, and `.env` is in `.gitignore`.
- [ ] Every upstream fetch has the User-Agent, a timeout and retries.
- [ ] `/health` returns 200, `GET /mcp` returns 405, and unknown paths return 404.
- [ ] Tool descriptions say what comes back, how many items, and which language.
- [ ] Arabic input is tested, and pagination returns `nextCursor`.
- [ ] Deploy `note` and `meta` are set, plus `repo` with the commit you built.
- [ ] After the deploy, the smoke test passes (`initialize`, `tools/list` and one call).

## Versions and rollback

Every deploy is stored as a version (the last 10), with its code, vars, flags, bindings, note and SHA-256. Secret values are not stored. You can roll back from the Worker page (**Versions**), with `POST /api/teams/<team>/workers/<name>/rollback {"version": 3}`, or with the MCP tool `rollback_worker`. Redeploy the newest version with `redeploy_worker`. Put your own version in `/health` and the deploy `note` so they match.

## Protect it with Spaces keys

To control who can call the server, turn on **Require API keys** on the Worker's **API keys** tab and add the helper (see *Protect your MCP with Spaces keys*). Each user gets an `msk_…` key with per-minute and per-day limits, an optional tool list, an expiry and usage stats. The **MCP servers** page shows whether each server is protected and has a *User keys* button.

## Calling another Worker of your team

A plain `fetch("https://<team>-news.marsaplatform.com")` from a Worker on the same zone goes to the origin, not to the other Worker. Use one of these instead:

1. **A service binding** (preferred). This works only for Workers of your own team.
   ```json
   { "code": "…", "bindings": [{ "name": "NEWS", "worker": "news" }] }
   ```
   ```js
   const res = await env.NEWS.fetch(new Request("https://news/latest?limit=5"));
   ```
2. **The public URL**, with the `global_fetch_strictly_public` flag: `{ "compatibilityFlags": ["global_fetch_strictly_public"] }`.

To change only these settings, use `POST /api/teams/<team>/workers/<name>/runtime` or `set_worker_runtime`. Allowed flags are `global_fetch_strictly_public`, `nodejs_compat` and `nodejs_als`. You cannot delete a Worker that another Worker binds to (409 `WORKER_BOUND`).

## When something goes wrong: leave a note

If a deploy or build fails, a runtime error has no clear fix, or this recipe is wrong or unclear, leave a short note for the platform admin. Blockers ring the admin's bell, and the reply shows up in `GET /api/teams/<team>/notes`.

```sh
curl -s -X POST "$MARSA_URL/api/teams/$MARSA_TEAM/notes" -H "X-Team-Key: $MARSA_AGENT_KEY" -H "content-type: application/json" \
  -d '{"severity":"bug","stage":"deploy","category":"bindings","message":"409 WORKER_BOUND when …","target":{"type":"worker","id":"news"},"version":"4","agent":"my-agent"}'
```

Over MCP, use `leave_note`. Never include keys or tokens: they are removed automatically. See *Agent notes*.

## API change (0.16.0): var values leave the Workers lists

`GET /api/teams/<team>/workers`, `GET …/workers/<name>` and the MCP tool `list_workers` now return
`varNames` for every Worker. Until **2026-10-28 12:00 UTC** they still include `vars` with values, marked
`varValuesDeprecated: true`, with a `deprecations` entry and `Deprecation` / `Sunset` headers. After that,
values are returned only on request: `?includeValues=1` (needs `workers:deploy`), or
`list_workers {"includeValues": true}`. Read `varNames` (or your own config) instead of relying on the values.

## Common pitfalls

- **`NOT_A_MODULE`**: the bundle lost `export default`, or it is a service-worker script. Run `npm run check`.
- **`fetch()` to a team Worker fails with 5xx or 522**: use a binding or `global_fetch_strictly_public` (above).
- **SSE and sessions by default**: in a Worker, use `enableJsonResponse: true` and create a new server per request (the starter does both).
- **Node APIs in the bundle** (`fs`, `Buffer` without `nodejs_compat`): keep to Web APIs, or add `nodejs_compat` deliberately.
- **No User-Agent**: upstream APIs return 403 or 429 only in production.
- **Secrets in `vars` or code**: anyone on the team can read vars, and versions keep the code. Rotate the secret if this happened.
- **Throwing inside a tool**: return `fail()` / `isError: true` so the client shows a readable message.
