import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";
import type { Lang } from "./i18n.js";

/** Placeholder instance URL used throughout docs/*.md; replaced with PUBLIC_URL when served. */
export const DOCS_PLACEHOLDER_URL = "https://marsa.example.com";

export interface DocPage {
  slug: string;
  lang: Lang;
  title: string;
  summary: string;
  html: string;
}

const PAGES: { slug: string; lang: Lang; file: string; summary: string }[] = [
  {
    slug: "getting-started",
    lang: "en",
    file: "getting-started.md",
    summary: "Upload from the browser and what you get back.",
  },
  {
    slug: "api",
    lang: "en",
    file: "api.md",
    summary: "Every endpoint with curl examples and error codes.",
  },
  {
    slug: "agents",
    lang: "en",
    file: "agents.md",
    summary: "A prompt and snippets so an AI agent can publish and return a link.",
  },
  {
    slug: "managing",
    lang: "en",
    file: "managing.md",
    summary: "Update, extend or delete a site with its edit token.",
  },
  {
    slug: "use-cases",
    lang: "en",
    file: "use-cases.md",
    summary: "Reports, prototypes, event pages, assignments and CI previews.",
  },
  {
    slug: "self-hosting",
    lang: "en",
    file: "self-hosting.md",
    summary: "Docker, configuration, reverse proxy and admin.",
  },
  {
    slug: "backend",
    lang: "en",
    file: "backend.md",
    summary: "Optional KV and files for pages and agents, backed by Cloudflare Workers KV and R2.",
  },
  {
    slug: "teams",
    lang: "en",
    file: "teams.md",
    summary: "Admin console: teams, team keys, backend access and the public directory.",
  },
  {
    slug: "mcp",
    lang: "en",
    file: "mcp.md",
    summary: "An MCP server per space: scoped tokens, client config and tools for AI agents.",
  },
  {
    slug: "workers",
    lang: "en",
    file: "workers.md",
    summary: "Team Workers: deploy Cloudflare Workers through Spaces without a Cloudflare key.",
  },
  {
    slug: "agent-keys",
    lang: "en",
    file: "agent-keys.md",
    summary:
      "Scoped, expiring agent keys, one-time agent invite links, notifications and webhooks.",
  },
  {
    slug: "guide",
    lang: "ar",
    file: "ar/guide.md",
    summary: "الدليل كامل بالعربي: الرفع والـ API والـ agents والإدارة والاستضافة.",
  },
];

function docsDir(): string {
  // Works from src/ (tsx, vitest) and dist/ (compiled): docs/ sits next to both.
  return fileURLToPath(new URL("../docs/", import.meta.url));
}

function rewrite(html: string, publicUrl: string): string {
  return (
    html
      .replaceAll(DOCS_PLACEHOLDER_URL, publicUrl)
      .replace(/href="ar\/guide\.md"/g, 'href="/ar/docs/guide"')
      .replace(/href="([a-z-]+)\.md(#[^"]*)?"/g, (_m, slug: string, hash = "") =>
        slug === "README" ? 'href="/docs"' : `href="/docs/${slug}${hash}"`,
      )
      // Links to repository files (examples/, .env.example) aren't served by the app: keep the text.
      .replace(/<a href="\.\.\/[^"]*">(.*?)<\/a>/g, "$1")
      .replace(/<table>/g, '<div class="table"><table>')
      .replace(/<\/table>/g, "</table></div>")
  );
}

/** Load and render all guide pages once. Missing files are skipped (e.g. a trimmed image). */
export function loadDocs(publicUrl: string): DocPage[] {
  const dir = docsDir();
  const md = new Marked({ gfm: true });
  let seen = new Map<string, number>();
  // 0.16.0: headings get ids, so sections can be linked (e.g. /docs/workers#var-values).
  md.use({
    renderer: {
      heading({ tokens, depth, text }) {
        const base = headingId(text);
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        const id = base && n ? `${base}-${n + 1}` : base;
        const inner = this.parser.parseInline(tokens);
        return `<h${depth}${id ? ` id="${id}"` : ""}>${inner}</h${depth}>\n`;
      },
    },
  });
  const out: DocPage[] = [];
  for (const p of PAGES) {
    const path = `${dir}${p.file}`;
    if (!existsSync(path)) continue;
    const src = readFileSync(path, "utf8");
    const title = /^#\s+(.+)$/m.exec(src)?.[1]?.trim() ?? p.slug;
    const body = src.replace(/^#\s+.+\n/, "");
    seen = new Map();
    const html = rewrite(md.parse(body, { async: false }) as string, publicUrl);
    out.push({ slug: p.slug, lang: p.lang, title, summary: p.summary, html });
  }
  return out;
}

/** A heading's anchor: lower case, letters/digits (any script) joined by dashes. */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]*>|`/g, "")
    .replace(/&[a-z]+;|&#\d+;/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
