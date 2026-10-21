/**
 * 0.15.2: the "Variables & secrets" view of a Spaces Worker. Names, types and status only:
 * secret values are never read back (Cloudflare does not return them) and plain var values
 * are never shown either. Missing names come from the declared `requiredEnv` and a light
 * scan of `env.X` usage in the stored code.
 */
import type { CfBindingInfo } from "./cf-workers.js";

export const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** Secrets Spaces itself puts on a Worker for end-user keys. */
export const SYSTEM_SECRETS = ["MARSA_KEYS_URL", "MARSA_KEYS_SECRET"] as const;
export const SECRET_MAX_BYTES = 5 * 1024;
export const REQUIRED_ENV_MAX = 50;

export class EnvError extends Error {}

/** Validate a declared `requiredEnv` list (undefined = not sent, null = clear). */
export function readRequiredEnv(raw: unknown): string[] | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (!Array.isArray(raw) || raw.length > REQUIRED_ENV_MAX)
    throw new EnvError(`requiredEnv: a list of up to ${REQUIRED_ENV_MAX} names`);
  const out = new Set<string>();
  for (const n of raw) {
    if (typeof n !== "string" || !ENV_NAME_RE.test(n))
      throw new EnvError(
        "requiredEnv: names are letters, digits and _ (not starting with a digit)",
      );
    out.add(n);
  }
  return [...out].sort();
}

