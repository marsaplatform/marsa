import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { hashToken, newSiteId } from "./tokens.js";

/**
 * A team groups uploads that were made with its team key. The admin decides,
 * per team, whether its sites may use the optional data/files backend.
 */
export interface Team {
  id: string;
  name: string;
  /** May this team's sites use /api/sites/:id/kv and /files? */
  backend: boolean;
  /** List this team's live sites in the public directory on the homepage? (default true) */
  directory: boolean;
  /** May this team publish sites with no expiry? (default: same as `backend`) */
  permanent: boolean;
  /** Quota: most live sites at once. Unset = TEAM_MAX_SITES. */
  maxSites?: number;
  /** Quota: most bytes across live sites, in MB. Unset = TEAM_MAX_MB. */
  maxMb?: number;
  /** May this team deploy Cloudflare Workers through Spaces? (0.12.0) */
  workers?: boolean;
  /** Short ASCII name used in Worker scripts and hostnames (team-<slug>-<name>). */
  slug?: string;
  /** Quota: most Workers. Unset = WORKERS_DEFAULT_MAX. */
  maxWorkers?: number;
  /** Quota: largest script, in KB. Unset = WORKER_MAX_KB. */
  maxWorkerKb?: number;
  /** 0.16.0: an owner hid the getting-started checklist. */
  checklistHidden?: boolean;
  createdAt: string;
  updatedAt: string;
  /** SHA-256 of the team key. The key itself is shown once and never stored. */
  keyHash: string;
  /** First characters of the key, so the admin can tell keys apart. */
  keyPrefix: string;
}

/** Fields the admin may change. */
export interface TeamPatch {
  name?: string;
  backend?: boolean;
  directory?: boolean;
  permanent?: boolean;
  maxSites?: number | null;
  maxMb?: number | null;
  workers?: boolean;
  slug?: string | null;
  maxWorkers?: number | null;
  maxWorkerKb?: number | null;
  checklistHidden?: boolean;
}

/** What the admin API returns (never the key hash). */
export type PublicTeam = Omit<Team, "keyHash">;

export function publicTeam(t: Team): PublicTeam {
  const { keyHash: _omit, ...rest } = t;
  return rest;
}

export const TEAM_KEY_PREFIX = "marsa_team_";

