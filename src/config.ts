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
  /** Optional Appwrite-backed data/files backend. null = off (the default). */
  appwrite: AppwriteConfig | null;
  backend: BackendLimits;
}

export interface AppwriteConfig {
  endpoint: string;
  projectId: string;
  /** Server-side only. Never sent to browsers. */
  apiKey: string;
  databaseId: string;
  kvTableId: string;
  bucketId: string;
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
    appwrite: appwriteConfig(env),
    backend: {
      guestAccess: bool(env, "BACKEND_GUEST_ACCESS", false),
      publicRead: bool(env, "BACKEND_PUBLIC_READ", true),
      maxValueBytes: int(env, "BACKEND_MAX_VALUE_KB", 64, 1) * 1024,
      maxKeys: int(env, "BACKEND_MAX_KEYS", 1000, 1),
      maxFiles: int(env, "BACKEND_MAX_FILES", 100, 1),
    },
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

const APPWRITE_REQUIRED = [
  "APPWRITE_ENDPOINT",
  "APPWRITE_PROJECT_ID",
  "APPWRITE_API_KEY",
  "APPWRITE_DATABASE_ID",
] as const;

/**
 * The backend is enabled only when every required APPWRITE_* variable is set.
 * None set = off (normal). Some but not all set = a startup error, so a typo
 * doesn't silently disable it.
 */
function appwriteConfig(env: Env): AppwriteConfig | null {
  const v = (k: string) => env[k]?.trim() ?? "";
  const set = APPWRITE_REQUIRED.filter((k) => v(k));
  if (set.length === 0) return null;
  if (set.length < APPWRITE_REQUIRED.length) {
    const missing = APPWRITE_REQUIRED.filter((k) => !v(k));
    throw new Error(
      `Appwrite backend is partly configured. Missing: ${missing.join(", ")}. Set them all, or none to keep the backend off.`,
    );
  }
  const endpoint = v("APPWRITE_ENDPOINT").replace(/\/+$/, "");
  if (!/^https?:\/\//.test(endpoint)) {
    throw new Error("APPWRITE_ENDPOINT must be an http(s) URL, e.g. https://cloud.appwrite.io/v1");
  }
  return {
    endpoint,
    projectId: v("APPWRITE_PROJECT_ID"),
    apiKey: v("APPWRITE_API_KEY"),
    databaseId: v("APPWRITE_DATABASE_ID"),
    kvTableId: v("APPWRITE_KV_TABLE_ID") || "marsa_kv",
    bucketId: v("APPWRITE_BUCKET_ID") || "marsa_files",
  };
}
