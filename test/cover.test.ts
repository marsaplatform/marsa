import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { COVER_MAX_BYTES, initialOf, localPath, looksLike, pickCover } from "../src/cover.js";
import type { SiteMeta } from "../src/store.js";
import { SiteStore } from "../src/store.js";

const ADMIN = "test-admin-token-0123456789abcdef";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
const PUB = "http://marsa.test";

const enc = (s: string) => new TextEncoder().encode(s);
function meta(files: Record<string, [string, number]>): SiteMeta {
  return {
    id: "abcdef1234",
    createdAt: "",
    updatedAt: "",
    expiresAt: "",
    tokenHash: "",
    fileCount: 0,
    totalBytes: 0,
    files: Object.fromEntries(
      Object.entries(files).map(([p, [mime, size]]) => [p, { mime, size }]),
    ),
  };
}

describe("pickCover", () => {
  const m = meta({
    "index.html": ["text/html; charset=utf-8", 100],
    "cover.webp": ["image/webp", 500],
    "img/og.png": ["image/png", 500],
    "img/first.jpg": ["image/jpeg", 500],
    "logo.svg": ["image/svg+xml", 500],
    "huge.png": ["image/png", COVER_MAX_BYTES + 1],
  });

  it("prefers a cover.* file at the site root", () => {
    expect(pickCover(m, enc('<meta property="og:image" content="img/og.png">'), PUB)).toEqual({
      path: "cover.webp",
      mime: "image/webp",
      source: "file",
    });
  });

  it("then a local og:image (relative, root-relative or this site's absolute URL)", () => {
    const { "cover.webp": _drop, ...rest } = m.files;
    const n = { ...m, files: rest };
    for (const ref of [
      "img/og.png",
      "./img/og.png",
      "/s/abcdef1234/img/og.png",
      `${PUB}/s/abcdef1234/img/og.png`,
    ]) {
      expect(pickCover(n, enc(`<meta content='${ref}' property="og:image">`), PUB)?.path).toBe(
        "img/og.png",
      );
    }
    expect(pickCover(n, enc('<meta name="twitter:image" content="img/og.png">'), PUB)?.source).toBe(
      "og",
    );
  });

  it("then the first local raster <img>, skipping SVG, external, too-big and commented-out images", () => {
    const { "cover.webp": _drop, ...rest } = m.files;
    const n = { ...m, files: rest };
    const html = `<meta property="og:image" content="https://evil.example/x.png">
      <!-- <img src="img/og.png"> -->
      <img src="logo.svg"><img src="//cdn.example/a.png"><img src="huge.png"><img alt=x src=img/first.jpg>`;
    expect(pickCover(n, enc(html), PUB)).toEqual({
      path: "img/first.jpg",
      mime: "image/jpeg",
      source: "img",
    });
  });

  it("returns null when nothing usable exists", () => {
    expect(pickCover(meta({ "index.html": ["text/html", 1] }), enc("<h1>x</h1>"), PUB)).toBeNull();
    expect(pickCover(meta({ "a.png": ["image/png", 5] }), null, PUB)).toBeNull();
  });

  it("never escapes the site", () => {
    expect(localPath("../../other/x.png", "abcdef1234", PUB)).toBeNull();
    expect(localPath("/s/zzzzzz9999/x.png", "abcdef1234", PUB)).toBeNull();
    expect(localPath("javascript:alert(1)", "abcdef1234", PUB)).toBeNull();
    expect(localPath("data:image/png;base64,AAAA", "abcdef1234", PUB)).toBeNull();
    expect(localPath("img/a%20b.png?x=1#y", "abcdef1234", PUB)).toBe("img/a b.png");
  });
});

describe("looksLike / initialOf", () => {
  it("checks magic bytes", () => {
    expect(looksLike("image/png", PNG)).toBe(true);
    expect(looksLike("image/jpeg", JPG)).toBe(true);
    expect(looksLike("image/png", enc("<svg onload=alert(1)>"))).toBe(false);
    expect(looksLike("image/svg+xml", enc("<svg/>"))).toBe(false);
  });
  it("takes the first letter of a title", () => {
    expect(initialOf("أطلس · Atlas")).toBe("أ");
    expect(initialOf("  «report» 2026")).toBe("R");
    expect(initialOf("")).toBe("م");
  });
});

