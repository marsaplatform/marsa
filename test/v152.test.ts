import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEvent } from "../src/worker-analytics.js";
import { buildEnvView, readRequiredEnv, scanEnvUsage } from "../src/worker-env.js";
import { CF_TOKEN, FakeCfWorkers, ZONE_NAME } from "./fake-cf-workers.js";
import { BASE, makeApp } from "./helpers.js";

type App = Awaited<ReturnType<typeof makeApp>>;
let t: App;
afterEach(async () => {
  vi.restoreAllMocks();
  await t?.cleanup();
});

const KEY = "k".repeat(48);
const SECRET_VALUE = `${"sk"}_live_THIS_IS_A_TEST_SECRET_VALUE_1234567890`;
// Built at runtime so secret scanners do not mistake the fixture for a real key.
const FAKE_LOG_KEY = ["sk", "live", "ABCDEFGHIJKLMNOPQRSTUVWX123456"].join("_");
const VAR_VALUE = "plain-var-value-should-not-render";
const CODE = `export default { async fetch(req, env) { return new Response(env.API_BASE + env.STRIPE_KEY + env.FROM_CODE_ONLY); } };`;
const MCP_CODE = `export default { async fetch(r, env) { if (new URL(r.url).pathname === "/mcp") return new Response("{}"); return new Response("ok"); } };`;

async function setup() {
  const cf = new FakeCfWorkers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  t = await makeApp({ MARSA_SECRETS_KEY: KEY }, { cfFetch: cf.fetch });
  expect(
    (await t.admin("PUT", "/workers/settings", { token: CF_TOKEN, zone: ZONE_NAME })).status,
  ).toBe(200);
  const team = await t.createTeam("Sanad");
  expect(
    (await t.admin("PUT", `/teams/${team.team.id}/workers`, { enabled: true, slug: "sanad" }))
      .status,
  ).toBe(200);
  const tk = { "x-team-key": team.key };
  const api = (m: string, p: string, body?: unknown, h: Record<string, string> = tk) =>
    t.api(m, `/api/teams/sanad/workers${p}`, body, h);
  const deploy = await api("PUT", "/news", {
    code: CODE,
    vars: { API_BASE: VAR_VALUE },
    secrets: { STRIPE_KEY: SECRET_VALUE },
    requiredEnv: ["API_BASE", "STRIPE_KEY", "OPENAI_KEY"],
  });
  expect(deploy.status).toBe(201);
  const agent = async (scopes: string[]) => {
    const r = await t.api(
      "POST",
      `/api/teams/sanad/agent-keys`,
      { name: `a-${scopes.join("-")}`, scopes, expiresInDays: 7 },
      tk,
    );
    expect(r.status).toBe(201);
    return { authorization: `Bearer ${(await r.json()).secret as string}` };
  };
  return { cf, team, tk, api, agent };
}

