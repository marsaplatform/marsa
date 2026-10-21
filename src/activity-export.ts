/**
 * 0.16.0: the activity log as an API and a download (JSON, JSONL or CSV), for the admin
 * (every team, or the platform log) and for a team (its own log).
 */
import type { Context } from "hono";
import type { AuditEntry, MemberStore } from "./members.js";

export const ACTIVITY_MAX = 5000;

export interface ActivityQuery {
  since?: number;
  until?: number;
  /** Exact action, or a prefix ending in "-" ("worker-"). */
  action?: string;
  site?: string;
  limit: number;
}

export type ActivityFormat = "json" | "jsonl" | "csv";

/** Read ?since=&until=&action=&site=&limit=&format= (bad values are ignored). */
export function readActivityQuery(q: (k: string) => string | undefined): {
  query: ActivityQuery;
  format: ActivityFormat;
} {
  const time = (k: string) => {
    const raw = q(k)?.trim();
    if (!raw) return undefined;
    const t = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
    return Number.isFinite(t) ? t : undefined;
  };
  const action = q("action")?.trim().slice(0, 60);
  const site = q("site")?.trim().slice(0, 40);
  const limit = Math.min(ACTIVITY_MAX, Math.max(1, Number(q("limit")) || 500));
  const f = q("format");
  const format: ActivityFormat = f === "csv" || f === "jsonl" ? f : "json";
  return {
    query: {
      since: time("since"),
      until: time("until"),
      ...(action && /^[a-z0-9-]+$/.test(action) ? { action } : {}),
      ...(site && /^[A-Za-z0-9_-]+$/.test(site) ? { site } : {}),
      limit,
    },
    format,
  };
}

const matches = (e: AuditEntry, q: ActivityQuery) => {
  const t = Date.parse(e.at);
  if (q.since !== undefined && t < q.since) return false;
  if (q.until !== undefined && t > q.until) return false;
  if (q.site && e.siteId !== q.site) return false;
  if (q.action) {
    if (q.action.endsWith("-") ? !e.action.startsWith(q.action) : e.action !== q.action)
      return false;
  }
  return true;
};

/** Entries of the given logs, newest first. */
export function queryActivity(members: MemberStore, ids: string[], q: ActivityQuery): AuditEntry[] {
  return ids
    .flatMap((id) => members.entries(id, undefined, 100_000).filter((e) => matches(e, q)))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, q.limit);
}

/** The public shape of an entry: no member id. */
export const activityRow = (e: AuditEntry, teamName?: (id: string) => string | null) => ({
  at: e.at,
  teamId: e.teamId,
  ...(teamName ? { team: teamName(e.teamId) } : {}),
  ...(e.siteId ? { siteId: e.siteId } : {}),
  actor: { kind: e.actor.kind, label: e.actor.label },
  action: e.action,
  ...(e.detail ? { detail: e.detail } : {}),
});

/** One CSV field: quoted, with formula prefixes neutralised (=, +, -, @ at the start). */
const csvField = (v: string | undefined | null) => {
  let s = v ?? "";
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export function activityCsv(rows: ReturnType<typeof activityRow>[]): string {
  const head = ["at", "team_id", "team", "site_id", "actor_kind", "actor", "action", "detail"];
  const lines = rows.map((r) =>
    [
      r.at,
      r.teamId,
      (r as { team?: string | null }).team ?? "",
      r.siteId ?? "",
      r.actor.kind,
      r.actor.label,
      r.action,
      r.detail ?? "",
    ]
      .map(csvField)
      .join(","),
  );
  // BOM so spreadsheet apps read Arabic text as UTF-8.
  return `\ufeff${[head.join(","), ...lines].join("\r\n")}\r\n`;
}

export const activityJsonl = (rows: object[]) =>
  rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");

/** 0.16.0: an activity listing as JSON, JSONL or a CSV download. */
export function sendActivity(c: Context, rows: object[], format: ActivityFormat, file: string) {
  c.header("Cache-Control", "no-store");
  if (format === "json") return c.json({ entries: rows, count: rows.length });
  const stamp = new Date().toISOString().slice(0, 10);
  c.header(
    "Content-Disposition",
    `attachment; filename="${file.replace(/[^\w.-]/g, "_")}-${stamp}.${format}"`,
  );
  if (format === "csv") {
    c.header("Content-Type", "text/csv; charset=utf-8");
    return c.body(activityCsv(rows as Parameters<typeof activityCsv>[0]));
  }
  c.header("Content-Type", "application/x-ndjson; charset=utf-8");
  return c.body(activityJsonl(rows));
}
