import { afterEach, describe, expect, it, vi } from "vitest";
import { CF_TOKEN, FakeCfWorkers, ZONE_NAME } from "./fake-cf-workers.js";
import { makeApp } from "./helpers.js";

type App = Awaited<ReturnType<typeof makeApp>>;
let t: App;
afterEach(async () => {
  vi.restoreAllMocks();
  await t?.cleanup();
});

const KEY = "k".repeat(48);
const CODE = (s: string) =>
  `export default { async fetch(request, env) { return new Response(${JSON.stringify(s)}); } };`;

async function setup() {
  const cf = new FakeCfWorkers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  t = await makeApp({ MARSA_SECRETS_KEY: KEY }, { cfFetch: cf.fetch });
  expect(
    (await t.admin("PUT", "/workers/settings", { token: CF_TOKEN, zone: ZONE_NAME })).status,
  ).toBe(200);
  const a = await t.createTeam("Team Marsa");
  const b = await t.createTeam("Sanad");
  for (const [team, slug] of [
    [a, "marsa"],
    [b, "sanad"],
  ] as const) {
    expect(
      (await t.admin("PUT", `/teams/${team.team.id}/workers`, { enabled: true, slug })).status,
    ).toBe(200);
  }
  const put = (slug: string, key: string, name: string, body: unknown) =>
    t.api("PUT", `/api/teams/${slug}/workers/${name}`, body, { "x-team-key": key });
  const post = (slug: string, key: string, path: string, body: unknown) =>
    t.api("POST", `/api/teams/${slug}/workers/${path}`, body, { "x-team-key": key });
  expect((await put("sanad", b.key, "news", { code: CODE("news") })).status).toBe(201);
  expect((await put("marsa", a.key, "news", { code: CODE("m-news") })).status).toBe(201);
  return { cf, a, b, put, post };
}

const errCode = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;

