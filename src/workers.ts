import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  CF_BINDING_MAX,
  type CfAccess,
  CfError,
  type CloudflareWorkersApi,
  type FetchFn,
  STORE_BINDING,
} from "./cf-workers.js";
import type { Actor } from "./members.js";
import { RepoError, type RepoLink, readRepo } from "./repo-status.js";
import type { SecretBox } from "./secrets.js";
import type { Team, TeamStore } from "./teams.js";
import {
  ConfigError,
  readBindings,
  readCompatDate,
  readCompatFlags,
  type ServiceBinding,
  type WorkerRuntime,
} from "./worker-config.js";
import { CronError, readCrons } from "./worker-cron.js";
import {
  ENV_NAME_RE,
  EnvError,
  readRequiredEnv,
  SECRET_MAX_BYTES,
  SYSTEM_SECRETS,
} from "./worker-env.js";
import { MetaError, readMeta, type WorkerMeta } from "./worker-insight.js";
import { CodeError, checkWorkerCode } from "./worker-validate.js";
import {
  cleanNote,
  sha256Hex,
  type VersionAction,
  type WorkerVersion,
  WorkerVersionStore,
} from "./worker-versions.js";

/**
 * Team Workers: the platform admin stores ONE Cloudflare API token (encrypted
 * at rest, write-only) and turns Workers on per team. Team owners/editors (and
 * agents with the team key or a read-write space MCP token) then deploy small
 * ES-module Workers through Spaces; Spaces calls Cloudflare on their behalf, so
 * no team ever sees the token.
 *
 * - Names are forced: script `team-<slug>-<name>`, host `<slug>-<name>.<zone>`.
 * - Spaces only ever modifies or deletes scripts, routes and DNS records it
 *   created itself (tracked in <dataDir>/workers.json). Before creating anything
 *   it checks that the script name, the hostname (any DNS record) and the route
 *   pattern are free, so existing Workers and records are never touched.
 * - Settings live in <dataDir>/settings.json (the token only as AES-GCM ciphertext).
 */

export const SLUG_RE = /^[a-z][a-z0-9]{1,19}$/;
export const WORKER_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/;
export const VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export const RESERVED_SLUGS = new Set([
  "www",
  "mail",
  "smtp",
  "mx",
  "ns",
  "api",
  "admin",
  "spaces",
  "cdn",
  "static",
  "assets",
  "auth",
]);
/** Scripts Spaces must never touch, whatever its records say. */
export const PROTECTED_SCRIPTS = new Set([
  "marsa-atlas-mcp",
  "malja-mcp",
  "erx-mcp",
  "mail-worker",
]);
export const MAX_VARS = 32;
/** One var (0.14.0: was 5 KB). Vars over Cloudflare's 5 KB binding limit ride in a module. */
export const MAX_VAR_BYTES = 32 * 1024;
/** All vars of one Worker together (names + values). */
export const MAX_VARS_TOTAL = 64 * 1024;
export const PLATFORM_AUDIT = "_platform";

export interface CfSettings {
  tokenSealed: string;
  tokenLast4: string;
  accountId: string;
  zoneName: string;
  zoneId: string;
  updatedAt: string;
  verifiedAt?: string;
  status?: string;
  /** 0.17.0: the Browser Integrity Check exception for team Worker hosts (config rule). */
  bic?: BicState;
}

/** 0.17.0: state of the Spaces-managed configuration rule (never other rules). */
export interface BicState {
  enabled: boolean;
  rulesetId?: string;
  ruleId?: string;
  hosts?: number;
  at?: string;
  lastError?: string;
}
/** The description that marks the one rule Spaces manages in the zone. */
export const BIC_RULE_REF = "marsa_spaces_bic_team_workers";
export const BIC_RULE_DESC = "Marsa Spaces: Browser Integrity Check off for team Worker hosts";

export interface SettingsView {
  configured: boolean;
  encryption: boolean;
  last4: string | null;
  accountId: string | null;
  zoneName: string | null;
  zoneId: string | null;
  updatedAt: string | null;
  verifiedAt: string | null;
  status: string | null;
}

export type WorkerStatus = "deploying" | "active" | "disabled" | "failed";
export interface WorkerRec {
  id: string;
  teamId: string;
  name: string;
  script: string;
  host: string | null;
  url: string;
  routeId?: string;
  dnsId?: string;
  vars: Record<string, string>;
  secrets: string[];
  bytes: number;
  status: WorkerStatus;
  createdAt: string;
  updatedAt: string;
  deployedAt?: string;
  deployedBy: string;
  lastError?: string;
  /** Newest stored version number (0.14.0); unset = nothing stored yet. */
  version?: number;
  /** Who disabled it (0.15.0): a team may only re-enable what it disabled itself. */
  disabledBy?: "admin" | "team";
  /** 0.15.0: unset date = the platform default. */
  compatibilityDate?: string;
  compatibilityFlags?: string[];
  /** Service bindings to Workers of the same team. */
  bindings?: ServiceBinding[];
  /** 0.15.1: declared type/stack/tools, the repo it was deployed from, a linked space. */
  meta?: WorkerMeta;
  repo?: RepoLink;
  spaceId?: string;
  /** 0.15.2: when/by whom each secret and var was last set through Spaces (names only). */
  secretsMeta?: Record<string, { at: string; by: string }>;
  varsMeta?: Record<string, { at: string; by: string }>;
  /** Env names the code needs (declared on deploy as requiredEnv). */
  requiredEnv?: string[];
  /** Workers Logs (Cloudflare observability) turned on through Spaces. */
  logs?: boolean;
  /** 0.17.0: cron triggers (UTC) and the private KV namespace bound as env.STORE. */
  crons?: string[];
  kvNamespaceId?: string;
}

export interface WorkerView {
  id: string;
  name: string;
  script: string;
  url: string;
  host: string | null;
  status: WorkerStatus;
  vars: Record<string, string>;
  secrets: string[];
  bytes: number;
  createdAt: string;
  updatedAt: string;
  deployedAt: string | null;
  deployedBy: string;
  lastError: string | null;
  /** Newest stored version, or null: no stored version yet (the next deploy is saved). */
  version: number | null;
  /** The date this Worker runs with (its own or the platform default). */
  compatibilityDate: string;
  /** True when compatibilityDate is the team's choice, false for the platform default. */
  compatibilityDateSet: boolean;
  compatibilityFlags: string[];
  bindings: ServiceBinding[];
  meta: WorkerMeta;
  repo: RepoLink | null;
  spaceId: string | null;
  requiredEnv: string[];
  logs: boolean;
  /** 0.17.0 */
  crons: string[];
  storage: "kv" | null;
}

/** Platform default compatibility date, set once by WorkerService (config). */
let defaultCompatDate = "2025-09-01";

export const workerView = (r: WorkerRec): WorkerView => ({
  id: r.id,
  name: r.name,
  script: r.script,
  url: r.url,
  host: r.host,
  status: r.status,
  vars: { ...r.vars },
  secrets: [...r.secrets],
  bytes: r.bytes,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  deployedAt: r.deployedAt ?? null,
  deployedBy: r.deployedBy,
  lastError: r.lastError ?? null,
  version: r.version ?? null,
  compatibilityDate: r.compatibilityDate ?? defaultCompatDate,
  compatibilityDateSet: !!r.compatibilityDate,
  compatibilityFlags: [...(r.compatibilityFlags ?? [])],
  bindings: (r.bindings ?? []).map((b) => ({ ...b })),
  meta: { ...(r.meta ?? {}) },
  requiredEnv: [...(r.requiredEnv ?? [])],
  logs: !!r.logs,
  crons: [...(r.crons ?? [])],
  storage: r.kvNamespaceId ? "kv" : null,
  repo: r.repo ? { ...r.repo } : null,
  spaceId: r.spaceId ?? null,
});

// ---- 0.16.0: plain var values leave list responses (7-day deprecation) ------------------
/** Default end of the deprecation period (VAR_VALUES_SUNSET overrides it). */
export const VAR_VALUES_SUNSET_DEFAULT = "2026-10-28T12:00:00Z";
/** When the change was announced (the Deprecation header). */
export const VAR_VALUES_ANNOUNCED = "2026-10-21T12:00:00Z";
export const VAR_VALUES_DOCS = "/docs/workers#var-values";

export interface VarValuesPolicy {
  /** The caller asked for values (?includeValues=1) and may have them (workers:deploy). */
  includeValues: boolean;
  now: number;
  sunset: number;
}

/**
 * A Worker as listed by GET …/workers, GET …/workers/:name and MCP list_workers.
 * Always has varNames. vars (with values) stays until the sunset, flagged as
 * deprecated; after it, only with includeValues.
 */
