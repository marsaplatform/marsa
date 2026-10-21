import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SecretBox } from "../src/secrets.js";
import { CF_ACCOUNT, CF_TOKEN, FakeCfWorkers, ZONE_NAME } from "./fake-cf-workers.js";
import { BASE, makeApp } from "./helpers.js";

type App = Awaited<ReturnType<typeof makeApp>>;
let t: App;
afterEach(async () => {
  vi.restoreAllMocks();
  await t?.cleanup();
});

const KEY = "k".repeat(48);
const HELLO =
  "export default { async fetch(request, env) { return new Response('hello ' + env.WHO); } };";

/** App + fake Cloudflare + console spies; the admin token is set and team "Sanad" has Workers. */
async function setup(
  opts: { configure?: boolean; enable?: boolean; env?: Record<string, string> } = {},
) {
  const cf = new FakeCfWorkers();
  const logs: string[] = [];
  for (const k of ["log", "error", "warn", "info"] as const) {
    vi.spyOn(console, k).mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(" "));
    });
  }
  t = await makeApp({ MARSA_SECRETS_KEY: KEY, ...(opts.env ?? {}) }, { cfFetch: cf.fetch });
  if (opts.configure !== false) {
    const r = await t.admin("PUT", "/workers/settings", { token: CF_TOKEN, zone: ZONE_NAME });
    expect(r.status).toBe(200);
  }
  const team = await t.createTeam("سند");
  if (opts.enable !== false) {
    const r = await t.admin("PUT", `/teams/${team.team.id}/workers`, {
      enabled: true,
      slug: "sanad",
    });
    expect(r.status).toBe(200);
  }
  const tk = { "x-team-key": team.key };
  const deploy = (name: string, body: unknown = { code: HELLO, vars: { WHO: "sanad" } }) =>
    t.api("PUT", `/api/teams/sanad/workers/${name}`, body, tk);
  return { cf, logs, team, tk, deploy };
}

