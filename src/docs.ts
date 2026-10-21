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
  // 0.16.0: Arabic translations, served at /ar/docs/<same slug>.
  ...(
    [
      ["getting-started", "الرفع من المتصفح وما الذي تحصل عليه."],
      ["api", "كل نقطة في الـ API مع أمثلة curl ورموز الأخطاء."],
      ["agents", "تعليمات ومقتطفات ليتمكن وكيل ذكاء اصطناعي من النشر وإعادة رابط."],
      ["managing", "تحديث موقع أو تمديده أو حذفه بمفتاح التعديل."],
      ["use-cases", "تقارير ونماذج أولية وصفحات فعاليات وواجبات ومعاينات CI."],
      ["self-hosting", "Docker والإعدادات والوكيل العكسي والإدارة والنسخ الاحتياطي."],
      ["backend", "KV وملفات اختيارية للصفحات والوكلاء عبر Cloudflare Workers KV و R2."],
      ["teams", "لوحة الإدارة: الفرق ومفاتيحها والوصول إلى الخلفية والدليل العام."],
      ["mcp", "خادم MCP لكل مساحة: مفاتيح محددة وإعداد العملاء وأدوات للوكلاء."],
      ["workers", "وركرات الفرق: انشر Cloudflare Workers عبر Spaces بلا مفتاح Cloudflare."],
      ["agent-keys", "مفاتيح وكلاء محددة الصلاحيات وروابط دعوة لمرة واحدة وإشعارات وWebhooks."],
    ] as const
  ).map(([slug, summary]) => ({ slug, lang: "ar" as Lang, file: `ar/${slug}.md`, summary })),
  {
    slug: "glossary",
    lang: "ar",
    file: "ar/glossary.md",
    summary: "المصطلحات العربية المعتمدة في الواجهة والتوثيق.",
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

function rewrite(html: string, publicUrl: string, lang: Lang = "en"): string {
  const base = lang === "ar" ? "/ar/docs" : "/docs";
  return (
    html
      .replaceAll(DOCS_PLACEHOLDER_URL, publicUrl)
      .replace(/href="ar\/guide\.md"/g, 'href="/ar/docs/guide"')
      .replace(/href="([a-z-]+)\.md(#[^"]*)?"/g, (_m, slug: string, hash = "") =>
        slug === "README" ? `href="${base}"` : `href="${base}/${slug}${hash}"`,
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
    const html = a11yHtml(rewrite(md.parse(body, { async: false }) as string, publicUrl, p.lang));
    out.push({ slug: p.slug, lang: p.lang, title, summary: p.summary, html });
  }
  return out;
}

/**
 * 0.16.0 accessibility for rendered Markdown: task-list checkboxes get a label (their text),
 * scrollable code blocks can take keyboard focus, and the page keeps a single <h1>.
 */
export function a11yHtml(html: string): string {
  const text = (s: string) =>
    s
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200)
      .replace(/"/g, "&quot;");
  return html
    .replace(
      /(<input\b[^>]*type="checkbox"[^>]*?)\s*\/?>([\s\S]*?)(?=<\/li>|<\/p>|<ul|<ol)/g,
      (_m, input: string, rest: string) => `${input} aria-label="${text(rest) || "✓"}">${rest}`,
    )
    .replace(/<pre>/g, '<pre tabindex="0">')
    .replace(/<h1(\s|>)/g, "<h2$1")
    .replace(/<\/h1>/g, "</h2>");
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

/**
 * 0.16.0: one page per slug for a reader language — the page in that language when there is
 * one, otherwise the other language (in PAGES order).
 */
export function docsFor(lang: Lang, docs: DocPage[]): DocPage[] {
  const out: DocPage[] = [];
  const seen = new Set<string>();
  for (const d of docs) {
    if (seen.has(d.slug)) continue;
    seen.add(d.slug);
    out.push(docs.find((x) => x.slug === d.slug && x.lang === lang) ?? d);
  }
  return out;
}

/** The page for a slug in a language (falling back to the other language). */
export function findDoc(lang: Lang, slug: string, docs: DocPage[]): DocPage | undefined {
  return docs.find((d) => d.slug === slug && d.lang === lang) ?? docs.find((d) => d.slug === slug);
}
