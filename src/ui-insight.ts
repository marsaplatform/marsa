import type { Config } from "./config.js";
import { type Lang, STRINGS } from "./i18n.js";
import type { RepoLink, RepoStatus } from "./repo-status.js";
import {
  type DashCtx,
  DS,
  dashLayout,
  esc,
  type Flash,
  flashBox,
  hostless,
  icon,
  K14,
  localePath,
  pageHead,
} from "./ui.js";
import { DX, workerStatusBadge, workerStatusFilter } from "./ui-detail.js";
import { badge, type DtAction, type DtRow, dataTable, relTime } from "./ui-table.js";
import type { WorkerKind, WorkerLanguage } from "./worker-insight.js";

/** What the Workers tables, the Worker page and the MCP servers page show per Worker (0.15.1). */
export interface InsightRow {
  kind: WorkerKind;
  kindSource: "declared" | "code";
  language: WorkerLanguage;
  stack: string;
  toolsCount: number | null;
  toolsSource: "declared" | "probe" | "none";
  toolNames: string[];
  endpoint: string | null;
  probeAt: string | null;
  probeNote: string | null;
  repo: RepoLink | null;
  repoStatus: RepoStatus | null;
  space: {
    id: string;
    title: string;
    href: string;
    url: string;
    how: "manual" | "declared" | "name";
  } | null;
}

export const IX = {
  en: {
    type: "Type",
    kinds: { mcp: "MCP server", web: "Site / API", other: "Other" } as Record<string, string>,
    declared: "declared",
    detected: "detected",
    stack: "Language / stack",
    languages: {
      typescript: "TypeScript",
      javascript: "JavaScript",
      python: "Python",
      unknown: "Unknown",
    } as Record<string, string>,
    tools: "MCP tools",
    toolsUnknown: "—",
    ownAuth: "Own auth (401)",
    endpoint: "MCP endpoint",
    protected: "Spaces keys",
    yes: "Yes",
    no: "No",
    repo: "Repo",
    repoNone: "Not linked",
    visibility: {
      public: "Public",
      private: "Private",
      "not-found": "Not found",
      unknown: "Unknown",
      unchecked: "Linked (not GitHub)",
      none: "Not linked",
    } as Record<string, string>,
    privateUnconfirmed: "Private or not found",
    sync: {
      synced: "Up to date",
      behind: "Behind",
      diverged: "Diverged",
      unknown: "Sync unknown",
    } as Record<string, string>,
    behindBy: (n: number) => `${n} commit${n === 1 ? "" : "s"} behind`,
    checking: "Checking…",
    space: "Space page",
    spaceNone: "No linked space",
    refresh: "Refresh tools list",
    refreshed: "Tools list refreshed.",
    probeAt: "Checked",
    userKeys: "User keys",
    openWorker: "Worker page",
    mcpTitle: "MCP servers",
    mcpSub:
      "Every Worker that is an MCP server (declared on deploy or detected in its code), with its endpoint, tools, key protection and repo.",
    mcpEmpty: "No MCP servers yet. Deploy one from the MCP-on-Worker recipe.",
    caption: "MCP servers",
    linksTitle: "Repo, space and type",
    linksHelp: "Shown in the tables and on the MCP servers page. Saving does not redeploy.",
    siteRepoHelp:
      "Optional. The source of this space; shown in the tables with a read-only GitHub check.",
    repoUrl: "Repo URL",
    branch: "Branch",
    commit: "Deployed commit",
    spacePick: "Linked space",
    auto: "Automatic",
    declaredMeta: "Declared type",
    saveLinks: "Save",
    linksSaved: "Saved.",
    stackFramework: "Framework",
    syncLabel: "Sync",
  },
  ar: {
    type: "النوع",
    kinds: { mcp: "سيرفر MCP", web: "موقع / API", other: "أخرى" } as Record<string, string>,
    declared: "مُعلَن",
    detected: "مُكتشَف",
    stack: "اللغة / التقنية",
    languages: {
      typescript: "TypeScript",
      javascript: "JavaScript",
      python: "Python",
      unknown: "غير معروفة",
    } as Record<string, string>,
    tools: "أدوات MCP",
    toolsUnknown: "—",
    ownAuth: "مصادقة خاصة (401)",
    endpoint: "عنوان MCP",
    protected: "مفاتيح مساحات",
    yes: "نعم",
    no: "لا",
    repo: "المستودع",
    repoNone: "غير مربوط",
    visibility: {
      public: "عام",
      private: "خاص",
      "not-found": "غير موجود",
      unknown: "غير معروف",
      unchecked: "مربوط (ليس GitHub)",
      none: "غير مربوط",
    } as Record<string, string>,
    privateUnconfirmed: "خاص أو غير موجود",
    sync: {
      synced: "محدّث",
      behind: "متأخر",
      diverged: "متفرّع",
      unknown: "المزامنة غير معروفة",
    } as Record<string, string>,
    behindBy: (n: number) => `متأخر ${n} commit`,
    checking: "جارٍ الفحص…",
    space: "صفحة المساحة",
    spaceNone: "لا توجد مساحة مربوطة",
    refresh: "حدّث قائمة الأدوات",
    refreshed: "تم تحديث قائمة الأدوات.",
    probeAt: "آخر فحص",
    userKeys: "مفاتيح المستخدمين",
    openWorker: "صفحة الوركر",
    mcpTitle: "سيرفرات MCP",
    mcpSub:
      "كل وركر هو سيرفر MCP (مُعلَن عند النشر أو مُكتشَف في الكود)، مع عنوانه وأدواته وحماية المفاتيح والمستودع.",
    mcpEmpty: "لا توجد سيرفرات MCP بعد. انشروا واحدًا من وصفة MCP على وركر.",
    caption: "سيرفرات MCP",
    linksTitle: "المستودع والمساحة والنوع",
    linksHelp: "تظهر في الجداول وصفحة سيرفرات MCP. الحفظ لا يعيد النشر.",
    siteRepoHelp: "اختياري. مصدر هذه المساحة؛ يظهر في الجداول مع فحص قراءة فقط على GitHub.",
    repoUrl: "رابط المستودع",
    branch: "الفرع",
    commit: "الـ commit المنشور",
    spacePick: "المساحة المربوطة",
    auto: "تلقائي",
    declaredMeta: "النوع المُعلَن",
    saveLinks: "احفظ",
    linksSaved: "تم الحفظ.",
    stackFramework: "الإطار",
    syncLabel: "المزامنة",
  },
};

