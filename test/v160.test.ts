import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AppDeps, createApp } from "../src/app.js";
import {
  BackupService,
  backupKey,
  DirBlobStore,
  packDir,
  restoreTo,
  retain,
  seal,
  unseal,
  verifyBlob,
} from "../src/backup.js";
import type { NotificationCenter } from "../src/notify.js";
import type { TeamLifecycle } from "../src/team-lifecycle.js";
import { CF_TOKEN, FakeCfWorkers, ZONE_NAME } from "./fake-cf-workers.js";
import { ADMIN, Browser, makeApp } from "./helpers.js";

type App = Awaited<ReturnType<typeof makeApp>>;
let t: App | null = null;
const scratch: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await t?.cleanup();
  t = null;
  for (const d of scratch.splice(0)) await rm(d, { recursive: true, force: true });
});
const tmp = async () => {
  const d = await mkdtemp(join(tmpdir(), "marsa-v160-"));
  scratch.push(d);
  return d;
};
const KEY = "k".repeat(48);
const DAY = 86_400_000;

/** Read a zip made by zipFiles (local headers, deflate). */
function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let o = 0;
  while (buf.readUInt32LE(o) === 0x04034b50) {
    const method = buf.readUInt16LE(o + 8);
    const size = buf.readUInt32LE(o + 18);
    const nameLen = buf.readUInt16LE(o + 26);
    const extra = buf.readUInt16LE(o + 28);
    const name = buf.subarray(o + 30, o + 30 + nameLen).toString("utf8");
    const data = buf.subarray(o + 30 + nameLen + extra, o + 30 + nameLen + extra + size);
    out.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    o += 30 + nameLen + extra + size;
  }
  return out;
}

describe("0.16.0 sessions survive restarts", () => {
  it("keeps a sign-out and sign-out-everywhere across app instances", async () => {
    t = await makeApp();
    const restart = () =>
      createApp({
        config: t?.config as App["config"],
        store: t?.store as App["store"],
        now: () => t?.clock.now ?? 0,
      });
    const a = await t.adminBrowser();
    const copy = new Browser(t.app);
    copy.jar = new Map(a.jar);
    // The session works on a fresh instance (same SESSION_SECRET).
    const app2 = restart();
    const b2 = new Browser(app2);
    b2.jar = new Map(a.jar);
    expect((await b2.get("/admin")).status).toBe(200);
    // Sign out, then "restart": the old cookie stays dead.
    const csrf = await a.csrf("/admin");
    await a.post("/logout", { _csrf: csrf });
    const app3 = restart();
    const b3 = new Browser(app3);
    b3.jar = new Map(copy.jar);
    expect((await b3.get("/admin")).status).toBe(303);
    const raw = await readFile(join(t.dir, "sessions.json"), "utf8");
    expect(raw).not.toContain(ADMIN);

    // Sign out everywhere: every admin session ends, on this instance and after a restart.
    t.clock.now += 1000;
    const x = await t.adminBrowser();
    const y = await t.adminBrowser();
    const yCopy = new Map(y.jar);
    const cx = await x.csrf("/admin/settings");
    expect(await (await x.get("/admin/settings")).text()).toContain("/admin/sessions/end-all");
    const r = await x.post("/admin/sessions/end-all", { _csrf: cx });
    expect(r.headers.get("location")).toContain("/admin/login");
    expect((await y.get("/admin")).status).toBe(303);
    const b4 = new Browser(restart());
    b4.jar = yCopy;
    expect((await b4.get("/admin")).status).toBe(303);
    t.clock.now += 1000;
    const z = await t.adminBrowser();
    expect((await z.get("/admin")).status).toBe(200);
  });

  it("lets a team owner sign the whole team out", async () => {
    t = await makeApp();
    const team = await t.createTeam("Crew");
    const { b } = await t.signIn(team.key);
    const { b: other } = await t.signIn(team.key);
    const csrf = await b.csrf("/team/settings");
    expect(await (await b.get("/team/settings")).text()).toContain(
      "/team/settings/signout-everyone",
    );
    await b.post("/team/settings/signout-everyone", { _csrf: csrf });
    expect((await other.get("/team")).status).toBe(303);
    t.clock.now += 1000;
    const { b: again } = await t.signIn(team.key);
    expect((await again.get("/team")).status).toBe(200);
  });
});

