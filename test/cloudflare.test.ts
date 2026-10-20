import { describe, expect, it } from "vitest";
import {
  CloudflareBackend,
  CloudflareError,
  kvKeyName,
  newFileId,
  r2ObjectKey,
} from "../src/backend/cloudflare.js";
import { type CloudflareConfig, loadConfig } from "../src/config.js";
import { FAKE_CLOUDFLARE, FakeCloudflare } from "./fake-cloudflare.js";

const cfg = loadConfig(FAKE_CLOUDFLARE).cloudflare as CloudflareConfig;
const NOW = Date.parse("2026-01-01T00:00:00Z");

function setup() {
  const cf = new FakeCloudflare();
  const sleeps: number[] = [];
  const backend = new CloudflareBackend(cfg, {
    fetch: cf.fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => NOW,
  });
  return { cf, backend, sleeps };
}
const bytes = (s: string) => new TextEncoder().encode(s);

describe("CloudflareBackend: Workers KV (mocked REST API)", () => {
  it("stores values under <siteId>/<key> with the bearer token, URL-encoded", async () => {
    const { cf, backend } = setup();
    await backend.kvSet("site1", "a:b.c", '{"hello":"مرحبا"}');
    expect([...cf.kv.keys()]).toEqual(["site1/a:b.c"]);
    const put = cf.calls[0];
    expect(put?.method).toBe("PUT");
    expect(put?.url.pathname).toBe(
      `/client/v4/accounts/${FAKE_CLOUDFLARE.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/example-namespace/values/site1%2Fa%3Ab.c`,
    );
    expect(put?.headers.get("authorization")).toBe(
      `Bearer ${FAKE_CLOUDFLARE.CLOUDFLARE_API_TOKEN}`,
    );
    expect(await backend.kvGet("site1", "a:b.c")).toBe('{"hello":"مرحبا"}');
    expect(kvKeyName("s", "k")).toBe("s/k");
  });

  it("maps a missing key to undefined / false", async () => {
    const { backend } = setup();
    expect(await backend.kvGet("site1", "nope")).toBeUndefined();
    expect(await backend.kvDelete("site1", "nope")).toBe(false);
    await backend.kvSet("site1", "x", "1");
    expect(await backend.kvDelete("site1", "x")).toBe(true);
    expect(await backend.kvGet("site1", "x")).toBeUndefined();
  });

  it("lists and counts only one site's keys, across pages", async () => {
    const { cf, backend } = setup();
    cf.kvPage = 2;
    for (const k of ["c", "a", "b", "d", "e"]) await backend.kvSet("site1", k, "1");
    await backend.kvSet("site10", "zz", "1"); // shares a textual prefix, not the "site1/" prefix
    expect(await backend.kvList("site1", 100)).toEqual(["a", "b", "c", "d", "e"]);
    expect(await backend.kvList("site1", 3)).toEqual(["a", "b", "c"]);
    expect(await backend.kvCount("site1")).toBe(5);
    const list = cf.calls.find((c) => c.url.pathname.endsWith("/keys"));
    expect(list?.url.searchParams.get("prefix")).toBe("site1/");
  });

  it("retries 429 (1 write/s per key) and 5xx, honouring Retry-After", async () => {
    const { cf, backend, sleeps } = setup();
    cf.failNext = [{ status: 429, headers: { "retry-after": "1" } }, { status: 502 }];
    await backend.kvSet("site1", "a", "1");
    expect(cf.kv.get("site1/a")).toBe("1");
    expect(sleeps).toEqual([1000, 1000]);
  });

  it("surfaces persistent failures without leaking the token", async () => {
    const { cf, backend } = setup();
    cf.failNext = [{ status: 500 }, { status: 500 }, { status: 500 }];
    const err = await backend.kvGet("site1", "a").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CloudflareError);
    expect(String(err)).toContain("500");
    expect(String(err)).not.toContain(FAKE_CLOUDFLARE.CLOUDFLARE_API_TOKEN);
  });
});

