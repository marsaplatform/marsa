import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { SiteStore } from "../src/store.js";
import { localePath } from "../src/ui.js";

const BASE = "http://marsa.test";
let dir: string;

async function setup(env: Record<string, string> = {}) {
  const config = loadConfig({ DATA_DIR: dir, PUBLIC_URL: BASE, ...env });
  const store = new SiteStore(config.dataDir);
  await store.init();
  return createApp({ config, store });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "marsa-pages-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("landing page", () => {
  it("serves English at / with strict CSP and the uploader", async () => {
    const app = await setup();
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-inline");
    const html = await res.text();
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain('id="try"');
    expect(html).toContain('id="drop"');
    expect(html).toContain(`${BASE}/api/sites`);
    expect(html).toContain('href="/ar"');
    expect(html).not.toMatch(/<script>(?!<\/script>)|\sstyle="/); // no inline code
  });

  it("serves Arabic at /ar with RTL", async () => {
    const app = await setup();
    const html = await (await app.request("/ar")).text();
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain("انشر صفحة");
    expect(html).toContain('hreflang="en"');
  });

  it("shows this instance's limits", async () => {
    const app = await setup({ MAX_SITE_MB: "7", UPLOADS_PER_HOUR: "3" });
    const html = await (await app.request("/")).text();
    expect(html).toContain("7 MB per site");
    expect(html).toContain("3 uploads per hour");
  });

  it("serves the uploader on its own at /new and /ar/new", async () => {
    const app = await setup();
    for (const path of ["/new", "/ar/new"]) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('id="pickFiles"');
    }
  });

  it("serves assets and favicon", async () => {
    const app = await setup();
    expect((await app.request("/assets/app.css")).headers.get("content-type")).toContain(
      "text/css",
    );
    expect((await app.request("/assets/app.js")).headers.get("content-type")).toContain(
      "javascript",
    );
    expect((await app.request("/favicon.svg")).status).toBe(200);
    // pages reference content-versioned asset URLs, so a CDN never serves stale CSS/JS after a deploy
    const html = await (await app.request("/")).text();
    const css = /href="(\/assets\/app\.css\?v=[0-9a-f]{10})"/.exec(html)?.[1];
    const js = /src="(\/assets\/app\.js\?v=[0-9a-f]{10})"/.exec(html)?.[1];
    expect(css).toBeTruthy();
    expect(js).toBeTruthy();
    expect((await app.request(css ?? "")).status).toBe(200);
    expect((await app.request(js ?? "")).status).toBe(200);
  });

  it("localises 404 pages", async () => {
    const app = await setup();
    const res = await app.request("/ar/nope");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('dir="rtl"');
  });
});

describe("docs", () => {
  it("lists every guide at /docs", async () => {
    const app = await setup();
    const html = await (await app.request("/docs")).text();
    for (const slug of [
      "getting-started",
      "api",
      "agents",
      "managing",
      "use-cases",
      "self-hosting",
      "backend",
    ]) {
      expect(html).toContain(`/docs/${slug}`);
    }
    expect(html).toContain("/ar/docs/guide");
  });

  it("renders a guide with this instance's URL instead of the placeholder", async () => {
    const app = await setup();
    const res = await app.request("/docs/api");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`${BASE}/api/sites`);
    expect(html).not.toContain("marsa.example.com");
    expect(html).toContain("<table>");
  });

  it("rewrites .md links to app routes", async () => {
    const app = await setup();
    const html = await (await app.request("/docs/getting-started")).text();
    expect(html).toContain('href="/docs/api"');
    expect(html).not.toMatch(/href="[a-z-]+\.md"/);
  });

  it("serves the Arabic guide with RTL content", async () => {
    const app = await setup();
    const html = await (await app.request("/ar/docs/guide")).text();
    expect(html).toContain('lang="ar" dir="rtl"');
    expect(html).toContain("دليل");
  });

  it("404s unknown guides", async () => {
    const app = await setup();
    expect((await app.request("/docs/nope")).status).toBe(404);
  });
});

describe("machine-readable docs", () => {
  it("serves /llms.txt with this instance's URL and limits", async () => {
    const app = await setup({ MAX_TTL_HOURS: "72" });
    const res = await app.request("/llms.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const txt = await res.text();
    expect(txt.startsWith("# ")).toBe(true);
    expect(txt).toContain(`${BASE}/api/sites`);
    expect(txt).toContain("1-72");
  });

  it("serves a valid-looking OpenAPI 3.1 document", async () => {
    const app = await setup();
    const res = await app.request("/openapi.json");
    expect(res.status).toBe(200);
    const spec = (await res.json()) as {
      openapi: string;
      servers: { url: string }[];
      paths: Record<string, Record<string, unknown>>;
    };
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.servers[0]?.url).toBe(BASE);
    expect(Object.keys(spec.paths["/api/sites/{id}"] ?? {})).toEqual(
      expect.arrayContaining(["get", "put", "patch", "delete"]),
    );
    expect(spec.paths["/api/sites"]?.post).toBeTruthy();
  });

  it("serves robots.txt that keeps uploads out of search", async () => {
    const app = await setup();
    expect(await (await app.request("/robots.txt")).text()).toContain("Disallow: /s/");
  });
});

describe("localePath", () => {
  it("maps between English and Arabic paths", () => {
    expect(localePath("ar", "/")).toBe("/ar");
    expect(localePath("ar", "/docs")).toBe("/ar/docs");
    expect(localePath("en", "/ar/docs")).toBe("/docs");
    expect(localePath("en", "/ar")).toBe("/");
  });
});

describe("examples", () => {
  async function* walk(d: string): AsyncGenerator<string> {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) yield* walk(p);
      else yield p;
    }
  }

  const sites = [
    "agent-report",
    "client-prototype",
    "event-page",
    "class-assignment",
    "ci-preview/site",
    "backend-notes",
  ];
  for (const name of sites) {
    it(`publishes examples/${name}`, async () => {
      const app = await setup();
      const root = join(import.meta.dirname, "..", "examples", name);
      const files = [];
      for await (const p of walk(root)) {
        files.push({
          path: relative(root, p),
          content: (await readFile(p)).toString("base64"),
          encoding: "base64",
        });
      }
      const res = await app.request("/api/sites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ files }),
      });
      expect(res.status).toBe(201);
      const { id } = (await res.json()) as { id: string };
      const page = await app.request(`/s/${id}/`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("<!doctype html>");
    });
  }
});
