import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { SiteStore } from "../src/store.js";
import { sweepExpired } from "../src/sweep.js";
import { TeamStore } from "../src/teams.js";
import { MemoryBackend } from "./fake-backend.js";

import { FAKE_CLOUDFLARE } from "./fake-cloudflare.js";

let dir: string;
let clock: number;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "marsa-backend-"));
  clock = Date.parse("2026-01-01T00:00:00Z");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** By default the test site belongs to a team with backend access (the only kind allowed). */
async function setup(
  env: Record<string, string> = {},
  backend: MemoryBackend | null = new MemoryBackend(),
) {
  const config = loadConfig({ DATA_DIR: dir, PUBLIC_URL: "http://marsa.test", ...env });
  const store = new SiteStore(config.dataDir);
  await store.init();
  const teams = new TeamStore(config.dataDir);
  await teams.init();
  const { key: teamKey } = await teams.create("Backend team", true, clock);
  const app = createApp({ config, store, backend, teams, now: () => clock });
  const res = await app.request("/api/sites", {
    method: "POST",
    headers: { "content-type": "application/json", "x-team-key": teamKey },
    body: JSON.stringify({ files: [{ path: "index.html", content: "<h1>x</h1>" }], ttlHours: 1 }),
  });
  const site = (await res.json()) as { id: string; editToken: string };
  const auth = { authorization: `Bearer ${site.editToken}` };
  const put = (key: string, value: unknown, headers: Record<string, string> = auth) =>
    app.request(`/api/sites/${site.id}/kv/${key}`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ value }),
    });
  return { app, store, backend, site, auth, put, config, teams };
}

