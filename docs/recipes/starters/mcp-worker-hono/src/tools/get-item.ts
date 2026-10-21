import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ITEMS } from "../data/items.js";
import { t } from "../i18n/index.js";
import { fail, ok } from "../lib/result.js";

export function registerGetItem(server: McpServer): void {
  server.registerTool(
    "get_item",
    {
      title: "Get one item / عنصر واحد",
      description: "Full record of one item by id (ids come from search_items). / السجل الكامل لعنصر بمعرّفه.",
      inputSchema: {
        id: z.string().min(1).max(100),
        lang: z.enum(["ar", "en"]).default("ar"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id, lang }) => {
      const item = ITEMS.find((i) => i.id === id.trim());
      if (!item) return fail("NOT_FOUND", t(lang).notFound(id));
      return ok({ item });
    },
  );
}
