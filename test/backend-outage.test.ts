import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareError } from "../src/backend/cloudflare.js";
import { makeApp } from "./helpers.js";

type App = Awaited<ReturnType<typeof makeApp>>;
let t: App;
afterEach(async () => {
  vi.restoreAllMocks();
  await t?.cleanup();
});

/** Cloudflare answering 401 "Authentication error" (e.g. the token lost its KV permission). */
const authError = (service: "kv" | "r2") =>
  new CloudflareError(service, 401, "10000 Authentication error");

describe("data/files store outage (0.13.1)", () => {
  it("answers 503 BACKEND_UNAVAILABLE, not a generic 500, and the admin check names the cause", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    t = await makeApp();
    const { key } = await t.createTeam("Crew", { backend: true });
    const pub = (await (await t.publish(key)).json()) as { id: string; editToken: string };
    const auth = { authorization: `Bearer ${pub.editToken}` };
    // Healthy first.
    expect((await t.api("PUT", `/api/sites/${pub.id}/kv/a`, { value: 1 }, auth)).status).toBe(200);
    const ok = (await (await t.admin("GET", "/backend/check")).json()) as {
      kv: { ok: boolean };
      files: { ok: boolean };
    };
    expect(ok.kv.ok && ok.files.ok).toBe(true);

    for (const m of ["kvGet", "kvList", "kvSet", "kvDelete", "kvCount"] as const) {
      vi.spyOn(t.backend, m).mockRejectedValue(authError("kv"));
    }
    for (const m of ["filesList", "fileUpload", "fileGet"] as const) {
      vi.spyOn(t.backend, m).mockRejectedValue(authError("r2"));
    }
    const calls: [string, string, unknown?][] = [
      ["GET", `/api/sites/${pub.id}/kv/a`],
      ["GET", `/api/sites/${pub.id}/kv`],
      ["PUT", `/api/sites/${pub.id}/kv/a`, { value: 2 }],
      ["GET", `/api/sites/${pub.id}/files`],
    ];
    for (const [method, path, body] of calls) {
      const res = await t.api(method, path, body, auth);
      expect(res.status, `${method} ${path}`).toBe(503);
      const j = (await res.json()) as { error: { code: string; message: string } };
      expect(j.error.code).toBe("BACKEND_UNAVAILABLE");
      expect(res.headers.get("retry-after")).toBe("60");
    }
    const bad = (await (await t.admin("GET", "/backend/check")).json()) as {
      kv: { ok: boolean; status: number; error: string };
      files: { ok: boolean; status: number };
    };
    expect(bad.kv).toMatchObject({ ok: false, status: 401 });
    expect(bad.kv.error).toContain("Workers KV Storage: Edit");
    expect(bad.files).toMatchObject({ ok: false, status: 401 });
    // The admin settings page shows the failing store.
    const b = await t.adminBrowser();
    const page = await (await b.get("/admin/settings")).text();
    expect(page).toContain("KV store (live check)");
    expect(page).toContain("Failing");
    expect((await t.api("GET", "/api/admin/backend/check")).status).toBe(401);
  });
});
