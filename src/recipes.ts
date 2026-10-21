import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";
import { DOCS_PLACEHOLDER_URL } from "./docs.js";
import type { Lang } from "./i18n.js";

/**
 * Agent recipes (0.14.0): step-by-step playbooks for agents and people.
 * - built-in: docs/recipes/<slug>.<en|ar>.md, versioned in the repo (front matter);
 * - platform: written by the admin, public;
 * - team: written by a team's owners/editors, visible to that team (key or session).
 * Custom recipes live in <dataDir>/recipes.json (mode 600).
 */
export type RecipeScope = "builtin" | "platform" | "team";
export const RECIPE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
export const RECIPE_MAX_BYTES = 64 * 1024;
export const MAX_TEAM_RECIPES = 50;
export const MAX_PLATFORM_RECIPES = 100;
export const RECIPE_SECTIONS = [
  "goal",
  "when",
  "steps",
  "template",
  "checklist",
  "pitfalls",
] as const;

export class RecipeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type PerLang = Partial<Record<Lang, string>>;

export interface Recipe {
  slug: string;
  scope: RecipeScope;
  teamId?: string;
  version: number;
  updatedAt: string;
  updatedBy: string;
  title: PerLang;
  summary: PerLang;
  body: PerLang;
  tags: string[];
}

export interface RecipeSummary {
  slug: string;
  scope: RecipeScope;
  version: number;
  updatedAt: string;
  title: string;
  summary: string;
  tags: string[];
  langs: Lang[];
}

const LANGS: Lang[] = ["en", "ar"];

function parseFront(src: string): { meta: Record<string, string>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (!m) return { meta: {}, body: src };
  const meta: Record<string, string> = {};
  for (const line of (m[1] ?? "").split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: src.slice(m[0].length) };
}

function recipesDir(): string {
  return fileURLToPath(new URL("../docs/recipes/", import.meta.url));
}

/** Load the built-in recipes shipped in docs/recipes. */
export function loadBuiltinRecipes(publicUrl: string, dir = recipesDir()): Recipe[] {
  if (!existsSync(dir)) return [];
  const by = new Map<string, Recipe>();
  for (const f of readdirSync(dir).sort()) {
    const m = /^([a-z0-9-]+)\.(en|ar)\.md$/.exec(f);
    if (!m) continue;
    const slug = m[1] as string;
    const lang = m[2] as Lang;
    const { meta, body } = parseFront(readFileSync(join(dir, f), "utf8"));
    const r =
      by.get(slug) ??
      ({
        slug,
        scope: "builtin",
        version: 1,
        updatedAt: "",
        updatedBy: "Marsa Spaces",
        title: {},
        summary: {},
        body: {},
        tags: [],
      } as Recipe);
    r.title[lang] = meta.title ?? slug;
    r.summary[lang] = meta.summary ?? "";
    r.body[lang] = body.replaceAll(DOCS_PLACEHOLDER_URL, publicUrl).trim();
    r.version = Math.max(r.version, Number(meta.version) || 1);
    if (meta.updated && meta.updated > r.updatedAt) r.updatedAt = meta.updated;
    if (meta.tags)
      r.tags = meta.tags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    if (meta.order) (r as Recipe & { order?: number }).order = Number(meta.order);
    by.set(slug, r);
  }
  return [...by.values()].sort(
    (a, b) =>
      ((a as Recipe & { order?: number }).order ?? 99) -
        ((b as Recipe & { order?: number }).order ?? 99) || a.slug.localeCompare(b.slug),
  );
}

