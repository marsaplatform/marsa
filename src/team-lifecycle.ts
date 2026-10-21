import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AgentKeyStore } from "./agent-keys.js";
import type { NoteStore } from "./agent-notes.js";
import type { SiteBackend } from "./backend/types.js";
import { APP_VERSION } from "./brand.js";
import type { Actor, AuditEntry, MemberStore } from "./members.js";
import type { NotificationCenter } from "./notify.js";
import type { RecipeStore } from "./recipes.js";
import type { Sessions } from "./session.js";
import { zipFiles } from "./starters.js";
import { publicMeta, type SiteStore } from "./store.js";
import { publicTeam, type Team, type TeamStore, TRASH_DAYS, type TrashedTeam } from "./teams.js";
import type { UserKeyStore } from "./user-keys.js";
import { PLATFORM_AUDIT, type WorkerService, workerView } from "./workers.js";

/**
 * Team export, soft delete with a 7-day grace period, restore and the final
 * purge (0.16.0). Deleting a team used to remove its Workers, keys, members and
 * data in one call; now it:
 *  1. writes an export zip to <dataDir>/trash/<teamId>-<ts>.zip,
 *  2. turns the team's live Workers off (routes removed, scripts kept),
 *  3. moves the team to the trash: its key, agent keys and every session stop
 *     working at once, and its sites leave the public directory,
 *  4. after 7 days (or "delete now" with the typed name) purges everything
 *     the old delete removed.
 * Every step is in the activity log (team and platform).
 */

const DAY = 86_400_000;
/** Site files bigger than this in total are listed in the export, not copied. */
const EXPORT_FILES_MAX = 150 * 1024 * 1024;
const KV_EXPORT_MAX = 1000;

export class TeamLifecycleError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface TeamLifecycleDeps {
  dataDir: string;
  teams: TeamStore;
  members: MemberStore;
  agentKeys: AgentKeyStore;
  notify: NotificationCenter;
  userKeys: UserKeyStore;
  recipes: RecipeStore;
  agentNotes: NoteStore;
  workers: WorkerService;
  store: SiteStore;
  backend: SiteBackend | null;
  sessions: Sessions;
  deleteSite: (id: string) => Promise<void>;
  invalidateDirectory: () => void;
  audit: (e: Omit<AuditEntry, "at">) => Promise<void>;
  /** Extra cleanup when a team is purged (health history, etc.). */
  onPurge?: (teamId: string) => Promise<void> | void;
  now: () => number;
}

export interface ExportResult {
  file: string;
  bytes: number;
  zip: Buffer;
  counts: Record<string, number>;
}

/** Same name check the UI asks for: trimmed, case-insensitive; the team id also works. */
export const confirmMatches = (team: Team, typed: unknown) =>
  typeof typed === "string" &&
  (typed.trim().toLowerCase() === team.name.trim().toLowerCase() || typed.trim() === team.id);

export class TeamLifecycle {
  readonly trashDir: string;

  constructor(private readonly d: TeamLifecycleDeps) {
    this.trashDir = join(resolve(d.dataDir), "trash");
  }

