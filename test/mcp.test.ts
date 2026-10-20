import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { BASE, HOUR, makeApp } from "./helpers.js";

type App = Awaited<ReturnType<typeof makeApp>>;
let t: App;
afterEach(async () => {
  await t?.cleanup();
});
type Site = { id: string; editToken: string };

/** An SDK client wired straight into the in-process app (no network). */
async function connect(app: App, siteId: string, token: string) {
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp/s/${siteId}`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: (url, init) => app.app.request(String(url), init as RequestInit) as Promise<Response>,
  });
  const client = new Client({ name: "marsa-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

type CallResult = { content: { type: string; text: string }[]; isError?: boolean };
const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => {
  const r = (await c.callTool({ name, arguments: args })) as CallResult;
  const text = r.content[0]?.text ?? "";
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return { isError: !!r.isError, text, data: data as Record<string, unknown> };
};

/** Publish a site for a team and create an MCP token through the dashboard. */
async function setup(app: App, flags: Record<string, unknown> = {}, scope = "ro") {
  const team = await app.createTeam("MCP team", flags);
  const site = (await (
    await app.publish(team.key, "<title>Hello</title><h1>Hi</h1>", "", [
      { path: "notes.txt", content: "line one" },
    ])
  ).json()) as Site;
  const { b } = await app.signIn(team.key);
  const page = `/team/sites/${site.id}`;
  const csrf = await b.csrf(page);
  const res = await b.post(`${page}/mcp`, { _csrf: csrf, name: "Laptop", scope });
  expect(res.status).toBe(303);
  const loc = res.headers.get("location") ?? "";
  expect(loc).toMatch(/\?f=[^#]+#mcp$/);
  const html = await (await b.get(new URL(loc, BASE).pathname + new URL(loc, BASE).search)).text();
  const secret = /marsa_mcp_[A-Za-z0-9_-]{20,}/.exec(html)?.[0];
  if (!secret) throw new Error("no token shown");
  return { team, site, b, page, secret };
}

describe("MCP per space", () => {
  it("creates tokens on the site page, shows them once and stores only a hash", async () => {
    t = await makeApp();
    const { site, b, page, secret } = await setup(t);
    const again = await (await b.get(page)).text();
    expect(again).not.toContain(secret);
    expect(again).toContain("Laptop");
    expect(again).toContain(`${BASE}/mcp/s/${site.id}`);
    expect(again).toContain("Bearer marsa_mcp_…");
    expect(again).toContain("claude mcp add --transport http");
    const raw = await readFile(join(t.dir, "sites", site.id, "meta.json"), "utf8");
    expect(raw).not.toContain(secret);
    expect(raw).toContain("mcpTokens");
    // Never exposed through the API.
    const pub = await (await t.api("GET", `/api/sites/${site.id}`)).text();
    expect(pub).not.toContain("mcpTokens");
    expect(pub).not.toContain(secret.slice(0, 16));
  });

  it("serves read-only tools to a ro token via the official SDK", async () => {
    t = await makeApp();
    const { site, secret } = await setup(t);
    const c = await connect(t, site.id, secret);
    expect(c.getServerVersion()?.name).toBe("marsa-spaces");
    const names = (await c.listTools()).tools.map((x) => x.name).sort();
    expect(names).toEqual(["get_site_info", "list_files", "read_file"]);
    const info = await call(c, "get_site_info");
    expect(info.data.id).toBe(site.id);
    expect(info.data.title).toBe("Hello");
    const files = await call(c, "list_files");
    expect(JSON.stringify(files.data)).toContain("notes.txt");
    expect((await call(c, "read_file", { path: "notes.txt" })).text).toContain("line one");
    expect((await call(c, "read_file", { path: "../../teams.json" })).isError).toBe(true);
    const w = await call(c, "replace_site_files", {
      files: [{ path: "index.html", content: "x" }],
    });
    expect(w.isError).toBe(true);
    expect(w.text).toMatch(/read-only/);
    await c.close();
  });

  it("lets a rw token on a backend team edit KV, uploads and the published files", async () => {
    t = await makeApp();
    const { site, secret } = await setup(t, { backend: true }, "rw");
    const c = await connect(t, site.id, secret);
    const names = (await c.listTools()).tools.map((x) => x.name);
    for (const n of ["kv_put", "kv_delete", "upload_file", "delete_file", "replace_site_files"]) {
      expect(names).toContain(n);
    }
    expect((await call(c, "kv_put", { key: "score", value: { n: 3 } })).isError).toBe(false);
    expect((await call(c, "kv_get", { key: "score" })).data.value).toEqual({ n: 3 });
    expect((await call(c, "kv_list")).data.keys).toEqual(["score"]);
    expect((await call(c, "kv_delete", { key: "score" })).data.deleted).toBe(true);
    expect((await call(c, "kv_get", { key: "score" })).isError).toBe(true);
    expect((await call(c, "kv_put", { key: "bad key!", value: 1 })).isError).toBe(true);

    const up = await call(c, "upload_file", { name: "a.txt", content: "aGk=", encoding: "base64" });
    expect(up.isError).toBe(false);
    const fid = String(up.data.id);
    expect(JSON.stringify((await call(c, "list_uploads")).data)).toContain(fid);
    expect((await call(c, "delete_file", { id: fid })).data.deleted).toBe(true);
    expect((await call(c, "upload_file", { name: "x.exe", content: "MZ" })).isError).toBe(true);

    const rep = await call(c, "replace_site_files", {
      files: [{ path: "index.html", content: "<title>New</title><p>v2</p>" }],
    });
    expect(rep.isError).toBe(false);
    expect(rep.data.title).toBe("New");
    expect(await (await t.app.request(`/s/${site.id}/`)).text()).toContain("v2");
    // The token survives a replace.
    expect((await call(c, "get_site_info")).data.title).toBe("New");
    await c.close();
  });

  it("hides backend tools for teams without the backend", async () => {
    t = await makeApp();
    const { site, secret } = await setup(t, {}, "rw");
    const c = await connect(t, site.id, secret);
    const names = (await c.listTools()).tools.map((x) => x.name).sort();
    expect(names).toEqual(["get_site_info", "list_files", "read_file", "replace_site_files"]);
    expect((await call(c, "kv_put", { key: "a", value: 1 })).text).toMatch(/BACKEND_NOT_ALLOWED/);
    await c.close();
  });

  it("rejects bad auth, origins, versions and methods", async () => {
    t = await makeApp();
    const { site, secret, b, page } = await setup(t);
    const other = (await (await t.publish(null)).json()) as Site;
    const init = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "x", version: "1" },
      },
    };
    const post = (id: string, body: unknown, h: Record<string, string> = {}) =>
      t.app.request(`/mcp/s/${id}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${secret}`,
          ...h,
        },
        body: JSON.stringify(body),
      });
    const okRes = await post(site.id, init);
    expect(okRes.status).toBe(200);
    expect(
      ((await okRes.json()) as { result: { protocolVersion: string } }).result.protocolVersion,
    ).toBe("2025-06-18");
    expect((await post(site.id, init, { authorization: "" })).status).toBe(401);
    expect((await post(site.id, init, { authorization: "Bearer marsa_mcp_nope" })).status).toBe(
      401,
    );
    expect((await post(other.id, init)).status).toBe(401);
    expect((await post(site.id, init, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post(site.id, init, { "mcp-protocol-version": "1999-01-01" })).status).toBe(400);
    expect(
      (await post(site.id, { jsonrpc: "2.0", method: "notifications/initialized" })).status,
    ).toBe(202);
    const unk = (await (await post(site.id, { jsonrpc: "2.0", id: 2, method: "nope" })).json()) as {
      error: { code: number };
    };
    expect(unk.error.code).toBe(-32601);
    expect((await post(site.id, [init])).status).toBe(400);
    expect(
      (await t.app.request(`/mcp/s/${site.id}`, { headers: { authorization: `Bearer ${secret}` } }))
        .status,
    ).toBe(405);

    // Revoke from the site page: the token stops working at once.
    const html = await (await b.get(page)).text();
    const tid = /\/mcp\/([a-z0-9]+)\/delete/.exec(html)?.[1];
    expect(tid).toBeTruthy();
    const csrf = await b.csrf(page);
    expect((await b.post(`${page}/mcp/${tid}/delete`, { _csrf: csrf })).status).toBe(303);
    expect((await post(site.id, init)).status).toBe(401);
  });

  it("stops working when the space expires", async () => {
    t = await makeApp();
    const { site, secret } = await setup(t);
    const c = await connect(t, site.id, secret);
    await c.close();
    t.clock.now += 400 * HOUR;
    await expect(connect(t, site.id, secret)).rejects.toThrow();
    expect(site.id).toBeTruthy();
  });

  it("rate-limits requests and writes per token", async () => {
    t = await makeApp({ MCP_REQUESTS_PER_MINUTE: "4", MCP_WRITES_PER_HOUR: "1" });
    const { site, secret } = await setup(t, { backend: true }, "rw");
    const c = await connect(t, site.id, secret); // initialize (+ notification) = 2
    expect((await call(c, "kv_put", { key: "a", value: 1 })).isError).toBe(false); // 3
    expect((await call(c, "kv_put", { key: "b", value: 1 })).text).toMatch(/RATE_LIMITED/); // 4
    await expect(call(c, "get_site_info")).rejects.toThrow(); // 5 -> HTTP 429
    await c.close();
  });

  it("documents MCP at /docs/mcp and in llms.txt", async () => {
    t = await makeApp();
    const doc = await (await t.app.request("/docs/mcp")).text();
    expect(doc).toContain(`${BASE}/mcp/s/`);
    expect(await (await t.app.request("/llms.txt")).text()).toContain("/mcp/s/<siteId>");
  });

  it("caps tokens per space at 10", async () => {
    t = await makeApp();
    const { b, page } = await setup(t);
    for (let i = 0; i < 9; i++) {
      await b.post(`${page}/mcp`, { _csrf: await b.csrf(page), name: `t${i}`, scope: "ro" });
    }
    const r = await b.post(`${page}/mcp`, {
      _csrf: await b.csrf(page),
      name: "extra",
      scope: "ro",
    });
    const loc = new URL(r.headers.get("location") ?? "", BASE);
    const html = await (await b.get(loc.pathname + loc.search)).text();
    expect(html).toContain("at most 10 MCP tokens");
    expect(html).not.toContain(">extra<");
  });
});
