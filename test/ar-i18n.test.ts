import { afterEach, describe, expect, it, vi } from "vitest";
import { latinTextNodes } from "./ar-scan.js";
import { CF_TOKEN, FakeCfWorkers, ZONE_NAME } from "./fake-cf-workers.js";
import { makeApp } from "./helpers.js";

type App = Awaited<ReturnType<typeof makeApp>>;
let t: App | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  await t?.cleanup();
  t = null;
});

const NAMES = ["Sanad", "sanad", "news", "bot", "Page", "Two", "A"];

describe("0.16.0 Arabic pages have no untranslated text", () => {
  it("scans team and admin pages with data", async () => {
    const cf = new FakeCfWorkers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    t = await makeApp({ MARSA_SECRETS_KEY: "k".repeat(48) }, { cfFetch: cf.fetch });
    await t.admin("PUT", "/workers/settings", { token: CF_TOKEN, zone: ZONE_NAME });
    const team = await t.createTeam("Sanad", { backend: true });
    await t.admin("PUT", `/teams/${team.team.id}/workers`, { enabled: true, slug: "sanad" });
    const tk = { "x-team-key": team.key };
    await t.publish(team.key, "<title>Page</title>");
    const ak = await t.api(
      "POST",
      `/api/teams/sanad/agent-keys`,
      { name: "bot", scopes: ["workers:read", "workers:deploy", "spaces:write"], expiresInDays: 7 },
      tk,
    );
    const agent = { authorization: `Bearer ${(await ak.json()).secret as string}` };
    const dep = await t.api(
      "PUT",
      "/api/teams/sanad/workers/news",
      {
        code: 'export default { fetch(r, env) { return new Response(env.A ?? "x"); } }',
        vars: { A: "1" },
        requiredEnv: ["A"],
      },
      agent,
    );
    expect(dep.status).toBe(201);
    await t.api("POST", "/api/teams/sanad/workers/news/redeploy", {}, agent);
    await t.publish(team.key, "<title>Two</title>");
    const { b } = await t.signIn(team.key, "/ar");
    const a = await t.adminBrowser();
    const pages: [typeof b, string][] = [
      [b, "/ar/team"],
      [b, "/ar/team/activity"],
      [b, "/ar/team/workers"],
      [b, "/ar/team/workers/news"],
      [b, "/ar/team/workers/news?tab=env"],
      [b, "/ar/team/workers/news?tab=health"],
      [b, "/ar/team/workers/news?tab=versions"],
      [b, "/ar/team/settings"],
      [b, "/ar/team/mcp"],
      [a, "/ar/admin"],
      [a, "/ar/admin/activity"],
      [a, "/ar/admin/workers"],
      [a, "/ar/admin/mcp"],
      [a, "/ar/admin/settings"],
      [a, `/ar/admin/teams/${team.team.id}`],
      [a, `/ar/admin/teams/${team.team.id}?tab=activity`],
    ];
    const found: string[] = [];
    for (const [who, path] of pages) {
      const res = await who.get(path);
      if (res.status !== 200) continue;
      for (const s of latinTextNodes(await res.text(), NAMES)) found.push(`${path}: ${s}`);
    }
    expect(found).toEqual([]);
    const act = await (await b.get("/ar/team/activity")).text();
    expect(act).toContain("مفتاح الوكيل bot");
    expect(act).not.toContain("agent key bot");
  });

  it("translates actor labels and detail templates", async () => {
    const { actorText, detailText } = await import("../src/i18n.js");
    expect(actorText("ar", "agent key deployer")).toBe("مفتاح الوكيل deployer");
    expect(actorText("ar", "team key")).toBe("مفتاح الفريق");
    expect(actorText("en", "agent key deployer")).toBe("agent key deployer");
    expect(actorText("ar", "Layla")).toBe("Layla");
    expect(detailText("ar", "redeploy of v3")).toBe("إعادة نشر v3");
    expect(detailText("ar", "api: required, 60/min, 5000/day")).toBe(
      "api: مطلوب، ٦٠/دقيقة، ٥٠٠٠/يوم",
    );
    expect(detailText("ar", "backend on, maxSites 10")).toBe(
      "البيانات والملفات: مفعّل، حد المواقع: ١٠",
    );
    expect(detailText("ar", "workers 5/6, backend not set")).toBe(
      "الوركرات: ٥/٦، البيانات والملفات: غير مضبوط",
    );
    expect(detailText("ar", "some free text")).toBe("some free text");
    expect(detailText("en", "redeploy of v3")).toBe("redeploy of v3");
  });
});

describe("0.16.0 Arabic glossary", () => {
  it("uses one word per term in the UI and the Arabic docs", async () => {
    const { readFile, readdir } = await import("node:fs/promises");
    const files = [
      ...(await readdir("src")).filter((f) => f.endsWith(".ts")).map((f) => `src/${f}`),
      ...(await readdir("docs/ar")).map((f) => `docs/ar/${f}`),
      ...(await readdir("docs/recipes"))
        .filter((f) => f.endsWith(".ar.md"))
        .map((f) => `docs/recipes/${f}`),
    ];
    const banned = /إيجنت|ايجنت|سيرفر|فحص الحالة/;
    const hits: string[] = [];
    for (const f of files) {
      const text = await readFile(f, "utf8");
      const lines = text.split("\n");
      lines.forEach((l, i) => {
        if (banned.test(l) && !f.endsWith("glossary.md")) hits.push(`${f}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
