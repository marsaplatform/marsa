/**
 * Runtime settings a team may choose for its Workers (0.15.0): Cloudflare compatibility
 * flags (from an allowlist), the compatibility date, and service bindings to other
 * Workers of the SAME team. Only validation lives here; WorkerService resolves names.
 */

/** Flags a team may turn on. Anything else is refused (400). */
export const ALLOWED_COMPAT_FLAGS = [
  "global_fetch_strictly_public",
  "nodejs_compat",
  "nodejs_als",
] as const;

/** Cloudflare's first compatibility date. */
export const MIN_COMPAT_DATE = "2021-11-03";
export const MAX_BINDINGS = 10;
const BINDING_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const WORKER_REF_RE = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/;

/** A service binding as a team writes it: env NAME → one of its own Workers by name. */
export interface ServiceBinding {
  name: string;
  worker: string;
}

/** What is stored on the Worker and in each version. */
export interface WorkerRuntime {
  compatibilityDate?: string;
  compatibilityFlags?: string[];
  bindings?: ServiceBinding[];
}

export class ConfigError extends Error {}

const todayIso = (now: number) => new Date(now).toISOString().slice(0, 10);

/** undefined = keep the current value; null = back to the platform default. */
export function readCompatDate(raw: unknown, now: number): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string" || !/^\d{4}-\d\d-\d\d$/.test(raw)) {
    throw new ConfigError("compatibilityDate: a date like 2025-09-01");
  }
  const t = Date.parse(`${raw}T00:00:00Z`);
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== raw) {
    throw new ConfigError("compatibilityDate: not a real date");
  }
  if (raw < MIN_COMPAT_DATE || raw > todayIso(now)) {
    throw new ConfigError(`compatibilityDate: between ${MIN_COMPAT_DATE} and today`);
  }
  return raw;
}

/** undefined = keep; [] or null = none. Sorted, de-duplicated, allowlisted. */
export function readCompatFlags(raw: unknown): string[] | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return [];
  if (!Array.isArray(raw) || raw.some((f) => typeof f !== "string")) {
    throw new ConfigError("compatibilityFlags: an array of flag names");
  }
  const allowed = new Set<string>(ALLOWED_COMPAT_FLAGS);
  const out = new Set<string>();
  for (const f of raw as string[]) {
    const flag = f.trim();
    if (!allowed.has(flag)) {
      throw new ConfigError(
        `compatibilityFlags: "${flag.slice(0, 60)}" is not allowed (allowed: ${ALLOWED_COMPAT_FLAGS.join(", ")})`,
      );
    }
    out.add(flag);
  }
  return [...out].sort();
}

/**
 * undefined = keep; [] or null = none. Each entry is exactly {name, worker}: `worker` is
 * the short name of a Worker in the same team. Script names, "service" or "environment"
 * are refused so a binding can never point outside the team.
 */
export function readBindings(raw: unknown): ServiceBinding[] | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ConfigError('bindings: an array like [{"name":"NEWS","worker":"news"}]');
  }
  if (raw.length > MAX_BINDINGS) throw new ConfigError(`bindings: at most ${MAX_BINDINGS}`);
  const out: ServiceBinding[] = [];
  const names = new Set<string>();
  for (const b of raw) {
    if (!b || typeof b !== "object" || Array.isArray(b)) {
      throw new ConfigError('bindings: each entry is {"name","worker"}');
    }
    const keys = Object.keys(b);
    const extra = keys.find((k) => k !== "name" && k !== "worker" && k !== "type");
    if (extra) {
      throw new ConfigError(
        `bindings: "${extra.slice(0, 30)}" is not supported; use {"name","worker"} with a Worker of this team`,
      );
    }
    const { name, worker, type } = b as Record<string, unknown>;
    if (type !== undefined && type !== "service") {
      throw new ConfigError('bindings: only service bindings (type "service")');
    }
    if (typeof name !== "string" || !BINDING_NAME_RE.test(name) || name.startsWith("MARSA_")) {
      throw new ConfigError("bindings: name must be an env name like NEWS (not MARSA_*)");
    }
    if (typeof worker !== "string" || !WORKER_REF_RE.test(worker) || worker.includes("--")) {
      throw new ConfigError(
        `bindings.${name}: worker is the short name of one of this team's Workers`,
      );
    }
    if (names.has(name)) throw new ConfigError(`bindings: ${name} is used twice`);
    names.add(name);
    out.push({ name, worker });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
