import worker from "../src/index.js";

const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;

export const call = (path: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://test.local${path}`, init), {}, ctx);

let id = 0;
export async function rpc(method: string, params: unknown = {}) {
  const res = await call("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  return { status: res.status, body: (await res.json()) as { result?: any; error?: any } };
}
