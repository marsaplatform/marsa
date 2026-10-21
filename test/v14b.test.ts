import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBuiltinRecipes } from "../src/recipes.js";
import type { UserKeyStore } from "../src/user-keys.js";
import { keysHelperSource } from "../src/user-keys.js";
import { CF_TOKEN, FakeCfWorkers, ZONE_NAME } from "./fake-cf-workers.js";
import { makeApp } from "./helpers.js";

type App = Awaited<ReturnType<typeof makeApp>>;
let t: App;
afterEach(async () => {
  vi.restoreAllMocks();
  await t?.cleanup();
});

const KEY = "k".repeat(48);
const CODE = "export default { async fetch() { return new Response('ok'); } };";

async function setup() {
  const cf = new FakeCfWorkers();
  for (const k of ["log", "error", "warn", "info"] as const) {
    vi.spyOn(console, k).mockImplementation(() => {});
  }
  let uk: UserKeyStore | null = null;
  t = await makeApp(
    { MARSA_SECRETS_KEY: KEY },
    {
      cfFetch: cf.fetch,
      app: {
        notifyOpts: { retryDelays: [0, 0] },
        expose: (s) => {
          uk = s.userKeys;
        },
      },
    },
  );
  expect(
    (await t.admin("PUT", "/workers/settings", { token: CF_TOKEN, zone: ZONE_NAME })).status,
  ).toBe(200);
  const team = await t.createTeam("Sanad", { backend: true });
  await t.admin("PUT", `/teams/${team.team.id}/workers`, { enabled: true, slug: "sanad" });
  const tk = { "x-team-key": team.key };
  expect((await t.api("PUT", "/api/teams/sanad/workers/mcp", { code: CODE }, tk)).status).toBe(201);
  const agent = async (scopes: string[]) => {
    const r = await t.api(
      "POST",
      "/api/teams/sanad/agent-keys",
      { name: "bot", scopes, expiresInDays: 7 },
      tk,
    );
    return ((await r.json()) as { secret: string }).secret;
  };
  return { cf, team, tk, agent, uk: uk as unknown as UserKeyStore };
}

