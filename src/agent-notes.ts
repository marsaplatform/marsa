import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Agent notes (0.15.1): agents leave short feedback at any stage (deploy, build, runtime,
 * recipe, other) so the admin sees what went wrong. Messages are size-limited, stripped of
 * control characters and of anything that looks like a secret before they are stored;
 * the dashboards escape them on render. Admin: status (open/ack/resolved) and one reply.
 */
export const NOTE_STAGES = ["deploy", "build", "runtime", "recipe", "other"] as const;
export const NOTE_SEVERITIES = ["info", "bug", "blocker", "suggestion"] as const;
export const NOTE_STATUSES = ["open", "ack", "resolved"] as const;
export const NOTE_TARGETS = ["space", "worker", "mcp", "recipe"] as const;
export type NoteStage = (typeof NOTE_STAGES)[number];
export type NoteSeverity = (typeof NOTE_SEVERITIES)[number];
export type NoteStatus = (typeof NOTE_STATUSES)[number];
export type NoteTargetType = (typeof NOTE_TARGETS)[number];

export const NOTE_MAX_MESSAGE = 2000;
export const NOTE_MAX_REPLY = 2000;
export const NOTES_KEEP_PER_TEAM = 500;
/** Per team and credential. */
export const NOTES_PER_HOUR = 30;

export interface AgentNote {
  id: string;
  at: string;
  teamId: string;
  stage: NoteStage;
  severity: NoteSeverity;
  category: string;
  message: string;
  target?: { type: NoteTargetType; id: string };
  /** A deploy or version id (e.g. "v4", a Worker version number or a commit). */
  version?: string;
  agent: string;
  /** "admin" (0.17.0): a note the platform admin posted to the team. */
  via: "team-key" | "agent-key" | "mcp" | "dashboard" | "admin";
  status: NoteStatus;
  reply?: { text: string; at: string; by: string };
  updatedAt: string;
  /** True when something that looked like a secret was removed. */
  redacted?: boolean;
}

export class NoteError extends Error {}

const REDACTED = "[redacted]";
const SECRET_RES: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bmarsa_[a-z]+_[A-Za-z0-9_-]{8,}/g,
  /\b(?:msk|whsec)_[A-Za-z0-9_-]{8,}/g,
  /\b(?:sk|pk|rk)[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b((?:api[_-]?key|apikey|secret|password|passwd|pwd|token|auth|authorization|x-team-key|access[_-]?key|private[_-]?key|client[_-]?secret)["']?\s*[:=]\s*["']?)[^\s"',;]{4,}/gi,
  /(https?:\/\/)[^\s/:@]+:[^\s/@]+@/g,
  /\b[A-Fa-f0-9]{48,}\b/g,
  /(?<![A-Za-z0-9+/])(?=[A-Za-z0-9+/]*[0-9])(?=[A-Za-z0-9+/]*[A-Z])[A-Za-z0-9+/]{48,}={0,2}(?![A-Za-z0-9+/])/g,
];

/** Remove anything that looks like a credential. */
export function redactSecrets(text: string): { text: string; redacted: boolean } {
  let out = text;
  for (const re of SECRET_RES) {
    out = out.replace(re, (m, a, b) => {
      if (typeof a === "string" && /^(Bearer|Basic|Token)$/i.test(a)) return `${a} ${REDACTED}`;
      if (typeof a === "string" && a.startsWith("http")) return `${a}${REDACTED}@`;
      if (typeof a === "string" && typeof b === "number" && m.startsWith(a))
        return `${a}${REDACTED}`;
      return REDACTED;
    });
  }
  return { text: out, redacted: out !== text };
}

/** Control characters out (newlines and tabs kept), whitespace trimmed. */
export function cleanText(s: string, max: number): string {
  return (
    s
      .replace(/\r\n?/g, "\n")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: strip control and bidi-override characters
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u200b\u202a-\u202e\u2066-\u2069]/g, "")
      .trim()
      .slice(0, max)
  );
}

