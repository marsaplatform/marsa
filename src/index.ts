import { serve } from "@hono/node-server";
import type { AgentKeyStore } from "./agent-keys.js";
import { AlertTicker } from "./alerts.js";
import { createApp } from "./app.js";
import { CloudflareBackend } from "./backend/cloudflare.js";
import { probeBackend } from "./backend/health.js";
import { APP_NAME } from "./brand.js";
import { loadConfig } from "./config.js";
import type { NotificationCenter } from "./notify.js";
import { SiteStore } from "./store.js";
import { sweepExpired } from "./sweep.js";
import { TeamStore } from "./teams.js";
import type { UserKeyStore } from "./user-keys.js";
import { VisitCounter } from "./visits.js";

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig();
} catch (err) {
  console.error(`Configuration error: ${(err as Error).message}`);
  process.exit(1);
}
const store = new SiteStore(config.dataDir);
await store.init();

const teams = new TeamStore(config.dataDir);
await teams.init();

const backend = config.cloudflare ? new CloudflareBackend(config.cloudflare) : null;
const visits = new VisitCounter(config.dataDir, config.visits);
let svc: { agentKeys: AgentKeyStore; notify: NotificationCenter; userKeys?: UserKeyStore } | null =
  null;
const app = createApp({
  config,
  store,
  backend,
  teams,
  visits,
  expose: (s) => {
    svc = s;
  },
});
// Alerts: expired agent keys and the storage check (every 10 minutes, and once at start).
const alerts = svc
  ? new AlertTicker({
      agentKeys: (svc as { agentKeys: AgentKeyStore }).agentKeys,
      notify: (svc as { notify: NotificationCenter }).notify,
      backend,
    })
  : null;
const alertTimer = setInterval(() => void alerts?.tick(), 10 * 60_000);
alertTimer.unref();
const flushTimer = setInterval(() => void visits.flush(), config.visits.flushSeconds * 1000);
flushTimer.unref();

const sweep = async () => {
  try {
    const removed = await sweepExpired(store, backend);
    if (removed.length) console.log(`[sweep] removed ${removed.length} expired site(s)`);
  } catch (err) {
    console.error("[sweep] failed", err);
  }
};
await sweep();
const timer = setInterval(sweep, config.sweepIntervalSeconds * 1000);
timer.unref();

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(
    `${APP_NAME} listening on http://${info.address}:${info.port} (public: ${config.publicUrl})`,
  );
  console.log(
    `admin API: ${config.adminToken ? `enabled (${teams.list().length} team(s); console at /admin)` : "disabled"}`,
  );
  console.log(
    `data/files backend: ${config.cloudflare ? `cloudflare (KV namespace ${config.cloudflare.kvNamespaceId}, R2 bucket ${config.cloudflare.r2Bucket})` : "off (static publishing only)"}`,
  );
  void alerts?.tick();
  // Fail loudly at start if the store rejects us (e.g. a token that lost a permission).
  if (backend) {
    probeBackend(backend)
      .then((h) => {
        for (const k of ["kv", "files"] as const) {
          if (!h[k].ok) console.error(`[backend] ${k} check FAILED at start: ${h[k].error}`);
        }
        if (h.kv.ok && h.files.ok) console.log("data/files backend: start check ok (KV + files)");
      })
      .catch(() => {});
  }
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close();
    const bye = setTimeout(() => process.exit(0), 3000);
    bye.unref();
    const uk = (svc as { userKeys?: UserKeyStore } | null)?.userKeys;
    Promise.allSettled([visits.flush(), uk?.flush()]).finally(() => process.exit(0));
  });
}
