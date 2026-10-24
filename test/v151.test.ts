import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readNote, redactSecrets } from "../src/agent-notes.js";
import { RepoChecker } from "../src/repo-status.js";
import { starterFor } from "../src/starters.js";
import { detectFromCode, ProbeCache, readMeta } from "../src/worker-insight.js";
import { CF_TOKEN, FakeCfWorkers, ZONE_NAME } from "./fake-cf-workers.js";
import { makeApp } from "./helpers.js";

type App = Awaited<ReturnType<typeof makeApp>>;
let t: App;
afterEach(async () => {
  vi.restoreAllMocks();
  await t?.cleanup();
});

const KEY = "k".repeat(48);
const GH_TOKEN = "test-github-token-not-real-0123456789";
const MCP_CODE = `const Hono=class{post(){}};const a=new Hono();a.post("/mcp",()=>0);export default{fetch(r){return new Response("Context is not finalized")}};`;
const WEB_CODE = `export default { async fetch() { return new Response("hi"); } };`;

/** A fake GitHub API: public repo "org/pub" (main at sha "b"*40), private "org/priv". */
function fakeGitHub() {
  const seen: { url: string; auth: boolean }[] = [];
  const fn = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const auth = !!new Headers(init?.headers).get("authorization");
    seen.push({ url, auth });
    const j = (s: number, b: unknown) =>
      new Response(JSON.stringify(b), {
        status: s,
        headers: { "content-type": "application/json" },
      });
    if (url.endsWith("/repos/org/pub")) return j(200, { default_branch: "main" });
    if (url.endsWith("/repos/org/pub/commits/main")) return j(200, { sha: "b".repeat(40) });
    if (url.includes("/repos/org/pub/compare/")) return j(200, { status: "ahead", ahead_by: 3 });
    if (url.endsWith("/repos/org/priv"))
      return auth ? j(200, { default_branch: "main" }) : j(404, {});
    if (url.endsWith("/repos/org/priv/commits/main")) return j(200, { sha: "c".repeat(40) });
    return j(404, {});
  };
  return { fn, seen };
}

/** A fake MCP endpoint answering initialize + tools/list. */
const fakeMcp = async (_i: string | URL | Request, init?: RequestInit) => {
  const msg = JSON.parse(String(init?.body ?? "{}"));
  const j = (b: unknown) =>
    new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
  if (msg.method === "initialize")
    return j({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "x", version: "1" },
      },
    });
  if (msg.method === "tools/list")
    return j({
      jsonrpc: "2.0",
      id: msg.id,
      result: { tools: [{ name: "search_items" }, { name: "get_item" }, { name: "list_cities" }] },
    });
  if (msg.method === "tools/call") throw new Error("the probe must never call a tool");
  return new Response(null, { status: 202 });
};

async function setup(env: Record<string, string> = {}) {
  const cf = new FakeCfWorkers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const gh = fakeGitHub();
  const probes = new ProbeCache(fakeMcp as never, () => Date.now());
  const repos = new RepoChecker(gh.fn as never, () => Date.now(), env.GITHUB_TOKEN ?? null);
  t = await makeApp(
    { MARSA_SECRETS_KEY: KEY, ...env },
    { cfFetch: cf.fetch, app: { mcpProbe: probes, repoChecker: repos } },
  );
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
  const put = (slug: string, key: string, name: string, body: unknown) =>
    t.api("PUT", `/api/teams/${slug}/workers/${name}`, body, { "x-team-key": key });
  return { cf, a, b, put, gh, probes, repos };
}

