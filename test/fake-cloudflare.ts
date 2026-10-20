/**
 * A mocked `fetch` that speaks just enough of Cloudflare's Workers KV REST API
 * and R2's S3 API for the adapter tests. Placeholder credentials only; nothing
 * here talks to the real Cloudflare.
 */
export const FAKE_CLOUDFLARE = {
  CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  CLOUDFLARE_API_TOKEN: "example-api-token-not-real",
  CLOUDFLARE_KV_NAMESPACE_ID: "example-namespace",
  R2_ACCESS_KEY_ID: "example-access-key-id",
  R2_SECRET_ACCESS_KEY: "example-secret-access-key-not-real",
};

export interface Call {
  method: string;
  url: URL;
  headers: Headers;
}

const xmlEsc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&apos;");

export class FakeCloudflare {
  kv = new Map<string, string>();
  objects = new Map<string, { bytes: Uint8Array; type: string; modified: string }>();
  calls: Call[] = [];
  /** Statuses to answer (once each, in order) before handling requests normally. */
  failNext: { status: number; headers?: Record<string, string> }[] = [];
  /** KV list page size (real max is 1000), small to exercise pagination. */
  kvPage = 1000;
  s3Page = 1000;

  fetch = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    this.calls.push({ method: req.method, url, headers: req.headers });
    const fail = this.failNext.shift();
    if (fail) return new Response("{}", { status: fail.status, headers: fail.headers });
    if (url.host === "api.cloudflare.com") return this.kvApi(req, url);
    return this.s3Api(req, url);
  };

  private json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  private async kvApi(req: Request, url: URL): Promise<Response> {
    if (req.headers.get("authorization") !== `Bearer ${FAKE_CLOUDFLARE.CLOUDFLARE_API_TOKEN}`) {
      return this.json(
        { success: false, errors: [{ code: 10000, message: "Authentication error" }] },
        403,
      );
    }
    const base = `/client/v4/accounts/${FAKE_CLOUDFLARE.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${FAKE_CLOUDFLARE.CLOUDFLARE_KV_NAMESPACE_ID}`;
    const path = url.pathname;
    if (!path.startsWith(base)) return this.json({ success: false, errors: [] }, 404);
    const rest = path.slice(base.length);
    if (rest.startsWith("/values/")) {
      const key = decodeURIComponent(rest.slice("/values/".length));
      if (req.method === "GET") {
        const v = this.kv.get(key);
        return v === undefined
          ? this.json(
              { success: false, errors: [{ code: 10009, message: "get: 'key not found'" }] },
              404,
            )
          : new Response(v);
      }
      if (req.method === "PUT") {
        this.kv.set(key, await req.text());
        return this.json({ success: true, errors: [], result: {} });
      }
      if (req.method === "DELETE") {
        this.kv.delete(key);
        return this.json({ success: true, errors: [], result: {} });
      }
    }
    if (rest === "/keys" && req.method === "GET") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const all = [...this.kv.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = Number(url.searchParams.get("cursor") || 0);
      const page = all.slice(start, start + this.kvPage);
      const next = start + this.kvPage < all.length ? String(start + this.kvPage) : "";
      return this.json({
        success: true,
        errors: [],
        result: page.map((name) => ({ name })),
        result_info: { count: page.length, cursor: next },
      });
    }
    if (rest === "/bulk/delete" && req.method === "POST") {
      const names = (await req.json()) as string[];
      for (const n of names) this.kv.delete(n);
      return this.json({
        success: true,
        errors: [],
        result: { successful_key_count: names.length, unsuccessful_keys: [] },
      });
    }
    return this.json({ success: false, errors: [] }, 405);
  }

  private async s3Api(req: Request, url: URL): Promise<Response> {
    const auth = req.headers.get("authorization") ?? "";
    if (!auth.startsWith(`AWS4-HMAC-SHA256 Credential=${FAKE_CLOUDFLARE.R2_ACCESS_KEY_ID}/`)) {
      return new Response("<Error><Code>InvalidAccessKeyId</Code></Error>", { status: 403 });
    }
    const [, bucket, ...keyParts] = url.pathname.split("/");
    if (bucket !== "marsa-files") {
      return new Response("<Error><Code>NoSuchBucket</Code></Error>", { status: 404 });
    }
    const key = keyParts.map(decodeURIComponent).join("/");
    if (!key && req.method === "GET" && url.searchParams.get("list-type") === "2") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const max = Math.min(Number(url.searchParams.get("max-keys") ?? 1000), this.s3Page);
      const all = [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = Number(url.searchParams.get("continuation-token") || 0);
      const page = all.slice(start, start + max);
      const truncated = start + max < all.length;
      const contents = page
        .map((k) => {
          const o = this.objects.get(k);
          return `<Contents><Key>${xmlEsc(k)}</Key><LastModified>${o?.modified}</LastModified><Size>${o?.bytes.byteLength}</Size></Contents>`;
        })
        .join("");
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${bucket}</Name><IsTruncated>${truncated}</IsTruncated>${contents}${truncated ? `<NextContinuationToken>${start + max}</NextContinuationToken>` : ""}</ListBucketResult>`,
        { headers: { "content-type": "application/xml" } },
      );
    }
    if (req.method === "PUT") {
      this.objects.set(key, {
        bytes: new Uint8Array(await req.arrayBuffer()),
        type: req.headers.get("content-type") ?? "",
        modified: "2026-01-01T00:00:00.000Z",
      });
      return new Response(null, { status: 200 });
    }
    if (req.method === "GET") {
      const o = this.objects.get(key);
      return o
        ? new Response(new Uint8Array(o.bytes), { headers: { "content-type": o.type } })
        : new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
    }
    if (req.method === "DELETE") {
      this.objects.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response("<Error><Code>NotImplemented</Code></Error>", { status: 501 });
  }
}
