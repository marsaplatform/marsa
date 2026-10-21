import { randomBytes, type ScryptOptions, scrypt } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { hashToken, newSiteId, safeEqual } from "./tokens.js";

/**
 * Team members, invites and the audit log.
 *
 * - Members join with a single-use, expiring invite link (made by the admin or a team owner), pick a
 *   username, a display name and a password (scrypt), and sign in at /login. No email is involved.
 * - Roles: owner (everything, incl. members and invites), editor (publish and manage sites),
 *   viewer (read-only).
 * - The team key keeps working for agents and the API, and signing in with it in a browser acts as
 *   an owner (fallback).
 * - <dataDir>/members.json holds members and pending invites (only hashes of passwords and invite
 *   tokens); <dataDir>/audit.json holds the last AUDIT_MAX actions per team.
 */
export type MemberRole = "owner" | "editor" | "viewer";
export const MEMBER_ROLES: readonly MemberRole[] = ["owner", "editor", "viewer"];
export const roleRank: Record<MemberRole, number> = { viewer: 0, editor: 1, owner: 2 };
export const isRole = (v: unknown): v is MemberRole =>
  typeof v === "string" && (MEMBER_ROLES as readonly string[]).includes(v);

export interface Member {
  id: string;
  teamId: string;
  /** Sign-in name, unique on the instance (lowercase). */
  username: string;
  /** Display name. */
  name: string;
  role: MemberRole;
  passwordHash: string;
  /** Bumped to end every session of this member ("sign out everywhere", password change). */
  epoch: number;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export type PublicMember = Omit<Member, "passwordHash" | "epoch">;
export const publicMember = ({ passwordHash: _p, epoch: _e, ...rest }: Member): PublicMember =>
  rest;

export interface Invite {
  id: string;
  teamId: string;
  role: MemberRole;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  /** Who made it (display label). */
  createdBy: string;
}
export type PublicInvite = Omit<Invite, "tokenHash">;
export const publicInvite = ({ tokenHash: _t, ...rest }: Invite): PublicInvite => rest;

export type ActorKind = "member" | "key" | "admin" | "api" | "mcp";
export interface Actor {
  kind: ActorKind;
  /** Display label: member name, "team key", "admin", token name. */
  label: string;
  memberId?: string;
  /** 0.16.0: structured agent-key actor (the label stays "agent key <name>" for old readers). */
  agentKey?: string;
}

export interface AuditEntry {
  at: string;
  teamId: string;
  siteId?: string;
  actor: Actor;
  action: string;
  detail?: string;
}

export const INVITE_PREFIX = "marsa_inv_";
export const AUDIT_MAX = 500;
export const MAX_MEMBERS = 50;
export const MAX_INVITES = 20;
export const INVITE_TTL_DEFAULT = 72;
export const INVITE_TTL_MAX = 168;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export function cleanUsername(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const u = raw.trim().toLowerCase();
  return USERNAME_RE.test(u) ? u : null;
}

export function cleanMemberName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/\s+/g, " ");
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  if (!s || s.length > 80 || /[\u0000-\u001f\u007f<>]/.test(s)) return null;
  return s;
}

// ---- passwords (scrypt) ---------------------------------------------------------------------

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 32 };
const scryptAsync = (pw: string, salt: Buffer, keylen: number, o: ScryptOptions) =>
  new Promise<Buffer>((res, rej) =>
    scrypt(pw.normalize("NFKC"), salt, keylen, o, (err, key) => (err ? rej(err) : res(key))),
  );
const opts = (N: number, r: number, p: number): ScryptOptions => ({
  N,
  r,
  p,
  maxmem: 256 * N * r + 1024 * 1024,
});

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt, SCRYPT.keylen, opts(SCRYPT.N, SCRYPT.r, SCRYPT.p));
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64url");
  const key = await scryptAsync(pw, Buffer.from(salt, "base64url"), want.length, opts(+n, +r, +p));
  return safeEqual(key.toString("base64url"), hash);
}

/** Same cost as a real check, for unknown usernames (no timing oracle). */
let dummy: string | null = null;
export async function burnPasswordCheck(pw: string): Promise<void> {
  dummy ??= await hashPassword("not-a-real-password");
  await verifyPassword(pw, dummy);
}

