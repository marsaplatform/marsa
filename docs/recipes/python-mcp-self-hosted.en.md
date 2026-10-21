---
title: Python MCP server, self-hosted (FastMCP)
summary: When your tools need Python (pandas, numpy, scikit-learn, big files, long jobs), run a FastMCP server on your own machine or container. It is not a Spaces Worker, and here is what that costs you.
version: 1
updated: 2026-10-21
tags: mcp, python, self-hosted
order: 3
---
## Use this only when

- The tools need **heavy Python libraries** (pandas, numpy, scikit-learn, geopandas, PDF/OCR) or native modules. These do not run in a Worker.
- You need **long jobs** (minutes), large files on disk, a database or GPU next to the server.

For everything else, use *MCP server on a Spaces Worker* (TypeScript + Hono): nothing to host, global, with keys, versions and rollback built in.

## Honest trade-offs

| | Spaces Worker (TS) | Self-hosted Python |
|---|---|---|
| Hosting | Spaces does it | You run the VM/container, TLS, restarts, updates |
| Spaces features | Keys, versions, rollback, bindings, MCP servers page | None built in: the dashboard can only list it if you document it on a Space page |
| Cost of idle | Zero | A running machine |
| Libraries | Web APIs + pure-JS packages | All of PyPI |

## Structure

```
my-py-mcp/
├── server.py          # FastMCP app, tools, /health
├── tools/             # one module per tool
├── tests/test_tools.py
├── pyproject.toml     # mcp[cli], httpx, pydantic (+ your data libraries)
├── Dockerfile
└── README.md / README.ar.md
```

## Minimal server

```python
# server.py
import os, httpx
from mcp.server.fastmcp import FastMCP

UA = "my-py-mcp/1.0 (+https://<your Space page>)"
mcp = FastMCP("my-py-mcp", stateless_http=True, json_response=True)

@mcp.tool(annotations={"readOnlyHint": True})
async def search_items(query: str, limit: int = 10, cursor: str | None = None) -> dict:
    """Search items by keyword (Arabic or English). Returns up to `limit` {id, title, url} and nextCursor."""
    limit = max(1, min(limit, 50))
    async with httpx.AsyncClient(headers={"user-agent": UA}, timeout=8) as http:
        r = await http.get(os.environ["DATA_URL"], params={"q": query})
        r.raise_for_status()
    items = r.json()[: limit]
    return {"items": items, "nextCursor": None}

if __name__ == "__main__":
    mcp.run(transport="streamable-http")   # serves /mcp on :8000
```

Use the same rules as the Worker recipe: `verb_noun` tool names, typed and described inputs, Arabic normalisation, pagination, `isError` results instead of exceptions, a fixed User-Agent, timeouts and retries. Secrets go in environment variables from your secret store, never in the repo.

## Run and verify

```sh
uv run server.py             # or: pip install "mcp[cli]" httpx && python server.py
pytest -q
curl -s localhost:8000/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"1"}}}'
```

Put it behind HTTPS (Caddy or nginx) with a rate limit and, if it is not public, a bearer key that you check in a middleware. Publish a project page on Spaces (*Bilingual AR/EN project page*) with the URL and how to connect.

## Pitfalls

- Sessions in memory with several workers or replicas: use `stateless_http=True`.
- No timeout on upstream calls: one slow API blocks every client.
- Running as root, or with the data directory writable by the web process.
- Hit a problem with the platform side (the project page, keys, recipes)? Leave a note (*Agent notes*).
