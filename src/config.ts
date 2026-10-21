import { randomBytes } from "node:crypto";

/** Runtime configuration, read once from environment variables. See .env.example. */
export interface Config {
  port: number;
  host: string;
  /** Public base URL used to build share links, e.g. https://marsa.example.com */
  publicUrl: string;
  /** Directory where uploaded sites and their metadata are stored. */
  dataDir: string;
  /** Default link lifetime, in hours, when the uploader doesn't pick one. */
  defaultTtlHours: number;
  minTtlHours: number;
  maxTtlHours: number;
  maxFileBytes: number;
  maxSiteBytes: number;
  maxFiles: number;
  /** Max uploads/updates per client IP per hour. */
  uploadsPerHour: number;
  /** Max API requests (any /api route) per client IP per minute. */
  apiRequestsPerMinute: number;
  /** Trust X-Forwarded-For / X-Real-IP (only behind a reverse proxy you control). */
  trustProxy: boolean;
  /** Optional admin token. Empty = admin API disabled. */
  adminToken: string;
  /** How often the expiry sweeper runs, in seconds. */
  sweepIntervalSeconds: number;
  /** Optional Cloudflare-backed data/files backend (Workers KV + R2). null = off (the default). */
  cloudflare: CloudflareConfig | null;
  backend: BackendLimits;
  /** Browser sign-in for teams and the admin (signed session cookies). */
  sessions: SessionConfig;
  /** Privacy-respecting page-view counts (no cookies, no IPs stored). */
  visits: { enabled: boolean; retentionDays: number; flushSeconds: number };
  /** MCP endpoint limits (per token, and a server-wide daily cap on KV writes via MCP). */
  mcp: { requestsPerMinute: number; writesPerHour: number; kvWritesPerDay: number };
  /** Default per-team quotas (the admin can override them per team). */
  teamMaxSites: number;
  teamMaxBytes: number;
  /** Key for encrypting platform secrets at rest (MARSA_SECRETS_KEY, >= 32 chars). Empty = Workers off. */
  secretsKey: string;
  /** Team Workers defaults (0.12.0). */
  workers: { defaultMax: number; defaultMaxKb: number; compatibilityDate: string; apiBase: string };
  /** Site ids spotlighted on the home page (FEATURED_SITES, comma-separated). */
  featuredSites: string[];
}

export interface SessionConfig {
  /**
   * HMAC key for session cookies and CSRF tokens (>= 32 chars). When empty a
   * random key is generated at start, so sessions end on every restart.
   */
  secret: string;
  /** True when SESSION_SECRET was not set and a random one was generated. */
  ephemeral: boolean;
  /** Team session lifetime, in hours (default 168 = 7 days). */
  teamTtlHours: number;
  /** Admin session lifetime, in hours (default 12). */
  adminTtlHours: number;
  /** Sign-in attempts allowed per client IP per 15 minutes. */
  loginAttemptsPer15Min: number;
}

export interface CloudflareConfig {
  accountId: string;
  /** Server-side only. Never sent to browsers. Needs Workers KV Storage: Edit. */
  apiToken: string;
  kvNamespaceId: string;
  /** R2 bucket for files (default "marsa-files"). */
  r2Bucket: string;
  /** R2 S3 credentials. Server-side only. */
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  /** S3 endpoint, default https://<account>.r2.cloudflarestorage.com (override for EU/FedRAMP buckets). */
  r2Endpoint: string;
  /** Cloudflare REST API base, default https://api.cloudflare.com/client/v4. */
  apiBase: string;
}

export interface BackendLimits {
  /**
   * Who may use the backend. false (default): only sites uploaded with the key
   * of a team the admin marked "backend: on". true: every site, guests too.
   */
  guestAccess: boolean;
  /** Anyone may read a live site's KV values and files (writes always need the edit token). */
  publicRead: boolean;
  maxValueBytes: number;
  maxKeys: number;
  maxFiles: number;
}

type Env = Record<string, string | undefined>;

function int(env: Env, key: string, fallback: number, min = 0): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) {
    throw new Error(`Invalid ${key}: expected a number >= ${min}, got "${raw}"`);
  }
  return Math.floor(n);
}

function bool(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes";
}

const MB = 1024 * 1024;