describe("config", () => {
  it("leaves the backend off when no CLOUDFLARE_* / R2_* is set", () => {
    expect(loadConfig({}).cloudflare).toBeNull();
  });
  it("refuses a partial Cloudflare config with a clear message", () => {
    expect(() => loadConfig({ CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef" })).toThrow(
      /Missing: CLOUDFLARE_API_TOKEN, CLOUDFLARE_KV_NAMESPACE_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY/,
    );
  });
  it("reads a full Cloudflare config with the default bucket and endpoints", () => {
    const cfg = loadConfig(FAKE_CLOUDFLARE).cloudflare;
    expect(cfg).toMatchObject({
      r2Bucket: "marsa-files",
      kvNamespaceId: "example-namespace",
      r2Endpoint: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
      apiBase: "https://api.cloudflare.com/client/v4",
    });
  });
  it("rejects an invalid bucket name", () => {
    expect(() => loadConfig({ ...FAKE_CLOUDFLARE, R2_BUCKET: "Bad_Bucket" })).toThrow(/R2_BUCKET/);
  });
});

describe("without a backend (default)", () => {
  it("still publishes and reports the backend as off", async () => {
    const { app, site } = await setup({}, null);
    expect((await app.request(`/s/${site.id}/`)).status).toBe(200);
    const cfg = (await (await app.request("/api/config")).json()) as {
      backend: { enabled: boolean };
    };
    expect(cfg.backend.enabled).toBe(false);
  });

  it("answers 503 BACKEND_NOT_CONFIGURED on every backend route", async () => {
    const { app, site, auth } = await setup({}, null);
    const calls: [string, string][] = [
      ["GET", "kv"],
      ["GET", "kv/a"],
      ["PUT", "kv/a"],
      ["DELETE", "kv/a"],
      ["GET", "files"],
      ["POST", "files"],
      ["GET", "files/f1"],
      ["DELETE", "files/f1"],
    ];
    for (const [method, path] of calls) {
      const res = await app.request(`/api/sites/${site.id}/${path}`, { method, headers: auth });
      expect(res.status, `${method} ${path}`).toBe(503);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("BACKEND_NOT_CONFIGURED");
      expect(body.error.message).toMatch(/Static publishing works/);
    }
  });

  it("never sends the Cloudflare secrets anywhere", async () => {
    const { app } = await setup(FAKE_CLOUDFLARE);
    for (const path of [
      "/",
      "/api/config",
      "/openapi.json",
      "/llms.txt",
      "/sdk.js",
      "/docs/backend",
    ]) {
      const text = await (await app.request(path)).text();
      expect(text).not.toContain(FAKE_CLOUDFLARE.CLOUDFLARE_API_TOKEN);
      expect(text).not.toContain(FAKE_CLOUDFLARE.R2_SECRET_ACCESS_KEY);
    }
  });
});

describe("llms.txt backend section", () => {
  it("says the backend is off by default", async () => {
    const { app } = await setup({}, null);
    expect(await (await app.request("/llms.txt")).text()).toContain("BACKEND_NOT_CONFIGURED");
  });
  it("describes the KV and files routes when Cloudflare is configured", async () => {
    const { app } = await setup(FAKE_CLOUDFLARE);
    const txt = await (await app.request("/llms.txt")).text();
    expect(txt).toContain("Enabled on this instance");
    expect(txt).toContain("/kv/<key>");
  });
});

describe("KV", () => {
  it("writes with the edit token and reads publicly", async () => {
    const { app, site, put } = await setup();
    expect((await put("score", { n: 3 })).status).toBe(200);
    const got = await app.request(`/api/sites/${site.id}/kv/score`);
    expect(got.headers.get("access-control-allow-origin")).toBe("*");
    expect(await got.json()).toEqual({ key: "score", value: { n: 3 } });
    expect(await (await app.request(`/api/sites/${site.id}/kv`)).json()).toEqual({
      keys: ["score"],
    });
  });

  it("rejects writes without a valid token", async () => {
    const { put } = await setup();
    expect((await put("a", 1, {})).status).toBe(404);
    expect((await put("a", 1, { authorization: "Bearer wrong" })).status).toBe(404);
  });

  it("requires the token for reads when BACKEND_PUBLIC_READ=false", async () => {
    const { app, site, put, auth } = await setup({ BACKEND_PUBLIC_READ: "false" });
    await put("a", 1);
    expect((await app.request(`/api/sites/${site.id}/kv/a`)).status).toBe(404);
    expect((await app.request(`/api/sites/${site.id}/kv/a`, { headers: auth })).status).toBe(200);
  });

  it("enforces key format, value size and key count", async () => {
    const { put } = await setup({ BACKEND_MAX_VALUE_KB: "1", BACKEND_MAX_KEYS: "2" });
    expect((await put("bad key!", 1)).status).toBe(400);
    expect((await put("big", "x".repeat(2000))).status).toBe(413);
    expect((await put("a", 1)).status).toBe(200);
    expect((await put("b", 2)).status).toBe(200);
    expect((await put("a", 9)).status).toBe(200); // overwriting is fine
    const third = await put("c", 3);
    expect(third.status).toBe(413);
    expect(((await third.json()) as { error: { code: string } }).error.code).toBe("TOO_MANY_KEYS");
  });

  it("deletes keys and answers preflight", async () => {
    const { app, site, put, auth } = await setup();
    await put("a", 1);
    expect(
      (await app.request(`/api/sites/${site.id}/kv/a`, { method: "DELETE", headers: auth })).status,
    ).toBe(204);
    expect((await app.request(`/api/sites/${site.id}/kv/a`)).status).toBe(404);
    const pre = await app.request(`/api/sites/${site.id}/kv/a`, { method: "OPTIONS" });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-headers")).toContain("Authorization");
  });

  it("returns 410 once the site expired", async () => {
    const { app, site } = await setup();
    clock += 2 * 3600_000;
    expect((await app.request(`/api/sites/${site.id}/kv`)).status).toBe(410);
  });
});

describe("files", () => {
  it("uploads, lists, serves sandboxed and deletes", async () => {
    const { app, site, auth } = await setup();
    const fd = new FormData();
    fd.append("file", new File(["hello"], "note.txt"));
    const up = await app.request(`/api/sites/${site.id}/files`, {
      method: "POST",
      headers: auth,
      body: fd,
    });
    expect(up.status).toBe(201);
    const { file } = (await up.json()) as { file: { id: string; url: string } };
    expect(file.url).toBe(`http://marsa.test/api/sites/${site.id}/files/${file.id}`);
    const list = (await (await app.request(`/api/sites/${site.id}/files`)).json()) as {
      files: unknown[];
    };
    expect(list.files).toHaveLength(1);
    const get = await app.request(`/api/sites/${site.id}/files/${file.id}`);
    expect(await get.text()).toBe("hello");
    expect(get.headers.get("content-security-policy")).toContain("sandbox");
    const del = await app.request(`/api/sites/${site.id}/files/${file.id}`, {
      method: "DELETE",
      headers: auth,
    });
    expect(del.status).toBe(204);
  });

  it("rejects blocked types and anonymous uploads", async () => {
    const { app, site, auth } = await setup();
    const fd = () => {
      const f = new FormData();
      f.append("file", new File(["x"], "run.sh"));
      return f;
    };
    expect(
      (await app.request(`/api/sites/${site.id}/files`, { method: "POST", body: fd() })).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/sites/${site.id}/files`, {
          method: "POST",
          headers: auth,
          body: fd(),
        })
      ).status,
    ).toBe(415);
  });

  it("can't read another site's file", async () => {
    const { app, backend, site } = await setup();
    const other = await backend?.fileUpload(
      "othersite01",
      "secret.txt",
      new TextEncoder().encode("no"),
      "text/plain",
    );
    expect((await app.request(`/api/sites/${site.id}/files/${other?.id}`)).status).toBe(404);
  });
});

describe("cleanup", () => {
  it("purges backend data when a site is deleted", async () => {
    const { app, backend, site, auth, put } = await setup();
    await put("a", 1);
    await app.request(`/api/sites/${site.id}`, { method: "DELETE", headers: auth });
    expect(backend?.purged).toEqual([site.id]);
    expect(await backend?.kvCount(site.id)).toBe(0);
  });

  it("purges backend data when a site expires", async () => {
    const { store, backend, site, put } = await setup();
    await put("a", 1);
    const removed = await sweepExpired(store, backend, clock + 2 * 3600_000);
    expect(removed).toEqual([site.id]);
    expect(backend?.purged).toEqual([site.id]);
  });
});

describe("sdk.js", () => {
  it("is served with CORS and exposes marsa.kv / marsa.files", async () => {
    const { app } = await setup();
    const res = await app.request("/sdk.js");
    expect(res.headers.get("content-type")).toContain("javascript");
    const js = await res.text();
    expect(js).toContain("window.marsa");
    expect(js).toContain("kv:");
    expect(js).toContain("files:");
  });
});
