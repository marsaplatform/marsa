import { createHmac } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentKeyStore } from "../src/agent-keys.js";
import { AlertTicker } from "../src/alerts.js";
import type { NotificationCenter } from "../src/notify.js";
import { CF_TOKEN, FakeCfWorkers, ZONE_NAME } from "./fake-cf-workers.js";
import { makeApp } from "./helpers.js";

type App = Awaited<ReturnType<typeof makeApp>>;
let t: App;
let server: Server | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  await t?.cleanup();
  if (server) await new Promise((r) => server?.close(r));
  server = null;
});

const KEY = "k".repeat(48);
const code = (n: number) =>
  `export default { async fetch(request, env) { return new Response('v${n} ' + env.WHO); } };`;

async function setup(env: Record<string, string> = {}) {
  const cf = new FakeCfWorkers();
  for (const k of ["log", "error", "warn", "info"] as const) {
    vi.spyOn(console, k).mockImplementation(() => {});
  }
  let svc: { agentKeys: AgentKeyStore; notify: NotificationCenter } | null = null;
  t = await makeApp(
    { MARSA_SECRETS_KEY: KEY, ...env },
    {
      cfFetch: cf.fetch,
      app: {
        notifyOpts: { retryDelays: [0, 0] },
        expose: (s) => {
          svc = s;
        },
      },
    },
  );
  expect(
    (await t.admin("PUT", "/workers/settings", { token: CF_TOKEN, zone: ZONE_NAME })).status,
  ).toBe(200);
  const team = await t.createTeam("Sanad", { backend: true });
  expect(
    (await t.admin("PUT", `/teams/${team.team.id}/workers`, { enabled: true, slug: "sanad" }))
      .status,
  ).toBe(200);
  const tk = { "x-team-key": team.key };
  const deploy = (name: string, body: unknown, h: Record<string, string> = tk) =>
    t.api("PUT", `/api/teams/sanad/workers/${name}`, body, h);
  const newKey = async (scopes: string[], days = 30, name = "bot") => {
    const r = await t.api(
      "POST",
      "/api/teams/sanad/agent-keys",
      { name, scopes, expiresInDays: days },
      tk,
    );
    expect(r.status).toBe(201);
    return (await r.json()) as { key: { id: string; prefix: string }; secret: string };
  };
  if (!svc) throw new Error("services not exposed");
  return {
    cf,
    team,
    tk,
    deploy,
    newKey,
    svc: svc as { agentKeys: AgentKeyStore; notify: NotificationCenter },
  };
}

