# MCP per space

Every space (published site) has its own [Model Context Protocol](https://modelcontextprotocol.io)
server. An AI agent such as Claude, Cursor or VS Code connects to it with a token that only works
for that one space, then reads the files, reads and writes its KV data and uploaded files, and can
publish a new version at the same link.

```
https://marsa.example.com/mcp/s/<siteId>
```

The transport is **Streamable HTTP** (protocol versions `2025-11-25`, `2025-06-18` and `2025-03-26`),
so there is nothing to install. The server is stateless and answers every request with plain JSON:
it has no server-initiated stream (`GET` returns `405`) and no session ID.

## Tokens

Tokens live on the site page of the team dashboard (**MCP access**). Sign in at `/login` and open a
site to see them.

- **Create**: give the token a name and choose its scope. The token (`marsa_mcp_…`) is shown **once**,
  so copy it straight away. Only its SHA-256 hash is stored with the site.
- **Scope**:
  - `Read-only` gives you `get_site_info`, `list_files` and `read_file`, plus `kv_list`, `kv_get`
    and `list_uploads` when the team has the backend.
  - `Read-write` adds `replace_site_files`, and also `kv_put`, `kv_delete`, `upload_file` and
    `delete_file` when the team has the backend.
- **Revoke**: the token stops working at once.
- A space can hold up to 10 tokens. They are never returned by the API (`GET /api/sites/<id>`).
  They stop working when the space expires or is deleted, and they survive a replace.

Send the token as `Authorization: Bearer marsa_mcp_…`. A missing, unknown or revoked token, a token
for another space, or an expired space all answer `401`.

## Connect a client

The site page shows these snippets with the real URL filled in. Replace `marsa_mcp_…` with your token.

**Cursor** (`.cursor/mcp.json`). Other clients that take a URL and headers use the same JSON:

```json
{
  "mcpServers": {
    "marsa-<siteId>": {
      "url": "https://marsa.example.com/mcp/s/<siteId>",
      "headers": { "Authorization": "Bearer marsa_mcp_…" }
    }
  }
}
```

**Claude Code**:

```bash
claude mcp add --transport http marsa-<siteId> \
  https://marsa.example.com/mcp/s/<siteId> \
  --header "Authorization: Bearer marsa_mcp_…"
```

**VS Code** (`.vscode/mcp.json`):

```json
{ "servers": { "marsa-<siteId>": {
  "type": "http", "url": "https://marsa.example.com/mcp/s/<siteId>",
  "headers": { "Authorization": "Bearer marsa_mcp_…" } } } }
```

**TypeScript SDK** (`@modelcontextprotocol/sdk`):

```js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(
  new URL("https://marsa.example.com/mcp/s/<siteId>"),
  { requestInit: { headers: { Authorization: `Bearer ${process.env.MARSA_MCP_TOKEN}` } } },
);
const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(transport);
console.log(await client.listTools());
console.log(await client.callTool({ name: "get_site_info", arguments: {} }));
```

## Tools

| Tool | Scope | Needs backend | What it does |
| --- | --- | --- | --- |
| `get_site_info` | ro | no | URL, title, expiry, size, team, backend status, token scope |
| `list_files` | ro | no | Published files with sizes |
| `read_file` | ro | no | One published text file (up to 256 KB). Binary files answer with their size only |
| `kv_list` / `kv_get` | ro | yes | KV keys, and the JSON value stored under one key |
| `list_uploads` | ro | yes | Uploaded files (R2) with their public URLs |
| `replace_site_files` | rw | no | Publish a new version at the same link. `files: [{path, content, encoding?}]`, and `encoding: "base64"` for binary files. Same limits and team quota as `PUT /api/sites/<id>` |
| `kv_put` / `kv_delete` | rw | yes | Set any JSON value, or delete a key |
| `upload_file` / `delete_file` | rw | yes | Store a file (text, or base64), or delete one by id |

Tools a token can't use are left out of `tools/list`. Calling one anyway returns a tool error
(`isError: true`). A tool error has the same codes as the HTTP API, for example
`BACKEND_NOT_ALLOWED`, `VALUE_TOO_LARGE`, `TOO_MANY_KEYS` and `TEAM_QUOTA_EXCEEDED`.

## Limits

| Setting | Default | Meaning |
| --- | --- | --- |
| `MCP_REQUESTS_PER_MINUTE` | `60` | Requests per token per minute. Over the limit you get HTTP `429` with `Retry-After` |
| `MCP_WRITES_PER_HOUR` | `60` | Write tool calls per token per hour. Over the limit you get a `RATE_LIMITED` tool error |
| `MCP_KV_WRITES_PER_DAY` | `500` | `kv_put` and `kv_delete` calls across the whole instance per day |

Cloudflare's free Workers KV plan allows 1000 writes per day per account. The last limit keeps the
MCP path to half of that, so pages and the HTTP API still have room. Set it higher on a paid plan.

## Security

- The token is a bearer secret for one space, so treat it like the edit token. Revoke it if it leaks.
- Browser requests with an `Origin` from another site are refused (`403`), which protects against DNS
  rebinding. Agents don't send an `Origin`, so this doesn't affect them.
- Batched JSON-RPC requests are rejected.
