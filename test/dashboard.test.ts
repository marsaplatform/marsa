import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CF_TOKEN, FakeCfWorkers, ZONE_NAME } from "./fake-cf-workers.js";
import { BASE, Browser, makeApp } from "./helpers.js";

type App = Awaited<ReturnType<typeof makeApp>>;
let t: App;
afterEach(async () => {
  vi.restoreAllMocks();
  await t?.cleanup();
});

const KEY = "k".repeat(48);
const PW = "correct horse battery";
const HELLO = "export default { async fetch() { return new Response('hi'); } };";

async function setup() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await makeApp({ MARSA_SECRETS_KEY: KEY }, { cfFetch: new FakeCfWorkers().fetch });
  expect(
    (await t.admin("PUT", "/workers/settings", { token: CF_TOKEN, zone: ZONE_NAME })).status,
  ).toBe(200);
  const team = await t.createTeam("Crew");
  await t.admin("PUT", `/teams/${team.team.id}/workers`, { enabled: true, slug: "crew" });
  return team;
}

async function joinAs(teamId: string, role: string, username: string) {
  const res = await t.admin("POST", `/teams/${teamId}/invites`, { role });
  const path = ((await res.json()) as { url: string }).url.replace(BASE, "");
  const b = new Browser(t.app);
  const csrf = await b.csrf(path);
  await b.post(path, { _csrf: csrf, username, name: username, password: PW, confirm: PW });
  const s = new Browser(t.app);
  const c2 = await s.csrf("/login");
  await s.post("/login", { _csrf: c2, username, password: PW });
  return s;
}

const TEAM_PAGES = [
  ["/team", "overview"],
  ["/team/sites", "sites"],
  ["/team/workers", "workers"],
  ["/team/members", "members"],
  ["/team/activity", "activity"],
  ["/team/settings", "settings"],
] as const;
const ADMIN_PAGES = [
  "/admin",
  "/admin/sites",
  "/admin/workers",
  "/admin/activity",
  "/admin/settings",
];

/** The shell is the same everywhere: sidebar, breadcrumbs, one current item, no inline code. */
function expectShell(html: string, current: string) {
  expect(html).toContain('class="dash-side"');
  expect(html).toContain('class="crumbs"');
  expect(html).toContain('id="confirm-dialog"');
  expect(html.match(/aria-current="page"/g)?.length).toBe(1);
  expect(html).toMatch(new RegExp(`href="(/ar)?${current}" aria-current="page"`));
  expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
  expect(html).not.toContain(' style="');
}