describe("0.15.2 env helpers", () => {
  it("validates requiredEnv and scans env usage", () => {
    expect(readRequiredEnv(["B", "A", "A"])).toEqual(["A", "B"]);
    expect(readRequiredEnv(null)).toBeNull();
    for (const bad of ["X", ["1A"], ["a-b"], Array.from({ length: 51 }, (_, i) => `V${i}`)])
      expect(() => readRequiredEnv(bad)).toThrow();
    expect(
      scanEnvUsage(
        `env.API_KEY; env?.TOKEN_X; env["DB_URL"]; const { ALPHA, BETA: b } = env; env.MARSA_KEYS_URL; env.lower`,
      ),
    ).toEqual(["ALPHA", "API_KEY", "BETA", "DB_URL", "TOKEN_X"]);
  });

  it("merges live bindings with the record and never carries values", () => {
    const v = buildEnvView(
      {
        vars: { A: "secret-ish", E: "" },
        secrets: ["S", "GONE"],
        bindings: [{ name: "NEWS" }],
        requiredEnv: ["S", "R"],
      },
      [
        { name: "A", type: "plain_text", empty: false },
        { name: "E", type: "plain_text", empty: true },
        { name: "S", type: "secret_text" },
        { name: "NEWS", type: "service" },
        { name: "MARSA_KEYS_URL", type: "secret_text" },
      ],
      "env.CODE_ONE",
    );
    expect(JSON.stringify(v)).not.toContain("secret-ish");
    const by = Object.fromEntries(v.entries.map((e) => [e.name, e]));
    expect(by.A).toMatchObject({ kind: "var", status: "set", source: "cloudflare" });
    expect(by.E?.status).toBe("empty");
    expect(by.S).toMatchObject({ kind: "secret", expected: "declared" });
    expect(by.GONE?.status).toBe("missing");
    expect(by.MARSA_KEYS_URL?.kind).toBe("system");
    expect(by.NEWS?.kind).toBe("binding");
    expect(v.missing).toEqual([{ name: "R", why: "declared" }]);
    expect(v.unset).toEqual(["CODE_ONE"]);
    expect(by.CODE_ONE).toMatchObject({ kind: "unset", status: "unset", expected: "code" });
  });
});

