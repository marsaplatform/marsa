import { CloudflareError } from "./cloudflare.js";
import type { SiteBackend } from "./types.js";

export interface ProbeResult {
  ok: boolean;
  /** Upstream HTTP status when the store answered with an error. */
  status?: number;
  /** Short reason (never contains credentials). */
  error?: string;
}
export interface BackendHealth {
  kind: string;
  kv: ProbeResult;
  files: ProbeResult;
}

const reason = (e: unknown): ProbeResult => {
  if (e instanceof CloudflareError) {
    const auth = e.status === 401 || e.status === 403;
    return {
      ok: false,
      status: e.status,
      error: auth
        ? `Cloudflare rejected the server's ${e.service === "kv" ? "API token (needs Account · Workers KV Storage: Edit)" : "R2 keys"}: ${e.message}`
        : e.message,
    };
  }
  return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "unknown error" };
};

/** Live check of the data/files backend: one cheap read on each store (a prefix no site uses). */
export async function probeBackend(backend: SiteBackend): Promise<BackendHealth> {
  const run = async (fn: () => Promise<unknown>): Promise<ProbeResult> => {
    try {
      await fn();
      return { ok: true };
    } catch (e) {
      return reason(e);
    }
  };
  return {
    kind: backend.kind,
    kv: await run(() => backend.kvList("__health__", 1)),
    files: await run(() => backend.filesList("__health__", 1)),
  };
}