describe("0.14.0 worker versions", () => {
  it("stores every deploy, redeploys in one click and rolls back", async () => {
    const { cf, tk, deploy } = await setup();
    expect(
      (
        await deploy("api", {
          code: code(1),
          vars: { WHO: "a" },
          secrets: { TOKEN: "s3cret-value" },
        })
      ).status,
    ).toBe(201);
    expect(
      (await deploy("api", { code: code(2), vars: { WHO: "b" }, note: "second" })).status,
    ).toBe(200);
    const list = await (
      await t.api("GET", "/api/teams/sanad/workers/api/versions", undefined, tk)
    ).json();
    expect(list.current).toBe(2);
    expect(list.versions.map((v: { n: number }) => v.n)).toEqual([2, 1]);
    expect(list.versions[0]).toMatchObject({
      action: "deploy",
      note: "second",
      varNames: ["WHO"],
      secretNames: ["TOKEN"],
    });
    expect(list.versions[1].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(list)).not.toContain("s3cret-value");
    // Stored file: mode 600, no secret values.
    const files = await readFile(join(t.dir, "workers.json"), "utf8");
    const id = JSON.parse(files).workers[0].id as string;
    const raw = await readFile(join(t.dir, "worker-versions", `${id}.json`), "utf8");
    expect(raw).not.toContain("s3cret-value");
    // Download the code of v1.
    const dl = await t.api("GET", "/api/teams/sanad/workers/api/versions/1/code", undefined, tk);
    expect(dl.headers.get("content-disposition")).toContain("api-v1.js");
    expect(await dl.text()).toBe(code(1));
    // Roll back to v1: code + vars of v1, recorded as v3.
    const rb = await t.api("POST", "/api/teams/sanad/workers/api/rollback", { version: 1 }, tk);
    expect(rb.status).toBe(200);
    const rbj = await rb.json();
    expect(rbj.worker).toMatchObject({ version: 3, vars: { WHO: "a" } });
    expect(rbj.missingSecrets).toEqual([]);
    expect(cf.scripts.get("team-sanad-api")?.code).toBe(code(1));
    expect(cf.scripts.get("team-sanad-api")?.secrets.get("TOKEN")).toBe("s3cret-value");
    // One-click redeploy = newest stored version again.
    const re = await t.api("POST", "/api/teams/sanad/workers/api/redeploy", {}, tk);
    expect(re.status).toBe(200);
    expect((await re.json()).worker.version).toBe(4);
    const v = await (
      await t.api("GET", "/api/teams/sanad/workers/api/versions", undefined, tk)
    ).json();
    expect(v.versions[0]).toMatchObject({ n: 4, action: "redeploy" });
    expect(v.versions[1]).toMatchObject({ n: 3, action: "rollback", from: 1 });
    expect(
      (await t.api("POST", "/api/teams/sanad/workers/api/rollback", { version: 99 }, tk)).status,
    ).toBe(404);
    // Activity log has the rollback.
    const b = await t.signIn(
      (await t.admin("GET", "/teams")).ok ? (tk["x-team-key"] as string) : "",
    );
    const page = await (await b.b.get("/team/activity")).text();
    expect(page).toContain("Rolled back a Worker");
    // Delete removes the history.
    expect((await t.api("DELETE", "/api/teams/sanad/workers/api", undefined, tk)).status).toBe(204);
    await expect(access(join(t.dir, "worker-versions", `${id}.json`))).rejects.toThrow();
  });

  it("keeps the last 10 versions; no stored version means no one-click redeploy", async () => {
    const { tk, deploy } = await setup();
    for (let i = 1; i <= 12; i++)
      expect((await deploy("w", { code: code(i) })).status).toBeLessThan(300);
    const v = await (
      await t.api("GET", "/api/teams/sanad/workers/w/versions", undefined, tk)
    ).json();
    expect(v.versions).toHaveLength(10);
    expect(v.versions[0].n).toBe(12);
    expect(v.versions[9].n).toBe(3);
    // A Worker from before 0.14 (no stored versions) explains itself.
    const recs = JSON.parse(await readFile(join(t.dir, "workers.json"), "utf8"));
    expect(recs.workers[0].version).toBe(12);
  });

  it("raises the var limits: big vars ride in a module, totals are capped", async () => {
    const { cf, deploy } = await setup();
    const big = "x".repeat(10 * 1024);
    expect((await deploy("big", { code: code(1), vars: { BIG: big, SMALL: "s" } })).status).toBe(
      201,
    );
    const s = cf.scripts.get("team-sanad-big");
    expect(s?.vars).toEqual({ SMALL: "s" });
    expect(Object.keys(s?.modules ?? {}).sort()).toEqual(["marsa-vars.js", "user.js", "worker.js"]);
    expect(s?.modules["user.js"]).toBe(code(1));
    expect(s?.modules["marsa-vars.js"]).toContain(big);
    expect(s?.code).toContain('import * as user from "./user.js"');
    // Small vars only: one plain module as before.
    expect((await deploy("small", { code: code(1), vars: { A: "1" } })).status).toBe(201);
    expect(Object.keys(cf.scripts.get("team-sanad-small")?.modules ?? {})).toEqual(["worker.js"]);
    // Over 32 KB per var, or 64 KB in total, is refused.
    const one = await deploy("x1", { code: code(1), vars: { A: "y".repeat(33 * 1024) } });
    expect(one.status).toBe(400);
    const tot = await deploy("x2", {
      code: code(1),
      vars: { A: "y".repeat(30 * 1024), B: "y".repeat(30 * 1024), C: "y".repeat(6 * 1024) },
    });
    expect(tot.status).toBe(400);
    expect((await tot.json()).error.code).toBe("VARS_TOO_LARGE");
    const cls = await deploy("x3", {
      code: "export default class extends WorkerEntrypoint { fetch() {} }",
      vars: { A: "y".repeat(6 * 1024) },
    });
    expect((await cls.json()).error.code).toBe("LARGE_VARS_NEED_OBJECT");
  });
});

