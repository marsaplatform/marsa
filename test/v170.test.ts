import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCron, readCrons } from "../src/worker-cron.js";
import { checkWorkerCode } from "../src/worker-validate.js";
import { CF_TOKEN, FakeCfWorkers, ZONE_NAME } from "./fake-cf-workers.js";
import { makeApp } from "./helpers.js";

type App = Awaited<ReturnType<typeof makeApp>>;
let t: App;
afterEach(async () => {
  vi.restoreAllMocks();
  await t?.cleanup();
});

const KEY = "k".repeat(48);
const CODE = `export default { async fetch() { return new Response("hi"); } };`;
const CRON_CODE = `export default { async fetch() { return new Response("hi"); }, async scheduled() {} };`;

async function setup(env: Record<string, string> = {}) {
  const cf = new FakeCfWorkers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  t = await makeApp({ MARSA_SECRETS_KEY: KEY, ...env }, { cfFetch: cf.fetch });
  expect(
    (await t.admin("PUT", "/workers/settings", { token: CF_TOKEN, zone: ZONE_NAME })).status,
  ).toBe(200);
  const a = await t.createTeam("Team Marsa");
  const b = await t.createTeam("Sanad");
  for (const [team, slug] of [
    [a, "marsa"],
    [b, "sanad"],
  ] as const)
    expect(
      (await t.admin("PUT", `/teams/${team.team.id}/workers`, { enabled: true, slug })).status,
    ).toBe(200);
  const put = (slug: string, key: string, name: string, body: unknown, q = "") =>
    t.api("PUT", `/api/teams/${slug}/workers/${name}${q}`, body, { "x-team-key": key });
  const get = (slug: string, key: string, path: string) =>
    t.api("GET", `/api/teams/${slug}${path}`, undefined, { "x-team-key": key });
  return { cf, a, b, put, get };
}
// biome-ignore lint/suspicious/noExplicitAny: test bodies are read loosely
type Json = Record<string, any>;
const j = async (r: Response) => (await r.json()) as Json;

describe("0.17.0 pre-deploy validation", () => {
  it("checks syntax, imports and the default export with esbuild", async () => {
    const fails = async (code: string) => {
      try {
        await checkWorkerCode(code);
        return null;
      } catch (e) {
        return e as { code: string; message: string };
      }
    };
    expect((await checkWorkerCode(CODE)).exports).toContain("default");
    expect(await fails(`const app={fetch(){}};export { app as default };`)).toBeNull();
    expect(await fails(`export default class extends Object {}`)).toBeNull();
    expect(
      await fails(
        `import { connect } from "cloudflare:sockets"; import b from "node:buffer"; export default { fetch(){ return connect && b } };`,
      ),
    ).toBeNull();
    const syn = await fails(`export default { fetch( { };`);
    expect(syn?.code).toBe("SYNTAX_ERROR");
    expect(syn?.message).toMatch(/line \d+/);
    const mod = await fails(`import { Hono } from "hono"; export default new Hono();`);
    expect(mod?.code).toBe("MISSING_MODULE");
    expect(mod?.message).toContain("hono");
    expect((await fails(`export const x = 1;`))?.code).toBe("NOT_A_MODULE");
  });

  it("answers 400 before any Cloudflare call, and maps Cloudflare's 10021 to 400", async () => {
    const { cf, a, put } = await setup();
    const before = cf.calls.length;
    const r = await put("marsa", a.key, "bad", {
      code: `import x from "left-pad"; export default {fetch(){return x}}`,
    });
    expect(r.status).toBe(400);
    expect((await j(r)).error.code).toBe("MISSING_MODULE");
    expect(cf.calls.slice(before).some((c) => c.method === "PUT")).toBe(false);
    cf.failPutScript = true;
    const f = await put("marsa", a.key, "bad", { code: CODE });
    expect(f.status).toBe(400);
    expect((await j(f)).error.code).toBe("VALIDATION_FAILED");
    // the failure is in the team's activity log
    const act = await j(
      await t.api("GET", `/api/teams/marsa/activity?action=worker-deploy-fail`, undefined, {
        "x-team-key": a.key,
      }),
    );
    expect(JSON.stringify(act)).toMatch(/bad: VALIDATION_FAILED/);
    expect(JSON.stringify(act)).not.toContain(CF_TOKEN);
  });
});

