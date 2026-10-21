import type { AgentNote, NoteSeverity, NoteStage, NoteStatus } from "./agent-notes.js";
import type { Config } from "./config.js";
import { type Lang, STRINGS } from "./i18n.js";
import {
  csrfField,
  type DashCtx,
  DS,
  dashLayout,
  esc,
  type Flash,
  flashBox,
  icon,
  localePath,
  pageHead,
} from "./ui.js";
import { badge, type DtAction, type DtRow, dataTable, relTime } from "./ui-table.js";

/** Agent notes pages (0.15.1): the admin triages every team's notes; a team sees its own. */
export const NX = {
  en: {
    title: "Agent notes",
    subAdmin:
      "Feedback agents leave at any stage (deploy, build, runtime, recipe). Blockers ring the bell. Reply, acknowledge or resolve.",
    subTeam: "Notes your agents left for the platform admin, with the admin's status and reply.",
    time: "Time",
    team: "Team",
    target: "Target",
    stage: "Stage",
    severity: "Severity",
    agent: "Agent",
    message: "Message",
    status: "Status",
    empty: "No notes yet. Agents leave one when they hit a problem.",
    stages: {
      deploy: "Deploy",
      build: "Build",
      runtime: "Runtime",
      recipe: "Recipe",
      other: "Other",
    },
    severities: { info: "Info", bug: "Bug", blocker: "Blocker", suggestion: "Suggestion" },
    statuses: { open: "Open", ack: "Acknowledged", resolved: "Resolved" },
    targets: { space: "Space", worker: "Worker", mcp: "MCP", recipe: "Recipe" },
    ack: "Acknowledge",
    resolve: "Mark resolved",
    reopen: "Reopen",
    reply: "Reply",
    replyFrom: "Admin reply",
    saveReply: "Send reply",
    redacted: "Secrets were removed",
    version: "Version",
    howTitle: "How agents leave a note",
    howBody:
      "With the team key or any agent key: POST /api/teams/<team>/notes. Over MCP: the leave_note tool. Keys, tokens and passwords are removed; 30 notes per hour per key.",
    saved: "Note updated.",
    category: "Category",
  },
  ar: {
    title: "ملاحظات الإيجنتس",
    subAdmin:
      "ملاحظات يتركها الإيجنتس في أي مرحلة (النشر، البناء، التشغيل، الوصفات). الملاحظات العائقة تُنبّه الجرس. ردّوا أو أكّدوا الاستلام أو أغلقوها.",
    subTeam: "ملاحظات تركها إيجنتس فريقكم لمسؤول المنصة، مع حالتها وردّ المسؤول.",
    time: "الوقت",
    team: "الفريق",
    target: "الهدف",
    stage: "المرحلة",
    severity: "الأهمية",
    agent: "الإيجنت",
    message: "الرسالة",
    status: "الحالة",
    empty: "لا توجد ملاحظات بعد. يترك الإيجنت ملاحظة حين تواجهه مشكلة.",
    stages: { deploy: "النشر", build: "البناء", runtime: "التشغيل", recipe: "وصفة", other: "أخرى" },
    severities: { info: "معلومة", bug: "خلل", blocker: "عائق", suggestion: "اقتراح" },
    statuses: { open: "مفتوحة", ack: "تم الاستلام", resolved: "تم الحل" },
    targets: { space: "مساحة", worker: "وركر", mcp: "MCP", recipe: "وصفة" },
    ack: "تأكيد الاستلام",
    resolve: "تم الحل",
    reopen: "إعادة فتح",
    reply: "ردّ",
    replyFrom: "ردّ المسؤول",
    saveReply: "أرسل الرد",
    redacted: "حُذفت أسرار من النص",
    version: "الإصدار",
    howTitle: "كيف يترك الإيجنت ملاحظة",
    howBody:
      "بمفتاح الفريق أو أي مفتاح إيجنت: POST /api/teams/<team>/notes. وعبر MCP: أداة leave_note. تُحذف المفاتيح وكلمات المرور تلقائيًا؛ ٣٠ ملاحظة في الساعة لكل مفتاح.",
    saved: "تم تحديث الملاحظة.",
    category: "التصنيف",
  },
} as const;

