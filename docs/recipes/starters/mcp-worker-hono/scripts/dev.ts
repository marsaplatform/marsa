// Local server on http://localhost:8787 (Node). Same code path as the Worker.
import { serve } from "@hono/node-server";
import { app } from "../src/index.js";

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: (req) => app.fetch(req, {}), port });
console.log(`MCP: http://localhost:${port}/mcp  health: http://localhost:${port}/health`);