describe("0.17.0 deploy jobs", () => {
  it("keeps the synchronous answer, adds health and a job", async () => {
    const { a, put, get } = await setup();
    const r = await put("marsa", a.key, "web", { code: CODE });
    expect(r.status).toBe(201);
    const body = await j(r);
    expect(body.worker.name).toBe("web");
    expect(body.health).toMatchObject({ path: "/", status: 200, ok: true });
    expect(body.job.status).toBe("succeeded");
    const id = r.headers.get("x-marsa-job");
    expect(id).toBe(body.job.id);
    const job = await j(await get("marsa", a.key, `/jobs/${id}`));
    expect(job.job).toMatchObject({ status: "succeeded", done: true, worker: "web", version: 1 });
    const list = await j(await get("marsa", a.key, "/jobs?worker=web"));
    expect(list.jobs).toHaveLength(1);
  });

  it("answers 202 with ?async=1 and Prefer: respond-async; teams do not wait for each other", async () => {
    const { cf, a, b, put, get } = await setup();
    cf.slow.set("team-marsa-slow", 400);
    const r = await put("marsa", a.key, "slow", { code: CODE }, "?async=1");
    expect(r.status).toBe(202);
    const job = (await j(r)).job;
    expect(job.statusUrl).toMatch(/\/api\/teams\/marsa\/jobs\/job_/);
    expect(r.headers.get("location")).toBe(job.statusUrl);
    // Another team deploys right away (its own queue).
    const t0 = Date.now();
    const other = await put("sanad", b.key, "quick", { code: CODE }, "?health=0");
    expect(other.status).toBe(201);
    expect(Date.now() - t0).toBeLessThan(350);
    // The other team cannot read the first team's job.
    expect((await get("sanad", b.key, `/jobs/${job.id}`)).status).toBe(404);
    let st = "";
    for (let i = 0; i < 40 && st !== "succeeded"; i++) {
      await new Promise((res) => setTimeout(res, 50));
      st = (await j(await get("marsa", a.key, `/jobs/${job.id}`))).job.status;
    }
    expect(st).toBe("succeeded");
    // Prefer header, and ?wait=0 also gives a 202 when the deploy is slower than the wait.
    const p = await t.api(
      "PUT",
      "/api/teams/marsa/workers/slow",
      { code: CODE },
      {
        "x-team-key": a.key,
        prefer: "respond-async",
      },
    );
    expect(p.status).toBe(202);
    const w = await put("marsa", a.key, "slow", { code: CODE }, "?wait=0");
    expect(w.status).toBe(202);
    // validation errors are still immediate 400s, and leave no job behind
    const bad = await put("marsa", a.key, "slow", { code: "export default {" }, "?async=1");
    expect(bad.status).toBe(400);
    for (let i = 0; i < 40; i++) {
      const jobs = (await j(await get("marsa", a.key, "/jobs?worker=slow"))).jobs as {
        done: boolean;
      }[];
      if (jobs.every((x) => x.done)) break;
      await new Promise((res) => setTimeout(res, 50));
    }
    const jobs = (await j(await get("marsa", a.key, "/jobs?worker=slow"))).jobs;
    expect(jobs).toHaveLength(3);
  });

  it("records a failed background job with its error", async () => {
    const { cf, a, put, get } = await setup();
    cf.failPutScript = true;
    const r = await put("marsa", a.key, "x1", { code: CODE }, "?async=1");
    expect(r.status).toBe(202);
    const id = (await j(r)).job.id;
    let job: Json = {};
    for (let i = 0; i < 40; i++) {
      job = (await j(await get("marsa", a.key, `/jobs/${id}`))).job;
      if (job.done) break;
      await new Promise((res) => setTimeout(res, 25));
    }
    expect(job).toMatchObject({
      status: "failed",
      error: { status: 400, code: "VALIDATION_FAILED" },
    });
  });
});