const SEV_TONE: Record<NoteSeverity, "err" | "warn" | "info" | "muted"> = {
  blocker: "err",
  bug: "warn",
  suggestion: "info",
  info: "muted",
};
const STATUS_TONE: Record<NoteStatus, "warn" | "info" | "on"> = {
  open: "warn",
  ack: "info",
  resolved: "on",
};

export interface NotesPageOpts {
  kind: "team" | "admin";
  csrf: string;
  ctx: DashCtx;
  flash?: Flash | null;
  notes: AgentNote[];
  teams: { id: string; name: string; slug?: string | null }[];
}

export function notesHtml(lang: Lang, c: Config, o: NotesPageOpts): string {
  const x = NX[lang];
  const href = (p: string) => localePath(lang, p);
  const admin = o.kind === "admin";
  const teamName = new Map(o.teams.map((t) => [t.id, t.name]));
  const back = href(admin ? "/admin/notes" : "/team/notes");
  const rows: DtRow[] = o.notes.map((n) => {
    const acts: DtAction[] = admin
      ? (
          [
            ["ack", x.ack, "check"],
            ["resolved", x.resolve, "check"],
            ["open", x.reopen, "redeploy"],
          ] as const
        )
          .filter(([st]) => st !== n.status)
          .map(([st, label, ic]) => ({
            kind: "post" as const,
            label,
            action: href(`/admin/notes/${n.id}`),
            icon: ic,
            hidden: { status: st, back },
            primary: st === "resolved",
          }))
      : [];
    const replyHtml = n.reply
      ? `<div class="note-reply"><strong>${esc(x.replyFrom)}:</strong> <span dir="auto">${esc(n.reply.text)}</span> <span class="meta">${relTime(n.reply.at, lang)}</span></div>`
      : "";
    const replyForm = admin
      ? `<details class="note-reply-form"><summary>${icon("edit")} ${esc(x.reply)}</summary><form method="post" action="${esc(href(`/admin/notes/${n.id}`))}">${csrfField(o.csrf)}<input type="hidden" name="back" value="${esc(back)}"><label class="sr-only" for="r-${esc(n.id)}">${esc(x.reply)}</label><textarea id="r-${esc(n.id)}" name="reply" rows="3" maxlength="2000" dir="auto">${esc(n.reply?.text ?? "")}</textarea><button class="button small" type="submit">${esc(x.saveReply)}</button></form></details>`
      : "";
    const target = n.target
      ? `${badge(x.targets[n.target.type] ?? n.target.type, "muted")} <code class="ltr">${esc(n.target.id)}</code>`
      : "—";
    return {
      label: `${n.category} · ${n.at}`,
      head: `${relTime(n.at, lang)}<div class="meta ltr" dir="ltr">${esc(n.at.slice(0, 16).replace("T", " "))} UTC</div>`,
      headV: n.at,
      cells: [
        ...(admin
          ? [
              {
                html: `<a class="text-link" href="${esc(href(`/admin/teams/${n.teamId}`))}"><bdi>${esc(teamName.get(n.teamId) ?? n.teamId)}</bdi></a>`,
                v: teamName.get(n.teamId) ?? n.teamId,
              },
            ]
          : []),
        {
          html: `${target}${n.version ? `<div class="meta">${esc(x.version)} <code class="ltr">${esc(n.version)}</code></div>` : ""}`,
          v: n.target?.id ?? "",
        },
        {
          html: `${esc(x.stages[n.stage] ?? n.stage)}<div class="meta"><bdi>${esc(n.category)}</bdi></div>`,
          v: n.stage,
        },
        {
          html: badge(x.severities[n.severity] ?? n.severity, SEV_TONE[n.severity]),
          v: ["blocker", "bug", "suggestion", "info"].indexOf(n.severity),
        },
        { html: `<bdi>${esc(n.agent)}</bdi>`, v: n.agent },
        {
          html: `<div class="note-msg" dir="auto">${esc(n.message)}</div>${n.redacted ? `<div class="meta">${icon("key")} ${esc(x.redacted)}</div>` : ""}${replyHtml}${replyForm}`,
          v: n.message.slice(0, 60),
          cls: "note-cell",
        },
        { html: badge(x.statuses[n.status] ?? n.status, STATUS_TONE[n.status]), v: n.status },
      ],
      actions: acts,
      filters: {
        stage: n.stage,
        severity: n.severity,
        status: n.status,
        ...(admin ? { team: n.teamId } : {}),
      },
    };
  });
  const opts = <K extends string>(
    vals: readonly K[],
    labels: Record<K, string>,
    used: Set<string>,
  ) => vals.filter((v) => used.has(v)).map((v) => [v, labels[v]] as [string, string]);
  const used = (k: "stage" | "severity" | "status") => new Set(o.notes.map((n) => n[k]));
  const teamsUsed = [...new Set(o.notes.map((n) => n.teamId))].map(
    (id) => [id, teamName.get(id) ?? id] as [string, string],
  );
  const table = dataTable({
    lang,
    id: "notes-table",
    caption: x.title,
    headLabel: x.time,
    cols: [
      ...(admin ? [{ label: x.team, sort: "text" as const }] : []),
      { label: x.target, sort: "text" },
      { label: x.stage, sort: "text" },
      { label: x.severity, sort: "num" },
      { label: x.agent, sort: "text" },
      { label: x.message },
      { label: x.status, sort: "text" },
    ],
    rows,
    csrf: o.csrf,
    empty: x.empty,
    search: true,
    filters: [
      ...(admin ? [{ key: "team", label: x.team, options: teamsUsed }] : []),
      {
        key: "status",
        label: x.status,
        options: opts(["open", "ack", "resolved"] as const, x.statuses, used("status")),
      },
      {
        key: "severity",
        label: x.severity,
        options: opts(
          ["blocker", "bug", "suggestion", "info"] as const,
          x.severities,
          used("severity"),
        ),
      },
      {
        key: "stage",
        label: x.stage,
        options: opts(
          ["deploy", "build", "runtime", "recipe", "other"] as const satisfies readonly NoteStage[],
          x.stages,
          used("stage"),
        ),
      },
    ],
  });
  const how = `<details class="panel how-notes"><summary>${icon("info")} ${esc(x.howTitle)}</summary><p class="meta">${esc(x.howBody)}</p><pre class="code ltr" dir="ltr"><code>curl -X POST "${esc(c.publicUrl)}/api/teams/&lt;team&gt;/notes" \\
  -H "X-Team-Key: $MARSA_AGENT_KEY" -H "content-type: application/json" \\
  -d '{"severity":"bug","stage":"deploy","category":"bindings","message":"…","target":{"type":"worker","id":"news"},"version":"4","agent":"my-agent"}'</code></pre><p><a class="text-link" href="${esc(href("/docs/recipes/agent-notes"))}">${esc(lang === "ar" ? "الدليل" : "Guide")}</a></p></details>`;
  const body = `<div class="page-wide">
  ${pageHead(admin ? DS[lang].adminArea : (o.ctx.name ?? ""), x.title, admin ? x.subAdmin : x.subTeam)}
  ${flashBox(lang, o.flash)}
  ${how}
  <section class="block" aria-label="${esc(x.title)}">${table}</section>
</div>`;
  return dashLayout({
    lang,
    config: c,
    kind: o.kind,
    active: "notes",
    title: `${x.title} · ${STRINGS[lang].product}`,
    description: admin ? x.subAdmin : x.subTeam,
    path: admin ? "/admin/notes" : "/team/notes",
    body,
    csrf: o.csrf,
    ctx: o.ctx,
  });
}
