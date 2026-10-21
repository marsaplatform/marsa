/**
 * 0.15.2: a permissions checklist for the Cloudflare tokens Spaces uses. Each line is
 * verified by one harmless read (GET, or a read-only query POST) — nothing is created,
 * changed or deleted. Results are cached for a few minutes; token values never leave
 * the server and Cloudflare error text is scrubbed of anything token-shaped.
 */
import type { CloudflareWorkersApi } from "./cf-workers.js";

export type PermState = "granted" | "missing" | "unchecked";
export interface PermCheck {
  id: string;
  /** The Cloudflare permission to add to the token. */
  permission: string;
  /** Feature keys this unlocks (labels in the UI). */
  unlocks: string;
  required: boolean;
  state: PermState;
  /** Short reason: Cloudflare's error, "edit confirmed by …", "not probed …". */
  note: string | null;
  status: number | null;
}
export interface PermReport {
  token: "workers" | "backend";
  configured: boolean;
  checks: PermCheck[];
  granted: number;
  required: number;
  at: string;
}

export interface WorkersPermInput {
  api: CloudflareWorkersApi;
  token: string;
  accountId: string;
  zoneId: string | null;
  /** A Spaces-managed script to read settings/secrets/tails from (null = none yet). */
  sampleScript: string | null;
  /** Last successful Spaces deploy (evidence that Workers Scripts: Edit works). */
  lastDeployAt: string | null;
  now: number;
}

const mk = (
  id: string,
  permission: string,
  unlocks: string,
  required: boolean,
  r: { ok: boolean; status: number; message: string | null } | null,
  note: string | null = null,
): PermCheck => ({
  id,
  permission,
  unlocks,
  required,
  state: r === null ? "unchecked" : r.ok ? "granted" : "missing",
  note: r && !r.ok ? (r.message ?? `HTTP ${r.status}`) : note,
  status: r ? r.status : null,
});

const summary = (token: PermReport["token"], checks: PermCheck[], now: number): PermReport => ({
  token,
  configured: true,
  checks,
  granted: checks.filter((c) => c.required && c.state === "granted").length,
  required: checks.filter((c) => c.required).length,
  at: new Date(now).toISOString(),
});

async function verifyToken(api: CloudflareWorkersApi, token: string, accountId: string) {
  const u = await api.readProbe(token, "/user/tokens/verify");
  return u.ok ? u : api.readProbe(token, `/accounts/${accountId}/tokens/verify`);
}

