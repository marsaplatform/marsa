import type { SiteBackend } from "./backend/types.js";
import type { SiteStore } from "./store.js";

/** Remove one site's files and, if a backend is configured, its KV data and backend files. */
export async function removeSite(
  store: SiteStore,
  backend: SiteBackend | null,
  id: string,
): Promise<void> {
  await store.delete(id);
  if (backend) {
    try {
      await backend.purgeSite(id);
    } catch (err) {
      console.error(`[backend] purge of ${id} failed`, err);
    }
  }
}

/** Delete every expired site (and its backend data). Returns the removed ids. */
export async function sweepExpired(
  store: SiteStore,
  backend: SiteBackend | null,
  now = Date.now(),
): Promise<string[]> {
  const removed = await store.sweepExpired(now);
  if (backend) {
    for (const id of removed) {
      try {
        await backend.purgeSite(id);
      } catch (err) {
        console.error(`[backend] purge of ${id} failed`, err);
      }
    }
  }
  return removed;
}