describe("0.17.0 cron triggers", () => {
  it("parses and checks crons", () => {
    expect(parseCron("*/30 * * * *").minGapMin).toBe(30);
    expect(parseCron("0 3 * * mon-fri").minGapMin).toBeGreaterThanOrEqual(10);
    expect(() => readCrons(["* * * * *"], 10)).toThrow(/min/);
    expect(() => readCrons(["@daily"], 10)).toThrow();
    expect(() => readCrons(["0 0 * *"], 10)).toThrow();
    expect(readCrons(null, 10)).toEqual([]);
    expect(readCrons(undefined, 10)).toBeUndefined();
    expect(() => readCrons(["0 * * * *", "10 * * * *", "20 * * * *", "30 * * * *"], 10)).toThrow();
  });

  it("sets, keeps, clears, pauses and removes schedules; quotas per team and account", async () => {
    const { cf, a, b, put, get } = await setup();
    const r = await put(
      "marsa",
      a.key,
      "job",
      { code: CRON_CODE, crons: ["*/15 * * * *"] },
      "?health=0",
    );
    expect(r.status).toBe(201);
    expect((await j(r)).worker.crons).toEqual(["*/15 * * * *"]);
    expect(cf.schedules.get("team-marsa-job")).toEqual(["*/15 * * * *"]);
    // a redeploy without crons keeps them
    await put("marsa", a.key, "job", { code: CRON_CODE }, "?health=0");
    expect(cf.schedules.get("team-marsa-job")).toEqual(["*/15 * * * *"]);
    const rt = await j(await get("marsa", a.key, "/workers/job/runtime"));
    expect(rt.runtime.crons).toEqual(["*/15 * * * *"]);
    // too often
    const often = await put("marsa", a.key, "job", { code: CRON_CODE, crons: ["*/2 * * * *"] });
    expect(often.status).toBe(400);
    expect((await j(often)).error.code).toBe("INVALID_CRON");
    // per-team quota (default 2)
    const q = await put("marsa", a.key, "job2", {
      code: CRON_CODE,
      crons: ["0 * * * *", "30 * * * *"],
    });
    expect(q.status).toBe(409);
    expect((await j(q)).error.code).toBe("CRON_QUOTA");
    // account limit: 2 pre-existing + 1 used = 3 of 5; another team asking for 2 more hits it… only with 3
    await t.admin("PUT", `/teams/${b.team.id}/workers`, { maxCrons: 3 });
    const acc = await put("sanad", b.key, "j", {
      code: CRON_CODE,
      crons: ["0 * * * *", "20 * * * *", "40 * * * *"],
    });
    expect(acc.status).toBe(409);
    expect((await j(acc)).error.code).toBe("CRON_ACCOUNT_LIMIT");
    // pre-existing schedules of other scripts are untouched
    expect(cf.schedules.get("erx-mcp")).toEqual(["*/30 * * * *"]);
    // clear with null
    const clr = await put("marsa", a.key, "job", { code: CRON_CODE, crons: null }, "?health=0");
    expect((await j(clr)).worker.crons).toEqual([]);
    expect(cf.schedules.get("team-marsa-job")).toEqual([]);
    // delete removes the schedules
    await put("marsa", a.key, "job", { code: CRON_CODE, crons: ["0 */2 * * *"] }, "?health=0");
    const del = await t.api("DELETE", "/api/teams/marsa/workers/job", undefined, {
      "x-team-key": a.key,
    });
    expect(del.status).toBeLessThan(300);
    expect(cf.schedules.has("team-marsa-job")).toBe(false);
    expect(cf.calls.some((c) => c.method === "PUT" && /erx-mcp|mail-worker/.test(c.path))).toBe(
      false,
    );
  });
});

describe("0.17.0 private KV storage", () => {
  it("creates a namespace bound as STORE, reserves the name, deletes it with the Worker", async () => {
    const { cf, a, put, get } = await setup();
    await t.admin("PUT", `/teams/${a.team.id}/workers`, { maxWorkers: 10 });
    const r = await put("marsa", a.key, "kvw", { code: CODE, storage: "kv" }, "?health=0");
    expect(r.status).toBe(201);
    expect((await j(r)).worker.storage).toBe("kv");
    const ns = [...cf.kvNamespaces].find(([, title]) => title === "marsa-team-marsa-kvw");
    expect(ns).toBeTruthy();
    expect(cf.scripts.get("team-marsa-kvw")?.kv).toEqual({ STORE: ns?.[0] });
    const rt = await j(await get("marsa", a.key, "/workers/kvw/runtime"));
    expect(rt.runtime.storage).toMatchObject({ type: "kv", binding: "STORE", private: true });
    expect(JSON.stringify(rt)).not.toContain(ns?.[0] as string);
    // STORE is reserved
    const clash = await put("marsa", a.key, "kvw", { code: CODE, vars: { STORE: "x" } });
    expect(clash.status).toBe(400);
    // redeploy keeps it
    await put("marsa", a.key, "kvw", { code: CODE }, "?health=0");
    expect(cf.scripts.get("team-marsa-kvw")?.kv).toEqual({ STORE: ns?.[0] });
    // quota (default 3 per team)
    for (const n of ["k2", "k3"])
      expect(
        (await put("marsa", a.key, n, { code: CODE, storage: "kv" }, "?health=0")).status,
      ).toBe(201);
    const over = await put("marsa", a.key, "k4", { code: CODE, storage: "kv" });
    expect(over.status).toBe(409);
    expect((await j(over)).error.code).toBe("KV_QUOTA");
    // turning it off deletes the namespace
    await put("marsa", a.key, "k3", { code: CODE, storage: null }, "?health=0");
    expect([...cf.kvNamespaces.values()]).not.toContain("marsa-team-marsa-k3");
    // deleting the Worker deletes the namespace; other namespaces stay
    await t.api("DELETE", "/api/teams/marsa/workers/kvw", undefined, { "x-team-key": a.key });
    expect(cf.kvNamespaces.has(ns?.[0] as string)).toBe(false);
    expect(cf.kvNamespaces.has("kv_pre")).toBe(true);
  });

  it("explains a token without KV permission", async () => {
    const { cf, a, put } = await setup();
    cf.denied.add("kv");
    const r = await put("marsa", a.key, "kvw", { code: CODE, storage: "kv" });
    expect(r.status).toBe(503);
    expect((await j(r)).error.code).toBe("KV_NOT_PERMITTED");
    expect(cf.scripts.has("team-marsa-kvw")).toBe(false);
  });
});