  /** Everything the team owns, as a zip (no secrets: no key hashes, no secret values). */
  async exportTeam(team: Team): Promise<ExportResult> {
    const d = this.d;
    const files: { path: string; data: Buffer }[] = [];
    const json = (path: string, v: unknown) =>
      files.push({ path, data: Buffer.from(`${JSON.stringify(v, null, 2)}\n`, "utf8") });
    const counts: Record<string, number> = {};

    const members = d.members.list(team.id).map(({ passwordHash: _p, ...m }) => m);
    const invites = d.members
      .listInvites(team.id)
      .map(({ tokenHash: _t, ...i }) => i as Record<string, unknown>);
    json("members.json", { members, invites });
    counts.members = members.length;

    const audit = d.members.entries(team.id, undefined, 500);
    json("activity.json", audit);
    counts.activity = audit.length;

    // Sites: metadata + files (up to EXPORT_FILES_MAX in total) + KV/backend data.
    const sites = (await d.store.list()).filter((m) => m.teamId === team.id);
    json(
      "sites.json",
      sites.map((m) => {
        const { mcpTokens, ...pub } = publicMeta(m) as ReturnType<typeof publicMeta> & {
          mcpTokens?: unknown[];
        };
        return { ...pub, mcpTokens: (mcpTokens ?? []).length };
      }),
    );
    counts.sites = sites.length;
    let copied = 0;
    const skipped: string[] = [];
    for (const m of sites) {
      for (const path of Object.keys(m.files)) {
        const full = d.store.filePath(m, path);
        if (!full) continue;
        const size = m.files[path]?.size ?? 0;
        if (copied + size > EXPORT_FILES_MAX) {
          skipped.push(`${m.id}/${path}`);
          continue;
        }
        try {
          files.push({ path: `sites/${m.id}/${path}`, data: await readFile(full) });
          copied += size;
        } catch {
          skipped.push(`${m.id}/${path}`);
        }
      }
      if (d.backend && team.backend) {
        try {
          const keys = await d.backend.kvList(m.id, KV_EXPORT_MAX);
          const kv: Record<string, unknown> = {};
          for (const k of keys) {
            const v = await d.backend.kvGet(m.id, k);
            if (v !== undefined) kv[k] = JSON.parse(v);
          }
          if (keys.length) json(`site-data/${m.id}/kv.json`, kv);
          const bf = await d.backend.filesList(m.id, 1000);
          if (bf.length) json(`site-data/${m.id}/files.json`, bf);
          counts.kvKeys = (counts.kvKeys ?? 0) + keys.length;
        } catch (e) {
          json(`site-data/${m.id}/error.json`, { error: (e as Error).message.slice(0, 300) });
        }
      }
    }
    counts.siteFiles = files.filter((f) => f.path.startsWith("sites/")).length;

    // Workers: records (var values included: they are not secrets; secret values never leave
    // Cloudflare) and every stored version's code.
    const workers = d.workers.list(team.id);
    json("workers.json", workers.map(workerView));
    for (const w of workers) {
      const versions = await d.workers.listVersions(w).catch(() => []);
      for (const v of versions) {
        const full = await d.workers.getVersion(w, v.n).catch(() => null);
        if (full?.code)
          files.push({ path: `workers/${w.name}/v${v.n}.js`, data: Buffer.from(full.code) });
      }
      const keys = d.userKeys.list(w.id).map((k) => d.userKeys.view(k));
      if (keys.length) json(`workers/${w.name}/user-keys.json`, keys);
    }
    counts.workers = workers.length;

    json(
      "agent-keys.json",
      d.agentKeys.list(team.id).map((k) => d.agentKeys.view(k)),
    );
    json(
      "recipes.json",
      d.recipes.visible(team.id).filter((r) => r.scope === "team" && r.teamId === team.id),
    );
    json("agent-notes.json", d.agentNotes.list({ teamId: team.id }, 1000));
    json("notifications.json", d.notify.list(team.id, 500));
    json("manifest.json", {
      format: "marsa-team-export",
      version: 1,
      app: APP_VERSION,
      exportedAt: new Date(d.now()).toISOString(),
      team: publicTeam(team),
      counts,
      skippedFiles: skipped,
      note: "No key hashes, passwords or secret values are included. Worker secrets live only in Cloudflare.",
    });
    const zip = zipFiles(files, new Date(d.now()));
    const stamp = new Date(d.now()).toISOString().replace(/[:.]/g, "-");
    return { file: `${team.id}-${stamp}.zip`, bytes: zip.length, zip, counts };
  }

  /** Save an export under <dataDir>/trash/ (0600). */
  private async saveExport(ex: ExportResult): Promise<void> {
    await mkdir(this.trashDir, { recursive: true });
    const tmp = join(this.trashDir, `.${randomBytes(6).toString("hex")}.tmp`);
    await writeFile(tmp, ex.zip, { mode: 0o600 });
    await rename(tmp, join(this.trashDir, ex.file));
  }

  /** The saved export of a trashed team (bytes), or null. */
  async trashedExport(id: string): Promise<{ file: string; zip: Buffer } | null> {
    const tr = this.d.teams.getTrashed(id);
    if (!tr?.exportFile || !/^[\w.-]+\.zip$/.test(tr.exportFile)) return null;
    try {
      return { file: tr.exportFile, zip: await readFile(join(this.trashDir, tr.exportFile)) };
    } catch {
      return null;
    }
  }

  /** Soft delete: export, Workers off, team into the trash for TRASH_DAYS. */
  async softDelete(
    id: string,
    actor: Actor,
    opts: { deleteSites: boolean; confirm: unknown },
  ): Promise<TrashedTeam> {
    const d = this.d;
    const team = d.teams.get(id);
    if (!team) throw new TeamLifecycleError(404, "NOT_FOUND", "team not found");
    if (!confirmMatches(team, opts.confirm))
      throw new TeamLifecycleError(400, "CONFIRM_MISMATCH", "type the team name to confirm");
    const ex = await this.exportTeam(team);
    await this.saveExport(ex);
    const disabled: string[] = [];
    for (const w of d.workers.list(id)) {
      if (w.status !== "active") continue;
      try {
        await d.workers.setDisabled(w, true, actor);
        disabled.push(w.id);
      } catch (e) {
        // Roll back what was turned off so the team isn't half-deleted.
        for (const wid of disabled) {
          const r = d.workers.list(id).find((x) => x.id === wid);
          if (r) await d.workers.setDisabled(r, false, actor).catch(() => {});
        }
        throw new TeamLifecycleError(
          502,
          "CLOUDFLARE_ERROR",
          `could not turn the team's Workers off: ${(e as Error).message}`,
        );
      }
    }
    const t = d.now();
    const entry = await d.teams.moveToTrash(id, {
      deletedAt: new Date(t).toISOString(),
      purgeAfter: new Date(t + TRASH_DAYS * DAY).toISOString(),
      deletedBy: actor.label,
      deleteSites: opts.deleteSites,
      disabledWorkers: disabled,
      exportFile: ex.file,
    });
    if (!entry) throw new TeamLifecycleError(404, "NOT_FOUND", "team not found");
    d.sessions.endAll(`team:${id}`);
    d.invalidateDirectory();
    const detail = `${team.name}${opts.deleteSites ? " (+sites)" : ""}`;
    await d.audit({ teamId: id, actor, action: "team-delete", detail });
    await d.audit({ teamId: PLATFORM_AUDIT, actor, action: "team-delete", detail });
    return entry;
  }