/** Problems with a new password, or null. */
export function passwordProblem(pw: string, username = ""): "short" | "long" | "same" | null {
  if (pw.length < PASSWORD_MIN) return "short";
  if (pw.length > PASSWORD_MAX) return "long";
  if (username && pw.toLowerCase().includes(username)) return "same";
  return null;
}

// ---- store ----------------------------------------------------------------------------------

export class MemberStore {
  private readonly file: string;
  private readonly auditFile: string;
  private readonly tmpDir: string;
  private members = new Map<string, Member>();
  private invites = new Map<string, Invite>();
  private audit = new Map<string, AuditEntry[]>();
  private queue: Promise<void> = Promise.resolve();
  private auditQueue: Promise<void> = Promise.resolve();
  private loading: Promise<void> | null = null;

  constructor(
    dataDir: string,
    private readonly now: () => number = Date.now,
  ) {
    const root = resolve(dataDir);
    this.file = join(root, "members.json");
    this.auditFile = join(root, "audit.json");
    this.tmpDir = join(root, "tmp");
  }

  ready(): Promise<void> {
    this.loading ??= this.load();
    return this.loading;
  }

  private async readJson<T>(file: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(file, "utf8")) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  private async load(): Promise<void> {
    const m = await this.readJson<{ members?: Member[]; invites?: Invite[] }>(this.file);
    for (const x of m?.members ?? []) this.members.set(x.id, x);
    for (const x of m?.invites ?? []) this.invites.set(x.id, x);
    const a = await this.readJson<{ teams?: Record<string, AuditEntry[]> }>(this.auditFile);
    for (const [k, v] of Object.entries(a?.teams ?? {})) this.audit.set(k, v);
  }

  private write(file: string, body: string, q: "queue" | "auditQueue") {
    const run = async () => {
      await mkdir(this.tmpDir, { recursive: true });
      const tmp = join(this.tmpDir, `m-${randomBytes(6).toString("hex")}.json`);
      await writeFile(tmp, body, { mode: 0o600 });
      await rename(tmp, file);
    };
    this[q] = this[q].then(run, run);
    return this[q];
  }

  private persist() {
    this.pruneInvites();
    return this.write(
      this.file,
      JSON.stringify(
        { version: 1, members: [...this.members.values()], invites: [...this.invites.values()] },
        null,
        2,
      ),
      "queue",
    );
  }

  private persistAudit() {
    return this.write(
      this.auditFile,
      JSON.stringify({ version: 1, teams: Object.fromEntries(this.audit) }),
      "auditQueue",
    );
  }

  private pruneInvites() {
    const t = this.now();
    for (const [id, inv] of this.invites)
      if (Date.parse(inv.expiresAt) <= t) this.invites.delete(id);
  }

  // members
  list(teamId: string): Member[] {
    return [...this.members.values()]
      .filter((m) => m.teamId === teamId)
      .sort(
        (a, b) => roleRank[b.role] - roleRank[a.role] || a.createdAt.localeCompare(b.createdAt),
      );
  }
  count(teamId: string): number {
    return this.list(teamId).length;
  }
  get(id: string | undefined | null): Member | null {
    return id ? (this.members.get(id) ?? null) : null;
  }
  byUsername(username: string): Member | null {
    const u = username.trim().toLowerCase();
    for (const m of this.members.values()) if (m.username === u) return m;
    return null;
  }

  /** Thrown when a username is already used on this instance. */
  static readonly TAKEN = "USERNAME_TAKEN";

  private insert(
    teamId: string,
    role: MemberRole,
    username: string,
    name: string,
    passwordHash: string,
  ) {
    if (this.byUsername(username)) throw new Error(MemberStore.TAKEN);
    let id = `m_${newSiteId(10)}`;
    while (this.members.has(id)) id = `m_${newSiteId(10)}`;
    const ts = new Date(this.now()).toISOString();
    const m: Member = {
      id,
      teamId,
      username,
      name,
      role,
      passwordHash,
      epoch: 0,
      createdAt: ts,
      updatedAt: ts,
    };
    this.members.set(id, m);
    return m;
  }

  async add(
    teamId: string,
    role: MemberRole,
    username: string,
    name: string,
    password: string,
  ): Promise<Member> {
    const m = this.insert(teamId, role, username, name, await hashPassword(password));
    await this.persist();
    return m;
  }

