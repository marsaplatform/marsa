import { randomBytes } from "node:crypto";

/** Runtime configuration, read once from environment variables. See .env.example. */
export interface Config {
  port: number;
  host: string;
  /** Public base URL used to build share links, e.g. https://marsa.example.com */
  publicUrl: string;
  /** Who operates this instance, shown in the privacy policy. */
  operator: Operator;
  /** 0.16.0: time zone for server-rendered times and charts (DISPLAY_TZ, default Asia/Dubai). */
  displayTz: string;
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
  /** Allow http:// and private hosts for outgoing webhooks (local testing only). */
  webhookAllowPrivate: boolean;
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
  /** Optional, read-only GitHub token for repo status (tells private from missing). Never shown. */
  githubToken: string | null;
  /** Team Workers defaults (0.12.0). */
  workers: {
    defaultMax: number;
    defaultMaxKb: number;
    compatibilityDate: string;
    apiBase: string;
    /** 0.15.2: seconds between health checks of each Worker (WORKER_HEALTH_INTERVAL_SEC). */
    healthIntervalSec: number;
    /** 0.16.0: end of the 7-day period in which list responses still carry var values (ms). */
    varValuesSunset: number;
    /** 0.17.0: how long a deploy request waits before answering 202 with a job (seconds). */
    deployWaitSec: number;
    /** 0.17.0 cron triggers: minimum interval, per-team default, account-wide cap. */
    cronMinMinutes: number;
    cronsPerTeam: number;
    cronAccountMax: number;
    /** 0.17.0 private per-Worker KV: per-team default and account-wide namespace cap. */
    kvPerTeam: number;
    kvAccountMax: number;
  };
  /** Site ids spotlighted on the home page (FEATURED_SITES, comma-separated). */
  featuredSites: string[];
  /** 0.16.0: encrypted daily backups of the data directory. */
  backup: {
    enabled: boolean;
    /** BACKUP_KEY, else MARSA_SECRETS_KEY (never shown). */
    secret: string;
    /** BACKUP_DIR: local directory store when there is no R2 backend (not off-site). */
    dir: string | null;
    hourUtc: number;
    keepDaily: number;
    keepWeekly: number;
    maxBytes: number;
  };
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

/** Who operates this instance (privacy policy). Each field has an English and Arabic text. */
export interface Operator {
  name: { en: string; ar: string };
  address: { en: string; ar: string };
  law: { en: string; ar: string };
  email: string;
  /** Data protection supervisory authority people can complain to. */
  authority: { en: string; ar: string; url: string };
  /**
   * 0.16.0: the Cloudflare data processing agreement the operator relies on
   * (OPERATOR_CLOUDFLARE_DPA). Empty = the policy shows a marked placeholder.
   */
  cloudflareDpa: string;
}

/** marsaplatform's hosted instance. Self-hosters set the OPERATOR_* variables. */
export const DEFAULT_OPERATOR: Operator = {
  name: { en: "marsaplatform", ar: "marsaplatform" },
  address: { en: "Bologna, Italy", ar: "بولونيا، إيطاليا" },
  law: {
    en: "Italy (Italian law and the EU GDPR)",
    ar: "إيطاليا (القانون الإيطالي واللائحة الأوروبية العامة لحماية البيانات GDPR)",
  },
  email: "info@marsaplatform.com",
  authority: {
    en: "Garante per la protezione dei dati personali (the Italian data protection authority)",
    ar: "Garante per la protezione dei dati personali (هيئة حماية البيانات الإيطالية)",
    url: "https://www.garanteprivacy.it",
  },
  // Not confirmed by the operator yet: the policy shows a placeholder until this is set.
  cloudflareDpa: "",
};

type Env = Record<string, string | undefined>;

function both(env: Env, key: string, fallback: { en: string; ar: string }) {
  const v = env[key]?.trim();
  return v ? { en: v, ar: v } : fallback;
}

export function loadOperator(env: Env): Operator {
  const d = DEFAULT_OPERATOR;
  const auth = env.OPERATOR_AUTHORITY?.trim();
  return {
    name: both(env, "OPERATOR_NAME", d.name),
    address: both(env, "OPERATOR_ADDRESS", d.address),
    law: both(env, "OPERATOR_LAW", d.law),
    email: env.OPERATOR_EMAIL?.trim() || d.email,
    authority: auth
      ? { en: auth, ar: auth, url: env.OPERATOR_AUTHORITY_URL?.trim() || "" }
      : d.authority,
    cloudflareDpa: env.OPERATOR_CLOUDFLARE_DPA?.trim() || d.cloudflareDpa,
  };
}

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
    operator: loadOperator(env),
    displayTz: env.DISPLAY_TZ?.trim() || "Asia/Dubai",
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
    webhookAllowPrivate: bool(env, "WEBHOOK_ALLOW_PRIVATE", false),
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
    githubToken: env.GITHUB_TOKEN?.trim() || null,
    workers: {
      defaultMax: int(env, "WORKERS_DEFAULT_MAX", 3, 1),
      defaultMaxKb: int(env, "WORKER_MAX_KB", 1024, 1),
      compatibilityDate: /^\d{4}-\d\d-\d\d$/.test(env.WORKERS_COMPAT_DATE?.trim() ?? "")
        ? (env.WORKERS_COMPAT_DATE?.trim() as string)
        : "2025-09-01",
      apiBase: url(env, "CLOUDFLARE_API_BASE", "https://api.cloudflare.com/client/v4"),
      healthIntervalSec: Math.min(3600, int(env, "WORKER_HEALTH_INTERVAL_SEC", 300, 60)),
      varValuesSunset: (() => {
        const raw = env.VAR_VALUES_SUNSET?.trim() || "2026-10-28T12:00:00Z";
        const t = Date.parse(raw);
        if (!Number.isFinite(t)) throw new Error(`Invalid VAR_VALUES_SUNSET: "${raw}"`);
        return t;
      })(),
      deployWaitSec: Math.min(90, int(env, "WORKER_DEPLOY_WAIT_SEC", 60, 0)),
      cronMinMinutes: Math.min(1440, int(env, "WORKER_CRON_MIN_MINUTES", 10, 1)),
      cronsPerTeam: Math.min(250, int(env, "WORKER_CRONS_PER_TEAM", 2, 0)),
      cronAccountMax: Math.min(250, int(env, "WORKER_CRON_ACCOUNT_MAX", 5, 0)),
      kvPerTeam: Math.min(100, int(env, "WORKER_KV_PER_TEAM", 3, 0)),
      kvAccountMax: Math.min(1000, int(env, "WORKER_KV_ACCOUNT_MAX", 100, 0)),
    },
    teamMaxBytes: int(env, "TEAM_MAX_MB", 200, 1) * MB,
    backup: {
      enabled: bool(env, "BACKUPS", true),
      secret: env.BACKUP_KEY?.trim() || env.MARSA_SECRETS_KEY?.trim() || "",
      dir: env.BACKUP_DIR?.trim() || null,
      hourUtc: Math.min(23, int(env, "BACKUP_HOUR_UTC", 1, 0)),
      keepDaily: Math.min(90, int(env, "BACKUP_KEEP_DAILY", 14, 1)),
      keepWeekly: Math.min(52, int(env, "BACKUP_KEEP_WEEKLY", 8, 0)),
      maxBytes: int(env, "BACKUP_MAX_MB", 2048, 1) * MB,
    },
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