/** The Workers (platform) token: every capability Spaces uses, read-only probes. */
export async function checkWorkersToken(i: WorkersPermInput): Promise<PermReport> {
  const { api, token, accountId: acc } = i;
  const A = `/accounts/${acc}`;
  const s = i.sampleScript;
  const hasZone = !!i.zoneId;
  const [verify, scripts, sub, settings, secrets, tails, zone, routes, dns, kv, r2] =
    await Promise.all([
      verifyToken(api, token, acc),
      api.readProbe(token, `${A}/workers/scripts`),
      api.readProbe(token, `${A}/workers/subdomain`),
      s ? api.readProbe(token, `${A}/workers/scripts/${s}/settings`) : null,
      s ? api.readProbe(token, `${A}/workers/scripts/${s}/secrets`) : null,
      s ? api.readProbe(token, `${A}/workers/scripts/${s}/tails`) : null,
      hasZone ? api.readProbe(token, `/zones/${i.zoneId}`) : null,
      hasZone ? api.readProbe(token, `/zones/${i.zoneId}/workers/routes`) : null,
      hasZone ? api.readProbe(token, `/zones/${i.zoneId}/dns_records?per_page=1`) : null,
      api.readProbe(token, `${A}/storage/kv/namespaces?per_page=1`),
      api.readProbe(token, `${A}/r2/buckets?per_page=1`),
    ]);
  // Account Analytics: one tiny GraphQL read.
  const g = await api.graphql<unknown>(
    token,
    `query P($acc: String!, $since: Time!, $until: Time!) { viewer { accounts(filter: { accountTag: $acc }) {
      workersInvocationsAdaptive(limit: 1, filter: { datetime_geq: $since, datetime_leq: $until }) { sum { requests } } } } }`,
    {
      acc,
      since: new Date(i.now - 3_600_000).toISOString(),
      until: new Date(i.now).toISOString(),
    },
  );
  const analytics = {
    ok: g.status === 200 && !g.errors.length,
    status: g.status,
    message: g.errors.join("; ").slice(0, 300) || null,
  };
  // Workers Logs: a read-only events query over the last minute (dry: nothing is saved).
  const obs = await api.readProbe(token, `${A}/workers/observability/telemetry/query`, {
    queryId: "marsa-spaces-permission-check",
    view: "events",
    limit: 1,
    dry: true,
    timeframe: { from: i.now - 60_000, to: i.now },
    parameters: {},
  });
  // A 400 means the token got through auth and only the query shape was refused.
  const obsR = !obs.ok && obs.status === 400 ? { ok: true, status: 400, message: null } : obs;
  const editNote = i.lastDeployAt
    ? `edit confirmed by a successful deploy (${i.lastDeployAt})`
    : "read OK; edit is confirmed by the first deploy";
  const checks: PermCheck[] = [
    mk("token", "Token is active", "everything", true, verify),
    mk(
      "scripts",
      "Account · Workers Scripts: Edit",
      "deploy",
      true,
      scripts,
      scripts.ok ? editNote : null,
    ),
    s
      ? mk(
          "settings",
          "Account · Workers Scripts: Edit (script settings + secrets)",
          "env",
          true,
          settings && secrets && !settings.ok ? settings : (secrets ?? settings),
        )
      : mk(
          "settings",
          "Account · Workers Scripts: Edit (script settings + secrets)",
          "env",
          true,
          null,
          "no Spaces Worker yet to read",
        ),
    mk("analytics", "Account · Account Analytics: Read", "usage", true, analytics),
    mk("observability", "Account · Workers Observability: Read", "logs", true, obsR),
    ...(hasZone
      ? [
          mk("zone", "Zone · Zone: Read", "hosts", true, zone),
          mk("routes", "Zone · Workers Routes: Edit", "hosts", true, routes),
          mk("dns", "Zone · DNS: Edit", "hosts", true, dns),
        ]
      : []),
    mk(
      "subdomain",
      "Account · Workers Scripts (workers.dev subdomain)",
      "workersdev",
      !hasZone,
      sub,
    ),
    s
      ? mk("tail", "Account · Workers Tail: Read", "tail", false, tails)
      : mk(
          "tail",
          "Account · Workers Tail: Read",
          "tail",
          false,
          null,
          "no Spaces Worker yet to read",
        ),
    mk("kv", "Account · Workers KV Storage: Edit", "kvbind", false, kv),
    mk("r2", "Account · Workers R2 Storage: Edit", "r2bind", false, r2),
  ];
  return summary("workers", checks, i.now);
}

export interface BackendPermInput {
  api: CloudflareWorkersApi;
  token: string;
  accountId: string;
  kvNamespaceId: string;
  /** probeBackend(): one KV list and one R2 list on a prefix no site uses. */
  probe: () => Promise<{
    kv: { ok: boolean; status?: number; error?: string };
    files: { ok: boolean; status?: number; error?: string };
  }>;
  now: number;
}

/** The data/files backend token (KV) and R2 keys. */
export async function checkBackendToken(i: BackendPermInput): Promise<PermReport> {
  const verify = await verifyToken(i.api, i.token, i.accountId);
  const ns = await i.api.readProbe(
    i.token,
    `/accounts/${i.accountId}/storage/kv/namespaces/${i.kvNamespaceId}`,
  );
  const p = await i.probe().catch(() => null);
  const asR = (x: { ok: boolean; status?: number; error?: string } | undefined) =>
    x ? { ok: x.ok, status: x.status ?? (x.ok ? 200 : 0), message: x.error ?? null } : null;
  const checks: PermCheck[] = [
    mk("token", "Token is active", "everything", true, verify),
    mk("kv-ns", "Account · Workers KV Storage: Read (namespace)", "kv", true, ns),
    mk(
      "kv",
      "Account · Workers KV Storage: Edit",
      "kv",
      true,
      asR(p?.kv),
      p?.kv.ok ? "list OK; writes are not probed (no mutations)" : null,
    ),
    mk(
      "r2",
      "R2 access keys: Object Read & Write (bucket)",
      "files",
      true,
      asR(p?.files),
      p?.files.ok ? "list OK; writes are not probed (no mutations)" : null,
    ),
  ];
  return summary("backend", checks, i.now);
}

/** A tiny time cache so the settings page does not re-probe on every view. */
export class PermCache {
  private v = new Map<string, { at: number; r: PermReport }>();
  constructor(
    private readonly now: () => number,
    private readonly ttlMs = 5 * 60_000,
  ) {}
  get(k: string): PermReport | null {
    const h = this.v.get(k);
    return h && this.now() - h.at < this.ttlMs ? h.r : null;
  }
  set(k: string, r: PermReport) {
    this.v.set(k, { at: this.now(), r });
  }
  clear() {
    this.v.clear();
  }
}