/** Names the code reads from env: env.X, env?.X, env["X"], and `const { X } = env`. */
export function scanEnvUsage(code: string): string[] {
  const out = new Set<string>();
  // 0.16.0: a name counts only if at least one use has no default (`env.X ?? …`,
  // `env.X || …`, or `{ X = … } = env`), so optional settings stay quiet.
  const bare = new Set<string>();
  const src = code.slice(0, 2_000_000);
  const hasDefault = (end: number) => /^\s*(\?\?|\|\|)/.test(src.slice(end, end + 8));
  for (const m of src.matchAll(/\benv\??\.([A-Z][A-Z0-9_]{1,63})\b/g)) {
    out.add(m[1] as string);
    if (!hasDefault((m.index ?? 0) + m[0].length)) bare.add(m[1] as string);
  }
  for (const m of src.matchAll(/\benv\??\.?\[\s*["'`]([A-Z][A-Z0-9_]{1,63})["'`]\s*\]/g)) {
    out.add(m[1] as string);
    if (!hasDefault((m.index ?? 0) + m[0].length)) bare.add(m[1] as string);
  }
  for (const m of src.matchAll(/\{([^{}]{1,400})\}\s*=\s*env\b/g)) {
    for (const part of (m[1] as string).split(",")) {
      const name = part.split(":")[0]?.split("=")[0]?.trim() ?? "";
      if (/^[A-Z][A-Z0-9_]{1,63}$/.test(name)) {
        out.add(name);
        if (!part.includes("=")) bare.add(name);
      }
    }
  }
  for (const s of SYSTEM_SECRETS) out.delete(s);
  return [...out].filter((n) => bare.has(n)).sort();
}

/** 0.16.0: "unset" = used in the code but not set and not declared (info, not a warning). */
export type EnvKind = "var" | "secret" | "system" | "binding" | "missing" | "unset";
export interface EnvEntry {
  name: string;
  kind: EnvKind;
  /** Cloudflare binding type (plain_text, secret_text, service, …) or "—" when missing. */
  type: string;
  status: "set" | "empty" | "missing" | "unset";
  /** Where the row comes from: the live Cloudflare script, or Spaces' own record. */
  source: "cloudflare" | "spaces";
  updatedAt: string | null;
  updatedBy: string | null;
  /** Why a name is expected: declared in requiredEnv, or seen in the code. */
  expected: "declared" | "code" | null;
  /** A var over 5 KB that rides in a bundled module rather than a binding. */
  bundled?: boolean;
}

export interface EnvView {
  entries: EnvEntry[];
  /** Declared in requiredEnv but not set (shown as a warning). */
  missing: { name: string; why: "declared" | "code" }[];
  /** 0.16.0: used in the code without a default, not declared, not set (info only). */
  unset: string[];
  /** "cloudflare" when the live bindings were read, else "spaces" (record only). */
  source: "cloudflare" | "spaces";
  liveError: string | null;
  requiredEnv: string[];
}

export interface EnvInput {
  vars: Record<string, string>;
  secrets: string[];
  secretsMeta?: Record<string, { at: string; by: string }>;
  varsMeta?: Record<string, { at: string; by: string }>;
  deployedAt?: string | null;
  deployedBy?: string;
  bindings?: { name: string }[];
  requiredEnv?: string[];
}

/** Merge the live bindings (when readable) with Spaces' record. No values ever. */
export function buildEnvView(
  rec: EnvInput,
  live: CfBindingInfo[] | null,
  code: string | null,
  liveError: string | null = null,
): EnvView {
  const entries = new Map<string, EnvEntry>();
  const declared = new Set(rec.requiredEnv ?? []);
  const metaOf = (m?: Record<string, { at: string; by: string }>, n?: string) =>
    n && m?.[n] ? m[n] : { at: rec.deployedAt ?? null, by: rec.deployedBy ?? null };
  const sys = new Set<string>(SYSTEM_SECRETS);
  if (live) {
    for (const b of live) {
      const kind: EnvKind = sys.has(b.name)
        ? "system"
        : b.type === "secret_text" || b.type === "secret_key"
          ? "secret"
          : b.type === "plain_text" || b.type === "json"
            ? "var"
            : "binding";
      const meta =
        kind === "secret" ? metaOf(rec.secretsMeta, b.name) : metaOf(rec.varsMeta, b.name);
      entries.set(b.name, {
        name: b.name,
        kind,
        type: b.type,
        status: b.empty ? "empty" : "set",
        source: "cloudflare",
        updatedAt: kind === "system" ? null : (meta.at ?? null),
        updatedBy: kind === "system" ? null : (meta.by ?? null),
        expected: null,
      });
    }
  }
  // What Spaces knows but the live read did not show (or no live read at all).
  for (const [n, v] of Object.entries(rec.vars)) {
    if (entries.has(n)) continue;
    const meta = metaOf(rec.varsMeta, n);
    entries.set(n, {
      name: n,
      kind: "var",
      type: "plain_text",
      status: v === "" ? "empty" : "set",
      source: "spaces",
      updatedAt: meta.at ?? null,
      updatedBy: meta.by ?? null,
      expected: null,
      ...(Buffer.byteLength(v) > 5 * 1024 ? { bundled: true } : {}),
    });
  }
  for (const n of rec.secrets) {
    if (entries.has(n)) continue;
    const meta = metaOf(rec.secretsMeta, n);
    entries.set(n, {
      name: n,
      kind: "secret",
      type: "secret_text",
      // Recorded by Spaces but not seen live: only "missing" when the live read worked.
      status: live ? "missing" : "set",
      source: "spaces",
      updatedAt: meta.at ?? null,
      updatedBy: meta.by ?? null,
      expected: null,
    });
  }
  for (const b of rec.bindings ?? []) {
    if (entries.has(b.name)) continue;
    entries.set(b.name, {
      name: b.name,
      kind: "binding",
      type: "service",
      status: live ? "missing" : "set",
      source: "spaces",
      updatedAt: rec.deployedAt ?? null,
      updatedBy: null,
      expected: null,
    });
  }
  const used = code ? scanEnvUsage(code) : [];
  const missing: EnvView["missing"] = [];
  const unset: string[] = [];
  for (const [n, why] of [
    ...[...declared].map((n) => [n, "declared"] as const),
    ...used.filter((n) => !declared.has(n)).map((n) => [n, "code"] as const),
  ]) {
    const e = entries.get(n);
    if (e) {
      e.expected = why;
      if (e.status === "empty" && why === "declared") missing.push({ name: n, why });
      continue;
    }
    // 0.16.0: only declared names are "missing" (a warning); code-only names are info rows.
    if (why === "declared") missing.push({ name: n, why });
    else unset.push(n);
    entries.set(n, {
      name: n,
      kind: why === "declared" ? "missing" : "unset",
      type: "—",
      status: why === "declared" ? "missing" : "unset",
      source: "spaces",
      updatedAt: null,
      updatedBy: null,
      expected: why,
    });
  }
  const order: Record<EnvKind, number> = {
    missing: 0,
    secret: 1,
    var: 2,
    binding: 3,
    unset: 4,
    system: 5,
  };
  return {
    entries: [...entries.values()].sort(
      (a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name),
    ),
    missing,
    unset,
    source: live ? "cloudflare" : "spaces",
    liveError,
    requiredEnv: [...declared].sort(),
  };
}
