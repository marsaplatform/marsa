/**
 * 0.15.2: low-cost uptime checks of Spaces Workers. Every interval (default 5 min) each
 * active Worker with monitoring on gets one request: MCP `initialize` for MCP servers that
 * do not use their own auth, otherwise a plain GET of the URL. Nothing else is called.
 * History: raw checks for 7 days plus daily totals for 30 days. A Worker goes "down" after
 * two failed checks in a row and "up" again after one good one; each change raises one
 * notification (bell + webhooks), so alerts are naturally de-duplicated.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { FetchFn } from "./cf-workers.js";
import type { NotificationCenter } from "./notify.js";
import type { WorkerRec } from "./workers.js";

const DAY = 86_400_000;
export const HEALTH_DEFAULT_SEC = 300;
export const HEALTH_MIN_SEC = 60;
export const HEALTH_MAX_SEC = 3600;
const KEEP_CHECKS = 4100;
const FAILS_FOR_DOWN = 2;

export interface HealthCheck {
  /** ms epoch */
  t: number;
  ok: 0 | 1;
  ms: number;
  /** HTTP status, 0 = no answer (timeout / network). */
  s: number;
  via: "get" | "mcp";
}

interface HealthRec {
  enabled: boolean;
  /** 0.16.0: rules version (2 = web Workers need < 400 unless they declare otherwise). */
  rules?: number;
  /** Answered 4xx at / before 0.16.0: still counted with the old "< 500" rule until the owner
   * declares a health path or expected status (so the upgrade raises no false alerts). */
  legacy?: boolean;
  /** What the last check asked and accepted ("GET / · < 400"). */
  rule?: string;
  state: "up" | "down" | "unknown";
  since: number | null;
  fails: number;
  checks: HealthCheck[];
  days: Record<string, { n: number; up: number; ms: number }>;
}

export interface HealthView {
  enabled: boolean;
  state: "up" | "down" | "unknown" | "off";
  since: string | null;
  last: (HealthCheck & { at: string }) | null;
  uptime: { h24: number | null; d7: number | null; d30: number | null };
  avgMs24: number | null;
  /** Last 24h of checks, oldest first. */
  series: HealthCheck[];
  incidents: { from: string; to: string | null; checks: number; status: number }[];
  intervalSec: number;
  /** 0.16.0: the request and the accepted statuses ("GET /health · 200-299"). */
  rule: string | null;
  /** Counted with the pre-0.16.0 "< 500" rule (answers 4xx at /); see HealthRec.legacy. */
  legacy: boolean;
}

export interface HealthDeps {
  fetch: FetchFn;
  notify?: NotificationCenter | null;
  now: () => number;
  /** MCP endpoint to check with initialize (null = plain GET). */
  mcpTarget?: (rec: WorkerRec) => string | null;
  /** 0.16.0: declared or detected type (MCP servers keep "< 500" for a plain GET). */
  kindOf?: (rec: WorkerRec) => "mcp" | "web" | "other";
  defaultIntervalSec?: number;
}

/** "/health · 2xx" for the audit log. */
export const healthRule = (rec: WorkerRec) =>
  `${rec.meta?.healthPath ?? "/"} · ${rec.meta?.healthExpect ?? "default"}`;

/** 0.16.0: a health path ("/health", "/api/ping?x=1"). */
export function readHealthPath(raw: unknown): string {
  const p = typeof raw === "string" ? raw.trim() : "";
  if (!/^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/?-]{0,199}$/.test(p))
    throw new RangeError('healthPath: a path starting with "/" (up to 200 characters)');
  return p;
}