describe("CloudflareBackend: R2 (mocked S3 API)", () => {
  it("signs requests with SigV4 and stores <siteId>/<fileId>/<encoded name>", async () => {
    const { cf, backend } = setup();
    const f = await backend.fileUpload("site1", "صورة 1.png", bytes("png"), "image/png");
    expect(f).toMatchObject({
      name: "صورة 1.png",
      mime: "image/png",
      size: 3,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(f.id).toMatch(/^f[0-9a-z]{9}[0-9a-f]{16}$/);
    expect([...cf.objects.keys()]).toEqual([r2ObjectKey("site1", f.id, "صورة 1.png")]);
    expect(cf.objects.get(r2ObjectKey("site1", f.id, "صورة 1.png"))?.type).toBe("image/png");
    const put = cf.calls[0];
    expect(put?.url.host).toBe(`${FAKE_CLOUDFLARE.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`);
    expect(put?.headers.get("authorization")).toMatch(
      /^AWS4-HMAC-SHA256 Credential=example-access-key-id\/\d{8}\/auto\/s3\/aws4_request/,
    );
    expect(put?.headers.get("authorization")).not.toContain(FAKE_CLOUDFLARE.R2_SECRET_ACCESS_KEY);
  });

  it("lists, downloads and deletes a site's files by id", async () => {
    const { backend } = setup();
    const a = await backend.fileUpload("site1", "a&b <x>.txt", bytes("hello"), "text/plain");
    const b = await backend.fileUpload("site1", "a&b <x>.txt", bytes("again"), "text/plain");
    expect(a.id).not.toBe(b.id); // same name, two files (as before)
    const list = await backend.filesList("site1", 100);
    expect(list.map((f) => f.name)).toEqual(["a&b <x>.txt", "a&b <x>.txt"]);
    expect(list[0]?.createdAt).toBe("2026-01-01T00:00:00.000Z");
    const got = await backend.fileGet("site1", a.id);
    expect(new TextDecoder().decode(got?.bytes)).toBe("hello");
    expect(got?.file).toMatchObject({ id: a.id, name: "a&b <x>.txt", size: 5 });
    expect(await backend.fileDelete("site1", a.id)).toBe(true);
    expect(await backend.fileGet("site1", a.id)).toBeNull();
    expect(await backend.fileDelete("site1", a.id)).toBe(false);
    expect((await backend.filesList("site1", 100)).map((f) => f.id)).toEqual([b.id]);
  });

  it("refuses other sites' files and invalid ids", async () => {
    const { cf, backend } = setup();
    const other = await backend.fileUpload("site2", "secret.txt", bytes("no"), "text/plain");
    expect(await backend.fileGet("site1", other.id)).toBeNull();
    expect(await backend.fileDelete("site1", other.id)).toBe(false);
    expect(await backend.filesList("site1", 100)).toEqual([]);
    const before = cf.calls.length;
    expect(await backend.fileGet("site1", "")).toBeNull();
    expect(await backend.fileGet("site1", "../x")).toBeNull();
    expect(cf.calls.length).toBe(before); // never even asked R2
    expect(cf.objects.size).toBe(1);
  });

  it("paginates file listings", async () => {
    const { cf, backend } = setup();
    cf.s3Page = 2;
    for (let i = 0; i < 5; i++)
      await backend.fileUpload("site1", `f${i}.txt`, bytes("x"), "text/plain");
    expect(await backend.filesList("site1", 100)).toHaveLength(5);
    expect(await backend.filesList("site1", 3)).toHaveLength(3);
  });

  it("reports R2 errors with the S3 error code", async () => {
    const bad = new CloudflareBackend(
      { ...cfg, r2Bucket: "other-bucket" },
      {
        fetch: new FakeCloudflare().fetch,
        sleep: async () => {},
      },
    );
    await expect(bad.filesList("site1", 10)).rejects.toThrow(/NoSuchBucket/);
  });
});

describe("CloudflareBackend: purgeSite", () => {
  it("removes every KV entry and file of the site, and nothing else", async () => {
    const { cf, backend } = setup();
    cf.kvPage = 2;
    cf.s3Page = 2;
    for (const k of ["a", "b", "c"]) await backend.kvSet("site1", k, "1");
    await backend.kvSet("site2", "a", "1");
    for (let i = 0; i < 3; i++)
      await backend.fileUpload("site1", `f${i}.txt`, bytes("x"), "text/plain");
    const keep = await backend.fileUpload("site2", "keep.txt", bytes("x"), "text/plain");
    await backend.purgeSite("site1");
    expect([...cf.kv.keys()]).toEqual(["site2/a"]);
    expect([...cf.objects.keys()]).toEqual([r2ObjectKey("site2", keep.id, "keep.txt")]);
    const bulk = cf.calls.filter((c) => c.url.pathname.endsWith("/bulk/delete"));
    expect(bulk).toHaveLength(1);
  });

  it("is a no-op for a site without data", async () => {
    const { cf, backend } = setup();
    await backend.purgeSite("empty1");
    expect(cf.calls.some((c) => c.url.pathname.endsWith("/bulk/delete"))).toBe(false);
  });
});

describe("newFileId", () => {
  it("is 26 chars, unique and sorts by time", () => {
    const a = newFileId(NOW);
    const b = newFileId(NOW + 1000);
    expect(a).toHaveLength(26);
    expect(a).not.toBe(newFileId(NOW));
    expect(a < b).toBe(true);
  });
});