describe("0.16.0 team export, trash, restore and purge", () => {
  it("exports first, soft-deletes with a typed name, restores, and purges after 7 days", async () => {
    let svc: { lifecycle?: TeamLifecycle; notify: NotificationCenter } | null = null;
    t = await makeApp({}, { app: { expose: (s) => (svc = s) } as Partial<AppDeps> });
    const team = await t.createTeam("Crew", { backend: true });
    const pub = await t.publish(team.key, "<title>Crew page</title>");
    const site = (await pub.json()) as { id: string };
    const tk = { "x-team-key": team.key };
    const ak = await t.api(
      "POST",
      `/api/teams/${team.team.id}/agent-keys`,
      { name: "bot", scopes: ["spaces:read"], expiresInDays: 7 },
      tk,
    );
    expect(ak.status).toBe(201);
    const agentKey = (await ak.json()).secret as string;

    // Export: a zip with the team's data and no secrets.
    const ex = await t.admin("GET", `/teams/${team.team.id}/export`);
    expect(ex.status).toBe(200);
    expect(ex.headers.get("content-type")).toBe("application/zip");
    const files = unzip(Buffer.from(await ex.arrayBuffer()));
    for (const f of [
      "manifest.json",
      "members.json",
      "activity.json",
      "sites.json",
      "agent-keys.json",
    ])
      expect(files.has(f)).toBe(true);
    expect([...files.keys()].some((k) => k.startsWith(`sites/${site.id}/`))).toBe(true);
    const all = [...files.values()].map((b) => b.toString("utf8")).join("\n");
    for (const secret of [team.key, agentKey, "keyHash", "passwordHash", "tokenHash"])
      expect(all).not.toContain(secret);
    expect(all).not.toMatch(/"(hash|verifierHash|ipHashes|keyHash)":/);

    // Typed confirmation.
    expect((await t.admin("DELETE", `/teams/${team.team.id}`)).status).toBe(400);
    expect((await t.admin("DELETE", `/teams/${team.team.id}?confirm=Crow`)).status).toBe(400);
    const del = await t.admin("DELETE", `/teams/${team.team.id}?confirm=crew`);
    expect(del.status).toBe(200);
    const dj = await del.json();
    expect(dj.trash.purgeAfter).toBe(new Date(t.clock.now + 7 * DAY).toISOString());

    // While in the trash: keys stop working, the team is gone from lists, the export is kept.
    expect((await t.publish(team.key)).status).toBe(401);
    expect(
      (
        await t.api("GET", `/api/teams/${team.team.id}/sites`, undefined, {
          authorization: `Bearer ${agentKey}`,
        })
      ).status,
    ).toBe(401);
    const teams = await (await t.admin("GET", "/teams")).json();
    expect(JSON.stringify(teams)).not.toContain(team.team.id);
    const trash = await (await t.admin("GET", "/trash")).json();
    expect(trash.teams).toHaveLength(1);
    expect((await t.admin("GET", `/trash/${team.team.id}/export`)).status).toBe(200);
    expect(await t.store.get(site.id)).not.toBeNull();
    // The activity log has it (team + platform), and the admin bell too.
    const n = svc as unknown as { notify: NotificationCenter };
    await n.notify.flush();
    expect(n.notify.list(null).some((x) => x.kind === "team-delete")).toBe(true);

    // Restore: everything works again.
    expect((await t.admin("POST", `/trash/${team.team.id}/restore`)).status).toBe(200);
    expect((await t.publish(team.key)).status).toBe(201);
    const b = await t.adminBrowser();
    const actHtml = await (await b.get(`/admin/teams/${team.team.id}?tab=activity`)).text();
    expect(actHtml).toContain("Restored the team");
    expect(actHtml).toContain("Deleted the team (7-day grace period)");

    // Delete again with sites; after 7 days the sweep purges it.
    await t.admin("DELETE", `/teams/${team.team.id}?confirm=${team.team.id}&sites=delete`);
    const lc = (svc as unknown as { lifecycle: TeamLifecycle }).lifecycle;
    expect(await lc.purgeDue({ kind: "admin", label: "admin" })).toEqual([]);
    t.clock.now += 7 * DAY + 1000;
    expect(await lc.purgeDue({ kind: "admin", label: "admin" })).toEqual([team.team.id]);
    expect((await (await t.admin("GET", "/trash")).json()).teams).toHaveLength(0);
    expect(await t.store.get(site.id)).toBeNull();
    const left = await readdir(join(t.dir, "trash"));
    expect(left.every((f) => f.startsWith("purged-"))).toBe(true);
    // Purged exports are removed 30 days later.
    t.clock.now += 31 * DAY;
    await lc.purgeDue({ kind: "admin", label: "admin" });
    expect(await readdir(join(t.dir, "trash"))).toEqual([]);
  });

  it("turns the team's Workers off in the trash and back on when restored", async () => {
    const cf = new FakeCfWorkers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    t = await makeApp({ MARSA_SECRETS_KEY: KEY }, { cfFetch: cf.fetch });
    await t.admin("PUT", "/workers/settings", { token: CF_TOKEN, zone: ZONE_NAME });
    const team = await t.createTeam("Sanad");
    await t.admin("PUT", `/teams/${team.team.id}/workers`, { enabled: true, slug: "sanad" });
    const code = "export default { async fetch() { return new Response('ok'); } };";
    const dep = await t.api(
      "PUT",
      "/api/teams/sanad/workers/news",
      { code },
      { "x-team-key": team.key },
    );
    expect(dep.status).toBe(201);
    const routed = () => [...cf.routes.values()].some((r) => r.script === "team-sanad-news");
    expect(routed()).toBe(true);
    const del = await t.admin("DELETE", `/teams/${team.team.id}?confirm=Sanad`);
    expect((await del.json()).trash.workersTurnedOff).toBe(1);
    expect(routed()).toBe(false);
    expect(cf.scripts.has("team-sanad-news")).toBe(true);
    // The slug stays reserved while the team is in the trash.
    const other = await t.createTeam("Other");
    const taken = await t.admin("PUT", `/teams/${other.team.id}/workers`, {
      enabled: true,
      slug: "sanad",
    });
    expect(taken.status).toBe(400);
    expect(JSON.stringify(await taken.json())).toMatch(/taken|use/i);
    await t.admin("POST", `/trash/${team.team.id}/restore`);
    expect(routed()).toBe(true);
    // Purge now: Workers are removed for good.
    const p = await t.admin("DELETE", `/teams/${team.team.id}?confirm=Sanad&purge=now`);
    expect((await p.json()).removedWorkers).toBe(1);
    expect(cf.scripts.has("team-sanad-news")).toBe(false);
  });
});

