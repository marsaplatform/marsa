import { describe, expect, it } from "vitest";
import { TOOL_NAMES } from "../src/mcp/server.js";
import { call, rpc } from "./helpers.js";

describe("HTTP surface", () => {
  it("answers /health, refuses GET /mcp and 404s the rest", async () => {
    expect((await call("/health")).status).toBe(200);
    expect((await call("/mcp")).status).toBe(405);
    expect((await call("/nope")).status).toBe(404);
  });
});

describe("MCP", () => {
  it("initializes and lists the declared tools", async () => {
    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe("my-mcp-worker");
    const list = await rpc("tools/list");
    const names = list.body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual([...TOOL_NAMES].sort());
  });

  it("searches in Arabic with diacritics and pages with a cursor", async () => {
    const r = await rpc("tools/call", { name: "search_items", arguments: { query: "مَكْتَبة", limit: 1 } });
    const data = r.body.result.structuredContent;
    expect(data.total).toBe(2);
    expect(data.items).toHaveLength(1);
    expect(data.nextCursor).toBe("1");
    const p2 = await rpc("tools/call", {
      name: "search_items",
      arguments: { query: "library", limit: 1, cursor: data.nextCursor, lang: "en" },
    });
    expect(p2.body.result.structuredContent.nextCursor).toBeNull();
  });

  it("returns a readable error instead of throwing", async () => {
    const r = await rpc("tools/call", { name: "get_item", arguments: { id: "missing" } });
    expect(r.body.result.isError).toBe(true);
    expect(r.body.result.structuredContent.error.code).toBe("NOT_FOUND");
  });

  it("rejects invalid input with a JSON-RPC or tool error", async () => {
    const r = await rpc("tools/call", { name: "search_items", arguments: { query: "", limit: 500 } });
    expect(r.body.error ?? r.body.result?.isError).toBeTruthy();
  });
});
