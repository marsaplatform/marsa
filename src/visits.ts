import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Privacy-respecting visit counts.
 *
 * - Counts HTML page views per site per UTC day. No cookies, no IP or user agent is stored or logged,
 *   no third parties.
 * - "Visitors" is an approximation: within one UTC hour, a visitor is a distinct
 *   sha256(hourly random salt + site + IP + user agent). The salt lives only in memory and is replaced
 *   every hour, so hashes can't be linked across hours or recomputed later. Only the per-day totals
 *   are kept. Visitors with Do Not Track or Global Privacy Control count as views only.
 * - Obvious bots and link-preview fetchers (by user agent) and prefetches aren't counted.
 * - Counts are buffered in memory and flushed to <dataDir>/sites/<id>/visits.json (removed with the
 *   site) every few seconds. They never touch the KV backend, which has a small daily write limit.
 */

export const BOT_UA =
  /bot\b|bot\/|crawl|spider|slurp|scrap|curl\/|wget|python-|httpx|aiohttp|go-http|okhttp|java\/|libwww|axios|node-fetch|undici|headless|phantom|puppeteer|playwright|lighthouse|pagespeed|preview|embed|facebookexternalhit|whatsapp|telegram|discord|slack|skype|monitor|uptime|pingdom|validator|feed|rss|archive|^mozilla\/5\.0$/i;

export function isBot(ua: string): boolean {
  return ua.trim().length < 12 || BOT_UA.test(ua);
}

export type DayCounts = Record<string, [views: number, visitors: number]>;

export interface VisitSummary {
  views7: number;
  views30: number;
  visitors7: number;
  visitors30: number;
  today: number;
  /** Last 30 UTC days, oldest first. */
  days: { day: string; views: number; visitors: number }[];
}

export interface VisitHit {
  ip: string;
  ua: string;
  /** Do Not Track / Global Privacy Control: count the view, skip the visitor hash. */
  noTrack: boolean;
}

const ID_RE = /^[a-z0-9]{6,32}$/;
const DAY = 86_400_000;
const MAX_SEEN = 100_000;
export const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

export class VisitCounter {
  private readonly sitesDir: string;
  private pending = new Map<string, DayCounts>();
  private seen = new Set<string>();
  private salt = randomBytes(32);
  private saltHour = -1;
  private flushing: Promise<void> | null = null;

  constructor(
    dataDir: string,
    private readonly opts: { enabled: boolean; retentionDays: number },
    private readonly now: () => number = Date.now,
  ) {
    this.sitesDir = join(resolve(dataDir), "sites");
  }

  get enabled() {
    return this.opts.enabled;
  }

  /** Count one HTML page view (in memory). */
  record(siteId: string, hit: VisitHit): void {
    if (!this.opts.enabled || !ID_RE.test(siteId) || isBot(hit.ua)) return;
    const t = this.now();
    const hour = Math.floor(t / 3_600_000);
    if (hour !== this.saltHour) {
      this.salt = randomBytes(32);
      this.saltHour = hour;
      this.seen.clear();
    }
    let isNew = false;
    if (!hit.noTrack) {
      const h = createHash("sha256")
        .update(this.salt)
        .update(`\0${siteId}\0${hit.ip}\0${hit.ua}`)
        .digest("base64url")
        .slice(0, 22);
      if (!this.seen.has(h)) {
        if (this.seen.size < MAX_SEEN) this.seen.add(h);
        isNew = true;
      }
    }
    const day = dayKey(t);
    const site = this.pending.get(siteId) ?? {};
    const cur = site[day] ?? [0, 0];
    site[day] = [cur[0] + 1, cur[1] + (isNew ? 1 : 0)];
    this.pending.set(siteId, site);
  }

  /** Forget a site (called when it is deleted; its visits.json goes with the site directory). */
  purge(siteId: string): void {
    this.pending.delete(siteId);
  }

  private file(siteId: string) {
    return join(this.sitesDir, siteId, "visits.json");
  }

  private async readDisk(siteId: string): Promise<DayCounts> {
    try {
      const raw = JSON.parse(await readFile(this.file(siteId), "utf8")) as { days?: DayCounts };
      return raw.days && typeof raw.days === "object" ? raw.days : {};
    } catch {
      return {};
    }
  }

  /** Write buffered counts to disk. Safe to call often; concurrent calls share one run. */
  flush(): Promise<void> {
    this.flushing ??= this.doFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async doFlush(): Promise<void> {
    const batch = this.pending;
    this.pending = new Map();
    const oldest = dayKey(this.now() - (this.opts.retentionDays - 1) * DAY);
    for (const [siteId, add] of batch) {
      const dir = join(this.sitesDir, siteId);
      // Deleted meanwhile: drop the counts rather than recreating the directory.
      if (!(await stat(join(dir, "meta.json")).catch(() => null))) continue;
      try {
        const days = await this.readDisk(siteId);
        for (const [day, [v, u]] of Object.entries(add)) {
          const cur = days[day] ?? [0, 0];
          days[day] = [cur[0] + v, cur[1] + u];
        }
        for (const day of Object.keys(days)) if (day < oldest) delete days[day];
        const tmp = join(dir, `.visits-${randomBytes(4).toString("hex")}.tmp`);
        await mkdir(dir, { recursive: true });
        await writeFile(tmp, JSON.stringify({ v: 1, days }));
        await rename(tmp, this.file(siteId)).catch(async (err) => {
          await rm(tmp, { force: true });
          throw err;
        });
      } catch (err) {
        console.error(`[visits] flush for ${siteId} failed`, err);
      }
    }
  }

  /** Stored + buffered counts for the last 30 UTC days. */
  async summary(siteId: string): Promise<VisitSummary> {
    const days = ID_RE.test(siteId) ? await this.readDisk(siteId) : {};
    for (const [day, [v, u]] of Object.entries(this.pending.get(siteId) ?? {})) {
      const cur = days[day] ?? [0, 0];
      days[day] = [cur[0] + v, cur[1] + u];
    }
    const t = this.now();
    const list: VisitSummary["days"] = [];
    for (let i = 29; i >= 0; i--) {
      const day = dayKey(t - i * DAY);
      const [views, visitors] = days[day] ?? [0, 0];
      list.push({ day, views, visitors });
    }
    const sum = (n: number, k: "views" | "visitors") =>
      list.slice(-n).reduce((a, d) => a + d[k], 0);
    return {
      views7: sum(7, "views"),
      views30: sum(30, "views"),
      visitors7: sum(7, "visitors"),
      visitors30: sum(30, "visitors"),
      today: list[list.length - 1]?.views ?? 0,
      days: list,
    };
  }
}