describe("0.15.2 variables & secrets", () => {
  it("lists names only, sets/rotates/deletes secrets write-only, logs them, and checks scopes", async () => {
    const { cf, api, agent, tk } = await setup();
    const env = await api("GET", "/news/env");
    expect(env.status).toBe(200);
    const body = await env.text();
    expect(body).not.toContain(SECRET_VALUE);
    expect(body).not.toContain(VAR_VALUE);
    const view = JSON.parse(body).env;
    expect(view.source).toBe("cloudflare");
    expect(view.missing.map((m: { name: string }) => m.name)).toEqual(["OPENAI_KEY"]);
    expect(view.unset).toEqual(["FROM_CODE_ONLY"]);
    // Set, rotate, delete.
    const put = (name: string, value: unknown, h: Record<string, string> = tk) =>
      api("PUT", `/news/secrets/${name}`, { value }, h);
    const r1 = await put("OPENAI_KEY", "v1-secret-value");
    expect(r1.status).toBe(200);
    const j1 = await r1.text();
    expect(j1).not.toContain("v1-secret-value");
    expect(JSON.parse(j1)).toMatchObject({ name: "OPENAI_KEY", rotated: false });
    expect((await (await put("OPENAI_KEY", "v2-secret-value")).json()).rotated).toBe(true);
    expect(cf.scripts.get("team-sanad-news")?.secrets.get("OPENAI_KEY")).toBe("v2-secret-value");
    const after = await (await api("GET", "/news/env")).json();
    expect(after.env.missing).toEqual([]);
    expect(after.env.unset).toEqual(["FROM_CODE_ONLY"]);
    expect(after.env.entries.find((e: { name: string }) => e.name === "OPENAI_KEY")).toMatchObject({
      kind: "secret",
      status: "set",
      updatedBy: "team key",
    });
    // Rules.
    expect((await put("MARSA_KEYS_URL", "x")).status).toBe(400);
    expect((await put("API_BASE", "x")).status).toBe(409);
    expect((await put("bad-name", "x")).status).toBe(400);
    expect((await put("BIG", "x".repeat(6000))).status).toBe(413);
    expect((await put("EMPTY", "")).status).toBe(400);
    // Scopes: read-only agent cannot; a secrets-only agent can.
    const reader = await agent(["workers:read"]);
    expect((await put("X1", "v", reader)).status).toBe(403);
    expect((await api("GET", "/news/env", undefined, reader)).status).toBe(200);
    const secrets = await agent(["workers:secrets"]);
    expect((await put("X1", "v", secrets)).status).toBe(200);
    expect((await api("DELETE", "/news/secrets/X1", undefined, secrets)).status).toBe(200);
    expect(cf.scripts.get("team-sanad-news")?.secrets.has("X1")).toBe(false);
    expect((await api("DELETE", "/news/secrets/NOPE")).status).toBe(404);
    // Plain var through the API: redeploys, new version, value not echoed.
    const v = await api("PUT", "/news/vars/FROM_CODE_ONLY", { value: "hello" });
    expect(v.status).toBe(200);
    expect(await v.clone().text()).not.toContain("hello");
    expect(cf.scripts.get("team-sanad-news")?.vars.FROM_CODE_ONLY).toBe("hello");
    // Activity log has names, never values.
    const adm = await t.adminBrowser();
    const audit = await (await adm.get("/admin/activity")).text();
    expect(audit).toContain("Set a Worker secret");
    expect(audit).toContain("Rotated a Worker secret");
    expect(audit).toContain("Deleted a Worker secret");
    expect(audit).toContain("news: OPENAI_KEY");
    expect(audit).not.toContain("v2-secret-value");
  });

  it("shows the env tab (AR) without values and sets a secret from the form", async () => {
    const { cf, team } = await setup();
    const { b } = await t.signIn(team.key, "/ar");
    const page = await (await b.get("/ar/team/workers/news?tab=env")).text();
    expect(page).toContain("المتغيرات والأسرار");
    expect(page).toContain('id="env-table"');
    expect(page).toContain("OPENAI_KEY");
    expect(page).not.toContain(SECRET_VALUE);
    expect(page).not.toContain(VAR_VALUE);
    expect(page).toContain('type="password"');
    const settings = await (await b.get("/ar/team/workers/news?tab=settings")).text();
    expect(settings).not.toContain(VAR_VALUE);
    const csrf = /name="_csrf" value="([^"]+)"/.exec(page)?.[1] ?? "";
    const r = await b.post("/ar/team/workers/news/secret", {
      _csrf: csrf,
      op: "set",
      name: "OPENAI_KEY",
      value: "from-form-value",
      back: "/ar/team/workers/news?tab=env",
    });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toMatch(/^\/ar\/team\/workers\/news\?tab=env/);
    expect(cf.scripts.get("team-sanad-news")?.secrets.get("OPENAI_KEY")).toBe("from-form-value");
    const again = await (await b.get("/ar/team/workers/news?tab=env")).text();
    expect(again).not.toContain("from-form-value");
    // Admin can rotate too.
    const adm = await t.adminBrowser();
    const w = (await (await t.admin("GET", "/workers")).json()).workers[0];
    expect(
      (await t.admin("PUT", `/workers/${w.id}/secrets/OPENAI_KEY`, { value: "admin-rotated" }))
        .status,
    ).toBe(200);
    expect(cf.scripts.get("team-sanad-news")?.secrets.get("OPENAI_KEY")).toBe("admin-rotated");
    const ap = await (await adm.get(`/admin/teams/${team.team.id}/workers/news?tab=env`)).text();
    expect(ap).toContain(`/admin/workers/${w.id}/secret`);
  });
});

