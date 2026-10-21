import { afterEach, describe, expect, it } from "vitest";
import { makeApp } from "./helpers.js";

type App = Awaited<ReturnType<typeof makeApp>>;
let t: App | null = null;
afterEach(async () => {
  await t?.cleanup();
  t = null;
});

/** Every registered /api route, as "METHOD /path/{param}". */
export function apiRoutes(app: App["app"]): string[] {
  const out = new Set<string>();
  for (const r of (app as unknown as { routes: { method: string; path: string }[] }).routes) {
    if (!r.path.startsWith("/api/") || r.method === "ALL" || r.path.includes("*")) continue;
    out.add(`${r.method} ${r.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")}`);
  }
  return [...out].sort();
}

describe("0.16.0 OpenAPI covers every API route", () => {
  it("has an entry for each app.<method>('/api/…') route", async () => {
    t = await makeApp();
    const spec = (await (await t.app.request("/openapi.json")).json()) as {
      paths: Record<string, Record<string, unknown>>;
    };
    const documented = new Set<string>();
    const norm = (p: string) => p.replace(/\{[^}]+\}/g, "{}");
    for (const [p, ops] of Object.entries(spec.paths))
      for (const m of Object.keys(ops)) documented.add(`${m.toUpperCase()} ${norm(p)}`);
    const missing = apiRoutes(t.app).filter((r) => {
      const [m, p] = r.split(" ") as [string, string];
      return !documented.has(`${m} ${norm(p)}`);
    });
    expect(missing).toEqual([]);
    const ids = Object.values(spec.paths).flatMap((ops) =>
      Object.values(ops)
        .map((o) => (o as { operationId?: string }).operationId)
        .filter(Boolean),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});
