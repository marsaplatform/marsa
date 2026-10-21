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
const SECRET = "sup3r-s3cret-value-0042";
const CODE = (n: number) =>
  `export default { async fetch(request, env) { const u = new URL(request.url); if (u.pathname === "/mcp") return new Response("mcp"); return new Response("v${n} " + env.WHO); } };`;
const PW = "correct horse battery";

async function setup() {
  const cf = new FakeCfWorkers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  t = await makeApp({ MARSA_SECRETS_KEY: KEY }, { cfFetch: cf.fetch });
  expect(
    (await t.admin("PUT", "/workers/settings", { token: CF_TOKEN, zone: ZONE_NAME })).status,
  ).toBe(200);
  const a = await t.createTeam("Team Marsa", { backend: true });
  const b = await t.createTeam("Sanad");
  for (const [team, slug] of [
    [a, "marsa"],
    [b, "sanad"],
  ] as const) {
    const r = await t.admin("PUT", `/teams/${team.team.id}/workers`, { enabled: true, slug });
    expect(r.status).toBe(200);
  }
  const deploy = (slug: string, key: string, name: string, body: unknown) =>
    t.api("PUT", `/api/teams/${slug}/workers/${name}`, body, { "x-team-key": key });
  expect(
    (
      await deploy("marsa", a.key, "api", {
        code: CODE(1),
        vars: { WHO: "marsa" },
        secrets: { TOKEN: SECRET },
      })
    ).status,
  ).toBe(201);
  expect(
    (await deploy("sanad", b.key, "news", { code: CODE(1), vars: { WHO: "sanad" } })).status,
  ).toBe(201);
  const siteA = (await (await t.publish(a.key, "<title>Atlas</title><h1>A</h1>")).json()) as {
    id: string;
    editToken: string;
  };
  const siteB = (await (await t.publish(b.key, "<title>Sanad page</title><h1>B</h1>")).json()) as {
    id: string;
  };
  return { cf, a, b, siteA, siteB };
}

async function member(teamId: string, role: string, username: string) {
  const inv = await t.admin("POST", `/teams/${teamId}/invites`, { role });
  const path = ((await inv.json()) as { url: string }).url.replace(BASE, "");
  const br = new Browser(t.app);
  const csrf = await br.csrf(path);
  await br.post(path, { _csrf: csrf, username, name: username, password: PW, confirm: PW });
  return br;
}

const WORKER_TABS = ["", "?tab=versions", "?tab=keys", "?tab=settings", "?tab=activity"];
const SITE_TABS = [
  "",
  "?tab=visits",
  "?tab=files",
  "?tab=data",
  "?tab=mcp",
  "?tab=activity",
  "?tab=settings",
];
const TEAM_TABS = [
  "",
  "?tab=members",
  "?tab=spaces",
  "?tab=workers",
  "?tab=agents",
  "?tab=settings",
  "?tab=activity",
];