describe("0.15.2 health monitoring", () => {
  it("checks, goes down after two failures, recovers, notifies once each way, and can be turned off", async () => {
    const { cf, api, tk, team } = await setup();
    const check = () => api("POST", "/news/health", { check: true });
    expect((await check()).status).toBe(200);
    let h = (await (await api("GET", "/news/health")).json()).health;
    expect(h).toMatchObject({ state: "up", enabled: true });
    expect(h.uptime.h24).toBe(100);
    cf.failing.add(`sanad-news.${ZONE_NAME}`);
    await check();
    h = (await (await api("GET", "/news/health")).json()).health;
    expect(h.state).toBe("up"); // one failure is not enough
    await check();
    await check();
    h = (await (await api("GET", "/news/health")).json()).health;
    expect(h.state).toBe("down");
    expect(h.incidents[0]).toMatchObject({ to: null, status: 500 });
    cf.failing.clear();
    await check();
    h = (await (await api("GET", "/news/health")).json()).health;
    expect(h.state).toBe("up");
    expect(h.uptime.h24).toBe(40);
    const n = await (await t.api("GET", "/api/teams/sanad/notifications", undefined, tk)).json();
    const kinds = n.notifications.map((x: { kind: string }) => x.kind);
    expect(kinds.filter((k: string) => k === "worker-down")).toHaveLength(1);
    expect(kinds.filter((k: string) => k === "worker-recovered")).toHaveLength(1);
    // Off: state "off".
    expect((await api("POST", "/news/health", { enabled: false })).status).toBe(200);
    h = (await (await api("GET", "/news/health")).json()).health;
    expect(h).toMatchObject({ enabled: false, state: "off" });
    await api("POST", "/news/health", { enabled: true });
    // UI: health tab + table column + admin interval.
    const { b } = await t.signIn(team.key, "/ar");
    const tab = await (await b.get("/ar/team/workers/news?tab=health")).text();
    expect(tab).toContain("نسبة التشغيل");
    expect(tab).toContain("<svg");
    const list = await (await b.get("/ar/team/workers")).text();
    expect(list).toContain(">الصحة<");
    expect(list).toContain("يعمل");
    expect((await t.admin("PUT", "/workers/health-settings", { intervalSec: 30 })).status).toBe(
      400,
    );
    expect(
      (await (await t.admin("PUT", "/workers/health-settings", { intervalSec: 600 })).json())
        .intervalSec,
    ).toBe(600);
  });
});

describe("0.15.2 logs and usage", () => {
  it("shows error counts from analytics, Workers Logs lines (redacted) when on, and usage charts", async () => {
    const { cf, api, team } = await setup();
    const hour = new Date(
      Math.floor(t.clock.now / 3_600_000) * 3_600_000 - 3_600_000,
    ).toISOString();
    cf.analyticsRows.push(
      { script: "team-sanad-news", hour, status: "success", requests: 90, errors: 0, cpu: 1500 },
      {
        script: "team-sanad-news",
        hour,
        status: "scriptThrewException",
        requests: 4,
        errors: 4,
        cpu: 2000,
      },
    );
    let l = await (await api("GET", "/news/logs")).json();
    expect(l.logsEnabled).toBe(false);
    expect(l.logs.workersLogs).toBe("off");
    expect(l.logs.entries[0]).toMatchObject({
      source: "analytics",
      kind: "scriptThrewException",
      level: "error",
    });
    // Turn Workers Logs on (settings PATCH only).
    expect((await api("POST", "/news/logs", { enabled: true })).status).toBe(200);
    expect(cf.observability.get("team-sanad-news")).toBe(true);
    cf.logEvents.push({
      timestamp: t.clock.now - 60_000,
      $metadata: {
        level: "error",
        error: `TypeError: boom token=${FAKE_LOG_KEY}`,
      },
      $workers: {
        scriptName: "team-sanad-news",
        outcome: "exception",
        event: { request: { url: "https://x.test/a?key=msk_secret" }, response: { status: 500 } },
      },
    });
    l = await (await api("GET", "/news/logs?refresh=1")).json();
    expect(l.logs.workersLogs).toBe("ok");
    const line = l.logs.entries.find((e: { source: string }) => e.source === "workers-logs");
    expect(line).toMatchObject({ url: "/a", status: 500, kind: "exception" });
    expect(JSON.stringify(l)).not.toContain(FAKE_LOG_KEY);
    expect(JSON.stringify(l)).not.toContain("msk_secret");
    // Denied observability reports the missing permission.
    cf.denied.add("observability");
    l = await (await api("GET", "/news/logs?refresh=1")).json();
    expect(l.logs.workersLogs).toBe("denied");
    // Usage.
    const u = await (await api("GET", "/news/usage?range=24h")).json();
    expect(u.cloudflare.total).toMatchObject({ requests: 94, errors: 4 });
    expect(u.cloudflare.points).toHaveLength(24);
    expect(u.cloudflare.byStatus.scriptThrewException).toBe(4);
    const u30 = await (await api("GET", "/news/usage?range=30d")).json();
    expect(u30.cloudflare.points).toHaveLength(30);
    // Nothing but read queries went to GraphQL.
    expect(
      cf.queries
        .filter((q) => q.kind === "graphql")
        .every((q) => !/mutation/.test(JSON.stringify(q.body))),
    ).toBe(true);
    // UI tabs.
    const { b } = await t.signIn(team.key, "/ar");
    const logsTab = await (await b.get("/ar/team/workers/news?tab=logs")).text();
    expect(logsTab).toContain('id="logs-table"');
    expect(logsTab).toContain("Workers Observability: Edit (API: Write)");
    expect(logsTab).not.toContain(FAKE_LOG_KEY);
    const usageTab = await (await b.get("/ar/team/workers/news?tab=usage&range=7d")).text();
    expect(usageTab).toContain('class="bar-req"');
    expect(usageTab).toContain("الطلبات لكل مفتاح مستخدم");
    // Table sparkline: the snapshot loads in the background, then shows.
    await b.get("/ar/team/workers");
    await new Promise((r) => setTimeout(r, 30));
    const list = await (await b.get("/ar/team/workers")).text();
    expect(list).toContain('class="spark"');
  });
});