const CATEGORY_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._/-]{0,39}$/u;
const ID_RE = /^[\p{L}\p{N}._:/@-]{1,100}$/u;
const VERSION_RE = /^[A-Za-z0-9._:#-]{1,60}$/;
const AGENT_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._()@/-]{0,59}$/u;

export interface NoteInput {
  stage: NoteStage;
  severity: NoteSeverity;
  category: string;
  message: string;
  target?: { type: NoteTargetType; id: string };
  version?: string;
  agent: string;
  redacted: boolean;
}

/** Validate an agent's note. `agentDefault` names the key when the agent sends no name. */
export function readNote(raw: unknown, agentDefault: string): NoteInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new NoteError(
      'send JSON {"severity","message","stage"?,"category"?,"target"?,"version"?,"agent"?}',
    );
  const o = raw as Record<string, unknown>;
  const extra = Object.keys(o).find(
    (k) => !["stage", "severity", "category", "message", "target", "version", "agent"].includes(k),
  );
  if (extra) throw new NoteError(`${extra.slice(0, 30)} is not supported`);
  const stage = (o.stage ?? "other") as NoteStage;
  if (!NOTE_STAGES.includes(stage)) throw new NoteError(`stage: one of ${NOTE_STAGES.join(", ")}`);
  const severity = o.severity as NoteSeverity;
  if (!NOTE_SEVERITIES.includes(severity))
    throw new NoteError(`severity: one of ${NOTE_SEVERITIES.join(", ")}`);
  if (typeof o.message !== "string") throw new NoteError("message: text (1-2000 characters)");
  if (o.message.length > NOTE_MAX_MESSAGE * 2)
    throw new NoteError(`message: at most ${NOTE_MAX_MESSAGE} characters`);
  const cleaned = cleanText(o.message, NOTE_MAX_MESSAGE);
  if (!cleaned) throw new NoteError("message: text (1-2000 characters)");
  const msg = redactSecrets(cleaned);
  let category = "general";
  if (o.category !== undefined && o.category !== "") {
    const c = typeof o.category === "string" ? cleanText(o.category, 40) : "";
    if (!CATEGORY_RE.test(c))
      throw new NoteError("category: up to 40 letters, digits, spaces or . _ / -");
    category = c.toLowerCase();
  }
  let target: NoteInput["target"];
  if (o.target !== undefined && o.target !== null) {
    const t = o.target as Record<string, unknown>;
    if (typeof t !== "object" || Array.isArray(t) || !NOTE_TARGETS.includes(t.type as never))
      throw new NoteError(`target: {"type": ${NOTE_TARGETS.join("|")}, "id"}`);
    const id = typeof t.id === "string" ? t.id.trim() : "";
    if (!ID_RE.test(id)) throw new NoteError("target.id: 1-100 characters, no spaces");
    target = { type: t.type as NoteTargetType, id };
  }
  let version: string | undefined;
  if (o.version !== undefined && o.version !== null && o.version !== "") {
    const v = String(o.version).trim();
    if (!VERSION_RE.test(v)) throw new NoteError("version: up to 60 letters, digits or . _ : # -");
    version = v;
  }
  let agent = agentDefault;
  if (o.agent !== undefined && o.agent !== "") {
    const a = typeof o.agent === "string" ? cleanText(o.agent, 60) : "";
    if (!AGENT_RE.test(a)) throw new NoteError("agent: up to 60 characters");
    agent = a;
  }
  const agentClean = redactSecrets(agent);
  return {
    stage,
    severity,
    category,
    message: msg.text,
    ...(target ? { target } : {}),
    ...(version ? { version } : {}),
    agent: agentClean.text,
    redacted: msg.redacted || agentClean.redacted,
  };
}

export interface NoteFilter {
  teamId?: string;
  status?: NoteStatus;
  severity?: NoteSeverity;
  stage?: NoteStage;
}

