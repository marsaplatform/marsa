import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { hashToken, safeEqual } from "./tokens.js";

/**
 * End-user API keys for team Workers (0.14.0), e.g. for a team's public MCP server.
 *
 * A Worker opts in ("Require API keys"). Spaces then injects two Worker secrets:
 * MARSA_KEYS_URL (the verify endpoint) and MARSA_KEYS_SECRET (a per-Worker verifier).
 * The Worker calls POST /api/keys/verify with the verifier and the caller's key; Spaces
 * answers allow/deny with the remaining quota and the allowed tools, and counts the use.
 *
 * Keys are shown once and stored as SHA-256 with a visible prefix. Counters live in this
 * process (per-minute window in memory, per-day counts saved with the file at most every
 * FLUSH_MS), so a restart can lose a few seconds of counts. Everything is in one place:
 * there is no cross-node eventual consistency, only the Worker-side cache (documented).
 */
export const USER_KEY_PREFIX = "msk_";
export const VERIFIER_PREFIX = "marsa_wkv_";
export const MAX_USER_KEYS = 500;
export const MAX_PER_MINUTE = 10_000;
export const MAX_PER_DAY = 10_000_000;
export const DEFAULT_PER_MINUTE = 60;
export const DEFAULT_PER_DAY = 5_000;
export const MAX_TOOLS = 50;
export const USAGE_DAYS = 7;
/** 429s per Worker per UTC day that raise an alert (each once a day). */
export const SPIKE_STEPS = [10, 100, 1000];
const DAY = 86_400_000;
const FLUSH_MS = 15_000;
const TOOL_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}$/;

export class UserKeyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface UserKeySettings {
  workerId: string;
  teamId: string;
  required: boolean;
  perMinute: number;
  perDay: number;
  verifierHash?: string;
  verifierPrefix?: string;
  updatedAt: string;
}

export interface UserKey {
  id: string;
  workerId: string;
  teamId: string;
  label: string;
  email: string;
  hash: string;
  prefix: string;
  createdAt: string;
  createdBy: string;
  expiresAt: string | null;
  revokedAt?: string;
  revokedBy?: string;
  /** Overrides of the Worker defaults. */
  perMinute?: number;
  perDay?: number;
  /** Allowed tool names (empty = all). */
  tools: string[];
  lastUsedAt?: string;
  /** UTC date -> requests allowed / denied with 429. */
  days: Record<string, { n: number; limited: number }>;
}

export type UserKeyState = "active" | "revoked" | "expired";

export interface UserKeyView {
  id: string;
  label: string;
  email: string;
  prefix: string;
  state: UserKeyState;
  createdAt: string;
  createdBy: string;
  expiresAt: string | null;
  revokedAt: string | null;
  perMinute: number | null;
  perDay: number | null;
  tools: string[];
  lastUsedAt: string | null;
  usage: { today: number; last7d: number; limitedToday: number; limited7d: number };
}

export interface VerifyResult {
  allow: boolean;
  status: 200 | 401 | 403 | 429;
  code:
    | "OK"
    | "MISSING_KEY"
    | "INVALID_KEY"
    | "REVOKED"
    | "EXPIRED"
    | "TOOL_NOT_ALLOWED"
    | "RATE_LIMITED";
  keyId?: string;
  label?: string;
  tools?: string[];
  limits?: { perMinute: number; perDay: number };
  remaining?: { minute: number; day: number };
  retryAfter?: number;
  /** Seconds the Worker may cache an allow (0 = do not cache). */
  cacheSeconds: number;
}

export interface SpikeEvent {
  teamId: string;
  workerId: string;
  count: number;
}

const posInt = (v: unknown, max: number, what: string): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > max)
    throw new UserKeyError(400, "INVALID_LIMIT", `${what}: a whole number from 1 to ${max}`);
  return n;
};

const clean = (v: unknown, max: number) =>
  typeof v === "string"
    ? v
        // biome-ignore lint/suspicious/noControlCharactersInRegex: strip control characters
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";

export function readTools(raw: unknown): string[] {
  if (raw === undefined || raw === null || raw === "") return [];
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,]+/) : null;
  if (!list) throw new UserKeyError(400, "INVALID_TOOLS", "tools: a list of tool names");
  const out = [...new Set(list.map((t) => String(t).trim()).filter(Boolean))];
  if (out.length > MAX_TOOLS || out.some((t) => !TOOL_RE.test(t)))
    throw new UserKeyError(
      400,
      "INVALID_TOOLS",
      `tools: up to ${MAX_TOOLS} names of A-Z a-z 0-9 _ . : - (1-64 chars)`,
    );
  return out;
}