describe("0.17.0 BIC exception and permission light", () => {
  it("changes nothing without Config Rules permission and reports it", async () => {
    const { cf, a, put } = await setup();
    cf.denied.add("configrules");
    await put("marsa", a.key, "web", { code: CODE }, "?health=0");
    const perms = await j(await t.admin("GET", "/workers/permissions"));
    const light = JSON.stringify(perms);
    expect(light).toContain("Zone · Config Rules: Edit");
    const r = await t.admin("PUT", "/workers/bic", { enabled: true });
    expect(r.status).toBe(403);
    expect((await j(r)).error.code).toBe("BIC_NOT_PERMITTED");
    expect(cf.configRuleset).toBeNull();
    expect(cf.calls.some((c) => c.method !== "GET" && c.path.includes("/rulesets"))).toBe(false);
    const bic = (await j(await t.admin("GET", "/workers/bic"))).bic;
    expect(bic.lastError).toMatch(/Config Rules/);
    expect(bic.enabled).toBe(false);
  });

  it("with the permission, manages only its own rule", async () => {
    const { cf, a, put } = await setup();
    cf.configRuleset = { id: "rs_x", rules: [{ id: "other", ref: "someone", expression: "true" }] };
    await put("marsa", a.key, "web", { code: CODE }, "?health=0");
    const on = await t.admin("PUT", "/workers/bic", { enabled: true });
    expect(on.status).toBe(200);
    const mine = cf.configRuleset.rules.find((r) => r.ref === "marsa_spaces_bic_team_workers");
    expect(mine?.expression).toContain(`marsa-web.${ZONE_NAME}`);
    expect(mine?.action_parameters).toEqual({ bic: false });
    await put("marsa", a.key, "two", { code: CODE }, "?health=0");
    await new Promise((r) => setTimeout(r, 50));
    expect(JSON.stringify(cf.configRuleset.rules)).toContain(`marsa-two.${ZONE_NAME}`);
    await t.admin("PUT", "/workers/bic", { enabled: false });
    expect(cf.configRuleset.rules.map((r) => r.id)).toEqual(["other"]);
  });
});

describe("0.17.0 admin notes", () => {
  it("posts a note to a team (API and form) without notifications", async () => {
    const { a } = await setup();
    const r = await t.admin("POST", "/teams/marsa/notes", {
      severity: "info",
      stage: "deploy",
      message: "Deploy jobs are live.",
    });
    expect(r.status).toBe(201);
    expect((await j(r)).note).toMatchObject({ agent: "platform admin", via: "admin" });
    const mine = await j(
      await t.api("GET", "/api/teams/marsa/notes", undefined, { "x-team-key": a.key }),
    );
    expect(mine.notes[0].message).toBe("Deploy jobs are live.");
    expect(
      (await t.admin("POST", "/teams/nope/notes", { severity: "info", message: "x" })).status,
    ).toBe(404);
    const notif = await j(await t.admin("GET", "/notifications"));
    expect(JSON.stringify(notif)).not.toContain("Deploy jobs are live.");
    const b = await t.adminBrowser();
    const html = await (await b.get("/admin/notes")).text();
    expect(html).toContain('action="/admin/team-notes"');
    const csrf = await b.csrf("/admin/notes");
    const res = await b.post("/admin/team-notes", {
      _csrf: csrf,
      team: a.team.id,
      severity: "suggestion",
      stage: "other",
      category: "platform",
      worker: "news",
      message: "From the form",
    });
    expect(res.status).toBe(303);
    const again = await j(
      await t.api("GET", "/api/teams/marsa/notes", undefined, { "x-team-key": a.key }),
    );
    expect(again.notes.map((n: { message: string }) => n.message)).toContain("From the form");
  });
});
