import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Success: readable text for the model plus the same data as structuredContent. */
export function ok(data: Record<string, unknown>, text?: string): CallToolResult {
  return {
    content: [{ type: "text", text: text ?? JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

/** Failure the model can read and act on; never throw out of a tool. */
export function fail(code: string, message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `${code}: ${message}` }],
    structuredContent: { error: { code, message } },
  };
}