describe("dashboards (0.13.0)", () => {
  it("serves every team page in both languages inside the app shell", async () => {
    const team = await setup();
    await t.publish(team.key, "<title>Agent page</title><h1>x</h1>");
    const { b } = await t.signIn(team.key);
    for (const [path] of TEAM_PAGES) {
      for (const p of [path, `/ar${path}`]) {
        const res = await b.get(p);
        expect(res.status, p).toBe(200);
        expectShell(await res.text(), path);
      }
    }
    const ov = await (await b.get("/team")).text();
    expect(ov).toContain('class="stat-card"');
    expect(ov).toContain("Recent activity");
    expect(ov).toContain("Agent page");
    expect(ov).toMatch(/<progress class="quota[^"]*" max="100" value="\d+"/);
    const ar = await (await b.get("/ar/team")).text();
    expect(ar).toContain("نظرة عامة");
    expect(ar).toContain("آخر النشاط");
    const sites = await (await b.get("/team/sites")).text();
    expect(sites).toContain('data-sort="num"');
    expect(sites).toContain("Agent page");
    expect(sites).toContain("data-copy-text=");
    expect(sites).toMatch(/<tr data-href="\/team\/sites\/[a-z0-9]+"/);
  });

  it("filters the team activity log and shows settings without the key", async () => {
    const team = await setup();
    await t.publish(team.key, "<title>Agent page</title><h1>x</h1>");
    const { b } = await t.signIn(team.key);
    const all = await (await b.get("/team/activity")).text();
    expect(all).toContain("Agent page");
    const none = await (await b.get("/team/activity?kind=mcp")).text();
    expect(none).not.toContain("Agent page");
    const q = await (await b.get("/team/activity?q=zzzz-nothing")).text();
    expect(q).not.toContain("Agent page");
    const bad = await b.get("/team/activity?kind=<script>");
    expect(bad.status).toBe(200);
    expect(await bad.text()).not.toContain("<script>");
    const settings = await (await b.get("/team/settings")).text();
    expect(settings).not.toContain(team.key);
    expect(settings).toContain(team.key.slice(0, 14));
    expect(settings).toContain("crew");
    // Key sessions have no password; the members page says so.
    expect(await (await b.get("/team/members")).text()).toContain(
      "You signed in with the team key",
    );
  });

  it("keeps viewers read-only and moves account forms to settings", async () => {
    const team = await setup();
    const viewer = await joinAs(team.team.id, "viewer", "vic");
    const sites = await (await viewer.get("/team/sites")).text();
    expect(sites).not.toContain("data-upload");
    const wk = await (await viewer.get("/team/workers")).text();
    expect(wk).not.toContain('action="/team/workers/deploy"');
    const ov = await (await viewer.get("/team")).text();
    expect(ov).not.toContain('href="#publish"');
    const st = await (await viewer.get("/team/settings")).text();
    expect(st).toContain('action="/team/account/password"');
    const csrf = await viewer.csrf("/team/settings");
    const res = await viewer.post("/team/account/password", {
      _csrf: csrf,
      current: "nope",
      password: "x",
      confirm: "x",
    });
    expect(res.headers.get("location")).toMatch(/^\/team\/settings\?f=/);
  });

  it("offers a redeploy shortcut that prefills the deploy form", async () => {
    const team = await setup();
    const d = await t.api(
      "PUT",
      "/api/teams/crew/workers/hello",
      { code: HELLO },
      { "x-team-key": team.key },
    );
    expect(d.status).toBe(201);
    const { b } = await t.signIn(team.key);
    const page = await (await b.get("/team/workers")).text();
    expect(page).toContain('data-href="/team/workers/hello"');
    expect(page).toContain("/team/workers?redeploy=hello#deploy");
    expect(page).toContain("/api/teams/crew/workers/hello");
    const re = await (await b.get("/team/workers?redeploy=hello")).text();
    expect(re).toContain('value="hello"');
    const odd = await (await b.get('/team/workers?redeploy="><b>x')).text();
    expect(odd).not.toContain("<b>x");
  });

  it("serves every admin page with overview stats, activity filters and settings", async () => {
    const team = await setup();
    await t.publish(team.key);
    const b = await t.adminBrowser();
    for (const path of ADMIN_PAGES) {
      for (const p of [path, `/ar${path}`]) {
        const res = await b.get(p);
        expect(res.status, p).toBe(200);
        expect(res.headers.get("content-security-policy")).toContain(
          "https://static.cloudflareinsights.com",
        );
        const html = await res.text();
        expectShell(html, path);
        expect(html).not.toContain(CF_TOKEN);
      }
    }
    const ov = await (await b.get("/admin")).text();
    expect(ov).toContain('class="stat-card"');
    expect(ov).toContain('class="kebab"');
    expect(ov).toContain(`data-href="/admin/teams/${team.team.id}"`);
    const ts = await (await b.get(`/admin/teams/${team.team.id}?tab=settings`)).text();
    expect(ts).toContain("The old key stops working immediately");
    const st = await (await b.get("/admin/settings")).text();
    expect(st).toContain(`…${CF_TOKEN.slice(-4)}`);
    expect(st).toContain('action="/admin/workers/settings"');
    // Platform entries (the Cloudflare settings) and team entries are merged.
    const act = await (await b.get("/admin/activity")).text();
    expect(act).toContain("Crew");
    const plat = await (await b.get("/admin/activity?team=platform")).text();
    expect(plat).not.toContain(`href="/admin/teams/${team.team.id}"`);
    const one = await (await b.get(`/admin/activity?team=${team.team.id}`)).text();
    expect(one).toContain(`href="/admin/teams/${team.team.id}"`);
    expect(one).toContain(`data-href="/admin/teams/${team.team.id}?tab=activity"`);
    expect((await b.get("/admin/activity?team=nope&kind=x")).status).toBe(200);
    // Verifying from settings returns to settings.
    const csrf = await b.csrf("/admin/settings");
    const v = await b.post("/admin/workers/settings/verify", { _csrf: csrf });
    expect(v.headers.get("location")).toMatch(/^\/admin\/settings\?f=/);
  });

  it("toggles a team's Workers from the overview without touching its quotas", async () => {
    const team = await setup();
    await t.admin("PUT", `/teams/${team.team.id}/workers`, { maxWorkers: 7, maxWorkerKb: 64 });
    const b = await t.adminBrowser();
    const csrf = await b.csrf("/admin");
    const off = await b.post(`/admin/workers/teams/${team.team.id}`, {
      _csrf: csrf,
      back: "admin",
    });
    expect(off.status).toBe(303);
    expect(off.headers.get("location")).toMatch(/^\/admin\?f=/);
    const raw = JSON.parse(await readFile(join(t.dir, "teams.json"), "utf8"));
    const rec = JSON.stringify(raw);
    expect(rec).toContain('"maxWorkers":7');
    expect(rec).toContain('"maxWorkerKb":64');
    const on = await b.post(`/admin/workers/teams/${team.team.id}`, {
      _csrf: csrf,
      back: "admin",
      enabled: "1",
    });
    expect(on.headers.get("location")).toMatch(/^\/admin\?f=/);
    const page = await (await b.get("/admin")).text();
    expect(page).toMatch(/<span class="badge on">On<\/span> <span class="meta">0<\/span>/);
    const detail = await (await b.get(`/admin/teams/${team.team.id}?tab=settings`)).text();
    expect(detail).toContain('name="enabled" value="1" checked');
    expect(detail).toContain('name="maxWorkers" type="number" min="0" max="100" placeholder');
  });
});
