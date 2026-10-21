import { afterEach, describe, expect, it, vi } from "vitest";
import { CF_TOKEN, FakeCfWorkers, ZONE_NAME } from "./fake-cf-workers.js";
import { makeApp } from "./helpers.js";

type App = Awaited<ReturnType<typeof makeApp>>;
let t: App | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  await t?.cleanup();
  t = null;
});

const count = async (app: App, team: string) =>
  (
    (await (await app.admin("GET", `/activity?team=${team}&limit=5000`)).json()) as {
      count: number;
    }
  ).count;

describe("0.16.0 activity API and downloads", () => {
  it("lets the team key read and download its log; agent keys get 403", async () => {
    t = await makeApp();
    const team = await t.createTeam("Crew", { backend: true });
    const id = team.team.id;
    const tk = { "x-team-key": team.key };
    await t.publish(team.key, "<title>One</title>");
    await t.publish(team.key, "<title>=cmd()</title>");
    const r = await t.api("GET", `/api/teams/${id}/activity`, undefined, tk);
    expect(r.status).toBe(200);
    const j = (await r.json()) as {
      entries: { action: string; memberId?: string }[];
      count: number;
    };
    expect(j.count).toBeGreaterThanOrEqual(2);
    expect(j.entries.every((e) => e.memberId === undefined)).toBe(true);
    const only = await (
      await t.api("GET", `/api/teams/${id}/activity?action=publish&limit=1`, undefined, tk)
    ).json();
    expect(only.count).toBe(1);
    expect(only.entries[0].action).toBe("publish");

    const csv = await t.api("GET", `/api/teams/${id}/activity?format=csv`, undefined, tk);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.headers.get("content-disposition")).toContain("attachment");
    const text = await csv.text();
    expect(text.split("\n")[0]).toContain("at");
    expect(text).toContain("'=cmd()");
    expect(text).not.toMatch(/,"=cmd/);
    const jl = await t.api("GET", `/api/teams/${id}/activity?format=jsonl`, undefined, tk);
    const lines = (await jl.text()).trim().split("\n");
    expect(lines.length).toBe(j.count);
    expect(JSON.parse(lines[0] ?? "{}").action).toBeTruthy();

    const ak = await t.api(
      "POST",
      `/api/teams/${id}/agent-keys`,
      { name: "bot", scopes: ["spaces:read", "spaces:write"], expiresInDays: 7 },
      tk,
    );
    const agent = { authorization: `Bearer ${(await ak.json()).secret}` };
    const denied = await t.api("GET", `/api/teams/${id}/activity`, undefined, agent);
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe("TEAM_KEY_REQUIRED");
    expect((await t.api("GET", `/api/teams/${id}/export`, undefined, agent)).status).toBe(403);
    expect((await t.api("GET", `/api/teams/${id}/activity`)).status).toBe(401);
    const other = await t.createTeam("Other");
    expect(
      (await t.api("GET", `/api/teams/${id}/activity`, undefined, { "x-team-key": other.key }))
        .status,
    ).toBe(404);

    // Export with the team key: a zip, audited.
    const ex = await t.api("GET", `/api/teams/${id}/export`, undefined, tk);
    expect(ex.status).toBe(200);
    expect(ex.headers.get("content-type")).toBe("application/zip");
    const after = await (
      await t.api("GET", `/api/teams/${id}/activity?action=team-export`, undefined, tk)
    ).json();
    expect(after.count).toBe(1);

    // Admin: one team, the platform log, everything; bad team is 404.
    const a = await (await t.admin("GET", `/activity?team=${id}&action=team-`)).json();
    expect(a.entries.every((e: { action: string }) => e.action.startsWith("team-"))).toBe(true);
    expect(a.entries[0].team).toBe("Crew");
    expect((await t.admin("GET", "/activity?team=nope")).status).toBe(404);
    const plat = await (await t.admin("GET", "/activity?team=platform")).json();
    expect(plat.entries.some((e: { action: string }) => e.action === "team-create")).toBe(true);
    const since = await (
      await t.admin("GET", `/activity?since=${new Date(t.clock.now + 1000).toISOString()}`)
    ).json();
    expect(since.count).toBe(0);
  });

  it("offers CSV/JSONL downloads and a team export button in the dashboard", async () => {
    t = await makeApp();
    const team = await t.createTeam("Crew", { backend: true });
    await t.publish(team.key);
    const { b } = await t.signIn(team.key);
    const act = await (await b.get("/team/activity")).text();
    expect(act).toContain("/team/activity/export?format=csv");
    const dl = await b.get("/team/activity/export?format=csv");
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toContain("text/csv");
    const settings = await (await b.get("/team/settings")).text();
    expect(settings).toContain("/team/settings/export");
    const zip = await b.get("/team/settings/export");
    expect(zip.status).toBe(200);
    expect(zip.headers.get("content-type")).toBe("application/zip");

    const a = await t.adminBrowser();
    const aact = await (await a.get("/admin/activity")).text();
    expect(aact).toContain("/admin/activity/export");
    const all = await a.get(`/admin/activity/export?team=${team.team.id}&format=jsonl`);
    expect(all.status).toBe(200);
    expect(all.headers.get("content-type")).toContain("ndjson");
    // Signed-out: no downloads.
    const { Browser } = await import("./helpers.js");
    const anon = new Browser(t.app);
    expect((await anon.get("/admin/activity/export")).status).toBe(303);
    expect((await anon.get("/team/activity/export")).status).toBe(303);
  });
});