export function newTeamKey(): string {
  return `${TEAM_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function isTeamKey(s: string): boolean {
  return s.startsWith(TEAM_KEY_PREFIX);
}

const NAME_MAX = 80;

/** A team in the 7-day trash (0.16.0): out of every lookup, restorable until purgeAfter. */
export interface TrashedTeam {
  team: Team;
  deletedAt: string;
  /** Hard delete (Workers, keys, members, data) happens after this time. */
  purgeAfter: string;
  deletedBy: string;
  /** Also delete the team's sites at purge time. */
  deleteSites: boolean;
  /** Worker ids that the soft delete turned off (restore turns only these back on). */
  disabledWorkers: string[];
  /** File name of the export taken before the delete, under <dataDir>/trash/. */
  exportFile: string | null;
}

export const TRASH_DAYS = 7;

/** Trimmed team name, or null if it's empty/too long/has control characters. */
export function cleanTeamName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  if (!name || name.length > NAME_MAX || /[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

/**
 * Teams live in one small JSON file, <dataDir>/teams.json, next to the sites.
 * It's read once at start and kept in memory; every change is written to a
 * temp file and renamed into place, one write at a time.
 */
export class TeamStore {
  private readonly file: string;
  private readonly tmpDir: string;
  private teams = new Map<string, Team>();
  private byKey = new Map<string, string>();
  private trash = new Map<string, TrashedTeam>();
  private queue: Promise<void> = Promise.resolve();
  private loading: Promise<void> | null = null;

  constructor(dataDir: string) {
    const root = resolve(dataDir);
    this.file = join(root, "teams.json");
    this.tmpDir = join(root, "tmp");
  }

  /** Load teams.json once (safe to call many times). */
  ready(): Promise<void> {
    this.loading ??= this.load();
    return this.loading;
  }

  async init(): Promise<void> {
    this.loading = this.load();
    return this.loading;
  }

  private async load(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    const parsed = JSON.parse(raw) as { teams?: Team[]; trash?: TrashedTeam[] };
    this.teams.clear();
    this.byKey.clear();
    this.trash.clear();
    for (const tr of parsed.trash ?? []) if (tr?.team?.id) this.trash.set(tr.team.id, tr);
    for (const t of parsed.teams ?? []) {
      if (typeof t.directory !== "boolean") t.directory = true;
      if (typeof t.permanent !== "boolean") t.permanent = !!t.backend;
      this.teams.set(t.id, t);
      this.byKey.set(t.keyHash, t.id);
    }
  }

  list(): Team[] {
    return [...this.teams.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(id: string | undefined | null): Team | null {
    return id ? (this.teams.get(id) ?? null) : null;
  }

  /** The team a key belongs to, or null. */
  byTeamKey(key: string): Team | null {
    return this.get(this.byKey.get(hashToken(key)));
  }

  private persist(): Promise<void> {
    const body = JSON.stringify(
      { version: 1, teams: this.list(), trash: this.listTrash() },
      null,
      2,
    );
    const run = async () => {
      await mkdir(this.tmpDir, { recursive: true });
      const tmp = join(this.tmpDir, `teams-${randomBytes(6).toString("hex")}.json`);
      await writeFile(tmp, body, { mode: 0o600 });
      await rename(tmp, this.file);
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  async create(
    name: string,
    backend: boolean,
    now: number,
    directory = true,
    extra: TeamPatch = {},
  ): Promise<{ team: Team; key: string }> {
    let id = `t_${newSiteId(8)}`;
    while (this.teams.has(id)) id = `t_${newSiteId(8)}`;
    const key = newTeamKey();
    const ts = new Date(now).toISOString();
    const team: Team = {
      id,
      name,
      backend,
      directory,
      permanent: extra.permanent ?? backend,
      ...(extra.maxSites ? { maxSites: extra.maxSites } : {}),
      ...(extra.maxMb ? { maxMb: extra.maxMb } : {}),
      createdAt: ts,
      updatedAt: ts,
      keyHash: hashToken(key),
      keyPrefix: key.slice(0, TEAM_KEY_PREFIX.length + 4),
    };
    this.teams.set(id, team);
    this.byKey.set(team.keyHash, id);
    await this.persist();
    return { team, key };
  }

  async update(id: string, patch: TeamPatch, now: number): Promise<Team | null> {
    const t = this.teams.get(id);
    if (!t) return null;
    const next = { ...t, ...patch, updatedAt: new Date(now).toISOString() } as Team;
    // 0 (or null) clears a quota back to the server default.
    if (!next.maxSites) delete next.maxSites;
    if (!next.maxMb) delete next.maxMb;
    if (!next.maxWorkers) delete next.maxWorkers;
    if (!next.maxWorkerKb) delete next.maxWorkerKb;
    if (!next.slug) delete next.slug;
    if (!next.workers) delete next.workers;
    this.teams.set(id, next);
    await this.persist();
    return next;
  }

  /** Replace the team's key; the old key stops working at once. */
  async rotate(id: string, now: number): Promise<{ team: Team; key: string } | null> {
    const t = this.teams.get(id);
    if (!t) return null;
    const key = newTeamKey();
    this.byKey.delete(t.keyHash);
    const next: Team = {
      ...t,
      keyHash: hashToken(key),
      keyPrefix: key.slice(0, TEAM_KEY_PREFIX.length + 4),
      updatedAt: new Date(now).toISOString(),
    };
    this.teams.set(id, next);
    this.byKey.set(next.keyHash, id);
    await this.persist();
    return { team: next, key };
  }

  async delete(id: string): Promise<boolean> {
    const t = this.teams.get(id);
    const inTrash = this.trash.delete(id);
    if (!t) {
      if (inTrash) await this.persist();
      return inTrash;
    }
    this.teams.delete(id);
    this.byKey.delete(t.keyHash);
    await this.persist();
    return true;
  }

  // ---- trash (0.16.0) ------------------------------------------------------------------
  /** Teams in the trash, soonest purge first. */
  listTrash(): TrashedTeam[] {
    return [...this.trash.values()].sort((a, b) => a.purgeAfter.localeCompare(b.purgeAfter));
  }

  getTrashed(id: string | undefined | null): TrashedTeam | null {
    return id ? (this.trash.get(id) ?? null) : null;
  }

  /** Slugs held by live and trashed teams (a trashed team keeps its Worker hostnames). */
  slugTaken(slug: string, exceptId: string): boolean {
    for (const t of this.teams.values()) if (t.id !== exceptId && t.slug === slug) return true;
    for (const tr of this.trash.values())
      if (tr.team.id !== exceptId && tr.team.slug === slug) return true;
    return false;
  }

  /** Move a team to the trash: its key and sessions stop working at once. */
  async moveToTrash(id: string, info: Omit<TrashedTeam, "team">): Promise<TrashedTeam | null> {
    const t = this.teams.get(id);
    if (!t) return null;
    this.teams.delete(id);
    this.byKey.delete(t.keyHash);
    const entry: TrashedTeam = { team: t, ...info };
    this.trash.set(id, entry);
    await this.persist();
    return entry;
  }

  /** Bring a trashed team back (same id, key, slug and settings). */
  async restore(id: string, now: number): Promise<Team | null> {
    const tr = this.trash.get(id);
    if (!tr) return null;
    const team = { ...tr.team, updatedAt: new Date(now).toISOString() };
    this.trash.delete(id);
    this.teams.set(id, team);
    this.byKey.set(team.keyHash, id);
    await this.persist();
    return team;
  }
}
