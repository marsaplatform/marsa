import { afterEach, describe, expect, it } from "vitest";
import { PERMANENT_EXPIRES } from "../src/store.js";
import { sweepExpired } from "../src/sweep.js";
import { HOUR, makeApp } from "./helpers.js";

type App = Awaited<ReturnType<typeof makeApp>>;
let t: App;
afterEach(async () => {
  await t?.cleanup();
});
type Site = { id: string; editToken: string; expiresAt: string; permanent?: boolean };

describe("permanent sites", () => {
  it("defaults the permanent flag to the team's backend access, and the admin can toggle it", async () => {
    t = await makeApp();
    const a = await t.createTeam("Data team", { backend: true });
    const b = await t.createTeam("Static team");
    const c = await t.createTeam("Override", { backend: true, permanent: false });
    expect(a.team.permanent).toBe(true);
    expect(b.team.permanent).toBe(false);
    expect(c.team.permanent).toBe(false);
    const res = await t.admin("PATCH", `/teams/${b.team.id}`, { permanent: true });
    expect(((await res.json()) as { team: { permanent: boolean } }).team.permanent).toBe(true);
    expect((await t.admin("PATCH", `/teams/${b.team.id}`, { permanent: "yes" })).status).toBe(400);
  });

  it("publishes with no expiry for allowed teams only; guests keep the TTL", async () => {
    t = await makeApp();
    const ok = await t.createTeam("Data team", { backend: true });
    const no = await t.createTeam("Static team");
    const r = await t.publish(ok.key, undefined, "?ttlHours=permanent");
    expect(r.status).toBe(201);
    const s = (await r.json()) as Site;
    expect(s.permanent).toBe(true);
    expect(s.expiresAt).toBe(PERMANENT_EXPIRES);

    const viaBody = await t.api(
      "POST",
      "/api/sites",
      { permanent: true, files: [{ path: "index.html", content: "x" }] },
      { "x-team-key": ok.key },
    );
    expect(((await viaBody.json()) as Site).permanent).toBe(true);

    for (const key of [no.key, null]) {
      const bad = await t.publish(key, undefined, "?permanent=1");
      expect(bad.status).toBe(403);
      expect(((await bad.json()) as { error: { code: string } }).error.code).toBe(
        "PERMANENT_NOT_ALLOWED",
      );
    }
    // Guests: TTL is clamped as before.
    const g = (await (await t.publish(null, undefined, "?ttlHours=99999")).json()) as Site;
    expect(Date.parse(g.expiresAt) - t.clock.now).toBe(168 * HOUR);
  });

  it("is never swept and keeps serving years later", async () => {
    t = await makeApp();
    const team = await t.createTeam("Data team", { backend: true });
    const p = (await (
      await t.publish(team.key, "<title>Atlas</title>", "?ttlHours=permanent")
    ).json()) as Site;
    const g = (await (await t.publish(null)).json()) as Site;
    await t.backend.kvSet(p.id, "a", "1");
    t.clock.now += 5 * 365 * 24 * HOUR;
    const removed = await sweepExpired(t.store, t.backend, t.clock.now);
    expect(removed).toEqual([g.id]);
    expect(t.backend.purged).not.toContain(p.id);
    expect((await t.app.request(`/s/${p.id}/`)).status).toBe(200);
    const dir = (await (await t.app.request("/api/directory")).json()) as {
      teams: { sites: { id: string }[] }[];
    };
    expect(dir.teams[0]?.sites[0]?.id).toBe(p.id);
    const home = await (await t.app.request("/")).text();
    expect(home).toContain("badge on perm");
    expect(home).not.toContain("9999");
  });

  it("converts with the edit token both ways; the TTL ceiling restarts when it becomes timed again", async () => {
    t = await makeApp();
    const team = await t.createTeam("Data team", { backend: true });
    const s = (await (await t.publish(team.key)).json()) as Site;
    const auth = { authorization: `Bearer ${s.editToken}` };
    const on = (await (
      await t.api("PATCH", `/api/sites/${s.id}`, { permanent: true }, auth)
    ).json()) as Site;
    expect(on.permanent).toBe(true);
    t.clock.now += 30 * 24 * HOUR; // a month later
    const off = (await (
      await t.api("PATCH", `/api/sites/${s.id}`, { ttlHours: 168 }, auth)
    ).json()) as Site;
    expect(off.permanent).toBeUndefined();
    expect(Date.parse(off.expiresAt) - t.clock.now).toBe(168 * HOUR);

    const other = await t.createTeam("Static team");
    const s2 = (await (await t.publish(other.key)).json()) as Site;
    const denied = await t.api(
      "PATCH",
      `/api/sites/${s2.id}`,
      { permanent: true },
      { authorization: `Bearer ${s2.editToken}` },
    );
    expect(denied.status).toBe(403);
  });

  it("lets the admin make a team site permanent and revoke it", async () => {
    t = await makeApp();
    const team = await t.createTeam("Static team");
    const s = (await (await t.publish(team.key)).json()) as Site;
    const g = (await (await t.publish(null)).json()) as Site;
    let r = await t.admin("PATCH", `/sites/${s.id}`, { permanent: true });
    expect(((await r.json()) as Site).permanent).toBe(true);
    expect((await t.admin("PATCH", `/sites/${g.id}`, { permanent: true })).status).toBe(403);
    expect((await t.admin("PATCH", `/sites/${s.id}`, {})).status).toBe(400);
    r = await t.admin("PATCH", `/sites/${s.id}`, { permanent: false });
    const out = (await r.json()) as Site;
    expect(out.permanent).toBeUndefined();
    expect(Date.parse(out.expiresAt) - t.clock.now).toBe(168 * HOUR);

    // Admin console: filter + revoke button.
    await t.admin("PATCH", `/sites/${s.id}`, { permanent: true });
    const b = await t.adminBrowser();
    const html = await (await b.get("/admin/sites?owner=permanent")).text();
    expect(html).toContain(s.id);
    expect(html).not.toContain(g.id);
    const csrf = /name="_csrf" value="([^"]+)"/.exec(html)?.[1] ?? "";
    const res = await b.post(`/admin/sites/${s.id}/permanent`, { _csrf: csrf, permanent: "0" });
    expect(res.status).toBe(303);
    expect((await t.store.get(s.id))?.permanent).toBeUndefined();
  });

  it("dashboard: permanent option, make-permanent button, and the extend picker", async () => {
    t = await makeApp();
    const team = await t.createTeam("Data team", { backend: true });
    const { b } = await t.signIn(team.key);
    const dash = await (await b.get("/ar/team")).text();
    expect(dash).toContain('<option value="permanent">دائم (بلا انتهاء)</option>');
    const csrf = /name="_csrf" value="([^"]+)"/.exec(dash)?.[1] ?? "";
    const fd = new FormData();
    fd.append("_csrf", csrf);
    fd.append("ttlHours", "permanent");
    fd.append("files", new File(["<title>P</title>"], "index.html", { type: "text/html" }));
    expect((await b.post("/team/sites", fd)).status).toBe(303);
    const [m] = (await t.store.list()).filter((x) => x.teamId === team.team.id);
    expect(m?.permanent).toBe(true);
    const page = await (await b.get(`/team/sites/${m?.id}`)).text();
    expect(page).toContain("never expires");
    expect(page).not.toContain(`/team/sites/${m?.id}/permanent"`);
    // Back to timed, then the button appears.
    await b.post(`/team/sites/${m?.id}/extend`, { _csrf: csrf, ttlHours: "24" });
    const again = await (await b.get(`/team/sites/${m?.id}`)).text();
    expect(again).toContain(`/team/sites/${m?.id}/permanent"`);
    await b.post(`/team/sites/${m?.id}/permanent`, { _csrf: csrf });
    expect((await t.store.get(m?.id ?? ""))?.permanent).toBe(true);

    // A team without permission sees neither.
    const other = await t.createTeam("Static team");
    const o = await t.signIn(other.key);
    const odash = await (await o.b.get("/team")).text();
    expect(odash).not.toContain('value="permanent"');
  });
});