describe("0.15.0 Worker runtime: compatibility flags and same-team service bindings", () => {
  it("accepts allowlisted flags and dates only, and stores them in versions", async () => {
    const { cf, b, put } = await setup();
    const ok = await put("sanad", b.key, "morassel", {
      code: CODE("m"),
      compatibilityDate: "2025-01-15",
      compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public", "nodejs_compat"],
    });
    expect(ok.status).toBe(201);
    const w = ((await ok.json()) as { worker: Record<string, unknown> }).worker;
    expect(w.compatibilityFlags).toEqual(["global_fetch_strictly_public", "nodejs_compat"]);
    expect(w.compatibilityDate).toBe("2025-01-15");
    const s = cf.scripts.get("team-sanad-morassel");
    expect(s?.compatibilityFlags).toEqual(["global_fetch_strictly_public", "nodejs_compat"]);
    expect(s?.compatibilityDate).toBe("2025-01-15");
    for (const bad of [
      { compatibilityFlags: ["unsafe_eval"] },
      { compatibilityFlags: ["experimental"] },
      { compatibilityFlags: "nodejs_compat" },
      { compatibilityDate: "2999-01-01" },
      { compatibilityDate: "2020-01-01" },
      { compatibilityDate: "2025-02-30" },
    ]) {
      const r = await put("sanad", b.key, "morassel", { code: CODE("m"), ...bad });
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
    // A redeploy without the fields keeps them; the version records them.
    expect((await put("sanad", b.key, "morassel", { code: CODE("m2") })).status).toBe(200);
    expect(cf.scripts.get("team-sanad-morassel")?.compatibilityFlags).toHaveLength(2);
    const v = await t.api("GET", "/api/teams/sanad/workers/morassel/versions/2", undefined, {
      "x-team-key": b.key,
    });
    const ver = ((await v.json()) as { version: { runtime: Record<string, unknown> } }).version;
    expect(ver.runtime.compatibilityFlags).toEqual([
      "global_fetch_strictly_public",
      "nodejs_compat",
    ]);
    const info = await t.api("GET", "/api/teams/sanad/workers", undefined, { "x-team-key": b.key });
    expect(
      ((await info.json()) as { allowedCompatibilityFlags: string[] }).allowedCompatibilityFlags,
    ).toContain("global_fetch_strictly_public");
  });

  it("binds only to Workers of the same team, never across teams or to non-Spaces scripts", async () => {
    const { cf, a, b, put, post } = await setup();
    const newsBefore = cf.scripts.get("team-sanad-news")?.code;
    const r = await put("sanad", b.key, "morassel", {
      code: CODE("m"),
      bindings: [{ name: "NEWS", worker: "news" }],
    });
    expect(r.status).toBe(201);
    expect(cf.scripts.get("team-sanad-morassel")?.services).toEqual({ NEWS: "team-sanad-news" });
    // The bound Worker is untouched.
    expect(cf.scripts.get("team-sanad-news")?.code).toBe(newsBefore);
    // Marsa's "news" resolves to Marsa's own Worker, never Sanad's.
    expect(
      (
        await put("marsa", a.key, "caller", {
          code: CODE("c"),
          bindings: [{ name: "N", worker: "news" }],
        })
      ).status,
    ).toBe(201);
    expect(cf.scripts.get("team-marsa-caller")?.services).toEqual({ N: "team-marsa-news" });
    for (const bad of [
      [{ name: "X", worker: "morassel" }], // another team's Worker (marsa has none by that name)
      [{ name: "X", worker: "team-sanad-news" }], // a script name
      [{ name: "X", service: "team-sanad-news" }],
      [{ name: "X", worker: "news", service: "team-sanad-news" }],
      [{ name: "X", worker: "news", environment: "production" }],
      [{ name: "X", worker: "marsa-atlas-mcp" }],
      [{ name: "X", worker: "caller" }], // itself
      [{ name: "MARSA_KEYS_URL", worker: "news" }],
      [{ name: "lower-case!", worker: "news" }],
      [{ type: "durable_object_namespace", name: "X", worker: "news" }],
    ]) {
      const res = await put("marsa", a.key, "caller", { code: CODE("c"), bindings: bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    // A binding name that collides with a var is refused.
    expect(
      (
        await put("marsa", a.key, "caller", {
          code: CODE("c"),
          vars: { N: "x" },
          bindings: [{ name: "N", worker: "news" }],
        })
      ).status,
    ).toBe(400);
    // Cross-team via the runtime endpoint: Sanad's key cannot touch Marsa's Worker.
    const x = await post("marsa", b.key, "caller/runtime", { bindings: [] });
    expect([401, 403, 404]).toContain(x.status);
    expect(cf.scripts.get("team-marsa-caller")?.services).toEqual({ N: "team-marsa-news" });
  });

  it("sets flags and bindings without code, keeps the target, and blocks deleting a bound Worker", async () => {
    const { cf, b, put, post } = await setup();
    expect((await put("sanad", b.key, "morassel", { code: CODE("m") })).status).toBe(201);
    const newsCode = cf.scripts.get("team-sanad-news")?.code;
    const r = await post("sanad", b.key, "morassel/runtime", {
      compatibilityFlags: ["global_fetch_strictly_public"],
      bindings: [{ name: "NEWS", worker: "news" }],
    });
    expect(r.status).toBe(200);
    const m = cf.scripts.get("team-sanad-morassel");
    expect(m?.code).toContain('"m"');
    expect(m?.services).toEqual({ NEWS: "team-sanad-news" });
    expect(m?.compatibilityFlags).toEqual(["global_fetch_strictly_public"]);
    expect(cf.scripts.get("team-sanad-news")?.code).toBe(newsCode);
    const del = await t.api("DELETE", "/api/teams/sanad/workers/news", undefined, {
      "x-team-key": b.key,
    });
    expect(del.status).toBe(409);
    expect(await errCode(del)).toBe("WORKER_BOUND");
    // Rolling back to v1 restores v1's runtime (no binding), then news can go.
    const rb = await post("sanad", b.key, "morassel/rollback", { version: 1 });
    expect(rb.status).toBe(200);
    expect(cf.scripts.get("team-sanad-morassel")?.services).toEqual({});
    expect(
      (await t.api("DELETE", "/api/teams/sanad/workers/news", undefined, { "x-team-key": b.key }))
        .status,
    ).toBe(204);
  });

  it("shows and edits the runtime on the Worker page (team) and read-only for admins", async () => {
    const { cf, b, put } = await setup();
    expect((await put("sanad", b.key, "morassel", { code: CODE("m") })).status).toBe(201);
    const { b: br } = await t.signIn(b.key);
    const page = await (await br.get("/team/workers/morassel?tab=settings")).text();
    expect(page).toContain('action="/team/workers/morassel/runtime"');
    expect(page).toContain("global_fetch_strictly_public");
    const csrf = await br.csrf("/team/workers/morassel?tab=settings");
    const res = await br.post("/team/workers/morassel/runtime", {
      _csrf: csrf,
      compatibilityFlags: "global_fetch_strictly_public",
      compatibilityDate: "",
      bindings: "NEWS=news",
    });
    expect(res.status).toBe(303);
    expect(cf.scripts.get("team-sanad-morassel")?.services).toEqual({ NEWS: "team-sanad-news" });
    const over = await (await br.get("/ar/team/workers/morassel")).text();
    expect(over).toContain("NEWS → news");
    const admin = await t.adminBrowser();
    const id = b.team.id;
    const adm = await (await admin.get(`/admin/teams/${id}/workers/morassel?tab=settings`)).text();
    expect(adm).toContain("NEWS → news");
    expect(adm).not.toContain("/runtime");
  });
});
