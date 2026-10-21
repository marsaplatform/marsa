import { describe, expect, it } from "vitest";
import { matches, normalize } from "../src/lib/arabic.js";
import { fetchJson, USER_AGENT, UpstreamError } from "../src/lib/http.js";

describe("arabic", () => {
  it("normalizes letter forms, diacritics and digits", () => {
    expect(normalize("أَحْمَد")).toBe("احمد");
    expect(normalize("مكتبةُ ٢٠٢٦")).toBe("مكتبه 2026");
    expect(matches("مكتبة الإسكندرية", "اسكندريه")).toBe(true);
  });
});

describe("http", () => {
  it("sends the User-Agent and retries 5xx", async () => {
    let n = 0;
    const fetchFn = (async (_u: string, init?: RequestInit) => {
      n++;
      expect((init?.headers as Record<string, string>)["user-agent"]).toBe(USER_AGENT);
      return n < 2 ? new Response("busy", { status: 503 }) : Response.json({ ok: 1 });
    }) as typeof fetch;
    expect(await fetchJson("https://x.test", { fetchFn, retries: 2 })).toEqual({ ok: 1 });
    expect(n).toBe(2);
  });
  it("does not retry a 404", async () => {
    let n = 0;
    const fetchFn = (async () => {
      n++;
      return new Response("no", { status: 404 });
    }) as typeof fetch;
    await expect(fetchJson("https://x.test", { fetchFn })).rejects.toBeInstanceOf(UpstreamError);
    expect(n).toBe(1);
  });
});