describe("0.16.0 encrypted backups", () => {
  it("seals, verifies and restores a data folder into a scratch dir; a wrong key fails clearly", async () => {
    const src = await tmp();
    await mkdir(join(src, "sites", "abc", "files"), { recursive: true });
    await writeFile(join(src, "teams.json"), '{"teams":[]}');
    await writeFile(join(src, "sites", "abc", "files", "index.html"), "<h1>hi</h1>");
    await mkdir(join(src, "tmp"), { recursive: true });
    await writeFile(join(src, "tmp", "junk"), "skip me");
    await mkdir(join(src, "lost+found"), { recursive: true });
    await writeFile(join(src, "lost+found", "x"), "skip me too");
    const key = backupKey("x".repeat(40));
    const { archive, manifest } = await packDir(src, "test", Date.now());
    expect(manifest.files.map((f) => f.p)).toEqual(["sites/abc/files/index.html", "teams.json"]);
    const blob = seal(archive, key);
    expect(blob.includes(Buffer.from("<h1>hi</h1>"))).toBe(false);
    expect(verifyBlob(blob, key).files).toHaveLength(2);
    const dest = join(await tmp(), "restore");
    await mkdir(dest);
    await restoreTo(blob, key, dest);
    expect(await readFile(join(dest, "sites", "abc", "files", "index.html"), "utf8")).toBe(
      "<h1>hi</h1>",
    );
    expect(() => unseal(blob, backupKey("y".repeat(40)))).toThrow(/key/i);
    // Restore refuses a non-empty target.
    await expect(restoreTo(blob, key, dest)).rejects.toThrow(/empty/i);
    // Tampering is caught.
    const bad = Buffer.from(blob);
    bad[bad.length - 5] = (bad[bad.length - 5] ?? 0) ^ 1;
    expect(() => verifyBlob(bad, key)).toThrow();
  });

  it("keeps 14 daily + 8 weekly backups", () => {
    const start = Date.parse("2026-08-01T01:00:00Z");
    const keys = Array.from({ length: 90 }, (_, i) => ({ key: `k${i}`, at: start + i * DAY }));
    const keep = retain(keys, 14, 8);
    for (let i = 76; i < 90; i++) expect(keep.has(`k${i}`)).toBe(true);
    const oldest = Math.min(...[...keep].map((k) => Number(k.slice(1))));
    expect(oldest).toBeGreaterThanOrEqual(90 - 8 * 7);
    expect(keep.size).toBeLessThanOrEqual(14 + 8);
    expect(keep.has("k0")).toBe(false);
  });

  it("runs from the admin API into a store, prunes, and tests a restore", async () => {
    const dir = await tmp();
    vi.spyOn(console, "log").mockImplementation(() => {});
    t = await makeApp({ MARSA_SECRETS_KEY: KEY, BACKUP_DIR: dir });
    await t.createTeam("Crew");
    const st0 = (await (await t.admin("GET", "/backups")).json()).backups;
    expect(st0.enabled).toBe(true);
    expect(st0.offsite).toBe(false);
    const run = await t.admin("POST", "/backups/run");
    expect(run.status).toBe(200);
    const r = (await run.json()).run;
    expect(r.ok).toBe(true);
    expect(r.verified).toBe(true);
    const tr = await t.admin("POST", "/backups/test-restore");
    expect(tr.status).toBe(200);
    expect((await tr.json()).restoreTest.ok).toBe(true);
    // The scratch dir is gone, the live data untouched.
    expect(
      (await readdir(join(t.dir, "tmp")).catch(() => [])).filter((f) =>
        f.startsWith("restore-test"),
      ),
    ).toEqual([]);
    const st = (await (await t.admin("GET", "/backups")).json()).backups;
    expect(st.lastOk.key).toBe(r.key);
    expect(st.kept).toHaveLength(1);
    // The admin Settings page shows the panel.
    const b = await t.adminBrowser();
    const html = await (await b.get("/admin/settings")).text();
    expect(html).toContain('id="backups"');
    expect(html).toContain("backup-cli.js restore");
    // The backup file is encrypted: no team name in clear.
    const month = (await readdir(join(dir, "_marsa-backups")))[0] ?? "";
    const f = (await readdir(join(dir, "_marsa-backups", month)))[0] ?? "";
    expect(
      (await readFile(join(dir, "_marsa-backups", month, f))).includes(Buffer.from("Crew")),
    ).toBe(false);
  });

  it("is due daily at the configured hour and reports failures", async () => {
    const dir = await tmp();
    const data = await tmp();
    let now = Date.parse("2026-10-21T00:30:00Z");
    const fails: string[] = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const svc = new BackupService({
      dataDir: data,
      store: new DirBlobStore(dir),
      secret: KEY,
      app: "test",
      hourUtc: 1,
      keepDaily: 14,
      keepWeekly: 8,
      maxBytes: 10_000_000,
      now: () => now,
      onFail: (r) => fails.push(r.error ?? ""),
    });
    await writeFile(join(data, "a.json"), "{}");
    expect((await svc.maybeRun())?.ok).toBe(true); // never backed up: runs now
    now += 10 * 60_000;
    expect(await svc.maybeRun()).toBeNull(); // 00:40, next is 01:00
    now = Date.parse("2026-10-21T01:05:00Z");
    expect((await svc.maybeRun())?.ok).toBe(true);
    now += 3_600_000;
    expect(await svc.maybeRun()).toBeNull();
    const broken = new BackupService({
      dataDir: data,
      store: null,
      secret: KEY,
      app: "test",
      hourUtc: 1,
      keepDaily: 14,
      keepWeekly: 8,
      maxBytes: 10_000_000,
      now: () => now,
      onFail: (r) => fails.push(r.error ?? ""),
    });
    expect((await broken.status()).enabled).toBe(false);
    expect((await broken.run("manual")).ok).toBe(false);
    expect(fails).toHaveLength(1);
  });
});

