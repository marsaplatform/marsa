import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { AppwriteBackend } from "./backend/appwrite.js";
import { APP_NAME } from "./brand.js";
import { loadConfig } from "./config.js";
import { SiteStore } from "./store.js";
import { sweepExpired } from "./sweep.js";
import { TeamStore } from "./teams.js";

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

const backend = config.appwrite ? new AppwriteBackend(config.appwrite) : null;
const app = createApp({ config, store, backend, teams });

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
    `data/files backend: ${config.appwrite ? `appwrite (${new URL(config.appwrite.endpoint).host})` : "off (static publishing only)"}`,
  );
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close();
    process.exit(0);
  });
}