/** 0.16.0: expected statuses: "2xx", "200-299", "200,404" or "<400" (comma-separated). */
export function readHealthExpect(raw: unknown): string {
  const v = typeof raw === "string" ? raw.replace(/\s+/g, "").toLowerCase() : "";
  const ok = (part: string) => {
    let m = /^([1-5])xx$/.exec(part);
    if (m) return true;
    m = /^(\d{3})-(\d{3})$/.exec(part);
    if (m) return valid(Number(m[1])) && valid(Number(m[2])) && Number(m[1]) <= Number(m[2]);
    m = /^<(\d{3})$/.exec(part);
    if (m) return Number(m[1]) > 100 && Number(m[1]) <= 600;
    return /^\d{3}$/.test(part) && valid(+part);
  };
  const valid = (n: number) => n >= 100 && n <= 599;
  if (!v || v.length > 60 || !v.split(",").every(ok))
    throw new RangeError('healthExpect: e.g. "2xx", "200-299", "200,404" or "<400"');
  return v;
}

/** Does status s match an expect spec (already validated)? */
export function statusMatches(spec: string, s: number): boolean {
  if (s <= 0) return false;
  return spec.split(",").some((part) => {
    if (/^[1-5]xx$/.test(part)) return Math.floor(s / 100) === Number(part[0]);
    const r = /^(\d{3})-(\d{3})$/.exec(part);
    if (r) return s >= Number(r[1]) && s <= Number(r[2]);
    if (part.startsWith("<")) return s < Number(part.slice(1));
    return s === Number(part);
  });
}

const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const pct = (up: number, n: number) => (n ? Math.round((up / n) * 10000) / 100 : null);

export class HealthMonitor {
  private recs = new Map<string, HealthRec>();
  private intervalSec: number;
  private lastTick = 0;
  private running: Promise<void> | null = null;
  private loading: Promise<void> | null = null;
  private readonly file: string;
  private writeQ: Promise<void> = Promise.resolve();

  constructor(
    dataDir: string,
    private readonly deps: HealthDeps,
  ) {
    this.file = join(resolve(dataDir), "health.json");
    this.intervalSec = clampInterval(deps.defaultIntervalSec ?? HEALTH_DEFAULT_SEC);
  }

