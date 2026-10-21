/**
 * 0.15.2: operations around Spaces Workers — the env (vars & secrets) view, health checks,
 * analytics/logs, per end-user-key usage and the token permission checklists. Shared by the
 * team/admin API, the MCP tools and the dashboards.
 */
import { probeBackend } from "./backend/health.js";
import type { SiteBackend } from "./backend/types.js";
import {
  checkBackendToken,
  checkWorkersToken,
  PermCache,
  type PermReport,
} from "./cf-permissions.js";
import { type CfBindingInfo, CloudflareWorkersApi, type FetchFn } from "./cf-workers.js";
import type { CloudflareConfig } from "./config.js";
import type { UserKeyStore } from "./user-keys.js";
import { WorkerAnalytics } from "./worker-analytics.js";
import { buildEnvView, type EnvView } from "./worker-env.js";
import { HealthMonitor } from "./worker-health.js";
import { detectFromCode, type ProbeCache } from "./worker-insight.js";
import type { WorkerRec, WorkerService } from "./workers.js";

export interface WorkerOpsDeps {
  dataDir: string;
  workers: WorkerService;
  userKeys: UserKeyStore;
  fetch: FetchFn;
  now: () => number;
  probes?: ProbeCache | null;
  notify?: import("./notify.js").NotificationCenter | null;
  healthIntervalSec?: number;
  backend?: SiteBackend | null;
  backendConfig?: CloudflareConfig | null;
}

export interface KeyUsageRow {
  id: string;
  label: string;
  prefix: string;
  state: string;
  days: { d: string; n: number; limited: number }[];
  total: number;
  limited: number;
}

export class WorkerOps {
  readonly health: HealthMonitor;
  readonly analytics: WorkerAnalytics;
  private readonly perms: PermCache;
  private codeCache = new Map<string, string | null>();
  private envCache = new Map<
    string,
    { at: number; live: CfBindingInfo[] | null; err: string | null }
  >();

  constructor(private readonly d: WorkerOpsDeps) {
    this.health = new HealthMonitor(d.dataDir, {
      fetch: d.fetch,
      notify: d.notify ?? null,
      now: d.now,
      mcpTarget: (rec) => this.mcpTarget(rec),
      ...(d.healthIntervalSec ? { defaultIntervalSec: d.healthIntervalSec } : {}),
    });
    this.analytics = new WorkerAnalytics({
      withCf: (fn) => d.workers.withCf(fn),
      now: d.now,
    });
    this.perms = new PermCache(d.now);
  }

  async code(rec: WorkerRec): Promise<string | null> {
    const k = `${rec.id}@${rec.version ?? 0}`;
    if (this.codeCache.has(k)) return this.codeCache.get(k) ?? null;
    const v = rec.version
      ? await this.d.workers.getVersion(rec, rec.version).catch(() => null)
      : null;
    this.codeCache.set(k, v?.code ?? null);
    if (this.codeCache.size > 300)
      this.codeCache.delete(this.codeCache.keys().next().value as string);
    return v?.code ?? null;
  }

  /**
   * MCP endpoint for the health check (initialize) — only for MCP Workers whose probe did
   * not show their own auth (401/403); everything else gets a plain GET.
   */
  mcpTarget(rec: WorkerRec): string | null {
    if (!rec.url) return null;
    const code = this.codeCache.get(`${rec.id}@${rec.version ?? 0}`) ?? null;
    const isMcp = rec.meta?.kind ? rec.meta.kind === "mcp" : detectFromCode(code).kind === "mcp";
    if (!isMcp) return null;
    const p = this.d.probes?.get(rec.id, rec.version) ?? null;
    if (p && !p.ok && (p.status === 401 || p.status === 403 || p.note === "protected")) return null;
    // An MCP server with its own auth answered initialize with 401/403: check it with a GET from now on.
    const last = this.health.view(rec.id).last;
    if (last?.via === "mcp" && (last.s === 401 || last.s === 403)) return null;
    return `${rec.url.replace(/\/$/, "")}/mcp`;
  }

  /** One health round for every Spaces Worker (the timer calls this often). */
  async healthTick(force = false): Promise<void> {
    const list = this.d.workers.list();
    for (const r of list) await this.code(r);
    if (force) await this.health.tick(list);
    else await this.health.maybeTick(() => list);
  }

