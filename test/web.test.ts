import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { SiteStore } from "../src/store.js";
import { MemoryBackend } from "./fake-backend.js";

const ADMIN = "test-admin-token-0123456789abcdef";
const BASE = "https://spaces.test";
const ORIGIN = { origin: BASE };
let dir: string;
let clock: number;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "marsa-web-"));
  clock = Date.parse("2026-01-01T00:00:00Z");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A tiny browser: keeps cookies, sends Origin on POSTs, never follows redirects. */
class Browser {
  jar = new Map<string, string>();
  constructor(
    private readonly app: { request: (p: string, i?: RequestInit) => Promise<Response> | Response },
  ) {}
  private cookie() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  private keep(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = (pair ?? "").indexOf("=");
      const k = (pair ?? "").slice(0, i);
      const v = (pair ?? "").slice(i + 1);
      if (/max-age=0/i.test(c) || v === "") this.jar.delete(k);
      else this.jar.set(k, v);
    }
    return res;
  }
  async get(path: string, headers: Record<string, string> = {}) {
    return this.keep(
      await this.app.request(path, { headers: { cookie: this.cookie(), ...headers } }),
    );
  }
  async post(
    path: string,
    body: Record<string, string> | FormData,
    headers: Record<string, string> = ORIGIN,
  ) {
    const init: RequestInit = { method: "POST", headers: { cookie: this.cookie(), ...headers } };
    if (body instanceof FormData) init.body = body;
    else {
      init.body = new URLSearchParams(body).toString();
      (init.headers as Record<string, string>)["content-type"] =
        "application/x-www-form-urlencoded";
    }
    return this.keep(await this.app.request(path, init));
  }
  /** The CSRF token embedded in a page. */
  async csrf(path: string) {
    const html = await (await this.get(path)).text();
    const m = /name="_csrf" value="([^"]+)"/.exec(html);
    if (!m?.[1]) throw new Error(`no csrf token on ${path}`);
    return m[1];
  }
}