  ready(): Promise<void> {
    this.loading ??= (async () => {
      try {
        const j = JSON.parse(await readFile(this.file, "utf8")) as {
          intervalSec?: number;
          workers?: Record<string, HealthRec>;
        };
        if (j.intervalSec) this.intervalSec = clampInterval(j.intervalSec);
        for (const [id, r] of Object.entries(j.workers ?? {})) {
          // 0.16.0 upgrade: Workers that answered 4xx to a plain GET keep the old rule
          // until their owner declares a health path or expected status.
          if (!r.rules) {
            const last = r.checks.at(-1);
            if (last?.via === "get" && last.s >= 400 && last.s < 500) r.legacy = true;
            r.rules = 2;
          }
          this.recs.set(id, r);
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    })();
    return this.loading;
  }

  private save(): Promise<void> {
    const body = JSON.stringify({
      intervalSec: this.intervalSec,
      workers: Object.fromEntries(this.recs),
    });
    this.writeQ = this.writeQ.then(async () => {
      await mkdir(resolve(this.file, ".."), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, body, { mode: 0o600 });
      await rename(tmp, this.file);
    });
    return this.writeQ;
  }

  get interval(): number {
    return this.intervalSec;
  }

  async setInterval(sec: unknown): Promise<number> {
    await this.ready();
    const n = Number(sec);
    if (!Number.isInteger(n) || n < HEALTH_MIN_SEC || n > HEALTH_MAX_SEC)
      throw new RangeError(`interval: ${HEALTH_MIN_SEC}-${HEALTH_MAX_SEC} seconds`);
    this.intervalSec = n;
    await this.save();
    return n;
  }

  private rec(id: string): HealthRec {
    let r = this.recs.get(id);
    if (!r) {
      r = {
        enabled: true,
        rules: 2,
        state: "unknown",
        since: null,
        fails: 0,
        checks: [],
        days: {},
      };
      this.recs.set(id, r);
    }
    return r;
  }

  enabled(id: string): boolean {
    return this.recs.get(id)?.enabled ?? true;
  }

  async setEnabled(id: string, on: boolean): Promise<void> {
    await this.ready();
    const r = this.rec(id);
    r.enabled = on;
    if (!on) {
      r.state = "unknown";
      r.fails = 0;
      r.since = null;
    }
    await this.save();
  }

  async purge(id: string): Promise<void> {
    await this.ready();
    if (this.recs.delete(id)) await this.save();
  }

  /** Called often by a timer; runs a round when the interval has passed. */
  async maybeTick(list: () => WorkerRec[]): Promise<void> {
    await this.ready();
    if (this.running) return;
    if (this.deps.now() - this.lastTick < this.intervalSec * 1000) return;
    await this.tick(list());
  }

  /** One round over the given Workers (4 at a time). */
  async tick(list: WorkerRec[]): Promise<void> {
    await this.ready();
    if (this.running) return this.running;
    this.lastTick = this.deps.now();
    const todo = list.filter((w) => w.status === "active" && w.url && this.enabled(w.id));
    this.running = (async () => {
      const q = [...todo];
      await Promise.all(
        Array.from({ length: Math.min(4, q.length) }, async () => {
          for (let w = q.shift(); w; w = q.shift()) await this.checkOne(w, false);
        }),
      );
      await this.save();
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Check one Worker now (also used by the "check now" button). */
  async checkOne(w: WorkerRec, persist = true): Promise<HealthCheck> {
    await this.ready();
    // A declared health path always gets a plain GET; otherwise MCP servers get initialize.
    const path = w.meta?.healthPath ?? null;
    const expect = w.meta?.healthExpect ?? null;
    const endpoint = path ? null : (this.deps.mcpTarget?.(w) ?? null);
    const target = path ? `${w.url.replace(/\/$/, "")}${path}` : w.url;
    const t0 = this.deps.now();
    let s = 0;
    try {
      const res = endpoint
        ? await this.deps.fetch(endpoint, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
              "user-agent": "MarsaSpaces-Health/1.0",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: {
                protocolVersion: "2025-06-18",
                capabilities: {},
                clientInfo: { name: "marsa-spaces-health", version: "1" },
              },
            }),
            redirect: "manual",
            signal: AbortSignal.timeout(10_000),
          })
        : await this.deps.fetch(target, {
            method: "GET",
            headers: { "user-agent": "MarsaSpaces-Health/1.0" },
            redirect: "manual",
            signal: AbortSignal.timeout(10_000),
          });
      s = res.status;
      await res.body?.cancel().catch(() => {});
    } catch {
      s = 0;
    }
    const ms = Math.max(0, this.deps.now() - t0);
    // 0.16.0: a declared expected status wins. Otherwise: MCP initialize needs 2xx or 401/403
    // (own auth); a plain GET needs < 400 for web Workers and < 500 for MCP servers (whose
    // own auth answers 401). Pre-0.16.0 Workers that answered 4xx keep "< 500" (legacy).
    const rec = this.rec(w.id);
    if (path || expect) rec.legacy = false;
    const isMcp = (this.deps.kindOf?.(w) ?? "web") === "mcp";
    const spec = expect ?? (endpoint ? "2xx,401,403" : isMcp || rec.legacy ? "<500" : "<400");
    const ok = statusMatches(spec, s) ? 1 : 0;
    rec.rule = `${endpoint ? "MCP initialize" : `GET ${path ?? "/"}`} · ${spec}`;
    const c: HealthCheck = { t: t0, ok: ok as 0 | 1, ms, s, via: endpoint ? "mcp" : "get" };
    await this.record(w, c);
    if (persist) await this.save();
    return c;
  }

  private async record(w: WorkerRec, c: HealthCheck) {
    const r = this.rec(w.id);
    r.checks.push(c);
    const cut = this.deps.now() - 7 * DAY;
    while (
      r.checks.length &&
      ((r.checks[0] as HealthCheck).t < cut || r.checks.length > KEEP_CHECKS)
    )
      r.checks.shift();
    const d = day(c.t);
    const agg = r.days[d] ?? { n: 0, up: 0, ms: 0 };
    agg.n++;
    agg.up += c.ok;
    agg.ms += c.ms;
    r.days[d] = agg;
    const keep = new Set(Array.from({ length: 31 }, (_, i) => day(this.deps.now() - i * DAY)));
    for (const k of Object.keys(r.days)) if (!keep.has(k)) delete r.days[k];
    const prev = r.state;
    if (c.ok) {
      r.fails = 0;
      if (prev !== "up") {
        r.state = "up";
        r.since = c.t;
        if (prev === "down") await this.alert(w, "worker-recovered", c);
      }
    } else {
      r.fails++;
      if (r.fails >= FAILS_FOR_DOWN && prev !== "down") {
        r.state = "down";
        r.since = c.t;
        await this.alert(w, "worker-down", c);
      }
    }
  }

  private async alert(w: WorkerRec, kind: "worker-down" | "worker-recovered", c: HealthCheck) {
    await this.deps.notify
      ?.add({
        teamId: w.teamId,
        kind,
        actor: "health check",
        detail: `${w.name} (${c.s ? `HTTP ${c.s}` : "no answer"}, ${c.ms} ms)`,
      })
      .catch(() => {});
  }

  view(id: string): HealthView {
    const r = this.recs.get(id);
    const now = this.deps.now();
    const base: HealthView = {
      enabled: r?.enabled ?? true,
      state: r ? (r.enabled ? r.state : "off") : "unknown",
      since: r?.since ? new Date(r.since).toISOString() : null,
      last: null,
      uptime: { h24: null, d7: null, d30: null },
      avgMs24: null,
      series: [],
      incidents: [],
      intervalSec: this.intervalSec,
      rule: r?.rule ?? null,
      legacy: !!r?.legacy,
    };
    if (!r) return base;
    const last = r.checks.at(-1);
    if (last) base.last = { ...last, at: new Date(last.t).toISOString() };
    const h24 = r.checks.filter((c) => c.t >= now - DAY);
    base.series = h24;
    base.uptime.h24 = pct(
      h24.reduce((n, c) => n + c.ok, 0),
      h24.length,
    );
    base.uptime.d7 = pct(
      r.checks.reduce((n, c) => n + c.ok, 0),
      r.checks.length,
    );
    const days = Object.values(r.days);
    base.uptime.d30 = pct(
      days.reduce((n, d) => n + d.up, 0),
      days.reduce((n, d) => n + d.n, 0),
    );
    const good = h24.filter((c) => c.ok);
    base.avgMs24 = good.length
      ? Math.round(good.reduce((n, c) => n + c.ms, 0) / good.length)
      : null;
    // Runs of failed checks = incidents (newest first, at most 10).
    const inc: HealthView["incidents"] = [];
    let run: HealthCheck[] = [];
    const flush = (end: HealthCheck | null) => {
      if (run.length)
        inc.push({
          from: new Date((run[0] as HealthCheck).t).toISOString(),
          to: end ? new Date(end.t).toISOString() : null,
          checks: run.length,
          status: (run.at(-1) as HealthCheck).s,
        });
      run = [];
    };
    for (const c of r.checks) {
      if (!c.ok) run.push(c);
      else flush(c);
    }
    flush(null);
    base.incidents = inc.reverse().slice(0, 10);
    return base;
  }

  /** Small summary for table cells. */
  cell(id: string): { state: HealthView["state"]; d7: number | null; h24: number | null } {
    const v = this.view(id);
    return { state: v.state, d7: v.uptime.d7, h24: v.uptime.h24 };
  }
}

function clampInterval(n: number): number {
  return Math.min(HEALTH_MAX_SEC, Math.max(HEALTH_MIN_SEC, Math.round(n) || HEALTH_DEFAULT_SEC));
}
