import { createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { hashToken, safeEqual } from "./tokens.js";

/**
 * Agent keys (0.14.0): per-team API keys with scopes and a required expiry, created
 * by a team owner (or the admin). The secret is shown once; only its SHA-256 is
 * stored, with a short prefix so people can tell keys apart. An agent key works
 * wherever the team key does, limited to its scopes.
 *
 * Agent invites: a one-time link (24 h) an owner hands to an agent. GET shows the
 * onboarding (markdown or JSON); POST .../claim returns a fresh agent key once and
 * the link dies.
 */
export const AGENT_KEY_PREFIX = "marsa_agent_";
export const AGENT_INVITE_PREFIX = "marsa_ainv_";
export const SCOPES = [
  "workers:read",
  "workers:deploy",
  "spaces:read",
  "spaces:write",
  "kv:read",
  "kv:write",
  "mcp",
] as const;
export type Scope = (typeof SCOPES)[number];
export const isScope = (s: unknown): s is Scope =>
  typeof s === "string" && (SCOPES as readonly string[]).includes(s);
export const EXPIRY_PRESETS = [7, 30, 90] as const;
export const EXPIRY_MAX_DAYS = 365;
export const MAX_AGENT_KEYS = 25;
export const MAX_OPEN_AGENT_INVITES = 10;
export const AGENT_INVITE_TTL_HOURS = 24;
const DAY = 86_400_000;
const IP_HASHES_KEEP = 20;

export interface AgentKey {
  id: string;
  teamId: string;
  name: string;
  description: string;
  scopes: Scope[];
  hash: string;
  prefix: string;
  createdAt: string;
  createdBy: string;
  expiresAt: string;
  revokedAt?: string;
  revokedBy?: string;
  lastUsedAt?: string;
  /** Keyed hashes of the client IPs seen (never the IPs). */
  ipHashes: string[];
  /** Set once the "expired" alert went out. */
  expiryNotified?: boolean;
  /** Created by claiming an agent invite. */
  inviteId?: string;
}

export interface AgentInvite {
  id: string;
  teamId: string;
  name: string;
  description: string;
  scopes: Scope[];
  /** Lifetime of the key the claim creates. */
  keyDays: number;
  hash: string;
  prefix: string;
  createdAt: string;
  createdBy: string;
  expiresAt: string;
  claimedAt?: string;
  keyId?: string;
}

export type KeyState = "active" | "expired" | "revoked";

export interface AgentKeyView {
  id: string;
  name: string;
  description: string;
  scopes: Scope[];
  prefix: string;
  createdAt: string;
  createdBy: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  state: KeyState;
  viaInvite: boolean;
}

export interface AgentInviteView {
  id: string;
  name: string;
  scopes: Scope[];
  keyDays: number;
  prefix: string;
  createdAt: string;
  createdBy: string;
  expiresAt: string;
  claimedAt: string | null;
}

export class AgentKeyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface KeyInput {
  name?: unknown;
  description?: unknown;
  scopes?: unknown;
  /** 7 | 30 | 90, or any whole number of days up to 365. */
  expiresInDays?: unknown;
}

const clean = (raw: unknown, max: number): string =>
  typeof raw === "string"
    ? raw
        // biome-ignore lint/suspicious/noControlCharactersInRegex: strip control characters
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";

/** Validate name/description/scopes/expiry for a key or an invite. */
export function readKeyInput(i: KeyInput): {
  name: string;
  description: string;
  scopes: Scope[];
  days: number;
} {
  const name = clean(i.name, 60);
  if (!name) throw new AgentKeyError(400, "INVALID_REQUEST", "name: 1-60 characters");
  const description = clean(i.description, 300);
  const raw = Array.isArray(i.scopes)
    ? i.scopes
    : typeof i.scopes === "string"
      ? i.scopes.split(/[\s,]+/).filter(Boolean)
      : [];
  if (!raw.length || !raw.every(isScope)) {
    throw new AgentKeyError(400, "INVALID_SCOPES", `scopes: one or more of ${SCOPES.join(", ")}`);
  }
  const scopes = SCOPES.filter((s) => (raw as string[]).includes(s));
  const days = Number(i.expiresInDays);
  if (!Number.isInteger(days) || days < 1 || days > EXPIRY_MAX_DAYS) {
    throw new AgentKeyError(
      400,
      "INVALID_EXPIRY",
      `expiresInDays is required: a whole number of days from 1 to ${EXPIRY_MAX_DAYS} (e.g. 7, 30, 90)`,
    );
  }
  return { name, description, scopes, days };
}

export class AgentKeyStore {
  private readonly file: string;
  private readonly tmpDir: string;
  private keys = new Map<string, AgentKey>();
  private invites = new Map<string, AgentInvite>();
  private loading: Promise<void> | null = null;
  private writeQ: Promise<void> = Promise.resolve();

  constructor(
    dataDir: string,
    private readonly now: () => number = Date.now,
    /** Server secret used to key the IP hashes (so they cannot be reversed by brute force). */
    private readonly ipSalt = "marsa",
  ) {
    const root = resolve(dataDir);
    this.file = join(root, "agent-keys.json");
    this.tmpDir = join(root, "tmp");
  }

  ready(): Promise<void> {
    this.loading ??= this.load();
    return this.loading;
  }

  private async load() {
    try {
      const f = JSON.parse(await readFile(this.file, "utf8")) as {
        keys?: AgentKey[];
        invites?: AgentInvite[];
      };
      for (const k of f.keys ?? []) this.keys.set(k.id, { ...k, ipHashes: k.ipHashes ?? [] });
      for (const i of f.invites ?? []) this.invites.set(i.id, i);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  private save() {
    // Drop invites a day after they died, and keys 30 days after they ended.
    const t = this.now();
    for (const [id, i] of this.invites) {
      if (Date.parse(i.expiresAt) + DAY < t) this.invites.delete(id);
    }
    for (const [id, k] of this.keys) {
      const end = k.revokedAt ? Date.parse(k.revokedAt) : Date.parse(k.expiresAt);
      if (end + 30 * DAY < t) this.keys.delete(id);
    }
    const body = JSON.stringify({
      version: 1,
      keys: [...this.keys.values()],
      invites: [...this.invites.values()],
    });
    const run = async () => {
      await mkdir(this.tmpDir, { recursive: true });
      const tmp = join(this.tmpDir, `ak-${randomBytes(6).toString("hex")}.json`);
      await writeFile(tmp, body, { mode: 0o600 });
      await rename(tmp, this.file);
    };
    this.writeQ = this.writeQ.then(run, run);
    return this.writeQ;
  }

  private iso(ms = this.now()) {
    return new Date(ms).toISOString();
  }

  stateOf(k: AgentKey): KeyState {
    if (k.revokedAt) return "revoked";
    return Date.parse(k.expiresAt) <= this.now() ? "expired" : "active";
  }

  view(k: AgentKey): AgentKeyView {
    return {
      id: k.id,
      name: k.name,
      description: k.description,
      scopes: [...k.scopes],
      prefix: k.prefix,
      createdAt: k.createdAt,
      createdBy: k.createdBy,
      expiresAt: k.expiresAt,
      revokedAt: k.revokedAt ?? null,
      lastUsedAt: k.lastUsedAt ?? null,
      state: this.stateOf(k),
      viaInvite: !!k.inviteId,
    };
  }

  inviteView(i: AgentInvite): AgentInviteView {
    return {
      id: i.id,
      name: i.name,
      scopes: [...i.scopes],
      keyDays: i.keyDays,
      prefix: i.prefix,
      createdAt: i.createdAt,
      createdBy: i.createdBy,
      expiresAt: i.expiresAt,
      claimedAt: i.claimedAt ?? null,
    };
  }

  /** Newest first. */
  list(teamId: string): AgentKey[] {
    return [...this.keys.values()]
      .filter((k) => k.teamId === teamId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  get(teamId: string, id: string): AgentKey | null {
    const k = this.keys.get(id);
    return k && k.teamId === teamId ? k : null;
  }
  /** Open (unclaimed, unexpired) invites, newest first. */
  openInvites(teamId: string): AgentInvite[] {
    const t = this.now();
    return [...this.invites.values()]
      .filter((i) => i.teamId === teamId && !i.claimedAt && Date.parse(i.expiresAt) > t)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private activeCount(teamId: string) {
    return this.list(teamId).filter((k) => this.stateOf(k) === "active").length;
  }

  private mint(
    teamId: string,
    v: { name: string; description: string; scopes: Scope[]; days: number },
    by: string,
    inviteId?: string,
  ): { key: AgentKey; secret: string } {
    if (this.activeCount(teamId) >= MAX_AGENT_KEYS) {
      throw new AgentKeyError(
        409,
        "TOO_MANY_KEYS",
        `a team can have ${MAX_AGENT_KEYS} active agent keys; revoke one first`,
      );
    }
    const secret = `${AGENT_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
    const key: AgentKey = {
      id: `ak_${randomBytes(6).toString("hex")}`,
      teamId,
      name: v.name,
      description: v.description,
      scopes: v.scopes,
      hash: hashToken(secret),
      prefix: secret.slice(0, AGENT_KEY_PREFIX.length + 6),
      createdAt: this.iso(),
      createdBy: by,
      expiresAt: this.iso(this.now() + v.days * DAY),
      ipHashes: [],
      ...(inviteId ? { inviteId } : {}),
    };
    this.keys.set(key.id, key);
    return { key, secret };
  }

  async create(teamId: string, input: KeyInput, by: string) {
    const v = readKeyInput(input);
    const out = this.mint(teamId, v, by);
    await this.save();
    return out;
  }

  async revoke(teamId: string, id: string, by: string): Promise<AgentKey | null> {
    const k = this.get(teamId, id);
    if (!k) return null;
    if (!k.revokedAt) {
      k.revokedAt = this.iso();
      k.revokedBy = by;
      await this.save();
    }
    return k;
  }

  /** The active key for a secret, or null (unknown, revoked or expired). */
  verify(secret: string): AgentKey | null {
    if (!secret.startsWith(AGENT_KEY_PREFIX)) return null;
    const h = hashToken(secret);
    for (const k of this.keys.values()) {
      if (safeEqual(k.hash, h)) return this.stateOf(k) === "active" ? k : null;
    }
    return null;
  }

  ipHash(ip: string): string {
    return createHmac("sha256", this.ipSalt).update(`ip:${ip}`).digest("hex").slice(0, 16);
  }

  /** Record a use. Returns whether this IP (hash) is new for the key, and whether it is the first use. */
  async touch(
    k: AgentKey,
    ip: string,
  ): Promise<{ newIp: boolean; first: boolean; ipHash: string }> {
    const ipHash = this.ipHash(ip || "unknown");
    const first = !k.lastUsedAt;
    const newIp = !k.ipHashes.includes(ipHash);
    const prev = k.lastUsedAt ? Date.parse(k.lastUsedAt) : 0;
    k.lastUsedAt = this.iso();
    if (newIp) {
      k.ipHashes.push(ipHash);
      if (k.ipHashes.length > IP_HASHES_KEEP)
        k.ipHashes.splice(0, k.ipHashes.length - IP_HASHES_KEEP);
    }
    // Write at most once a minute for plain use; always for a new IP.
    if (newIp || this.now() - prev > 60_000) await this.save();
    return { newIp, first, ipHash };
  }

  /** Keys that expired and were not reported yet (marks them reported). */
  async takeNewlyExpired(): Promise<AgentKey[]> {
    const t = this.now();
    const out = [...this.keys.values()].filter(
      (k) => !k.revokedAt && !k.expiryNotified && Date.parse(k.expiresAt) <= t,
    );
    for (const k of out) k.expiryNotified = true;
    if (out.length) await this.save();
    return out;
  }

  // ---- invites --------------------------------------------------------------------------

  async createInvite(teamId: string, input: KeyInput, by: string) {
    const v = readKeyInput(input);
    if (this.openInvites(teamId).length >= MAX_OPEN_AGENT_INVITES) {
      throw new AgentKeyError(
        409,
        "TOO_MANY_INVITES",
        `at most ${MAX_OPEN_AGENT_INVITES} open agent invites per team`,
      );
    }
    const secret = `${AGENT_INVITE_PREFIX}${randomBytes(24).toString("base64url")}`;
    const inv: AgentInvite = {
      id: `ai_${randomBytes(6).toString("hex")}`,
      teamId,
      name: v.name,
      description: v.description,
      scopes: v.scopes,
      keyDays: v.days,
      hash: hashToken(secret),
      prefix: secret.slice(0, AGENT_INVITE_PREFIX.length + 4),
      createdAt: this.iso(),
      createdBy: by,
      expiresAt: this.iso(this.now() + AGENT_INVITE_TTL_HOURS * 3_600_000),
    };
    this.invites.set(inv.id, inv);
    await this.save();
    return { invite: inv, secret };
  }

  /** An open invite for a secret, or null (unknown, used or expired). */
  findInvite(secret: string): AgentInvite | null {
    if (!secret.startsWith(AGENT_INVITE_PREFIX)) return null;
    const h = hashToken(secret);
    for (const i of this.invites.values()) {
      if (safeEqual(i.hash, h)) {
        return !i.claimedAt && Date.parse(i.expiresAt) > this.now() ? i : null;
      }
    }
    return null;
  }

  async revokeInvite(teamId: string, id: string): Promise<boolean> {
    const i = this.invites.get(id);
    if (!i || i.teamId !== teamId) return false;
    this.invites.delete(id);
    await this.save();
    return true;
  }

  /** Claim an invite: creates its key and kills the link. Null when the link is not open. */
  async claim(
    secret: string,
  ): Promise<{ invite: AgentInvite; key: AgentKey; secret: string } | null> {
    const inv = this.findInvite(secret);
    if (!inv) return null;
    // Mark first so a concurrent claim cannot also succeed.
    inv.claimedAt = this.iso();
    try {
      const out = this.mint(
        inv.teamId,
        { name: inv.name, description: inv.description, scopes: inv.scopes, days: inv.keyDays },
        `invite ${inv.prefix}…`,
        inv.id,
      );
      inv.keyId = out.key.id;
      await this.save();
      return { invite: inv, ...out };
    } catch (err) {
      delete inv.claimedAt;
      throw err;
    }
  }

  async purgeTeam(teamId: string): Promise<void> {
    for (const [id, k] of this.keys) if (k.teamId === teamId) this.keys.delete(id);
    for (const [id, i] of this.invites) if (i.teamId === teamId) this.invites.delete(id);
    await this.save();
  }
}