describe("team quotas", () => {
  it("caps live sites and bytes per team; admin can override; replace counts too", async () => {
    t = await makeApp({ TEAM_MAX_SITES: "2", TEAM_MAX_MB: "1" });
    const team = await t.createTeam("Small team");
    expect((await t.publish(team.key)).status).toBe(201);
    const s2 = (await (await t.publish(team.key)).json()) as Site;
    const third = await t.publish(team.key);
    expect(third.status).toBe(403);
    expect(((await third.json()) as { error: { code: string } }).error.code).toBe(
      "TEAM_QUOTA_EXCEEDED",
    );
    // Guests are not affected.
    expect((await t.publish(null)).status).toBe(201);

    const big = "x".repeat(700 * 1024);
    const rep = await t.api(
      "PUT",
      `/api/sites/${s2.id}`,
      {
        files: [
          { path: "index.html", content: big },
          { path: "b.html", content: big },
        ],
      },
      { authorization: `Bearer ${s2.editToken}` },
    );
    expect(rep.status).toBe(403);

    const r = await t.admin("PATCH", `/teams/${team.team.id}`, { maxSites: 5, maxMb: 10 });
    const out = (await r.json()) as { team: { quota: { sites: number; mb: number } } };
    expect(out.team.quota).toEqual({ sites: 5, mb: 10 });
    expect((await t.publish(team.key)).status).toBe(201);
    const reset = await t.admin("PATCH", `/teams/${team.team.id}`, { maxSites: null });
    expect(((await reset.json()) as typeof out).team.quota.sites).toBe(2);

    // Expired sites free the quota.
    t.clock.now += 200 * HOUR;
    expect((await t.publish(team.key)).status).toBe(201);
  });

  it("shows usage on the dashboard and quota fields in the admin console", async () => {
    t = await makeApp();
    const team = await t.createTeam("Team");
    await t.publish(team.key);
    const { b } = await t.signIn(team.key);
    expect(await (await b.get("/team")).text()).toContain("Quota: 1/50");
    const a = await t.adminBrowser();
    const html = await (await a.get("/admin")).text();
    expect(html).toContain('name="maxSites"');
    expect(html).toContain('placeholder="200"');
  });
});
