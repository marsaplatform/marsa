import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentKeyStore, ipNetwork } from "../src/agent-keys.js";
import { loadConfig } from "../src/config.js";
import { privacyHtml } from "../src/ui.js";
import { keysHelperSource } from "../src/user-keys.js";

describe("0.14.1 ipNetwork", () => {
  it("maps addresses to /24 and /64 networks", () => {
    expect(ipNetwork("203.0.113.7")).toEqual({ net: "203.0.113.0/24", fam: 4 });
    expect(ipNetwork("::ffff:203.0.113.9")).toEqual({ net: "203.0.113.0/24", fam: 4 });
    expect(ipNetwork("2001:db8:1:2:aaaa::1")).toEqual({ net: "2001:db8:1:2::/64", fam: 6 });
    expect(ipNetwork("2001:0db8:0001:0002:ffff:0:0:9")?.net).toBe("2001:db8:1:2::/64");
    expect(ipNetwork("[2001:db8::1]")?.net).toBe("2001:db8:0:0::/64");
    expect(ipNetwork("fe80::1%eth0")?.net).toBe("fe80:0:0:0::/64");
    expect(ipNetwork("unknown")).toBeNull();
    expect(ipNetwork("300.1.1.1")).toBeNull();
  });
});

describe("0.14.1 new-network alerts", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });
  it("alerts once per network, ignores dual-stack switches, re-alerts after 30 days", async () => {
    dir = await mkdtemp(join(tmpdir(), "ak141-"));
    const clock = { now: Date.parse("2026-10-21T08:00:00Z") };
    const store = new AgentKeyStore(dir, () => clock.now, "salt-for-tests-0123456789");
    await store.ready();
    const { key } = await store.create(
      "t1",
      { name: "a", scopes: ["mcp"], expiresInDays: 30 },
      "owner",
    );
    const use = async (ip: string) => (await store.touch(key, ip)).newIp;
    expect(await use("203.0.113.7")).toBe(true); // first use
    expect(await use("203.0.113.99")).toBe(false); // same /24
    clock.now += 30_000;
    expect(await use("2001:db8:1:2::5")).toBe(false); // IPv6 of the same dual-stack client
    expect(await use("2001:db8:1:2:9::7")).toBe(false); // same /64
    clock.now += 10 * 60_000;
    expect(await use("198.51.100.4")).toBe(true); // new network, not within the dual-stack window
    clock.now += 5 * 60_000;
    expect(await use("2001:db8:ffff:1::1")).toBe(true); // new IPv6 net, last v4 use 5 min ago
    clock.now += 31 * 86_400_000;
    expect(await use("203.0.113.7")).toBe(true); // forgotten after 30 days
    const raw = JSON.stringify(key);
    expect(raw).not.toContain("203.0.113");
    expect(raw).not.toContain("2001:db8");
  });
});

describe("0.14.1 helper", () => {
  it("checks every request by default; caching is opt-in", () => {
    const src = keysHelperSource("https://spaces.test");
    expect(src).toContain("helper v2");
    expect(src).toContain("Number(opts.cache) > 0 ? Number(opts.cache) : 0");
  });
});

describe("0.14.1 privacy operator", () => {
  it("uses OPERATOR_* overrides", () => {
    const c = loadConfig({
      OPERATOR_NAME: "Example Srl",
      OPERATOR_EMAIL: "privacy@example.org",
      OPERATOR_AUTHORITY: "CNIL",
      OPERATOR_AUTHORITY_URL: "https://www.cnil.fr",
    });
    const html = privacyHtml("en", c);
    expect(html).toContain("Example Srl");
    expect(html).toContain('href="mailto:privacy@example.org"');
    expect(html).toContain('href="https://www.cnil.fr"');
    expect(html).not.toContain("Data controller: marsaplatform");
    expect(html).toContain("Data controller: Example Srl");
  });
});