  /** Bring a trashed team back; Workers that the delete turned off go back on. */
  async restore(
    id: string,
    actor: Actor,
  ): Promise<{ team: Team; workersOn: number; failed: string[] }> {
    const d = this.d;
    const tr = d.teams.getTrashed(id);
    if (!tr) throw new TeamLifecycleError(404, "NOT_FOUND", "no such team in the trash");
    const team = await d.teams.restore(id, d.now());
    if (!team) throw new TeamLifecycleError(404, "NOT_FOUND", "no such team in the trash");
    let on = 0;
    const failed: string[] = [];
    for (const w of d.workers.list(id)) {
      if (!tr.disabledWorkers.includes(w.id) || w.status !== "disabled") continue;
      try {
        await d.workers.setDisabled(w, false, actor);
        on++;
      } catch {
        failed.push(w.name);
      }
    }
    // The team is live again (and can be exported any time): drop the deletion-time export.
    if (tr.exportFile && /^[\w.-]+\.zip$/.test(tr.exportFile))
      await rm(join(this.trashDir, tr.exportFile), { force: true }).catch(() => {});
    d.invalidateDirectory();
    await d.audit({ teamId: id, actor, action: "team-restore", detail: team.name });
    await d.audit({ teamId: PLATFORM_AUDIT, actor, action: "team-restore", detail: team.name });
    return { team, workersOn: on, failed };
  }

  /** Hard delete of a trashed team (after the grace period, or "delete now" with the name). */
  async purge(
    id: string,
    actor: Actor,
    confirm?: unknown,
  ): Promise<{ removedWorkers: number; removedSites: number }> {
    const d = this.d;
    const tr = d.teams.getTrashed(id);
    if (!tr) throw new TeamLifecycleError(404, "NOT_FOUND", "no such team in the trash");
    if (confirm !== undefined && !confirmMatches(tr.team, confirm))
      throw new TeamLifecycleError(400, "CONFIRM_MISMATCH", "type the team name to confirm");
    let removedWorkers = 0;
    try {
      removedWorkers = await d.workers.teardownTeam(id, actor);
    } catch (e) {
      throw new TeamLifecycleError(
        502,
        "CLOUDFLARE_ERROR",
        `could not remove the team's Workers: ${(e as Error).message}`,
      );
    }
    let removedSites = 0;
    if (tr.deleteSites) {
      for (const m of await d.store.list()) {
        if (m.teamId === id) {
          await d.deleteSite(m.id);
          removedSites++;
        }
      }
    }
    await d.teams.delete(id);
    await d.members.purgeTeam(id);
    await d.agentKeys.purgeTeam(id);
    await d.notify.purgeTeam(id);
    await d.userKeys.purgeTeam(id);
    await d.recipes.purgeTeam(id);
    await d.agentNotes.purgeTeam(id);
    await d.onPurge?.(id);
    if (tr.exportFile && /^[\w.-]+\.zip$/.test(tr.exportFile)) {
      // Keep the export 30 more days for the record, then the sweep removes it.
      await rename(
        join(this.trashDir, tr.exportFile),
        join(this.trashDir, `purged-${this.d.now()}-${tr.exportFile}`),
      ).catch(() => {});
    }
    d.invalidateDirectory();
    await d.audit({
      teamId: PLATFORM_AUDIT,
      actor,
      action: "team-purge",
      detail: `${tr.team.name} (${removedWorkers} Workers, ${removedSites} sites)`,
    });
    return { removedWorkers, removedSites };
  }

  /** Purge teams whose grace period is over, and old purged exports. Called by the sweep. */
  async purgeDue(actor: Actor): Promise<string[]> {
    const t = this.d.now();
    const done: string[] = [];
    for (const tr of this.d.teams.listTrash()) {
      if (Date.parse(tr.purgeAfter) > t) continue;
      try {
        await this.purge(tr.team.id, actor);
        done.push(tr.team.id);
      } catch (e) {
        console.error(`[trash] purge of ${tr.team.id} failed: ${(e as Error).message}`);
      }
    }
    // Exports of purged teams: kept 30 days after the purge (the time is in the name).
    for (const f of await readdir(this.trashDir).catch(() => [] as string[])) {
      const at = Number(/^purged-(\d+)-/.exec(f)?.[1]);
      if (Number.isFinite(at) && at + 30 * DAY < t)
        await rm(join(this.trashDir, f), { force: true });
    }
    return done;
  }
}
