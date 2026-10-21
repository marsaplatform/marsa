import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  CF_BINDING_MAX,
  type CfAccess,
  CfError,
  type CloudflareWorkersApi,
  type FetchFn,
} from "./cf-workers.js";
import type { Actor } from "./members.js";
import type { SecretBox } from "./secrets.js";
import type { Team, TeamStore } from "./teams.js";
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
}

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
}

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
});

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
}

export interface WorkerLimits {
  defaultMax: number;
  defaultMaxKb: number;
  compatibilityDate: string;
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
  private opQ: Promise<unknown> = Promise.resolve();
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

  /** One Cloudflare-changing operation at a time (keeps quotas and name checks race-free). */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.opQ.then(fn, fn);
    this.opQ = run.catch(() => undefined);
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
    if (this.deps.teams.list().some((t) => t.id !== teamId && t.slug === slug)) {
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
      return new WorkerError(502, "CLOUDFLARE_ERROR", `${what}: ${err.message}`);
    }
    console.error(`[workers] ${what}:`, (err as Error)?.name ?? "error");
    return new WorkerError(502, "CLOUDFLARE_ERROR", what);
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
    opts: { action?: VersionAction; from?: number } = {},
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
    if (!/export\s+default\b/.test(code)) {
      throw new WorkerError(
        400,
        "NOT_A_MODULE",
        'code must be an ES module with "export default { fetch(request, env) { … } }"',
      );
    }
    const vars = this.readMap(input.vars, "vars", false) as Record<string, string>;
    const secrets = this.readMap(input.secrets, "secrets", true);
    for (const k of Object.keys(secrets)) {
      if (k in vars)
        throw new WorkerError(400, "INVALID_REQUEST", `${k} is both a var and a secret`);
    }
    const note = cleanNote(input.note);
    // Throws early (503) when the platform has no token.
    this.token();

    return this.serial(async () => {
      const existing = this.find(team.id, name);
      if (!existing && this.list(team.id).length >= q.workers) {
        throw new WorkerError(409, "WORKER_QUOTA", `this team can have ${q.workers} Workers`);
      }
      const a = this.access();
      const script = existing?.script ?? this.scriptFor(team, name);
      // Omitted vars keep the current ones on a redeploy.
      const finalVars = input.vars === undefined && existing ? existing.vars : vars;
      checkVarsFit(finalVars, code);
      if (PROTECTED_SCRIPTS.has(script) || !script.startsWith("team-")) {
        throw new WorkerError(403, "PROTECTED", "this script name is not managed by Spaces");
      }
      const host = existing ? existing.host : this.hostFor(team, name);
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
      const created = { script: false, dns: "", route: "" };
      try {
        await this.deps.api.putScript(a, script, {
          code,
          compatibilityDate: this.deps.limits.compatibilityDate,
          vars: finalVars,
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
      } catch (err) {
        const fail = this.cfFail(err, "deploy failed");
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
      };
      delete done.lastError;
      const action: VersionAction = opts.action ?? (existing ? "redeploy" : "deploy");
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
      return workerView(done);
    });
  }

  /** Stored versions of a Worker, newest first. */
  listVersions(rec: WorkerRec): Promise<WorkerVersion[]> {
    return this.versions.list(rec.id);
  }
  getVersion(rec: WorkerRec, n: number): Promise<WorkerVersion | null> {
    return this.versions.get(rec.id, n);
  }

  /** One-click redeploy: deploy the newest stored version again (secrets are kept). */
  async redeploy(team: Team, rec: WorkerRec, actor: Actor, note?: unknown): Promise<WorkerView> {
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
      { name: rec.name, code: v.code, vars: v.vars, note: note ?? `redeploy of v${v.n}` },
      actor,
      { action: "redeploy" },
    );
  }

  /** Deploy an older stored version again (recorded as a new version). Secrets stay as they are. */
  async rollback(
    team: Team,
    rec: WorkerRec,
    n: number,
    actor: Actor,
    note?: unknown,
  ): Promise<{ worker: WorkerView; missingSecrets: string[] }> {
    const v = Number.isInteger(n) ? await this.versions.get(rec.id, n) : null;
    if (!v)
      throw new WorkerError(404, "VERSION_NOT_FOUND", `no stored version ${n} for this Worker`);
    const worker = await this.deploy(
      team,
      { name: rec.name, code: v.code, vars: v.vars, note: note ?? `rollback to v${v.n}` },
      actor,
      { action: "rollback", from: v.n },
    );
    const have = new Set(worker.secrets);
    return { worker, missingSecrets: v.secretNames.filter((k) => !have.has(k)) };
  }

  /** Delete a tracked Worker: its route, its DNS record, then the script. */
  remove(rec: WorkerRec, actor: Actor): Promise<void> {
    return this.serial(async () => {
      const cur = this.recs.get(rec.id);
      if (!cur) return;
      if (PROTECTED_SCRIPTS.has(cur.script) || !cur.script.startsWith("team-")) {
        throw new WorkerError(403, "PROTECTED", "this script is not managed by Spaces");
      }
      const a = this.access();
      try {
        if (cur.routeId) await this.deps.api.deleteRoute(a, cur.routeId);
        if (cur.dnsId) await this.deps.api.deleteDns(a, cur.dnsId);
        await this.deps.api.deleteScript(a, cur.script);
      } catch (err) {
        throw this.cfFail(err, "delete failed");
      }
      this.recs.delete(cur.id);
      await this.saveRecs();
      await this.versions.remove(cur.id).catch(() => {});
      await this.deps.audit({
        teamId: cur.teamId,
        actor,
        action: "worker-delete",
        detail: cur.name,
      });
    });
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
      } catch (err) {
        throw this.cfFail(err, disabled ? "disable failed" : "enable failed");
      }
      next.status = disabled ? "disabled" : "active";
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
    });
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