describe("0.16.0 every admin mutation writes an audit entry", () => {
  it("logs team create/update, invites, sites, sweep, recipes, notes, health and webhooks", async () => {
    t = await makeApp();
    const app = t;
    const team = await app.createTeam("Crew", { backend: true });
    const id = team.team.id;
    const pub = (await (await app.publish(team.key)).json()) as { id: string };
    const inv = await app.admin("POST", `/teams/${id}/invites`, { role: "editor" });
    const invite = (await inv.json()) as { invite: { id: string } };

    const cases: [string, () => Response | Promise<Response>, string, number][] = [
      ["team-create", () => app.admin("POST", "/teams", { name: "Second" }), "platform", 201],
      ["team-update", () => app.admin("PATCH", `/teams/${id}`, { maxSites: 9 }), id, 200],
      [
        "invite-revoke",
        () => app.admin("DELETE", `/teams/${id}/invites/${invite.invite.id}`),
        id,
        204,
      ],
      ["permanent", () => app.admin("PATCH", `/sites/${pub.id}`, { permanent: true }), id, 200],
      ["delete", () => app.admin("DELETE", `/sites/${pub.id}`), id, 204],
      ["sweep", () => app.admin("POST", "/sweep"), "platform", 200],
      [
        "recipe-save",
        () =>
          app.admin("PUT", "/recipes/audit-test", {
            title_en: "Audit",
            summary_en: "x",
            body_en: "# Audit\n\nBody",
          }),
        "platform",
        200,
      ],
      ["recipe-delete", () => app.admin("DELETE", "/recipes/audit-test"), "platform", 204],
      ["webhook-clear", () => app.admin("DELETE", "/webhook"), "platform", 204],
      ["team-key-rotate", () => app.admin("POST", `/teams/${id}/rotate`), id, 200],
    ];
    for (const [action, run, log, status] of cases) {
      const before = await count(app, log);
      const res = await run();
      expect(res.status, action).toBe(status);
      expect(await count(app, log), action).toBe(before + 1);
      const last = await (await app.admin("GET", `/activity?team=${log}&limit=1`)).json();
      expect(last.entries[0].action, action).toBe(action);
    }
    // team-update records what changed.
    const upd = await (await app.admin("GET", `/activity?team=${id}&action=team-update`)).json();
    expect(upd.entries[0].detail).toContain("maxSites 9");
  });

  it("logs the dashboard's admin forms too", async () => {
    t = await makeApp();
    const a = await t.adminBrowser();
    const csrf = await a.csrf("/admin");
    await a.post("/admin/teams", { _csrf: csrf, name: "Web team", backend: "1" });
    const plat = await (await t.admin("GET", "/activity?team=platform&action=team-create")).json();
    expect(plat.count).toBe(1);
    const id = (await (await t.admin("GET", "/teams")).json()).teams[0].id as string;
    await a.post(`/admin/teams/${id}/update`, { _csrf: csrf, directory: "0" });
    const upd = await (await t.admin("GET", `/activity?team=${id}&action=team-update`)).json();
    expect(upd.entries[0].detail).toBe("directory off");
  });
});

describe("0.16.0 admin Settings renders without waiting on the token probes", () => {
  it("shows a checking note first, then the cached report with its age", async () => {
    const cf = new FakeCfWorkers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    t = await makeApp({ MARSA_SECRETS_KEY: "k".repeat(48) }, { cfFetch: cf.fetch });
    await t.admin("PUT", "/workers/settings", { token: CF_TOKEN, zone: ZONE_NAME });
    const a = await t.adminBrowser();
    const before = cf.calls.length;
    const first = await (await a.get("/admin/settings")).text();
    expect(first).toContain("Checking the token now");
    // The probes run in the background; the next load has the report.
    await vi.waitFor(() => expect(cf.calls.length).toBeGreaterThan(before + 5));
    await new Promise((r) => setTimeout(r, 50));
    const next = await (await a.get("/admin/settings")).text();
    expect(next).not.toContain("Checking the token now");
    expect(next).toMatch(/checked/);
    expect(next).not.toContain(CF_TOKEN);
  });
});