const _arHasAll: typeof IX.en = IX.ar;
void _arHasAll;

export function kindBadge(lang: Lang, i: InsightRow): string {
  const x = IX[lang];
  const tone = i.kind === "mcp" ? "info" : i.kind === "web" ? "muted" : "muted";
  return `${badge(x.kinds[i.kind] ?? i.kind, tone)}${i.kindSource === "code" ? ` <span class="meta">${esc(x.detected)}</span>` : ""}`;
}

export function stackCell(lang: Lang, i: InsightRow): string {
  return i.language === "unknown" && i.stack === "Unknown"
    ? `<span class="meta">${esc(IX[lang].languages.unknown ?? "")}</span>`
    : `<bdi dir="ltr">${esc(i.stack)}</bdi>`;
}

export function toolsCell(lang: Lang, i: InsightRow): string {
  if (i.kind !== "mcp") return `<span class="meta">—</span>`;
  const n =
    i.toolsCount === null
      ? i.probeNote === "protected"
        ? `${badge(IX[lang].ownAuth, "info")}`
        : `<span class="meta">${esc(IX[lang].toolsUnknown)}</span>`
      : String(i.toolsCount);
  return n;
}

export function repoCell(
  lang: Lang,
  i: { repo: RepoLink | null; repoStatus: RepoStatus | null },
): string {
  const x = IX[lang];
  if (!i.repo) return `<span class="meta">${esc(x.repoNone)}</span>`;
  const st = i.repoStatus;
  const short = i.repo.url.replace(/^https:\/\/(www\.)?github\.com\//, "");
  const link = `<a class="text-link ltr" dir="ltr" href="${esc(i.repo.url)}" target="_blank" rel="noopener noreferrer">${icon("repo")}${esc(short)}</a>`;
  if (!st) return `${link}<div class="meta">${esc(x.checking)}</div>`;
  const vis =
    st.visibility === "private" && !st.visibilityConfirmed
      ? x.privateUnconfirmed
      : (x.visibility[st.visibility] ?? st.visibility);
  const visTone =
    st.visibility === "public" ? "on" : st.visibility === "not-found" ? "warn" : "muted";
  const sync =
    st.visibility === "unchecked"
      ? ""
      : st.sync === "behind" && st.behindBy
        ? badge(x.behindBy(st.behindBy), "warn")
        : badge(
            x.sync[st.sync] ?? st.sync,
            st.sync === "synced" ? "on" : st.sync === "unknown" ? "muted" : "warn",
          );
  return `${link}<div class="repo-badges">${badge(vis ?? "", visTone)} ${sync}</div>`;
}

export function kindFilter(lang: Lang, list: { insight?: InsightRow }[]) {
  const x = IX[lang];
  return {
    key: "kind",
    label: x.type,
    options: [...new Set(list.map((r) => r.insight?.kind ?? "other"))].map(
      (k) => [k, x.kinds[k] ?? k] as [string, string],
    ),
  };
}

export function languageFilter(lang: Lang, list: { insight?: InsightRow }[]) {
  const x = IX[lang];
  return {
    key: "lang",
    label: x.stack,
    options: [...new Set(list.map((r) => r.insight?.language ?? "unknown"))].map(
      (k) => [k, x.languages[k] ?? k] as [string, string],
    ),
  };
}

export const repoValue = (
  i: { repo: RepoLink | null; repoStatus: RepoStatus | null } | undefined,
) => (!i?.repo ? "none" : (i.repoStatus?.visibility ?? "unknown"));

export function repoFilter(
  lang: Lang,
  list: { insight?: InsightRow; repo?: RepoLink | null; repoStatus?: RepoStatus | null }[],
) {
  const x = IX[lang];
  return {
    key: "repo",
    label: x.repo,
    options: [
      ...new Set(
        list.map((r) =>
          repoValue(r.insight ?? { repo: r.repo ?? null, repoStatus: r.repoStatus ?? null }),
        ),
      ),
    ].map((k) => [k, x.visibility[k] ?? k] as [string, string]),
  };
}

export function syncFilter(lang: Lang, list: { insight?: InsightRow }[]) {
  const x = IX[lang];
  return {
    key: "sync",
    label: x.syncLabel,
    options: [
      ...new Set(
        list.filter((r) => r.insight?.repo).map((r) => r.insight?.repoStatus?.sync ?? "unknown"),
      ),
    ].map((k) => [k, x.sync[k] ?? k] as [string, string]),
  };
}

// ---- MCP servers page (team: its own; admin: every team) -------------------------------

export interface McpServerRow {
  id: string;
  name: string;
  url: string;
  status: string;
  version?: number | null;
  deployedAt: string | null;
  deployedBy: string;
  team?: { id: string; name: string | null };
  keysOn?: boolean;
  keysCount?: number;
  insight?: InsightRow;
}

export interface McpServersOpts {
  kind: "team" | "admin";
  csrf: string;
  ctx: DashCtx;
  flash?: Flash | null;
  rows: McpServerRow[];
  canEdit: boolean;
}

export function mcpServersHtml(lang: Lang, c: Config, o: McpServersOpts): string {
  const x = IX[lang];
  const k = K14[lang];
  const href = (p: string) => localePath(lang, p);
  const admin = o.kind === "admin";
  const list = o.rows.filter((r) => r.insight?.kind === "mcp");
  const detail = (r: McpServerRow) =>
    href(admin ? `/admin/teams/${r.team?.id ?? ""}/workers/${r.name}` : `/team/workers/${r.name}`);
  const rows: DtRow[] = list.map((r) => {
    const i = r.insight as InsightRow;
    const keysHref = `${detail(r)}?tab=keys`;
    const acts: DtAction[] = [
      { kind: "link", label: x.openWorker, href: detail(r), primary: true },
      ...(i.endpoint
        ? [{ kind: "copy" as const, label: x.endpoint, value: i.endpoint, primary: true }]
        : []),
      { kind: "link", label: x.userKeys, href: keysHref, icon: "key" },
      ...(i.space
        ? [{ kind: "link" as const, label: x.space, href: href(i.space.href), icon: "sites" }]
        : []),
      ...(r.status === "active" && (admin || o.canEdit)
        ? [
            {
              kind: "post" as const,
              label: x.refresh,
              action: href(
                admin ? `/admin/workers/${r.id}/probe` : `/team/workers/${r.name}/probe`,
              ),
              icon: "redeploy",
              hidden: { back: href(admin ? "/admin/mcp" : "/team/mcp") },
            },
          ]
        : []),
    ];
    const cells = [
      ...(admin
        ? [
            {
              html: r.team?.name
                ? `<a class="text-link" href="${href(`/admin/teams/${r.team.id}`)}"><bdi>${esc(r.team.name)}</bdi></a>`
                : "—",
              v: (r.team?.name ?? "").toLowerCase(),
            },
          ]
        : []),
      { html: workerStatusBadge(lang, r.status), v: r.status },
      {
        html: i.space
          ? `<a class="text-link" href="${esc(href(i.space.href))}"><bdi>${esc(i.space.title)}</bdi></a>`
          : `<span class="meta">${esc(x.spaceNone)}</span>`,
        v: i.space?.title ?? "",
      },
      {
        html: `${badge(r.keysOn ? x.yes : x.no, r.keysOn ? "on" : "muted")}${r.keysOn ? ` <span class="meta">${esc(String(r.keysCount ?? 0))}</span>` : ""} <a class="button small ghost" href="${esc(keysHref)}">${icon("key")}${esc(x.userKeys)}</a>`,
        v: r.keysOn ? 1 : 0,
      },
      { html: toolsCell(lang, i), v: i.toolsCount ?? -1, cls: "num" },
      { html: stackCell(lang, i), v: i.stack },
      { html: repoCell(lang, i), v: repoValue(i) },
      {
        html: r.deployedAt
          ? `${relTime(r.deployedAt, lang)}${r.version ? ` <span class="meta">v${r.version}</span>` : ""}`
          : "—",
        v: r.deployedAt ?? "",
      },
    ];
    return {
      label: r.name,
      href: detail(r),
      head: `<a class="row-link" href="${esc(detail(r))}"><code class="ltr">${esc(r.name)}</code></a>${
        i.endpoint ? `<div class="meta url ltr" dir="ltr">${esc(hostless(i.endpoint))}</div>` : ""
      }`,
      headV: r.name,
      cells,
      actions: acts,
      filters: {
        status: r.status,
        lang: i.language,
        repo: repoValue(i),
        keys: r.keysOn ? "on" : "off",
        ...(r.team ? { team: r.team.id } : {}),
      },
    };
  });
  const teamOpts = [
    ...new Map(
      list.filter((r) => r.team).map((r) => [r.team?.id ?? "", r.team?.name ?? ""]),
    ).entries(),
  ];
  const table = dataTable({
    lang,
    id: "mcp-table",
    caption: x.caption,
    headLabel: DX[lang].worker,
    cols: [
      ...(admin ? [{ label: DX[lang].team, sort: "text" as const }] : []),
      { label: DX[lang].status, sort: "text" },
      { label: x.space, sort: "text" },
      { label: x.protected, sort: "num" },
      { label: x.tools, sort: "num" },
      { label: x.stack, sort: "text" },
      { label: x.repo, sort: "text" },
      { label: DX[lang].lastDeploy, sort: "date" },
    ],
    rows,
    csrf: o.csrf,
    empty: x.mcpEmpty,
    search: true,
    filters: [
      ...(admin
        ? [{ key: "team", label: DX[lang].team, options: teamOpts as [string, string][] }]
        : []),
      workerStatusFilter(lang, list),
      {
        key: "keys",
        label: x.protected,
        options: [
          ["on", k.on],
          ["off", k.off],
        ] as [string, string][],
      },
      languageFilter(lang, list),
      repoFilter(lang, list),
    ],
  });
  const body = `<div class="page-wide">
  ${pageHead(admin ? DS[lang].adminArea : (o.ctx.name ?? ""), x.mcpTitle, x.mcpSub)}
  ${flashBox(lang, o.flash)}
  <section class="block" aria-label="${esc(x.mcpTitle)}">${table}</section>
</div>`;
  return dashLayout({
    lang,
    config: c,
    kind: o.kind,
    active: "mcp",
    title: `${x.mcpTitle} · ${STRINGS[lang].product}`,
    description: x.mcpSub,
    path: admin ? "/admin/mcp" : "/team/mcp",
    body,
    csrf: o.csrf,
    ctx: o.ctx,
  });
}
