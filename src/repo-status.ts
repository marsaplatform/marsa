/**
 * Repository links for Workers and spaces (0.15.1): where the code lives, whether the repo
 * is public, and whether the deployed commit is the branch's latest. Read-only GitHub API
 * calls, cached; an optional server-side GITHUB_TOKEN (never shown) tells private from
 * missing repos.
 */

export interface RepoLink {
  url: string;
  branch?: string;
  commitSha?: string;
}

export type RepoVisibility = "public" | "private" | "not-found" | "unknown" | "unchecked";
export type RepoSync = "synced" | "behind" | "diverged" | "unknown";

export interface RepoStatus {
  at: string;
  visibility: RepoVisibility;
  /** With no token a 404 can be private or missing. */
  visibilityConfirmed: boolean;
  sync: RepoSync;
  behindBy?: number;
  latestSha?: string;
  branch?: string;
}

export class RepoError extends Error {}

const GH_RE =
  /^https:\/\/github\.com\/([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?\/?$/;
const SHA_RE = /^[0-9a-f]{7,40}$/i;
const BRANCH_RE = /^[A-Za-z0-9._/-]{1,200}$/;

/** undefined = keep; null = remove the link. */
export function readRepo(raw: unknown): RepoLink | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const o = (typeof raw === "string" ? { url: raw } : raw) as Record<string, unknown>;
  if (typeof o !== "object" || Array.isArray(o))
    throw new RepoError("repo: {url, branch?, commitSha?}");
  const extra = Object.keys(o).find((k) => !["url", "repoUrl", "branch", "commitSha"].includes(k));
  if (extra) throw new RepoError(`repo.${extra.slice(0, 30)} is not supported`);
  const url = String(o.url ?? o.repoUrl ?? "").trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RepoError("repo.url: an https URL, e.g. https://github.com/org/repo");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || url.length > 300)
    throw new RepoError("repo.url: an https URL without credentials");
  const out: RepoLink = { url: url.replace(/\.git$/, "").replace(/\/$/, "") };
  if (o.branch !== undefined && o.branch !== "") {
    if (typeof o.branch !== "string" || !BRANCH_RE.test(o.branch) || o.branch.includes(".."))
      throw new RepoError("repo.branch: a branch name");
    out.branch = o.branch;
  }
  if (o.commitSha !== undefined && o.commitSha !== "") {
    if (typeof o.commitSha !== "string" || !SHA_RE.test(o.commitSha))
      throw new RepoError("repo.commitSha: 7-40 hex characters");
    out.commitSha = o.commitSha.toLowerCase();
  }
  return out;
}

export const githubRepoOf = (url: string): { owner: string; repo: string } | null => {
  const m = GH_RE.exec(url);
  return m ? { owner: m[1] as string, repo: m[2] as string } : null;
};

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export class RepoChecker {
  private readonly cache = new Map<string, RepoStatus>();
  private readonly running = new Set<string>();
  constructor(
    private readonly fetchFn: FetchFn,
    private readonly now: () => number,
    private readonly token: string | null = null,
    private readonly api = "https://api.github.com",
    private readonly ttlMs = 15 * 60 * 1000,
  ) {}

  private key(l: RepoLink) {
    return `${l.url}#${l.branch ?? ""}#${l.commitSha ?? ""}`;
  }
  get(l: RepoLink | undefined | null): RepoStatus | null {
    if (!l) return null;
    if (!githubRepoOf(l.url))
      return { at: "", visibility: "unchecked", visibilityConfirmed: false, sync: "unknown" };
    return this.cache.get(this.key(l)) ?? null;
  }
  /** Check in the background when nothing fresh is cached (a few at a time). */
  touch(l: RepoLink | undefined | null): void {
    if (!l || !githubRepoOf(l.url)) return;
    const k = this.key(l);
    const hit = this.cache.get(k);
    if (
      (hit && this.now() - Date.parse(hit.at) < this.ttlMs) ||
      this.running.has(k) ||
      this.running.size >= 3
    )
      return;
    void this.check(l);
  }

  private async gh(path: string, auth: boolean): Promise<Response> {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "user-agent": "marsa-spaces/1 (repo status)",
      "x-github-api-version": "2022-11-28",
    };
    if (auth && this.token) headers.authorization = `Bearer ${this.token}`;
    return this.fetchFn(`${this.api}${path}`, { headers, signal: AbortSignal.timeout(5000) });
  }

  async check(l: RepoLink): Promise<RepoStatus> {
    const gh = githubRepoOf(l.url);
    const at = new Date(this.now()).toISOString();
    if (!gh) return { at, visibility: "unchecked", visibilityConfirmed: false, sync: "unknown" };
    const k = this.key(l);
    this.running.add(k);
    try {
      const base = `/repos/${encodeURIComponent(gh.owner)}/${encodeURIComponent(gh.repo)}`;
      let auth = false;
      let r = await this.gh(base, false);
      let visibility: RepoVisibility = "unknown";
      let confirmed = false;
      if (r.status === 200) {
        visibility = "public";
        confirmed = true;
      } else if (r.status === 404) {
        if (this.token) {
          r = await this.gh(base, true);
          auth = true;
          visibility = r.status === 200 ? "private" : r.status === 404 ? "not-found" : "unknown";
          confirmed = r.status === 200 || r.status === 404;
        } else {
          visibility = "private";
        }
      }
      const out: RepoStatus = { at, visibility, visibilityConfirmed: confirmed, sync: "unknown" };
      if (r.status === 200) {
        const info = (await r.json().catch(() => ({}))) as { default_branch?: string };
        const branch = l.branch ?? info.default_branch;
        if (branch) {
          out.branch = branch;
          const c = await this.gh(`${base}/commits/${encodeURIComponent(branch)}`, auth);
          if (c.status === 200) {
            const sha = ((await c.json().catch(() => ({}))) as { sha?: string }).sha;
            if (sha) out.latestSha = sha;
            if (sha && l.commitSha) {
              if (sha.startsWith(l.commitSha)) out.sync = "synced";
              else {
                const cmp = await this.gh(
                  `${base}/compare/${l.commitSha}...${encodeURIComponent(branch)}`,
                  auth,
                );
                if (cmp.status === 200) {
                  const j = (await cmp.json().catch(() => ({}))) as {
                    status?: string;
                    ahead_by?: number;
                  };
                  if (j.status === "identical") out.sync = "synced";
                  else if (j.status === "ahead") {
                    out.sync = "behind";
                    if (typeof j.ahead_by === "number") out.behindBy = j.ahead_by;
                  } else if (j.status === "diverged") out.sync = "diverged";
                  else out.sync = "behind";
                } else out.sync = "behind";
              }
            }
          }
        }
      }
      this.cache.set(k, out);
      return out;
    } catch {
      const out: RepoStatus = {
        at,
        visibility: "unknown",
        visibilityConfirmed: false,
        sync: "unknown",
      };
      this.cache.set(k, out);
      return out;
    } finally {
      this.running.delete(k);
    }
  }
}

/** One filterable value: none, public, private, not-found, unknown, unchecked. */
export const repoFilterValue = (l: RepoLink | undefined | null, s: RepoStatus | null): string =>
  !l ? "none" : (s?.visibility ?? "unknown");
