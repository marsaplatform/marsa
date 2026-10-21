/**
 * Per-isolate memo with a TTL. Cheap and shared by every request the isolate serves;
 * use it for reference data. For data shared across isolates, also use caches.default.
 */
const store = new Map<string, { at: number; value: unknown }>();

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  store.set(key, { at: Date.now(), value });
  return value;
}

export const clearCache = () => store.clear();
