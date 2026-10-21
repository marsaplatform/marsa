/**
 * 0.17.0: deploy jobs. Every Worker deploy (create, redeploy, rollback, runtime/env change)
 * gets a job id. A request waits up to WORKER_DEPLOY_WAIT_SEC for it and answers as before;
 * if the deploy takes longer, or the caller asked for async (?async=1 or
 * `Prefer: respond-async`), it answers 202 with the job, which is polled at
 * GET /api/teams/:team/jobs/:id. Jobs are kept for 7 days (the last 500); a job that was
 * still running when the server restarted is marked "interrupted".
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "interrupted";
export type JobKind = "deploy" | "redeploy" | "rollback" | "runtime" | "env";

export interface JobHealth {
  path: string;
  status: number | null;
  ms: number;
  ok: boolean;
}

export interface WorkerJob {
  id: string;
  teamId: string;
  worker: string;
  kind: JobKind;
  status: JobStatus;
  by: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** On success: the deployed version and the post-deploy health probe. */
  version?: number | null;
  health?: JobHealth | null;
  /** On failure: what the synchronous API would have answered. */
  error?: { status: number; code: string; message: string };
  /** Anything else the synchronous answer carries (e.g. rollback's missingSecrets). */
  extra?: Record<string, unknown>;
}

const KEEP = 500;
const TTL_MS = 7 * 24 * 3600_000;

export class JobStore {
  private jobs = new Map<string, WorkerJob>();
  private readonly file: string;
  private readonly tmp: string;
  private loading: Promise<void> | null = null;
  private writeQ: Promise<void> = Promise.resolve();

  constructor(
    dataDir: string,
    private readonly now: () => number,
  ) {
    this.file = join(resolve(dataDir), "worker-jobs.json");
    this.tmp = join(resolve(dataDir), "tmp");
  }

  ready(): Promise<void> {
    this.loading ??= (async () => {
      try {
        const raw = JSON.parse(await readFile(this.file, "utf8")) as { jobs?: WorkerJob[] };
        for (const j of raw.jobs ?? []) {
          if (j.status === "queued" || j.status === "running") {
            j.status = "interrupted";
            j.finishedAt ??= new Date(this.now()).toISOString();
            j.error ??= {
              status: 503,
              code: "INTERRUPTED",
              message:
                "the server restarted while this deploy was in progress; check the Worker's version and deploy again if needed",
            };
          }
          this.jobs.set(j.id, j);
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    })();
    return this.loading;
  }

  private iso() {
    return new Date(this.now()).toISOString();
  }

  private save() {
    const cut = this.now() - TTL_MS;
    const all = [...this.jobs.values()]
      .filter((j) => Date.parse(j.createdAt) >= cut)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-KEEP);
    this.jobs = new Map(all.map((j) => [j.id, j]));
    const body = JSON.stringify({ version: 1, jobs: all }, null, 2);
    const run = async () => {
      await mkdir(this.tmp, { recursive: true });
      const t = join(this.tmp, `jobs-${randomBytes(6).toString("hex")}.json`);
      await writeFile(t, body, { mode: 0o600 });
      await rename(t, this.file);
    };
    this.writeQ = this.writeQ.then(run, run);
    return this.writeQ;
  }

  async create(teamId: string, worker: string, kind: JobKind, by: string): Promise<WorkerJob> {
    await this.ready();
    const j: WorkerJob = {
      id: `job_${randomBytes(8).toString("hex")}`,
      teamId,
      worker,
      kind,
      status: "queued",
      by,
      createdAt: this.iso(),
    };
    this.jobs.set(j.id, j);
    await this.save();
    return j;
  }

  async update(id: string, change: Partial<WorkerJob>): Promise<WorkerJob | null> {
    const j = this.jobs.get(id);
    if (!j) return null;
    Object.assign(j, change);
    await this.save();
    return j;
  }

  async get(teamId: string, id: string): Promise<WorkerJob | null> {
    await this.ready();
    const j = this.jobs.get(id);
    return j && j.teamId === teamId ? j : null;
  }

  async list(teamId: string, worker?: string, limit = 20): Promise<WorkerJob[]> {
    await this.ready();
    return [...this.jobs.values()]
      .filter((j) => j.teamId === teamId && (!worker || j.worker === worker))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  started(id: string) {
    return this.update(id, { status: "running", startedAt: this.iso() });
  }
  succeeded(id: string, out: Pick<WorkerJob, "version" | "health" | "extra">) {
    return this.update(id, { status: "succeeded", finishedAt: this.iso(), ...out });
  }
  failed(id: string, error: WorkerJob["error"]) {
    return this.update(id, { status: "failed", finishedAt: this.iso(), ...(error ? { error } : {}) });
  }
}

/** What clients see (the same shape in 202 answers and on the status endpoint). */
export const jobView = (j: WorkerJob, publicUrl: string, teamRef: string) => ({
  id: j.id,
  worker: j.worker,
  kind: j.kind,
  status: j.status,
  done: j.status === "succeeded" || j.status === "failed" || j.status === "interrupted",
  by: j.by,
  createdAt: j.createdAt,
  startedAt: j.startedAt ?? null,
  finishedAt: j.finishedAt ?? null,
  version: j.version ?? null,
  health: j.health ?? null,
  error: j.error ?? null,
  ...(j.extra ?? {}),
  statusUrl: `${publicUrl}/api/teams/${encodeURIComponent(teamRef)}/jobs/${j.id}`,
});
