import { afterEach, describe, expect, it } from "vitest";
import { makeApp } from "./helpers.js";

type App = Awaited<ReturnType<typeof makeApp>>;
let t: App | null = null;
afterEach(async () => {
  await t?.cleanup();
  t = null;
});

const count = async (app: App, team: string) =>
  ((await (await app.admin("GET", `/activity?team=${team}&limit=5000`)).json()) as { count: number })
    .count;

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
    const j = (await r.json()) as { entries: { action: string; memberId?: string }[]; count: number };
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
    expect(JSON.parse(lines[0]).action).toBeTruthy();

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

    const cases: [string, () => Promise<Response>, string, number][] = [
      ["team-create", () => app.admin("POST", "/teams", { name: "Second" }), "platform", 201],
      ["team-update", () => app.admin("PATCH", `/teams/${id}`, { maxSites: 9 }), id, 200],
      ["invite-revoke", () => app.admin("DELETE", `/teams/${id}/invites/${invite.invite.id}`), id, 204],
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
