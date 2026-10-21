import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  type AgentNote,
  NOTE_SEVERITIES,
  NOTE_STAGES,
  NOTE_STATUSES,
  NOTES_PER_HOUR,
  NoteError,
  type NoteError as NoteErrorT,
  type NoteFilter,
  type NoteInput,
  type NoteStore,
  readNote,
} from "./agent-notes.js";
import type { NotificationCenter } from "./notify.js";
import type { RateLimiter } from "./rate-limit.js";
import type { TeamAuth } from "./team-auth.js";
import type { Team, TeamStore } from "./teams.js";

export interface NoteRouteDeps {
  teams: TeamStore;
  notes: NoteStore;
  notify: NotificationCenter;
  limiter: RateLimiter;
  teamAuth: TeamAuth;
}

const err = (c: Context, status: number, code: string, message: string) =>
  c.json({ error: { code, message } }, status as 400);

/** What an agent sees of its notes (no internal fields beyond what it sent plus status/reply). */
export const noteView = (n: AgentNote) => ({
  id: n.id,
  at: n.at,
  stage: n.stage,
  severity: n.severity,
  category: n.category,
  message: n.message,
  target: n.target ?? null,
  version: n.version ?? null,
  agent: n.agent,
  status: n.status,
  reply: n.reply ? { text: n.reply.text, at: n.reply.at } : null,
  ...(n.redacted ? { redacted: true } : {}),
});

/**
 * Store a note for a team (shared by the API, the MCP tool and the dashboard): rate limit per
 * credential and per team, then a bell notification for blockers.
 */
export async function leaveNote(
  d: Pick<NoteRouteDeps, "notes" | "notify" | "limiter">,
  team: Team,
  input: NoteInput,
  via: AgentNote["via"],
  who: string,
): Promise<AgentNote | { retryAfterSec: number }> {
  const one = d.limiter.hit(`notes:${team.id}:${who}`, NOTES_PER_HOUR, 3_600_000);
  const all = d.limiter.hit(`notes:${team.id}`, NOTES_PER_HOUR * 4, 3_600_000);
  if (!one.allowed || !all.allowed)
    return { retryAfterSec: Math.max(one.retryAfterSec, all.retryAfterSec) };
  const note = await d.notes.add(team.id, input, via);
  if (note.severity === "blocker") {
    await d.notify
      .add({
        teamId: team.id,
        kind: "agent-note-blocker",
        actor: note.agent,
        detail: `${note.category}${note.target ? ` · ${note.target.type} ${note.target.id}` : ""}: ${note.message.slice(0, 140)}`,
      })
      .catch(() => {});
  }
  return note;
}

const filterOf = (c: Context): NoteFilter => {
  const q = (k: string) => c.req.query(k) ?? "";
  const f: NoteFilter = {};
  if ((NOTE_STATUSES as readonly string[]).includes(q("status"))) f.status = q("status") as never;
  if ((NOTE_SEVERITIES as readonly string[]).includes(q("severity")))
    f.severity = q("severity") as never;
  if ((NOTE_STAGES as readonly string[]).includes(q("stage"))) f.stage = q("stage") as never;
  return f;
};

/**
 * Agent notes over HTTP (0.15.1):
 * - Team API (team key or any agent key): POST/GET /api/teams/:team/notes
 * - Admin API (mounted after the /api/admin/* guard): GET /api/admin/notes, PATCH /api/admin/notes/:id
 */
export function mountNoteRoutes(app: Hono, d: NoteRouteDeps): void {
  const limit = bodyLimit({
    maxSize: 16 * 1024,
    onError: (c) => err(c, 413, "TOO_LARGE", "a note is at most 16 KB"),
  });
  const credOf = async (c: Context) => {
    const cred = await d.teamAuth(c);
    if (!cred || cred === "invalid")
      return err(
        c,
        401,
        "UNAUTHORIZED",
        "send the team key or an agent key (X-Team-Key or Authorization: Bearer)",
      );
    const want = c.req.param("team") ?? "";
    if (want !== cred.team.id && want !== cred.team.slug)
      return err(c, 404, "NOT_FOUND", "this key does not belong to that team");
    return cred;
  };

  app.post("/api/teams/:team/notes", limit, async (c) => {
    const cred = await credOf(c);
    if (cred instanceof Response) return cred;
    const body = await c.req.json().catch(() => null);
    let input: NoteInput;
    try {
      input = readNote(body, cred.kind === "agent" ? `agent key ${cred.key.name}` : "team key");
    } catch (e) {
      if (e instanceof NoteError) return err(c, 400, "INVALID_REQUEST", (e as NoteErrorT).message);
      throw e;
    }
    const who = cred.kind === "agent" ? cred.key.id : "team";
    const r = await leaveNote(
      d,
      cred.team,
      input,
      cred.kind === "agent" ? "agent-key" : "team-key",
      who,
    );
    if ("retryAfterSec" in r) {
      c.header("Retry-After", String(r.retryAfterSec));
      return err(c, 429, "RATE_LIMITED", `at most ${NOTES_PER_HOUR} notes per hour per key`);
    }
    return c.json({ note: noteView(r) }, 201);
  });

  app.get("/api/teams/:team/notes", async (c) => {
    const cred = await credOf(c);
    if (cred instanceof Response) return cred;
    await d.notes.ready();
    const notes = d.notes.list({ ...filterOf(c), teamId: cred.team.id }, 100).map(noteView);
    return c.json({ notes });
  });
}

export function mountAdminNoteRoutes(app: Hono, d: NoteRouteDeps): void {
  app.get("/api/admin/notes", async (c) => {
    await d.notes.ready();
    const team = c.req.query("team") ?? "";
    const t = team ? d.teams.get(team) : null;
    const notes = d.notes
      .list({ ...filterOf(c), ...(t ? { teamId: t.id } : {}) }, 500)
      .map((n) => ({ ...noteView(n), teamId: n.teamId, via: n.via }));
    return c.json({ notes });
  });
  app.patch("/api/admin/notes/:id", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object")
      return err(c, 400, "INVALID_REQUEST", 'send {"status"?, "reply"?}');
    try {
      const n = await d.notes.update(
        c.req.param("id") ?? "",
        { status: body.status, reply: body.reply },
        "admin",
      );
      return c.json({ note: { ...noteView(n), teamId: n.teamId } });
    } catch (e) {
      if (e instanceof NoteError)
        return err(
          c,
          e.message === "no such note" ? 404 : 400,
          e.message === "no such note" ? "NOT_FOUND" : "INVALID_REQUEST",
          e.message,
        );
      throw e;
    }
  });
}
