import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CF_TOKEN, FakeCfWorkers, ZONE_NAME } from "./fake-cf-workers.js";
import { makeApp } from "./helpers.js";

type App = Awaited<ReturnType<typeof makeApp>>;
let t: App;
afterEach(async () => {
  vi.restoreAllMocks();
  await t?.cleanup();
});

describe("0.16.1 Workers Observability permission label", () => {
  it("names Edit (not Read) in the checklist and explains a 403", async () => {
    const cf = new FakeCfWorkers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    t = await makeApp({ MARSA_SECRETS_KEY: "k".repeat(48) }, { cfFetch: cf.fetch });
    expect(
      (await t.admin("PUT", "/workers/settings", { token: CF_TOKEN, zone: ZONE_NAME })).status,
    ).toBe(200);
    const team = await t.createTeam("Obs");
    expect(
      (await t.admin("PUT", `/teams/${team.team.id}/workers`, { enabled: true, slug: "obs" }))
        .status,
    ).toBe(200);
    cf.denied.add("observability");
    const r = await (await t.admin("GET", "/workers/permissions?refresh=1")).json();
    const obs = r.permissions.checks.find((c: { id: string }) => c.id === "observability");
    expect(obs.permission).toBe("Account · Workers Observability: Edit (API: Write)");
    expect(obs.state).toBe("missing");
    expect(obs.note).toContain("Workers Observability: Edit (API: Write)");
    expect(obs.note).toContain("Read");
    expect(JSON.stringify(r)).not.toContain(CF_TOKEN);
    for (const prefix of ["", "/ar"]) {
      const page = await (await (await t.adminBrowser()).get(`${prefix}/admin/settings`)).text();
      expect(page).toContain("Workers Observability: Edit (API: Write)");
      expect(page).not.toContain("Workers Observability: Read");
    }
  });

  it("docs, recipes and llms.txt name Edit", async () => {
    for (const f of [
      "docs/workers.md",
      "docs/ar/workers.md",
      "docs/recipes/mcp-server-on-worker.en.md",
      "docs/recipes/mcp-server-on-worker.ar.md",
      "src/ui-ops.ts",
    ]) {
      const s = readFileSync(f, "utf8");
      expect(s, f).toContain("Workers Observability: Edit (API: Write)");
      expect(s, f).not.toContain("Workers Observability: Read");
    }
    t = await makeApp({});
    const txt = await (await t.api("GET", "/llms.txt")).text();
    expect(txt).toContain("Workers Observability: Edit (API: Write)");
  });
});
