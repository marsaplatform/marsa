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
  };
  if (cfg.minTtlHours > cfg.maxTtlHours) {
    throw new Error("MIN_TTL_HOURS must be <= MAX_TTL_HOURS");
  }
  cfg.defaultTtlHours = Math.min(Math.max(cfg.defaultTtlHours, cfg.minTtlHours), cfg.maxTtlHours);
  if (cfg.adminToken && cfg.adminToken.length < 24) {
    throw new Error("ADMIN_TOKEN must be at least 24 characters (or empty to disable admin)");
  }
  if (cfg.maxFileBytes > cfg.maxSiteBytes) cfg.maxFileBytes = cfg.maxSiteBytes;
  return cfg;
}
