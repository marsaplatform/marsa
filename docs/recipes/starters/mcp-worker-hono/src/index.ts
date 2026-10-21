import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createServer, SERVER_NAME, VERSION } from "./mcp/server.js";

/** Bindings and vars from Spaces (plain vars, secrets and service bindings all arrive here). */
export interface Env {
  /** Set automatically when "Require API keys" is on (see the protect-mcp-with-keys recipe). */
  MARSA_KEYS_URL?: string;
  MARSA_KEYS_SECRET?: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["content-type", "accept", "authorization", "mcp-protocol-version", "mcp-session-id"],
    exposeHeaders: ["mcp-session-id", "mcp-protocol-version"],
  }),
);

app.get("/", (c) =>
  c.json({ name: SERVER_NAME, version: VERSION, mcp: `${new URL(c.req.url).origin}/mcp`, health: "/health" }),
);
app.get("/health", (c) => c.json({ ok: true, name: SERVER_NAME, version: VERSION }));

// Stateless Streamable HTTP with JSON responses: POST only.
app.get("/mcp", (c) =>
  c.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed: POST JSON-RPC to /mcp" }, id: null }, 405),
);
app.delete("/mcp", (c) => c.body(null, 405));
app.post("/mcp", async (c) => {
  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

app.notFound((c) => c.json({ error: "not_found", hint: "POST /mcp" }, 404));
app.onError((err, c) => {
  console.error("unhandled", err?.name);
  return c.json({ error: "internal" }, 500);
});

export { app };

/** An object export (not the Hono instance itself) so Spaces can wrap env for large vars. */
export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
};