export class UserKeyStore {
  private readonly file: string;
  private readonly tmpDir: string;
  private settings = new Map<string, UserKeySettings>();
  private keys = new Map<string, UserKey>();
  /** keyId -> current minute window (memory only). */
  private minute = new Map<string, { start: number; n: number }>();
  /** workerId:date -> spike steps already alerted. */
  private spikes = new Map<string, number>();
  private loading: Promise<void> | null = null;
  private writeQ: Promise<void> = Promise.resolve();
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;
  onSpike: ((e: SpikeEvent) => void) | null = null;

  constructor(
    dataDir: string,
    private readonly now: () => number = Date.now,
    readonly cacheSeconds = 30,
  ) {
    const root = resolve(dataDir);
    this.file = join(root, "user-keys.json");
    this.tmpDir = join(root, "tmp");
  }

  ready(): Promise<void> {
    this.loading ??= this.load();
    return this.loading;
  }

  private async load() {
    try {
      const f = JSON.parse(await readFile(this.file, "utf8")) as {
        settings?: UserKeySettings[];
        keys?: UserKey[];
      };
      for (const s of f.settings ?? []) this.settings.set(s.workerId, s);
      for (const k of f.keys ?? [])
        this.keys.set(k.id, { ...k, days: k.days ?? {}, tools: k.tools ?? [] });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  private iso(ms = this.now()) {
    return new Date(ms).toISOString();
  }
  private today(ms = this.now()) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  /** Write now (key/settings changes). */
  save(): Promise<void> {
    this.dirty = false;
    const t = this.now();
    const keep = new Set(Array.from({ length: USAGE_DAYS }, (_, i) => this.today(t - i * DAY)));
    for (const [id, k] of this.keys) {
      for (const d of Object.keys(k.days)) if (!keep.has(d)) delete k.days[d];
      const end = k.revokedAt
        ? Date.parse(k.revokedAt)
        : k.expiresAt
          ? Date.parse(k.expiresAt)
          : Number.POSITIVE_INFINITY;
      if (end + 30 * DAY < t) this.keys.delete(id);
    }
    const body = JSON.stringify({
      version: 1,
      settings: [...this.settings.values()],
      keys: [...this.keys.values()],
    });
    const run = async () => {
      await mkdir(this.tmpDir, { recursive: true });
      const tmp = join(this.tmpDir, `uk-${randomBytes(6).toString("hex")}.json`);
      await writeFile(tmp, body, { mode: 0o600 });
      await rename(tmp, this.file);
    };
    this.writeQ = this.writeQ.then(run, run);
    return this.writeQ;
  }

  /** Usage counters: written at most every FLUSH_MS. */
  private touchLater() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.dirty) void this.save().catch(() => {});
    }, FLUSH_MS);
    this.timer.unref?.();
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.dirty) await this.save();
    await this.writeQ;
  }

  // ---- settings --------------------------------------------------------------------------

  settingsOf(workerId: string): UserKeySettings | null {
    return this.settings.get(workerId) ?? null;
  }

  settingsView(workerId: string) {
    const s = this.settings.get(workerId);
    return {
      required: !!s?.required,
      perMinute: s?.perMinute ?? DEFAULT_PER_MINUTE,
      perDay: s?.perDay ?? DEFAULT_PER_DAY,
      verifier: s?.verifierPrefix ? `${s.verifierPrefix}…` : null,
      cacheSeconds: this.cacheSeconds,
    };
  }

  /**
   * Turn keys on/off and set the Worker defaults. Returns a NEW verifier secret when one
   * must be pushed to the Worker (first enable, or rotate); the caller injects it.
   */
  async configure(
    teamId: string,
    workerId: string,
    input: Record<string, unknown>,
  ): Promise<{ settings: UserKeySettings; verifier: string | null }> {
    const cur = this.settings.get(workerId);
    if (cur && cur.teamId !== teamId) throw new UserKeyError(404, "NOT_FOUND", "no such Worker");
    const required =
      input.required === undefined
        ? !!cur?.required
        : input.required === true || input.required === "true" || input.required === "on";
    const perMinute =
      posInt(input.perMinute, MAX_PER_MINUTE, "perMinute") ?? cur?.perMinute ?? DEFAULT_PER_MINUTE;
    const perDay = posInt(input.perDay, MAX_PER_DAY, "perDay") ?? cur?.perDay ?? DEFAULT_PER_DAY;
    const next: UserKeySettings = {
      workerId,
      teamId,
      required,
      perMinute,
      perDay,
      ...(cur?.verifierHash
        ? { verifierHash: cur.verifierHash, verifierPrefix: cur.verifierPrefix }
        : {}),
      updatedAt: this.iso(),
    };
    let verifier: string | null = null;
    if (required && (!cur?.verifierHash || input.rotateVerifier === true)) {
      verifier = VERIFIER_PREFIX + randomBytes(24).toString("base64url");
      next.verifierHash = hashToken(verifier);
      next.verifierPrefix = verifier.slice(0, VERIFIER_PREFIX.length + 4);
    }
    this.settings.set(workerId, next);
    await this.save();
    return { settings: next, verifier };
  }

  /** Undo a verifier that could not be pushed to Cloudflare. */
  async dropVerifier(workerId: string) {
    const s = this.settings.get(workerId);
    if (!s) return;
    delete s.verifierHash;
    delete s.verifierPrefix;
    s.required = false;
    await this.save();
  }

  workerByVerifier(secret: string): UserKeySettings | null {
    if (!secret.startsWith(VERIFIER_PREFIX)) return null;
    const h = hashToken(secret);
    for (const s of this.settings.values()) {
      if (s.verifierHash && safeEqual(s.verifierHash, h)) return s;
    }
    return null;
  }

  // ---- keys ------------------------------------------------------------------------------

  list(workerId: string): UserKey[] {
    return [...this.keys.values()]
      .filter((k) => k.workerId === workerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(workerId: string, id: string): UserKey | null {
    const k = this.keys.get(id);
    return k && k.workerId === workerId ? k : null;
  }

  stateOf(k: UserKey): UserKeyState {
    if (k.revokedAt) return "revoked";
    if (k.expiresAt && Date.parse(k.expiresAt) <= this.now()) return "expired";
    return "active";
  }

  view(k: UserKey): UserKeyView {
    const t = this.now();
    const today = this.today(t);
    let last7d = 0;
    let limited7d = 0;
    for (let i = 0; i < USAGE_DAYS; i++) {
      const d = k.days[this.today(t - i * DAY)];
      last7d += d?.n ?? 0;
      limited7d += d?.limited ?? 0;
    }
    return {
      id: k.id,
      label: k.label,
      email: k.email,
      prefix: k.prefix,
      state: this.stateOf(k),
      createdAt: k.createdAt,
      createdBy: k.createdBy,
      expiresAt: k.expiresAt,
      revokedAt: k.revokedAt ?? null,
      perMinute: k.perMinute ?? null,
      perDay: k.perDay ?? null,
      tools: k.tools,
      lastUsedAt: k.lastUsedAt ?? null,
      usage: {
        today: k.days[today]?.n ?? 0,
        last7d,
        limitedToday: k.days[today]?.limited ?? 0,
        limited7d,
      },
    };
  }

  async create(
    teamId: string,
    workerId: string,
    input: Record<string, unknown>,
    by: string,
  ): Promise<{ key: UserKey; secret: string }> {
    const label = clean(input.label, 80);
    const email = clean(input.email, 254);
    if (email && !EMAIL_RE.test(email))
      throw new UserKeyError(400, "INVALID_EMAIL", "email: leave empty or give a valid address");
    let expiresAt: string | null = null;
    if (
      input.expiresInDays !== undefined &&
      input.expiresInDays !== null &&
      input.expiresInDays !== "" &&
      input.expiresInDays !== "never"
    ) {
      const days = Number(input.expiresInDays);
      if (!Number.isInteger(days) || days < 1 || days > 3650)
        throw new UserKeyError(
          400,
          "INVALID_EXPIRY",
          "expiresInDays: 1-3650, or omit for no expiry",
        );
      expiresAt = this.iso(this.now() + days * DAY);
    }
    const perMinute = posInt(input.perMinute, MAX_PER_MINUTE, "perMinute");
    const perDay = posInt(input.perDay, MAX_PER_DAY, "perDay");
    const tools = readTools(input.tools);
    if (this.list(workerId).filter((k) => this.stateOf(k) === "active").length >= MAX_USER_KEYS)
      throw new UserKeyError(
        409,
        "TOO_MANY_KEYS",
        `at most ${MAX_USER_KEYS} active keys per Worker`,
      );
    const secret = USER_KEY_PREFIX + randomBytes(24).toString("base64url");
    const key: UserKey = {
      id: `uk_${randomBytes(6).toString("hex")}`,
      workerId,
      teamId,
      label: label || "key",
      email,
      hash: hashToken(secret),
      prefix: secret.slice(0, USER_KEY_PREFIX.length + 6),
      createdAt: this.iso(),
      createdBy: by,
      expiresAt,
      ...(perMinute ? { perMinute } : {}),
      ...(perDay ? { perDay } : {}),
      tools,
      days: {},
    };
    this.keys.set(key.id, key);
    await this.save();
    return { key, secret };
  }

  async revoke(workerId: string, id: string, by: string): Promise<UserKey | null> {
    const k = this.get(workerId, id);
    if (!k) return null;
    if (!k.revokedAt) {
      k.revokedAt = this.iso();
      k.revokedBy = by;
      this.minute.delete(k.id);
      await this.save();
    }
    return k;
  }

  /** Forget a Worker's keys and settings (Worker deleted). */
  async purgeWorker(workerId: string) {
    this.settings.delete(workerId);
    for (const [id, k] of this.keys) if (k.workerId === workerId) this.keys.delete(id);
    await this.save();
  }

  async purgeTeam(teamId: string) {
    for (const [id, s] of this.settings) if (s.teamId === teamId) this.settings.delete(id);
    for (const [id, k] of this.keys) if (k.teamId === teamId) this.keys.delete(id);
    await this.save();
  }

  /**
   * Check a caller's key for a Worker and count the request. `uses` = requests the Worker
   * already served from its cache since its last check (added to the counters, capped).
   */
  verify(s: UserKeySettings, rawKey: unknown, tool: unknown, uses: unknown = 0): VerifyResult {
    const deny = (
      status: 401 | 403 | 429,
      code: VerifyResult["code"],
      extra: Partial<VerifyResult> = {},
    ) => ({ allow: false, status, code, cacheSeconds: 0, ...extra }) as VerifyResult;
    const secret = typeof rawKey === "string" ? rawKey.trim() : "";
    if (!secret) return deny(401, "MISSING_KEY");
    if (!secret.startsWith(USER_KEY_PREFIX) || secret.length > 200) return deny(401, "INVALID_KEY");
    const h = hashToken(secret);
    let k: UserKey | null = null;
    for (const c of this.keys.values()) {
      if (c.workerId === s.workerId && safeEqual(c.hash, h)) {
        k = c;
        break;
      }
    }
    if (!k) return deny(401, "INVALID_KEY");
    const state = this.stateOf(k);
    if (state === "revoked") return deny(401, "REVOKED");
    if (state === "expired") return deny(401, "EXPIRED");
    const toolName = typeof tool === "string" ? tool.trim() : "";
    if (toolName && k.tools.length && !k.tools.includes(toolName))
      return deny(403, "TOOL_NOT_ALLOWED", { keyId: k.id, tools: k.tools });

    const t = this.now();
    const perMinute = k.perMinute ?? s.perMinute;
    const perDay = k.perDay ?? s.perDay;
    const extraUses = Math.max(
      0,
      Math.min(Number.isFinite(Number(uses)) ? Math.floor(Number(uses)) : 0, perMinute),
    );
    const today = this.today(t);
    if (!k.days[today]) k.days[today] = { n: 0, limited: 0 };
    const day = k.days[today];
    let win = this.minute.get(k.id);
    if (!win || t - win.start >= 60_000) {
      win = { start: t, n: 0 };
      this.minute.set(k.id, win);
    }
    // Cached uses are counted even if they push the key over (they already happened).
    win.n += extraUses;
    day.n += extraUses;
    const limits = { perMinute, perDay };
    if (win.n >= perMinute || day.n >= perDay) {
      day.limited += 1;
      this.touchLater();
      this.spike(s, today);
      const retryAfter =
        day.n >= perDay
          ? Math.ceil((Date.parse(`${today}T00:00:00Z`) + DAY - t) / 1000)
          : Math.max(1, Math.ceil((win.start + 60_000 - t) / 1000));
      return deny(429, "RATE_LIMITED", {
        keyId: k.id,
        limits,
        remaining: { minute: Math.max(0, perMinute - win.n), day: Math.max(0, perDay - day.n) },
        retryAfter,
      });
    }
    win.n += 1;
    day.n += 1;
    k.lastUsedAt = this.iso(t);
    this.touchLater();
    const remaining = { minute: perMinute - win.n, day: perDay - day.n };
    return {
      allow: true,
      status: 200,
      code: "OK",
      keyId: k.id,
      label: k.label,
      tools: k.tools,
      limits,
      remaining,
      // Never let a cache outlive the key's expiry or a tight quota.
      cacheSeconds: Math.min(
        this.cacheSeconds,
        k.expiresAt
          ? Math.max(0, Math.floor((Date.parse(k.expiresAt) - t) / 1000))
          : this.cacheSeconds,
        remaining.minute > 0 ? this.cacheSeconds : 0,
      ),
    };
  }

  private spike(s: UserKeySettings, today: string) {
    let total = 0;
    for (const k of this.keys.values())
      if (k.workerId === s.workerId) total += k.days[today]?.limited ?? 0;
    const mark = `${s.workerId}:${today}`;
    const done = this.spikes.get(mark) ?? 0;
    const step = SPIKE_STEPS.filter((x) => total >= x).pop() ?? 0;
    if (step > done) {
      this.spikes.set(mark, step);
      this.onSpike?.({ teamId: s.teamId, workerId: s.workerId, count: step });
    }
  }
}

/** Bump when the helper source changes, so CDNs never serve an old copy at the new URL. */
export const HELPER_VERSION = 2;
export const HELPER_PATH = `/api/keys/helper.v${HELPER_VERSION}.js`;

/**
 * The helper a Worker pastes in (served at HELPER_PATH). It reads the key from
 * Authorization: Bearer or X-Api-Key and asks Spaces on every request (exact counts).
 * With opts.cache = N seconds it caches an allow for up to N s (capped by Spaces'
 * cacheSeconds and the remaining minute quota) and reports cached uses on the next check.
 */
export function keysHelperSource(publicUrl: string): string {
  return `// Marsa Spaces API keys helper v${HELPER_VERSION} (0.14.1). Paste into your Worker; no dependencies.
// Spaces injects MARSA_KEYS_URL and MARSA_KEYS_SECRET when "Require API keys" is on.
// Every request is checked by Spaces (exact limits). Opt in to caching with
// requireKey(request, env, { cache: 30 }): faster, but each Worker isolate caches on its own,
// so a key can go over its per-minute limit by up to its remaining quota per isolate.
const __marsaCache = new Map(); // key -> { until, res, uses }
export async function requireKey(request, env, opts = {}) {
  const url = env.MARSA_KEYS_URL || ${JSON.stringify(`${publicUrl}/api/keys/verify`)};
  const auth = request.headers.get("authorization") || "";
  const key = (auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : request.headers.get("x-api-key") || "").trim();
  const deny = (status, code, extra = {}) => ({ ok: false, status, code, ...extra,
    response: new Response(JSON.stringify({ error: { code, message: extra.message || code } }), {
      status, headers: { "content-type": "application/json", ...(extra.retryAfter ? { "retry-after": String(extra.retryAfter) } : {}) } }) });
  if (!key) return deny(401, "MISSING_KEY", { message: "send your API key as Authorization: Bearer <key>" });
  if (!env.MARSA_KEYS_SECRET) return deny(503, "KEYS_NOT_CONFIGURED");
  const tool = opts.tool || "";
  const now = Date.now();
  const hit = __marsaCache.get(key);
  if (hit && hit.until > now && (!tool || !hit.res.tools?.length || hit.res.tools.includes(tool)) && hit.left > 0) {
    hit.uses += 1; hit.left -= 1;
    return { ok: true, status: 200, code: "OK", keyId: hit.res.keyId, tools: hit.res.tools, cached: true };
  }
  const uses = hit ? hit.uses : 0;
  let res;
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json",
      authorization: "Bearer " + env.MARSA_KEYS_SECRET, "user-agent": "marsa-keys-helper/1" },
      body: JSON.stringify({ key, tool, uses }) });
    res = await r.json();
  } catch {
    // Spaces unreachable: fail closed unless the Worker opts in to fail open.
    if (opts.failOpen) return { ok: true, status: 200, code: "UNVERIFIED" };
    return deny(503, "KEYS_UNAVAILABLE", { message: "key check unavailable, try again" });
  }
  __marsaCache.delete(key);
  if (!res || !res.allow) return deny(res?.status || 401, res?.code || "INVALID_KEY", { retryAfter: res?.retryAfter });
  const ttl = Math.min(Number(opts.cache) > 0 ? Number(opts.cache) : 0, res.cacheSeconds || 0);
  if (ttl > 0) {
    if (__marsaCache.size > 1000) __marsaCache.clear();
    // Serve at most the remaining minute quota from cache.
    __marsaCache.set(key, { until: now + ttl * 1000, res, uses: 0, left: Math.max(0, Math.min(res.remaining?.minute ?? 0, res.remaining?.day ?? 0)) });
  }
  return { ok: true, status: 200, code: "OK", keyId: res.keyId, tools: res.tools, remaining: res.remaining };
}
`;
}
