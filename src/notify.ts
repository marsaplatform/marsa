import { createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { join, resolve } from "node:path";
import { APP_VERSION } from "./brand.js";
import type { Lang } from "./i18n.js";
import type { AuditEntry } from "./members.js";
import type { SecretBox } from "./secrets.js";

/**
 * Notification center (0.14.0): in-app alerts for team owners and the admin, plus
 * optional outgoing webhooks (one per team, one for the platform). Webhook bodies
 * are Slack/Discord-compatible JSON (`text` + `content`) with the event attached,
 * signed with HMAC-SHA256 over `<timestamp>.<body>`. No email.
 */
export const PLATFORM = "_platform";
export const NOTICES_KEEP = 200;
export const WEBHOOK_SECRET_PREFIX = "whsec_";

export type NoticeKind =
  | "worker-deploy"
  | "worker-redeploy"
  | "worker-rollback"
  | "worker-delete"
  | "agent-key-create"
  | "agent-key-revoke"
  | "agent-invite-claim"
  | "agent-key-expired"
  | "agent-key-new-ip"
  | "team-key-rotate"
  | "cf-token-set"
  | "cf-token-clear"
  | "member-join"
  | "member-remove"
  | "backend-failing"
  | "backend-ok"
  | "webhook-test";

/** Audit actions that also raise a notification. */
const FROM_AUDIT = new Set<string>([
  "worker-deploy",
  "worker-redeploy",
  "worker-rollback",
  "worker-delete",
  "agent-key-create",
  "agent-key-revoke",
  "agent-invite-claim",
  "team-key-rotate",
  "cf-token-set",
  "cf-token-clear",
  "member-join",
  "member-remove",
]);

export interface Notice {
  id: string;
  at: string;
  /** A team id, or PLATFORM for admin-only alerts. */
  teamId: string;
  kind: NoticeKind;
  actor?: string;
  detail?: string;
}

export interface WebhookConf {
  url: string;
  secretSealed: string;
  createdAt: string;
  last?: { at: string; kind: string; ok: boolean; status: number | null; attempts: number };
}

export interface WebhookView {
  url: string;
  createdAt: string;
  last: WebhookConf["last"] | null;
}

const T: Record<Lang, Record<NoticeKind, (n: Notice) => string>> = {
  en: {
    "worker-deploy": (n) => `${n.actor} deployed a new Worker ${n.detail}`,
    "worker-redeploy": (n) => `${n.actor} redeployed the Worker ${n.detail}`,
    "worker-rollback": (n) => `${n.actor} rolled back the Worker ${n.detail}`,
    "worker-delete": (n) => `${n.actor} deleted the Worker ${n.detail}`,
    "agent-key-create": (n) => `${n.actor} created the agent key ${n.detail}`,
    "agent-key-revoke": (n) => `${n.actor} revoked the agent key ${n.detail}`,
    "agent-invite-claim": (n) => `An agent claimed an invite link: key ${n.detail}`,
    "agent-key-expired": (n) => `The agent key ${n.detail} expired`,
    "agent-key-new-ip": (n) => `Agent key used from a new address: ${n.detail}`,
    "team-key-rotate": (n) => `${n.actor} rotated the team key`,
    "cf-token-set": (n) => `${n.actor} changed the Cloudflare token (${n.detail})`,
    "cf-token-clear": (n) => `${n.actor} removed the Cloudflare token`,
    "member-join": (n) => `${n.actor} joined the team`,
    "member-remove": (n) => `${n.actor} removed the member ${n.detail}`,
    "backend-failing": (n) => `Storage check failing: ${n.detail}`,
    "backend-ok": () => "Storage check passing again (KV and files)",
    "webhook-test": (n) => `Test notification from ${n.actor}`,
  },
  ar: {
    "worker-deploy": (n) => `${n.actor} نشر Worker جديدًا: ${n.detail}`,
    "worker-redeploy": (n) => `${n.actor} أعاد نشر الـ Worker ${n.detail}`,
    "worker-rollback": (n) => `${n.actor} أرجع الـ Worker ${n.detail}`,
    "worker-delete": (n) => `${n.actor} حذف الـ Worker ${n.detail}`,
    "agent-key-create": (n) => `${n.actor} أنشأ مفتاح الوكيل ${n.detail}`,
    "agent-key-revoke": (n) => `${n.actor} ألغى مفتاح الوكيل ${n.detail}`,
    "agent-invite-claim": (n) => `وكيل استخدم رابط دعوة: المفتاح ${n.detail}`,
    "agent-key-expired": (n) => `انتهت صلاحية مفتاح الوكيل ${n.detail}`,
    "agent-key-new-ip": (n) => `استُخدم مفتاح وكيل من عنوان جديد: ${n.detail}`,
    "team-key-rotate": (n) => `${n.actor} غيّر مفتاح الفريق`,
    "cf-token-set": (n) => `${n.actor} غيّر رمز Cloudflare (${n.detail})`,
    "cf-token-clear": (n) => `${n.actor} أزال رمز Cloudflare`,
    "member-join": (n) => `${n.actor} انضم إلى الفريق`,
    "member-remove": (n) => `${n.actor} أزال العضو ${n.detail}`,
    "backend-failing": (n) => `فحص التخزين يفشل: ${n.detail}`,
    "backend-ok": () => "فحص التخزين ينجح من جديد (KV والملفات)",
    "webhook-test": (n) => `إشعار تجريبي من ${n.actor}`,
  },
};

export function noticeText(lang: Lang, n: Notice): string {
  const f = T[lang][n.kind];
  return f ? f({ ...n, actor: n.actor || "—", detail: n.detail || "" }).trim() : n.kind;
}

/** Severity for the UI dot. */
export const noticeTone = (k: NoticeKind): "warn" | "info" | "ok" =>
  k === "backend-failing" ||
  k === "agent-key-new-ip" ||
  k === "agent-key-expired" ||
  k === "worker-delete" ||
  k === "worker-rollback" ||
  k === "cf-token-set" ||
  k === "cf-token-clear" ||
  k === "team-key-rotate"
    ? "warn"
    : k === "backend-ok"
      ? "ok"
      : "info";

export class WebhookError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Is this address private, loopback, link-local or otherwise not on the public internet? */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s.startsWith("::ffff:")) return isPrivateAddress(s.slice(7));
    return (
      s === "::" ||
      s === "::1" ||
      s.startsWith("fc") ||
      s.startsWith("fd") ||
      s.startsWith("fe8") ||
      s.startsWith("fe9") ||
      s.startsWith("fea") ||
      s.startsWith("feb")
    );
  }
  return true;
}