describe("0.14.0 agent keys", () => {
  it("enforces scopes, expiry and revocation wherever the team key works", async () => {
    const { tk, deploy, newKey, svc } = await setup();
    expect((await deploy("api", { code: code(1) })).status).toBe(201);
    const ro = await newKey(["workers:read"]);
    expect(ro.secret).toMatch(/^marsa_agent_/);
    // Stored hashed only.
    expect(await readFile(join(t.dir, "agent-keys.json"), "utf8")).not.toContain(ro.secret);
    const h = { "x-team-key": ro.secret };
    expect((await t.api("GET", "/api/teams/sanad/workers", undefined, h)).status).toBe(200);
    const bearer = { authorization: `Bearer ${ro.secret}` };
    expect(
      (await t.api("GET", "/api/teams/sanad/workers/api/versions", undefined, bearer)).status,
    ).toBe(200);
    const denied = await deploy("api", { code: code(2) }, h);
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe("INSUFFICIENT_SCOPE");
    expect(
      (await t.api("POST", "/api/teams/sanad/workers/api/rollback", { version: 1 }, h)).status,
    ).toBe(403);
    expect((await t.publish(ro.secret)).status).toBe(403);
    expect((await t.api("GET", "/api/teams/sanad/sites", undefined, h)).status).toBe(403);
    // Agent keys cannot mint keys.
    expect(
      (
        await t.api(
          "POST",
          "/api/teams/sanad/agent-keys",
          { name: "x", scopes: ["mcp"], expiresInDays: 7 },
          h,
        )
      ).status,
    ).toBe(403);
    // Expiry is required and capped.
    for (const bad of [undefined, 0, 400, "abc"]) {
      const r = await t.api(
        "POST",
        "/api/teams/sanad/agent-keys",
        { name: "x", scopes: ["mcp"], expiresInDays: bad },
        tk,
      );
      expect(r.status).toBe(400);
    }
    expect(
      (
        await t.api(
          "POST",
          "/api/teams/sanad/agent-keys",
          { name: "x", scopes: ["nope"], expiresInDays: 7 },
          tk,
        )
      ).status,
    ).toBe(400);
    // Last used is recorded; listing never shows secrets.
    const list = await (await t.api("GET", "/api/teams/sanad/agent-keys", undefined, tk)).json();
    expect(list.keys[0]).toMatchObject({ name: "bot", state: "active", scopes: ["workers:read"] });
    expect(list.keys[0].lastUsedAt).toBeTruthy();
    expect(JSON.stringify(list)).not.toContain(ro.secret);
    // Deploy scope + spaces scopes work.
    const rw = await newKey(["workers:deploy", "spaces:write", "spaces:read"], 7, "deployer");
    const hw = { "x-team-key": rw.secret };
    expect((await deploy("api", { code: code(2) }, hw)).status).toBe(200);
    const pub = await t.publish(rw.secret);
    expect(pub.status).toBe(201);
    const site = await pub.json();
    const sites = await (await t.api("GET", "/api/teams/sanad/sites", undefined, hw)).json();
    expect(sites.sites.map((x: { id: string }) => x.id)).toContain(site.id);
    expect((await t.api("PATCH", `/api/sites/${site.id}`, { ttlHours: 48 }, hw)).status).toBe(200);
    // Revoke: refused at once.
    expect(
      (await t.api("DELETE", `/api/teams/sanad/agent-keys/${ro.key.id}`, undefined, tk)).status,
    ).toBe(200);
    expect((await t.api("GET", "/api/teams/sanad/workers", undefined, h)).status).toBe(401);
    // Expiry: 7 days later the deploy key stops, and the ticker alerts once.
    t.clock.now += 8 * 86_400_000;
    expect((await deploy("api", { code: code(3) }, hw)).status).toBe(401);
    const ticker = new AlertTicker({ agentKeys: svc.agentKeys, notify: svc.notify, backend: null });
    expect(await ticker.expiredKeys()).toBe(1);
    expect(await ticker.expiredKeys()).toBe(0);
    const n = await (await t.api("GET", "/api/teams/sanad/notifications", undefined, tk)).json();
    const kinds = n.notifications.map((x: { kind: string }) => x.kind);
    expect(kinds).toContain("agent-key-expired");
    expect(kinds).toContain("agent-key-revoke");
    expect(kinds).toContain("agent-key-create");
    expect(kinds).toContain("agent-key-new-ip");
    expect(kinds).toContain("worker-redeploy");
    // The IP is never stored, only a keyed hash.
    const raw = await readFile(join(t.dir, "agent-keys.json"), "utf8");
    expect(raw).not.toContain("unknown");
  });

  it("kv scopes on the team's own sites; mcp scope filters tools", async () => {
    const { newKey, tk } = await setup();
    const pub = await (await t.publish(tk["x-team-key"] as string)).json();
    const kvr = await newKey(["kv:read"]);
    const kvw = await newKey(["kv:read", "kv:write", "mcp", "workers:read"], 30, "kvbot");
    const put = (h: string) =>
      t.api(
        "PUT",
        `/api/sites/${pub.id}/kv/greeting`,
        { value: { hi: 1 } },
        { authorization: `Bearer ${h}` },
      );
    expect((await put(kvr.secret)).status).toBe(403);
    expect((await put(kvw.secret)).status).toBeLessThan(300);
    const get = await t.api("GET", `/api/sites/${pub.id}/kv/greeting`, undefined, {
      authorization: `Bearer ${kvr.secret}`,
    });
    expect(get.status).toBe(200);
    // Another team's key gets a 404 (no oracle).
    const other = await t.createTeam("Other", { backend: true });
    const theirs = await (await t.publish(other.key)).json();
    expect(
      (
        await t.api("GET", `/api/sites/${theirs.id}/kv`, undefined, {
          authorization: `Bearer ${kvw.secret}`,
        })
      ).status,
    ).toBe(404);
    // MCP with the agent key: only the tools its scopes allow.
    const rpc = (secret: string, method: string, params: object = {}) =>
      t.api(
        "POST",
        `/mcp/s/${pub.id}`,
        { jsonrpc: "2.0", id: 1, method, params },
        {
          authorization: `Bearer ${secret}`,
          accept: "application/json, text/event-stream",
        },
      );
    expect((await rpc(kvr.secret, "tools/list")).status).toBe(403);
    const tools = (await (await rpc(kvw.secret, "tools/list")).json()).result.tools.map(
      (x: { name: string }) => x.name,
    );
    expect(tools).toContain("kv_put");
    expect(tools).toContain("list_worker_versions");
    expect(tools).not.toContain("deploy_worker");
    expect(tools).not.toContain("replace_site_files");
    const call = await (
      await rpc(kvw.secret, "tools/call", { name: "replace_site_files", arguments: {} })
    ).json();
    expect(call.result.isError).toBe(true);
  });

  it("agent invite: onboarding, one claim, then dead", async () => {
    const { tk } = await setup();
    const r = await t.api(
      "POST",
      "/api/teams/sanad/agent-invites",
      { name: "builder", scopes: ["workers:read", "workers:deploy"], expiresInDays: 90 },
      tk,
    );
    expect(r.status).toBe(201);
    const { url } = await r.json();
    const path = new URL(url).pathname;
    const md = await t.api("GET", path);
    expect(md.headers.get("content-type")).toContain("text/markdown");
    const mdText = await md.text();
    expect(mdText).toContain("Sanad");
    expect(mdText).toContain("/claim");
    expect(mdText).toContain("mcpServers");
    const js = await (await t.api("GET", path, undefined, { accept: "application/json" })).json();
    expect(js.team.slug).toBe("sanad");
    expect(js.invite.scopes).toEqual(["workers:read", "workers:deploy"]);
    expect(js.api.base).toMatch(/\/api$/);
    const claim = await t.api("POST", `${path}/claim`);
    expect(claim.status).toBe(201);
    const k = await claim.json();
    expect(k.key).toMatch(/^marsa_agent_/);
    expect(
      (await t.api("GET", "/api/teams/sanad/workers", undefined, { "x-team-key": k.key })).status,
    ).toBe(200);
    expect((await t.api("POST", `${path}/claim`)).status).toBe(404);
    expect((await t.api("GET", path)).status).toBe(404);
    // Expired after 24 h.
    const r2 = await (
      await t.api(
        "POST",
        "/api/teams/sanad/agent-invites",
        { name: "late", scopes: ["mcp"], expiresInDays: 7 },
        tk,
      )
    ).json();
    t.clock.now += 25 * 3600_000;
    expect((await t.api("POST", `${new URL(r2.url).pathname}/claim`)).status).toBe(404);
    const n = await (await t.api("GET", "/api/teams/sanad/notifications", undefined, tk)).json();
    expect(n.notifications.map((x: { kind: string }) => x.kind)).toContain("agent-invite-claim");
  });
});

