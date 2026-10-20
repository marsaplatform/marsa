import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { APP_NAME } from "./brand.js";
import { loadConfig } from "./config.js";
import { SiteStore } from "./store.js";

const config = loadConfig();
const store = new SiteStore(config.dataDir);
await store.init();

const app = createApp({ config, store });

const sweep = async () => {
  try {
    const removed = await store.sweepExpired();
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
  console.log(`admin API: ${config.adminToken ? "enabled" : "disabled"}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close();
    process.exit(0);
  });
}
