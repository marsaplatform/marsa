import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { SiteStore } from "../src/store.js";
import { TeamStore } from "../src/teams.js";
import { MemoryBackend } from "./fake-backend.js";

const ADMIN = "test-admin-token-0123456789abcdef";
const HOUR = 3600_000;
let dir: string;
let clock: number;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "marsa-teams-"));
  clock = Date.parse("2026-01-01T00:00:00Z");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

type TeamOut = {
  id: string;
  name: string;
  backend: boolean;
  directory: boolean;
  keyPrefix: string;
  liveSites?: number;
};

async function setup(env: Record<string, string> = {}, backend: MemoryBackend | null = null) {
  const config = loadConfig({
    DATA_DIR: dir,
    PUBLIC_URL: "http://marsa.test",
    ADMIN_TOKEN: ADMIN,
    ...env,
  });
  const store = new SiteStore(config.dataDir);
  await store.init();
  const app = createApp({ config, store, backend, now: () => clock });
  const admin = (method: string, path: string, body?: unknown, token = ADMIN) =>
    app.request(`/api/admin${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  const createTeam = async (name: string, backendOn: boolean, extra: object = {}) => {
    const res = await admin("POST", "/teams", { name, backend: backendOn, ...extra });
    expect(res.status).toBe(201);
    return (await res.json()) as { team: TeamOut; key: string };
  };
  const upload = async (headers: Record<string, string> = {}, title = "Hello", ttlHours = 2) => {
    const res = await app.request("/api/sites", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        ttlHours,
        files: [{ path: "index.html", content: `<title>${title}</title><h1>x</h1>` }],
      }),
    });
    return res;
  };
  const site = async (headers: Record<string, string> = {}, title?: string, ttl?: number) => {
    const res = await upload(headers, title, ttl);
    expect(res.status).toBe(201);
    return (await res.json()) as {
      id: string;
      editToken: string;
      url: string;
      team: { id: string } | null;
    };
  };
  const kv = (id: string, token: string) =>
    app.request(`/api/sites/${id}/kv/a`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ value: 1 }),
    });
  const code = async (res: Response) =>
    ((await res.json()) as { error: { code: string } }).error.code;
  return { app, admin, createTeam, upload, site, kv, code, store };
}

describe("admin teams API", () => {
  it("needs the admin token and is off without ADMIN_TOKEN", async () => {
    const { admin } = await setup();
    expect((await admin("GET", "/teams", undefined, "wrong-token-wrong-token-xx")).status).toBe(
      401,
    );
    const off = await setup({ ADMIN_TOKEN: "" });
    expect((await off.admin("GET", "/teams")).status).toBe(404);
  });

  it("creates, lists, updates, rotates and deletes teams; keys are shown once and stored hashed", async () => {
    const { admin, createTeam } = await setup();
    const { team, key } = await createTeam("Research desk", true);
    expect(key).toMatch(/^marsa_team_/);
    expect(team).toMatchObject({ name: "Research desk", backend: true, directory: true });
    expect(key.startsWith(team.keyPrefix)).toBe(true);

    const file = await readFile(join(dir, "teams.json"), "utf8");
    expect(file).not.toContain(key);
    expect(file).toContain("keyHash");

    const list = (await (await admin("GET", "/teams")).json()) as { teams: TeamOut[] };
    expect(list.teams).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain("keyHash");
    expect(JSON.stringify(list)).not.toContain(key);

    const upd = await admin("PATCH", `/teams/${team.id}`, { name: "Desk", backend: false });
    expect(((await upd.json()) as { team: TeamOut }).team).toMatchObject({
      name: "Desk",
      backend: false,
    });
    expect((await admin("PATCH", `/teams/${team.id}`, { backend: "yes" })).status).toBe(400);
    expect((await admin("PATCH", `/teams/${team.id}`, { name: "  " })).status).toBe(400);
    expect((await admin("POST", "/teams", { backend: true })).status).toBe(400);
    expect((await admin("PATCH", "/teams/t_nope", { backend: true })).status).toBe(404);

    const rot = (await (await admin("POST", `/teams/${team.id}/rotate`)).json()) as {
      key: string;
    };
    expect(rot.key).not.toBe(key);

    expect((await admin("DELETE", `/teams/${team.id}`)).status).toBe(200);
    expect((await admin("DELETE", `/teams/${team.id}`)).status).toBe(404);
  });

  it("persists teams across restarts", async () => {
    const { createTeam } = await setup();
    const { team, key } = await createTeam("Keepers", false);
    const reloaded = new TeamStore(dir);
    await reloaded.init();
    expect(reloaded.get(team.id)?.name).toBe("Keepers");
    expect(reloaded.byTeamKey(key)?.id).toBe(team.id);
  });
});

describe("team uploads and backend access", () => {
  it("guest uploads keep working; a bad team key is rejected", async () => {
    const { site, upload, code } = await setup();
    const guest = await site();
    expect(guest.team).toBeNull();
    const bad = await upload({ "x-team-key": "marsa_team_nope" });
    expect(bad.status).toBe(401);
    expect(await code(bad)).toBe("INVALID_TEAM_KEY");
    // A non-team bearer on upload is ignored, as before.
    expect((await upload({ authorization: "Bearer something-else" })).status).toBe(201);
  });

  it("allowed team -> 503 NOT_CONFIGURED, others -> 403, toggles apply at once", async () => {
    const { createTeam, site, kv, code, admin } = await setup();
    const on = await createTeam("With backend", true);
    const off = await createTeam("Without backend", false);
    const a = await site({ "x-team-key": on.key });
    const b = await site({ authorization: `Bearer ${off.key}` });
    const g = await site();
    expect(a.team?.id).toBe(on.team.id);
    expect(b.team?.id).toBe(off.team.id);

    let r = await kv(a.id, a.editToken);
    expect([r.status, await code(r)]).toEqual([503, "BACKEND_NOT_CONFIGURED"]);
    r = await kv(b.id, b.editToken);
    expect([r.status, await code(r)]).toEqual([403, "BACKEND_NOT_ALLOWED"]);
    r = await kv(g.id, g.editToken);
    expect([r.status, await code(r)]).toEqual([403, "BACKEND_NOT_ALLOWED"]);
    expect((await kv("nosuchsite1", "x")).status).toBe(404);

    await admin("PATCH", `/teams/${on.team.id}`, { backend: false });
    await admin("PATCH", `/teams/${off.team.id}`, { backend: true });
    expect((await kv(a.id, a.editToken)).status).toBe(403);
    expect((await kv(b.id, b.editToken)).status).toBe(503);
  });

  it("with a real backend, only allowed teams can write", async () => {
    const { createTeam, site, kv } = await setup({}, new MemoryBackend());
    const on = await createTeam("On", true);
    const a = await site({ "x-team-key": on.key });
    const g = await site();
    expect((await kv(a.id, a.editToken)).status).toBe(200);
    expect((await kv(g.id, g.editToken)).status).toBe(403);
  });

  it("BACKEND_GUEST_ACCESS=true restores the open policy", async () => {
    const { site, kv } = await setup({ BACKEND_GUEST_ACCESS: "true" }, new MemoryBackend());
    const g = await site();
    expect((await kv(g.id, g.editToken)).status).toBe(200);
  });

  it("a rotated key stops working; deleting a team removes backend access", async () => {
    const { createTeam, site, upload, kv, admin, store } = await setup();
    const t = await createTeam("Rotating", true);
    const s1 = await site({ "x-team-key": t.key });
    const { key: fresh } = (await (await admin("POST", `/teams/${t.team.id}/rotate`)).json()) as {
      key: string;
    };
    expect((await upload({ "x-team-key": t.key })).status).toBe(401);
    expect((await upload({ "x-team-key": fresh })).status).toBe(201);

    await admin("DELETE", `/teams/${t.team.id}`);
    expect((await kv(s1.id, s1.editToken)).status).toBe(403);
    expect(await store.get(s1.id)).not.toBeNull();

    const t2 = await createTeam("Wipe", true);
    const s2 = await site({ "x-team-key": t2.key });
    const del = await admin("DELETE", `/teams/${t2.team.id}?sites=delete`);
    expect(((await del.json()) as { removedSites: number }).removedSites).toBe(1);
    expect(await store.get(s2.id)).toBeNull();
  });
});

describe("public directory", () => {
  type Dir = {
    teams: { id: string; name: string; sites: { id: string; title: string; url: string }[] }[];
  };

  it("lists live team sites grouped by team, never guests or secrets", async () => {
    const { app, createTeam, site, admin } = await setup();
    const t = await createTeam("Field notes", false);
    const s = await site({ "x-team-key": t.key }, "Weekly &amp; report");
    const g = await site({}, "Guest page");

    const res = await app.request("/api/directory");
    expect(res.headers.get("cache-control")).toContain("max-age=30");
    const text = await res.text();
    const d = JSON.parse(text) as Dir;
    expect(d.teams).toHaveLength(1);
    expect(d.teams[0]).toMatchObject({ name: "Field notes" });
    expect(d.teams[0]?.sites[0]).toMatchObject({ id: s.id, title: "Weekly & report" });
    expect(text).not.toContain(g.id);
    expect(text).not.toContain(s.editToken);
    expect(text).not.toContain(t.key);
    expect(text).not.toContain("tokenHash");

    await admin("PATCH", `/teams/${t.team.id}`, { directory: false });
    expect(((await (await app.request("/api/directory")).json()) as Dir).teams).toHaveLength(0);
    await admin("PATCH", `/teams/${t.team.id}`, { directory: true });
    expect(((await (await app.request("/api/directory")).json()) as Dir).teams).toHaveLength(1);
    await admin("DELETE", `/teams/${t.team.id}`);
    expect(((await (await app.request("/api/directory")).json()) as Dir).teams).toHaveLength(0);
  });

  it("drops expired sites, even from the cache", async () => {
    const { app, createTeam, site } = await setup();
    const t = await createTeam("Short", false);
    await site({ "x-team-key": t.key }, "Soon gone", 1);
    expect(((await (await app.request("/api/directory")).json()) as Dir).teams).toHaveLength(1);
    clock += 2 * HOUR;
    expect(((await (await app.request("/api/directory")).json()) as Dir).teams).toHaveLength(0);
  });

  it("renders on the homepage in English and Arabic, with an empty state", async () => {
    const { app, createTeam, site } = await setup();
    const empty = await (await app.request("/")).text();
    expect(empty).toContain('id="directory"');
    expect(empty).toContain("No team pages are live right now");
    const emptyAr = await (await app.request("/ar")).text();
    expect(emptyAr).toContain('dir="rtl"');
    expect(emptyAr).toContain("لا توجد صفحات فرق منشورة الآن");

    const t = await createTeam("فريق التوثيق", false);
    const s = await site({ "x-team-key": t.key }, "<b>Map</b> & data");
    for (const path of ["/", "/ar"]) {
      const html = await (await app.request(path)).text();
      expect(html).toContain("فريق التوثيق");
      expect(html).toContain(`href="http://marsa.test/s/${s.id}/"`);
      expect(html).toContain("<time datetime=");
      expect(html).not.toContain(s.editToken);
      expect(html).not.toContain(t.key);
    }
    const ar = await (await app.request("/ar")).text();
    expect(ar).toContain("منشورات الفرق");
  });
});

describe("admin page", () => {
  it("redirects /admin and /ar/admin to the sign-in page, which has no secrets, noindex and a strict CSP", async () => {
    const { app } = await setup();
    for (const [path, lang] of [
      ["/admin", "en"],
      ["/ar/admin", "ar"],
    ] as const) {
      const res = await app.request(path);
      expect(res.status).toBe(303);
      const login = res.headers.get("location") ?? "";
      expect(login).toBe(lang === "ar" ? "/ar/admin/login" : "/admin/login");
      const page = await app.request(login);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-security-policy")).toContain("script-src 'self'");
      expect(page.headers.get("x-robots-tag")).toContain("noindex");
      const html = await page.text();
      expect(html).toContain(`lang="${lang}"`);
      expect(html).toContain('name="token"');
      expect(html).not.toContain(ADMIN);
    }
    expect((await app.request("/assets/admin.js")).status).toBe(404);
  });
});

describe("docs for teams", () => {
  it("documents teams in openapi.json, llms.txt and the guide", async () => {
    const { app } = await setup();
    const spec = (await (await app.request("/openapi.json")).json()) as {
      paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
    };
    expect(spec.paths["/api/directory"]).toBeDefined();
    expect(spec.paths["/api/admin/teams"]?.post).toBeDefined();
    expect(spec.paths["/api/admin/teams/{teamId}/rotate"]).toBeDefined();
    expect(spec.paths["/api/sites/{id}/kv/{key}"]?.put?.responses?.["403"]).toBeDefined();
    const llms = await (await app.request("/llms.txt")).text();
    expect(llms).toContain("X-Team-Key");
    expect(llms).toContain("BACKEND_NOT_ALLOWED");
    expect((await app.request("/docs/teams")).status).toBe(200);
  });
});