  private async patch(id: string, p: Partial<Member>): Promise<Member | null> {
    const m = this.members.get(id);
    if (!m) return null;
    const next = { ...m, ...p, updatedAt: new Date(this.now()).toISOString() };
    this.members.set(id, next);
    await this.persist();
    return next;
  }
  setRole(id: string, role: MemberRole) {
    return this.patch(id, { role });
  }
  async setPassword(id: string, password: string) {
    const m = this.members.get(id);
    if (!m) return null;
    return this.patch(id, { passwordHash: await hashPassword(password), epoch: m.epoch + 1 });
  }
  endSessions(id: string) {
    const m = this.members.get(id);
    return m ? this.patch(id, { epoch: m.epoch + 1 }) : Promise.resolve(null);
  }
  touchLogin(id: string) {
    return this.patch(id, { lastLoginAt: new Date(this.now()).toISOString() });
  }
  async remove(id: string): Promise<boolean> {
    if (!this.members.delete(id)) return false;
    await this.persist();
    return true;
  }

  // invites
  listInvites(teamId: string): Invite[] {
    this.pruneInvites();
    return [...this.invites.values()]
      .filter((i) => i.teamId === teamId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async createInvite(teamId: string, role: MemberRole, ttlHours: number, createdBy: string) {
    const token = `${INVITE_PREFIX}${randomBytes(24).toString("base64url")}`;
    const t = this.now();
    const inv: Invite = {
      id: newSiteId(10),
      teamId,
      role,
      tokenHash: hashToken(token),
      createdAt: new Date(t).toISOString(),
      expiresAt: new Date(t + ttlHours * 3600_000).toISOString(),
      createdBy,
    };
    this.invites.set(inv.id, inv);
    await this.persist();
    return { invite: inv, token };
  }
  /** A pending, unexpired invite for this token, or null. */
  findInvite(token: string): Invite | null {
    if (!token.startsWith(INVITE_PREFIX)) return null;
    const h = hashToken(token);
    const t = this.now();
    for (const inv of this.invites.values()) {
      if (safeEqual(inv.tokenHash, h) && Date.parse(inv.expiresAt) > t) return inv;
    }
    return null;
  }
  async revokeInvite(id: string): Promise<boolean> {
    if (!this.invites.delete(id)) return false;
    await this.persist();
    return true;
  }
  /**
   * Use an invite. The password is hashed first; then, with no await in between, the invite is
   * checked, the username checked and the invite deleted, so it works exactly once.
   */
  async redeem(
    token: string,
    username: string,
    name: string,
    password: string,
  ): Promise<Member | null> {
    const hash = await hashPassword(password);
    const inv = this.findInvite(token);
    if (!inv) return null;
    const m = this.insert(inv.teamId, inv.role, username, name, hash);
    this.invites.delete(inv.id);
    await this.persist();
    return m;
  }

  /** Remove everything that belongs to a deleted team. */
  async purgeTeam(teamId: string): Promise<void> {
    for (const [id, m] of this.members) if (m.teamId === teamId) this.members.delete(id);
    for (const [id, i] of this.invites) if (i.teamId === teamId) this.invites.delete(id);
    this.audit.delete(teamId);
    await Promise.all([this.persist(), this.persistAudit()]);
  }

  /** Called after every audit entry (0.14.0: the notification center listens here). */
  onLog: ((e: Omit<AuditEntry, "at">) => void) | null = null;

  // audit
  log(e: Omit<AuditEntry, "at">): Promise<void> {
    try {
      this.onLog?.(e);
    } catch {
      // never let a listener break the audit log
    }
    const list = this.audit.get(e.teamId) ?? [];
    list.push({ at: new Date(this.now()).toISOString(), ...e });
    if (list.length > AUDIT_MAX) list.splice(0, list.length - AUDIT_MAX);
    this.audit.set(e.teamId, list);
    return this.persistAudit().catch((err) => console.error("[audit] write failed", err));
  }
  /** Newest first. */
  entries(teamId: string, siteId?: string, limit = 50): AuditEntry[] {
    const list = this.audit.get(teamId) ?? [];
    const out: AuditEntry[] = [];
    for (let i = list.length - 1; i >= 0 && out.length < limit; i--) {
      const e = list[i];
      if (e && (!siteId || e.siteId === siteId)) out.push(e);
    }
    return out;
  }
}