export interface NotifyDeps {
  box: SecretBox | null;
  now: () => number;
  /** Allow http:// and private/loopback hosts (local testing only). */
  allowPrivate: boolean;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /** Waits between attempts, in ms (3 attempts in total). */
  retryDelays?: number[];
  teamName?: (teamId: string) => { name: string; slug?: string } | null;
  publicUrl: string;
}

export class NotificationCenter {
  private readonly file: string;
  private readonly tmpDir: string;
  private notices = new Map<string, Notice[]>();
  private reads: Record<string, string> = {};
  private hooks: Record<string, WebhookConf> = {};
  private loading: Promise<void> | null = null;
  private writeQ: Promise<void> = Promise.resolve();
  /** In-flight deliveries (tests await them). */
  readonly pending = new Set<Promise<void>>();

  constructor(
    dataDir: string,
    private readonly d: NotifyDeps,
  ) {
    const root = resolve(dataDir);
    this.file = join(root, "notifications.json");
    this.tmpDir = join(root, "tmp");
  }

  ready(): Promise<void> {
    this.loading ??= this.load();
    return this.loading;
  }

  private async load() {
    try {
      const f = JSON.parse(await readFile(this.file, "utf8")) as {
        notices?: Record<string, Notice[]>;
        reads?: Record<string, string>;
        hooks?: Record<string, WebhookConf>;
      };
      for (const [k, v] of Object.entries(f.notices ?? {})) this.notices.set(k, v);
      this.reads = f.reads ?? {};
      this.hooks = f.hooks ?? {};
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  private save() {
    const body = JSON.stringify({
      version: 1,
      notices: Object.fromEntries(this.notices),
      reads: this.reads,
      hooks: this.hooks,
    });
    const run = async () => {
      await mkdir(this.tmpDir, { recursive: true });
      const tmp = join(this.tmpDir, `n-${randomBytes(6).toString("hex")}.json`);
      await writeFile(tmp, body, { mode: 0o600 });
      await rename(tmp, this.file);
    };
    this.writeQ = this.writeQ.then(run, run);
    return this.writeQ.catch((err) => console.error("[notify] write failed", err?.message));
  }

  private iso() {
    return new Date(this.d.now()).toISOString();
  }

  /** Raise a notification (and fire the webhooks). */
  async add(n: Omit<Notice, "id" | "at">): Promise<Notice> {
    await this.ready();
    const notice: Notice = { id: `n_${randomBytes(6).toString("hex")}`, at: this.iso(), ...n };
    const list = this.notices.get(n.teamId) ?? [];
    list.push(notice);
    if (list.length > NOTICES_KEEP) list.splice(0, list.length - NOTICES_KEEP);
    this.notices.set(n.teamId, list);
    await this.save();
    // Team events go to the team's hook; everything goes to the platform hook.
    if (n.teamId !== PLATFORM && this.hooks[n.teamId]) this.fire(n.teamId, notice);
    if (this.hooks[PLATFORM] && n.kind !== "webhook-test") this.fire(PLATFORM, notice);
    return notice;
  }

  /** Called for every audit entry; raises the ones that matter. */
  fromAudit(e: Omit<AuditEntry, "at">): void {
    if (!FROM_AUDIT.has(e.action)) return;
    const actor = e.actor.label;
    let detail = e.detail;
    if (e.action === "member-join") detail = undefined;
    const p: Promise<void> = this.add({
      teamId: e.teamId,
      kind: e.action as NoticeKind,
      actor,
      ...(detail ? { detail } : {}),
    })
      .then(() => {})
      .catch((err) => console.error("[notify] failed", err?.message))
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  }

  /** Newest first. For the admin (teamId null): platform alerts and every team's. */
  list(teamId: string | null, limit = 50): Notice[] {
    const pool =
      teamId === null ? [...this.notices.values()].flat() : (this.notices.get(teamId) ?? []);
    return pool
      .slice()
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit);
  }

  readKey(teamId: string | null, who: string | null): string {
    return teamId === null ? "admin" : `${teamId}:${who ?? "key"}`;
  }

  /** Notices with read state for one viewer. */
  forViewer(teamId: string | null, who: string | null, limit = 50) {
    const seen = this.reads[this.readKey(teamId, who)] ?? "";
    return this.list(teamId, limit).map((n) => ({ ...n, unread: n.at > seen }));
  }

  unread(teamId: string | null, who: string | null): number {
    const seen = this.reads[this.readKey(teamId, who)] ?? "";
    const pool =
      teamId === null ? [...this.notices.values()].flat() : (this.notices.get(teamId) ?? []);
    let n = 0;
    for (const x of pool) if (x.at > seen) n++;
    return n;
  }

  async markRead(teamId: string | null, who: string | null): Promise<void> {
    this.reads[this.readKey(teamId, who)] = this.iso();
    await this.save();
  }

  async purgeTeam(teamId: string): Promise<void> {
    this.notices.delete(teamId);
    delete this.hooks[teamId];
    for (const k of Object.keys(this.reads)) if (k.startsWith(`${teamId}:`)) delete this.reads[k];
    await this.save();
  }

  // ---- webhooks ---------------------------------------------------------------------------

  hook(scope: string): WebhookView | null {
    const h = this.hooks[scope];
    return h ? { url: h.url, createdAt: h.createdAt, last: h.last ?? null } : null;
  }

  /** Check a webhook URL: https on a public host (unless allowPrivate). */
  async checkUrl(raw: unknown): Promise<string> {
    let u: URL;
    try {
      u = new URL(typeof raw === "string" ? raw.trim() : "");
    } catch {
      throw new WebhookError("INVALID_URL", "url: a full https:// URL");
    }
    if (u.username || u.password) throw new WebhookError("INVALID_URL", "url: no credentials");
    const okProto = u.protocol === "https:" || (this.d.allowPrivate && u.protocol === "http:");
    if (!okProto) throw new WebhookError("INVALID_URL", "url: must start with https://");
    if (u.toString().length > 500) throw new WebhookError("INVALID_URL", "url: too long");
    if (!this.d.allowPrivate) {
      const host = u.hostname.replace(/^\[|\]$/g, "");
      if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) {
        throw new WebhookError("PRIVATE_URL", "url: must be a public host");
      }
      const addrs = isIP(host)
        ? [host]
        : await lookup(host, { all: true })
            .then((r) => r.map((x) => x.address))
            .catch(() => {
              throw new WebhookError("INVALID_URL", "url: the host does not resolve");
            });
      if (!addrs.length || addrs.some(isPrivateAddress)) {
        throw new WebhookError("PRIVATE_URL", "url: must be a public host");
      }
    }
    return u.toString();
  }

