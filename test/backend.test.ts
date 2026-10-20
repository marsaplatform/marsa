import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import {
  AppwriteBackend,
  kvRowId,
  type StorageApi,
  type TablesApi,
} from "../src/backend/appwrite.js";
import { type AppwriteConfig, loadConfig } from "../src/config.js";
import { SiteStore } from "../src/store.js";
import { sweepExpired } from "../src/sweep.js";
import { MemoryBackend } from "./fake-backend.js";

// Placeholder values only; nothing here talks to a real Appwrite.
const FAKE_APPWRITE = {
  APPWRITE_ENDPOINT: "https://appwrite.example.com/v1",
  APPWRITE_PROJECT_ID: "example-project",
  APPWRITE_API_KEY: "example-api-key-not-real",
  APPWRITE_DATABASE_ID: "example-db",
};

let dir: string;
let clock: number;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "marsa-backend-"));
  clock = Date.parse("2026-01-01T00:00:00Z");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function setup(
  env: Record<string, string> = {},
  backend: MemoryBackend | null = new MemoryBackend(),
) {
  const config = loadConfig({ DATA_DIR: dir, PUBLIC_URL: "http://marsa.test", ...env });
  const store = new SiteStore(config.dataDir);
  await store.init();
  const app = createApp({ config, store, backend, now: () => clock });
  const res = await app.request("/api/sites", {
    method: "POST",
    headers: { "content-type": "application/json" },
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
  return { app, store, backend, site, auth, put, config };
}

describe("config", () => {
  it("leaves the backend off when no APPWRITE_* is set", () => {
    expect(loadConfig({}).appwrite).toBeNull();
  });
  it("refuses a partial Appwrite config with a clear message", () => {
    expect(() => loadConfig({ APPWRITE_ENDPOINT: "https://appwrite.example.com/v1" })).toThrow(
      /Missing: APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID/,
    );
  });
  it("reads a full Appwrite config with default table and bucket ids", () => {
    const cfg = loadConfig(FAKE_APPWRITE).appwrite;
    expect(cfg).toMatchObject({
      kvTableId: "marsa_kv",
      bucketId: "marsa_files",
      projectId: "example-project",
    });
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

  it("never sends the Appwrite key anywhere", async () => {
    const { app } = await setup(FAKE_APPWRITE);
    for (const path of [
      "/",
      "/api/config",
      "/openapi.json",
      "/llms.txt",
      "/sdk.js",
      "/docs/backend",
    ]) {
      expect(await (await app.request(path)).text()).not.toContain(FAKE_APPWRITE.APPWRITE_API_KEY);
    }
  });
});

describe("llms.txt backend section", () => {
  it("says the backend is off by default", async () => {
    const { app } = await setup({}, null);
    expect(await (await app.request("/llms.txt")).text()).toContain("BACKEND_NOT_CONFIGURED");
  });
  it("describes the KV and files routes when Appwrite is configured", async () => {
    const { app } = await setup(FAKE_APPWRITE);
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

describe("AppwriteBackend (mocked node-appwrite)", () => {
  const cfg = loadConfig(FAKE_APPWRITE).appwrite as AppwriteConfig;
  const notFound = Object.assign(new Error("not found"), { code: 404 });

  function mocks() {
    const tables = {
      getRow: vi.fn(),
      upsertRow: vi.fn(async () => ({})),
      deleteRow: vi.fn(async () => ({})),
      listRows: vi.fn(async () => ({ total: 0, rows: [] })),
      deleteRows: vi.fn(async () => ({ total: 0, rows: [] })),
    };
    const storage = {
      createFile: vi.fn(async (p: { fileId: string }) => ({
        $id: p.fileId,
        name: "site1/a.png",
        sizeOriginal: 3,
        $createdAt: "2026-01-01T00:00:00.000Z",
      })),
      getFile: vi.fn(),
      getFileDownload: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
      deleteFile: vi.fn(async () => ({})),
      listFiles: vi.fn(async () => ({ total: 0, files: [] })),
    };
    const backend = new AppwriteBackend(cfg, {
      tables: tables as unknown as TablesApi,
      storage: storage as unknown as StorageApi,
    });
    return { tables, storage, backend };
  }

  it("uses a deterministic 36-char row id per site+key", () => {
    expect(kvRowId("site1", "a")).toHaveLength(36);
    expect(kvRowId("site1", "a")).toBe(kvRowId("site1", "a"));
    expect(kvRowId("site1", "a")).not.toBe(kvRowId("site2", "a"));
  });

  it("upserts rows with siteId, key and JSON value", async () => {
    const { tables, backend } = mocks();
    await backend.kvSet("site1", "a", '{"n":1}');
    expect(tables.upsertRow).toHaveBeenCalledWith({
      databaseId: "example-db",
      tableId: "marsa_kv",
      rowId: kvRowId("site1", "a"),
      data: { siteId: "site1", key: "a", value: '{"n":1}' },
    });
  });

  it("maps Appwrite 404s to 'missing'", async () => {
    const { tables, storage, backend } = mocks();
    tables.getRow.mockRejectedValueOnce(notFound);
    expect(await backend.kvGet("site1", "a")).toBeUndefined();
    tables.deleteRow.mockRejectedValueOnce(notFound);
    expect(await backend.kvDelete("site1", "a")).toBe(false);
    storage.getFile.mockRejectedValueOnce(notFound);
    expect(await backend.fileGet("site1", "f1")).toBeNull();
  });

  it("names files <siteId>/<name> and refuses other sites' files", async () => {
    const { storage, backend } = mocks();
    const f = await backend.fileUpload("site1", "a.png", new Uint8Array([1, 2, 3]), "image/png");
    expect(f).toMatchObject({ name: "a.png", mime: "image/png", size: 3 });
    storage.getFile.mockResolvedValueOnce({
      $id: "f1",
      name: "site2/x.txt",
      sizeOriginal: 1,
      $createdAt: "",
    });
    expect(await backend.fileGet("site1", "f1")).toBeNull();
    expect(storage.getFileDownload).not.toHaveBeenCalled();
  });

  it("purges a site's rows and files", async () => {
    const { tables, storage, backend } = mocks();
    storage.listFiles.mockResolvedValueOnce({
      total: 2,
      files: [
        { $id: "f1", name: "site1/a.txt", sizeOriginal: 1, $createdAt: "" },
        { $id: "f2", name: "site1/b.txt", sizeOriginal: 1, $createdAt: "" },
      ],
    } as never);
    await backend.purgeSite("site1");
    expect(tables.deleteRows).toHaveBeenCalledTimes(1);
    const q = (tables.deleteRows.mock.calls[0] as unknown as [{ queries: string[] }])[0].queries[0];
    expect(q).toContain("siteId");
    expect(q).toContain("site1");
    expect(storage.deleteFile).toHaveBeenCalledTimes(2);
  });
});
