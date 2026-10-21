# my-mcp-worker

An MCP server on a Marsa Spaces Worker: **TypeScript + Hono + the official MCP SDK**. It uses stateless Streamable HTTP with JSON responses at `/mcp`, has `/health`, takes Arabic or English input, and comes with tests and a deploy without wrangler. [العربية](README.ar.md)

```
my-mcp-worker/
├── src/
│   ├── index.ts            # Hono app: /, /health, /mcp (POST), 404; default export { fetch }
│   ├── env.d.ts            # minimal Workers types
│   ├── mcp/server.ts       # createServer(): one McpServer per request; TOOL_NAMES
│   ├── tools/
│   │   ├── search-items.ts # one file per tool: zod input, pagination, Arabic matching
│   │   └── get-item.ts
│   ├── lib/
│   │   ├── http.ts         # fetchJson: fixed User-Agent, timeout, retries on 429/5xx
│   │   ├── cache.ts        # per-isolate TTL memo
│   │   ├── arabic.ts       # normalize() / matches()
│   │   └── result.ts       # ok() / fail() tool result shapes
│   ├── i18n/index.ts       # ar + en messages
│   └── data/items.ts       # sample data (replace with your source)
├── test/                   # vitest: HTTP surface, initialize, tools/list, tools, lib
├── scripts/
│   ├── dev.ts              # local server on :8787
│   ├── size.mjs            # bundle is one ES module and fits the quota
│   ├── deploy.ts           # PUT to the Spaces API with your agent key
│   └── smoke.ts            # live: /health, initialize, tools/list, one call
├── .env.example
├── package.json
└── tsconfig.json
```

## Commands

```sh
npm install
npm run dev          # http://localhost:8787/mcp
npm test             # vitest
npm run check        # typecheck + tests + build + size check
cp .env.example .env # fill MARSA_TEAM, MARSA_AGENT_KEY, WORKER_NAME (never commit .env)
set -a; . ./.env; set +a
npm run deploy       # check, then PUT dist/worker.js to Spaces
URL=https://<team>-<name>.marsaplatform.com npm run smoke
```

Bun works for local work too (`bun install`, `bun run build:bun`, `bun x vitest run`). What you deploy is always the single ES module `dist/worker.js`.

## Adding a tool

1. Create `src/tools/<verb>-<noun>.ts` exporting `register<VerbNoun>(server)`.
2. Register it in `src/mcp/server.ts` and add its name to `TOOL_NAMES`.
3. Add a test in `test/mcp.test.ts`, then run `npm run check`.
