import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ITEMS } from "../data/items.js";
import { t } from "../i18n/index.js";
import { matches } from "../lib/arabic.js";
import { ok } from "../lib/result.js";

export const MAX_LIMIT = 50;

export function registerSearchItems(server: McpServer): void {
  server.registerTool(
    "search_items",
    {
      title: "Search items / ابحث في العناصر",
      description:
        "Search the directory by words in Arabic or English (diacritics and letter forms are ignored). Returns at most `limit` items (default 10, max 50) and `nextCursor` when there are more; pass it back as `cursor`. / بحث بالعربية أو الإنجليزية مع ترقيم الصفحات.",
      inputSchema: {
        query: z.string().min(1).max(200).describe("Words to find, e.g. «مكتبة» or \"library\"."),
        city: z.string().max(100).optional().describe("Optional city in Arabic or English, e.g. «الجيزة»."),
        limit: z.number().int().min(1).max(MAX_LIMIT).default(10),
        cursor: z.string().regex(/^\d+$/).optional().describe("From a previous nextCursor."),
        lang: z.enum(["ar", "en"]).default("ar").describe("Language of titles in the answer."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, city, limit, cursor, lang }) => {
      const all = ITEMS.filter(
        (i) =>
          matches(`${i.title.ar} ${i.title.en} ${i.tags.join(" ")}`, query) &&
          (!city || matches(`${i.city.ar} ${i.city.en}`, city)),
      );
      const start = Number(cursor ?? 0);
      const page = all.slice(start, start + limit);
      const next = start + limit < all.length ? String(start + limit) : null;
      const items = page.map((i) => ({ id: i.id, title: i.title[lang], city: i.city[lang], url: i.url }));
      const text = items.length
        ? items.map((i) => `- ${i.title} (${i.city}) [${i.id}]`).join("\n")
        : t(lang).noResults;
      return ok({ total: all.length, items, nextCursor: next }, text);
    },
  );
}