export function listedWorker(r: WorkerRec, p: VarValuesPolicy) {
  const v = workerView(r);
  const varNames = Object.keys(v.vars).sort();
  if (p.includeValues) return { ...v, varNames };
  if (p.now < p.sunset) return { ...v, varNames, varValuesDeprecated: true as const };
  const { vars: _values, ...rest } = v;
  return { ...rest, varNames };
}

/** The deprecation notice that goes into list responses (until the sunset, and after it). */
export function varValuesNotice(p: VarValuesPolicy, publicUrl: string) {
  if (p.includeValues) return null;
  const sunset = new Date(p.sunset).toISOString();
  return {
    field: "vars",
    sunset,
    active: p.now < p.sunset,
    message:
      p.now < p.sunset
        ? `Plain var values in list responses are deprecated and stop on ${sunset}. Read varNames; send ?includeValues=1 (needs workers:deploy) when you really need the values.`
        : "Plain var values are no longer listed. Read varNames, or send ?includeValues=1 (needs workers:deploy).",
    docs: `${publicUrl}${VAR_VALUES_DOCS}`,
  };
}

/** Deprecation (RFC 9745), Sunset (RFC 8594) and Link headers for list responses. */
export function varValuesHeaders(p: VarValuesPolicy, publicUrl: string): Record<string, string> {
  if (p.includeValues) return {};
  return {
    Deprecation: `@${Math.floor(Date.parse(VAR_VALUES_ANNOUNCED) / 1000)}`,
    Sunset: new Date(p.sunset).toUTCString(),
    Link: `<${publicUrl}${VAR_VALUES_DOCS}>; rel="deprecation"`,
  };
}

/** A stored version's runtime as deploy input (older versions: keep the current one). */
const runtimeInput = (r: WorkerRuntime | undefined): Partial<DeployInput> =>
  r
    ? {
        compatibilityDate: r.compatibilityDate ?? null,
        compatibilityFlags: r.compatibilityFlags ?? [],
        bindings: r.bindings ?? [],
      }
    : {};

export class WorkerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface DeployInput {
  name: unknown;
  code: unknown;
  vars?: unknown;
  secrets?: unknown;
  /** Optional note stored with the version (200 chars). */
  note?: unknown;
  /** 0.15.0, all optional; omitted = keep the current value on a redeploy. */
  compatibilityDate?: unknown;
  compatibilityFlags?: unknown;
  bindings?: unknown;
  /** 0.15.1: {kind, language, framework, toolsCount, spaceSlug}; {url, branch, commitSha}. */
  meta?: unknown;
  repo?: unknown;
  /** 0.15.2: env names the code needs; missing ones are flagged on the Worker page. */
  requiredEnv?: unknown;
  /** 0.17.0: cron triggers (undefined = keep, [] = remove) and private KV ("kv" | null). */
  crons?: unknown;
  storage?: unknown;
}

/** 0.17.0: hooks a caller (the jobs runner) can use to follow a deploy. */
export interface DeployHooks {
  /** Validation passed; the deploy is queued behind the team's other operations. */
  accepted?: () => void;
  /** The team's queue reached this deploy (Cloudflare calls start). */
  started?: () => void;
}

export interface WorkerLimits {
  defaultMax: number;
  defaultMaxKb: number;
  compatibilityDate: string;
  /** 0.17.0 (defaults: 10, 2, 5, 3, 100). */
  cronMinMinutes?: number;
  cronsPerTeam?: number;
  cronAccountMax?: number;
  kvPerTeam?: number;
  kvAccountMax?: number;
}

type AuditFn = (e: {
  teamId: string;
  actor: Actor;
  action: string;
  detail?: string;
}) => Promise<void>;

export class WorkerService {
  private readonly settingsFile: string;
  private readonly workersFile: string;
  private readonly tmpDir: string;
  private settings: CfSettings | null = null;
  private recs = new Map<string, WorkerRec>();
  private loading: Promise<void> | null = null;
  private writeQ: Promise<void> = Promise.resolve();
  /** 0.17.0: one queue per team (key "_platform" for settings): teams no longer wait on each other. */
  private opQ = new Map<string, Promise<unknown>>();
  /** 0.17.0: account-wide cron count (cached; Cloudflare caps cron triggers per account). */
  private cronCount: { at: number; n: number } | null = null;
  readonly versions: WorkerVersionStore;

  constructor(
    dataDir: string,
    private readonly deps: {
      box: SecretBox | null;
      api: CloudflareWorkersApi;
      teams: TeamStore;
      limits: WorkerLimits;
      audit: AuditFn;
      now: () => number;
      /** For live status probes (GET <url>). */
      probe?: FetchFn;
    },
  ) {
    const root = resolve(dataDir);
    this.settingsFile = join(root, "settings.json");
    this.workersFile = join(root, "workers.json");
    this.tmpDir = join(root, "tmp");
    this.versions = new WorkerVersionStore(dataDir);
    defaultCompatDate = deps.limits.compatibilityDate;
  }

  ready(): Promise<void> {
    this.loading ??= this.load();
    return this.loading;
  }

  private async readJson<T>(f: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(f, "utf8")) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  private async load() {
    const s = await this.readJson<{ cloudflare?: CfSettings }>(this.settingsFile);
    this.settings = s?.cloudflare ?? null;
    const w = await this.readJson<{ workers?: WorkerRec[] }>(this.workersFile);
    for (const r of w?.workers ?? []) this.recs.set(r.id, r);
  }

  private write(file: string, body: string) {
    const run = async () => {
      await mkdir(this.tmpDir, { recursive: true });
      const tmp = join(this.tmpDir, `w-${randomBytes(6).toString("hex")}.json`);
      await writeFile(tmp, body, { mode: 0o600 });
      await rename(tmp, file);
    };
    this.writeQ = this.writeQ.then(run, run);
    return this.writeQ;
  }
  private saveSettingsFile() {
    return this.write(
      this.settingsFile,
      JSON.stringify({ version: 1, cloudflare: this.settings ?? undefined }, null, 2),
    );
  }
  private saveRecs() {
    return this.write(
      this.workersFile,
      JSON.stringify({ version: 1, workers: [...this.recs.values()] }, null, 2),
    );
  }

  /**
   * One Cloudflare-changing operation at a time PER TEAM (keeps the team's quotas and name
   * checks race-free). 0.17.0: was one queue for the whole platform, so one slow deploy
   * made every other team wait.
   */
  private serial<T>(fn: () => Promise<T>, key = PLATFORM_AUDIT): Promise<T> {
    const prev = this.opQ.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    this.opQ.set(key, tail);
    void tail.then(() => {
      if (this.opQ.get(key) === tail) this.opQ.delete(key);
    });
    return run;
  }

  private iso() {
    return new Date(this.deps.now()).toISOString();
  }

  // ---- settings ---------------------------------------------------------------------------

  get encryption(): boolean {
    return !!this.deps.box;
  }
  get configured(): boolean {
    return !!this.settings && !!this.deps.box;
  }

  settingsView(): SettingsView {
    const s = this.settings;
    return {
      configured: this.configured,
      encryption: this.encryption,
      last4: s?.tokenLast4 ?? null,
      accountId: s?.accountId ?? null,
      zoneName: s?.zoneName || null,
      zoneId: s?.zoneId || null,
      updatedAt: s?.updatedAt ?? null,
      verifiedAt: s?.verifiedAt ?? null,
      status: s?.status ?? null,
    };
  }

  private token(): string {
    if (!this.deps.box) {
      throw new WorkerError(
        503,
        "SECRETS_KEY_MISSING",
        "MARSA_SECRETS_KEY is not set on the server",
      );
    }
    if (!this.settings) {
      throw new WorkerError(
        503,
        "WORKERS_NOT_CONFIGURED",
        "the admin has not set a Cloudflare token",
      );
    }
    return this.deps.box.open(this.settings.tokenSealed);
  }

  private access(): CfAccess {
    const token = this.token();
    const s = this.settings as CfSettings;
    return { token, accountId: s.accountId, ...(s.zoneId ? { zoneId: s.zoneId } : {}) };
  }