  /** Set (or replace) a webhook. Returns the signing secret, shown once. */
  async setHook(scope: string, rawUrl: unknown): Promise<{ hook: WebhookView; secret: string }> {
    if (!this.d.box) {
      throw new WebhookError("SECRETS_KEY_MISSING", "MARSA_SECRETS_KEY is not set on the server");
    }
    await this.ready();
    const url = await this.checkUrl(rawUrl);
    const secret = `${WEBHOOK_SECRET_PREFIX}${randomBytes(24).toString("base64url")}`;
    this.hooks[scope] = { url, secretSealed: this.d.box.seal(secret), createdAt: this.iso() };
    await this.save();
    return { hook: this.hook(scope) as WebhookView, secret };
  }

  async clearHook(scope: string): Promise<void> {
    delete this.hooks[scope];
    await this.save();
  }

  /** Send a test event to one webhook and wait for the result. */
  async test(scope: string, actor: string): Promise<WebhookConf["last"] | null> {
    if (!this.hooks[scope]) return null;
    const notice: Notice = {
      id: `n_${randomBytes(6).toString("hex")}`,
      at: this.iso(),
      teamId: scope,
      kind: "webhook-test",
      actor,
    };
    await this.deliver(scope, notice);
    return this.hooks[scope]?.last ?? null;
  }