describe("0.15.2 token permissions", () => {
  it("probes each permission read-only, shows lights, and never prints the token", async () => {
    const { cf } = await setup();
    cf.denied.add("analytics");
    cf.denied.add("observability");
    cf.denied.add("tail");
    const before = cf.calls.length;
    const r = await (await t.admin("GET", "/workers/permissions?refresh=1")).json();
    const p = r.permissions;
    const by = Object.fromEntries(p.checks.map((c: { id: string }) => [c.id, c]));
    expect(by.token.state).toBe("granted");
    expect(by.scripts.state).toBe("granted");
    expect(by.settings.state).toBe("granted");
    expect(by.routes.state).toBe("granted");
    expect(by.dns.state).toBe("granted");
    expect(by.analytics.state).toBe("missing");
    expect(by.observability.state).toBe("missing");
    expect(by.tail).toMatchObject({ state: "missing", required: false });
    expect(p.granted).toBe(p.required - 2);
    expect(JSON.stringify(r)).not.toContain(CF_TOKEN);
    // Probes never change anything: no PUT/PATCH/DELETE, and POSTs only to read-only queries.
    const probes = cf.calls.slice(before);
    expect(probes.length).toBeGreaterThan(8);
    expect(
      probes.every(
        (c) =>
          c.method === "GET" || (c.method === "POST" && /graphql|telemetry\/query/.test(c.path)),
      ),
    ).toBe(true);
    const adm = await t.adminBrowser();
    const page = await (await adm.get("/ar/admin/settings")).text();
    expect(page).toContain("صلاحيات الرمز");
    expect(page).toContain('class="light on"');
    expect(page).toContain('class="light err"');
    expect(page).toContain('class="light off"');
    expect(page).toMatch(/\d+\/\d+ من الصلاحيات المطلوبة ممنوحة/);
    expect(page).not.toContain(CF_TOKEN);
    cf.denied.clear();
    const csrf = /name="_csrf" value="([^"]+)"/.exec(page)?.[1] ?? "";
    expect((await adm.post("/ar/admin/settings/permissions", { _csrf: csrf })).status).toBe(303);
    const again = await (await t.admin("GET", "/workers/permissions")).json();
    expect(again.permissions.granted).toBe(again.permissions.required);
  });

  it("parses Workers Logs events defensively", () => {
    const e = parseEvent({
      $metadata: { message: "hello", level: "info" },
      timestamp: 1767225600000,
    });
    expect(e).toMatchObject({ level: "info", message: "hello", source: "workers-logs" });
    expect(parseEvent(null).message).toBe("(no message)");
  });
});