  /** Vars & secrets: names/types/status only. Live bindings cached for 60 s. */
  async envView(rec: WorkerRec, force = false): Promise<EnvView> {
    const now = this.d.now();
    let hit = this.envCache.get(rec.id);
    if (force || !hit || now - hit.at > 60_000) {
      let live: CfBindingInfo[] | null = null;
      let err: string | null = null;
      try {
        live = await this.d.workers.withCf((a, api) => api.scriptBindings(a, rec.script));
        if (!live) err = "the script was not found on Cloudflare";
      } catch (e) {
        err = e instanceof Error ? e.message.slice(0, 200) : "error";
      }
      hit = { at: now, live, err };
      this.envCache.set(rec.id, hit);
    }
    return buildEnvView(
      {
        vars: rec.vars,
        secrets: rec.secrets,
        ...(rec.secretsMeta ? { secretsMeta: rec.secretsMeta } : {}),
        ...(rec.varsMeta ? { varsMeta: rec.varsMeta } : {}),
        deployedAt: rec.deployedAt ?? null,
        deployedBy: rec.deployedBy,
        bindings: rec.bindings ?? [],
        requiredEnv: rec.requiredEnv ?? [],
      },
      hit.live,
      await this.code(rec),
      hit.err,
    );
  }

  forgetEnv(id: string) {
    this.envCache.delete(id);
  }

  /** Requests per end-user key per day (Spaces' own rate-limit counters). */
  keyUsage(rec: WorkerRec, days: number): KeyUsageRow[] {
    const now = this.d.now();
    const dates = Array.from({ length: days }, (_, i) =>
      new Date(now - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    );
    return this.d.userKeys
      .list(rec.id)
      .map((k) => {
        const series = dates.map((d) => ({
          d,
          n: k.days[d]?.n ?? 0,
          limited: k.days[d]?.limited ?? 0,
        }));
        return {
          id: k.id,
          label: k.label,
          prefix: k.prefix,
          state: this.d.userKeys.stateOf(k),
          days: series,
          total: series.reduce((s, x) => s + x.n, 0),
          limited: series.reduce((s, x) => s + x.limited, 0),
        };
      })
      .sort((a, b) => b.total - a.total);
  }

  /** Permission checklist for the Workers token (cached 5 min unless forced). */
  async workersPermissions(force = false): Promise<PermReport> {
    if (!force) {
      const c = this.perms.get("workers");
      if (c) return c;
    }
    const sv = this.d.workers.settingsView();
    if (!this.d.workers.configured) {
      return {
        token: "workers",
        configured: false,
        checks: [],
        granted: 0,
        required: 0,
        at: new Date(this.d.now()).toISOString(),
      };
    }
    const list = this.d.workers.list();
    const sample = list.find((r) => r.status === "active") ?? list[0] ?? null;
    const lastDeployAt =
      list
        .filter((r) => r.deployedAt && !r.lastError)
        .map((r) => r.deployedAt as string)
        .sort()
        .at(-1) ?? null;
    const r = await this.d.workers.withCf((a, api) =>
      checkWorkersToken({
        api,
        token: a.token,
        accountId: a.accountId,
        zoneId: a.zoneId ?? sv.zoneId ?? null,
        sampleScript: sample?.script ?? null,
        lastDeployAt,
        now: this.d.now(),
      }),
    );
    this.perms.set("workers", r);
    return r;
  }

  /** Permission checklist for the data/files backend token + R2 keys. */
  async backendPermissions(force = false): Promise<PermReport> {
    const cfg = this.d.backendConfig;
    const backend = this.d.backend;
    if (!cfg || !backend || backend.kind !== "cloudflare") {
      return {
        token: "backend",
        configured: false,
        checks: [],
        granted: 0,
        required: 0,
        at: new Date(this.d.now()).toISOString(),
      };
    }
    if (!force) {
      const c = this.perms.get("backend");
      if (c) return c;
    }
    const r = await checkBackendToken({
      api: new CloudflareWorkersApi(cfg.apiBase, this.d.fetch),
      token: cfg.apiToken,
      accountId: cfg.accountId,
      kvNamespaceId: cfg.kvNamespaceId,
      probe: () => probeBackend(backend),
      now: this.d.now(),
    });
    this.perms.set("backend", r);
    return r;
  }
}