describe("team Workers", () => {
  it("stores the Cloudflare token encrypted and never returns or logs it", async () => {
    const { cf, logs } = await setup();
    const res = await t.admin("GET", "/workers/settings");
    const text = await res.text();
    expect(text).not.toContain(CF_TOKEN);
    const s = JSON.parse(text).settings;
    expect(s).toMatchObject({
      configured: true,
      last4: CF_TOKEN.slice(-4),
      zoneName: ZONE_NAME,
      status: "active",
    });
    const raw = await readFile(join(t.dir, "settings.json"), "utf8");
    expect(raw).not.toContain(CF_TOKEN);
    const sealed = JSON.parse(raw).cloudflare.tokenSealed as string;
    expect(new SecretBox(KEY).open(sealed)).toBe(CF_TOKEN);
    expect(() => new SecretBox("x".repeat(40)).open(sealed)).toThrow();
    // Admin page shows only the last 4 characters.
    const b = await t.adminBrowser();
    const page = await (await b.get("/admin/workers")).text();
    expect(page).toContain(`…${CF_TOKEN.slice(-4)}`);
    expect(page).not.toContain(CF_TOKEN);
    // Verify works; a bad token is refused and not stored.
    expect((await t.admin("POST", "/workers/settings/verify")).status).toBe(200);
    const bad = await t.admin("PUT", "/workers/settings", { token: "wrong_token_value_123456789" });
    expect(bad.status).toBe(502);
    expect(await readFile(join(t.dir, "settings.json"), "utf8")).toBe(raw);
    // Deploy, list and error paths never echo it either.
    const team = await t.createTeam("Other", {});
    await t.admin("PUT", `/teams/${team.team.id}/workers`, { enabled: true, slug: "other" });
    cf.failPutScript = true;
    const fail = await t.api(
      "PUT",
      "/api/teams/other/workers/x",
      { code: HELLO },
      { "x-team-key": team.key },
    );
    expect(fail.status).toBe(502);
    expect(await fail.text()).not.toContain(CF_TOKEN);
    expect(logs.join("\n")).not.toContain(CF_TOKEN);
    expect(await readFile(join(t.dir, "audit.json"), "utf8")).not.toContain(CF_TOKEN);
  });

  it("accepts an account-owned token (account found through the zone)", async () => {
    const cf = new FakeCfWorkers();
    cf.accountOwned = true;
    t = await makeApp({ MARSA_SECRETS_KEY: KEY }, { cfFetch: cf.fetch });
    const r = await t.admin("PUT", "/workers/settings", { token: CF_TOKEN, zone: ZONE_NAME });
    expect(r.status).toBe(200);
    expect((await r.json()).settings).toMatchObject({ status: "active", accountId: CF_ACCOUNT });
    const unknown = await t.admin("PUT", "/workers/settings", {
      token: CF_TOKEN,
      zone: "nope.test",
    });
    expect(unknown.status).toBe(400);
  });

  it("needs MARSA_SECRETS_KEY and a configured token", async () => {
    t = await makeApp({}, { cfFetch: new FakeCfWorkers().fetch });
    const r = await t.admin("PUT", "/workers/settings", { token: CF_TOKEN });
    expect(r.status).toBe(503);
    await t.cleanup();
    const { tk } = await setup({ configure: false, enable: false });
    const team = (await (await t.admin("GET", "/teams")).json()).teams[0];
    await t.admin("PUT", `/teams/${team.id}/workers`, { enabled: true, slug: "sanad" });
    const d = await t.api("PUT", "/api/teams/sanad/workers/a", { code: HELLO }, tk);
    expect(d.status).toBe(503);
    expect((await d.json()).error.code).toBe("WORKERS_NOT_CONFIGURED");
  });

  it("deploys a Worker with forced naming, DNS and route, then deletes all of it", async () => {
    const { cf, deploy, tk, team } = await setup();
    const res = await deploy("hello");
    expect(res.status).toBe(201);
    const { worker } = await res.json();
    expect(worker).toMatchObject({
      name: "hello",
      script: "team-sanad-hello",
      host: `sanad-hello.${ZONE_NAME}`,
      url: `https://sanad-hello.${ZONE_NAME}`,
      status: "active",
      vars: { WHO: "sanad" },
    });
    expect(cf.scripts.get("team-sanad-hello")?.code).toBe(HELLO);
    const rec = [...cf.dns.values()].find((r) => r.name === `sanad-hello.${ZONE_NAME}`);
    expect(rec).toMatchObject({ type: "AAAA", content: "100::", proxied: true });
    expect([...cf.routes.values()].some((r) => r.pattern === `sanad-hello.${ZONE_NAME}/*`)).toBe(
      true,
    );
    // Team id works as well as the slug; live probe reaches the Worker.
    const get = await t.api("GET", `/api/teams/${team.team.id}/workers/hello`, undefined, tk);
    expect((await get.json()).live.status).toBe(200);
    // Raw JS redeploy keeps vars.
    const re = await t.app.request("/api/teams/sanad/workers/hello", {
      method: "PUT",
      headers: { ...tk, "content-type": "application/javascript" },
      body: HELLO.replace("hello ", "hi "),
    });
    expect(re.status).toBe(200);
    expect((await re.json()).worker.vars).toEqual({ WHO: "sanad" });
    expect(cf.routes.size).toBe(2);
    // Audit (Arabic labels exist).
    const audit = await readFile(join(t.dir, "audit.json"), "utf8");
    expect(audit).toContain("worker-deploy");
    expect(audit).toContain("worker-redeploy");
    // Delete removes route, DNS and script; nothing else.
    const del = await t.api("DELETE", "/api/teams/sanad/workers/hello", undefined, tk);
    expect(del.status).toBe(204);
    expect(cf.scripts.has("team-sanad-hello")).toBe(false);
    expect(cf.routes.size).toBe(1);
    expect(cf.dns.size).toBe(1);
    for (const s of [
      "marsa-atlas-mcp",
      "malja-mcp",
      "erx-mcp",
      "mail-worker",
      "team-sanad-taken",
    ]) {
      expect(cf.scripts.has(s)).toBe(true);
    }
  });

  it("never touches scripts, hosts or routes it did not create", async () => {
    const { cf, deploy, tk } = await setup();
    const taken = await deploy("taken");
    expect(taken.status).toBe(409);
    expect((await taken.json()).error.code).toBe("NAME_TAKEN");
    expect(cf.scripts.get("team-sanad-taken")?.code).toBe("x");
    const busy = await deploy("busy");
    expect(busy.status).toBe(409);
    expect((await busy.json()).error.code).toBe("HOST_TAKEN");
    expect(cf.dns.has("d_pre")).toBe(true);
    expect((await t.api("DELETE", "/api/teams/sanad/workers/taken", undefined, tk)).status).toBe(
      404,
    );
    // No DELETE call ever went to Cloudflare.
    expect(cf.calls.filter((c) => c.method === "DELETE")).toEqual([]);
    expect(cf.calls.some((c) => c.method === "PUT" && c.path.includes("malja"))).toBe(false);
  });

  it("checks names, slugs, size and quotas", async () => {
    const { deploy, team } = await setup();
    for (const bad of ["-x", "x-", "a--b", "UPPER", "a".repeat(31), "a_b", "a.b"]) {
      expect((await deploy(encodeURIComponent(bad))).status, bad).toBe(400);
    }
    expect((await deploy("nomod", { code: "addEventListener('fetch', () => {})" })).status).toBe(
      400,
    );
    for (const slug of ["www", "a", "Sanad", "1abc", "has-dash"]) {
      const other = await t.createTeam(`T ${slug}`);
      const r = await t.admin("PUT", `/teams/${other.team.id}/workers`, { enabled: true, slug });
      expect(r.status, slug).toBe(400);
    }
    const dup = await t.createTeam("Dup");
    expect(
      (await t.admin("PUT", `/teams/${dup.team.id}/workers`, { enabled: true, slug: "sanad" }))
        .status,
    ).toBe(400);
    await t.admin("PUT", `/teams/${team.team.id}/workers`, { maxWorkerKb: 1 });
    const big = await deploy("big", { code: `${HELLO}//${"x".repeat(2000)}` });
    expect(big.status).toBe(413);
    for (const n of ["a", "b", "c"]) expect((await deploy(n)).status).toBe(201);
    const q = await deploy("d");
    expect(q.status).toBe(409);
    expect((await q.json()).error.code).toBe("WORKER_QUOTA");
    // Slug is fixed while Workers exist.
    expect(
      (await t.admin("PUT", `/teams/${team.team.id}/workers`, { slug: "sanad2" })).status,
    ).toBe(400);
  });

  it("checks who may deploy", async () => {
    const { deploy } = await setup();
    // No key / another team's key / a team without Workers.
    expect((await t.api("GET", "/api/teams/sanad/workers")).status).toBe(401);
    const other = await t.createTeam("Other");
    expect(
      (await t.api("GET", "/api/teams/sanad/workers", undefined, { "x-team-key": other.key }))
        .status,
    ).toBe(404);
    const r = await t.api(
      "PUT",
      `/api/teams/${other.team.id}/workers/x`,
      { code: HELLO },
      { "x-team-key": other.key },
    );
    expect(r.status).toBe(403);
    // Admin API needs the admin token.
    expect((await t.api("GET", "/api/admin/workers/settings")).status).toBe(401);
    expect((await deploy("ok")).status).toBe(201);
  });

  it("lets editors deploy from the dashboard, but not viewers", async () => {
    const { cf, team } = await setup();
    const mk = async (role: string, username: string) => {
      const inv = await t.admin("POST", `/teams/${team.team.id}/invites`, { role });
      const path = ((await inv.json()) as { url: string }).url.replace(BASE, "");
      const { Browser } = await import("./helpers.js");
      const b = new Browser(t.app);
      const csrf = await b.csrf(path);
      const pw = "correct horse battery";
      await b.post(path, { _csrf: csrf, username, name: username, password: pw, confirm: pw });
      return b;
    };
    const viewer = await mk("viewer", "vera");
    const page = await (await viewer.get("/ar/team/workers")).text();
    expect(page).toContain("الوركرات");
    expect(page).not.toContain('action="/ar/team/workers/deploy"');
    const vcsrf = await viewer.csrf("/team/workers");
    const vres = await viewer.post("/team/workers/deploy", {
      _csrf: vcsrf,
      name: "v",
      code: HELLO,
    });
    expect(vres.status).toBe(303);
    expect(cf.scripts.has("team-sanad-v")).toBe(false);
    const editor = await mk("editor", "eddy");
    const ecsrf = await editor.csrf("/team/workers");
    const eres = await editor.post("/team/workers/deploy", {
      _csrf: ecsrf,
      name: "web",
      code: HELLO,
      vars: "WHO=web\n# comment",
      secrets: "API_SECRET=s3cr3t-value-xyz",
    });
    expect(eres.status).toBe(303);
    expect(cf.scripts.get("team-sanad-web")?.secrets.get("API_SECRET")).toBe("s3cr3t-value-xyz");
    const list = await (await editor.get("/team/workers")).text();
    expect(list).toContain('data-href="/team/workers/web"');
    expect(list).not.toContain("s3cr3t-value-xyz");
    const detail = await (await editor.get("/team/workers/web")).text();
    expect(detail).toContain("API_SECRET");
    expect(detail).toContain("WHO");
    expect(detail).not.toContain("s3cr3t-value-xyz");
    expect(await readFile(join(t.dir, "workers.json"), "utf8")).not.toContain("s3cr3t-value-xyz");
  });

  it("tears Workers down when the admin turns Workers off or deletes the team", async () => {
    const { cf, deploy, team } = await setup();
    await deploy("one");
    await deploy("two");
    const off = await t.admin("PUT", `/teams/${team.team.id}/workers`, { enabled: false });
    expect((await off.json()).removed).toBe(2);
    expect(cf.scripts.has("team-sanad-one")).toBe(false);
    expect(cf.dns.size).toBe(1);
    await t.admin("PUT", `/teams/${team.team.id}/workers`, { enabled: true });
    await deploy("three");
    // Admin disable removes the route only; enable restores it.
    const all = (await (await t.admin("GET", "/workers")).json()).workers;
    expect(all).toHaveLength(1);
    await t.admin("POST", `/workers/${all[0].id}/disable`);
    expect([...cf.routes.values()].some((r) => r.script === "team-sanad-three")).toBe(false);
    await t.admin("POST", `/workers/${all[0].id}/enable`);
    expect([...cf.routes.values()].some((r) => r.script === "team-sanad-three")).toBe(true);
    // Token can't be removed while Workers exist.
    expect((await t.admin("DELETE", "/workers/settings")).status).toBe(409);
    const del = await t.admin("DELETE", `/teams/${team.team.id}?purge=now&confirm=${team.team.id}`);
    expect((await del.json()).removedWorkers).toBe(1);
    expect(cf.scripts.has("team-sanad-three")).toBe(false);
    expect(cf.routes.size).toBe(1);
    expect(cf.dns.size).toBe(1);
  });

  it("exposes list/deploy/delete tools on a read-write space MCP", async () => {
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
      expect.arrayContaining(["list_workers", "deploy_worker", "delete_worker"]),
    );
    const r = (await client.callTool({
      name: "deploy_worker",
      arguments: { name: "mcp", code: HELLO },
    })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(r.isError).toBeFalsy();
    expect(cf.scripts.has("team-sanad-mcp")).toBe(true);
    await client.callTool({ name: "delete_worker", arguments: { name: "mcp" } });
    expect(cf.scripts.has("team-sanad-mcp")).toBe(false);
    // Off for the team: the tools disappear.
    await t.admin("PUT", `/teams/${team.team.id}/workers`, { enabled: false });
    const after = (await client.listTools()).tools.map((x) => x.name);
    expect(after).not.toContain("deploy_worker");
  });
});