  /** Save (or update) the Cloudflare settings. The token is verified before it is stored. */
  async saveSettings(
    input: { token?: unknown; accountId?: unknown; zone?: unknown },
    actor: Actor,
  ): Promise<SettingsView> {
    if (!this.deps.box) {
      throw new WorkerError(
        503,
        "SECRETS_KEY_MISSING",
        "set MARSA_SECRETS_KEY on the server first",
      );
    }
    const box = this.deps.box;
    const newToken = typeof input.token === "string" ? input.token.trim() : "";
    if (input.token !== undefined && !/^[A-Za-z0-9_-]{20,200}$/.test(newToken)) {
      throw new WorkerError(400, "INVALID_REQUEST", "token: a Cloudflare API token");
    }
    const token = newToken || (this.settings ? box.open(this.settings.tokenSealed) : "");
    if (!token) throw new WorkerError(400, "INVALID_REQUEST", "token is required");
    const zoneName =
      typeof input.zone === "string"
        ? input.zone.trim().toLowerCase()
        : (this.settings?.zoneName ?? "");
    if (
      zoneName &&
      !/^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(zoneName)
    ) {
      throw new WorkerError(400, "INVALID_REQUEST", "zone: a domain name like example.com");
    }
    let accountId =
      typeof input.accountId === "string"
        ? input.accountId.trim()
        : (this.settings?.accountId ?? "");
    if (accountId && !/^[a-f0-9]{32}$/.test(accountId)) {
      throw new WorkerError(400, "INVALID_REQUEST", "accountId: the 32-character account id");
    }
    return this.serial(async () => {
      // Zone first: it also tells the account, which account-owned tokens need to verify.
      let zoneId = "";
      if (zoneName) {
        let z: { id: string; accountId: string } | null;
        try {
          z = await this.deps.api.zoneId(token, zoneName);
        } catch (err) {
          throw this.cfFail(err, "could not read the zone with this token");
        }
        if (!z) {
          throw new WorkerError(400, "ZONE_NOT_FOUND", `the token cannot see the zone ${zoneName}`);
        }
        zoneId = z.id;
        accountId ||= z.accountId;
      }
      let status: string;
      try {
        status = await this.deps.api.verify({ token, ...(accountId ? { accountId } : {}) });
      } catch (err) {
        throw this.cfFail(err, "the token could not be verified");
      }
      if (status !== "active") {
        throw new WorkerError(400, "TOKEN_NOT_ACTIVE", `Cloudflare says the token is ${status}`);
      }
      if (!accountId) {
        const accts = await this.deps.api.accounts(token).catch(() => []);
        if (accts.length !== 1 || !accts[0]) {
          throw new WorkerError(400, "ACCOUNT_REQUIRED", "accountId is required for this token");
        }
        accountId = accts[0].id;
      }
      const at = this.iso();
      this.settings = {
        tokenSealed: box.seal(token),
        tokenLast4: token.slice(-4),
        accountId,
        zoneName,
        zoneId,
        updatedAt: at,
        verifiedAt: at,
        status,
      };
      await this.saveSettingsFile();
      await this.deps.audit({
        teamId: PLATFORM_AUDIT,
        actor,
        action: newToken ? "cf-token-set" : "cf-settings",
        detail: zoneName || "workers.dev",
      });
      return this.settingsView();
    });
  }

  async verifySettings(): Promise<SettingsView> {
    const token = this.token();
    const s = this.settings as CfSettings;
    let status: string;
    try {
      status = await this.deps.api.verify({ token, accountId: s.accountId });
    } catch (err) {
      status = err instanceof CfError ? `error (HTTP ${err.status})` : "unreachable";
    }
    this.settings = { ...s, status, verifiedAt: this.iso() };
    await this.saveSettingsFile();
    return this.settingsView();
  }

  /** Forget the token. Refused while Workers exist (they could no longer be managed). */
  async clearSettings(actor: Actor): Promise<void> {
    if (this.recs.size) {
      throw new WorkerError(
        409,
        "WORKERS_EXIST",
        "delete every team Worker before removing the token",
      );
    }
    this.settings = null;
    await this.saveSettingsFile();
    await this.deps.audit({ teamId: PLATFORM_AUDIT, actor, action: "cf-token-clear" });
  }

  // ---- teams --------------------------------------------------------------------------------

  quotaOf(team: Team) {
    return {
      workers: team.maxWorkers || this.deps.limits.defaultMax,
      kb: team.maxWorkerKb || this.deps.limits.defaultMaxKb,
    };
  }

  /** Is the slug free and well-formed for this team? */
  slugProblem(slug: string, teamId: string): string | null {
    if (!SLUG_RE.test(slug))
      return "slug: 2-20 lowercase letters and digits, starting with a letter";
    if (RESERVED_SLUGS.has(slug)) return "slug: this name is reserved";
    if (this.deps.teams.slugTaken(slug, teamId)) {
      return "slug: another team uses it";
    }
    if (this.list(teamId).length && this.deps.teams.get(teamId)?.slug !== slug) {
      return "slug: delete the team's Workers before renaming it";
    }
    return null;
  }

  enabledFor(team: Team | null): team is Team {
    return !!team?.workers && !!team.slug;
  }

  list(teamId?: string): WorkerRec[] {
    return [...this.recs.values()]
      .filter((r) => !teamId || r.teamId === teamId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  get(id: string): WorkerRec | null {
    return this.recs.get(id) ?? null;
  }
  find(teamId: string, name: string): WorkerRec | null {
    return this.list(teamId).find((r) => r.name === name) ?? null;
  }

  hostFor(team: Team, name: string): string | null {
    const zone = this.settings?.zoneName;
    return zone && this.settings?.zoneId ? `${team.slug}-${name}.${zone}` : null;
  }
  scriptFor(team: Team, name: string): string {
    return `team-${team.slug}-${name}`;
  }

  private cfFail(err: unknown, what: string): WorkerError {
    if (err instanceof WorkerError) return err;
    if (err instanceof CfError) {
      // 0.17.0: Cloudflare refused the script itself (10021: script validation, e.g.
      // "No such module", a syntax or startup error). That is the caller's code: 400.
      if (
        err.codes.includes(10021) ||
        (err.status === 400 && /uncaught|no such module/i.test(err.message))
      ) {
        return new WorkerError(
          400,
          "VALIDATION_FAILED",
          `Cloudflare rejected the script: ${err.message}`,
        );
      }
      return new WorkerError(502, "CLOUDFLARE_ERROR", `${what}: ${err.message}`);
    }
    const detail = String((err as Error)?.message ?? "")
      .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]")
      .slice(0, 200);
    console.error(`[workers] ${what}:`, (err as Error)?.name ?? "error", detail);
    return new WorkerError(
      502,
      "CLOUDFLARE_ERROR",
      `${what}${detail ? ` (${(err as Error)?.name ?? "error"}: ${detail})` : ""}`,
    );
  }

  // ---- deploy -------------------------------------------------------------------------------

  private readMap(raw: unknown, what: string, allowNull: boolean): Record<string, string | null> {
    if (raw === undefined || raw === null) return {};
    if (typeof raw !== "object" || Array.isArray(raw)) {
      throw new WorkerError(400, "INVALID_REQUEST", `${what} must be an object of NAME: "value"`);
    }
    const out: Record<string, string | null> = {};
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length > MAX_VARS) {
      throw new WorkerError(400, "INVALID_REQUEST", `${what}: at most ${MAX_VARS} entries`);
    }
    for (const [k, v] of entries) {
      if (k.startsWith("MARSA_KEYS_")) {
        throw new WorkerError(400, "INVALID_REQUEST", `${what}: ${k} is reserved for Spaces`);
      }
      if (!VAR_NAME_RE.test(k)) {
        throw new WorkerError(
          400,
          "INVALID_REQUEST",
          `${what}: "${k.slice(0, 40)}" is not a valid name`,
        );
      }
      if (v === null && allowNull) out[k] = null;
      else if (typeof v === "string" && Buffer.byteLength(v) <= MAX_VAR_BYTES) out[k] = v;
      else
        throw new WorkerError(
          400,
          "INVALID_REQUEST",
          `${what}.${k}: a string up to ${MAX_VAR_BYTES / 1024} KB${allowNull ? " (or null to remove it)" : ""}`,
        );
    }
    return out;
  }