describe("0.16.0 health checks treat 4xx by Worker type and honour a declared target", () => {
  it("web < 400, MCP GET < 500, declared path/expect, and legacy 4xx Workers stay quiet", async () => {
    const { HealthMonitor, readHealthExpect, statusMatches } = await import(
      "../src/worker-health.js"
    );
    const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "hm-"));
    const status: Record<string, number> = {};
    const hits: string[] = [];
    const m = new HealthMonitor(dir, {
      now: () => 1_000_000,
      fetch: async (u) => {
        hits.push(String(u));
        return new Response(null, { status: status[String(u)] ?? 200 });
      },
      kindOf: (r) => ((r as { id: string }).id.startsWith("mcp") ? "mcp" : "web"),
    });
    const rec = (id: string, meta: object = {}) =>
      ({ id, teamId: "t", name: id, url: `https://${id}.test`, status: "active", meta }) as never;
    status["https://web.test"] = 404;
    expect((await m.checkOne(rec("web"))).ok).toBe(0);
    expect(m.view("web").rule).toBe("GET / · <400");
    status["https://mcp1.test"] = 401;
    expect((await m.checkOne(rec("mcp1"))).ok).toBe(1);
    status["https://web2.test/health"] = 204;
    expect((await m.checkOne(rec("web2", { healthPath: "/health", healthExpect: "2xx" }))).ok).toBe(
      1,
    );
    expect(hits).toContain("https://web2.test/health");
    status["https://web3.test"] = 404;
    expect((await m.checkOne(rec("web3", { healthExpect: "200,404" }))).ok).toBe(1);

    expect(readHealthExpect(" 2XX, 404 ")).toBe("2xx,404");
    expect(() => readHealthExpect("abc")).toThrow();
    expect(() => readHealthExpect("300-200")).toThrow();
    expect(statusMatches("<400", 399)).toBe(true);
    expect(statusMatches("200-299", 300)).toBe(false);
    expect(statusMatches("2xx", 0)).toBe(false);

    // Upgrade: a Worker whose last GET answered 404 keeps "< 500" until a target is declared.
    await writeFile(
      join(dir, "health.json"),
      JSON.stringify({
        workers: {
          old: {
            enabled: true,
            state: "up",
            since: 1,
            fails: 0,
            checks: [{ t: 999_000, ok: 1, ms: 5, s: 404, via: "get" }],
            days: {},
          },
        },
      }),
    );
    const m2 = new HealthMonitor(dir, {
      now: () => 1_000_000,
      fetch: async () => new Response("", { status: 404 }),
    });
    await m2.ready();
    expect(m2.view("old").legacy).toBe(true);
    expect((await m2.checkOne(rec("old"))).ok).toBe(1);
    expect((await m2.checkOne(rec("old", { healthPath: "/" }))).ok).toBe(0);
    expect(m2.view("old").legacy).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });

  it("validates health meta on deploy-time metadata", async () => {
    const { readMeta } = await import("../src/worker-insight.js");
    expect(readMeta({ healthPath: "/ping", healthExpect: "200-399" })).toEqual({
      healthPath: "/ping",
      healthExpect: "200-399",
    });
    expect(() => readMeta({ healthPath: "ping" })).toThrow(/healthPath/);
    expect(() => readMeta({ healthPath: "//evil.example" })).toThrow(/healthPath/);
    expect(() => readMeta({ healthExpect: "ok" })).toThrow(/healthExpect/);
  });
});

