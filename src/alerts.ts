import type { AgentKeyStore } from "./agent-keys.js";
import { type BackendHealth, probeBackend } from "./backend/health.js";
import type { SiteBackend } from "./backend/types.js";
import { type NotificationCenter, PLATFORM } from "./notify.js";

/**
 * Periodic alert checks (0.14.0): agent keys that expired, and the data/files
 * storage check (admin). A storage alert fires when the state changes, so a long
 * outage is one alert, and recovery is another.
 */
export class AlertTicker {
  private backendOk: boolean | null = null;

  constructor(
    private readonly d: {
      agentKeys: AgentKeyStore;
      notify: NotificationCenter;
      backend: SiteBackend | null;
      probe?: (b: SiteBackend) => Promise<BackendHealth>;
    },
  ) {}

  async expiredKeys(): Promise<number> {
    await this.d.agentKeys.ready();
    const keys = await this.d.agentKeys.takeNewlyExpired();
    for (const k of keys) {
      await this.d.notify.add({
        teamId: k.teamId,
        kind: "agent-key-expired",
        detail: `${k.name} (${k.prefix}…)`,
      });
    }
    return keys.length;
  }

  /** Probe the storage; returns the health (or null when there is no backend). */
  async storage(): Promise<BackendHealth | null> {
    if (!this.d.backend) return null;
    const h = await (this.d.probe ?? probeBackend)(this.d.backend);
    const ok = h.kv.ok && h.files.ok;
    if (ok !== this.backendOk) {
      if (!ok) {
        const parts = [
          h.kv.ok ? "" : `KV${h.kv.status ? ` ${h.kv.status}` : ""}`,
          h.files.ok ? "" : `files${h.files.status ? ` ${h.files.status}` : ""}`,
        ].filter(Boolean);
        await this.d.notify.add({
          teamId: PLATFORM,
          kind: "backend-failing",
          detail: parts.join(", "),
        });
      } else if (this.backendOk === false) {
        await this.d.notify.add({ teamId: PLATFORM, kind: "backend-ok" });
      }
      this.backendOk = ok;
    }
    return h;
  }

  async tick(): Promise<void> {
    await this.expiredKeys().catch((e) => console.error("[alerts] keys", e?.message));
    await this.storage().catch((e) => console.error("[alerts] storage", e?.message));
  }
}