describe("0.14.0 recipes", () => {
  it("ships the built-in recipes in both languages with every section", () => {
    const rs = loadBuiltinRecipes("https://spaces.test");
    expect(rs.map((r) => r.slug)).toEqual([
      "mcp-server-on-worker",
      "bilingual-project-page",
      "agent-security-rules",
      "site-kv-and-files",
      "protect-mcp-with-keys",
    ]);
    for (const r of rs) {
      for (const l of ["en", "ar"] as const) {
        const b = r.body[l] ?? "";
        expect(b.length, `${r.slug}.${l}`).toBeGreaterThan(500);
        expect(b).not.toContain("{{TEMPLATE}}");
        expect(b).not.toContain("marsa.example.com");
        expect((b.match(/^## /gm) ?? []).length, `${r.slug}.${l} sections`).toBeGreaterThanOrEqual(
          6,
        );
        expect(b).toMatch(/```/);
      }
    }
  });

  it("public API, team recipes with a key, scopes, MCP tools and pages", async () => {
    const { tk, agent, team } = await setup();
    const pub = await (await t.api("GET", "/api/recipes?lang=ar")).json();
    expect(pub.recipes).toHaveLength(5);
    expect(pub.recipes[0].title).toMatch(/MCP/);
    const md = await t.api("GET", "/api/recipes/agent-security-rules?format=md");
    expect(md.headers.get("content-type")).toMatch(/markdown/);
    expect(await md.text()).toMatch(/^# Security rules for agents/);
    expect((await t.api("GET", "/api/recipes/nope")).status).toBe(404);
    expect(
      (await t.api("GET", "/api/recipes", undefined, { "x-team-key": "marsa_team_bad" })).status,
    ).toBe(401);

    // Team recipe: team key writes; an agent key needs spaces:write.
    const body = {
      title_en: "Our deploy",
      body_en: "## Goal\n\nShip.\n\n<script>alert(1)</script>",
      tags: "ops",
    };
    const ro = await agent(["spaces:read", "mcp"]);
    expect(
      (await t.api("PUT", "/api/teams/sanad/recipes/our-deploy", body, { "x-team-key": ro }))
        .status,
    ).toBe(403);
    const put = await t.api("PUT", "/api/teams/sanad/recipes/our-deploy", body, tk);
    expect(put.status).toBe(200);
    expect((await put.json()).recipe).toMatchObject({
      slug: "our-deploy",
      version: 1,
      scope: "team",
    });
    expect(
      (await t.api("PUT", "/api/teams/sanad/recipes/agent-security-rules", body, tk)).status,
    ).toBe(409);
    expect((await t.api("PUT", "/api/teams/sanad/recipes/Bad Slug", body, tk)).status).toBe(400);
    // Visible with the team's key, not publicly, not to another team.
    expect((await t.api("GET", "/api/recipes/our-deploy")).status).toBe(404);
    expect(
      (await t.api("GET", "/api/recipes/our-deploy", undefined, { "x-team-key": ro })).status,
    ).toBe(200);
    const other = await t.createTeam("Other");
    expect(
      (await t.api("GET", "/api/recipes/our-deploy", undefined, { "x-team-key": other.key }))
        .status,
    ).toBe(404);
    const list = await (await t.api("GET", "/api/recipes", undefined, tk)).json();
    expect(list.recipes.map((r: { slug: string }) => r.slug)).toContain("our-deploy");

    // Platform recipe by the admin: public.
    expect(
      (
        await t.admin("PUT", "/recipes/house-style", {
          body_ar: "## الهدف\n\nأسلوب.",
          title_ar: "الأسلوب",
        })
      ).status,
    ).toBe(200);
    expect((await t.api("GET", "/api/recipes/house-style?lang=ar")).status).toBe(200);
    expect((await t.api("PUT", "/api/teams/sanad/recipes/house-style", body, tk)).status).toBe(409);

    // MCP: every token gets list_recipes/get_recipe, including the team's own.
    const site = await (await t.publish(team.key)).json();
    const rpc = async (method: string, params: object = {}) =>
      (
        await t.api(
          "POST",
          `/mcp/s/${site.id}`,
          { jsonrpc: "2.0", id: 1, method, params },
          { authorization: `Bearer ${ro}`, accept: "application/json, text/event-stream" },
        )
      ).json();
    const names = (await rpc("tools/list")).result.tools.map((x: { name: string }) => x.name);
    expect(names).toEqual(expect.arrayContaining(["list_recipes", "get_recipe"]));
    expect(names).not.toContain("create_user_key");
    const lr = await rpc("tools/call", { name: "list_recipes", arguments: { lang: "ar" } });
    expect(lr.result.structuredContent.recipes.map((r: { slug: string }) => r.slug)).toContain(
      "our-deploy",
    );
    const gr = await rpc("tools/call", {
      name: "get_recipe",
      arguments: { slug: "protect-mcp-with-keys" },
    });
    expect(gr.result.content[0].text).toMatch(/requireKey/);

    // Pages: public index + page (built-ins only), raw HTML in custom recipes escaped.
    expect((await t.api("GET", "/docs/recipes")).status).toBe(200);
    const page = await (await t.api("GET", "/ar/docs/recipes/mcp-server-on-worker")).text();
    expect(page).toContain('dir="rtl"');
    expect((await t.api("GET", "/docs/recipes/our-deploy")).status).toBe(404);
    const { b } = await t.signIn(team.key, "/ar");
    const own = await (await b.get("/ar/team/recipes/our-deploy")).text();
    expect(own).not.toContain("<script>alert(1)</script>");
    expect(own).toContain("&lt;script&gt;");
    expect((await b.get("/ar/team/recipes")).status).toBe(200);

    // Invite onboarding links the recipes.
    const inv = await (
      await t.api(
        "POST",
        "/api/teams/sanad/agent-invites",
        { name: "x", scopes: ["mcp"], expiresInDays: 7 },
        tk,
      )
    ).json();
    const onboarding = await (await t.api("GET", new URL(inv.url).pathname)).text();
    expect(onboarding).toMatch(/Recipes/);
    expect(onboarding).toMatch(/agent-security-rules\?format=md/);
    expect(
      (await t.api("DELETE", "/api/teams/sanad/recipes/our-deploy", undefined, tk)).status,
    ).toBe(204);
  });
});

describe("0.14.0 Worker API keys", () => {
  it("injects the verifier, enforces keys, limits, tools, expiry and revoke", async () => {
    const { cf, tk, uk, agent } = await setup();
    const base = "/api/teams/sanad/workers/mcp/keys";
    // Read-only agent key cannot change settings.
    const reader = await agent(["workers:read"]);
    expect(
      (await t.api("PUT", `${base}/settings`, { required: true }, { "x-team-key": reader })).status,
    ).toBe(403);
    expect((await t.api("GET", base, undefined, { "x-team-key": reader })).status).toBe(200);

    const s = await t.api(
      "PUT",
      `${base}/settings`,
      { required: true, perMinute: 3, perDay: 5 },
      tk,
    );
    expect(s.status).toBe(200);
    const settings = (await s.json()).settings;
    expect(settings).toMatchObject({ required: true, perMinute: 3, perDay: 5 });
    expect(JSON.stringify(settings)).not.toMatch(/marsa_wkv_[A-Za-z0-9_-]{20}/);
    const script = cf.scripts.get("team-sanad-mcp");
    const verifier = script?.secrets.get("MARSA_KEYS_SECRET") ?? "";
    expect(verifier).toMatch(/^marsa_wkv_/);
    expect(script?.secrets.get("MARSA_KEYS_URL")).toBe("https://spaces.test/api/keys/verify");
    // The Worker's own secret list does not show the system secrets; users can't set them.
    const w = await (await t.api("GET", "/api/teams/sanad/workers", undefined, tk)).json();
    expect(w.workers[0].secrets).not.toContain("MARSA_KEYS_SECRET");
    expect(
      (
        await t.api(
          "PUT",
          "/api/teams/sanad/workers/mcp",
          { code: CODE, secrets: { MARSA_KEYS_SECRET: "x" } },
          tk,
        )
      ).status,
    ).toBe(400);

    const mk = async (body: object) => {
      const r = await t.api("POST", base, body, tk);
      expect(r.status).toBe(201);
      return (await r.json()) as { key: { id: string; prefix: string }; secret: string };
    };
    const a = await mk({ label: "Partner A", email: "a@example.org" });
    const b = await mk({ label: "Tools", tools: ["search_items"], perMinute: 100, perDay: 100 });
    const c = await mk({ label: "Short", expiresInDays: 1 });
    expect(a.secret).toMatch(/^msk_/);
    const verify = (key: unknown, tool = "", auth = verifier, uses = 0) =>
      t.api("POST", "/api/keys/verify", { key, tool, uses }, { authorization: `Bearer ${auth}` });
    const v = async (key: unknown, tool = "") => (await verify(key, tool)).json();

    expect((await verify(a.secret, "", "marsa_wkv_wrong")).status).toBe(401);
    expect(await v("")).toMatchObject({ allow: false, status: 401, code: "MISSING_KEY" });
    expect(await v("msk_nope")).toMatchObject({ allow: false, status: 401, code: "INVALID_KEY" });
    // Per minute: 3 allowed, the 4th is 429.
    for (let i = 0; i < 3; i++) expect((await v(a.secret)).allow).toBe(true);
    const over = await v(a.secret);
    expect(over).toMatchObject({ allow: false, status: 429, code: "RATE_LIMITED" });
    expect(over.retryAfter).toBeGreaterThan(0);
    // Next minute: 2 more for the day (5), then the day limit.
    t.clock.now += 61_000;
    expect((await v(a.secret)).allow).toBe(true);
    expect((await v(a.secret)).allow).toBe(true);
    t.clock.now += 61_000;
    expect(await v(a.secret)).toMatchObject({ status: 429, code: "RATE_LIMITED" });
    // Allowed tools.
    expect((await v(b.secret, "search_items")).allow).toBe(true);
    expect(await v(b.secret, "delete_all")).toMatchObject({
      status: 403,
      code: "TOOL_NOT_ALLOWED",
    });
    // Revoke.
    expect((await t.api("DELETE", `${base}/${b.key.id}`, undefined, tk)).status).toBe(200);
    expect(await v(b.secret, "search_items")).toMatchObject({ status: 401, code: "REVOKED" });
    // Expiry.
    expect((await v(c.secret)).allow).toBe(true);
    t.clock.now += 2 * 86_400_000;
    expect(await v(c.secret)).toMatchObject({ status: 401, code: "EXPIRED" });
    // Cached uses reported by the helper count toward the limit.
    const d = await mk({ label: "Cache", perMinute: 10, perDay: 1000 });
    expect((await (await verify(d.secret, "", verifier, 9)).json()).allow).toBe(true);
    expect((await (await verify(d.secret, "", verifier, 0)).json()).status).toBe(429);

    // Usage stats, no secret anywhere in listings or files.
    const list = await (await t.api("GET", base, undefined, tk)).json();
    const ka = list.keys.find((k: { id: string }) => k.id === a.key.id);
    expect(ka.usage.last7d).toBe(5);
    expect(ka.usage.limited7d).toBe(2);
    const dump = JSON.stringify(list);
    for (const sec of [a.secret, b.secret, c.secret, d.secret, verifier])
      expect(dump).not.toContain(sec);
    await uk.flush();
    const file = await readFile(join(t.config.dataDir, "user-keys.json"), "utf8");
    for (const sec of [a.secret, b.secret, c.secret, d.secret, verifier])
      expect(file).not.toContain(sec);

    // Turning keys off: the verifier answers allow for anyone.
    await t.api("PUT", `${base}/settings`, { required: false }, tk);
    expect(await v("")).toMatchObject({ allow: true, required: false });
    // Helper is served and uses the instance URL.
    const h = await t.api("GET", "/api/keys/helper.v2.js");
    expect(await h.text()).toBe(keysHelperSource("https://spaces.test"));
    const old = await t.api("GET", "/api/keys/helper.js");
    expect(old.status).toBe(302);
    expect(old.headers.get("location")).toBe("/api/keys/helper.v2.js");
  });

  it("alerts on create/revoke and 429 spikes; MCP tools; dashboard page", async () => {
    const { tk, team, agent, cf } = await setup();
    const base = "/api/teams/sanad/workers/mcp/keys";
    await t.api("PUT", `${base}/settings`, { required: true, perMinute: 1 }, tk);
    const verifier = cf.scripts.get("team-sanad-mcp")?.secrets.get("MARSA_KEYS_SECRET") ?? "";
    const k = await (await t.api("POST", base, { label: "Noisy" }, tk)).json();
    for (let i = 0; i < 12; i++)
      await t.api(
        "POST",
        "/api/keys/verify",
        { key: k.secret },
        { authorization: `Bearer ${verifier}` },
      );
    const n = await (await t.api("GET", "/api/teams/sanad/notifications", undefined, tk)).json();
    const kinds = n.notifications.map((x: { kind: string }) => x.kind);
    expect(kinds).toContain("user-key-create");
    expect(kinds).toContain("user-key-spike");

    // MCP: create/list/revoke with an agent key that has workers:deploy + mcp.
    const site = await (await t.publish(team.key)).json();
    const dep = await agent(["workers:read", "workers:deploy", "mcp"]);
    const rpc = async (secret: string, name: string, args: object) =>
      (
        await t.api(
          "POST",
          `/mcp/s/${site.id}`,
          { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
          { authorization: `Bearer ${secret}`, accept: "application/json, text/event-stream" },
        )
      ).json();
    const created = await rpc(dep, "create_user_key", {
      worker: "mcp",
      label: "via mcp",
      perMinute: 5,
    });
    const sec = created.result.structuredContent.secret as string;
    expect(sec).toMatch(/^msk_/);
    const listed = await rpc(dep, "list_user_keys", { worker: "mcp" });
    expect(JSON.stringify(listed)).not.toContain(sec);
    const id = created.result.structuredContent.key.id;
    expect(
      (await rpc(dep, "revoke_user_key", { worker: "mcp", id })).result.structuredContent.key.state,
    ).toBe("revoked");
    const ro = await agent(["workers:read", "mcp"]);
    expect((await rpc(ro, "create_user_key", { worker: "mcp", label: "no" })).result.isError).toBe(
      true,
    );

    // Dashboard page renders for the team (Arabic).
    const { b } = await t.signIn(team.key, "/ar");
    const html = await (await b.get("/ar/team/workers/mcp?tab=keys")).text();
    expect(html).toContain("مفاتيح API");
    expect(html).toContain("Noisy");
    expect(html).not.toContain(k.secret);
    // Deleting the Worker drops its keys.
    expect((await t.api("DELETE", "/api/teams/sanad/workers/mcp", undefined, tk)).status).toBe(204);
    expect(
      (
        await t.api(
          "POST",
          "/api/keys/verify",
          { key: k.secret },
          { authorization: `Bearer ${verifier}` },
        )
      ).status,
    ).toBe(401);
  });
});
