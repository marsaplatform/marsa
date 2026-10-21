// Live check after a deploy: /health, initialize, tools/list and one sample call.
// Usage: URL=https://<team>-<name>.marsaplatform.com npm run smoke   (add KEY=... if keys are required)
import { TOOL_NAMES } from "../src/mcp/server.js";

const url = (process.env.URL ?? "").replace(/\/$/, "");
if (!url) throw new Error("set URL to the Worker's address");
const auth: Record<string, string> = process.env.KEY ? { authorization: `Bearer ${process.env.KEY}` } : {};
const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", "user-agent": "mcp-smoke/1", ...auth };
let id = 0;
const rpc = async (method: string, params: unknown = {}) => {
  const r = await fetch(`${url}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  if (!r.ok) throw new Error(`${method}: HTTP ${r.status}`);
  return (await r.json()) as { result?: any; error?: any };
};
const fail = (m: string) => {
  console.error(`FAIL ${m}`);
  process.exit(1);
};

const h = await fetch(`${url}/health`, { headers: { "user-agent": "mcp-smoke/1" } });
if (h.status !== 200) fail(`/health ${h.status}`);
const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } });
if (!init.result?.serverInfo) fail("initialize");
const tools = ((await rpc("tools/list")).result?.tools ?? []).map((t: { name: string }) => t.name);
for (const n of TOOL_NAMES) if (!tools.includes(n)) fail(`tools/list misses ${n}`);
const sample = await rpc("tools/call", { name: "search_items", arguments: { query: "مكتبة", limit: 2 } });
if (sample.result?.isError || !sample.result?.structuredContent) fail("sample call");
console.log(`OK ${url}: ${init.result.serverInfo.name} ${init.result.serverInfo.version}, tools: ${tools.join(", ")}`);
