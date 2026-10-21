/**
 * 0.15.2: Cloudflare analytics and logs for Spaces Workers, read-only.
 * - Usage: GraphQL `workersInvocationsAdaptive` (requests, errors, CPU) per script for
 *   24h / 7d / 30d, cached; plus a 24h snapshot for every Spaces script at once (sparklines).
 * - Logs: Workers Logs (`…/workers/observability/telemetry/query`) when the token and the
 *   script allow it, otherwise the hourly error counts by status from GraphQL.
 * Every message is passed through the secret redactor before it is stored or shown.
 */
import { redactSecrets } from "./agent-notes.js";
import type { CfAccess, CloudflareWorkersApi } from "./cf-workers.js";
import { CfError } from "./cf-workers.js";

export type UsageRange = "24h" | "7d" | "30d";
export const USAGE_RANGES: UsageRange[] = ["24h", "7d", "30d"];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface UsagePoint {
  /** ISO start of the bucket (hour or day). */
  t: string;
  requests: number;
  errors: number;
  /** Median CPU time in ms (request-weighted across statuses). */
  cpuMs: number | null;
}
export interface UsageSeries {
  range: UsageRange;
  points: UsagePoint[];
  total: { requests: number; errors: number; cpuMs: number | null };
  /** Error requests by status, e.g. scriptThrewException: 3. */
  byStatus: Record<string, number>;
  at: string;
  error: string | null;
}

export interface LogEntry {
  at: string;
  level: "error" | "warn" | "info" | "log" | "debug";
  source: "workers-logs" | "analytics" | "health" | "deploy";
  kind: string;
  message: string;
  status: number | null;
  url: string | null;
}
export interface LogsResult {
  entries: LogEntry[];
  /** Workers Logs available for this script with the current token? */
  workersLogs: "ok" | "off" | "denied" | "error" | "unknown";
  workersLogsError: string | null;
  analytics: "ok" | "denied" | "error";
  analyticsError: string | null;
  at: string;
}

interface Gql {
  viewer?: {
    accounts?: {
      workersInvocationsAdaptive?: {
        sum?: { requests?: number; errors?: number };
        quantiles?: { cpuTimeP50?: number };
        dimensions?: { scriptName?: string; datetimeHour?: string; date?: string; status?: string };
      }[];
    }[];
  };
}

const Q_HOURLY = `query MarsaUsage($acc: String!, $since: Time!, $until: Time!, $scripts: [String!]) {
  viewer { accounts(filter: { accountTag: $acc }) {
    workersInvocationsAdaptive(limit: 10000, filter: { datetime_geq: $since, datetime_leq: $until, scriptName_in: $scripts }) {
      sum { requests errors }
      quantiles { cpuTimeP50 }
      dimensions { scriptName datetimeHour status }
    } } } }`;
const Q_DAILY = `query MarsaUsageDaily($acc: String!, $since: Time!, $until: Time!, $scripts: [String!]) {
  viewer { accounts(filter: { accountTag: $acc }) {
    workersInvocationsAdaptive(limit: 10000, filter: { datetime_geq: $since, datetime_leq: $until, scriptName_in: $scripts }) {
      sum { requests errors }
      quantiles { cpuTimeP50 }
      dimensions { scriptName date status }
    } } } }`;

export interface AnalyticsDeps {
  /** Runs fn with the platform token and client (WorkerService.withCf). */
  withCf: <T>(fn: (a: CfAccess, api: CloudflareWorkersApi) => Promise<T>) => Promise<T>;
  now: () => number;
  ttlMs?: number;
}

const floorHour = (t: number) => Math.floor(t / HOUR) * HOUR;
const floorDay = (t: number) => Math.floor(t / DAY) * DAY;

export class WorkerAnalytics {
  private cache = new Map<string, { at: number; v: unknown }>();
  private inflight = new Map<string, Promise<unknown>>();
  private readonly ttl: number;

  constructor(private readonly d: AnalyticsDeps) {
    this.ttl = d.ttlMs ?? 5 * 60_000;
  }

