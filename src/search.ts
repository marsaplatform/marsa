/**
 * 0.16.0: global ⌘K search for the dashboards. The server builds a small list of what the
 * signed-in team (or the admin) may see — pages, spaces, Workers, MCP servers, notes, teams and
 * the docs — and ranks it against the query. Nothing here touches Cloudflare.
 */
import type { Lang } from "./i18n.js";

export type SearchKind = "page" | "team" | "space" | "worker" | "mcp" | "note" | "doc";

export interface SearchItem {
  kind: SearchKind;
  title: string;
  sub?: string;
  url: string;
  /** Extra text that matches but is not shown (ids, hostnames, a doc summary). */
  text?: string;
}

export interface SearchHit extends SearchItem {
  label: string;
}

export const SEARCH_LABELS: Record<Lang, Record<SearchKind, string>> = {
  en: {
    page: "Page",
    team: "Team",
    space: "Space",
    worker: "Worker",
    mcp: "MCP server",
    note: "Note",
    doc: "Docs",
  },
  ar: {
    page: "صفحة",
    team: "فريق",
    space: "مساحة",
    worker: "وركر",
    mcp: "خادم MCP",
    note: "ملاحظة",
    doc: "التوثيق",
  },
};

export const SEARCH_MAX_QUERY = 100;

/** Lower case, no Arabic diacritics or tatweel, alef/yaa/taa-marbuta forms folded. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}

const KIND_ORDER: SearchKind[] = ["page", "team", "space", "worker", "mcp", "note", "doc"];

/**
 * Every word of the query must appear in the title, sub line or extra text. Titles that start
 * with the query rank first, then titles that contain it, then other matches.
 */
export function searchItems(
  lang: Lang,
  items: SearchItem[],
  rawQuery: string,
  limit = 20,
): SearchHit[] {
  const q = normalize(rawQuery.trim().slice(0, SEARCH_MAX_QUERY));
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const scored: { item: SearchItem; score: number }[] = [];
  for (const item of items) {
    const title = normalize(item.title);
    const hay = `${title} ${normalize(item.sub ?? "")} ${normalize(item.text ?? "")}`;
    // Arabic: "الوركرات" also finds "وركرات" (the definite article is optional).
    const has = (w: string) =>
      hay.includes(w) || (w.length > 3 && w.startsWith("ال") && hay.includes(w.slice(2)));
    if (!words.every(has)) continue;
    const score = title === q ? 4 : title.startsWith(q) ? 3 : title.includes(q) ? 2 : 1;
    scored.push({ item, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      KIND_ORDER.indexOf(a.item.kind) - KIND_ORDER.indexOf(b.item.kind) ||
      a.item.title.localeCompare(b.item.title),
  );
  return scored.slice(0, limit).map(({ item }) => ({
    kind: item.kind,
    label: SEARCH_LABELS[lang][item.kind],
    title: item.title,
    ...(item.sub ? { sub: item.sub } : {}),
    url: item.url,
  }));
}