const md = new Marked({ gfm: true });
const escHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Custom recipes: raw HTML is shown as text, links only to http(s) or site paths. */
const mdSafe = new Marked({ gfm: true }).use({
  renderer: {
    html(token: { text?: string; raw?: string } | string) {
      return escHtml(typeof token === "string" ? token : (token.text ?? token.raw ?? ""));
    },
  },
});
export function recipeHtml(r: Recipe, lang: Lang): string {
  const src = pick(r.body, lang);
  const html = (r.scope === "builtin" ? md : mdSafe).parse(src, { async: false }) as string;
  return html
    .replace(/<table>/g, '<div class="table"><table>')
    .replace(/<\/table>/g, "</table></div>")
    .replace(/<a href="(?!https?:\/\/|\/|#)[^"]*"[^>]*>(.*?)<\/a>/gi, "$1")
    .replace(/<img [^>]*src="(?!https:\/\/|\/)[^"]*"[^>]*>/gi, "");
}

export function pick(m: PerLang, lang: Lang): string {
  return m[lang] ?? m.en ?? m.ar ?? "";
}
/** The language actually served for a request (falls back when one is missing). */
export function servedLang(r: Recipe, lang: Lang): Lang {
  return r.body[lang] ? lang : r.body.en ? "en" : "ar";
}

export function summaryOf(r: Recipe, lang: Lang): RecipeSummary {
  return {
    slug: r.slug,
    scope: r.scope,
    version: r.version,
    updatedAt: r.updatedAt,
    title: pick(r.title, lang),
    summary: pick(r.summary, lang),
    tags: r.tags,
    langs: LANGS.filter((l) => !!r.body[l]),
  };
}

const clean = (v: unknown, max: number) =>
  typeof v === "string"
    ? v
        // biome-ignore lint/suspicious/noControlCharactersInRegex: strip control characters
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";

/** The skeleton a new custom recipe starts from. */
export function recipeSkeleton(lang: Lang): string {
  return lang === "ar"
    ? "## الهدف\n\n## متى تستخدمها\n\n## الخطوات\n\n1. \n\n## القالب\n\n```js\n\n```\n\n## قائمة التحقق قبل النشر\n\n- [ ] \n\n## أخطاء شائعة\n\n- \n"
    : "## Goal\n\n## When to use\n\n## Steps\n\n1. \n\n## Starter template\n\n```js\n\n```\n\n## Checklist before deploy\n\n- [ ] \n\n## Common pitfalls\n\n- \n";
}

export class RecipeStore {
  private readonly file: string;
  private readonly tmpDir: string;
  private custom: Recipe[] = [];
  private loading: Promise<void> | null = null;
  private writeQ: Promise<void> = Promise.resolve();

  constructor(
    dataDir: string,
    readonly builtins: Recipe[],
    private readonly now: () => number = Date.now,
  ) {
    const root = resolve(dataDir);
    this.file = join(root, "recipes.json");
    this.tmpDir = join(root, "tmp");
  }