  private async cached<T>(key: string, fn: () => Promise<T>, force = false): Promise<T> {
    const hit = this.cache.get(key);
    if (!force && hit && this.d.now() - hit.at < this.ttl) return hit.v as T;
    const running = this.inflight.get(key);
    if (running) return running as Promise<T>;
    const p = fn()
      .then((v) => {
        this.cache.set(key, { at: this.d.now(), v });
        if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value as string);
        return v;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /** The cached value only (never calls Cloudflare); kicks a refresh when stale. */
  peek<T>(key: string, refresh: () => Promise<T>): T | null {
    const hit = this.cache.get(key);
    if (!hit || this.d.now() - hit.at >= this.ttl) void refresh().catch(() => {});
    return (hit?.v as T) ?? null;
  }

  private async query(scripts: string[], range: UsageRange) {
    const now = this.d.now();
    const span = range === "24h" ? DAY : range === "7d" ? 7 * DAY : 30 * DAY;
    const since = new Date(
      range === "30d" ? floorDay(now - span) : floorHour(now - span),
    ).toISOString();
    const until = new Date(now).toISOString();
    return this.d.withCf(async (a, api) =>
      api.graphql<Gql>(a.token, range === "30d" ? Q_DAILY : Q_HOURLY, {
        acc: a.accountId,
        since,
        until,
        scripts,
      }),
    );
  }

  private toSeries(
    rows: NonNullable<
      NonNullable<NonNullable<Gql["viewer"]>["accounts"]>[number]["workersInvocationsAdaptive"]
    >,
    range: UsageRange,
    error: string | null,
  ): UsageSeries {
    const now = this.d.now();
    const step = range === "30d" ? DAY : HOUR;
    const n = range === "24h" ? 24 : range === "7d" ? 168 : 30;
    const start = (range === "30d" ? floorDay(now) : floorHour(now)) - (n - 1) * step;
    const buckets = Array.from({ length: n }, (_, i) => ({
      t: start + i * step,
      requests: 0,
      errors: 0,
      cpuW: 0,
      cpuN: 0,
    }));
    const byStatus: Record<string, number> = {};
    for (const r of rows) {
      const dim = r.dimensions ?? {};
      const ts = Date.parse(dim.datetimeHour ?? (dim.date ? `${dim.date}T00:00:00Z` : ""));
      const req = r.sum?.requests ?? 0;
      const errs = r.sum?.errors ?? 0;
      if (dim.status && dim.status !== "success" && req)
        byStatus[dim.status] = (byStatus[dim.status] ?? 0) + req;
      if (!Number.isFinite(ts)) continue;
      const i = Math.floor((ts - start) / step);
      const b = buckets[i];
      if (!b) continue;
      b.requests += req;
      b.errors += errs;
      if (typeof r.quantiles?.cpuTimeP50 === "number" && req) {
        b.cpuW += (r.quantiles.cpuTimeP50 / 1000) * req;
        b.cpuN += req;
      }
    }
    const points = buckets.map((b) => ({
      t: new Date(b.t).toISOString(),
      requests: b.requests,
      errors: b.errors,
      cpuMs: b.cpuN ? Math.round((b.cpuW / b.cpuN) * 100) / 100 : null,
    }));
    const cpuN = buckets.reduce((s, b) => s + b.cpuN, 0);
    return {
      range,
      points,
      total: {
        requests: points.reduce((s, p) => s + p.requests, 0),
        errors: points.reduce((s, p) => s + p.errors, 0),
        cpuMs: cpuN
          ? Math.round((buckets.reduce((s, b) => s + b.cpuW, 0) / cpuN) * 100) / 100
          : null,
      },
      byStatus,
      at: new Date(now).toISOString(),
      error,
    };
  }

  /** Requests / errors / CPU for one script. */
  usage(script: string, range: UsageRange, force = false): Promise<UsageSeries> {
    return this.cached(
      `u:${script}:${range}`,
      async () => {
        try {
          const r = await this.query([script], range);
          const rows = r.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [];
          return this.toSeries(rows, range, r.errors.length ? r.errors.join("; ") : null);
        } catch (e) {
          return this.toSeries([], range, e instanceof Error ? e.message.slice(0, 200) : "error");
        }
      },
      force,
    );
  }

  /** 24h hourly requests for many scripts in one query (table sparklines), cached only. */
  snapshot(scripts: string[]): Record<string, UsageSeries> | null {
    if (!scripts.length) return {};
    const key = `s:${[...scripts].sort().join(",")}`;
    return this.peek(key, () => this.cached(key, () => this.loadSnapshot(scripts), true));
  }

  async loadSnapshot(scripts: string[]): Promise<Record<string, UsageSeries>> {
    const r = await this.query(scripts, "24h");
    const rows = r.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [];
    const out: Record<string, UsageSeries> = {};
    for (const s of scripts)
      out[s] = this.toSeries(
        rows.filter((x) => x.dimensions?.scriptName === s),
        "24h",
        r.errors.length ? r.errors.join("; ") : null,
      );
    return out;
  }

  /** Recent errors and log lines for one script (24h), newest first. */
  logs(script: string, logsOn: boolean, force = false): Promise<LogsResult> {
    return this.cached(
      `l:${script}:${logsOn ? 1 : 0}`,
      async () => {
        const now = this.d.now();
        const out: LogsResult = {
          entries: [],
          workersLogs: logsOn ? "unknown" : "off",
          workersLogsError: null,
          analytics: "ok",
          analyticsError: null,
          at: new Date(now).toISOString(),
        };
        if (logsOn) {
          try {
            const res = await this.d.withCf((a, api) =>
              api.telemetryQuery<{ events?: { events?: unknown[] } }>(a, {
                queryId: "marsa-spaces-logs",
                view: "events",
                limit: 100,
                timeframe: { from: now - DAY, to: now },
                parameters: {
                  datasets: ["cloudflare-workers"],
                  filterCombination: "and",
                  filters: [
                    { key: "$workers.scriptName", operation: "eq", type: "string", value: script },
                  ],
                },
              }),
            );
            out.workersLogs = "ok";
            for (const ev of res?.events?.events ?? []) out.entries.push(parseEvent(ev));
          } catch (e) {
            const denied = e instanceof CfError && (e.status === 401 || e.status === 403);
            out.workersLogs = denied ? "denied" : "error";
            out.workersLogsError = e instanceof Error ? e.message.slice(0, 300) : "error";
          }
        }
        // Error counts by hour and status from analytics (works without Workers Logs).
        try {
          const r = await this.query([script], "24h");
          if (r.errors.length) {
            out.analytics = r.errors.some((m) => /auth|permission|not authorized|access/i.test(m))
              ? "denied"
              : "error";
            out.analyticsError = r.errors.join("; ").slice(0, 300);
          }
          for (const row of r.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? []) {
            const st = row.dimensions?.status ?? "";
            const n = row.sum?.requests ?? 0;
            if (!st || st === "success" || !n) continue;
            const when = Date.parse(row.dimensions?.datetimeHour ?? "");
            if (Number.isFinite(when) && when < this.d.now() - 25 * 3_600_000) continue;
            out.entries.push({
              at: row.dimensions?.datetimeHour ?? out.at,
              level: st === "clientDisconnected" ? "warn" : "error",
              source: "analytics",
              kind: st,
              message: `${n} × ${st}`,
              status: null,
              url: null,
            });
          }
        } catch (e) {
          out.analytics = "error";
          out.analyticsError = e instanceof Error ? e.message.slice(0, 300) : "error";
        }
        out.entries.sort((a, b) => b.at.localeCompare(a.at));
        return out;
      },
      force,
    );
  }
}

const LEVELS = new Set(["error", "warn", "info", "log", "debug"]);

/** One Workers Logs event → a redacted log row (defensive: the schema varies). */
export function parseEvent(ev: unknown): LogEntry {
  const e = (ev ?? {}) as Record<string, unknown>;
  const meta = (e.$metadata ?? {}) as Record<string, unknown>;
  const wk = (e.$workers ?? {}) as Record<string, unknown>;
  const src = (e.source ?? {}) as Record<string, unknown>;
  const event = (wk.event ?? {}) as Record<string, unknown>;
  const req = (event.request ?? {}) as Record<string, unknown>;
  const resp = (event.response ?? {}) as Record<string, unknown>;
  const ts = Number(e.timestamp ?? meta.timestamp ?? 0);
  const outcome = String(wk.outcome ?? "");
  const rawLevel = String(meta.level ?? src.level ?? (meta.error ? "error" : "log")).toLowerCase();
  const level = (
    outcome && outcome !== "ok" ? "error" : LEVELS.has(rawLevel) ? rawLevel : "log"
  ) as LogEntry["level"];
  const text = [meta.error, meta.message, typeof src.message === "string" ? src.message : null]
    .filter((x) => typeof x === "string" && x)
    .join(" — ");
  const urlRaw =
    typeof req.url === "string" ? req.url : typeof meta.url === "string" ? meta.url : null;
  let url: string | null = null;
  if (urlRaw) {
    try {
      const u = new URL(urlRaw);
      url = `${u.pathname}`.slice(0, 200); // no query string: it may carry keys
    } catch {
      url = null;
    }
  }
  return {
    at: Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString() : new Date(0).toISOString(),
    level,
    source: "workers-logs",
    kind: outcome && outcome !== "ok" ? outcome : String(meta.type ?? wk.eventType ?? "log"),
    message: redactSecrets(text || outcome || "(no message)").text.slice(0, 1000),
    status: typeof resp.status === "number" ? resp.status : null,
    url,
  };
}
