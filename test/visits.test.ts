import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isBot } from "../src/visits.js";
import { HOUR, makeApp } from "./helpers.js";

type App = Awaited<ReturnType<typeof makeApp>>;
let t: App;
afterEach(async () => {
  await t?.cleanup();
});
type Site = { id: string; editToken: string };

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";
const UA2 = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1";
const visit = (app: App, id: string, path = "/", h: Record<string, string> = {}, method = "GET") =>
  app.app.request(`/s/${id}${path}`, {
    method,
    headers: { "user-agent": UA, "x-real-ip": "203.0.113.9", ...h },
  });

async function setup(env: Record<string, string> = {}) {
  t = await makeApp({ TRUST_PROXY: "true", ...env });
  const team = await t.createTeam("Visits team", { permanent: true });
  const site = (await (
    await t.publish(team.key, "<title>Count me</title><h1>x</h1>", "?permanent=1", [
      { path: "style.css", content: "h1{}" },
      { path: "about/index.html", content: "<p>about</p>" },
    ])
  ).json()) as Site;
  return { team, site };
}

describe("visit counts", () => {
  it("counts HTML page views only, skipping bots, previews, prefetch and HEAD", async () => {
    const { site } = await setup();
    expect((await visit(t, site.id)).status).toBe(200);
    await visit(t, site.id, "/about/");
    await visit(t, site.id, "/style.css");
    await visit(t, site.id, "/missing.html");
    await visit(t, site.id, "/", {}, "HEAD");
    await visit(t, site.id, "/", { "user-agent": "curl/8.5.0" });
    await visit(t, site.id, "/", { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" });
    await visit(t, site.id, "/", { "user-agent": "WhatsApp/2.23.20.0" });
    await visit(t, site.id, "/", { "user-agent": "" });
    await visit(t, site.id, "/", { "sec-purpose": "prefetch;prerender" });
    const v = await t.visits.summary(site.id);
    expect(v.today).toBe(2);
    expect(v.views7).toBe(2);
    expect(v.days).toHaveLength(30);
  });

  it("approximates visitors with an hourly salted hash and honours DNT/GPC", async () => {
    const { site } = await setup();
    await visit(t, site.id);
    await visit(t, site.id, "/about/");
    await visit(t, site.id, "/", { "user-agent": UA2 });
    await visit(t, site.id, "/", { "x-real-ip": "198.51.100.7" });
    await visit(t, site.id, "/", { dnt: "1", "x-real-ip": "192.0.2.1" });
    await visit(t, site.id, "/", { "sec-gpc": "1", "x-real-ip": "192.0.2.2" });
    let v = await t.visits.summary(site.id);
    expect(v.views7).toBe(6);
    expect(v.visitors7).toBe(3);
    t.clock.now += HOUR; // new salt: the same person counts again in the next hour
    await visit(t, site.id);
    v = await t.visits.summary(site.id);
    expect(v.visitors7).toBe(4);
  });

  it("flushes compact per-day counts next to the site, with no IPs or user agents", async () => {
    const { site } = await setup();
    await visit(t, site.id);
    await t.visits.flush();
    t.clock.now += 24 * HOUR;
    await visit(t, site.id);
    await visit(t, site.id, "/", { "user-agent": UA2 });
    await t.visits.flush();
    const raw = await readFile(join(t.dir, "sites", site.id, "visits.json"), "utf8");
    expect(raw).not.toMatch(/203\.0\.113|Mozilla|iPhone/);
    const json = JSON.parse(raw) as { v: number; days: Record<string, [number, number]> };
    expect(json.v).toBe(1);
    expect(json.days).toEqual({ "2026-01-01": [1, 1], "2026-01-02": [2, 2] });
    // Buffered + stored add up.
    await visit(t, site.id);
    const v = await t.visits.summary(site.id);
    expect(v.today).toBe(3);
    expect(v.views30).toBe(4);
    // Old days are pruned (default retention 90 days).
    t.clock.now += 100 * 24 * HOUR;
    await visit(t, site.id);
    await t.visits.flush();
    const later = JSON.parse(
      await readFile(join(t.dir, "sites", site.id, "visits.json"), "utf8"),
    ) as { days: Record<string, unknown> };
    expect(Object.keys(later.days)).toEqual(["2026-04-12"]);
  });

  it("purges counts when the site is deleted, and a late flush doesn't recreate it", async () => {
    const { site } = await setup();
    await visit(t, site.id);
    await t.visits.flush();
    await visit(t, site.id);
    const del = await t.api("DELETE", `/api/sites/${site.id}`, undefined, {
      authorization: `Bearer ${site.editToken}`,
    });
    expect(del.status).toBe(204);
    await t.visits.flush();
    expect(await stat(join(t.dir, "sites", site.id)).catch(() => null)).toBeNull();
    expect((await t.visits.summary(site.id)).views30).toBe(0);
  });

  it("shows sparklines on the dashboard, a chart on the site page and totals in admin", async () => {
    const { team, site } = await setup();
    for (let i = 0; i < 3; i++) await visit(t, site.id);
    const { b } = await t.signIn(team.key);
    const dash = await (await b.get("/team")).text();
    expect(dash).toContain('class="spark"');
    expect(dash).toContain("7 d: 3 · 30 d: 3");
    const page = await (await b.get(`/team/sites/${site.id}`)).text();
    expect(page).toContain('id="visits-title"');
    expect(page).toContain("no cookies, no IP addresses stored");
    expect(page).toContain("2026-01-01: 3 views, 1 visitors");
    const ar = await (await b.get(`/ar/team/sites/${site.id}`)).text();
    expect(ar).toContain("الزيارات");
    const admin = await t.adminBrowser();
    const sites = await (await admin.get("/admin/sites")).text();
    expect(sites).toContain("3 page views in the last 30 days");
    expect(sites).toContain('class="spark"');
  });

  it("sets no cookies on served pages and can be turned off", async () => {
    const { site, team } = await setup({ VISITS: "false" });
    const res = await visit(t, site.id);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect((await t.visits.summary(site.id)).views30).toBe(0);
    const { b } = await t.signIn(team.key);
    expect(await (await b.get(`/team/sites/${site.id}`)).text()).toContain(
      "Visit counting is turned off",
    );
  });

  it("recognises common bots and keeps real browsers", () => {
    for (const ua of [
      "",
      "Mozilla/5.0",
      "python-requests/2.31",
      "Slackbot-LinkExpanding 1.0",
      "Mozilla/5.0 (compatible; bingbot/2.0)",
      "HeadlessChrome/120",
    ]) {
      expect(isBot(ua)).toBe(true);
    }
    for (const ua of [UA, UA2]) expect(isBot(ua)).toBe(false);
  });
});