describe("0.15.0 detail pages", () => {
  it("serves the Worker, space and admin team pages in both languages with tabs and breadcrumbs", async () => {
    const { a, b, siteA, siteB } = await setup();
    const { b: br } = await t.signIn(a.key);
    for (const p of ["", "/ar"]) {
      for (const tab of WORKER_TABS) {
        const res = await br.get(`${p}/team/workers/api${tab}`);
        expect(res.status, tab).toBe(200);
        const html = await res.text();
        expect(html).toContain('class="tabs"');
        expect(html).toContain('aria-current="page"');
        expect(html).toContain('class="crumbs"');
        expect(html).not.toContain(SECRET);
        expect(html).not.toContain(a.key);
        expect(html).not.toMatch(/ style=/);
      }
      for (const tab of SITE_TABS) {
        const res = await br.get(`${p}/team/sites/${siteA.id}${tab}`);
        expect(res.status, tab).toBe(200);
        const html = await res.text();
        expect(html).toContain('class="tabs"');
        expect(html).not.toContain(siteA.editToken);
      }
    }
    const ov = await (await br.get("/team/workers/api")).text();
    expect(ov).toContain("TOKEN");
    expect(ov).toContain("WHO");
    expect(ov).toContain(`https://marsa-api.${ZONE_NAME}/mcp`);
    expect(ov).toContain("data-copy-text=");
    const admin = await t.adminBrowser();
    for (const p of ["", "/ar"]) {
      for (const team of [a, b]) {
        for (const tab of TEAM_TABS) {
          const res = await admin.get(`${p}/admin/teams/${team.team.id}${tab}`);
          expect(res.status, tab).toBe(200);
          const html = await res.text();
          expect(html).not.toContain(team.key);
          expect(html).not.toContain(SECRET);
        }
      }
      for (const [team, name] of [
        [a, "api"],
        [b, "news"],
      ] as const)
        for (const tab of WORKER_TABS) {
          const res = await admin.get(`${p}/admin/teams/${team.team.id}/workers/${name}${tab}`);
          expect(res.status, `${name}${tab}`).toBe(200);
          expect(await res.text()).not.toContain(SECRET);
        }
      for (const site of [siteA, siteB])
        for (const tab of SITE_TABS) {
          const res = await admin.get(`${p}/admin/sites/${site.id}${tab}`);
          expect(res.status, tab).toBe(200);
        }
    }
    // Admin detail pages are read-only for code: no rollback or vars forms.
    const aw = await (await admin.get(`/admin/teams/${a.team.id}/workers/api?tab=settings`)).text();
    expect(aw).not.toContain('action="/team/workers/api/vars"');
    expect(aw).toContain(`/admin/workers/`);
    // Preview image is private.
    expect((await br.get(`/team/sites/${siteA.id}/preview`)).status).toBe(200);
    expect((await new Browser(t.app).get(`/team/sites/${siteA.id}/preview`)).status).toBe(404);
    expect((await admin.get(`/admin/sites/${siteB.id}/preview`)).status).toBe(200);
  });

  it("makes every list row open its detail page, with an actions menu", async () => {
    const { a, siteA } = await setup();
    const { b: br } = await t.signIn(a.key);
    const sites = await (await br.get("/team/sites")).text();
    expect(sites).toContain(`data-href="/team/sites/${siteA.id}"`);
    expect(sites).toContain('class="kebab"');
    expect(sites).toContain('role="menu"');
    const wk = await (await br.get("/ar/team/workers")).text();
    expect(wk).toContain('data-href="/ar/team/workers/api"');
    expect(wk).toMatch(/aria-label="[^"]+: api"/);
    const admin = await t.adminBrowser();
    const aw = await (await admin.get("/admin/workers")).text();
    expect(aw).toContain(`data-href="/admin/teams/${a.team.id}/workers/api"`);
    expect(aw).toContain('data-dt-f="team"');
    const as = await (await admin.get("/admin/sites")).text();
    expect(as).toContain(`data-href="/admin/sites/${siteA.id}"`);
    const ov = await (await admin.get("/admin")).text();
    expect(ov).toContain(`data-href="/admin/teams/${a.team.id}"`);
    // Old URLs open the new tabs.
    const old = await br.get("/team/workers/api/keys");
    expect(old.headers.get("location")).toBe("/team/workers/api?tab=keys");
    expect((await br.get(`/team/spaces/${siteA.id}`)).headers.get("location")).toBe(
      `/team/sites/${siteA.id}`,
    );
    expect((await admin.get(`/admin/spaces/${siteA.id}`)).headers.get("location")).toBe(
      `/admin/sites/${siteA.id}`,
    );
  });

  it("keeps teams out of each other's details and viewers away from danger actions", async () => {
    const { a, b, siteB } = await setup();
    const { b: br } = await t.signIn(a.key);
    expect((await br.get("/team/workers/news")).status).toBe(303);
    expect((await br.get(`/team/sites/${siteB.id}`)).status).toBe(303);
    expect((await br.get(`/team/sites/${siteB.id}/preview`)).status).toBe(404);
    const before = (await t.store.get(siteB.id))?.tokenHash;
    const csrf = await br.csrf("/team/workers");
    for (const path of [
      "/team/workers/news/disable",
      "/team/workers/news/vars",
      `/team/sites/${siteB.id}/token`,
    ]) {
      const r = await br.post(path, { _csrf: csrf, vars: "X=1" });
      expect(r.status, path).toBe(303);
    }
    expect((await t.store.get(siteB.id))?.tokenHash).toBe(before);
    // Not signed in: sent to the login page.
    expect((await new Browser(t.app).get("/team/workers/api")).headers.get("location")).toBe(
      "/login",
    );
    expect(
      (await new Browser(t.app).get(`/admin/teams/${a.team.id}`)).headers.get("location"),
    ).toMatch(/^\/admin\/login/);
    // A team cannot be reached through another team's admin path.
    const admin = await t.adminBrowser();
    expect((await admin.get(`/admin/teams/${a.team.id}/workers/news`)).status).toBe(303);
    // Viewer: sees the pages, no danger zone, no delete or revoke.
    const viewer = await member(a.team.id, "viewer", "vera");
    for (const path of [
      "/team/workers/api?tab=settings",
      "/team/workers/api",
      "/team/sites",
      "/team/workers",
    ]) {
      const html = await (await viewer.get(path)).text();
      expect(html, path).not.toContain('class="danger-zone"');
      expect(html, path).not.toContain("/delete");
      expect(html, path).not.toContain("/disable");
    }
    const vcsrf = await viewer.csrf("/team");
    const r = await viewer.post("/team/workers/api/disable", { _csrf: vcsrf });
    expect(r.status).toBe(303);
    const list = (await (await t.admin("GET", "/workers")).json()).workers as {
      name: string;
      status: string;
    }[];
    expect(list.find((w) => w.name === "api")?.status).toBe("active");
    void b;
  });

  it("edits vars and secrets as new versions, and respects an admin disable", async () => {
    const { a, cf } = await setup();
    const { b: br } = await t.signIn(a.key);
    const csrf = await br.csrf("/team/workers/api?tab=settings");
    const v = await br.post("/team/workers/api/vars", {
      _csrf: csrf,
      vars: "WHO=edited\nMODE=x",
      back: "/team/workers/api?tab=settings",
    });
    expect(v.headers.get("location")).toMatch(/^\/team\/workers\/api\?tab=settings&f=/);
    expect(cf.scripts.get("team-marsa-api")?.secrets.get("TOKEN")).toBe(SECRET);
    const s1 = await br.post("/team/workers/api/secrets", {
      _csrf: csrf,
      secrets: "NEW_ONE=abc123zz",
    });
    expect(s1.status).toBe(303);
    expect(cf.scripts.get("team-marsa-api")?.secrets.get("NEW_ONE")).toBe("abc123zz");
    await br.post("/team/workers/api/secrets", { _csrf: csrf, secrets: "TOKEN=" });
    expect(cf.scripts.get("team-marsa-api")?.secrets.has("TOKEN")).toBe(false);
    const vers = await (await br.get("/team/workers/api?tab=versions")).text();
    expect(vers).toContain("v4");
    expect(vers).not.toContain("abc123zz");
    const detail = await (await br.get("/team/workers/api")).text();
    expect(detail).toContain("MODE");
    expect(detail).not.toContain("abc123zz");
    // Team disable and enable.
    expect((await br.post("/team/workers/api/disable", { _csrf: csrf })).status).toBe(303);
    let w = (await (await t.admin("GET", "/workers")).json()).workers.find(
      (x: { name: string }) => x.name === "api",
    );
    expect(w.status).toBe("disabled");
    await br.post("/team/workers/api/enable", { _csrf: csrf });
    w = (await (await t.admin("GET", "/workers")).json()).workers.find(
      (x: { name: string }) => x.name === "api",
    );
    expect(w.status).toBe("active");
    // Admin disable: the team cannot turn it back on.
    await t.admin("POST", `/workers/${w.id}/disable`);
    const r = await br.post("/team/workers/api/enable", { _csrf: csrf });
    const flash = await (await br.get(r.headers.get("location") as string)).text();
    expect(flash).toContain("Only the admin can enable it");
    w = (await (await t.admin("GET", "/workers")).json()).workers.find(
      (x: { name: string }) => x.name === "api",
    );
    expect(w.status).toBe("disabled");
  });

  it("issues a new edit token once and ignores unsafe back targets", async () => {
    const { a, siteA } = await setup();
    const { b: br } = await t.signIn(a.key);
    const csrf = await br.csrf(`/team/sites/${siteA.id}?tab=settings`);
    const r = await br.post(`/team/sites/${siteA.id}/token`, {
      _csrf: csrf,
      back: "https://evil.example/x",
    });
    const loc = r.headers.get("location") as string;
    expect(loc).toMatch(new RegExp(`^/team/sites/${siteA.id}\\?tab=settings&f=`));
    const page = await (await br.get(loc)).text();
    const tok = /<code id="secretValue"[^>]*>([^<]+)<\/code>/.exec(page)?.[1];
    expect(tok).toBeTruthy();
    expect(await (await br.get(`/team/sites/${siteA.id}?tab=settings`)).text()).not.toContain(
      tok as string,
    );
    // The old token stops working, the new one works.
    const old = await t.api(
      "PATCH",
      `/api/sites/${siteA.id}`,
      { ttlHours: 2 },
      { authorization: `Bearer ${siteA.editToken}` },
    );
    expect(old.status).toBe(404);
    const neu = await t.api(
      "PATCH",
      `/api/sites/${siteA.id}`,
      { ttlHours: 2 },
      { authorization: `Bearer ${tok}` },
    );
    expect(neu.status).toBe(200);
    for (const bad of [
      "//evil.example",
      "/team/../admin",
      "/team/sites/x?tab=<b>",
      "javascript:alert(1)",
    ]) {
      const res = await br.post(`/team/sites/${siteA.id}/listing`, {
        _csrf: csrf,
        listed: "1",
        back: bad,
      });
      expect(res.headers.get("location"), bad).toMatch(new RegExp(`^/team/sites/${siteA.id}\\?f=`));
    }
    const ok = await br.post(`/team/sites/${siteA.id}/listing`, {
      _csrf: csrf,
      listed: "1",
      back: `/ar/team/sites/${siteA.id}?tab=data`,
    });
    expect(ok.headers.get("location")).toMatch(
      new RegExp(`^/ar/team/sites/${siteA.id}\\?tab=data&f=`),
    );
  });

  it("lets the admin manage members and agent keys from the team page", async () => {
    const { a } = await setup();
    await member(a.team.id, "editor", "eddy");
    const admin = await t.adminBrowser();
    const page = await (await admin.get(`/admin/teams/${a.team.id}?tab=members`)).text();
    const mid = new RegExp(`/admin/teams/${a.team.id}/members/([^/]+)/role`).exec(page)?.[1];
    expect(mid).toBeTruthy();
    const csrf = await admin.csrf(`/admin/teams/${a.team.id}`);
    const r = await admin.post(`/admin/teams/${a.team.id}/members/${mid}/role`, {
      _csrf: csrf,
      role: "viewer",
    });
    expect(r.headers.get("location")).toMatch(
      new RegExp(`^/admin/teams/${a.team.id}\\?tab=members&f=`),
    );
    expect(await (await admin.get(`/admin/teams/${a.team.id}?tab=members`)).text()).toContain(
      ">Viewer<",
    );
    // Wrong team in the path: refused.
    const other = await t.createTeam("Other");
    const x = await admin.post(`/admin/teams/${other.team.id}/members/${mid}/delete`, {
      _csrf: csrf,
    });
    expect(await (await admin.get(x.headers.get("location") as string)).text()).toContain(
      "flash err",
    );
    await admin.post(`/admin/teams/${a.team.id}/members/${mid}/delete`, { _csrf: csrf });
    expect(await (await admin.get(`/admin/teams/${a.team.id}?tab=members`)).text()).not.toContain(
      "eddy",
    );
    // Agent key revoke.
    const { b: br } = await t.signIn(a.key);
    const tc = await br.csrf("/team/agents");
    await br.post("/team/agents", { _csrf: tc, name: "ci", scopes: "workers:read", expiry: "30" });
    const ak = await (await admin.get(`/admin/teams/${a.team.id}?tab=agents`)).text();
    const kid = new RegExp(`/admin/teams/${a.team.id}/agents/([^/]+)/revoke`).exec(ak)?.[1];
    expect(kid).toBeTruthy();
    await admin.post(`/admin/teams/${a.team.id}/agents/${kid}/revoke`, { _csrf: csrf });
    expect(await (await admin.get(`/admin/teams/${a.team.id}?tab=agents`)).text()).toContain(
      ">Revoked<",
    );
    // Feature checkboxes on the settings tab save every flag.
    await admin.post(`/admin/teams/${a.team.id}/update`, {
      _csrf: csrf,
      features: "1",
      name: "Team Marsa",
      directory: "1",
    });
    const tm = (await (await t.admin("GET", "/teams")).json()).teams.find(
      (x: { id: string }) => x.id === a.team.id,
    );
    expect(tm).toMatchObject({ backend: false, directory: true, permanent: false });
  });
});