describe("0.16.0 headers", () => {
  it("sends one X-Frame-Options, HSTS with preload, and immutable versioned assets", async () => {
    t = await makeApp();
    const home = await t.app.request("/");
    expect(home.headers.get("x-frame-options")).toBe("DENY");
    expect(home.headers.get("strict-transport-security")).toContain("preload");
    const html = await home.text();
    const v = /app\.css\?v=([a-f0-9]+)/.exec(html)?.[1];
    expect(v).toBeTruthy();
    const css = await t.app.request(`/assets/app.css?v=${v}`);
    expect(css.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const plain = await t.app.request("/assets/app.css");
    expect(plain.headers.get("cache-control")).toBe("public, max-age=300");
    const old = await t.app.request("/assets/app.js?v=stale");
    expect(old.headers.get("cache-control")).toBe("public, max-age=300");
  });
});

describe("0.16.0 quieter env warnings", () => {
  it("skips names with defaults and keeps code-only names as info", async () => {
    const { scanEnvUsage, buildEnvView } = await import("../src/worker-env.js");
    expect(
      scanEnvUsage(
        `const a = env.SEED ?? "x"; const b = env.URL || "y"; const c = env.KEY; const { MODE = "dev", HOST } = env; env["OPT"] ?? 1; env.KEY ?? 2;`,
      ),
    ).toEqual(["HOST", "KEY"]);
    const v = buildEnvView(
      { vars: {}, secrets: [], requiredEnv: ["NEED"] },
      [],
      "env.HOST; env.SEED ?? 1",
    );
    expect(v.missing).toEqual([{ name: "NEED", why: "declared" }]);
    expect(v.unset).toEqual(["HOST"]);
    expect(v.entries.map((e) => e.name)).not.toContain("SEED");
  });
});

describe("0.16.0 titles, MCP health column and the Down now card", () => {
  it("formats every dashboard title and shows health on the MCP page", async () => {
    const cf = new FakeCfWorkers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    t = await makeApp({ MARSA_SECRETS_KEY: "k".repeat(48) }, { cfFetch: cf.fetch });
    await t.admin("PUT", "/workers/settings", { token: CF_TOKEN, zone: ZONE_NAME });
    const team = await t.createTeam("Sanad", { backend: true });
    await t.admin("PUT", `/teams/${team.team.id}/workers`, { enabled: true, slug: "sanad" });
    const tk = { "x-team-key": team.key };
    const mcp = `export default { async fetch(r, env) { if (new URL(r.url).pathname === "/mcp") return new Response("{}"); return new Response("ok"); } };`;
    const dep = await t.api(
      "PUT",
      "/api/teams/sanad/workers/tools",
      { code: mcp, meta: { kind: "mcp" } },
      tk,
    );
    expect(dep.status).toBe(201);
    const a = await t.adminBrowser();
    const { b } = await t.signIn(team.key, "/ar");
    const title = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
    for (const p of [
      "/ar/admin",
      "/ar/admin/mcp",
      "/ar/admin/notes",
      "/ar/admin/workers",
      "/ar/admin/settings",
      "/ar/admin/activity",
      "/ar/admin/recipes",
    ]) {
      const html = await (await a.get(p)).text();
      expect(title(html), p).toMatch(/ · الإدارة · /);
    }
    for (const p of ["/admin/mcp", "/admin/notes"]) {
      const html = await (await a.get(p)).text();
      expect(title(html), p).toMatch(/ · Admin · Marsa Spaces$/);
    }
    for (const p of ["/ar/team", "/ar/team/mcp", "/ar/team/notes", "/ar/team/workers"]) {
      const res = await b.get(p);
      if (res.status !== 200) continue;
      expect(title(await res.text()), p).toMatch(/ · Sanad · /);
    }
    const page = await (await a.get("/admin/mcp")).text();
    expect(page).toContain("Health");
    expect(page).toMatch(/data-f-health=/);
    const ov = await (await a.get("/admin")).text();
    expect(ov).toContain("Down now");
    expect(ov).toContain("All checked Workers are up");
  });
});

describe("0.16.0 accessibility of rendered Markdown", () => {
  it("labels checklist boxes, makes code focusable and keeps one h1", async () => {
    t = await makeApp();
    const team = await t.createTeam("Crew");
    const { b } = await t.signIn(team.key);
    for (const p of [
      "/team/recipes/agent-security-rules",
      "/ar/team/recipes/agent-security-rules",
      "/docs/recipes/agent-security-rules",
    ]) {
      const res = p.startsWith("/ar/")
        ? await (await t.signIn(team.key, "/ar")).b.get(p)
        : await b.get(p);
      expect(res.status, p).toBe(200);
      const html = await res.text();
      const boxes = html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
      expect(boxes.length, p).toBeGreaterThan(0);
      for (const x of boxes) expect(x, p).toMatch(/aria-label="[^"]+"/);
      expect((html.match(/<h1[\s>]/g) ?? []).length, p).toBe(1);
      expect(html, p).not.toMatch(/<pre(?![^>]*tabindex)[\s>]/);
    }
    const { a11yHtml } = await import("../src/docs.js");
    expect(
      a11yHtml('<ul><li><input disabled="" type="checkbox"> Check <code>x</code></li></ul>'),
    ).toBe(
      '<ul><li><input disabled="" type="checkbox" aria-label="Check x"> Check <code>x</code></li></ul>',
    );
  });
});
