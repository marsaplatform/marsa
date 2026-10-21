import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { registerGetItem } from "../tools/get-item.js";
import { registerSearchItems } from "../tools/search-items.js";

export const SERVER_NAME = "my-mcp-worker";
export const VERSION = "0.1.0";

/** A fresh server per request: stateless, no sessions, nothing kept in memory between calls. */
export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: VERSION },
    {
      // No code generation in Workers: validate JSON Schema with @cfworker/json-schema.
      jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
      instructions:
        "Directory search. Inputs accept Arabic or English. Use search_items, then get_item with an id from the results.",
    },
  );
  registerSearchItems(server);
  registerGetItem(server);
  return server;
}

/** Keep in sync with the registrations above (the deploy script declares it to Spaces). */
export const TOOL_NAMES = ["search_items", "get_item"] as const;