export class NoteStore {
  private readonly file: string;
  private readonly tmpDir: string;
  private notes: AgentNote[] = [];
  private loading: Promise<void> | null = null;
  private writeQ: Promise<void> = Promise.resolve();

  constructor(
    dataDir: string,
    private readonly now: () => number = Date.now,
  ) {
    const root = resolve(dataDir);
    this.file = join(root, "agent-notes.json");
    this.tmpDir = join(root, "tmp");
  }

  ready(): Promise<void> {
    this.loading ??= this.load();
    return this.loading;
  }

  private async load() {
    try {
      const f = JSON.parse(await readFile(this.file, "utf8")) as { notes?: AgentNote[] };
      this.notes = Array.isArray(f.notes) ? f.notes : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  private save() {
    const body = JSON.stringify({ version: 1, notes: this.notes });
    const run = async () => {
      await mkdir(this.tmpDir, { recursive: true });
      const tmp = join(this.tmpDir, `an-${randomBytes(6).toString("hex")}.json`);
      await writeFile(tmp, body, { mode: 0o600 });
      await rename(tmp, this.file);
    };
    this.writeQ = this.writeQ.then(run, run);
    return this.writeQ;
  }

  private iso() {
    return new Date(this.now()).toISOString();
  }

  async add(teamId: string, n: NoteInput, via: AgentNote["via"]): Promise<AgentNote> {
    await this.ready();
    const at = this.iso();
    const { redacted, ...rest } = n;
    const note: AgentNote = {
      id: `nt_${randomBytes(6).toString("hex")}`,
      at,
      teamId,
      ...rest,
      via,
      status: "open",
      updatedAt: at,
      ...(redacted ? { redacted: true } : {}),
    };
    this.notes.push(note);
    // Keep the newest NOTES_KEEP_PER_TEAM per team.
    const mine = this.notes.filter((x) => x.teamId === teamId);
    if (mine.length > NOTES_KEEP_PER_TEAM) {
      const drop = new Set(mine.slice(0, mine.length - NOTES_KEEP_PER_TEAM).map((x) => x.id));
      this.notes = this.notes.filter((x) => !drop.has(x.id));
    }
    await this.save();
    return note;
  }

  /** Newest first. */
  list(f: NoteFilter = {}, limit = 500): AgentNote[] {
    return this.notes
      .filter(
        (n) =>
          (!f.teamId || n.teamId === f.teamId) &&
          (!f.status || n.status === f.status) &&
          (!f.severity || n.severity === f.severity) &&
          (!f.stage || n.stage === f.stage),
      )
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit);
  }

  get(id: string): AgentNote | null {
    return this.notes.find((n) => n.id === id) ?? null;
  }

  openCount(teamId?: string): number {
    return this.notes.filter((n) => n.status !== "resolved" && (!teamId || n.teamId === teamId))
      .length;
  }

  /** Admin: change the status and/or set the reply ("" clears it). */
  async update(
    id: string,
    change: { status?: unknown; reply?: unknown },
    by: string,
  ): Promise<AgentNote> {
    await this.ready();
    const n = this.get(id);
    if (!n) throw new NoteError("no such note");
    if (change.status !== undefined) {
      if (!NOTE_STATUSES.includes(change.status as NoteStatus))
        throw new NoteError(`status: one of ${NOTE_STATUSES.join(", ")}`);
      n.status = change.status as NoteStatus;
    }
    if (change.reply !== undefined) {
      if (typeof change.reply !== "string") throw new NoteError("reply: text");
      const text = redactSecrets(cleanText(change.reply, NOTE_MAX_REPLY)).text;
      if (text) n.reply = { text, at: this.iso(), by };
      else delete n.reply;
    }
    n.updatedAt = this.iso();
    await this.save();
    return n;
  }

  async purgeTeam(teamId: string): Promise<void> {
    await this.ready();
    const before = this.notes.length;
    this.notes = this.notes.filter((n) => n.teamId !== teamId);
    if (this.notes.length !== before) await this.save();
  }
}
