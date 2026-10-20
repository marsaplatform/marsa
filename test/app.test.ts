import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { SiteStore } from "../src/store.js";

const ADMIN = "test-admin-token-0123456789abcdef";
let dir: string;
let clock: number;

async function setup(env: Record<string, string> = {}) {
  const config = loadConfig({ DATA_DIR: dir, PUBLIC_URL: "http://marsa.test", ...env });
  const store = new SiteStore(config.dataDir);
  await store.init();
  return { app: createApp({ config, store, now: () => clock }), store };
}

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "marsa-test-"));
  clock = Date.parse("2026-01-01T00:00:00Z");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("guest upload", () => {
  it("publishes JSON files and serves them sandboxed", async () => {
    const { app } = await setup();
    const res = await app.request(
      "/api/sites",
      json({ files: [{ path: "index.html", content: "<h1>hi</h1>" }], ttlHours: 2 }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      url: string;
      editToken: string;
      expiresAt: string;
    };
    expect(body.url).toBe(`http://marsa.test/s/${body.id}/`);
    expect(body.editToken).toMatch(/^marsa_/);
    expect(Date.parse(body.expiresAt) - clock).toBe(2 * 3600_000);

    const page = await app.request(`/s/${body.id}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toBe("<h1>hi</h1>");
    expect(page.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await app.request(`/s/${body.id}`)).status).toBe(301);
  });

  it("accepts a raw zip and strips a shared top folder and dotfiles", async () => {
    const { app } = await setup();
    const zip = zipSync({
      "site/index.html": new TextEncoder().encode("<p>zip</p>"),
      "site/css/a.css": new TextEncoder().encode("p{}"),
      "site/.env": new TextEncoder().encode("SECRET=1"),
    });
    const res = await app.request("/api/sites", {
      method: "POST",
      headers: { "content-type": "application/zip" },
      body: zip,
    });
    expect(res.status).toBe(201);
    const { id, fileCount } = (await res.json()) as { id: string; fileCount: number };
    expect(fileCount).toBe(2);
    expect(await (await app.request(`/s/${id}/`)).text()).toBe("<p>zip</p>");
    const css = await app.request(`/s/${id}/css/a.css`);
    expect(css.headers.get("content-type")).toContain("text/css");
  });

  it("accepts multipart uploads with relative paths", async () => {
    const { app } = await setup();
    const fd = new FormData();
    fd.append("files", new File(["<b>m</b>"], "index.html"));
    fd.append("paths", "proj/index.html");
    fd.append("files", new File(["x"], "a.txt"));
    fd.append("paths", "proj/docs/a.txt");
    fd.append("ttlHours", "24");
    const res = await app.request("/api/sites", { method: "POST", body: fd });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(await (await app.request(`/s/${id}/docs/a.txt`)).text()).toBe("x");
  });
});

describe("abuse limits", () => {
  it("rejects blocked file types", async () => {
    const { app } = await setup();
    const res = await app.request(
      "/api/sites",
      json({ files: [{ path: "shell.php", content: "<?php ?>" }] }),
    );
    expect(res.status).toBe(415);
  });

  it("rejects path traversal", async () => {
    const { app } = await setup();
    const res = await app.request(
      "/api/sites",
      json({ files: [{ path: "../../etc/passwd", content: "x" }] }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "ZIP_SLIP_REJECTED",
    );
  });

  it("enforces the size cap", async () => {
    const { app } = await setup({ MAX_FILE_MB: "1", MAX_SITE_MB: "1" });
    const big = "a".repeat(1024 * 1024 + 1);
    const res = await app.request("/api/sites", json({ files: [{ path: "a.txt", content: big }] }));
    expect(res.status).toBe(413);
  });

  it("rate-limits uploads per IP", async () => {
    const { app } = await setup({ UPLOADS_PER_HOUR: "2" });
    const up = () => app.request("/api/sites", json({ files: [{ path: "i.html", content: "x" }] }));
    expect((await up()).status).toBe(201);
    expect((await up()).status).toBe(201);
    const third = await up();
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBeTruthy();
  });

  it("clamps the TTL to the configured max", async () => {
    const { app } = await setup({ MAX_TTL_HOURS: "48" });
    const res = await app.request(
      "/api/sites",
      json({ files: [{ path: "index.html", content: "x" }], ttlHours: 9999 }),
    );
    const { expiresAt } = (await res.json()) as { expiresAt: string };
    expect(Date.parse(expiresAt) - clock).toBe(48 * 3600_000);
  });
});

describe("expiry and edit token", () => {
  it("expires links and sweeps them", async () => {
    const { app, store } = await setup();
    const res = await app.request(
      "/api/sites",
      json({ files: [{ path: "index.html", content: "x" }], ttlHours: 1 }),
    );
    const { id } = (await res.json()) as { id: string };
    clock += 3600_000 + 1;
    expect((await app.request(`/s/${id}/`)).status).toBe(410);
    expect(await store.sweepExpired(clock)).toEqual([id]);
    expect((await app.request(`/s/${id}/`)).status).toBe(404);
  });

  it("only the token holder can update or delete", async () => {
    const { app } = await setup();
    const res = await app.request(
      "/api/sites",
      json({ files: [{ path: "index.html", content: "v1" }] }),
    );
    const { id, editToken } = (await res.json()) as { id: string; editToken: string };

    const wrong = await app.request(`/api/sites/${id}`, {
      method: "DELETE",
      headers: { authorization: "Bearer nope" },
    });
    expect(wrong.status).toBe(404);

    const put = await app.request(`/api/sites/${id}`, {
      ...json({ files: [{ path: "index.html", content: "v2" }] }),
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${editToken}` },
    });
    expect(put.status).toBe(200);
    expect(await (await app.request(`/s/${id}/`)).text()).toBe("v2");

    const del = await app.request(`/api/sites/${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${editToken}` },
    });
    expect(del.status).toBe(204);
    expect((await app.request(`/s/${id}/`)).status).toBe(404);
  });

  it("cannot extend a link past createdAt + MAX_TTL_HOURS", async () => {
    const { app } = await setup({ MAX_TTL_HOURS: "24" });
    const res = await app.request(
      "/api/sites",
      json({ files: [{ path: "index.html", content: "x" }], ttlHours: 1 }),
    );
    const { id, editToken } = (await res.json()) as { id: string; editToken: string };
    clock += 1800_000; // still live, 30 min in
    const patch = await app.request(`/api/sites/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${editToken}` },
      body: JSON.stringify({ ttlHours: 24 }),
    });
    const { expiresAt } = (await patch.json()) as { expiresAt: string };
    expect(expiresAt).toBe("2026-01-02T00:00:00.000Z");
  });
});

describe("admin", () => {
  it("is disabled without ADMIN_TOKEN", async () => {
    const { app } = await setup();
    expect((await app.request("/api/admin/sites")).status).toBe(404);
  });

  it("lists and deletes sites with the admin token", async () => {
    const { app } = await setup({ ADMIN_TOKEN: ADMIN });
    const res = await app.request(
      "/api/sites",
      json({ files: [{ path: "index.html", content: "x" }] }),
    );
    const { id } = (await res.json()) as { id: string };
    expect((await app.request("/api/admin/sites")).status).toBe(401);
    const auth = { headers: { authorization: `Bearer ${ADMIN}` } };
    const list = (await (await app.request("/api/admin/sites", auth)).json()) as { count: number };
    expect(list.count).toBe(1);
    const del = await app.request(`/api/admin/sites/${id}`, { ...auth, method: "DELETE" });
    expect(del.status).toBe(204);
  });
});

describe("app UI", () => {
  it("serves the upload page with a strict CSP", async () => {
    const { app } = await setup();
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(await res.text()).toContain("/assets/app.js");
  });
});