  /** Create or redeploy a team Worker. Every success is stored as a version. */
  async deploy(
    team: Team,
    input: DeployInput,
    actor: Actor,
    opts: { action?: VersionAction; from?: number; hooks?: DeployHooks } = {},
  ): Promise<WorkerView> {
    if (!this.enabledFor(team)) {
      throw new WorkerError(
        403,
        "WORKERS_NOT_ALLOWED",
        "Workers are not enabled for this team; ask the admin",
      );
    }
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!WORKER_NAME_RE.test(name) || name.includes("--")) {
      throw new WorkerError(
        400,
        "INVALID_NAME",
        "name: 1-30 lowercase letters, digits and single hyphens (not at the ends)",
      );
    }
    const code = typeof input.code === "string" ? input.code : "";
    const bytes = Buffer.byteLength(code);
    const q = this.quotaOf(team);
    if (!code.trim())
      throw new WorkerError(400, "INVALID_REQUEST", "code: the Worker's JavaScript (an ES module)");
    if (bytes > q.kb * 1024) {
      throw new WorkerError(
        413,
        "SCRIPT_TOO_LARGE",
        `the script is limited to ${q.kb} KB for this team`,
      );
    }
    // 0.17.0: parse the module before anything reaches Cloudflare (syntax, missing
    // imports, default export in any form) — a clear 400 instead of a failed deploy.
    try {
      await checkWorkerCode(code);
    } catch (err) {
      if (err instanceof CodeError) throw new WorkerError(400, err.code, err.message);
      throw err;
    }
    const vars = this.readMap(input.vars, "vars", false) as Record<string, string>;
    const secrets = this.readMap(input.secrets, "secrets", true);
    for (const k of Object.keys(secrets)) {
      if (k in vars)
        throw new WorkerError(400, "INVALID_REQUEST", `${k} is both a var and a secret`);
    }
    const note = cleanNote(input.note);
    let date: string | null | undefined;
    let flags: string[] | undefined;
    let wantBindings: ServiceBinding[] | undefined;
    try {
      date = readCompatDate(input.compatibilityDate, this.deps.now());
      flags = readCompatFlags(input.compatibilityFlags);
      wantBindings = readBindings(input.bindings);
    } catch (err) {
      if (err instanceof ConfigError) throw new WorkerError(400, "INVALID_REQUEST", err.message);
      throw err;
    }
    let meta: WorkerMeta | null | undefined;
    let repo: RepoLink | null | undefined;
    let requiredEnv: string[] | null | undefined;
    try {
      meta = readMeta(input.meta);
      repo = readRepo(input.repo);
      requiredEnv = readRequiredEnv(input.requiredEnv);
    } catch (err) {
      if (err instanceof MetaError || err instanceof RepoError || err instanceof EnvError)
        throw new WorkerError(400, "INVALID_REQUEST", err.message);
      throw err;
    }
    let crons: string[] | undefined;
    try {
      crons = readCrons(input.crons, this.limit("cronMinMinutes"));
    } catch (err) {
      if (err instanceof CronError)
        throw new WorkerError(400, "INVALID_CRON", `crons: ${err.message}`);
      throw err;
    }
    if (input.storage !== undefined && input.storage !== null && input.storage !== "kv") {
      throw new WorkerError(
        400,
        "INVALID_REQUEST",
        'storage: "kv" (a private KV namespace as env.STORE) or null',
      );
    }
    const storage = input.storage as "kv" | null | undefined;
    // Throws early (503) when the platform has no token.
    this.token();
    opts.hooks?.accepted?.();