async function setup(env: Record<string, string> = {}, backend: MemoryBackend | null = null) {
  const config = loadConfig({
    DATA_DIR: dir,
    PUBLIC_URL: BASE,
    ADMIN_TOKEN: ADMIN,
    SESSION_SECRET: "s".repeat(40),
    ...env,
  });
  const store = new SiteStore(config.dataDir);
  await store.init();
  const app = createApp({ config, store, backend, now: () => clock });
  const api = (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.request(path, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  const createTeam = async (name: string, backendOn = false) => {
    const res = await api(
      "POST",
      "/api/admin/teams",
      { name, backend: backendOn },
      { authorization: `Bearer ${ADMIN}` },
    );
    return (await res.json()) as { team: { id: string }; key: string };
  };
  const signIn = async (key: string, prefix = "") => {
    const b = new Browser(app);
    const csrf = await b.csrf(`${prefix}/login`);
    const res = await b.post(`${prefix}/login`, { _csrf: csrf, key });
    return { b, res };
  };
  const filesForm = (csrf: string, html: string, ttl = "24") => {
    const fd = new FormData();
    fd.append("_csrf", csrf);
    fd.append("ttlHours", ttl);
    fd.append("files", new File([html], "index.html", { type: "text/html" }));
    return fd;
  };
  return { app, api, createTeam, signIn, filesForm, store };
}

describe("team sign-in", () => {
  it("signs in with a team key and sets a hardened session cookie", async () => {
    const { createTeam, signIn } = await setup();
    const { key } = await createTeam("Team Marsa");
    const { b, res } = await signIn(key);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/team");
    const set = res.headers.getSetCookie().join("\n");
    expect(set).toMatch(/__Host-marsa_session=[^;]+;.*HttpOnly/i);
    expect(set).toMatch(/Secure/i);
    expect(set).toMatch(/SameSite=Lax/i);
    expect(set).toMatch(/Path=\//);
    expect(set).not.toContain(key);
    const dash = await b.get("/team");
    expect(dash.status).toBe(200);
    expect(dash.headers.get("cache-control")).toContain("no-store");
    const html = await dash.text();
    expect(html).toContain("Team Marsa");
    expect(html).not.toContain(key);
    // Signed in: /login goes straight to the dashboard.
    expect((await b.get("/login")).headers.get("location")).toBe("/team");
  });

  it("works in Arabic under /ar", async () => {
    const { createTeam, signIn } = await setup();
    const { key } = await createTeam("فريق مرسى");
    const { b, res } = await signIn(key, "/ar");
    expect(res.headers.get("location")).toBe("/ar/team");
    const html = await (await b.get("/ar/team")).text();
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain("لوحة الفريق");
    expect(html).toContain("<bdi>فريق مرسى</bdi>");
  });

  it("rejects a wrong key with 401 and no cookie", async () => {
    const { signIn } = await setup();
    const { res } = await signIn("marsa_team_nope");
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie().join()).not.toContain("marsa_session");
    expect(await res.text()).toContain("doesn&#39;t match any team");
  });

  it("requires the sign-in CSRF token and a same-origin POST", async () => {
    const { app, createTeam } = await setup();
    const { key } = await createTeam("T");
    const b = new Browser(app);
    const csrf = await b.csrf("/login");
    expect((await b.post("/login", { key })).status).toBe(403);
    expect((await b.post("/login", { _csrf: "x".repeat(43), key })).status).toBe(403);
    expect(
      (await b.post("/login", { _csrf: csrf, key }, { origin: "https://evil.test" })).status,
    ).toBe(403);
    // A token from another browser (other cookie) doesn't work either.
    const other = new Browser(app);
    expect((await other.post("/login", { _csrf: csrf, key })).status).toBe(403);
    expect((await b.post("/login", { _csrf: csrf, key })).status).toBe(303);
  });

  it("rate-limits sign-in attempts per IP", async () => {
    const { app } = await setup({ LOGIN_ATTEMPTS_PER_15_MIN: "3" });
    const b = new Browser(app);
    const csrf = await b.csrf("/login");
    for (let i = 0; i < 3; i++) {
      expect((await b.post("/login", { _csrf: csrf, key: "marsa_team_bad" })).status).toBe(401);
    }
    const res = await b.post("/login", { _csrf: csrf, key: "marsa_team_bad" });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    clock += 16 * 60_000;
    expect((await b.post("/login", { _csrf: csrf, key: "marsa_team_bad" })).status).toBe(401);
  });

  it("redirects to sign-in without a session, and rejects tampered cookies", async () => {
    const { app, createTeam, signIn } = await setup();
    const b = new Browser(app);
    expect((await b.get("/team")).headers.get("location")).toBe("/login");
    const { key } = await createTeam("T");
    const { b: ok } = await signIn(key);
    const cookie = ok.jar.get("__Host-marsa_session") ?? "";
    const [payload, sig] = cookie.split(".");
    const forged = JSON.parse(Buffer.from(payload ?? "", "base64url").toString());
    forged.teamId = "t_other";
    const evil = new Browser(app);
    evil.jar.set(
      "__Host-marsa_session",
      `${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${sig}`,
    );
    expect((await evil.get("/team")).status).toBe(303);
  });

  it("logs out (CSRF-checked) and the old cookie stops working", async () => {
    const { createTeam, signIn, app } = await setup();
    const { key } = await createTeam("T");
    const { b } = await signIn(key);
    const saved = b.jar.get("__Host-marsa_session") ?? "";
    const csrf = await b.csrf("/team");
    expect((await b.post("/logout", { _csrf: "nope" })).status).toBe(403);
    const res = await b.post("/logout", { _csrf: csrf });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login?out=1");
    expect((await b.get("/team")).status).toBe(303);
    // Replaying the signed-out cookie is refused.
    const replay = new Browser(app);
    replay.jar.set("__Host-marsa_session", saved);
    expect((await replay.get("/team")).status).toBe(303);
  });

  it("expires sessions after SESSION_TTL_HOURS", async () => {
    const { createTeam, signIn } = await setup({ SESSION_TTL_HOURS: "2" });
    const { key } = await createTeam("T");
    const { b } = await signIn(key);
    expect((await b.get("/team")).status).toBe(200);
    clock += 3 * 3600_000;
    expect((await b.get("/team")).headers.get("location")).toBe("/login?expired=1");
  });

  it("ends team sessions when the key is rotated or the team deleted", async () => {
    const { createTeam, signIn, api } = await setup();
    const { key, team } = await createTeam("T");
    const { b } = await signIn(key);
    await api("POST", `/api/admin/teams/${team.id}/rotate`, undefined, {
      authorization: `Bearer ${ADMIN}`,
    });
    expect((await b.get("/team")).status).toBe(303);
  });

  it("keeps the X-Team-Key API working for agents", async () => {
    const { createTeam, api } = await setup();
    const { key, team } = await createTeam("T");
    const res = await api(
      "POST",
      "/api/sites",
      { files: [{ path: "index.html", content: "<title>A</title>" }] },
      { "x-team-key": key },
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as { team: { id: string } }).team.id).toBe(team.id);
  });
});

describe("team dashboard", () => {
  it("publishes, replaces, extends, hides and deletes a site", async () => {
    const { createTeam, signIn, filesForm, store, app } = await setup({ MAX_TTL_HOURS: "168" });
    const { key } = await createTeam("Docs team");
    const { b } = await signIn(key);
    const csrf = await b.csrf("/team");

    // publish (plain form post, no JS)
    const pub = await b.post(
      "/team/sites",
      filesForm(csrf, "<title>Report</title><h1>v1</h1>", "6"),
    );
    expect(pub.status).toBe(303);
    const flashUrl = pub.headers.get("location") ?? "";
    expect(flashUrl).toMatch(/^\/team\?f=/);
    const dash = await (await b.get(flashUrl)).text();
    expect(dash).toContain("Published. Your link is live.");
    expect(dash).toContain("Report");
    // The flash is shown once.
    expect(await (await b.get(flashUrl)).text()).not.toContain("Published. Your link is live.");

    const [site] = (await store.list()).filter((m) => m.title === "Report");
    expect(site?.teamId).toBeTruthy();
    const id = site?.id ?? "";
    expect(Date.parse(site?.expiresAt ?? "") - clock).toBe(6 * 3600_000);
    expect((await app.request(`/s/${id}/`)).status).toBe(200);
    // On the public directory.
    expect(await (await app.request("/")).text()).toContain(`/s/${id}/`);

    // replace (the page script's JSON flavour with the CSRF header)
    const fd = filesForm("", "<title>Report v2</title><h1>v2</h1>");
    fd.delete("_csrf");
    const rep = await b.post(`/team/sites/${id}/replace`, fd, {
      ...ORIGIN,
      accept: "application/json",
      "x-csrf-token": csrf,
    });
    expect(rep.status).toBe(200);
    expect(((await rep.json()) as { redirect: string }).redirect).toContain(`/team/sites/${id}?f=`);
    expect(await (await app.request(`/s/${id}/`)).text()).toContain("v2");

    // extend, capped at createdAt + max
    clock += 3600_000;
    await b.post(`/team/sites/${id}/extend`, { _csrf: csrf, ttlHours: "168" });
    const extended = await store.get(id);
    expect(Date.parse(extended?.expiresAt ?? "")).toBe(
      Date.parse(site?.createdAt ?? "") + 168 * 3600_000,
    );

    // hide from the home page, then show again
    await b.post(`/team/sites/${id}/listing`, { _csrf: csrf, listed: "0" });
    expect((await store.get(id))?.unlisted).toBe(true);
    expect(await (await app.request("/")).text()).not.toContain(`/s/${id}/`);
    await b.post(`/team/sites/${id}/listing`, { _csrf: csrf, listed: "1" });
    expect(await (await app.request("/")).text()).toContain(`/s/${id}/`);

    // site page
    const page = await (await b.get(`/team/sites/${id}`)).text();
    expect(page).toContain("index.html");
    expect(page).toContain("Data and files are not available");

    // delete
    const del = await b.post(`/team/sites/${id}/delete`, { _csrf: csrf });
    expect(del.headers.get("location")).toMatch(/^\/team\?f=/);
    expect(await store.get(id)).toBeNull();
    expect((await app.request(`/s/${id}/`)).status).toBe(404);
  });

  it("rejects dashboard POSTs without the session CSRF token or from another origin", async () => {
    const { createTeam, signIn, filesForm, store } = await setup();
    const { key } = await createTeam("T");
    const { b } = await signIn(key);
    const csrf = await b.csrf("/team");
    expect((await b.post("/team/sites", filesForm("bad", "<h1>x</h1>"))).status).toBe(403);
    expect(
      (await b.post("/team/sites", filesForm(csrf, "<h1>x</h1>"), { origin: "null" })).status,
    ).toBe(403);
    expect(await store.list()).toHaveLength(0);
  });

  it("can't touch another team's or a guest's site", async () => {
    const { createTeam, signIn, api, store } = await setup();
    const a = await createTeam("A");
    const other = await createTeam("B");
    const res = await api(
      "POST",
      "/api/sites",
      { files: [{ path: "index.html", content: "<h1>b</h1>" }] },
      { "x-team-key": other.key },
    );
    const { id } = (await res.json()) as { id: string };
    const guest = await api("POST", "/api/sites", {
      files: [{ path: "index.html", content: "<h1>g</h1>" }],
    });
    const gid = ((await guest.json()) as { id: string }).id;
    const { b } = await signIn(a.key);
    const csrf = await b.csrf("/team");
    for (const target of [id, gid]) {
      const del = await b.post(`/team/sites/${target}/delete`, { _csrf: csrf });
      expect(del.status).toBe(303);
      expect(await store.get(target)).not.toBeNull();
      expect((await b.get(`/team/sites/${target}`)).status).toBe(303);
    }
    expect(await (await b.get("/team")).text()).not.toContain(id);
  });

  it("shows team sites published through the API (no edit token needed)", async () => {
    const { createTeam, signIn, api } = await setup();
    const { key } = await createTeam("Team Marsa");
    const res = await api(
      "POST",
      "/api/sites",
      { files: [{ path: "index.html", content: "<title>Atlas</title>" }] },
      { "x-team-key": key },
    );
    const { id } = (await res.json()) as { id: string };
    const { b } = await signIn(key);
    const html = await (await b.get("/team")).text();
    expect(html).toContain("Atlas");
    expect(html).toContain(`/team/sites/${id}`);
  });

  it("browses and deletes KV values and files for backend teams", async () => {
    const backend = new MemoryBackend();
    const { createTeam, signIn, api } = await setup({}, backend);
    const { key } = await createTeam("B", true);
    const res = await api(
      "POST",
      "/api/sites",
      { files: [{ path: "index.html", content: "<title>App</title>" }] },
      { "x-team-key": key },
    );
    const { id, editToken } = (await res.json()) as { id: string; editToken: string };
    await api(
      "PUT",
      `/api/sites/${id}/kv/status`,
      { value: { ok: "نعم" } },
      {
        authorization: `Bearer ${editToken}`,
      },
    );
    const up = await api("POST", `/api/sites/${id}/files?name=readme.txt`, undefined, {
      authorization: `Bearer ${editToken}`,
    });
    expect(up.status).toBe(400); // empty body; upload a real one through the fake directly
    const f = await backend.fileUpload(
      id,
      "readme.txt",
      new TextEncoder().encode("hi"),
      "text/plain",
    );

    const { b } = await signIn(key);
    const page = await (await b.get(`/team/sites/${id}`)).text();
    expect(page).toContain("status");
    expect(page).toContain("نعم");
    expect(page).toContain("readme.txt");
    const csrf = await b.csrf(`/team/sites/${id}`);
    await b.post(`/team/sites/${id}/kv/delete`, { _csrf: csrf, key: "status" });
    expect(await backend.kvGet(id, "status")).toBeUndefined();
    await b.post(`/team/sites/${id}/files/delete`, { _csrf: csrf, fileId: f.id });
    expect(await backend.filesList(id, 10)).toHaveLength(0);
  });
});

describe("single-site view layout", () => {
  it("shows long KV values as a one-line preview that expands, and lists keys beyond the preview", async () => {
    const backend = new MemoryBackend();
    const { createTeam, signIn, api } = await setup({}, backend);
    const { key } = await createTeam("B", true);
    const res = await api(
      "POST",
      "/api/sites",
      { files: [{ path: "index.html", content: "<title>Atlas</title>" }] },
      { "x-team-key": key },
    );
    const { id } = (await res.json()) as { id: string };
    const long = { title: "دليل الخدمات", body: "x".repeat(2000) };
    for (let i = 0; i < 25; i++) {
      await backend.kvSet(id, `record:${String(i).padStart(2, "0")}`, JSON.stringify(long));
    }
    const { b } = await signIn(key);
    for (const path of [`/team/sites/${id}`, `/ar/team/sites/${id}`]) {
      const html = await (await b.get(path)).text();
      // one row per shown key, value collapsed into <details>, pretty-printed when opened
      expect(html.match(/<details class="kv-value">/g)?.length).toBe(20);
      expect(html).toContain("&#34;title&#34;: &#34;دليل الخدمات&#34;");
      expect(html).toMatch(/<summary><code dir="ltr">[^<]{1,500}…<\/code><\/summary>/);
      // the 5 keys without a preview are still listed by name
      expect(html).toContain('<details class="more-keys">');
      expect(html).toContain("record:24");
      // shared components, no inline script, actions intact
      for (const cls of [
        "page-heading with-aside",
        "site-summary panel",
        "status-list compact",
        "file-list",
        "team-upload compact",
        'class="data stack kv-table"',
      ]) {
        expect(html, cls).toContain(cls);
      }
      expect(html).not.toMatch(/<script(?![^>]*src=)[^>]*>[^<]/);
      for (const a of ["/extend", "/listing", "/delete", "/replace", "/kv/delete"])
        expect(html).toContain(`/team/sites/${id}${a}`);
    }
  });
});

describe("admin console", () => {
  const adminIn = async (s: Awaited<ReturnType<typeof setup>>) => {
    const b = new Browser(s.app);
    const csrf = await b.csrf("/admin/login");
    const res = await b.post("/admin/login", { _csrf: csrf, token: ADMIN });
    return { b, res };
  };

  it("signs in with ADMIN_TOKEN, creates a team and shows its key once", async () => {
    const s = await setup();
    const { b, res } = await adminIn(s);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/admin");
    const csrf = await b.csrf("/admin");
    const created = await b.post("/admin/teams", {
      _csrf: csrf,
      name: "فريق التوثيق",
      backend: "1",
      directory: "1",
    });
    const to = created.headers.get("location") ?? "";
    const html = await (await b.get(to)).text();
    const key = /marsa_team_[A-Za-z0-9_-]+/.exec(html)?.[0] ?? "";
    expect(key.length).toBeGreaterThan(30);
    expect(await (await b.get(to)).text()).not.toContain(key);
    // The new key signs in as the team.
    expect((await s.signIn(key)).res.status).toBe(303);
  });

  it("toggles flags, rotates, lists and filters all sites, deletes", async () => {
    const s = await setup();
    const t = await s.createTeam("A");
    const r1 = await s.api(
      "POST",
      "/api/sites",
      { files: [{ path: "index.html", content: "<title>Team page</title>" }] },
      { "x-team-key": t.key },
    );
    const tid = ((await r1.json()) as { id: string }).id;
    const r2 = await s.api("POST", "/api/sites", {
      files: [{ path: "index.html", content: "<title>Guest page</title>" }],
    });
    const gid = ((await r2.json()) as { id: string }).id;
    const { b } = await adminIn(s);
    const csrf = await b.csrf("/admin");
    await b.post(`/admin/teams/${t.team.id}/update`, { _csrf: csrf, backend: "1" });
    const teams = (await (
      await s.api("GET", "/api/admin/teams", undefined, { authorization: `Bearer ${ADMIN}` })
    ).json()) as { teams: { backend: boolean }[] };
    expect(teams.teams[0]?.backend).toBe(true);

    const all = await (await b.get("/admin/sites")).text();
    expect(all).toContain("Team page");
    expect(all).toContain("Guest page");
    const guests = await (await b.get("/admin/sites?owner=guest")).text();
    expect(guests).toContain("Guest page");
    expect(guests).not.toContain("Team page");
    const mine = await (await b.get(`/ar/admin/sites?owner=${t.team.id}`)).text();
    expect(mine).toContain("Team page");
    expect(mine).not.toContain("Guest page");

    await b.post(`/admin/sites/${gid}/delete`, { _csrf: csrf, owner: "guest" });
    expect(await s.store.get(gid)).toBeNull();
    expect(await s.store.get(tid)).not.toBeNull();

    const rot = await b.post(`/admin/teams/${t.team.id}/rotate`, { _csrf: csrf });
    expect(await (await b.get(rot.headers.get("location") ?? "")).text()).toMatch(/marsa_team_/);
    expect((await s.signIn(t.key)).res.status).toBe(401);

    await b.post(`/admin/teams/${t.team.id}/delete`, { _csrf: csrf, sites: "delete" });
    expect(await s.store.get(tid)).toBeNull();
  });

  it("rejects a wrong token, team sessions and missing CSRF", async () => {
    const s = await setup();
    const b = new Browser(s.app);
    const csrf = await b.csrf("/admin/login");
    expect((await b.post("/admin/login", { _csrf: csrf, token: "x".repeat(32) })).status).toBe(401);
    const t = await s.createTeam("A");
    const { b: team } = await s.signIn(t.key);
    expect((await team.get("/admin")).status).toBe(303);
    const { b: admin } = await adminIn(s);
    expect((await admin.post("/admin/teams", { name: "x" })).status).toBe(403);
    // An admin session is not a team session.
    expect((await admin.get("/team")).status).toBe(303);
  });

  it("renders with the same shared components as the team dashboard", async () => {
    const s = await setup();
    const t = await s.createTeam("A");
    await s.api(
      "POST",
      "/api/sites",
      { files: [{ path: "index.html", content: "<title>Team page</title>" }] },
      { "x-team-key": t.key },
    );
    const { b } = await adminIn(s);
    for (const path of ["/admin", "/ar/admin", "/admin/sites", "/ar/admin/sites"]) {
      const html = await (await b.get(path)).text();
      for (const cls of [
        "page-heading with-aside",
        "status-list",
        'class="data stack"',
        "head-tools",
      ]) {
        expect(html, `${path} ${cls}`).toContain(cls);
      }
      expect(html).toMatch(/aria-current="page"/);
      expect(html).toContain('action="' + (path.startsWith("/ar") ? "/ar" : "") + '/logout"');
      // no admin-only widgets and no inline script
      expect(html).not.toMatch(/class="(switch|tabs|admin-bar|filter-bar)"/);
      expect(html).not.toMatch(/<script>(?!<\/script>)|<script(?![^>]*src=)[^>]*>[^<]/);
      expect(html).toMatch(/<td data-label="[^"]+"/);
    }
    // Each flag is a badge with the state plus one form that flips it.
    const html = await (await b.get("/admin")).text();
    expect(html).toMatch(/name="backend" value="1"/);
    expect(html).toMatch(/name="directory" value="0"/);
    expect(html).toContain('name="sites" value="delete"');
  });

  it("is disabled without ADMIN_TOKEN", async () => {
    const s = await setup({ ADMIN_TOKEN: "" });
    expect((await s.app.request("/admin/login")).status).toBe(404);
    expect((await s.app.request("/admin")).status).toBe(303);
  });
});

describe("design", () => {
  it("serves the self-hosted Zad font and a consistent header on every page", async () => {
    const { app } = await setup();
    const font = await app.request("/assets/fonts/zad/Zad-Regular.woff2");
    expect(font.status).toBe(200);
    expect(font.headers.get("content-type")).toBe("font/woff2");
    expect((await app.request("/assets/fonts/zad/OFL.txt")).status).toBe(200);
    expect((await app.request("/assets/fonts/zad/nope.woff2")).status).not.toBe(200);
    for (const path of [
      "/",
      "/ar",
      "/new",
      "/docs",
      "/login",
      "/ar/login",
      "/admin/login",
      "/nope",
    ]) {
      const res = await app.request(path);
      const html = await res.text();
      expect(html, path).toContain('class="site-header"');
      expect(html, path).toContain("https://marsaplatform.com");
      expect(html, path).toMatch(/href="(\/ar)?\/login"/);
      expect(html, path).not.toMatch(/<script>(?!<\/script>)|\sstyle="/);
      expect(res.headers.get("content-security-policy"), path).toContain("script-src 'self'");
    }
  });
});