describe("0.16.0 var values deprecation", () => {
  const CODE = "export default { async fetch(r, env) { return new Response(env.API_BASE); } };";
  async function setup(env: Record<string, string> = {}) {
    const cf = new FakeCfWorkers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    let notify: NotificationCenter | null = null;
    t = await makeApp(
      { MARSA_SECRETS_KEY: KEY, ...env },
      { cfFetch: cf.fetch, app: { expose: (s) => (notify = s.notify) } as Partial<AppDeps> },
    );
    await t.admin("PUT", "/workers/settings", { token: CF_TOKEN, zone: ZONE_NAME });
    const team = await t.createTeam("Sanad");
    await t.admin("PUT", `/teams/${team.team.id}/workers`, { enabled: true, slug: "sanad" });
    const tk = { "x-team-key": team.key };
    const dep = await t.api(
      "PUT",
      "/api/teams/sanad/workers/news",
      { code: CODE, vars: { API_BASE: "https://x.test" } },
      tk,
    );
    expect(dep.status).toBe(201);
    const agent = async (scopes: string[]) => {
      const r = await (t as App).api(
        "POST",
        "/api/teams/sanad/agent-keys",
        { name: scopes.join("-"), scopes, expiresInDays: 7 },
        tk,
      );
      return { authorization: `Bearer ${(await r.json()).secret as string}` };
    };
    return { team, tk, agent, notify: () => notify as unknown as NotificationCenter };
  }

  it("still returns values for 7 days, with Deprecation/Sunset headers and a field", async () => {
    const { tk, agent } = await setup();
    const r = await (t as App).api("GET", "/api/teams/sanad/workers", undefined, tk);
    expect(r.headers.get("deprecation")).toMatch(/^@\d+$/);
    expect(r.headers.get("sunset")).toBe("Wed, 28 Oct 2026 12:00:00 GMT");
    expect(r.headers.get("link")).toContain('rel="deprecation"');
    const j = await r.json();
    expect(j.workers[0].vars).toEqual({ API_BASE: "https://x.test" });
    expect(j.workers[0].varNames).toEqual(["API_BASE"]);
    expect(j.workers[0].varValuesDeprecated).toBe(true);
    expect(j.deprecations[0]).toMatchObject({ field: "vars", active: true });
    const one = await (
      await (t as App).api("GET", "/api/teams/sanad/workers/news?probe=0", undefined, tk)
    )?.json();
    expect(one.worker.vars.API_BASE).toBe("https://x.test");
    expect(one.deprecations).toHaveLength(1);
    const adm = await (t as App).admin("GET", "/workers");
    expect(adm.headers.get("sunset")).toBeTruthy();
    // includeValues=1 with workers:deploy: no deprecation.
    const inc = await (t as App).api(
      "GET",
      "/api/teams/sanad/workers?includeValues=1",
      undefined,
      await agent(["workers:read", "workers:deploy"]),
    );
    expect(inc.headers.get("deprecation")).toBeNull();
    expect((await inc.json()).deprecations).toBeUndefined();
  });

  it("returns names only after the sunset unless asked (with workers:deploy)", async () => {
    const { tk, agent } = await setup({ VAR_VALUES_SUNSET: "2025-01-01T00:00:00Z" });
    const j = await (
      await (t as App).api("GET", "/api/teams/sanad/workers", undefined, tk)
    )?.json();
    expect(j.workers[0].vars).toBeUndefined();
    expect(j.workers[0].varNames).toEqual(["API_BASE"]);
    expect(j.deprecations[0].active).toBe(false);
    expect(JSON.stringify(j)).not.toContain("https://x.test");
    const readOnly = await agent(["workers:read"]);
    const ro = await (
      await (t as App).api("GET", "/api/teams/sanad/workers?includeValues=1", undefined, readOnly)
    )?.json();
    expect(ro.workers[0].vars).toBeUndefined();
    const dep = await agent(["workers:read", "workers:deploy"]);
    const ok = await (
      await (t as App).api("GET", "/api/teams/sanad/workers?includeValues=1", undefined, dep)
    )?.json();
    expect(ok.workers[0].vars).toEqual({ API_BASE: "https://x.test" });
    const adm = await (await (t as App).admin("GET", "/workers"))?.json();
    expect(adm.workers[0].vars).toBeUndefined();
    expect(adm.workers[0].team.name).toBe("Sanad");
  });

  it("posts a bell notice once per team, without webhooks, and documents the change", async () => {
    const { team, notify } = await setup();
    const n = notify();
    expect(await n.announce([team.team.id, "_platform"], "api-deprecation", "2026-10-28")).toBe(2);
    expect(await n.announce([team.team.id, "_platform"], "api-deprecation", "2026-10-28")).toBe(0);
    expect(n.list(team.team.id).filter((x) => x.kind === "api-deprecation")).toHaveLength(1);
    const md = await (
      await (t as App).api("GET", "/api/recipes/mcp-server-on-worker?format=md")
    )?.text();
    expect(md).toContain("includeValues=1");
    const docs = await (await (t as App).api("GET", "/docs/workers"))?.text();
    expect(docs).toContain('id="var-values"');
  });
});