describe("0.15.2 MCP tools", () => {
  it("worker_env / set_worker_secret / worker_status: names only, write-only secrets", async () => {
    const { cf, team } = await setup();
    const site = (await (await t.publish(team.key)).json()) as { id: string };
    const { b } = await t.signIn(team.key);
    const csrf = await b.csrf(`/team/sites/${site.id}`);
    const res = await b.post(`/team/sites/${site.id}/mcp`, {
      _csrf: csrf,
      name: "agent",
      scope: "rw",
    });
    const loc = new URL(res.headers.get("location") ?? "", BASE);
    const html = await (await b.get(loc.pathname + loc.search)).text();
    const secret = /marsa_mcp_[A-Za-z0-9_-]{20,}/.exec(html)?.[0] as string;
    const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp/s/${site.id}`), {
      requestInit: { headers: { authorization: `Bearer ${secret}` } },
      fetch: (url, init) => t.app.request(String(url), init as RequestInit) as Promise<Response>,
    });
    const client = new Client({ name: "w", version: "1" });
    await client.connect(transport);
    const names = (await client.listTools()).tools.map((x) => x.name);
    expect(names).toEqual(
      expect.arrayContaining(["worker_env", "set_worker_secret", "worker_status"]),
    );
    const call = async (name: string, args: Record<string, unknown>) =>
      ((await client.callTool({ name, arguments: args })) as { content: { text: string }[] })
        .content[0]?.text ?? "";
    const env = await call("worker_env", { name: "news" });
    expect(env).toContain("OPENAI_KEY");
    expect(env).not.toContain(SECRET_VALUE);
    expect(env).not.toContain(VAR_VALUE);
    const set = await call("set_worker_secret", {
      name: "news",
      secret: "OPENAI_KEY",
      value: "mcp-secret-v",
    });
    expect(set).not.toContain("mcp-secret-v");
    expect(cf.scripts.get("team-sanad-news")?.secrets.get("OPENAI_KEY")).toBe("mcp-secret-v");
    await call("set_worker_secret", { name: "news", secret: "OPENAI_KEY", value: null });
    expect(cf.scripts.get("team-sanad-news")?.secrets.has("OPENAI_KEY")).toBe(false);
    const st = JSON.parse(await call("worker_status", { name: "news", range: "7d" }));
    expect(st).toHaveProperty("health.state");
    expect(st.usage.points).toHaveLength(168);
    void MCP_CODE;
  });
});

describe("0.15.2 health scheduler", () => {
  it("runs a round only when the interval has passed and skips disabled/inactive Workers", async () => {
    const { HealthMonitor } = await import("../src/worker-health.js");
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "hm-"));
    let now = 1_000_000;
    const hits: string[] = [];
    const m = new HealthMonitor(dir, {
      now: () => now,
      fetch: async (u) => {
        hits.push(String(u));
        return new Response("ok");
      },
      defaultIntervalSec: 300,
    });
    const rec = (id: string, status = "active") =>
      ({ id, teamId: "t", name: id, url: `https://${id}.test`, status }) as never;
    const list = () => [rec("a"), rec("b", "disabled"), rec("c")];
    await m.setEnabled("c", false);
    await m.maybeTick(list);
    expect(hits).toEqual(["https://a.test"]);
    now += 60_000;
    await m.maybeTick(list);
    expect(hits).toHaveLength(1);
    now += 300_000;
    await m.maybeTick(list);
    expect(hits).toHaveLength(2);
    // Persisted across restarts.
    const m2 = new HealthMonitor(dir, { now: () => now, fetch: async () => new Response("") });
    await m2.ready();
    expect(m2.view("a").uptime.h24).toBe(100);
    expect(m2.enabled("c")).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });
});