  /** Wait for in-flight deliveries (tests). */
  async flush(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  private fire(scope: string, n: Notice) {
    const p: Promise<void> = this.deliver(scope, n)
      .catch(() => {})
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  }

  /** Body, headers and signature for one event. */
  payload(scope: string, n: Notice, secret: string) {
    const team = n.teamId === PLATFORM ? null : (this.d.teamName?.(n.teamId) ?? null);
    const where = team ? `${team.name}: ` : n.teamId === PLATFORM ? "Platform: " : "";
    const text = `[Marsa Spaces] ${where}${noticeText("en", n)}`;
    const body = JSON.stringify({
      text,
      content: text,
      event: {
        id: n.id,
        kind: n.kind,
        at: n.at,
        team: team ? { id: n.teamId, name: team.name, slug: team.slug ?? null } : null,
        actor: n.actor ?? null,
        detail: n.detail ?? null,
        scope: scope === PLATFORM ? "platform" : "team",
        url: this.d.publicUrl,
      },
    });
    const ts = String(Math.floor(this.d.now() / 1000));
    const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
    return {
      body,
      headers: {
        "content-type": "application/json",
        "user-agent": `marsa-spaces-webhook/${APP_VERSION}`,
        "x-marsa-event": n.kind,
        "x-marsa-delivery": n.id,
        "x-marsa-timestamp": ts,
        "x-marsa-signature": `sha256=${sig}`,
      },
    };
  }

  private async deliver(scope: string, n: Notice): Promise<void> {
    const h = this.hooks[scope];
    if (!h || !this.d.box) return;
    let secret: string;
    try {
      secret = this.d.box.open(h.secretSealed);
    } catch {
      return;
    }
    const doFetch = this.d.fetch ?? ((u: string, i: RequestInit) => fetch(u, i));
    const delays = this.d.retryDelays ?? [2_000, 10_000];
    let status: number | null = null;
    let ok = false;
    let attempts = 0;
    for (let i = 0; i <= delays.length && !ok; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, delays[i - 1]));
      attempts++;
      try {
        // Re-check the host each attempt (DNS can change between them).
        await this.checkUrl(h.url);
        const { body, headers } = this.payload(scope, n, secret);
        const res = await doFetch(h.url, {
          method: "POST",
          headers,
          body,
          redirect: "manual",
          signal: AbortSignal.timeout(5000),
        });
        await res.body?.cancel().catch(() => {});
        status = res.status;
        ok = res.status >= 200 && res.status < 300;
        // 4xx (except 408/429) will not get better with a retry.
        if (
          !ok &&
          res.status >= 400 &&
          res.status < 500 &&
          res.status !== 408 &&
          res.status !== 429
        )
          break;
      } catch (err) {
        status = null;
        if (err instanceof WebhookError) break;
      }
    }
    const cur = this.hooks[scope];
    if (cur && cur.url === h.url) {
      cur.last = { at: this.iso(), kind: n.kind, ok, status, attempts };
      await this.save();
    }
  }
}
