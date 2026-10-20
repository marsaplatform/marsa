import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BASE, Browser, HOUR, makeApp } from "./helpers.js";

type App = Awaited<ReturnType<typeof makeApp>>;
let t: App;
afterEach(async () => {
  await t?.cleanup();
});

const PW = "correct horse battery";

async function adminInvite(app: App, teamId: string, role = "owner", ttlHours?: number) {
  const res = await app.admin("POST", `/teams/${teamId}/invites`, {
    role,
    ...(ttlHours ? { ttlHours } : {}),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { url: string }).url.replace(BASE, "");
}

async function joinWith(app: App, path: string, username: string, name = username, pw = PW) {
  const b = new Browser(app.app);
  const csrf = await b.csrf(path);
  const res = await b.post(path, { _csrf: csrf, username, name, password: pw, confirm: pw });
  return { b, res };
}

async function memberSignIn(app: App, username: string, pw = PW) {
  const b = new Browser(app.app);
  const csrf = await b.csrf("/login");
  const res = await b.post("/login", { _csrf: csrf, username, password: pw });
  return { b, res };
}

const flashPage = async (b: Browser, res: Response) => {
  const loc = new URL(res.headers.get("location") ?? "/", BASE);
  return (await b.get(loc.pathname + loc.search)).text();
};

describe("team members", () => {
  it("joins with a single-use invite and signs in with a password", async () => {
    t = await makeApp();
    const { team } = await t.createTeam("Crew");
    const path = await adminInvite(t, team.id);
    const page = await (await t.app.request(path)).text();
    expect(page).toContain("Join Crew");
    const { b, res } = await joinWith(t, path, "Sara.K", "Sara Khaled");
    expect(res.status).toBe(303);
    const dash = await flashPage(b, res);
    expect(dash).toContain("Signed in as Sara Khaled · Owner");
    expect(dash).toContain("Welcome!");
    // Single use.
    expect((await t.app.request(path)).status).toBe(404);
    const late = await b.post(path, {
      _csrf: "x",
      username: "other",
      name: "O",
      password: PW,
      confirm: PW,
    });
    expect(late.status).toBe(404);

    expect((await memberSignIn(t, "sara.k")).res.headers.get("location")).toBe("/team");
    expect((await memberSignIn(t, "sara.k", "wrong password!!")).res.status).toBe(401);
    expect((await memberSignIn(t, "nobody")).res.status).toBe(401);

    const raw = await readFile(join(t.dir, "members.json"), "utf8");
    expect(raw).toMatch(/"passwordHash": "scrypt\$32768\$8\$1\$/);
    expect(raw).not.toContain(PW);
    expect(raw).not.toContain(path.split("/").pop() ?? "x");
  });

  it("validates usernames, passwords and expiry", async () => {
    t = await makeApp();
    const { team } = await t.createTeam("Crew");
    const path = await adminInvite(t, team.id, "editor", 24);
    expect((await joinWith(t, path, "ab")).res.status).toBe(400);
    expect((await joinWith(t, path, "sara", "Sara", "short")).res.status).toBe(400);
    expect((await joinWith(t, path, "sara", "Sara", "sara-is-my-password")).res.status).toBe(400);
    const b = new Browser(t.app);
    const csrf = await b.csrf(path);
    const mism = await b.post(path, {
      _csrf: csrf,
      username: "sara",
      name: "S",
      password: PW,
      confirm: `${PW}x`,
    });
    expect(mism.status).toBe(400);
    await joinWith(t, path, "sara");
    const second = await adminInvite(t, team.id, "viewer");
    expect((await joinWith(t, second, "SARA")).res.status).toBe(409);
    const late = await adminInvite(t, team.id, "viewer", 1);
    t.clock.now += 2 * HOUR;
    expect((await t.app.request(late)).status).toBe(404);
    expect((await t.admin("POST", `/teams/${team.id}/invites`, { role: "boss" })).status).toBe(400);
  });

  it("enforces owner, editor and viewer roles", async () => {
    t = await makeApp();
    const { team, key } = await t.createTeam("Crew");
    const site = (await (await t.publish(key)).json()) as { id: string };
    const viewer = (await joinWith(t, await adminInvite(t, team.id, "viewer"), "vera")).b;
    const editor = (await joinWith(t, await adminInvite(t, team.id, "editor"), "eddy")).b;

    // Viewer: read-only.
    const vdash = await (await viewer.get("/team")).text();
    expect(vdash).toContain("Signed in as vera · Viewer");
    expect(vdash).not.toContain('action="/team/sites"');
    const vsite = await (await viewer.get(`/team/sites/${site.id}`)).text();
    expect(vsite).not.toContain(`/team/sites/${site.id}/delete`);
    const csrf = await viewer.csrf("/team");
    const del = await viewer.post(`/team/sites/${site.id}/delete`, { _csrf: csrf });
    expect(await flashPage(viewer, del)).toContain("Your role doesn&#39;t allow that.");
    expect(await t.store.get(site.id)).not.toBeNull();

    // Editor: manages sites, but not members.
    const ecsrf = await editor.csrf(`/team/sites/${site.id}`);
    await editor.post(`/team/sites/${site.id}/listing`, { _csrf: ecsrf, listed: "0" });
    expect((await t.store.get(site.id))?.unlisted).toBe(true);
    const inv = await editor.post("/team/members/invite", { _csrf: ecsrf, role: "owner" });
    expect(await flashPage(editor, inv)).toContain("Your role doesn&#39;t allow that.");

    // Owner (team key fallback): invites, changes roles, removes.
    const { b: owner } = await t.signIn(key);
    const ocsrf = await owner.csrf("/team/members");
    const made = await owner.post("/team/members/invite", {
      _csrf: ocsrf,
      role: "viewer",
      ttlHours: "24",
    });
    expect(await flashPage(owner, made)).toMatch(/\/join\/marsa_inv_/);
    const members = await (await owner.get("/team/members")).text();
    expect(members).toContain("vera");
    const all = (await (await t.admin("GET", `/teams/${team.id}/members`)).json()) as {
      members: { id: string; username: string }[];
      invites: unknown[];
    };
    expect(all.invites).toHaveLength(1);
    const veraId = all.members.find((m) => m.username === "vera")?.id ?? "";
    await owner.post(`/team/members/${veraId}/role`, { _csrf: ocsrf, role: "editor" });
    expect((await viewer.get("/team")).status).toBe(200);
    expect(await (await viewer.get("/team")).text()).toContain("vera · Editor");
    await owner.post(`/team/members/${veraId}/delete`, { _csrf: ocsrf });
    // Removed: the session ends at once.
    expect((await viewer.get("/team")).headers.get("location")).toMatch(/\/login/);
  });

  it("keeps the team key working for the API and browser, and records an audit log", async () => {
    t = await makeApp();
    const { team, key } = await t.createTeam("Crew");
    const { b: owner } = await joinWith(t, await adminInvite(t, team.id, "owner"), "olga", "Olga");
    // X-Team-Key API keeps working.
    const r = await t.publish(key, "<title>Agent page</title>");
    expect(r.status).toBe(201);
    const site = (await r.json()) as { id: string; editToken: string };
    await t.api(
      "PATCH",
      `/api/sites/${site.id}`,
      { ttlHours: 48 },
      { authorization: `Bearer ${site.editToken}` },
    );
    // A member's dashboard action.
    const csrf = await owner.csrf(`/team/sites/${site.id}`);
    await owner.post(`/team/sites/${site.id}/listing`, { _csrf: csrf, listed: "0" });
    const page = await (await owner.get(`/team/sites/${site.id}`)).text();
    expect(page).toContain("Activity on this site");
    expect(page).toMatch(/Olga[\s\S]*Hidden from the home page/);
    expect(page).toMatch(/team key[\s\S]*Published/);
    expect(page).toMatch(/edit token[\s\S]*Changed the expiry/);
    const mp = await (await owner.get("/team/members")).text();
    expect(mp).toContain("Joined the team");
    expect(mp).toContain("Agent page");
    // Team-key browser sign-in still works and acts as owner.
    const { b: keyB, res } = await t.signIn(key);
    expect(res.headers.get("location")).toBe("/team");
    expect(await (await keyB.get("/team/members")).text()).toContain(
      "You signed in with the team key",
    );
  });

  it("ends other sessions on password change and sign-out-everywhere", async () => {
    t = await makeApp();
    const { team } = await t.createTeam("Crew");
    await joinWith(t, await adminInvite(t, team.id, "editor"), "eddy");
    const a = (await memberSignIn(t, "eddy")).b;
    const b = (await memberSignIn(t, "eddy")).b;
    let csrf = await a.csrf("/team/members");
    const bad = await a.post("/team/account/password", {
      _csrf: csrf,
      current: "nope",
      password: "new password 123",
      confirm: "new password 123",
    });
    expect(await flashPage(a, bad)).toContain("The current password is wrong.");
    await a.post("/team/account/password", {
      _csrf: csrf,
      current: PW,
      password: "new password 123",
      confirm: "new password 123",
    });
    expect((await a.get("/team")).status).toBe(200);
    expect((await b.get("/team")).status).toBe(303);
    expect((await memberSignIn(t, "eddy")).res.status).toBe(401);
    const c = (await memberSignIn(t, "eddy", "new password 123")).b;
    csrf = await a.csrf("/team/members");
    await a.post("/team/account/signout-all", { _csrf: csrf });
    expect((await a.get("/team")).status).toBe(200);
    expect((await c.get("/team")).status).toBe(303);
  });

  it("lets the admin invite from the console and purges members with the team", async () => {
    t = await makeApp();
    const { team } = await t.createTeam("Crew");
    const admin = await t.adminBrowser();
    const csrf = await admin.csrf("/admin");
    const res = await admin.post(`/admin/teams/${team.id}/invite`, { _csrf: csrf, role: "owner" });
    const html = await flashPage(admin, res);
    const path = /https:\/\/spaces\.test(\/join\/marsa_inv_[A-Za-z0-9_-]+)/.exec(html)?.[1];
    expect(path).toBeTruthy();
    const { b } = await joinWith(t, path ?? "", "owner1");
    expect((await b.get("/team")).status).toBe(200);
    expect(await (await admin.get("/admin")).text()).toContain("1 member");
    await t.admin("DELETE", `/teams/${team.id}`);
    expect((await b.get("/team")).status).toBe(303);
    const raw = await readFile(join(t.dir, "members.json"), "utf8");
    expect(raw).not.toContain("owner1");
  });
});

describe("0.11.2 fixes", () => {
  it("shows the dashboard link in the header when signed in", async () => {
    t = await makeApp();
    const { key } = await t.createTeam("Crew");
    const out = await (await t.app.request("/")).text();
    expect(out).toContain(">Team sign-in</a>");
    expect(out).not.toContain(">Team dashboard</a>");
    const { b } = await t.signIn(key);
    const home = await (await b.get("/")).text();
    expect(home).toContain('href="/team">Team dashboard</a>');
    expect(home).not.toContain(">Team sign-in</a>");
    const ar = await (await b.get("/ar/docs")).text();
    expect(ar).toContain('href="/ar/team">لوحة الفريق</a>');
    const admin = await t.adminBrowser();
    expect(await (await admin.get("/new")).text()).toContain('href="/admin">Admin console</a>');
  });

  it("translates team key / edit token in the Arabic activity log", async () => {
    t = await makeApp();
    const { key } = await t.createTeam("Crew");
    const res = await t.publish(key);
    const { id, editToken } = (await res.json()) as { id: string; editToken: string };
    const patch = await t.app.request(`/api/sites/${id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${editToken}`, "content-type": "application/json" },
      body: JSON.stringify({ ttlHours: 48 }),
    });
    expect(patch.status).toBe(200);
    const { b } = await t.signIn(key);
    const ar = await (await b.get("/ar/team/members")).text();
    const log = ar.slice(ar.indexOf("audit-table"));
    expect(log).toContain("<bdi>مفتاح التعديل</bdi>");
    expect(log).toContain("<bdi>مفتاح الفريق</bdi>");
    expect(log).not.toMatch(/<bdi>(team key|edit token)<\/bdi>/);
    const en = await (await b.get("/team/members")).text();
    expect(en).toContain("<bdi>edit token</bdi>");
  });
});