    return this.serial(async () => {
      opts.hooks?.started?.();
      try {
        return await this.deployLocked(
          team,
          name,
          code,
          bytes,
          q,
          {
            vars,
            secrets,
            note,
            date,
            flags,
            wantBindings,
            meta,
            repo,
            requiredEnv,
            crons,
            storage,
            varsGiven: input.vars !== undefined,
          },
          actor,
          opts,
        );
      } catch (err) {
        const e = err instanceof WorkerError ? err : this.cfFail(err, "deploy failed");
        await this.deps
          .audit({
            teamId: team.id,
            actor,
            action: "worker-deploy-fail",
            detail: `${name}: ${e.code}: ${e.message}`.slice(0, 240),
          })
          .catch(() => {});
        throw e;
      }
    }, team.id);
  }

  private limit(
    k: "cronMinMinutes" | "cronsPerTeam" | "cronAccountMax" | "kvPerTeam" | "kvAccountMax",
  ): number {
    const d = {
      cronMinMinutes: 10,
      cronsPerTeam: 2,
      cronAccountMax: 5,
      kvPerTeam: 3,
      kvAccountMax: 100,
    };
    return this.deps.limits[k] ?? d[k];
  }
  cronQuotaOf(team: Team): number {
    return team.maxCrons || this.limit("cronsPerTeam");
  }
  kvQuotaOf(team: Team): number {
    return team.maxKvWorkers || this.limit("kvPerTeam");
  }

  /** Cron expressions on the whole account (all scripts, not only Spaces'); cached 5 min. */
  private async accountCrons(a: CfAccess): Promise<number> {
    if (this.cronCount && this.deps.now() - this.cronCount.at < 5 * 60_000) return this.cronCount.n;
    let n = 0;
    for (const sc of await this.deps.api.listScripts(a))
      n += (await this.deps.api.getSchedules(a, sc)).length;
    this.cronCount = { at: this.deps.now(), n };
    return n;
  }

  /** The deploy itself, inside the team's queue. */
  private async deployLocked(
    team: Team,
    name: string,
    code: string,
    bytes: number,
    q: { workers: number; kb: number },
    p: {
      vars: Record<string, string>;
      secrets: Record<string, string | null>;
      note: string;
      date: string | null | undefined;
      flags: string[] | undefined;
      wantBindings: ServiceBinding[] | undefined;
      meta: WorkerMeta | null | undefined;
      repo: RepoLink | null | undefined;
      requiredEnv: string[] | null | undefined;
      crons: string[] | undefined;
      storage: "kv" | null | undefined;
      varsGiven: boolean;
    },
    actor: Actor,
    opts: { action?: VersionAction; from?: number },
  ): Promise<WorkerView> {
    const { vars, secrets, note, date, flags, wantBindings, meta, repo, requiredEnv } = p;
    {
      const existing = this.find(team.id, name);
      if (!existing && this.list(team.id).length >= q.workers) {
        throw new WorkerError(409, "WORKER_QUOTA", `this team can have ${q.workers} Workers`);
      }
      const a = this.access();
      const script = existing?.script ?? this.scriptFor(team, name);
      // Omitted vars keep the current ones on a redeploy.
      const finalVars = !p.varsGiven && existing ? existing.vars : vars;
      // 0.17.0: cron triggers and private KV (undefined = keep what the Worker has).
      const wantCrons = p.crons ?? existing?.crons ?? [];
      const cronsChanged =
        p.crons !== undefined &&
        JSON.stringify(wantCrons) !== JSON.stringify(existing?.crons ?? []);
      const wantKv = p.storage === undefined ? !!existing?.kvNamespaceId : p.storage === "kv";
      if (wantKv && (STORE_BINDING in finalVars || STORE_BINDING in secrets)) {
        throw new WorkerError(
          400,
          "RESERVED_NAME",
          `${STORE_BINDING} is the private KV binding; rename the var or secret`,
        );
      }
      checkVarsFit(finalVars, code);
      if (PROTECTED_SCRIPTS.has(script) || !script.startsWith("team-")) {
        throw new WorkerError(403, "PROTECTED", "this script name is not managed by Spaces");
      }
      const host = existing ? existing.host : this.hostFor(team, name);
      const pickedDate = date === undefined ? existing?.compatibilityDate : (date ?? undefined);
      const runtime: WorkerRuntime = {
        ...(pickedDate ? { compatibilityDate: pickedDate } : {}),
        compatibilityFlags: flags ?? existing?.compatibilityFlags ?? [],
        bindings: wantBindings ?? existing?.bindings ?? [],
      };
      const services = this.resolveBindings(team, name, runtime.bindings ?? [], [
        ...Object.keys(finalVars),
        ...(existing?.secrets ?? []),
        ...Object.keys(secrets),
        ...(wantKv ? [STORE_BINDING] : []),
      ]);
      if (cronsChanged && wantCrons.length) {
        const others = this.list(team.id)
          .filter((w) => w.name !== name)
          .reduce((n, w) => n + (w.crons?.length ?? 0), 0);
        const tq = this.cronQuotaOf(team);
        if (others + wantCrons.length > tq) {
          throw new WorkerError(
            409,
            "CRON_QUOTA",
            `this team can have ${tq} cron trigger${tq === 1 ? "" : "s"} across its Workers (${others} in use)`,
          );
        }
        const acct = await this.accountCrons(this.access()).catch(() => null);
        const cap = this.limit("cronAccountMax");
        if (acct !== null && acct - (existing?.crons?.length ?? 0) + wantCrons.length > cap) {
          throw new WorkerError(
            409,
            "CRON_ACCOUNT_LIMIT",
            `the Cloudflare account has ${acct} of ${cap} cron triggers in use; ask the admin`,
          );
        }
      }
      if (wantKv && !existing?.kvNamespaceId) {
        const kq = this.kvQuotaOf(team);
        const used = this.list(team.id).filter((w) => w.kvNamespaceId && w.name !== name).length;
        if (used + 1 > kq) {
          throw new WorkerError(
            409,
            "KV_QUOTA",
            `this team can have ${kq} Workers with private storage`,
          );
        }
        const n = await this.deps.api.countKvNamespaces(this.access()).catch(() => null);
        const cap = this.limit("kvAccountMax");
        if (n !== null && n >= cap) {
          throw new WorkerError(
            409,
            "KV_ACCOUNT_LIMIT",
            `the account has ${n} KV namespaces (limit ${cap}); ask the admin`,
          );
        }
      }
      const at = this.iso();
      if (!existing) {
        try {
          if (await this.deps.api.scriptExists(a, script)) {
            throw new WorkerError(
              409,
              "NAME_TAKEN",
              `a Worker named ${script} already exists on the account`,
            );
          }
          if (host) {
            if ((await this.deps.api.dnsRecords(a, host)).length) {
              throw new WorkerError(409, "HOST_TAKEN", `${host} already has DNS records`);
            }
            const pattern = `${host}/*`;
            if (
              (await this.deps.api.listRoutes(a)).some(
                (r) => r.pattern === pattern || r.pattern === host,
              )
            ) {
              throw new WorkerError(409, "HOST_TAKEN", `a route for ${host} already exists`);
            }
          }
        } catch (err) {
          throw this.cfFail(err, "pre-flight check failed");
        }
      }
      const rec: WorkerRec = existing
        ? { ...existing, vars: existing.vars, secrets: [...existing.secrets] }
        : {
            id: `w_${randomBytes(6).toString("hex")}`,
            teamId: team.id,
            name,
            script,
            host,
            url: host ? `https://${host}` : "",
            vars: {},
            secrets: [],
            bytes: 0,
            status: "deploying",
            createdAt: at,
            updatedAt: at,
            deployedBy: actor.label,
          };
      if (!existing) {
        this.recs.set(rec.id, rec);
        await this.saveRecs();
      }
      const created = { script: false, dns: "", route: "", kv: "" };
      try {
        if (wantKv && !rec.kvNamespaceId) {
          try {
            rec.kvNamespaceId = await this.deps.api.createKvNamespace(a, `marsa-${script}`);
          } catch (err) {
            if (err instanceof CfError && (err.status === 401 || err.status === 403))
              throw new WorkerError(
                503,
                "KV_NOT_PERMITTED",
                "private storage needs the platform token permission Account · Workers KV Storage: Edit; ask the admin",
              );
            throw err;
          }
          created.kv = rec.kvNamespaceId;
        }
        await this.deps.api.putScript(a, script, {
          code,
          compatibilityDate: runtime.compatibilityDate ?? this.deps.limits.compatibilityDate,
          vars: finalVars,
          compatibilityFlags: runtime.compatibilityFlags,
          services,
          ...(rec.logs ? { observability: true } : {}),
          ...(wantKv && rec.kvNamespaceId ? { kvNamespaceId: rec.kvNamespaceId } : {}),
        });
        created.script = !existing;
        for (const [k, v] of Object.entries(secrets)) {
          if (v === null) await this.deps.api.deleteSecret(a, script, k);
          else await this.deps.api.putSecret(a, script, k, v);
        }
        if (rec.host && a.zoneId && rec.status !== "disabled") {
          if (!rec.dnsId) {
            rec.dnsId = await this.deps.api.createDns(a, rec.host, `marsa-spaces worker ${script}`);
            created.dns = rec.dnsId;
          }
          if (!rec.routeId) {
            rec.routeId = await this.deps.api.createRoute(a, `${rec.host}/*`, script);
            created.route = rec.routeId;
          }
        } else if (!rec.host) {
          const sub = await this.deps.api.enableWorkersDev(a, script);
          rec.url = `https://${script}.${sub}.workers.dev`;
        }
        if (cronsChanged && rec.status !== "disabled") {
          await this.deps.api.putSchedules(a, script, wantCrons);
          this.cronCount = null;
        }
      } catch (err) {
        const fail = this.cfFail(err, "deploy failed");
        if (created.kv) {
          await this.deps.api.deleteKvNamespace(a, created.kv).catch(() => {});
          delete rec.kvNamespaceId;
        }
        if (!existing) {
          // Undo whatever this attempt created; nothing else is touched.
          if (created.route) await this.deps.api.deleteRoute(a, created.route).catch(() => {});
          if (created.dns) await this.deps.api.deleteDns(a, created.dns).catch(() => {});
          if (created.script) await this.deps.api.deleteScript(a, script).catch(() => {});
          this.recs.delete(rec.id);
        } else {
          this.recs.set(rec.id, { ...rec, lastError: fail.message, updatedAt: this.iso() });
        }
        await this.saveRecs();
        throw fail;
      }
      const secretNames = new Set(rec.secrets);
      for (const [k, v] of Object.entries(secrets)) {
        if (v === null) secretNames.delete(k);
        else secretNames.add(k);
      }
      const done: WorkerRec = {
        ...rec,
        vars: finalVars,
        secrets: [...secretNames].sort(),
        bytes,
        status: rec.status === "disabled" ? "disabled" : "active",
        updatedAt: this.iso(),
        deployedAt: this.iso(),
        deployedBy: actor.label,
        compatibilityFlags: runtime.compatibilityFlags ?? [],
        bindings: runtime.bindings ?? [],
      };
      if (meta === null) delete done.meta;
      else if (meta) done.meta = meta;
      if (requiredEnv === null || (requiredEnv && !requiredEnv.length)) delete done.requiredEnv;
      else if (requiredEnv) done.requiredEnv = requiredEnv;
      // Names-only bookkeeping: when/by whom each secret and var last changed.
      const stamp = { at: done.updatedAt, by: actor.label };
      if (Object.keys(secrets).length) {
        const sm = { ...(done.secretsMeta ?? {}) };
        for (const [k, v] of Object.entries(secrets)) {
          if (v === null) delete sm[k];
          else sm[k] = stamp;
        }
        done.secretsMeta = sm;
      }
      const vm: Record<string, { at: string; by: string }> = {};
      for (const [k, v] of Object.entries(finalVars)) {
        const prev = existing?.varsMeta?.[k];
        vm[k] = existing && existing.vars[k] === v && prev ? prev : stamp;
      }
      done.varsMeta = vm;
      if (repo === null) delete done.repo;
      else if (repo) done.repo = repo;
      else if (done.repo?.commitSha && existing) {
        // New code without a commit: the old commit no longer describes what runs.
        const prev = await this.versions.latest(existing.id).catch(() => null);
        if (!prev || prev.sha256 !== sha256Hex(code)) {
          const { commitSha: _drop, ...rest } = done.repo;
          done.repo = rest;
        }
      }
      if (runtime.compatibilityDate) done.compatibilityDate = runtime.compatibilityDate;
      else delete done.compatibilityDate;
      delete done.lastError;
      if (wantCrons.length) done.crons = wantCrons;
      else delete done.crons;
      let storageNote: string | null = null;
      if (!wantKv && existing?.kvNamespaceId) {
        // Storage turned off: the binding is gone with this deploy; drop the namespace (data).
        try {
          await this.deps.api.deleteKvNamespace(a, existing.kvNamespaceId);
          storageNote = "worker-storage-off";
        } catch (err) {
          console.error("[workers] could not delete the KV namespace:", (err as Error)?.message);
          storageNote = "worker-storage-off-orphan";
        }
        delete done.kvNamespaceId;
      } else if (created.kv) storageNote = "worker-storage-on";
      const action: VersionAction = opts.action ?? "deploy";
      try {
        const v = await this.versions.add(done.id, {
          at: done.deployedAt as string,
          by: actor.label,
          action,
          ...(opts.from ? { from: opts.from } : {}),
          note,
          bytes,
          sha256: sha256Hex(code),
          vars: { ...finalVars },
          secretNames: [...done.secrets],
          code,
          runtime,
        });
        done.version = v.n;
      } catch (err) {
        // The deploy itself succeeded; a failed history write must not undo it.
        console.error("[workers] could not store the version:", (err as Error)?.message);
      }
      this.recs.set(done.id, done);
      await this.saveRecs();
      await this.deps.audit({
        teamId: team.id,
        actor,
        action:
          action === "rollback"
            ? "worker-rollback"
            : existing
              ? "worker-redeploy"
              : "worker-deploy",
        detail:
          action === "rollback" && opts.from
            ? `${name} → v${opts.from}`
            : done.version
              ? `${name} (v${done.version})`
              : name,
      });
      if (storageNote)
        await this.deps.audit({ teamId: team.id, actor, action: storageNote, detail: name });
      if (cronsChanged)
        await this.deps.audit({
          teamId: team.id,
          actor,
          action: "worker-crons",
          detail: `${name}: ${wantCrons.join(" | ") || "none"}`,
        });
      if (!existing && done.host && this.settings?.bic?.enabled)
        void this.syncBic().catch(() => {});
      return workerView(done);
    }
  }

  /**
   * Service bindings may only point at another Worker of the SAME team that Spaces
   * manages: never another team's, never a protected or non-team script.
   */
  private resolveBindings(
    team: Team,
    self: string,
    bindings: ServiceBinding[],
    taken: string[],
  ): { name: string; script: string }[] {
    const used = new Set(taken);
    return bindings.map((b) => {
      if (used.has(b.name)) {
        throw new WorkerError(
          400,
          "INVALID_REQUEST",
          `bindings.${b.name}: already a var or secret`,
        );
      }
      if (b.worker === self) {
        throw new WorkerError(
          400,
          "INVALID_BINDING",
          `bindings.${b.name}: a Worker cannot bind to itself`,
        );
      }
      const target = this.find(team.id, b.worker);
      if (
        !target ||
        target.teamId !== team.id ||
        PROTECTED_SCRIPTS.has(target.script) ||
        !target.script.startsWith("team-")
      ) {
        throw new WorkerError(
          400,
          "INVALID_BINDING",
          `bindings.${b.name}: "${b.worker}" is not a Worker of this team`,
        );
      }
      return { name: b.name, script: target.script };
    });
  }

  /** Workers of the team that bind to this one. */
  boundBy(rec: WorkerRec): WorkerRec[] {
    return this.list(rec.teamId).filter(
      (w) => w.id !== rec.id && (w.bindings ?? []).some((b) => b.worker === rec.name),
    );
  }

  /**
   * Change compatibility date/flags and service bindings (0.15.0) without sending code: the
   * newest stored code and vars are deployed again with them (a new version). The Workers it
   * binds to are not touched.
   */
  async editRuntime(
    team: Team,
    rec: WorkerRec,
    change: {
      compatibilityDate?: unknown;
      compatibilityFlags?: unknown;
      bindings?: unknown;
      crons?: unknown;
      storage?: unknown;
    },
    actor: Actor,
    hooks?: DeployHooks,
  ): Promise<WorkerView> {
    const v = await this.versions.latest(rec.id);
    if (!v) {
      throw new WorkerError(
        409,
        "NO_STORED_VERSION",
        "no stored version yet; deploy the code once and it will be saved",
      );
    }
    return this.deploy(
      team,
      {
        name: rec.name,
        code: v.code,
        vars: rec.vars,
        ...("compatibilityDate" in change ? { compatibilityDate: change.compatibilityDate } : {}),
        ...("compatibilityFlags" in change
          ? { compatibilityFlags: change.compatibilityFlags }
          : {}),
        ...("bindings" in change ? { bindings: change.bindings } : {}),
        ...("crons" in change ? { crons: change.crons } : {}),
        ...("storage" in change ? { storage: change.storage } : {}),
        note: "runtime settings changed",
      },
      actor,
      { action: "redeploy", ...(hooks ? { hooks } : {}) },
    );
  }

  /** 0.17.0: GET …/runtime — the runtime settings of one Worker (no code, no values). */
  runtimeView(rec: WorkerRec) {
    const v = workerView(rec);
    return {
      worker: v.name,
      compatibilityDate: v.compatibilityDate,
      compatibilityDateSet: v.compatibilityDateSet,
      compatibilityFlags: v.compatibilityFlags,
      bindings: v.bindings,
      crons: v.crons,
      storage: v.storage ? { type: "kv", binding: STORE_BINDING, private: true as const } : null,
      logs: v.logs,
      varNames: Object.keys(v.vars).sort(),
      secretNames: v.secrets,
    };
  }

  /**
   * 0.17.0: right after a deploy, GET the Worker's health path (meta.healthPath, else "/")
   * a few times while the new route settles. 2xx-4xx = reachable; 5xx or no answer = not ok.
   */
  async healthAfterDeploy(
    rec: WorkerView,
    tries = 3,
    gapMs = 1500,
  ): Promise<{ path: string; status: number | null; ms: number; ok: boolean } | null> {
    if (!rec.url || !this.deps.probe || rec.status === "disabled") return null;
    const path = (rec.meta as { healthPath?: string }).healthPath || "/";
    let last = { status: null as number | null, ms: 0 };
    for (let i = 0; i < tries; i++) {
      const t0 = Date.now();
      try {
        const res = await this.deps.probe(`${rec.url}${path}`, {
          method: "GET",
          redirect: "manual",
          headers: { "user-agent": "MarsaSpaces-deploy-check/0.17" },
          signal: AbortSignal.timeout(5000),
        });
        await res.body?.cancel().catch(() => {});
        last = { status: res.status, ms: Date.now() - t0 };
        if (res.status < 500) break;
      } catch {
        last = { status: null, ms: Date.now() - t0 };
      }
      if (i < tries - 1) await new Promise((r) => setTimeout(r, gapMs));
    }
    return { path, ...last, ok: last.status !== null && last.status < 500 };
  }

  // ---- 0.17.0: Browser Integrity Check exception for team Worker hosts ----------------------

  bicView(): BicState & { managed: boolean; hosts: number } {
    const b = this.settings?.bic ?? { enabled: false };
    return { ...b, managed: !!b.ruleId, hosts: this.bicHosts().length };
  }

  private bicHosts(): string[] {
    return [
      ...new Set(
        this.list()
          .filter((w) => w.host && w.status !== "disabled")
          .map((w) => w.host as string),
      ),
    ].sort();
  }

  /**
   * Turn the exception on or off. Only ever creates, updates or deletes the ONE rule whose
   * ref is BIC_RULE_REF; every other rule of the zone is left as it is. Needs the token
   * permission Zone · Config Rules: Edit — without it Cloudflare answers 403 and nothing
   * changes (reported as BIC_NOT_PERMITTED).
   */
  async setBic(enabled: boolean, actor: Actor): Promise<ReturnType<WorkerService["bicView"]>> {
    this.token();
    if (!this.settings?.zoneId)
      throw new WorkerError(409, "NO_ZONE", "the Workers token has no zone");
    await this.serial(async () => {
      const s = this.settings as CfSettings;
      s.bic = { ...(s.bic ?? {}), enabled };
      await this.saveSettingsFile();
    });
    await this.syncBic(actor);
    return this.bicView();
  }

  /** Make the zone rule match the current team Worker hosts (or remove it when off/empty). */
  async syncBic(actor?: Actor): Promise<void> {
    return this.serial(async () => {
      const s = this.settings;
      if (!s?.zoneId || !s.bic) return;
      const a = this.access();
      const hosts = this.bicHosts();
      const rule = {
        ref: BIC_RULE_REF,
        description: BIC_RULE_DESC,
        expression: `http.host in {${hosts.map((h) => JSON.stringify(h)).join(" ")}}`,
        action: "set_config",
        action_parameters: { bic: false },
        enabled: true,
      } as unknown as Parameters<CloudflareWorkersApi["addConfigRule"]>[2];
      const next: BicState = { ...s.bic, at: this.iso() };
      try {
        const ep = await this.deps.api.configRules(a);
        const mine = ep?.rules.find(
          (r) => r.ref === BIC_RULE_REF || r.description === BIC_RULE_DESC,
        );
        if (!s.bic.enabled || !hosts.length) {
          if (ep && mine) await this.deps.api.deleteConfigRule(a, ep.id, mine.id);
          delete next.ruleId;
          delete next.rulesetId;
        } else if (!ep) {
          await this.deps.api.createConfigEntrypoint(a, rule);
          const again = await this.deps.api.configRules(a);
          const r = again?.rules.find(
            (x) => x.ref === BIC_RULE_REF || x.description === BIC_RULE_DESC,
          );
          if (again && r) Object.assign(next, { rulesetId: again.id, ruleId: r.id });
        } else if (mine) {
          await this.deps.api.updateConfigRule(a, ep.id, mine.id, rule);
          Object.assign(next, { rulesetId: ep.id, ruleId: mine.id });
        } else {
          await this.deps.api.addConfigRule(a, ep.id, rule);
          const again = await this.deps.api.configRules(a);
          const r = again?.rules.find(
            (x) => x.ref === BIC_RULE_REF || x.description === BIC_RULE_DESC,
          );
          if (r) Object.assign(next, { rulesetId: ep.id, ruleId: r.id });
        }
        next.hosts = s.bic.enabled ? hosts.length : 0;
        delete next.lastError;
      } catch (err) {
        const denied = err instanceof CfError && (err.status === 401 || err.status === 403);
        next.lastError = denied
          ? "Cloudflare refused: the token needs Zone · Config Rules: Edit"
          : this.cfFail(err, "could not update the configuration rule").message;
        // Never left "on" without the permission: it activates only once Cloudflare accepts it.
        if (denied) next.enabled = false;
        s.bic = next;
        await this.saveSettingsFile();
        if (actor)
          throw new WorkerError(
            denied ? 403 : 502,
            denied ? "BIC_NOT_PERMITTED" : "CLOUDFLARE_ERROR",
            next.lastError,
          );
        return;
      }
      s.bic = next;
      await this.saveSettingsFile();
      if (actor)
        await this.deps.audit({
          teamId: PLATFORM_AUDIT,
          actor,
          action: s.bic.enabled ? "bic-exception-on" : "bic-exception-off",
          detail: `${hosts.length} host(s)`,
        });
    });
  }

  /** Change metadata only (no redeploy): declared meta, repo link, linked space. */
  setLinks(
    rec: WorkerRec,
    change: { meta?: unknown; repo?: unknown; spaceId?: string | null; requiredEnv?: unknown },
    actor: Actor,
  ): Promise<WorkerView> {
    let meta: WorkerMeta | null | undefined;
    let repo: RepoLink | null | undefined;
    let requiredEnv: string[] | null | undefined;
    try {
      meta = readMeta(change.meta);
      repo = readRepo(change.repo);
      requiredEnv = readRequiredEnv(change.requiredEnv);
    } catch (err) {
      if (err instanceof MetaError || err instanceof RepoError || err instanceof EnvError)
        throw new WorkerError(400, "INVALID_REQUEST", err.message);
      throw err;
    }
    return this.serial(async () => {
      const cur = this.recs.get(rec.id);
      if (!cur) throw new WorkerError(404, "NOT_FOUND", "worker not found");
      const next: WorkerRec = { ...cur, updatedAt: this.iso() };
      if (meta === null) delete next.meta;
      else if (meta) next.meta = meta;
      if (repo === null) delete next.repo;
      else if (repo) next.repo = repo;
      if (change.spaceId === null) delete next.spaceId;
      else if (typeof change.spaceId === "string") next.spaceId = change.spaceId;
      if (requiredEnv === null || (requiredEnv && !requiredEnv.length)) delete next.requiredEnv;
      else if (requiredEnv) next.requiredEnv = requiredEnv;
      this.recs.set(cur.id, next);
      await this.saveRecs();
      await this.deps.audit({
        teamId: cur.teamId,
        actor,
        action: "worker-links",
        detail: cur.name,
      });
      return workerView(next);
    }, rec.teamId);
  }

  /** Stored versions of a Worker, newest first. */
  listVersions(rec: WorkerRec): Promise<WorkerVersion[]> {
    return this.versions.list(rec.id);
  }
  getVersion(rec: WorkerRec, n: number): Promise<WorkerVersion | null> {
    return this.versions.get(rec.id, n);
  }

  /**
   * Push Spaces-managed secrets (API keys: MARSA_KEYS_URL + MARSA_KEYS_SECRET) to a Worker.
   * They are not listed among the team's own secrets and survive redeploys (keep_bindings).
   */
  async putSystemSecrets(rec: WorkerRec, values: Record<string, string>): Promise<void> {
    this.token();
    const a = this.access();
    try {
      for (const [k, v] of Object.entries(values))
        await this.deps.api.putSecret(a, rec.script, k, v);
    } catch (err) {
      throw this.cfFail(err, "could not set the key secrets on the Worker");
    }
  }

  /** 0.15.2: an audit line about one Worker (health on/off …). */
  auditOf(rec: WorkerRec, actor: Actor, action: string, extra?: string): Promise<void> {
    return this.deps.audit({
      teamId: rec.teamId,
      actor,
      action,
      detail: extra ? `${rec.name}: ${extra}` : rec.name,
    });
  }

  /** 0.15.2: run a Cloudflare call with the platform token (never exposed to the caller). */
  async withCf<T>(fn: (a: CfAccess, api: CloudflareWorkersApi) => Promise<T>): Promise<T> {
    this.token();
    return fn(this.access(), this.deps.api);
  }

  /** The platform account id (for analytics queries), or null when not configured. */
  get accountId(): string | null {
    return this.settings?.accountId ?? null;
  }

  private checkEnvName(rec: WorkerRec, name: unknown, what: "secret" | "var"): string {
    const n = typeof name === "string" ? name.trim() : "";
    if (!ENV_NAME_RE.test(n))
      throw new WorkerError(
        400,
        "INVALID_NAME",
        `${what} name: letters, digits and _ (not starting with a digit)`,
      );
    if ((SYSTEM_SECRETS as readonly string[]).includes(n) || n.startsWith("MARSA_"))
      throw new WorkerError(400, "RESERVED_NAME", `${n} is managed by Spaces`);
    if ((rec.bindings ?? []).some((b) => b.name === n))
      throw new WorkerError(409, "NAME_IN_USE", `${n} is a service binding`);
    if (what === "secret" && n in rec.vars)
      throw new WorkerError(409, "NAME_IN_USE", `${n} is a plain var; delete it first`);
    if (what === "var" && rec.secrets.includes(n))
      throw new WorkerError(409, "NAME_IN_USE", `${n} is a secret; delete it first`);
    return n;
  }

  /**
   * 0.15.2: set or rotate one secret (write-only) without a code redeploy. The value goes
   * straight to Cloudflare; Spaces keeps only the name and when/by whom it changed.
   */
  setSecret(
    rec: WorkerRec,
    name: unknown,
    value: unknown,
    actor: Actor,
  ): Promise<{ name: string; rotated: boolean }> {
    const n = this.checkEnvName(rec, name, "secret");
    if (typeof value !== "string" || !value.length)
      throw new WorkerError(400, "INVALID_REQUEST", "value: the secret (a non-empty string)");
    if (Buffer.byteLength(value) > SECRET_MAX_BYTES)
      throw new WorkerError(413, "SECRET_TOO_LARGE", "a secret is limited to 5 KB");
    this.token();
    return this.serial(async () => {
      const cur = this.recs.get(rec.id);
      if (!cur) throw new WorkerError(404, "NOT_FOUND", "worker not found");
      try {
        await this.deps.api.putSecret(this.access(), cur.script, n, value);
      } catch (err) {
        throw this.cfFail(err, "could not set the secret");
      }
      const rotated = cur.secrets.includes(n);
      const at = this.iso();
      const next: WorkerRec = {
        ...cur,
        secrets: [...new Set([...cur.secrets, n])].sort(),
        secretsMeta: { ...(cur.secretsMeta ?? {}), [n]: { at, by: actor.label } },
        updatedAt: at,
      };
      this.recs.set(cur.id, next);
      await this.saveRecs();
      await this.deps.audit({
        teamId: cur.teamId,
        actor,
        action: rotated ? "worker-secret-rotate" : "worker-secret-set",
        detail: `${cur.name}: ${n}`,
      });
      return { name: n, rotated };
    }, rec.teamId);
  }

  /** 0.15.2: delete one secret from the Worker (no redeploy). */
  deleteSecretNamed(rec: WorkerRec, name: unknown, actor: Actor): Promise<{ name: string }> {
    const n = typeof name === "string" ? name.trim() : "";
    if (!ENV_NAME_RE.test(n) || (SYSTEM_SECRETS as readonly string[]).includes(n))
      throw new WorkerError(400, "INVALID_NAME", "not a secret of this Worker");
    this.token();
    return this.serial(async () => {
      const cur = this.recs.get(rec.id);
      if (!cur) throw new WorkerError(404, "NOT_FOUND", "worker not found");
      if (!cur.secrets.includes(n)) throw new WorkerError(404, "NOT_FOUND", `no secret named ${n}`);
      try {
        await this.deps.api.deleteSecret(this.access(), cur.script, n);
      } catch (err) {
        throw this.cfFail(err, "could not delete the secret");
      }
      const sm = { ...(cur.secretsMeta ?? {}) };
      delete sm[n];
      const next: WorkerRec = {
        ...cur,
        secrets: cur.secrets.filter((x) => x !== n),
        secretsMeta: sm,
        updatedAt: this.iso(),
      };
      this.recs.set(cur.id, next);
      await this.saveRecs();
      await this.deps.audit({
        teamId: cur.teamId,
        actor,
        action: "worker-secret-delete",
        detail: `${cur.name}: ${n}`,
      });
      return { name: n };
    }, rec.teamId);
  }

  /** 0.15.2: set (value) or delete (null) one plain var; redeploys the newest stored code. */
  async setVar(
    team: Team,
    rec: WorkerRec,
    name: unknown,
    value: string | null,
    actor: Actor,
  ): Promise<WorkerView> {
    const n =
      value === null
        ? typeof name === "string" && name.trim() in rec.vars
          ? name.trim()
          : (() => {
              throw new WorkerError(404, "NOT_FOUND", "no var with that name");
            })()
        : this.checkEnvName(rec, name, "var");
    if (value !== null && typeof value !== "string")
      throw new WorkerError(400, "INVALID_REQUEST", "value: a string");
    const vars = { ...rec.vars };
    if (value === null) delete vars[n];
    else vars[n] = value;
    const w = await this.editEnv(team, rec, { vars }, actor);
    await this.deps.audit({
      teamId: rec.teamId,
      actor,
      action: value === null ? "worker-var-delete" : "worker-var-set",
      detail: `${rec.name}: ${n}`,
    });
    return w;
  }

  /** 0.15.2: Workers Logs on/off (Cloudflare observability; settings only, no new code). */
  setLogs(rec: WorkerRec, on: boolean, actor: Actor): Promise<WorkerView> {
    this.token();
    return this.serial(async () => {
      const cur = this.recs.get(rec.id);
      if (!cur) throw new WorkerError(404, "NOT_FOUND", "worker not found");
      try {
        await this.deps.api.setObservability(this.access(), cur.script, on);
      } catch (err) {
        throw this.cfFail(err, "could not change Workers Logs");
      }
      const next: WorkerRec = { ...cur, updatedAt: this.iso() };
      if (on) next.logs = true;
      else delete next.logs;
      this.recs.set(cur.id, next);
      await this.saveRecs();
      await this.deps.audit({
        teamId: cur.teamId,
        actor,
        action: on ? "worker-logs-on" : "worker-logs-off",
        detail: cur.name,
      });
      return workerView(next);
    }, rec.teamId);
  }

  /**
   * Change env vars and/or secrets (0.15.0): the newest stored code is deployed again with
   * them, recorded as a new version. `secrets` values of null remove a secret.
   */
  async editEnv(
    team: Team,
    rec: WorkerRec,
    change: { vars?: Record<string, string>; secrets?: Record<string, string | null> },
    actor: Actor,
  ): Promise<WorkerView> {
    const v = await this.versions.latest(rec.id);
    if (!v) {
      throw new WorkerError(
        409,
        "NO_STORED_VERSION",
        "no stored version yet; deploy the code once and it will be saved",
      );
    }
    return this.deploy(
      team,
      {
        name: rec.name,
        code: v.code,
        vars: change.vars ?? rec.vars,
        ...(change.secrets ? { secrets: change.secrets } : {}),
        note: change.vars ? "env vars changed" : "secrets changed",
      },
      actor,
      { action: "redeploy" },
    );
  }

  /** One-click redeploy: deploy the newest stored version again (secrets are kept). */
  async redeploy(
    team: Team,
    rec: WorkerRec,
    actor: Actor,
    note?: unknown,
    hooks?: DeployHooks,
  ): Promise<WorkerView> {
    const v = await this.versions.latest(rec.id);
    if (!v) {
      throw new WorkerError(
        409,
        "NO_STORED_VERSION",
        "no stored version yet; deploy the code once and it will be saved",
      );
    }
    return this.deploy(
      team,
      {
        name: rec.name,
        code: v.code,
        vars: v.vars,
        ...runtimeInput(v.runtime),
        note: note ?? `redeploy of v${v.n}`,
      },
      actor,
      { action: "redeploy", ...(hooks ? { hooks } : {}) },
    );
  }

  /** Deploy an older stored version again (recorded as a new version). Secrets stay as they are. */
  async rollback(
    team: Team,
    rec: WorkerRec,
    n: number,
    actor: Actor,
    note?: unknown,
    hooks?: DeployHooks,
  ): Promise<{ worker: WorkerView; missingSecrets: string[] }> {
    const v = Number.isInteger(n) ? await this.versions.get(rec.id, n) : null;
    if (!v)
      throw new WorkerError(404, "VERSION_NOT_FOUND", `no stored version ${n} for this Worker`);
    const worker = await this.deploy(
      team,
      {
        name: rec.name,
        code: v.code,
        vars: v.vars,
        ...runtimeInput(v.runtime),
        note: note ?? `rollback to v${v.n}`,
      },
      actor,
      { action: "rollback", from: v.n, ...(hooks ? { hooks } : {}) },
    );
    const have = new Set(worker.secrets);
    return { worker, missingSecrets: v.secretNames.filter((k) => !have.has(k)) };
  }

  /** Called after a Worker is deleted (API keys are dropped with it). */
  onRemove: ((rec: WorkerRec) => Promise<void>) | null = null;

  /** Delete a tracked Worker: its route, its DNS record, then the script. */
  remove(rec: WorkerRec, actor: Actor): Promise<void> {
    return this.serial(async () => {
      const cur = this.recs.get(rec.id);
      if (!cur) return;
      if (PROTECTED_SCRIPTS.has(cur.script) || !cur.script.startsWith("team-")) {
        throw new WorkerError(403, "PROTECTED", "this script is not managed by Spaces");
      }
      const users = this.boundBy(cur);
      if (users.length) {
        throw new WorkerError(
          409,
          "WORKER_BOUND",
          `${users.map((w) => w.name).join(", ")} binds to this Worker; remove the binding first`,
        );
      }
      const a = this.access();
      try {
        if (cur.routeId) await this.deps.api.deleteRoute(a, cur.routeId);
        if (cur.dnsId) await this.deps.api.deleteDns(a, cur.dnsId);
        // 0.17.0: cron triggers go first (explicitly), then the script.
        if (cur.crons?.length) await this.deps.api.putSchedules(a, cur.script, []).catch(() => {});
        await this.deps.api.deleteScript(a, cur.script);
      } catch (err) {
        throw this.cfFail(err, "delete failed");
      }
      if (cur.crons?.length) this.cronCount = null;
      // 0.17.0: the private KV namespace (and its data) is deleted with the Worker.
      if (cur.kvNamespaceId) {
        await this.deps.api.deleteKvNamespace(a, cur.kvNamespaceId).catch((err) => {
          console.error("[workers] could not delete the KV namespace:", (err as Error)?.message);
        });
      }
      this.recs.delete(cur.id);
      await this.saveRecs();
      await this.versions.remove(cur.id).catch(() => {});
      await this.onRemove?.(cur).catch(() => {});
      await this.deps.audit({
        teamId: cur.teamId,
        actor,
        action: "worker-delete",
        detail: cur.name,
      });
      if (cur.host && this.settings?.bic?.enabled) void this.syncBic().catch(() => {});
    }, rec.teamId);
  }

  /** Admin: take a Worker offline (remove its route) without deleting it, or bring it back. */
  setDisabled(rec: WorkerRec, disabled: boolean, actor: Actor): Promise<WorkerView> {
    return this.serial(async () => {
      const cur = this.recs.get(rec.id);
      if (!cur) throw new WorkerError(404, "NOT_FOUND", "worker not found");
      const a = this.access();
      const next = { ...cur };
      try {
        if (disabled && cur.routeId) {
          await this.deps.api.deleteRoute(a, cur.routeId);
          delete next.routeId;
        }
        if (!disabled && cur.host && a.zoneId && !cur.routeId) {
          next.routeId = await this.deps.api.createRoute(a, `${cur.host}/*`, cur.script);
        }
        // 0.17.0: a disabled Worker's cron triggers are paused, and restored on enable.
        if (cur.crons?.length) {
          await this.deps.api.putSchedules(a, cur.script, disabled ? [] : cur.crons);
          this.cronCount = null;
        }
      } catch (err) {
        throw this.cfFail(err, disabled ? "disable failed" : "enable failed");
      }
      next.status = disabled ? "disabled" : "active";
      if (disabled) next.disabledBy = actor.kind === "admin" ? "admin" : "team";
      else delete next.disabledBy;
      next.updatedAt = this.iso();
      this.recs.set(next.id, next);
      await this.saveRecs();
      await this.deps.audit({
        teamId: cur.teamId,
        actor,
        action: disabled ? "worker-disable" : "worker-enable",
        detail: cur.name,
      });
      return workerView(next);
    }, rec.teamId);
  }

  /** Remove every Worker of a team (Workers turned off, or the team deleted). */
  async teardownTeam(teamId: string, actor: Actor): Promise<number> {
    let n = 0;
    for (const r of this.list(teamId)) {
      await this.remove(r, actor);
      n++;
    }
    return n;
  }

  /** Live check of a Worker's URL (status code, or null when unreachable). */
  async probe(rec: WorkerRec): Promise<{ status: number | null; ms: number }> {
    if (!rec.url || !this.deps.probe) return { status: null, ms: 0 };
    const t0 = Date.now();
    try {
      const res = await this.deps.probe(rec.url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
      await res.body?.cancel().catch(() => {});
      return { status: res.status, ms: Date.now() - t0 };
    } catch {
      return { status: null, ms: Date.now() - t0 };
    }
  }
}

/** Vars must fit the per-Worker total; big ones need an object default export (see cf-workers). */
function checkVarsFit(vars: Record<string, string>, code: string): void {
  let total = 0;
  let big = false;
  for (const [k, v] of Object.entries(vars)) {
    const n = Buffer.byteLength(v);
    total += Buffer.byteLength(k) + n;
    if (n > CF_BINDING_MAX) big = true;
  }
  if (total > MAX_VARS_TOTAL) {
    throw new WorkerError(
      400,
      "VARS_TOO_LARGE",
      `vars: at most ${MAX_VARS_TOTAL / 1024} KB in total per Worker`,
    );
  }
  if (big && /export\s+default\s+class\b/.test(code)) {
    throw new WorkerError(
      400,
      "LARGE_VARS_NEED_OBJECT",
      'vars over 5 KB need "export default { fetch(request, env) { … } }" (not a class)',
    );
  }
}