  ready(): Promise<void> {
    this.loading ??= (async () => {
      try {
        const f = JSON.parse(await readFile(this.file, "utf8")) as { recipes?: Recipe[] };
        this.custom = f.recipes ?? [];
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    })();
    return this.loading;
  }

  private save() {
    const body = JSON.stringify({ version: 1, recipes: this.custom });
    const run = async () => {
      await mkdir(this.tmpDir, { recursive: true });
      const tmp = join(this.tmpDir, `rc-${randomBytes(6).toString("hex")}.json`);
      await writeFile(tmp, body, { mode: 0o600 });
      await rename(tmp, this.file);
    };
    this.writeQ = this.writeQ.then(run, run);
    return this.writeQ;
  }

  /** What a viewer sees: built-ins, platform recipes, and (with a team) the team's own. */
  visible(teamId: string | null): Recipe[] {
    const platform = this.custom
      .filter((r) => r.scope === "platform")
      .sort((a, b) => a.slug.localeCompare(b.slug));
    const team = teamId
      ? this.custom
          .filter((r) => r.scope === "team" && r.teamId === teamId)
          .sort((a, b) => a.slug.localeCompare(b.slug))
      : [];
    return [...team, ...this.builtins, ...platform];
  }

  get(slug: string, teamId: string | null): Recipe | null {
    return this.visible(teamId).find((r) => r.slug === slug) ?? null;
  }

  /** Create or update a team (teamId) or platform (teamId null) recipe. */
  async save1(
    teamId: string | null,
    slugRaw: unknown,
    input: Record<string, unknown>,
    by: string,
  ): Promise<Recipe> {
    const slug = String(slugRaw ?? "")
      .trim()
      .toLowerCase();
    if (!RECIPE_SLUG_RE.test(slug))
      throw new RecipeError(400, "INVALID_SLUG", "slug: 1-48 of a-z, 0-9 and -, not at the ends");
    if (this.builtins.some((r) => r.slug === slug))
      throw new RecipeError(409, "SLUG_TAKEN", "a built-in recipe uses this slug");
    const scope: RecipeScope = teamId ? "team" : "platform";
    if (teamId && this.custom.some((r) => r.scope === "platform" && r.slug === slug))
      throw new RecipeError(409, "SLUG_TAKEN", "a platform recipe uses this slug");
    const title: PerLang = {};
    const summary: PerLang = {};
    const body: PerLang = {};
    for (const l of LANGS) {
      const b = typeof input[`body_${l}`] === "string" ? (input[`body_${l}`] as string) : "";
      const text = b.replace(/\r\n/g, "\n").trim();
      if (Buffer.byteLength(text) > RECIPE_MAX_BYTES)
        throw new RecipeError(413, "TOO_LARGE", `body_${l}: at most ${RECIPE_MAX_BYTES / 1024} KB`);
      if (text) {
        body[l] = text;
        title[l] = clean(input[`title_${l}`], 120) || slug;
        summary[l] = clean(input[`summary_${l}`], 300);
      }
    }
    if (!body.en && !body.ar)
      throw new RecipeError(400, "INVALID_REQUEST", "give body_en and/or body_ar (markdown)");
    const tags = (
      Array.isArray(input.tags) ? input.tags.map(String) : String(input.tags ?? "").split(",")
    )
      .map((t) => clean(t, 30).toLowerCase())
      .filter(Boolean)
      .slice(0, 10);
    const i = this.custom.findIndex(
      (r) => r.slug === slug && r.scope === scope && (r.teamId ?? null) === teamId,
    );
    const cur = i >= 0 ? this.custom[i] : null;
    if (!cur) {
      const n = this.custom.filter(
        (r) => r.scope === scope && (r.teamId ?? null) === teamId,
      ).length;
      const max = teamId ? MAX_TEAM_RECIPES : MAX_PLATFORM_RECIPES;
      if (n >= max) throw new RecipeError(409, "TOO_MANY", `at most ${max} recipes`);
    }
    const r: Recipe = {
      slug,
      scope,
      ...(teamId ? { teamId } : {}),
      version: (cur?.version ?? 0) + 1,
      updatedAt: new Date(this.now()).toISOString(),
      updatedBy: by,
      title,
      summary,
      body,
      tags,
    };
    if (cur) this.custom[i] = r;
    else this.custom.push(r);
    await this.save();
    return r;
  }

  async remove(teamId: string | null, slug: string): Promise<boolean> {
    const scope: RecipeScope = teamId ? "team" : "platform";
    const before = this.custom.length;
    this.custom = this.custom.filter(
      (r) => !(r.slug === slug && r.scope === scope && (r.teamId ?? null) === teamId),
    );
    if (this.custom.length === before) return false;
    await this.save();
    return true;
  }

  async purgeTeam(teamId: string) {
    const before = this.custom.length;
    this.custom = this.custom.filter((r) => r.teamId !== teamId);
    if (this.custom.length !== before) await this.save();
  }
}

/** A recipe as one markdown document (title, meta, body) for agents. */
export function recipeMarkdown(r: Recipe, lang: Lang): string {
  const l = servedLang(r, lang);
  return `# ${pick(r.title, l)}\n\n> ${pick(r.summary, l)}\n> recipe \`${r.slug}\` · v${r.version} · ${r.scope}${r.updatedAt ? ` · ${r.updatedAt.slice(0, 10)}` : ""}\n\n${pick(r.body, l)}\n`;
}