export function loadConfig(env: Env = process.env): Config {
  const port = int(env, "PORT", 8080, 1);
  const cfg: Config = {
    port,
    host: env.HOST?.trim() || "0.0.0.0",
    publicUrl: (env.PUBLIC_URL?.trim() || `http://localhost:${port}`).replace(/\/+$/, ""),
    dataDir: env.DATA_DIR?.trim() || "./data",
    defaultTtlHours: int(env, "DEFAULT_TTL_HOURS", 24, 1),
    minTtlHours: int(env, "MIN_TTL_HOURS", 1, 1),
    maxTtlHours: int(env, "MAX_TTL_HOURS", 168, 1),
    maxFileBytes: int(env, "MAX_FILE_MB", 10, 1) * MB,
    maxSiteBytes: int(env, "MAX_SITE_MB", 25, 1) * MB,
    maxFiles: int(env, "MAX_FILES", 500, 1),
    uploadsPerHour: int(env, "UPLOADS_PER_HOUR", 20, 1),
    apiRequestsPerMinute: int(env, "API_REQUESTS_PER_MINUTE", 120, 1),
    trustProxy: bool(env, "TRUST_PROXY", false),
    adminToken: env.ADMIN_TOKEN?.trim() ?? "",
    sweepIntervalSeconds: int(env, "SWEEP_INTERVAL_SECONDS", 60, 5),
    cloudflare: cloudflareConfig(env),
    mcp: {
      requestsPerMinute: int(env, "MCP_REQUESTS_PER_MINUTE", 60, 1),
      writesPerHour: int(env, "MCP_WRITES_PER_HOUR", 60, 1),
      kvWritesPerDay: int(env, "MCP_KV_WRITES_PER_DAY", 500, 1),
    },
    visits: {
      enabled: bool(env, "VISITS", true),
      retentionDays: int(env, "VISITS_RETENTION_DAYS", 90, 31),
      flushSeconds: int(env, "VISITS_FLUSH_SECONDS", 60, 5),
    },
    teamMaxSites: int(env, "TEAM_MAX_SITES", 50, 1),
    secretsKey: env.MARSA_SECRETS_KEY?.trim() ?? "",
    workers: {
      defaultMax: int(env, "WORKERS_DEFAULT_MAX", 3, 1),
      defaultMaxKb: int(env, "WORKER_MAX_KB", 1024, 1),
      compatibilityDate: /^\d{4}-\d\d-\d\d$/.test(env.WORKERS_COMPAT_DATE?.trim() ?? "")
        ? (env.WORKERS_COMPAT_DATE?.trim() as string)
        : "2025-09-01",
      apiBase: url(env, "CLOUDFLARE_API_BASE", "https://api.cloudflare.com/client/v4"),
    },
    teamMaxBytes: int(env, "TEAM_MAX_MB", 200, 1) * MB,
    featuredSites: (env.FEATURED_SITES ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter((x) => /^[a-z0-9]{6,32}$/.test(x))
      .slice(0, 6),
    backend: {
      guestAccess: bool(env, "BACKEND_GUEST_ACCESS", false),
      publicRead: bool(env, "BACKEND_PUBLIC_READ", true),
      maxValueBytes: int(env, "BACKEND_MAX_VALUE_KB", 64, 1) * 1024,
      maxKeys: int(env, "BACKEND_MAX_KEYS", 1000, 1),
      maxFiles: int(env, "BACKEND_MAX_FILES", 100, 1),
    },
    sessions: {
      secret: env.SESSION_SECRET?.trim() || randomBytes(32).toString("hex"),
      ephemeral: !env.SESSION_SECRET?.trim(),
      teamTtlHours: int(env, "SESSION_TTL_HOURS", 168, 1),
      adminTtlHours: int(env, "ADMIN_SESSION_TTL_HOURS", 12, 1),
      loginAttemptsPer15Min: int(env, "LOGIN_ATTEMPTS_PER_15_MIN", 10, 1),
    },
  };
  if (cfg.sessions.secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters (or empty for a random one)");
  }
  if (cfg.minTtlHours > cfg.maxTtlHours) {
    throw new Error("MIN_TTL_HOURS must be <= MAX_TTL_HOURS");
  }
  cfg.defaultTtlHours = Math.min(Math.max(cfg.defaultTtlHours, cfg.minTtlHours), cfg.maxTtlHours);
  if (cfg.adminToken && cfg.adminToken.length < 24) {
    throw new Error("ADMIN_TOKEN must be at least 24 characters (or empty to disable admin)");
  }
  if (cfg.secretsKey && cfg.secretsKey.length < 32) {
    throw new Error(
      "MARSA_SECRETS_KEY must be at least 32 characters (or empty to turn Workers off)",
    );
  }
  if (cfg.maxFileBytes > cfg.maxSiteBytes) cfg.maxFileBytes = cfg.maxSiteBytes;
  return cfg;
}

const CLOUDFLARE_REQUIRED = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_KV_NAMESPACE_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
] as const;

const url = (env: Env, key: string, fallback: string): string => {
  const raw = (env[key]?.trim() || fallback).replace(/\/+$/, "");
  if (!/^https?:\/\//.test(raw)) throw new Error(`${key} must be an http(s) URL, got "${raw}"`);
  return raw;
};

/**
 * The backend is enabled only when every required CLOUDFLARE_* / R2_* variable
 * is set. None set = off (normal). Some but not all set = a startup error, so a
 * typo doesn't silently disable it.
 */
function cloudflareConfig(env: Env): CloudflareConfig | null {
  const v = (k: string) => env[k]?.trim() ?? "";
  const set = CLOUDFLARE_REQUIRED.filter((k) => v(k));
  if (set.length === 0) return null;
  if (set.length < CLOUDFLARE_REQUIRED.length) {
    const missing = CLOUDFLARE_REQUIRED.filter((k) => !v(k));
    throw new Error(
      `Cloudflare backend is partly configured. Missing: ${missing.join(", ")}. Set them all, or none to keep the backend off.`,
    );
  }
  const accountId = v("CLOUDFLARE_ACCOUNT_ID");
  if (!/^[A-Za-z0-9]{1,64}$/.test(accountId)) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID must be the 32-character account id");
  }
  const r2Bucket = v("R2_BUCKET") || "marsa-files";
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(r2Bucket)) {
    throw new Error(`R2_BUCKET is not a valid bucket name: "${r2Bucket}"`);
  }
  return {
    accountId,
    apiToken: v("CLOUDFLARE_API_TOKEN"),
    kvNamespaceId: v("CLOUDFLARE_KV_NAMESPACE_ID"),
    r2Bucket,
    r2AccessKeyId: v("R2_ACCESS_KEY_ID"),
    r2SecretAccessKey: v("R2_SECRET_ACCESS_KEY"),
    r2Endpoint: url(env, "R2_ENDPOINT", `https://${accountId}.r2.cloudflarestorage.com`),
    apiBase: url(env, "CLOUDFLARE_API_BASE", "https://api.cloudflare.com/client/v4"),
  };
}