describe("0.15.1 starter template", () => {
  it("serves a valid zip and a tree, and the recipe page links it", async () => {
    t = await makeApp();
    const st = await starterFor("mcp-server-on-worker");
    expect(st).not.toBeNull();
    const zip = await t.api("GET", "/api/recipes/mcp-server-on-worker/starter.zip");
    expect(zip.status).toBe(200);
    expect(zip.headers.get("content-type")).toBe("application/zip");
    const buf = Buffer.from(await zip.arrayBuffer());
    expect(buf.subarray(0, 4).toString("hex")).toBe("504b0304");
    const dir = await mkdtemp(join(tmpdir(), "starter-"));
    try {
      await writeFile(join(dir, "s.zip"), buf);
      const out = execFileSync("unzip", ["-t", join(dir, "s.zip")]).toString();
      expect(out).toMatch(/No errors detected/);
      for (const f of [
        "src/index.ts",
        "src/mcp/server.ts",
        "src/lib/http.ts",
        "scripts/deploy.ts",
        "README.ar.md",
        "test/mcp.test.ts",
      ])
        expect(out).toContain(f);
      expect(out).not.toMatch(/node_modules|\.env\s|dist\//);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    const tree = (
      (await (await t.api("GET", "/api/recipes/mcp-server-on-worker/starter")).json()) as {
        starter: { tree: string; zip: string };
      }
    ).starter;
    expect(tree.tree).toMatch(/src\/|├──/);
    expect(tree.zip).toMatch(/starter\.zip$/);
    expect((await t.api("GET", "/api/recipes/site-kv-and-files/starter.zip")).status).toBe(404);
    const page = await (await t.api("GET", "/ar/docs/recipes/mcp-server-on-worker")).text();
    expect(page).toContain("starter-box");
    expect(page).toContain("/api/recipes/mcp-server-on-worker/starter.zip");
    expect(page).toContain("notes-callout");
    expect(page).toMatch(/Hono/);
    for (const slug of ["python-mcp-self-hosted", "agent-notes", "bilingual-project-page"])
      expect((await t.api("GET", `/ar/docs/recipes/${slug}`)).status).toBe(200);
  });

  it("puts Start here, the starter and the top 10 rules in the invite onboarding", async () => {
    const { inviteOnboarding, onboardingMarkdown, TOP_RULES } = await import(
      "../src/agent-routes.js"
    );
    t = await makeApp();
    const o = inviteOnboarding(
      t.config,
      { id: "t_1", name: "X", slug: "x" } as never,
      {
        name: "a",
        description: "",
        scopes: ["spaces:read"],
        keyDays: 30,
        expiresAt: "2026-02-01T00:00:00Z",
      } as never,
      "tok",
    );
    expect(TOP_RULES).toHaveLength(10);
    expect(o.startHere.starter).toMatch(/starter\.zip$/);
    expect(o.startHere.notes.url).toMatch(/\/api\/teams\/x\/notes$/);
    const md = onboardingMarkdown(o);
    expect(md).toMatch(/## Start here/);
    expect(md).toMatch(/10\. Hit a problem/);
    expect(md).toContain("TypeScript + Hono");
  });
});

describe("0.15.1 worker insight", () => {
  it("validates declared meta and detects MCP/Hono from code", () => {
    expect(readMeta({ kind: "site", language: "ts", framework: "hono", toolsCount: 3 })).toEqual({
      kind: "web",
      language: "typescript",
      framework: "hono",
      toolsCount: 3,
    });
    for (const bad of [
      { kind: "x" },
      { toolsCount: -1 },
      { toolsCount: 501 },
      { secret: 1 },
      { language: "go" },
      "mcp",
    ])
      expect(() => readMeta(bad)).toThrow();
    const d = detectFromCode(MCP_CODE);
    expect(d).toMatchObject({ kind: "mcp", framework: "hono", mcp: true });
    expect(detectFromCode(WEB_CODE).kind).toBe("web");
    expect(detectFromCode("").kind).toBe("other");
  });

  it("probes initialize + tools/list only, and caches per version", async () => {
    const calls: string[] = [];
    const p = new ProbeCache(
      (async (i: string, init?: RequestInit) => {
        calls.push(JSON.parse(String(init?.body ?? "{}")).method);
        return fakeMcp(i, init);
      }) as never,
      () => Date.now(),
    );
    const r = await p.refresh("w1", 1, "https://x/mcp");
    expect(r.tools).toEqual(["search_items", "get_item", "list_cities"]);
    expect(calls).not.toContain("tools/call");
    expect(p.fresh("w1", 1)).toBe(true);
    expect(p.fresh("w1", 2)).toBe(false);
  });

  it("deploys with meta/repo, shows Type/Stack/Tools/Repo columns, filters and the MCP servers pages per team", async () => {
    const { a, b, put } = await setup();
    const ok = await put("sanad", b.key, "news", {
      code: MCP_CODE,
      meta: { kind: "mcp", language: "typescript", framework: "hono", toolsCount: 2 },
      repo: { url: "https://github.com/org/pub", branch: "main", commitSha: "a".repeat(40) },
    });
    expect(ok.status).toBe(201);
    const w = ((await ok.json()) as { worker: Record<string, unknown> }).worker;
    expect(w.meta).toMatchObject({ kind: "mcp", toolsCount: 2 });
    expect(w.repo).toMatchObject({ url: "https://github.com/org/pub", branch: "main" });
    expect(
      (await put("sanad", b.key, "bad", { code: WEB_CODE, meta: { kind: "zzz" } })).status,
    ).toBe(400);
    expect(
      (await put("sanad", b.key, "bad", { code: WEB_CODE, repo: { url: "http://github.com/x/y" } }))
        .status,
    ).toBe(400);
    expect(
      (
        await put("sanad", b.key, "bad", {
          code: WEB_CODE,
          repo: { url: "https://u:p@github.com/x/y" },
        })
      ).status,
    ).toBe(400);
    expect((await put("sanad", b.key, "site", { code: WEB_CODE })).status).toBe(201);
    expect((await put("marsa", a.key, "atlas", { code: MCP_CODE })).status).toBe(201);
    // Links: cross-team space refused, a space of the team accepted.
    const mine = (await (await t.publish(b.key)).json()) as { id: string };
    const theirs = (await (await t.publish(a.key)).json()) as { id: string };
    const links = (body: unknown, key = b.key) =>
      t.api("POST", "/api/teams/sanad/workers/news/links", body, { "x-team-key": key });
    expect((await links({ spaceId: theirs.id })).status).toBe(400);
    expect((await links({ spaceId: mine.id })).status).toBe(200);
    expect((await links({ spaceId: mine.id }, a.key)).status).toBe(404);
    // Admin pages.
    const adm = await t.adminBrowser();
    await new Promise((r) => setTimeout(r, 20)); // background repo check
    const wl = await (await adm.get("/admin/workers")).text();
    expect(wl).toContain('data-dt-f="kind"');
    expect(wl).toMatch(/MCP server/);
    expect(wl).toMatch(/TypeScript \+ Hono/);
    expect(wl).toContain("org/pub");
    const mcpAdmin = await (await adm.get("/ar/admin/mcp")).text();
    expect(mcpAdmin).toContain("خوادم MCP");
    expect(mcpAdmin).toContain("sanad-news.");
    expect(mcpAdmin).toContain("marsa-atlas.");
    expect(mcpAdmin).not.toMatch(/>site</);
    // Team page: only its own MCP servers.
    const { b: tb } = await t.signIn(b.key);
    const mcpTeam = await (await tb.get("/team/mcp")).text();
    expect(mcpTeam).toContain("sanad-news.");
    expect(mcpTeam).not.toContain("marsa-atlas");
    expect(mcpTeam).toContain("/team/workers/news?tab=keys");
    const detail = await (await tb.get("/team/workers/news")).text();
    expect(detail).toMatch(/TypeScript \+ Hono/);
    const settings = await (await tb.get("/team/workers/news?tab=settings")).text();
    expect(settings).toContain('action="/team/workers/news/links"');
  });

  it("checks repos read-only: public/behind, private with and without a token, never prints the token", async () => {
    const gh = fakeGitHub();
    const anon = new RepoChecker(gh.fn as never, () => Date.now(), null);
    const pub = await anon.check({
      url: "https://github.com/org/pub",
      branch: "main",
      commitSha: "a".repeat(40),
    });
    expect(pub).toMatchObject({ visibility: "public", sync: "behind", behindBy: 3 });
    const synced = await anon.check({
      url: "https://github.com/org/pub",
      branch: "main",
      commitSha: "bbbbbbb",
    });
    expect(synced.sync).toBe("synced");
    expect(await anon.check({ url: "https://github.com/org/priv" })).toMatchObject({
      visibility: "private",
      visibilityConfirmed: false,
    });
    expect(gh.seen.every((s) => !s.auth)).toBe(true);
    const withTok = new RepoChecker(gh.fn as never, () => Date.now(), GH_TOKEN);
    expect(await withTok.check({ url: "https://github.com/org/priv" })).toMatchObject({
      visibility: "private",
      visibilityConfirmed: true,
    });
    expect(await withTok.check({ url: "https://github.com/org/gone" })).toMatchObject({
      visibility: "not-found",
      visibilityConfirmed: true,
    });
    // In the app: the token never reaches a page.
    const { b, put } = await setup({ GITHUB_TOKEN: GH_TOKEN });
    expect(
      (
        await put("sanad", b.key, "news", {
          code: MCP_CODE,
          repo: { url: "https://github.com/org/priv" },
        })
      ).status,
    ).toBe(201);
    const adm = await t.adminBrowser();
    for (const p of ["/admin/workers", "/admin/mcp", "/admin/settings"]) {
      const html = await (await adm.get(p)).text();
      expect(html).not.toContain(GH_TOKEN);
    }
  });

  it("lets a team link a repo to a space (form and API), shown in the spaces tables", async () => {
    const { b } = await setup();
    const site = (await (await t.publish(b.key)).json()) as { id: string; editToken: string };
    const r = await t.api(
      "PATCH",
      `/api/sites/${site.id}`,
      { repo: { url: "https://github.com/org/pub", branch: "main" } },
      { authorization: `Bearer ${site.editToken}` },
    );
    expect(r.status).toBe(200);
    const { b: tb } = await t.signIn(b.key);
    const list = await (await tb.get("/team/sites")).text();
    expect(list).toContain("org/pub");
    const page = `/team/sites/${site.id}?tab=settings`;
    const csrf = await tb.csrf(page);
    expect(
      (
        await tb.post(`/team/sites/${site.id}/repo`, {
          _csrf: csrf,
          repoUrl: "javascript:alert(1)",
        })
      ).status,
    ).toBe(303);
    expect((await t.store.get(site.id))?.repo?.url).toBe("https://github.com/org/pub");
    await tb.post(`/team/sites/${site.id}/repo`, { _csrf: csrf, repoUrl: "" });
    expect((await t.store.get(site.id))?.repo).toBeUndefined();
  });
});

describe("0.15.1 agent notes", () => {
  it("validates, strips secrets and control characters", () => {
    expect(() => readNote({ severity: "bug" }, "k")).toThrow(/message/);
    expect(() => readNote({ severity: "urgent", message: "x" }, "k")).toThrow(/severity/);
    expect(() => readNote({ severity: "bug", message: "x", stage: "prod" }, "k")).toThrow(/stage/);
    expect(() =>
      readNote({ severity: "bug", message: "x", target: { type: "db", id: "x" } }, "k"),
    ).toThrow(/target/);
    expect(() => readNote({ severity: "bug", message: "x", extra: 1 }, "k")).toThrow(
      /not supported/,
    );
    const n = readNote(
      {
        severity: "bug",
        message: `token=abc123456789 key marsa_agent_${"z".repeat(20)} \u202Eevil\u0000`,
      },
      "k",
    );
    expect(n.message).not.toContain("abc123456789");
    expect(n.message).not.toContain("marsa_agent_");
    expect(n.message.includes("\u202E") || n.message.includes("\u0000")).toBe(false);
    expect(n.redacted).toBe(true);
    expect(redactSecrets(`commit ${"a".repeat(40)} في الوركر`).redacted).toBe(false);
  });

  it("stores notes from team and agent keys, rate-limits, rings the bell on blockers, admin triages and replies", async () => {
    const { a, b } = await setup();
    const post = (slug: string, key: string, body: unknown) =>
      t.api("POST", `/api/teams/${slug}/notes`, body, { "x-team-key": key });
    const r1 = await post("sanad", b.key, {
      severity: "blocker",
      stage: "deploy",
      category: "bindings",
      message: "<script>alert(1)</script> 522 calling news",
      target: { type: "worker", id: "morassel" },
      version: "4",
      agent: "sanad-agent",
    });
    expect(r1.status).toBe(201);
    const n1 = ((await r1.json()) as { note: { id: string; status: string; agent: string } }).note;
    expect(n1).toMatchObject({ status: "open", agent: "sanad-agent" });
    expect((await post("marsa", b.key, { severity: "info", message: "x" })).status).toBe(404);
    expect((await post("sanad", "nope", { severity: "info", message: "x" })).status).toBe(401);
    expect((await post("sanad", b.key, { severity: "info" })).status).toBe(400);
    expect(
      (await post("sanad", b.key, { severity: "info", message: "x".repeat(20000) })).status,
    ).toBe(413);
    // An agent key with only spaces:read can still leave a note.
    const ak = await t.api(
      "POST",
      "/api/teams/sanad/agent-keys",
      { name: "reader", scopes: ["spaces:read"], expiresInDays: 7 },
      { "x-team-key": b.key },
    );
    expect(ak.status).toBe(201);
    const secret = ((await ak.json()) as { secret: string }).secret;
    const r2 = await post("sanad", secret, {
      severity: "suggestion",
      stage: "recipe",
      message: "recipe step 3 unclear",
      target: { type: "recipe", id: "mcp-server-on-worker" },
    });
    expect(r2.status).toBe(201);
    expect(((await r2.json()) as { note: { agent: string } }).note.agent).toBe("agent key reader");
    // Rate limit: 30 per hour per key.
    let last = 0;
    for (let i = 0; i < 31; i++)
      last = (await post("marsa", a.key, { severity: "info", message: `n${i}` })).status;
    expect(last).toBe(429);
    // Bell.
    const notes = await t.admin("GET", "/notifications");
    const bell = JSON.stringify(await notes.json());
    expect(bell).toMatch(/agent-note-blocker/);
    // Admin page: escaped, filters, mark resolved + reply.
    const adm = await t.adminBrowser();
    const page = await (await adm.get("/ar/admin/notes")).text();
    expect(page).toContain("ملاحظات الوكلاء");
    expect(page).not.toContain("<script>alert(1)</script>");
    expect(page).toMatch(/(&lt;|&#60;)script(&gt;|&#62;)alert/);
    for (const f of ["severity", "stage", "team"]) expect(page).toContain(`data-dt-f="${f}"`);
    const csrf = await adm.csrf("/admin/notes");
    expect(
      (await adm.post(`/admin/notes/${n1.id}`, { _csrf: csrf, status: "resolved" })).status,
    ).toBe(303);
    expect(
      (
        await adm.post(`/admin/notes/${n1.id}`, {
          _csrf: csrf,
          reply: "Use a service binding: see the recipe.",
        })
      ).status,
    ).toBe(303);
    const api = (await (await t.admin("GET", "/notes?status=resolved")).json()) as {
      notes: { id: string }[];
    };
    expect(api.notes.map((n) => n.id)).toEqual([n1.id]);
    // The team sees its own notes and the reply, not other teams'.
    const own = (await (
      await t.api("GET", "/api/teams/sanad/notes", undefined, { "x-team-key": b.key })
    ).json()) as { notes: { id: string; reply: { text: string } | null }[] };
    expect(own.notes).toHaveLength(2);
    expect(own.notes.find((n) => n.id === n1.id)?.reply?.text).toMatch(/service binding/);
    const { b: tb } = await t.signIn(b.key);
    const tp = await (await tb.get("/team/notes")).text();
    expect(tp).toContain("service binding");
    expect(tp).not.toContain("n29");
    expect(tp).not.toContain(`/admin/notes/${n1.id}`);
    // Team members cannot triage.
    await tb.post(`/admin/notes/${n1.id}`, { _csrf: csrf, status: "open" });
    const after = (await (await t.admin("GET", "/notes")).json()) as {
      notes: { id: string; status: string }[];
    };
    expect(after.notes.find((n) => n.id === n1.id)?.status).toBe("resolved");
  });
});