describe("directory covers and the home page", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "marsa-cover-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function setup(env: Record<string, string> = {}) {
    const config = loadConfig({ DATA_DIR: dir, PUBLIC_URL: PUB, ADMIN_TOKEN: ADMIN, ...env });
    const store = new SiteStore(config.dataDir);
    await store.init();
    const app = createApp({ config, store });
    const res = await app.request("/api/admin/teams", {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "Atlas desk", backend: false }),
    });
    const { key, team } = (await res.json()) as { key: string; team: { id: string } };
    const publish = async (
      files: object[],
      headers: Record<string, string> = { "x-team-key": key },
    ) => {
      const r = await app.request("/api/sites", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ ttlHours: 24, files }),
      });
      expect(r.status).toBe(201);
      return (await r.json()) as { id: string };
    };
    return { app, publish, key, team };
  }
  const b64 = (b: Buffer) => b.toString("base64");
  type Dir = { featured: string[]; teams: { sites: { id: string; cover: string | null }[] }[] };

  it("serves a site's own cover image with strict headers, and a placeholder otherwise", async () => {
    const { app, publish } = await setup();
    const withCover = await publish([
      {
        path: "index.html",
        content: '<title>Map</title><meta property="og:image" content="og.png">',
      },
      { path: "og.png", content: b64(PNG), encoding: "base64" },
    ]);
    const plain = await publish([{ path: "index.html", content: "<title>أطلس</title>" }]);
    const fake = await publish([
      { path: "index.html", content: "<title>Fake</title>" },
      { path: "cover.png", content: "<svg onload=alert(1)></svg>" },
    ]);
    const guest = await publish(
      [
        { path: "index.html", content: "<title>Guest</title>" },
        { path: "cover.png", content: b64(PNG), encoding: "base64" },
      ],
      {},
    );

    const d = (await (await app.request("/api/directory")).json()) as Dir;
    const sites = Object.fromEntries(d.teams[0]?.sites.map((x) => [x.id, x]) ?? []);
    const url = sites[withCover.id]?.cover;
    expect(url).toMatch(new RegExp(`^/covers/${withCover.id}\\?v=[0-9a-f]{10}$`));
    expect(sites[plain.id]?.cover).toBeNull();

    const img = await app.request(url as string);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("content-security-policy")).toContain("sandbox");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await img.arrayBuffer()).equals(PNG)).toBe(true);
    const again = await app.request(url as string, {
      headers: { "if-none-match": img.headers.get("etag") ?? "" },
    });
    expect(again.status).toBe(304);

    // Not a real PNG, not listed (guest), no cover, unknown: all 404.
    expect((await app.request(`/covers/${fake.id}`)).status).toBe(404);
    expect((await app.request(`/covers/${guest.id}`)).status).toBe(404);
    expect((await app.request(`/covers/${plain.id}`)).status).toBe(404);
    expect((await app.request("/covers/nosuchsite1")).status).toBe(404);

    const home = await (await app.request("/ar")).text();
    expect(home).toContain(`<img src="${url}"`);
    expect(home).toContain('class="thumb-art');
    expect(home).toContain(">أ</text>");
    expect(home).toContain('class="hero-stats"');
    expect(home).toContain('class="how-steps"');
    expect(home).not.toContain("<script>");
  });

  it("spotlights FEATURED_SITES, else the newest page", async () => {
    let s = await setup();
    await s.publish([{ path: "index.html", content: "<title>Atlas</title>" }]);
    const second = await s.publish([{ path: "index.html", content: "<title>Newer</title>" }]);
    let d = (await (await s.app.request("/api/directory")).json()) as Dir;
    expect(d.featured).toEqual([second.id]);
    await rm(dir, { recursive: true, force: true });

    s = await setup({ FEATURED_SITES: "nosuchsite1, zzzzzz" });
    const a = await s.publish([{ path: "index.html", content: "<title>Atlas</title>" }]);
    d = (await (await s.app.request("/api/directory")).json()) as Dir;
    expect(d.featured).toEqual([a.id]); // pinned ids gone: fall back to newest
  });

  it("renders the pinned page in the featured slot", async () => {
    const s = await setup();
    const atlas = await s.publish([{ path: "index.html", content: "<title>Atlas board</title>" }]);
    await s.publish([{ path: "index.html", content: "<title>Other page</title>" }]);
    // Rebuild the app with the pin.
    const pinned = loadConfig({
      DATA_DIR: dir,
      PUBLIC_URL: PUB,
      ADMIN_TOKEN: ADMIN,
      FEATURED_SITES: atlas.id,
    });
    const store = new SiteStore(pinned.dataDir);
    await store.init();
    const app = createApp({ config: pinned, store });
    const html = await (await app.request("/")).text();
    const featured = html.slice(
      html.indexOf('class="section wrap featured"'),
      html.indexOf('id="directory"'),
    );
    expect(featured).toContain("Atlas board");
    expect(featured).not.toContain("Other page");
    expect(featured).toContain(`href="${PUB}/s/${atlas.id}/"`);
  });
});