describe("0.14.0 notifications and webhooks", () => {
  async function receiver(fail = 0) {
    const got: { headers: IncomingMessage["headers"]; body: string }[] = [];
    let left = fail;
    const srv = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => {
        body += c;
      });
      req.on("end", () => {
        got.push({ headers: req.headers, body });
        if (left > 0) {
          left--;
          res.writeHead(500).end();
        } else res.writeHead(200).end("ok");
      });
    });
    server = srv;
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    return { got, url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/hook` };
  }

  it("signs, delivers, retries; private URLs are refused by default", async () => {
    const { tk, deploy, svc } = await setup({ WEBHOOK_ALLOW_PRIVATE: "true" });
    const rx = await receiver(2);
    const set = await t.api("PUT", "/api/teams/sanad/webhook", { url: rx.url }, tk);
    expect(set.status).toBe(200);
    const { secret } = await set.json();
    expect(secret).toMatch(/^whsec_/);
    expect(await readFile(join(t.dir, "notifications.json"), "utf8")).not.toContain(secret);
    // Deploy -> notification -> webhook (500, 500, then 200: 3 attempts).
    expect((await deploy("api", { code: code(1) })).status).toBe(201);
    await svc.notify.flush();
    expect(rx.got).toHaveLength(3);
    const last = rx.got[2];
    const body = JSON.parse(last?.body ?? "{}");
    expect(body.text).toContain("deployed a new Worker");
    expect(body.content).toBe(body.text);
    expect(body.event).toMatchObject({ kind: "worker-deploy", team: { slug: "sanad" } });
    const ts = last?.headers["x-marsa-timestamp"] as string;
    const want = createHmac("sha256", secret).update(`${ts}.${last?.body}`).digest("hex");
    expect(last?.headers["x-marsa-signature"]).toBe(`sha256=${want}`);
    const hook = await (await t.api("GET", "/api/teams/sanad/webhook", undefined, tk)).json();
    expect(hook.webhook.last).toMatchObject({ ok: true, attempts: 3, status: 200 });
    // Test button.
    const test = await (await t.api("POST", "/api/teams/sanad/webhook/test", undefined, tk)).json();
    expect(test.delivery).toMatchObject({ ok: true, kind: "webhook-test" });
    // Unread count and mark-read.
    const n = await (await t.api("GET", "/api/teams/sanad/notifications", undefined, tk)).json();
    expect(n.unread).toBeGreaterThan(0);
    t.clock.now += 1000;
    await t.api("POST", "/api/teams/sanad/notifications/read", undefined, tk);
    expect(
      (await (await t.api("GET", "/api/teams/sanad/notifications", undefined, tk)).json()).unread,
    ).toBe(0);
  });

  it("refuses private webhook targets without WEBHOOK_ALLOW_PRIVATE; admin sees everything", async () => {
    const { tk, deploy } = await setup();
    for (const url of [
      "http://example.com/x",
      "https://127.0.0.1/x",
      "https://localhost/x",
      "https://10.0.0.5/h",
      "ftp://x.y",
    ]) {
      expect((await t.api("PUT", "/api/teams/sanad/webhook", { url }, tk)).status).toBe(400);
    }
    expect((await deploy("api", { code: code(1) })).status).toBe(201);
    const team = (await (await t.admin("GET", "/teams")).json()).teams[0];
    await t.admin("POST", `/teams/${team.id}/rotate`);
    const a = await (await t.admin("GET", "/notifications")).json();
    const kinds = a.notifications.map((x: { kind: string }) => x.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(["worker-deploy", "team-key-rotate", "cf-token-set"]),
    );
  });

  it("storage alerts fire on change only", async () => {
    const { svc } = await setup();
    let ok = false;
    const health = () => ({
      kind: "x",
      kv: ok ? { ok: true } : { ok: false, status: 401 },
      files: { ok },
    });
    const ticker = new AlertTicker({
      agentKeys: svc.agentKeys,
      notify: svc.notify,
      backend: {} as never,
      probe: async () => health(),
    });
    await ticker.storage();
    await ticker.storage();
    ok = true;
    await ticker.storage();
    const a = await (await t.admin("GET", "/notifications")).json();
    const kinds = a.notifications.map((x: { kind: string }) => x.kind);
    expect(kinds.filter((k: string) => k === "backend-failing")).toHaveLength(1);
    expect(kinds).toContain("backend-ok");
  });
});

describe("0.14.0 pages", () => {
  it("privacy pages, links, versions, agent keys, notification center and bell", async () => {
    const { tk, deploy } = await setup();
    for (const p of ["/privacy", "/ar/privacy"]) {
      const r = await t.api("GET", p);
      expect(r.status).toBe(200);
      const html = await r.text();
      expect(html).toMatch(/PLACEHOLDER|نص مؤقت/);
      expect(html).toContain("AES-256-GCM");
      expect(html).not.toMatch(/ style=|<script>/);
    }
    expect(await (await t.api("GET", "/")).text()).toContain('href="/privacy"');
    expect(await (await t.api("GET", "/ar/login")).text()).toContain('href="/ar/privacy"');
    expect((await deploy("api", { code: code(1) })).status).toBe(201);
    const { b } = await t.signIn(tk["x-team-key"] as string, "/ar");
    const wk = await (await b.get("/ar/team/workers")).text();
    expect(wk).toContain("/ar/team/workers/api/redeploy");
    expect(wk).toContain("/ar/team/workers/api/versions");
    const vp = await (await b.get("/ar/team/workers/api/versions")).text();
    expect(vp).toContain("نزّل الكود");
    expect(vp).not.toMatch(/ style=/);
    // One-click redeploy from the browser.
    const csrf = await b.csrf("/ar/team/workers");
    const rr = await b.post("/ar/team/workers/api/redeploy", { _csrf: csrf });
    expect(rr.status).toBe(303);
    const vp2 = await (await b.get("/ar/team/workers/api/versions")).text();
    expect(vp2).toContain("v2");
    expect(vp2).toContain("ارجع لهذا الإصدار");
    // Agent key from the browser: shown once.
    const ak = await b.post("/ar/team/agents", {
      _csrf: csrf,
      name: "ci",
      scopes: "workers:read",
      expiry: "custom",
      customDays: "45",
    });
    expect(ak.status).toBe(303);
    const flash = await (await b.get(ak.headers.get("location") as string)).text();
    expect(flash).toMatch(/marsa_agent_[A-Za-z0-9_-]{20,}/);
    const again = await (await b.get("/ar/team/agents")).text();
    expect(again).not.toMatch(/marsa_agent_[A-Za-z0-9_-]{20,}/);
    // Bell with an unread count; notification page.
    const np = await (await b.get("/ar/team/notifications")).text();
    expect(np).toMatch(/class="bell has-unread"/);
    expect(np).toContain("أعاد نشر");
    const admin = await t.adminBrowser();
    const ap = await (await admin.get("/admin/notifications")).text();
    expect(ap).toContain('class="bell');
    // Admin overview: worker count sits next to the switch.
    const ov = await (await admin.get("/admin")).text();
    expect(ov).toContain("wk-cell");
  });
});
