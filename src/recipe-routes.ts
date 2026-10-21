import type { Context, Hono } from "hono";
import type { Lang } from "./i18n.js";
import type { Actor, MemberStore } from "./members.js";
import { RecipeError, type RecipeStore, recipeMarkdown, servedLang, summaryOf } from "./recipes.js";
import { starterFor } from "./starters.js";
import { can, scopeError, type TeamAuth } from "./team-auth.js";

export interface RecipeRouteDeps {
  publicUrl: string;
  recipes: RecipeStore;
  members: MemberStore;
  teamAuth: TeamAuth;
}

const err = (c: Context, status: number, code: string, message: string) =>
  c.json({ error: { code, message } }, status as 400);

export function recipeErr(c: Context, e: unknown) {
  if (e instanceof RecipeError) return err(c, e.status, e.code, e.message);
  throw e;
}

const langQ = (c: Context): Lang => (c.req.query("lang") === "ar" ? "ar" : "en");

/** Public recipe API (built-in + platform; team recipes with a team or agent key). */
export function mountRecipeRoutes(app: Hono, d: RecipeRouteDeps): void {
  const { recipes } = d;
  const viewer = async (c: Context): Promise<string | null | Response> => {
    const cred = await d.teamAuth(c);
    if (cred === "invalid") return err(c, 401, "UNAUTHORIZED", "unknown or expired key");
    return cred ? cred.team.id : null;
  };
  const urlOf = (slug: string, lang: Lang) =>
    `${d.publicUrl}${lang === "ar" ? "/ar" : ""}/docs/recipes/${slug}`;

  app.get("/api/recipes", async (c) => {
    const team = await viewer(c);
    if (team instanceof Response) return team;
    await recipes.ready();
    const lang = langQ(c);
    if (!team) c.header("Cache-Control", "public, max-age=300");
    return c.json({
      recipes: recipes.visible(team).map((r) => ({
        ...summaryOf(r, lang),
        url: r.scope === "team" ? null : urlOf(r.slug, lang),
        api: `${d.publicUrl}/api/recipes/${r.slug}`,
      })),
    });
  });
  // 0.15.1: downloadable starter template of a built-in recipe (public).
  app.get("/api/recipes/:slug/starter.zip", (c) => {
    const s = starterFor(c.req.param("slug"));
    if (!s) return err(c, 404, "NOT_FOUND", "this recipe has no starter");
    c.header("Content-Type", "application/zip");
    c.header("Content-Disposition", `attachment; filename="${s.name}.zip"`);
    c.header("Cache-Control", "public, max-age=300");
    c.header("X-Content-Type-Options", "nosniff");
    return c.body(new Uint8Array(s.zip));
  });
  app.get("/api/recipes/:slug/starter", (c) => {
    const slug = c.req.param("slug");
    const s = starterFor(slug);
    if (!s) return err(c, 404, "NOT_FOUND", "this recipe has no starter");
    c.header("Cache-Control", "public, max-age=300");
    return c.json({
      starter: {
        name: s.name,
        zip: `${d.publicUrl}/api/recipes/${slug}/starter.zip`,
        tree: s.tree,
        files: s.files,
      },
    });
  });
  app.get("/api/recipes/:slug", async (c) => {
    const team = await viewer(c);
    if (team instanceof Response) return team;
    await recipes.ready();
    const lang = langQ(c);
    const r = recipes.get(c.req.param("slug"), team);
    if (!r) return err(c, 404, "NOT_FOUND", "no such recipe");
    const markdown = recipeMarkdown(r, lang);
    const accept = c.req.header("accept") ?? "";
    if (c.req.query("format") === "md" || (/text\/markdown/.test(accept) && !/json/.test(accept))) {
      c.header("Content-Type", "text/markdown; charset=utf-8");
      return c.body(markdown);
    }
    return c.json({
      recipe: {
        ...summaryOf(r, lang),
        lang: servedLang(r, lang),
        url: r.scope === "team" ? null : urlOf(r.slug, lang),
        markdown,
      },
    });
  });

  // ---- team recipes (team key, or an agent key with spaces:write) ------------------------
  const writer = async (c: Context) => {
    const cred = await d.teamAuth(c);
    if (!cred || cred === "invalid")
      return err(c, 401, "UNAUTHORIZED", "send the team key or an agent key");
    const want = c.req.param("team") ?? "";
    if (want !== cred.team.id && want !== cred.team.slug)
      return err(c, 404, "NOT_FOUND", "this key does not belong to that team");
    if (!can(cred, "spaces:write")) return scopeError(c, "spaces:write");
    return cred;
  };
  const audit = (teamId: string, actor: Actor, action: string, detail: string) =>
    d.members.log({ teamId, actor, action, detail });
  app.put("/api/teams/:team/recipes/:slug", async (c) => {
    const cred = await writer(c);
    if (cred instanceof Response) return cred;
    await recipes.ready();
    try {
      const body = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
      const r = await recipes.save1(cred.team.id, c.req.param("slug"), body, cred.actor.label);
      await audit(cred.team.id, cred.actor, "recipe-save", `${r.slug} v${r.version}`);
      return c.json({ recipe: summaryOf(r, langQ(c)) });
    } catch (e) {
      return recipeErr(c, e);
    }
  });
  app.delete("/api/teams/:team/recipes/:slug", async (c) => {
    const cred = await writer(c);
    if (cred instanceof Response) return cred;
    await recipes.ready();
    if (!(await recipes.remove(cred.team.id, c.req.param("slug"))))
      return err(c, 404, "NOT_FOUND", "no such team recipe");
    await audit(cred.team.id, cred.actor, "recipe-delete", c.req.param("slug"));
    return c.body(null, 204);
  });
}

/** Admin: platform recipes (mounted after the /api/admin/* guard). */
export function mountAdminRecipeRoutes(app: Hono, d: RecipeRouteDeps): void {
  app.put("/api/admin/recipes/:slug", async (c) => {
    await d.recipes.ready();
    try {
      const body = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
      const r = await d.recipes.save1(null, c.req.param("slug"), body, "admin");
      return c.json({ recipe: summaryOf(r, langQ(c)) });
    } catch (e) {
      return recipeErr(c, e);
    }
  });
  app.delete("/api/admin/recipes/:slug", async (c) => {
    await d.recipes.ready();
    if (!(await d.recipes.remove(null, c.req.param("slug"))))
      return err(c, 404, "NOT_FOUND", "no such platform recipe");
    return c.body(null, 204);
  });
}
