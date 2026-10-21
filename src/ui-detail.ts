import type { AgentKeyView } from "./agent-keys.js";
import type { Config } from "./config.js";
import { actorText, bytesLabel, detailText, type Lang, STRINGS } from "./i18n.js";
import type { MemberRole } from "./members.js";
import {
  ADMIN_CTX,
  type AuditView,
  auditTable,
  csrfField,
  type DashCtx,
  DS,
  dashLayout,
  esc,
  type Flash,
  flashBox,
  fmt,
  hostless,
  icon,
  K14,
  type KvRowView,
  localePath,
  type McpPanel,
  mcpSection,
  postForm,
  statCard,
  type TeamSiteRow,
  timeTag,
  ttlOptions,
  V14,
  visitsCell,
  visitsSection,
  type WorkerRowView,
  WS,
} from "./ui.js";
import {
  type InsightRow,
  IX,
  kindBadge,
  kindFilter,
  languageFilter,
  repoCell,
  repoFilter,
  repoValue,
  stackCell,
  toolsCell,
} from "./ui-insight.js";
import { teamDeleteRows } from "./ui-lifecycle.js";
import {
  envTab,
  healthCellHtml,
  healthTab,
  logsTab,
  type OpsTabCtx,
  OX,
  sparkCellHtml,
  usageTab,
} from "./ui-ops.js";
import { badge, type DtAction, type DtRow, dataTable, relTime, tabsNav } from "./ui-table.js";
import type { UserKeyView } from "./user-keys.js";
import type { LogsResult, UsageRange, UsageSeries } from "./worker-analytics.js";
import { ALLOWED_COMPAT_FLAGS } from "./worker-config.js";
import type { EnvView } from "./worker-env.js";
import type { HealthView } from "./worker-health.js";
import type { KeyUsageRow } from "./worker-ops.js";
import type { VersionMeta } from "./worker-versions.js";
import type { WorkerView } from "./workers.js";

/** Strings for the 0.15.0 detail pages. */
export const DX = {
  en: {
    tabs: "Sections",
    overview: "Overview",
    versions: "Versions",
    keys: "API keys",
    settings: "Settings",
    activity: "Activity",
    members: "Members",
    spaces: "Spaces",
    workers: "Workers",
    agents: "Agent keys",
    files: "Files",
    data: "Data",
    visits: "Visits",
    mcp: "MCP",
    worker: "Worker",
    space: "Space",
    team: "Team",
    status: "Status",
    liveUrl: "Live URL",
    mcpUrl: "MCP endpoint",
    mcpDetected: "detected in the code",
    open: "Open",
    copy: "Copy",
    copied: "Copied",
    lastDeploy: "Last deploy",
    by: "by",
    size: "Size",
    sha: "SHA-256",
    version: "Version",
    noVersion: "No stored version yet: the next deploy is saved.",
    varNames: "Variables",
    secretNames: "Secrets",
    none: "None",
    health: "Health check",
    healthOk: (code: number, ms: number) => `HTTP ${code} in ${ms} ms`,
    healthFail: (ms: number) => `No answer (${ms} ms)`,
    healthOff: "Not checked: the Worker is not active.",
    requests: "Requests",
    requests7: "Requests, 7 days",
    requestsNA:
      "Not available: Spaces does not read Cloudflare analytics. Counts appear here when API keys are in use.",
    requestsKeys: (today: string, week: string) => `${today} today · ${week} in 7 days (API keys)`,
    created: "Created",
    updated: "Updated",
    script: "Script",
    lastError: "Last error",
    redeploy: "Redeploy",
    newCode: "Deploy new code",
    envTitle: "Environment variables",
    envHelp:
      "NAME=value, one per line. Saving redeploys the current code with these variables (recorded as a new version).",
    saveEnv: "Save variables",
    secretsTitle: "Secrets",
    runtimeTitle: "Runtime and bindings",
    runtimeHelp:
      "Cloudflare compatibility settings and service bindings to other Workers of this team. Saving redeploys the current code; the bound Workers are not changed.",
    compatDate: "Compatibility date",
    platformDefault: "(platform default)",
    compatDateHelp: "Empty = the platform default.",
    compatFlags: "Compatibility flags",
    flagHelp: {
      global_fetch_strictly_public:
        "fetch() to a public hostname goes out through the internet, even on the same zone (call another team Worker by its URL).",
      nodejs_compat: "Node.js APIs (node:buffer, node:crypto, …).",
      nodejs_als: "AsyncLocalStorage only.",
    } as Record<string, string>,
    bindingsTitle: "Service bindings",
    bindingsHelp: (names: string) =>
      `One per line: NAME=worker. Only Workers of this team${names ? ` (${names})` : ""}. In code: env.NAME.fetch(request).`,
    saveRuntime: "Save runtime settings",
    secretsHelp:
      "NAME=value to set or replace, NAME= (empty) to remove. Values are write-only and go straight to Cloudflare. Saving redeploys the current code.",
    saveSecrets: "Save secrets",
    removeSecret: "Remove",
    removeSecretConfirm: (n: string) =>
      `Remove the secret ${n}? The Worker is redeployed without it.`,
    needVersion:
      "Deploy the code once from the Workers page so it is stored; then you can edit it here.",
    disable: "Disable",
    enable: "Enable",
    disableHelp: "Takes the Worker offline (its address stops answering) without deleting it.",
    disableConfirm: "Disable this Worker? Its address stops answering until it is enabled again.",
    disabledByAdmin: "The admin disabled this Worker. Only the admin can enable it.",
    deleteWorker: "Delete this Worker",
    deleteWorkerHelp: "Deletes the script, its address, its versions and its API keys.",
    danger: "Danger zone",
    readOnly: "Read-only for your role.",
    adminReadOnly: "Admin view: code changes happen in the team's dashboard or API.",
    noActivity: "No activity for this yet.",
    noVersions: "No versions stored yet.",
    download: "Download code",
    rollback: "Roll back",
    current: "Current",
    keysOff: "API keys are off for this Worker.",
    keysCount: (n: number) => (n === 1 ? "1 active key" : `${n} active keys`),
    keyPrefix: "Team key",
    liveSpaces: "Live spaces",
    storage: "Storage",
    visits7: "Views, 7 days",
    visits30: "Views, 30 days",
    features: "Features",
    backend: "Data and files",
    home: "On home page",
    permanent: "Permanent links",
    workersFeature: "Workers",
    quota: "Quotas",
    quotaSites: "Max spaces",
    quotaMb: "Max MB",
    quotaHelp: "Empty = platform default.",
    rename: "Name",
    saveTeam: "Save",
    invite: "Create invite link",
    role: "Role",
    roles: { owner: "Owner", editor: "Editor", viewer: "Viewer" } as Record<string, string>,
    changeRole: "Make",
    remove: "Remove",
    removeConfirm: (n: string) => `Remove ${n} from the team? Their sessions end at once.`,
    member: "Member",
    lastLogin: "Last sign-in",
    joined: "Joined",
    noMembers: "No members yet. The team signs in with the team key or an invite link.",
    rotate: "Issue a new team key",
    rotateHelp: "The old key stops working at once; agents and sign-ins with it end.",
    rotateConfirm: "Issue a new team key? The current one stops working at once.",
    deleteTeam: "Delete this team",
    workersOn: "Workers on",
    workersSlug: "Slug",
    maxWorkers: "Max Workers",
    maxKb: "Max KB",
    saveWorkers: "Save Workers settings",
    turnOffWorkers: "Turning Workers off deletes every Worker of the team.",
    keyName: "Key",
    prefix: "Prefix",
    revokeKey: "Revoke",
    revokeKeyConfirm: "Revoke this key? Calls with it stop at once.",
    scopes: "Scopes",
    expires: "Expires",
    lastUsed: "Last used",
    noAgentKeys: "No agent keys.",
    noSpaces: "No live spaces.",
    noWorkers: "No Workers.",
    keyStates: { active: "Active", revoked: "Revoked", expired: "Expired" } as Record<
      string,
      string
    >,
    previewAlt: (t: string) => `Preview of ${t}`,
    link: "Link",
    expiry: "Expiry",
    capped: "Can be extended up to",
    owner: "Owner",
    guest: "Guest",
    live: "Live",
    listedYes: "Listed",
    listedNo: "Hidden",
    editToken: "Edit token",
    tokenHelp:
      "The edit token lets scripts update or delete this space through the API. Issue a new one if it leaked; the old one stops working at once.",
    regenerate: "Issue a new edit token",
    regenerateConfirm: "Issue a new edit token? The current one stops working at once.",
    tokenNew: "New edit token",
    tokenDone: "A new edit token was issued. Copy it now: it is shown once.",
    deleteSpace: "Delete this space",
    deleteSpaceHelp: "Removes its files, data and visit counts. The link stops working at once.",
    filesCount: (n: number) => (n === 1 ? "1 file" : `${n} files`),
    path: "Path",
    kvKeys: "KV keys",
    key: "Key",
    value: "Value",
    deleteKey: "Delete",
    noKv: "No KV keys.",
    uploads: "Uploaded files",
    noUploads: "No uploaded files.",
    moreKeys: (n: number) => `${n} more keys (names only)`,
    dataOff: "Data and files are off for this space.",
    grantPermanent: "Make permanent",
    revokePermanent: "Remove permanent",
    confirm: "Are you sure?",
    secretsNote: "Secret values are never stored by Spaces; versions record only their names.",
  },
  ar: {
    tabs: "الأقسام",
    overview: "نظرة عامة",
    versions: "الإصدارات",
    keys: "مفاتيح API",
    settings: "الإعدادات",
    activity: "النشاط",
    members: "الأعضاء",
    spaces: "المساحات",
    workers: "الوركرز",
    agents: "مفاتيح الوكلاء",
    files: "الملفات",
    data: "البيانات",
    visits: "الزيارات",
    mcp: "MCP",
    worker: "وركر",
    space: "مساحة",
    team: "الفريق",
    status: "الحالة",
    liveUrl: "الرابط المباشر",
    mcpUrl: "عنوان MCP",
    mcpDetected: "مكتشف في الكود",
    open: "افتح",
    copy: "انسخ",
    copied: "تم النسخ",
    lastDeploy: "آخر نشر",
    by: "بواسطة",
    size: "الحجم",
    sha: "SHA-256",
    version: "الإصدار",
    noVersion: "لا يوجد إصدار محفوظ بعد: يُحفظ النشر القادم.",
    varNames: "المتغيرات",
    secretNames: "الأسرار",
    none: "لا شيء",
    health: "فحص الصحة",
    healthOk: (code: number, ms: number) => `HTTP ${code} خلال ${ms} مللي ثانية`,
    healthFail: (ms: number) => `لا رد (${ms} مللي ثانية)`,
    healthOff: "لم يُفحص: الوركر غير نشط.",
    requests: "الطلبات",
    requests7: "الطلبات، ٧ أيام",
    requestsNA:
      "غير متاح: مساحات لا تقرأ إحصاءات كلاودفلير. تظهر الأرقام هنا عند استخدام مفاتيح API.",
    requestsKeys: (today: string, week: string) =>
      `${today} اليوم · ${week} في ٧ أيام (مفاتيح API)`,
    created: "أُنشئ",
    updated: "حُدّث",
    script: "السكربت",
    lastError: "آخر خطأ",
    redeploy: "أعد النشر",
    newCode: "انشر كودًا جديدًا",
    envTitle: "متغيرات البيئة",
    envHelp: "NAME=value في كل سطر. الحفظ يعيد نشر الكود الحالي بهذه المتغيرات (يُسجَّل كإصدار جديد).",
    saveEnv: "احفظ المتغيرات",
    secretsTitle: "الأسرار",
    runtimeTitle: "بيئة التشغيل والربط",
    runtimeHelp:
      "إعدادات التوافق في كلاودفلير والربط المباشر (service bindings) مع وركرز أخرى من نفس الفريق. الحفظ يعيد نشر الكود الحالي، ولا يغيّر الوركرز المربوطة.",
    compatDate: "تاريخ التوافق",
    platformDefault: "(الافتراضي للمنصة)",
    compatDateHelp: "فارغ = الافتراضي للمنصة.",
    compatFlags: "أعلام التوافق",
    flagHelp: {
      global_fetch_strictly_public:
        "fetch() لعنوان عام يخرج عبر الإنترنت حتى لو على نفس النطاق (لاستدعاء وركر آخر من الفريق برابطه).",
      nodejs_compat: "واجهات Node.js ‏(node:buffer و node:crypto …).",
      nodejs_als: "AsyncLocalStorage فقط.",
    } as Record<string, string>,
    bindingsTitle: "الربط بين الوركرز",
    bindingsHelp: (names: string) =>
      `سطر لكل ربط: NAME=worker. وركرز هذا الفريق فقط${names ? ` (${names})` : ""}. في الكود: env.NAME.fetch(request).`,
    saveRuntime: "احفظ إعدادات التشغيل",
    secretsHelp:
      "NAME=value للإضافة أو الاستبدال، وNAME= فارغة للحذف. القيم للكتابة فقط وتذهب مباشرة إلى كلاودفلير. الحفظ يعيد نشر الكود الحالي.",
    saveSecrets: "احفظ الأسرار",
    removeSecret: "احذف",
    removeSecretConfirm: (n: string) => `تحذف السر ${n}؟ يُعاد نشر الوركر بدونه.`,
    needVersion: "انشر الكود مرة من صفحة الوركرز ليُحفظ، ثم يمكنك تعديله هنا.",
    disable: "أوقف",
    enable: "شغّل",
    disableHelp: "يوقف الوركر (يتوقف عنوانه عن الرد) دون حذفه.",
    disableConfirm: "توقف هذا الوركر؟ يتوقف عنوانه عن الرد حتى تشغيله مجددًا.",
    disabledByAdmin: "أوقف المسؤول هذا الوركر، ولا يشغّله إلا المسؤول.",
    deleteWorker: "احذف هذا الوركر",
    deleteWorkerHelp: "يحذف السكربت وعنوانه وإصداراته ومفاتيح API الخاصة به.",
    danger: "منطقة الخطر",
    readOnly: "للعرض فقط بحسب دورك.",
    adminReadOnly: "عرض المسؤول: تغييرات الكود تتم من لوحة الفريق أو الـ API.",
    noActivity: "لا نشاط لهذا بعد.",
    noVersions: "لا إصدارات محفوظة بعد.",
    download: "نزّل الكود",
    rollback: "ارجع لهذا الإصدار",
    current: "الحالي",
    keysOff: "مفاتيح API متوقفة لهذا الوركر.",
    keysCount: (n: number) => (n === 1 ? "مفتاح فعّال واحد" : `${n} مفاتيح فعّالة`),
    keyPrefix: "مفتاح الفريق",
    liveSpaces: "المساحات المنشورة",
    storage: "التخزين",
    visits7: "المشاهدات، ٧ أيام",
    visits30: "المشاهدات، ٣٠ يومًا",
    features: "الميزات",
    backend: "البيانات والملفات",
    home: "في الصفحة الرئيسية",
    permanent: "روابط دائمة",
    workersFeature: "الوركرز",
    quota: "الحصص",
    quotaSites: "أقصى عدد مساحات",
    quotaMb: "أقصى ميغابايت",
    quotaHelp: "فارغ = الافتراضي للمنصة.",
    rename: "الاسم",
    saveTeam: "احفظ",
    invite: "أنشئ رابط دعوة",
    role: "الدور",
    roles: { owner: "مالك", editor: "محرر", viewer: "مشاهد" } as Record<string, string>,
    changeRole: "اجعله",
    remove: "أزل",
    removeConfirm: (n: string) => `تزيل ${n} من الفريق؟ تنتهي جلساته فورًا.`,
    member: "العضو",
    lastLogin: "آخر دخول",
    joined: "انضم",
    noMembers: "لا أعضاء بعد. يدخل الفريق بمفتاح الفريق أو رابط دعوة.",
    rotate: "أصدر مفتاح فريق جديدًا",
    rotateHelp: "يتوقف المفتاح القديم فورًا، وتنتهي الجلسات والوكلاء الذين يستخدمونه.",
    rotateConfirm: "تصدر مفتاح فريق جديدًا؟ يتوقف الحالي فورًا.",
    deleteTeam: "احذف هذا الفريق",
    workersOn: "الوركرز مفعّلة",
    workersSlug: "الاسم المختصر",
    maxWorkers: "أقصى عدد وركرز",
    maxKb: "أقصى KB",
    saveWorkers: "احفظ إعدادات الوركرز",
    turnOffWorkers: "إيقاف الوركرز يحذف كل وركرز الفريق.",
    keyName: "المفتاح",
    prefix: "البادئة",
    revokeKey: "ألغِ",
    revokeKeyConfirm: "تلغي هذا المفتاح؟ تتوقف الطلبات به فورًا.",
    scopes: "الصلاحيات",
    expires: "ينتهي",
    lastUsed: "آخر استخدام",
    noAgentKeys: "لا مفاتيح وكلاء.",
    noSpaces: "لا مساحات منشورة.",
    noWorkers: "لا وركرز.",
    keyStates: { active: "فعّال", revoked: "ملغى", expired: "منتهٍ" } as Record<string, string>,
    previewAlt: (t: string) => `معاينة ${t}`,
    link: "الرابط",
    expiry: "الانتهاء",
    capped: "يمكن التمديد حتى",
    owner: "المالك",
    guest: "زائر",
    live: "منشورة",
    listedYes: "معروضة",
    listedNo: "مخفية",
    editToken: "رمز التعديل",
    tokenHelp:
      "رمز التعديل يسمح للسكربتات بتحديث هذه المساحة أو حذفها عبر الـ API. أصدر رمزًا جديدًا إن تسرّب؛ يتوقف القديم فورًا.",
    regenerate: "أصدر رمز تعديل جديدًا",
    regenerateConfirm: "تصدر رمز تعديل جديدًا؟ يتوقف الحالي فورًا.",
    tokenNew: "رمز التعديل الجديد",
    tokenDone: "صدر رمز تعديل جديد. انسخه الآن: يظهر مرة واحدة.",
    deleteSpace: "احذف هذه المساحة",
    deleteSpaceHelp: "يحذف ملفاتها وبياناتها وعدّاد زياراتها، ويتوقف الرابط فورًا.",
    filesCount: (n: number) => (n === 1 ? "ملف واحد" : `${n} ملفات`),
    path: "المسار",
    kvKeys: "مفاتيح KV",
    key: "المفتاح",
    value: "القيمة",
    deleteKey: "احذف",
    noKv: "لا مفاتيح KV.",
    uploads: "الملفات المرفوعة",
    noUploads: "لا ملفات مرفوعة.",
    moreKeys: (n: number) => `${n} مفاتيح أخرى (الأسماء فقط)`,
    dataOff: "البيانات والملفات متوقفة لهذه المساحة.",
    grantPermanent: "اجعلها دائمة",
    revokePermanent: "ألغِ الديمومة",
    confirm: "هل أنت متأكد؟",
    secretsNote: "لا تخزّن مساحات قيم الأسرار أبدًا؛ الإصدارات تسجّل أسماءها فقط.",
  },
};
const _arHasAll: typeof DX.en = DX.ar;
void _arHasAll;

const num = (lang: Lang, n: number) => n.toLocaleString(lang === "ar" ? "ar-EG" : "en-US");
const actorName = (lang: Lang, who: string) => actorText(lang, who);
const backField = (path: string) => `<input type="hidden" name="back" value="${esc(path)}">`;
const codeList = (names: string[], lock = false) =>
  names.length
    ? `<ul class="chips">${names.map((n) => `<li><code class="ltr">${esc(n)}</code>${lock ? ' <span aria-hidden="true">🔒</span>' : ""}</li>`).join("")}</ul>`
    : "";
type Tone = "on" | "off" | "warn" | "err" | "muted" | "info";
const stateTone = (s: string): Tone => (s === "active" ? "on" : s === "revoked" ? "muted" : "warn");

export function workerStatusBadge(lang: Lang, st: string): string {
  return badge(
    WS[lang].statuses[st] ?? st,
    st === "active" ? "on" : st === "disabled" ? "muted" : st === "failed" ? "err" : "warn",
  );
}

function copyLine(lang: Lang, id: string, label: string, value: string, link = true): string {
  const x = DX[lang];
  const shown = link
    ? `<a id="${id}" class="strong-link" href="${esc(value)}" target="_blank" rel="noopener" dir="ltr">${esc(hostless(value))}</a>`
    : `<code id="${id}" dir="ltr" class="ltr">${esc(value)}</code>`;
  const copy = `<button type="button" class="icon-btn js-only" data-copy-text="${esc(value)}" data-copied="${esc(x.copied)}" aria-label="${esc(`${x.copy}: ${label}`)}" title="${esc(x.copy)}">${icon("copy")}</button>`;
  const open = link
    ? `<a class="icon-btn" href="${esc(value)}" target="_blank" rel="noopener" aria-label="${esc(`${x.open}: ${label}`)}" title="${esc(x.open)}">${icon("ext")}</a>`
    : "";
  return `<div class="copy-line"><span class="meta">${esc(label)}</span> ${shown}${copy}${open}</div>`;
}

function dangerRow(title: string, help: string, control: string): string {
  return `<div class="danger-row"><div><strong>${esc(title)}</strong><p class="meta">${esc(help)}</p></div>${control}</div>`;
}

function activityBlock(lang: Lang, audit: AuditView[], withSite: boolean, title?: string): string {
  const x = DX[lang];
  return `<section class="block" aria-labelledby="act-title"><h2 id="act-title" class="h3">${esc(title ?? x.activity)}</h2>${
    audit.length
      ? auditTable(lang, audit, withSite, "act-title")
      : `<p class="meta">${esc(x.noActivity)}</p>`
  }</section>`;
}

function detailBody(head: string, flash: string, tabs: string, body: string): string {
  return `<div class="page-wide detail-page">${head}${flash}${tabs}<div class="tab-panel">${body}</div></div>`;
}

// ---- Worker detail -------------------------------------------------------------------------

export const WORKER_TABS = [
  "overview",
  "env",
  "health",
  "logs",
  "usage",
  "versions",
  "keys",
  "settings",
  "activity",
] as const;
type OpsTab = "env" | "health" | "logs" | "usage";
const isOpsTab = (k: string): k is OpsTab =>
  k === "env" || k === "health" || k === "logs" || k === "usage";

type RuntimeView = Pick<
  WorkerView,
  "compatibilityDate" | "compatibilityDateSet" | "compatibilityFlags" | "bindings"
>;

export interface WorkerDetailOpts {
  kind: "team" | "admin";
  tab: string;
  /** Path of the page without the language prefix, e.g. /team/workers/api */
  base: string;
  team: { id: string; name: string };
  ctx: DashCtx;
  csrf: string;
  flash?: Flash | null;
  worker: WorkerRowView & {
    script: string;
    createdAt: string;
    updatedAt: string;
    logs?: boolean;
  } & RuntimeView;
  disabledBy: "admin" | "team" | null;
  versions: VersionMeta[];
  health: { status: number | null; ms: number } | null;
  mcp: string | null;
  keys: {
    settings: { required: boolean; perMinute: number; perDay: number; cacheSeconds: number };
    keys: UserKeyView[];
    verifyUrl: string;
    helperUrl: string;
  };
  audit: AuditView[];
  /** Names of the team's Workers (for the bindings help). */
  teamWorkers?: string[];
  /** 0.15.1: type/stack/tools/repo/space, and the team's spaces for manual linking. */
  insight?: InsightRow;
  spaces?: { id: string; title: string }[];
  /** Owner/editor on the team side, or the admin. */
  canEdit: boolean;
  /** 0.15.2: data for the env / health / logs / usage tabs (only the open tab's is loaded). */
  ops?: {
    env?: EnvView;
    health?: HealthView;
    logs?: LogsResult;
    usage?: { range: UsageRange; series: UsageSeries; keys: KeyUsageRow[] };
    prefill?: string;
    /** 0.16.0: declared health path / expected status (prefill). */
    healthTarget?: { path: string; expect: string };
    /** Health summary for the overview. */
    healthCell?: { state: HealthView["state"]; d7: number | null };
  };
}

export function workerDetailHtml(lang: Lang, c: Config, o: WorkerDetailOpts): string {
  const x = DX[lang];
  const t = STRINGS[lang];
  const href = (p: string) => localePath(lang, p);
  const w = o.worker;
  const admin = o.kind === "admin";
  const tab = (WORKER_TABS as readonly string[]).includes(o.tab) ? o.tab : "overview";
  const self = href(`${o.base}${tab === "overview" ? "" : `?tab=${tab}`}`);
  const teamBase = `/team/workers/${w.name}`;
  const latest = o.versions[0] ?? null;
  const activeKeys = o.keys.keys.filter((kk) => kk.state === "active");
  const tabs = tabsNav(
    x.tabs,
    WORKER_TABS.map((key) => ({
      key,
      label: isOpsTab(key) ? OX[lang][key] : x[key],
      href: href(`${o.base}${key === "overview" ? "" : `?tab=${key}`}`),
      count:
        key === "versions" ? o.versions.length : key === "keys" ? activeKeys.length : undefined,
    })),
    tab,
  );
  const teamEdit = !admin && o.canEdit;
  const headActions = [
    w.url && w.status === "active"
      ? `<a class="button small" href="${esc(w.url)}" target="_blank" rel="noopener">${icon("ext")}${esc(x.open)}</a>`
      : "",
    o.insight?.kind === "mcp" && w.status === "active" && (admin || o.canEdit)
      ? postForm(
          href(admin ? `/admin/workers/${w.id}/probe` : `${teamBase}/probe`),
          o.csrf,
          `${backField(self)}<button class="button small ghost" type="submit" data-busy>${icon("redeploy")}${esc(IX[lang].refresh)}</button>`,
        )
      : "",
    teamEdit && w.version
      ? postForm(
          href(`${teamBase}/redeploy`),
          o.csrf,
          `${backField(self)}<button class="button small ghost" type="submit" data-busy>${icon("redeploy")}${esc(x.redeploy)}</button>`,
        )
      : "",
    teamEdit
      ? `<a class="button small ghost" href="${href("/team/workers")}#deploy">${esc(x.newCode)}</a>`
      : "",
  ].join("");
  const head = `<div class="detail-head"><div class="detail-title"><p class="eyebrow">${esc(x.worker)}${admin ? ` · <bdi>${esc(o.team.name)}</bdi>` : ""}</p><h1><code class="ltr">${esc(w.name)}</code> ${workerStatusBadge(lang, w.status)}${w.version ? ` ${badge(`v${w.version}`, "info")}` : ""}</h1>
  <div class="detail-links">${w.url ? copyLine(lang, "w-url", x.liveUrl, w.url) : ""}${o.mcp ? copyLine(lang, "w-mcp", `${x.mcpUrl} (${x.mcpDetected})`, o.mcp, false) : ""}</div></div>
  <div class="detail-actions">${headActions}</div></div>`;
  let body: string;
  const opsCtx: OpsTabCtx = {
    lang,
    csrf: o.csrf,
    self,
    act: (what) => href(admin ? `/admin/workers/${w.id}/${what}` : `${teamBase}/${what}`),
    canEdit: o.canEdit,
    canVars: o.canEdit && !!w.version,
    ...(o.ops?.prefill ? { prefill: o.ops.prefill } : {}),
    ...(o.ops?.healthTarget ? { healthTarget: o.ops.healthTarget } : {}),
  };
  if (tab === "env" && o.ops?.env) body = envTab(opsCtx, o.ops.env);
  else if (tab === "health" && o.ops?.health)
    body = healthTab(opsCtx, o.ops.health, w.status === "active" && !!w.url);
  else if (tab === "logs" && o.ops?.logs) body = logsTab(opsCtx, !!w.logs, o.ops.logs);
  else if (tab === "usage" && o.ops?.usage)
    body = usageTab(opsCtx, o.ops.usage.range, o.ops.usage.series, o.ops.usage.keys, (r) =>
      href(`${o.base}?tab=usage&range=${r}`),
    );
  else if (tab === "versions") body = workerVersionsTab(lang, o, self, teamBase);
  else if (tab === "keys") body = workerKeysTab(lang, o, self, teamBase);
  else if (tab === "settings") body = workerSettingsTab(lang, o, self, teamBase);
  else if (tab === "activity") body = activityBlock(lang, o.audit, false);
  else {
    const reqs = o.keys.keys.length
      ? x.requestsKeys(
          num(
            lang,
            o.keys.keys.reduce((n, kk) => n + kk.usage.today, 0),
          ),
          num(
            lang,
            o.keys.keys.reduce((n, kk) => n + kk.usage.last7d, 0),
          ),
        )
      : x.requestsNA;
    const h = o.health;
    const health = !h
      ? `<span class="meta">${esc(x.healthOff)}</span>`
      : h.status !== null
        ? `<span class="health">${badge(String(h.status), h.status < 400 ? "on" : h.status < 500 ? "warn" : "err")} ${esc(x.healthOk(h.status, h.ms))}</span>`
        : `<span class="health">${badge("—", "err")} ${esc(x.healthFail(h.ms))}</span>`;
    const fact = (label: string, html: string) =>
      `<div><dt>${esc(label)}</dt><dd>${html}</dd></div>`;
    body = `<dl class="facts-grid">
      ${fact(x.lastDeploy, w.deployedAt ? `${timeTag(lang, w.deployedAt)} <span class="meta">${esc(x.by)} <bdi>${esc(actorName(lang, w.deployedBy))}</bdi></span>` : "—")}
      ${fact(x.version, latest ? `v${latest.n} · ${esc(V14[lang].actions[latest.action] ?? latest.action)}${latest.note ? ` <span class="meta"><bdi>${esc(detailText(lang, latest.note))}</bdi></span>` : ""}` : `<span class="meta">${esc(x.noVersion)}</span>`)}
      ${fact(x.size, esc(bytesLabel(lang, w.bytes)))}
      ${fact(x.sha, latest ? `<code class="ltr" title="${esc(latest.sha256)}">${esc(latest.sha256.slice(0, 16))}…</code>` : "—")}
      ${fact(x.health, `${health}${o.ops?.healthCell ? ` · ${healthCellHtml(lang, o.ops.healthCell)}` : ""}`)}
      ${fact(x.requests, esc(reqs))}
      ${fact(x.varNames, codeList(Object.keys(w.vars)) || `<span class="meta">${esc(x.none)}</span>`)}
      ${fact(x.secretNames, codeList(w.secrets, true) || `<span class="meta">${esc(x.none)}</span>`)}
      ${o.insight ? insightFacts(lang, o.insight, fact, o.keys.settings.required) : ""}
      ${runtimeFacts(lang, w, fact)}
      ${fact(x.keys, o.keys.settings.required ? `${badge(K14[lang].on, "on")} ${esc(x.keysCount(activeKeys.length))}` : badge(K14[lang].off, "muted"))}
      ${fact(x.script, `<code class="ltr">${esc(w.script)}</code>`)}
      ${fact(x.created, timeTag(lang, w.createdAt))}
      ${fact(x.updated, timeTag(lang, w.updatedAt))}
    </dl>${w.lastError ? `<p class="flash err" role="alert">${esc(x.lastError)}: ${esc(w.lastError)}</p>` : ""}
    ${activityBlock(lang, o.audit.slice(0, 5), false)}`;
  }
  const crumbs = admin
    ? [
        { label: o.team.name, href: href(`/admin/teams/${o.team.id}?tab=workers`) },
        { label: w.name },
      ]
    : [{ label: w.name }];
  return dashLayout({
    lang,
    config: c,
    kind: o.kind,
    active: "workers",
    title: `${w.name} · ${isOpsTab(tab) ? OX[lang][tab] : x[tab as Exclude<(typeof WORKER_TABS)[number], OpsTab>]} · ${t.product}`,
    description: x.worker,
    path: `${o.base}${tab === "overview" ? "" : `?tab=${tab}`}`,
    body: detailBody(head, flashBox(lang, o.flash), tabs, body),
    csrf: o.csrf,
    ctx: o.ctx,
    crumbs,
  });
}

function workerVersionsTab(
  lang: Lang,
  o: WorkerDetailOpts,
  self: string,
  teamBase: string,
): string {
  const x = DX[lang];
  const v = V14[lang];
  const href = (p: string) => localePath(lang, p);
  const w = o.worker;
  const admin = o.kind === "admin";
  const rows: DtRow[] = o.versions.map((vv) => {
    const isCur = vv.n === w.version;
    const acts: DtAction[] = [];
    if (o.canEdit)
      acts.push({
        kind: "link",
        label: x.download,
        href: href(`${admin ? o.base : teamBase}/versions/${vv.n}/code`),
        icon: "download",
        primary: true,
      });
    if (!admin && o.canEdit && !isCur)
      acts.push({
        kind: "post",
        label: x.rollback,
        action: href(`${teamBase}/rollback`),
        icon: "redeploy",
        confirm: v.rollbackConfirm(vv.n),
        hidden: { version: String(vv.n), back: self },
      });
    const env = [
      ...vv.varNames.map((n) => `<code class="ltr">${esc(n)}</code>`),
      ...vv.secretNames.map(
        (n) => `<code class="ltr">${esc(n)}</code> <span aria-hidden="true">🔒</span>`,
      ),
    ].join(" ");
    return {
      label: `v${vv.n}`,
      head: `<strong>v${vv.n}</strong>${isCur ? ` ${badge(x.current, "on")}` : ""}`,
      headV: String(vv.n).padStart(6, "0"),
      cells: [
        { html: relTime(vv.at, lang), v: vv.at },
        { html: `<bdi>${esc(actorName(lang, vv.by))}</bdi>`, v: vv.by.toLowerCase() },
        {
          html: `${esc(v.actions[vv.action] ?? vv.action)}${vv.from ? ` <span class="meta">${esc(v.rolledFrom(vv.from))}</span>` : ""}${vv.note ? `<div class="meta"><bdi>${esc(detailText(lang, vv.note))}</bdi></div>` : ""}`,
        },
        { html: esc(bytesLabel(lang, vv.bytes)), v: vv.bytes, cls: "num" },
        {
          html: `<code class="ltr" title="${esc(vv.sha256)}">${esc(vv.sha256.slice(0, 10))}</code>`,
        },
        { html: env || "—" },
      ],
      actions: acts,
      filters: { action: vv.action },
    };
  });
  return `<p class="meta">${esc(x.secretsNote)}</p>${dataTable({
    lang,
    id: "versions-table",
    caption: x.versions,
    headLabel: x.version,
    cols: [
      { label: v.when, sort: "date" },
      { label: v.who, sort: "text" },
      { label: v.action },
      { label: x.size, sort: "num" },
      { label: x.sha },
      { label: v.env },
    ],
    rows,
    csrf: o.csrf,
    empty: x.noVersions,
    filters: [
      {
        key: "action",
        label: v.action,
        options: [...new Set(o.versions.map((vv) => vv.action))].map(
          (a) => [a, v.actions[a] ?? a] as [string, string],
        ),
      },
    ],
    pageSize: 10,
  })}`;
}

function workerKeysTab(lang: Lang, o: WorkerDetailOpts, self: string, teamBase: string): string {
  const x = DX[lang];
  const k = K14[lang];
  const href = (p: string) => localePath(lang, p);
  const admin = o.kind === "admin";
  const base = `${teamBase}/keys`;
  const rows: DtRow[] = o.keys.keys.map((kk) => ({
    label: kk.label,
    head: `<strong><bdi>${esc(kk.label)}</bdi></strong>${kk.email ? `<div class="meta"><bdi dir="ltr">${esc(kk.email)}</bdi></div>` : ""}`,
    headV: kk.label,
    cells: [
      { html: `<code class="ltr">${esc(kk.prefix)}…</code>` },
      { html: badge(k.state[kk.state] ?? kk.state, stateTone(kk.state)), v: kk.state },
      {
        html: esc(
          `${kk.perMinute ? num(lang, kk.perMinute) : "—"} / ${kk.perDay ? num(lang, kk.perDay) : "—"}`,
        ),
      },
      {
        html: `<strong>${num(lang, kk.usage.today)}</strong> · ${num(lang, kk.usage.last7d)}`,
        v: kk.usage.last7d,
        cls: "num",
      },
      {
        html: kk.usage.limited7d ? badge(num(lang, kk.usage.limited7d), "warn") : "0",
        v: kk.usage.limited7d,
        cls: "num",
      },
      {
        html: kk.tools.length
          ? kk.tools.map((tl) => `<code class="ltr scope">${esc(tl)}</code>`).join(" ")
          : `<span class="meta">—</span>`,
      },
      { html: relTime(kk.lastUsedAt, lang), v: kk.lastUsedAt ?? "" },
      {
        html: kk.expiresAt
          ? relTime(kk.expiresAt, lang)
          : `<span class="meta">${esc(k.never)}</span>`,
        v: kk.expiresAt ?? "9999",
      },
    ],
    actions:
      !admin && o.canEdit && kk.state === "active"
        ? [
            {
              kind: "post",
              label: k.revoke,
              action: href(`${base}/${kk.id}/revoke`),
              danger: true,
              confirm: k.revokeConfirm,
              hidden: { back: self },
            },
          ]
        : [],
    filters: { status: kk.state },
  }));
  const exp = [30, 90, 365]
    .map(
      (n) =>
        `<label class="check inline"><input type="radio" name="expiresInDays" value="${n}"${n === 90 ? " checked" : ""}><span>${esc(k.days(n))}</span></label>`,
    )
    .join("");
  const create =
    !admin && o.canEdit
      ? `<details class="panel create-key"><summary class="h3">${icon("key")} ${esc(k.create)}</summary><form method="post" action="${href(base)}" class="stack-form">
      ${csrfField(o.csrf)}${backField(self)}
      <label for="uk-label">${esc(k.label)}</label><input id="uk-label" name="label" required maxlength="80" autocomplete="off">
      <label for="uk-email">${esc(k.email)}</label><input id="uk-email" name="email" type="email" maxlength="254" dir="ltr" autocomplete="off">
      <fieldset class="expiry-set"><legend>${esc(k.expiry)}</legend>${exp}<label class="check inline"><input type="radio" name="expiresInDays" value="never"><span>${esc(k.never)}</span></label></fieldset>
      <fieldset class="expiry-set"><legend>${esc(k.limits)}</legend>
        <label class="inline-field">${esc(k.perMinute)} <input class="days-input" name="perMinute" type="number" min="1" max="10000" inputmode="numeric"></label>
        <label class="inline-field">${esc(k.perDay)} <input class="days-input" name="perDay" type="number" min="1" max="10000000" inputmode="numeric"></label>
      </fieldset>
      <label for="uk-tools">${esc(k.tools)}</label><input id="uk-tools" name="tools" maxlength="2000" dir="ltr" placeholder="${esc(k.toolsPh)}" autocomplete="off">
      <button class="button" type="submit">${esc(k.create)}</button></form></details>`
      : "";
  const off = o.keys.settings.required
    ? ""
    : `<p class="notice">${esc(x.keysOff)}${!admin && o.canEdit ? ` <a class="text-link" href="${href(`${o.base}?tab=settings`)}">${esc(x.settings)}</a>` : ""}</p>`;
  const table = dataTable({
    lang,
    id: "ukeys-table",
    caption: k.keys,
    headLabel: k.label,
    cols: [
      { label: k.prefix },
      { label: k.status, sort: "text" },
      { label: `${k.perMinute} / ${k.perDay}` },
      { label: `${k.usage} (${k.today} · ${k.week})`, sort: "num" },
      { label: k.limited, sort: "num" },
      { label: k.tools },
      { label: k.lastUsed, sort: "date" },
      { label: k.expiry, sort: "date" },
    ],
    rows,
    csrf: o.csrf,
    empty: k.noKeys,
    filters: [
      {
        key: "status",
        label: k.status,
        options: (["active", "revoked", "expired"] as const)
          .filter((s) => o.keys.keys.some((kk) => kk.state === s))
          .map((s) => [s, k.state[s] ?? s] as [string, string]),
      },
    ],
  });
  const helper = `<section class="block panel" aria-labelledby="uk-helper"><h2 id="uk-helper" class="h3">${esc(k.helper)}</h2><p class="meta">${esc(k.helperText)} ${esc(k.cache(o.keys.settings.cacheSeconds))}</p><p>${esc(k.verify)}: <code class="ltr">${esc(o.keys.verifyUrl)}</code></p><pre tabindex="0" class="ltr" dir="ltr"><code>curl -s ${esc(o.keys.helperUrl)} &gt; marsa-keys.js
const gate = await requireKey(request, env, { tool });
if (!gate.ok) return gate.response;</code></pre></section>`;
  return `${off}${table}${create}${helper}`;
}

function insightFacts(
  lang: Lang,
  i: InsightRow,
  fact: (label: string, html: string) => string,
  keysOn: boolean,
): string {
  const ix = IX[lang];
  const tools =
    i.kind === "mcp"
      ? `${toolsCell(lang, i)}${
          i.toolNames.length
            ? `<ul class="chips">${i.toolNames
                .slice(0, 30)
                .map((n) => `<li><code class="ltr">${esc(n)}</code></li>`)
                .join("")}</ul>`
            : ""
        }${i.probeNote ? `<div class="meta">${esc(ix.probeNotes[i.probeNote] ?? i.probeNote)}</div>` : ""}${i.probeAt ? `<div class="meta">${esc(ix.probeAt)} ${relTime(i.probeAt, lang)}</div>` : ""}`
      : `<span class="meta">—</span>`;
  return [
    fact(ix.type, kindBadge(lang, i)),
    fact(ix.stack, stackCell(lang, i)),
    fact(ix.tools, tools),
    fact(ix.protected, badge(keysOn ? ix.yes : ix.no, keysOn ? "on" : "muted")),
    fact(ix.repo, repoCell(lang, i)),
    fact(
      ix.space,
      i.space
        ? `<a class="text-link" href="${esc(localePath(lang, i.space.href))}"><bdi>${esc(i.space.title)}</bdi></a>`
        : `<span class="meta">${esc(ix.spaceNone)}</span>`,
    ),
  ].join("");
}

function runtimeFacts(
  lang: Lang,
  w: RuntimeView,
  fact: (label: string, html: string) => string,
): string {
  const x = DX[lang];
  const none = `<span class="meta">${esc(x.none)}</span>`;
  return [
    fact(
      x.compatDate,
      `<code class="ltr">${esc(w.compatibilityDate)}</code>${w.compatibilityDateSet ? "" : ` <span class="meta">${esc(x.platformDefault)}</span>`}`,
    ),
    fact(x.compatFlags, codeList(w.compatibilityFlags) || none),
    fact(
      x.bindingsTitle,
      w.bindings.length
        ? `<ul class="chips">${w.bindings.map((b) => `<li><code class="ltr">${esc(b.name)} → ${esc(b.worker)}</code></li>`).join("")}</ul>`
        : none,
    ),
  ].join("");
}

function workerSettingsTab(
  lang: Lang,
  o: WorkerDetailOpts,
  self: string,
  teamBase: string,
): string {
  const x = DX[lang];
  const k = K14[lang];
  const href = (p: string) => localePath(lang, p);
  const w = o.worker;
  const admin = o.kind === "admin";
  const st = o.keys.settings;
  const editable = o.canEdit && !admin;
  const dis = editable ? "" : " disabled";
  const keysForm = `<form method="post" action="${href(`${teamBase}/keys/settings`)}" class="panel stack-form">
    ${csrfField(o.csrf)}${backField(self)}
    <h2 class="h3">${icon("shield")} ${esc(k.require)} ${badge(st.required ? k.on : k.off, st.required ? "on" : "muted")}</h2>
    <p class="meta">${esc(k.requireHelp)}</p>
    <label class="check"><input type="checkbox" name="required" value="on"${st.required ? " checked" : ""}${dis}><span>${esc(k.require)}</span></label>
    <fieldset class="expiry-set"><legend>${esc(k.defaults)}</legend>
      <label class="inline-field">${esc(k.perMinute)} <input class="days-input" name="perMinute" type="number" min="1" max="10000" value="${st.perMinute}" inputmode="numeric"${dis}></label>
      <label class="inline-field">${esc(k.perDay)} <input class="days-input" name="perDay" type="number" min="1" max="10000000" value="${st.perDay}" inputmode="numeric"${dis}></label>
    </fieldset>
    ${editable ? `<button class="button small" type="submit">${esc(k.saveSettings)}</button>` : ""}
  </form>`;
  const canChange = editable && !!w.version;
  const off = w.status === "disabled";
  const lockedByAdmin = off && o.disabledBy === "admin" && !admin;
  const toggleAction = admin
    ? href(`/admin/workers/${w.id}/${off ? "enable" : "disable"}`)
    : href(`${teamBase}/${off ? "enable" : "disable"}`);
  const toggle = lockedByAdmin
    ? `<span class="badge muted">${esc(x.disabledByAdmin)}</span>`
    : postForm(
        toggleAction,
        o.csrf,
        `${backField(self)}<button class="button small${off ? "" : " warn"}" type="submit">${icon("power")}${esc(off ? x.enable : x.disable)}</button>`,
        off ? {} : { confirm: x.disableConfirm },
      );
  const delBack = admin ? backField(href(`/admin/teams/${o.team.id}?tab=workers`)) : "";
  const danger = o.canEdit
    ? `<section class="danger-zone" aria-labelledby="dz-title"><h2 id="dz-title" class="h3">${esc(x.danger)}</h2>
    ${dangerRow(off ? x.enable : x.disable, lockedByAdmin ? x.disabledByAdmin : x.disableHelp, toggle)}
    ${dangerRow(
      x.deleteWorker,
      x.deleteWorkerHelp,
      postForm(
        admin ? href(`/admin/workers/${w.id}/delete`) : href(`${teamBase}/delete`),
        o.csrf,
        `${delBack}<button class="button small danger" type="submit">${icon("trash")}${esc(WS[lang].del)}</button>`,
        { confirm: WS[lang].confirmDelete },
      ),
    )}
  </section>`
    : `<p class="notice">${esc(x.readOnly)}</p>`;
  if (admin) {
    const fact = (label: string, html: string) =>
      `<div><dt>${esc(label)}</dt><dd>${html}</dd></div>`;
    const ro = `<dl class="facts-grid">
      ${fact(k.require, badge(st.required ? k.on : k.off, st.required ? "on" : "muted"))}
      ${fact(`${k.perMinute} / ${k.perDay}`, esc(`${num(lang, st.perMinute)} / ${num(lang, st.perDay)}`))}
      ${fact(x.envTitle, codeList(Object.keys(w.vars)) || `<span class="meta">${esc(x.none)}</span>`)}
      ${fact(x.secretsTitle, codeList(w.secrets, true) || `<span class="meta">${esc(x.none)}</span>`)}
      ${runtimeFacts(lang, w, fact)}
    </dl>`;
    return `<p class="notice">${esc(x.adminReadOnly)}</p>${ro}${danger}`;
  }
  const flagSet = new Set(w.compatibilityFlags);
  const flagBoxes = ALLOWED_COMPAT_FLAGS.map(
    (f) =>
      `<label class="check"><input type="checkbox" name="compatibilityFlags" value="${f}"${flagSet.has(f) ? " checked" : ""}${canChange ? "" : " disabled"}><span><code class="ltr">${f}</code><small class="meta">${esc(x.flagHelp[f] ?? "")}</small></span></label>`,
  ).join("");
  const others = (o.teamWorkers ?? []).filter((n) => n !== w.name).join(", ");
  const runtimeForm = `<form method="post" action="${href(`${teamBase}/runtime`)}" class="panel stack-form">
    ${csrfField(o.csrf)}${backField(self)}
    <h2 class="h3">${esc(x.runtimeTitle)}</h2>
    <p class="meta">${esc(x.runtimeHelp)}</p>
    <label class="field">${esc(x.compatDate)} <input type="date" name="compatibilityDate" dir="ltr" value="${w.compatibilityDateSet ? esc(w.compatibilityDate) : ""}" placeholder="${esc(w.compatibilityDate)}"${canChange ? "" : " disabled"}><small class="meta">${esc(x.compatDateHelp)}</small></label>
    <fieldset class="expiry-set"><legend>${esc(x.compatFlags)}</legend>${flagBoxes}</fieldset>
    <label for="wd-bindings">${esc(x.bindingsTitle)}</label>
    <textarea id="wd-bindings" name="bindings" rows="3" dir="ltr" spellcheck="false" class="code-input" placeholder="NEWS=news"${canChange ? "" : " disabled"}>${esc(w.bindings.map((b) => `${b.name}=${b.worker}`).join("\n"))}</textarea>
    <p class="meta">${esc(x.bindingsHelp(others))}</p>
    <input type="hidden" name="runtime" value="1">
    ${canChange ? `<button class="button small" type="submit" data-busy>${esc(x.saveRuntime)}</button>` : editable ? `<p class="meta">${esc(x.needVersion)}</p>` : ""}
  </form>`;
  const ix = IX[lang];
  const ins = o.insight;
  const meta =
    (w as { meta?: { kind?: string; language?: string; framework?: string } }).meta ?? {};
  const opt = (v: string, label: string, cur: string | undefined) =>
    `<option value="${esc(v)}"${cur === v ? " selected" : ""}>${esc(label)}</option>`;
  const linksForm = editable
    ? `<form method="post" action="${href(`${teamBase}/links`)}" class="panel stack-form">
    ${csrfField(o.csrf)}${backField(self)}
    <h2 class="h3">${icon("repo")} ${esc(ix.linksTitle)}</h2>
    <p class="meta">${esc(ix.linksHelp)}</p>
    <label class="field">${esc(ix.repoUrl)} <input name="repoUrl" type="url" dir="ltr" placeholder="https://github.com/org/repo" value="${esc(ins?.repo?.url ?? "")}"></label>
    <div class="inline-fields"><label class="field">${esc(ix.branch)} <input name="branch" dir="ltr" placeholder="main" value="${esc(ins?.repo?.branch ?? "")}"></label>
    <label class="field">${esc(ix.commit)} <input name="commitSha" dir="ltr" pattern="[0-9a-fA-F]{7,40}" value="${esc(ins?.repo?.commitSha ?? "")}"></label></div>
    <label class="field">${esc(ix.spacePick)} <select name="spaceId">${opt("", ix.auto, ins?.space?.how === "manual" ? ins.space.id : "")}${(o.spaces ?? []).map((sp) => opt(sp.id, sp.title, ins?.space?.how === "manual" ? ins.space.id : "")).join("")}</select></label>
    <div class="inline-fields"><label class="field">${esc(ix.declaredMeta)} <select name="kind">${opt("", ix.auto, meta.kind)}${(["mcp", "web", "other"] as const).map((k) => opt(k, ix.kinds[k] ?? k, meta.kind)).join("")}</select></label>
    <label class="field">${esc(ix.stack)} <select name="language">${opt("", ix.auto, meta.language)}${(["typescript", "javascript", "python"] as const).map((k) => opt(k, ix.languages[k] ?? k, meta.language)).join("")}</select></label>
    <label class="field">${esc(ix.stackFramework)} <input name="framework" dir="ltr" placeholder="hono" maxlength="30" value="${esc(meta.framework ?? "")}"></label></div>
    <button class="button small" type="submit">${esc(ix.saveLinks)}</button>
  </form>`
    : "";
  const envLink = `<div class="panel stack-form"><h2 class="h3">${icon("key")} ${esc(OX[lang].env)}</h2><p class="meta">${esc(OX[lang].envHelp)}</p><p><a class="button small ghost" href="${esc(href(`${o.base}?tab=env`))}">${esc(OX[lang].env)}</a></p></div>`;
  return `<div class="settings-grid">${keysForm}${envLink}${runtimeForm}${linksForm}</div>${danger}`;
}

// ---- rows shared by the list pages and the detail tabs --------------------------------------

type Col = { label: string; sort?: "text" | "num" | "date" };

export interface WorkerListRow extends WorkerRowView {
  keysOn?: boolean;
  keysCount?: number;
  /** Requests in the last 7 days (from API-key usage), null when not known. */
  requests7?: number | null;
  /** 0.15.1: type, stack, tools, repo, linked space. */
  insight?: InsightRow;
  /** 0.15.2: health state + 7-day uptime, and the 24h request series (sparkline). */
  health?: { state: HealthView["state"]; d7: number | null };
  spark?: UsageSeries | null;
}

/** Rows of a Workers table (team list, admin list, admin team detail). */
export function workerRows(
  lang: Lang,
  list: WorkerListRow[],
  opts: {
    detail: (w: WorkerListRow) => string;
    admin: boolean;
    canEdit: boolean;
    showTeam?: boolean;
    teamHref?: (w: WorkerListRow) => string;
    back?: string;
    /** Workers the dashboard must never change (shown read-only). */
    locked?: (w: WorkerListRow) => boolean;
  },
): { rows: DtRow[]; cols: Col[] } {
  const withOps = list.some((r) => r.health !== undefined);
  const x = DX[lang];
  const ws = WS[lang];
  const href = (p: string) => localePath(lang, p);
  const hb = opts.back ? { back: opts.back } : undefined;
  const rows: DtRow[] = list.map((r) => {
    const locked = opts.locked?.(r) ?? false;
    const acts: DtAction[] = [{ kind: "link", label: x.open, href: opts.detail(r), primary: true }];
    if (r.url) acts.push({ kind: "copy", label: x.copy, value: r.url, primary: true });
    if (r.url) acts.push({ kind: "link", label: x.liveUrl, href: r.url, external: true });
    if (!locked && !opts.admin && opts.canEdit && r.version)
      acts.push({
        kind: "post",
        label: x.redeploy,
        action: href(`/team/workers/${r.name}/redeploy`),
        icon: "redeploy",
        ...(hb ? { hidden: hb } : {}),
      });
    if (!locked && !opts.admin && opts.canEdit)
      acts.push({
        kind: "link",
        label: x.newCode,
        href: href(`/team/workers?redeploy=${encodeURIComponent(r.name)}#deploy`),
        icon: "plus",
      });
    if (!locked && opts.admin && opts.canEdit)
      acts.push({
        kind: "post",
        label: r.status === "disabled" ? x.enable : x.disable,
        action: href(`/admin/workers/${r.id}/${r.status === "disabled" ? "enable" : "disable"}`),
        icon: "power",
        ...(r.status === "disabled" ? {} : { confirm: x.disableConfirm }),
        ...(hb ? { hidden: hb } : {}),
      });
    if (!locked && opts.canEdit)
      acts.push({
        kind: "post",
        label: ws.del,
        action: opts.admin
          ? href(`/admin/workers/${r.id}/delete`)
          : href(`/team/workers/${r.name}/delete`),
        danger: true,
        confirm: ws.confirmDelete,
        ...(hb ? { hidden: hb } : {}),
      });
    const cells = [
      { html: workerStatusBadge(lang, r.status), v: r.status },
      ...(withOps
        ? [
            {
              html: healthCellHtml(lang, r.health),
              v: `${r.health?.state ?? ""}${r.health?.d7 ?? ""}`,
            },
            {
              html: sparkCellHtml(lang, r.spark ?? undefined),
              v: r.spark?.total.requests ?? -1,
              cls: "num",
            },
          ]
        : []),
      ...(opts.showTeam
        ? [
            {
              html: r.team?.name
                ? `<a class="text-link" href="${esc(opts.teamHref?.(r) ?? "#")}"><bdi>${esc(r.team.name)}</bdi></a>`
                : "—",
              v: (r.team?.name ?? "").toLowerCase(),
            },
          ]
        : []),
      ...(r.insight
        ? [
            { html: kindBadge(lang, r.insight), v: r.insight.kind },
            { html: stackCell(lang, r.insight), v: r.insight.stack },
            { html: toolsCell(lang, r.insight), v: r.insight.toolsCount ?? -1, cls: "num" },
          ]
        : []),
      { html: r.version ? `v${r.version}` : "—", v: r.version ?? 0, cls: "num" },
      { html: esc(bytesLabel(lang, r.bytes)), v: r.bytes, cls: "num" },
      {
        html: r.keysOn
          ? `${badge(K14[lang].on, "on")} <span class="meta">${num(lang, r.keysCount ?? 0)}</span>`
          : badge(K14[lang].off, "muted"),
        v: r.keysOn ? (r.keysCount ?? 0) + 1 : 0,
      },
      {
        html:
          r.requests7 === null || r.requests7 === undefined
            ? `<span class="meta">—</span>`
            : num(lang, r.requests7),
        v: r.requests7 ?? -1,
        cls: "num",
      },
      {
        html: r.deployedAt
          ? `${relTime(r.deployedAt, lang)}<div class="meta"><bdi>${esc(actorName(lang, r.deployedBy))}</bdi></div>`
          : "—",
        v: r.deployedAt ?? "",
      },
      ...(r.insight ? [{ html: repoCell(lang, r.insight), v: repoValue(r.insight) }] : []),
    ];
    if (r.insight?.endpoint)
      acts.splice(2, 0, { kind: "copy", label: `${IX[lang].endpoint}`, value: r.insight.endpoint });
    return {
      label: r.name,
      href: opts.detail(r),
      head: `<a class="row-link" href="${esc(opts.detail(r))}"><code class="ltr">${esc(r.name)}</code></a>${r.url ? `<div class="meta url ltr" dir="ltr">${esc(hostless(r.url))}</div>` : ""}`,
      headV: r.name,
      cells,
      actions: acts,
      filters: {
        status: r.status,
        ...(r.health ? { health: r.health.state } : {}),
        ...(r.team ? { team: r.team.id } : {}),
        ...(r.insight
          ? { kind: r.insight.kind, lang: r.insight.language, repo: repoValue(r.insight) }
          : {}),
      },
    };
  });
  const cols: Col[] = [
    { label: x.status, sort: "text" },
    ...(withOps
      ? [
          { label: OX[lang].health, sort: "text" as const },
          { label: `${OX[lang].requests} · 24h`, sort: "num" as const },
        ]
      : []),
    ...(opts.showTeam ? [{ label: x.team, sort: "text" as const }] : []),
    ...(list.some((r) => r.insight)
      ? [
          { label: IX[lang].type, sort: "text" as const },
          { label: IX[lang].stack, sort: "text" as const },
          { label: IX[lang].tools, sort: "num" as const },
        ]
      : []),
    { label: x.version, sort: "num" },
    { label: x.size, sort: "num" },
    { label: x.keys, sort: "num" },
    { label: x.requests7, sort: "num" },
    { label: x.lastDeploy, sort: "date" },
    ...(list.some((r) => r.insight) ? [{ label: IX[lang].repo, sort: "text" as const }] : []),
  ];
  return { rows, cols };
}

export function workerStatusFilter(lang: Lang, list: { status: string }[]) {
  return {
    key: "status",
    label: DX[lang].status,
    options: [...new Set(list.map((r) => r.status))].map(
      (s) => [s, WS[lang].statuses[s] ?? s] as [string, string],
    ),
  };
}

/** 0.15.2: filter by health state (up / down / not checked / off). */
export function healthFilter(lang: Lang, list: object[]) {
  const states = [
    ...new Set(
      list.map((r) => (r as { health?: { state: string } }).health?.state).filter(Boolean),
    ),
  ] as string[];
  const lab = (st: string) =>
    st === "up"
      ? OX[lang].up
      : st === "down"
        ? OX[lang].down
        : st === "off"
          ? OX[lang].off
          : OX[lang].unknown;
  return {
    key: "health",
    label: OX[lang].health,
    options: states.map((st) => [st, lab(st)] as [string, string]),
  };
}

export interface SiteListRow extends TeamSiteRow {
  owner?: { id: string; name: string } | null;
}

/** Rows of a spaces table (team list, admin list, admin team detail). */
export function siteRows(
  lang: Lang,
  list: SiteListRow[],
  opts: {
    detail: (s: SiteListRow) => string;
    canEdit: boolean;
    deleteAction?: (s: SiteListRow) => string;
    showOwner?: boolean;
    ownerHref?: (s: SiteListRow) => string;
    showListing?: boolean;
    back?: string;
  },
): { rows: DtRow[]; cols: Col[] } {
  const x = DX[lang];
  const t = STRINGS[lang];
  const rows: DtRow[] = list.map((s) => {
    const acts: DtAction[] = [
      { kind: "link", label: x.open, href: opts.detail(s), primary: true },
      { kind: "copy", label: x.copy, value: s.url, primary: true },
      { kind: "link", label: t.team.openSite, href: s.url, external: true },
    ];
    if (opts.canEdit && opts.deleteAction)
      acts.push({
        kind: "post",
        label: t.common.del,
        action: opts.deleteAction(s),
        danger: true,
        confirm: t.team.confirmDelete,
        ...(opts.back ? { hidden: { back: opts.back } } : {}),
      });
    const status = s.permanent ? "permanent" : "live";
    const cells = [
      { html: s.permanent ? badge(t.team.permanent, "on") : badge(x.live, "info"), v: status },
      ...(opts.showOwner
        ? [
            {
              html: s.owner
                ? `<a class="text-link" href="${esc(opts.ownerHref?.(s) ?? "#")}"><bdi>${esc(s.owner.name)}</bdi></a>`
                : badge(x.guest, "muted"),
              v: (s.owner?.name ?? "").toLowerCase(),
            },
          ]
        : []),
      ...(opts.showListing
        ? [
            {
              html: badge(s.listed ? x.listedYes : x.listedNo, s.listed ? "on" : "muted"),
              v: s.listed ? 1 : 0,
            },
          ]
        : []),
      { html: esc(bytesLabel(lang, s.totalBytes)), v: s.totalBytes, cls: "num" },
      { html: num(lang, s.fileCount), v: s.fileCount, cls: "num" },
      { html: visitsCell(lang, s.visits), v: s.visits?.views7 ?? -1 },
      { html: relTime(s.createdAt, lang), v: s.createdAt },
      { html: timeTag(lang, s.expiresAt), v: s.permanent ? "9999" : s.expiresAt },
      {
        html: repoCell(lang, { repo: s.repo ?? null, repoStatus: s.repoStatus ?? null }),
        v: repoValue({ repo: s.repo ?? null, repoStatus: s.repoStatus ?? null }),
      },
    ];
    return {
      label: s.title,
      href: opts.detail(s),
      head: `<a class="row-link" href="${esc(opts.detail(s))}"><bdi>${esc(s.title)}</bdi></a><div class="meta ltr url" dir="ltr">${esc(hostless(s.url))}</div>`,
      headV: s.title,
      cells,
      actions: acts,
      filters: {
        status,
        repo: repoValue({ repo: s.repo ?? null, repoStatus: s.repoStatus ?? null }),
        ...(opts.showOwner ? { team: s.owner?.id ?? "guest" } : {}),
      },
    };
  });
  const cols: Col[] = [
    { label: x.status, sort: "text" },
    ...(opts.showOwner ? [{ label: x.owner, sort: "text" as const }] : []),
    ...(opts.showListing ? [{ label: x.home, sort: "num" as const }] : []),
    { label: x.size, sort: "num" },
    { label: x.files, sort: "num" },
    { label: x.visits7, sort: "num" },
    { label: x.created, sort: "date" },
    { label: x.expiry, sort: "date" },
    { label: IX[lang].repo, sort: "text" },
  ];
  return { rows, cols };
}

export function siteStatusFilter(lang: Lang) {
  return {
    key: "status",
    label: DX[lang].status,
    options: [
      ["live", DX[lang].live],
      ["permanent", STRINGS[lang].team.permanent],
    ] as [string, string][],
  };
}

export interface MemberListRow {
  id: string;
  name: string;
  username: string;
  role: MemberRole;
  createdAt: string;
  lastLoginAt?: string | null;
}

/** Members table rows; role changes and removal only for managers. */
export function memberRows(
  lang: Lang,
  list: MemberListRow[],
  opts: {
    canManage: boolean;
    selfId?: string | null;
    roleAction: (m: MemberListRow) => string;
    removeAction: (m: MemberListRow) => string;
    back?: string;
  },
): DtRow[] {
  const x = DX[lang];
  const hb: Record<string, string> = opts.back ? { back: opts.back } : {};
  return list.map((m) => {
    const acts: DtAction[] = [];
    if (opts.canManage && m.id !== opts.selfId) {
      for (const r of ["owner", "editor", "viewer"] as const)
        if (r !== m.role)
          acts.push({
            kind: "post",
            label: `${x.changeRole} ${x.roles[r]}`,
            action: opts.roleAction(m),
            icon: "members",
            hidden: { role: r, ...hb },
          });
      acts.push({
        kind: "post",
        label: x.remove,
        action: opts.removeAction(m),
        danger: true,
        confirm: x.removeConfirm(m.name),
        hidden: hb,
      });
    }
    return {
      label: m.name,
      head: `<strong><bdi>${esc(m.name)}</bdi></strong><div class="meta ltr" dir="ltr">${esc(m.username)}</div>`,
      headV: m.name,
      cells: [
        {
          html: badge(
            x.roles[m.role] ?? m.role,
            m.role === "owner" ? "on" : m.role === "editor" ? "info" : "muted",
          ),
          v: m.role,
        },
        { html: relTime(m.lastLoginAt ?? null, lang), v: m.lastLoginAt ?? "" },
        { html: relTime(m.createdAt, lang), v: m.createdAt },
      ],
      actions: acts,
      filters: { role: m.role },
    };
  });
}

export function memberCols(lang: Lang): Col[] {
  const x = DX[lang];
  return [
    { label: x.role, sort: "text" },
    { label: x.lastLogin, sort: "date" },
    { label: x.joined, sort: "date" },
  ];
}

export function roleFilter(lang: Lang) {
  const x = DX[lang];
  return {
    key: "role",
    label: x.role,
    options: (["owner", "editor", "viewer"] as const).map(
      (r) => [r, x.roles[r] ?? r] as [string, string],
    ),
  };
}

/** Agent key rows (team agents page and admin team detail). */
export function agentKeyRows(
  lang: Lang,
  list: AgentKeyView[],
  opts: { revokeAction?: (k: AgentKeyView) => string; back?: string },
): DtRow[] {
  const x = DX[lang];
  return list.map((k) => ({
    label: k.name,
    head: `<strong><bdi>${esc(k.name)}</bdi></strong>${k.description ? `<div class="meta"><bdi>${esc(k.description)}</bdi></div>` : ""}${k.viaInvite ? ` ${badge(V14[lang].viaInvite, "muted")}` : ""}`,
    headV: k.name,
    cells: [
      { html: `<code class="ltr">${esc(k.prefix)}…</code>` },
      { html: badge(x.keyStates[k.state] ?? k.state, stateTone(k.state)), v: k.state },
      { html: k.scopes.map((s) => `<code class="ltr scope">${esc(s)}</code>`).join(" ") },
      { html: relTime(k.lastUsedAt, lang), v: k.lastUsedAt ?? "" },
      { html: relTime(k.expiresAt, lang), v: k.expiresAt },
      { html: relTime(k.createdAt, lang), v: k.createdAt },
    ],
    actions:
      opts.revokeAction && k.state === "active"
        ? [
            {
              kind: "post",
              label: x.revokeKey,
              action: opts.revokeAction(k),
              danger: true,
              confirm: x.revokeKeyConfirm,
              ...(opts.back ? { hidden: { back: opts.back } } : {}),
            },
          ]
        : [],
    filters: { status: k.state },
  }));
}

export function agentKeyCols(lang: Lang): Col[] {
  const x = DX[lang];
  return [
    { label: x.prefix },
    { label: x.status, sort: "text" },
    { label: x.scopes },
    { label: x.lastUsed, sort: "date" },
    { label: x.expires, sort: "date" },
    { label: x.created, sort: "date" },
  ];
}

export function keyStateFilter(lang: Lang, list: { state: string }[]) {
  const x = DX[lang];
  return {
    key: "status",
    label: x.status,
    options: [...new Set(list.map((k) => k.state))].map(
      (s) => [s, x.keyStates[s] ?? s] as [string, string],
    ),
  };
}

// ---- admin: team detail ----------------------------------------------------------------------

export const TEAM_TABS = [
  "overview",
  "members",
  "spaces",
  "workers",
  "agents",
  "settings",
  "activity",
] as const;

export interface AdminTeamOpts {
  tab: string;
  team: {
    id: string;
    name: string;
    slug: string | null;
    keyPrefix: string;
    createdAt: string;
    backend: boolean;
    directory: boolean;
    permanent: boolean;
    workers: boolean;
    maxSites: number | null;
    maxMb: number | null;
    maxWorkers: number | null;
    maxWorkerKb: number | null;
  };
  quota: { sites: number; bytes: number; workers: number; kb: number };
  usage: { sites: number; bytes: number };
  views7: number | null;
  views30: number | null;
  members: MemberListRow[];
  invites: number;
  sites: SiteListRow[];
  workers: WorkerListRow[];
  agentKeys: AgentKeyView[];
  audit: AuditView[];
  cfConfigured: boolean;
  csrf: string;
  flash?: Flash | null;
}

export function adminTeamHtml(lang: Lang, c: Config, o: AdminTeamOpts): string {
  const x = DX[lang];
  const t = STRINGS[lang];
  const d = DS[lang];
  const href = (p: string) => localePath(lang, p);
  const tm = o.team;
  const base = `/admin/teams/${tm.id}`;
  const tab = (TEAM_TABS as readonly string[]).includes(o.tab) ? o.tab : "overview";
  const self = href(`${base}${tab === "overview" ? "" : `?tab=${tab}`}`);
  const activeKeys = o.agentKeys.filter((k) => k.state === "active").length;
  const counts: Record<string, number> = {
    members: o.members.length,
    spaces: o.sites.length,
    workers: o.workers.length,
    agents: activeKeys,
  };
  const tabs = tabsNav(
    x.tabs,
    TEAM_TABS.map((key) => ({
      key,
      label: x[key],
      href: href(`${base}${key === "overview" ? "" : `?tab=${key}`}`),
      count: counts[key],
    })),
    tab,
  );
  const head = `<div class="detail-head"><div class="detail-title"><p class="eyebrow">${esc(x.team)}</p><h1><bdi>${esc(tm.name)}</bdi>${tm.workers ? ` ${badge(x.workersFeature, "info")}` : ""}</h1>
    <p class="meta"><code class="ltr">${esc(tm.id)}</code>${tm.slug ? ` · <code class="ltr">${esc(tm.slug)}</code>` : ""} · ${esc(x.keyPrefix)} <code class="ltr">${esc(tm.keyPrefix)}…</code> · ${esc(x.created)} ${relTime(tm.createdAt, lang)}</p></div>
    <div class="detail-actions"><a class="button small ghost" href="${href(`/admin/activity?team=${tm.id}`)}">${icon("activity")}${esc(x.activity)}</a></div></div>`;
  let body: string;
  if (tab === "members") {
    body = `${dataTable({
      lang,
      id: "members-table",
      caption: x.members,
      headLabel: x.member,
      cols: memberCols(lang),
      rows: memberRows(lang, o.members, {
        canManage: true,
        roleAction: (m) => href(`${base}/members/${m.id}/role`),
        removeAction: (m) => href(`${base}/members/${m.id}/delete`),
        back: self,
      }),
      csrf: o.csrf,
      empty: x.noMembers,
      filters: [roleFilter(lang)],
    })}
    ${postForm(
      href(`${base}/invite`),
      o.csrf,
      `${backField(self)}<label for="inv-role">${esc(x.role)}</label> <select id="inv-role" name="role">${(["owner", "editor", "viewer"] as const).map((r) => `<option value="${r}">${esc(x.roles[r] ?? r)}</option>`).join("")}</select> <button type="submit" class="button small">${icon("plus")}${esc(x.invite)}</button>${o.invites ? ` <span class="meta">${esc(d.stats.invites(o.invites))}</span>` : ""}`,
      { cls: "inline-form panel invite-row" },
    )}`;
  } else if (tab === "spaces") {
    const { rows, cols } = siteRows(lang, o.sites, {
      detail: (s) => href(`/admin/sites/${s.id}`),
      canEdit: true,
      deleteAction: (s) => href(`/admin/sites/${s.id}/delete`),
      showListing: true,
      back: self,
    });
    body = dataTable({
      lang,
      id: "team-sites",
      caption: x.spaces,
      headLabel: t.common.title,
      cols,
      rows,
      csrf: o.csrf,
      empty: x.noSpaces,
      filters: [siteStatusFilter(lang), repoFilter(lang, o.sites)],
    });
  } else if (tab === "workers") {
    const { rows, cols } = workerRows(lang, o.workers, {
      detail: (w) => href(`${base}/workers/${w.name}`),
      admin: true,
      canEdit: true,
      back: self,
    });
    body = `${tm.workers ? "" : `<p class="notice">${esc(d.stats.workersOff)}</p>`}${dataTable({
      lang,
      id: "team-workers",
      caption: x.workers,
      headLabel: WS[lang].name,
      cols,
      rows,
      csrf: o.csrf,
      empty: x.noWorkers,
      filters: [
        workerStatusFilter(lang, o.workers),
        healthFilter(lang, o.workers),
        kindFilter(lang, o.workers),
        languageFilter(lang, o.workers),
        repoFilter(lang, o.workers),
      ],
    })}`;
  } else if (tab === "agents") {
    body = dataTable({
      lang,
      id: "agent-keys",
      caption: x.agents,
      headLabel: x.keyName,
      cols: agentKeyCols(lang),
      rows: agentKeyRows(lang, o.agentKeys, {
        revokeAction: (k) => href(`${base}/agents/${k.id}/revoke`),
        back: self,
      }),
      csrf: o.csrf,
      empty: x.noAgentKeys,
      filters: [keyStateFilter(lang, o.agentKeys)],
    });
  } else if (tab === "settings") {
    body = adminTeamSettings(lang, o, self, base);
  } else if (tab === "activity") {
    body = activityBlock(lang, o.audit, true);
  } else {
    const feat = (on: boolean, label: string) =>
      `<li>${badge(on ? d.on : d.off, on ? "on" : "muted")} ${esc(label)}</li>`;
    const views =
      o.views30 !== null
        ? statCard(
            "views",
            x.visits30,
            esc(fmt(lang, o.views30)),
            esc(d.stats.views7(fmt(lang, o.views7 ?? 0))),
          )
        : "";
    body = `<div class="stat-grid">
      ${statCard("sites", x.liveSpaces, esc(fmt(lang, o.usage.sites)), esc(d.stats.of(fmt(lang, o.usage.sites), fmt(lang, o.quota.sites))), { value: o.usage.sites, max: o.quota.sites }, href(`${base}?tab=spaces`))}
      ${statCard("storage", x.storage, esc(bytesLabel(lang, o.usage.bytes)), esc(d.stats.of(bytesLabel(lang, o.usage.bytes), bytesLabel(lang, o.quota.bytes))), { value: o.usage.bytes, max: o.quota.bytes })}
      ${statCard("members", x.members, esc(fmt(lang, o.members.length)), esc(d.stats.invites(o.invites)), undefined, href(`${base}?tab=members`))}
      ${statCard("workers", x.workers, esc(fmt(lang, o.workers.length)), esc(tm.workers ? d.stats.of(fmt(lang, o.workers.length), fmt(lang, o.quota.workers)) : d.stats.workersOff), tm.workers ? { value: o.workers.length, max: o.quota.workers } : undefined, href(`${base}?tab=workers`))}
      ${statCard("key", x.agents, esc(fmt(lang, activeKeys)), "", undefined, href(`${base}?tab=agents`))}
      ${views}
    </div>
    <div class="detail-cols">
      <section class="panel"><h2 class="h3">${esc(x.features)}</h2><ul class="feature-list">${feat(tm.backend, x.backend)}${feat(tm.directory, x.home)}${feat(tm.permanent, x.permanent)}${feat(tm.workers, x.workersFeature)}</ul>
      <p><a class="text-link" href="${href(`${base}?tab=settings`)}">${esc(x.settings)}</a></p></section>
      ${activityBlock(lang, o.audit.slice(0, 6), true)}
    </div>`;
  }
  return dashLayout({
    lang,
    config: c,
    kind: "admin",
    active: "overview",
    title: `${tm.name} · ${x[tab as (typeof TEAM_TABS)[number]]} · ${t.product}`,
    description: x.team,
    path: `${base}${tab === "overview" ? "" : `?tab=${tab}`}`,
    body: detailBody(head, flashBox(lang, o.flash), tabs, body),
    csrf: o.csrf,
    ctx: ADMIN_CTX(lang),
    crumbs: [{ label: tm.name }],
  });
}

function adminTeamSettings(lang: Lang, o: AdminTeamOpts, self: string, base: string): string {
  const x = DX[lang];
  const href = (p: string) => localePath(lang, p);
  const tm = o.team;
  const toggle = (f: "backend" | "directory" | "permanent", label: string) =>
    `<label class="check"><input type="checkbox" name="${f}" value="1"${tm[f] ? " checked" : ""}><span>${esc(label)}</span></label>`;
  const teamForm = `<form method="post" action="${href(`${base}/update`)}" class="panel stack-form">${csrfField(o.csrf)}${backField(self)}<input type="hidden" name="features" value="1">
    <h2 class="h3">${esc(x.features)}</h2>
    <label for="t-name">${esc(x.rename)}</label><input id="t-name" name="name" value="${esc(tm.name)}" maxlength="80" dir="auto" required>
    ${toggle("backend", x.backend)}${toggle("directory", x.home)}${toggle("permanent", x.permanent)}
    <fieldset class="expiry-set"><legend>${esc(x.quota)}</legend>
      <label class="inline-field">${esc(x.quotaSites)} <input class="days-input" name="maxSites" type="number" min="0" max="100000" placeholder="${o.quota.sites}" value="${tm.maxSites ?? ""}" inputmode="numeric"></label>
      <label class="inline-field">${esc(x.quotaMb)} <input class="days-input" name="maxMb" type="number" min="0" max="100000" placeholder="${Math.round(o.quota.bytes / 1024 / 1024)}" value="${tm.maxMb ?? ""}" inputmode="numeric"></label>
      <p class="form-help">${esc(x.quotaHelp)}</p>
    </fieldset>
    <button class="button small" type="submit">${esc(x.saveTeam)}</button></form>`;
  const wForm = o.cfConfigured
    ? `<form method="post" action="${href(`/admin/workers/teams/${tm.id}`)}" class="panel stack-form"${tm.workers && o.workers.length ? ` data-confirm="${esc(WS[lang].turnOffConfirm)}"` : ""}>${csrfField(o.csrf)}${backField(self)}
    <h2 class="h3">${icon("workers")} ${esc(x.workersFeature)}</h2>
    <label class="check"><input type="checkbox" name="enabled" value="1"${tm.workers ? " checked" : ""}><span>${esc(x.workersOn)}</span></label>
    <p class="form-help">${esc(x.turnOffWorkers)}</p>
    <label for="t-slug">${esc(x.workersSlug)}</label><input id="t-slug" name="slug" value="${esc(tm.slug ?? "")}" maxlength="20" dir="ltr"${o.workers.length ? " readonly" : ""}>
    <div class="form-row"><label class="inline-field">${esc(x.maxWorkers)} <input class="days-input" name="maxWorkers" type="number" min="0" max="100" placeholder="${o.quota.workers}" value="${tm.maxWorkers ?? ""}" inputmode="numeric"></label>
    <label class="inline-field">${esc(x.maxKb)} <input class="days-input" name="maxWorkerKb" type="number" min="0" max="10240" placeholder="${o.quota.kb}" value="${tm.maxWorkerKb ?? ""}" inputmode="numeric"></label></div>
    <button class="button small" type="submit">${esc(x.saveWorkers)}</button></form>`
    : `<div class="panel"><h2 class="h3">${esc(x.workersFeature)}</h2><p class="notice">${esc(WS[lang].notConfigured)}</p></div>`;
  return `<div class="settings-grid">${teamForm}${wForm}</div>
  <section class="danger-zone" aria-labelledby="dz-title"><h2 id="dz-title" class="h3">${esc(x.danger)}</h2>
    ${dangerRow(
      x.rotate,
      DS[lang].rotateWarn,
      postForm(
        href(`${base}/rotate`),
        o.csrf,
        `${backField(self)}<button class="button small warn" type="submit">${icon("rotate")}${esc(x.rotate)}</button>`,
        { confirm: x.rotateConfirm },
      ),
    )}
    ${teamDeleteRows(lang, { base, csrf: o.csrf, name: tm.name, id: tm.id }, dangerRow)}
  </section>`;
}

// ---- space detail (team and admin) ----------------------------------------------------------

export const SITE_TABS = [
  "overview",
  "visits",
  "files",
  "data",
  "mcp",
  "activity",
  "settings",
] as const;

export type BackendBrowser =
  | { state: "off"; reason?: string }
  | {
      state: "on";
      kv: KvRowView[];
      totalKeys: number;
      otherKeys: string[];
      moreKeys: number;
      files: { id: string; name: string; size: number; createdAt: string; url: string }[];
      error?: string;
    };

export interface SiteDetailOpts {
  kind: "team" | "admin";
  tab: string;
  base: string;
  ctx: DashCtx;
  csrf: string;
  flash?: Flash | null;
  canEdit: boolean;
  owner: { id: string; name: string } | null;
  teamPermanent: boolean;
  teamDirectory: boolean;
  site: TeamSiteRow & { files: [string, number][]; ceiling: string };
  /** Same-origin preview image (cover or drawn placeholder). */
  preview: string;
  mcp: McpPanel;
  audit: AuditView[];
  backendBrowser: BackendBrowser;
  /** Upload form for "replace files" (team editors only). */
  replaceForm?: string;
}

export function siteDetailHtml(lang: Lang, c: Config, o: SiteDetailOpts): string {
  const x = DX[lang];
  const t = STRINGS[lang];
  const href = (p: string) => localePath(lang, p);
  const s = o.site;
  const admin = o.kind === "admin";
  const tab = (SITE_TABS as readonly string[]).includes(o.tab) ? o.tab : "overview";
  const self = href(`${o.base}${tab === "overview" ? "" : `?tab=${tab}`}`);
  const teamBase = `/team/sites/${s.id}`;
  const bb = o.backendBrowser;
  const counts: Record<string, number | undefined> = {
    files: s.fileCount,
    data: bb.state === "on" ? bb.totalKeys : undefined,
    mcp: o.mcp.tokens.length || undefined,
  };
  const tabs = tabsNav(
    x.tabs,
    SITE_TABS.map((key) => ({
      key,
      label: x[key],
      href: href(`${o.base}${key === "overview" ? "" : `?tab=${key}`}`),
      count: counts[key],
    })),
    tab,
  );
  const status = s.permanent ? badge(t.team.permanent, "on") : badge(x.live, "info");
  const ownerLine = o.owner
    ? admin
      ? ` · <a class="text-link" href="${href(`/admin/teams/${o.owner.id}?tab=spaces`)}"><bdi>${esc(o.owner.name)}</bdi></a>`
      : ""
    : admin
      ? ` · ${esc(x.guest)}`
      : "";
  const head = `<div class="detail-head"><div class="detail-title"><p class="eyebrow">${esc(x.space)}${ownerLine}</p><h1><bdi>${esc(s.title)}</bdi> ${status}</h1>
    <div class="detail-links">${copyLine(lang, "siteUrl", x.link, s.url)}</div></div>
    <div class="detail-actions"><a class="button small" href="${esc(s.url)}" target="_blank" rel="noopener">${icon("ext")}${esc(t.team.openSite)}</a></div></div>`;
  let body: string;
  if (tab === "visits") body = visitsSection(lang, s.visits);
  else if (tab === "files") body = siteFilesTab(lang, o);
  else if (tab === "data") body = siteDataTab(lang, o, self, teamBase);
  else if (tab === "mcp")
    body = mcpSection(lang, o.mcp, o.csrf, href(teamBase), s.id, !admin && o.canEdit);
  else if (tab === "activity")
    body = activityBlock(lang, o.audit, false, STRINGS[lang].members.auditSiteTitle);
  else if (tab === "settings") body = siteSettingsTab(lang, o, self, teamBase);
  else body = siteOverviewTab(lang, c, o, self, teamBase);
  return dashLayout({
    lang,
    config: c,
    kind: o.kind,
    active: "sites",
    title: `${s.title} · ${x[tab as (typeof SITE_TABS)[number]]} · ${t.product}`,
    description: x.space,
    path: `${o.base}${tab === "overview" ? "" : `?tab=${tab}`}`,
    body: detailBody(head, flashBox(lang, o.flash), tabs, body),
    csrf: o.csrf,
    ctx: o.ctx,
    crumbs: [{ label: s.title }],
  });
}

function siteOverviewTab(
  lang: Lang,
  c: Config,
  o: SiteDetailOpts,
  self: string,
  teamBase: string,
): string {
  const x = DX[lang];
  const t = STRINGS[lang];
  const href = (p: string) => localePath(lang, p);
  const s = o.site;
  const admin = o.kind === "admin";
  const listed = o.teamDirectory && !s.unlisted;
  const acts: string[] = [];
  if (!admin && o.canEdit)
    acts.push(
      postForm(
        href(`${teamBase}/extend`),
        o.csrf,
        `${backField(self)}<label class="ttl"><span>${esc(t.team.extendTo)}</span> <select name="ttlHours">${ttlOptions(lang, c, c.defaultTtlHours, o.teamPermanent && !s.permanent)}</select></label> <button class="button small" type="submit">${esc(t.team.extend)}</button>`,
        { cls: "inline-form extend-form" },
      ),
    );
  if (!admin && o.canEdit && o.teamPermanent && !s.permanent)
    acts.push(
      postForm(
        href(`${teamBase}/permanent`),
        o.csrf,
        `${backField(self)}<button class="button small ghost" type="submit">${esc(t.team.makePermanent)}</button>`,
      ),
    );
  if (!admin && o.canEdit && o.teamDirectory)
    acts.push(
      postForm(
        href(`${teamBase}/listing`),
        o.csrf,
        `${backField(self)}<input type="hidden" name="listed" value="${s.unlisted ? "1" : "0"}"><button class="button small ghost" type="submit">${esc(s.unlisted ? t.team.show : t.team.hide)}</button>`,
      ),
    );
  if (admin && o.owner)
    acts.push(
      postForm(
        href(`/admin/sites/${s.id}/permanent`),
        o.csrf,
        `${backField(self)}<input type="hidden" name="permanent" value="${s.permanent ? "0" : "1"}"><button class="button small ghost" type="submit">${esc(s.permanent ? x.revokePermanent : x.grantPermanent)}</button>`,
        s.permanent ? { confirm: x.confirm } : {},
      ),
    );
  const fact = (label: string, html: string) => `<div><dt>${esc(label)}</dt><dd>${html}</dd></div>`;
  return `<div class="site-over">
    <a class="preview-link" href="${esc(s.url)}" target="_blank" rel="noopener"><img class="preview-thumb" src="${esc(o.preview)}" alt="${esc(x.previewAlt(s.title))}" loading="lazy" width="480" height="270"></a>
    <dl class="facts-grid">
      ${fact(x.expiry, `${timeTag(lang, s.expiresAt)}<div class="meta">${s.permanent ? esc(t.team.permanentNote) : `${esc(x.capped)} ${timeTag(lang, s.ceiling)}`}</div>`)}
      ${fact(x.created, timeTag(lang, s.createdAt))}
      ${fact(x.size, `${esc(bytesLabel(lang, s.totalBytes))} · ${esc(x.filesCount(s.fileCount))}`)}
      ${fact(x.home, badge(listed ? x.listedYes : x.listedNo, listed ? "on" : "muted"))}
      ${fact(x.visits7, s.visits ? esc(fmt(lang, s.visits.views7)) : "—")}
      ${fact(x.visits30, s.visits ? esc(fmt(lang, s.visits.views30)) : "—")}
      ${o.owner ? fact(x.owner, `<bdi>${esc(o.owner.name)}</bdi>`) : admin ? fact(x.owner, badge(x.guest, "muted")) : ""}
      ${fact(x.mcp, `<code class="ltr">${esc(hostless(o.mcp.endpoint))}</code>`)}
      ${fact(IX[lang].repo, repoCell(lang, { repo: s.repo ?? null, repoStatus: s.repoStatus ?? null }))}
    </dl>
  </div>
  ${acts.length ? `<div class="actions site-actions">${acts.join("")}</div>` : ""}
  ${activityBlock(lang, o.audit.slice(0, 8), false, t.members.auditSiteTitle)}`;
}

function siteFilesTab(lang: Lang, o: SiteDetailOpts): string {
  const x = DX[lang];
  const href = (p: string) => localePath(lang, p);
  const s = o.site;
  const root = s.url.replace(/\/$/, "");
  const rows: DtRow[] = s.files.slice(0, 2000).map(([p, size]) => {
    const url = `${root}/${p.split("/").map(encodeURIComponent).join("/")}`;
    const ext = p.includes(".") ? (p.split(".").pop() ?? "").toLowerCase() : "";
    return {
      label: p,
      head: `<a class="row-link ltr" dir="ltr" href="${esc(url)}" target="_blank" rel="noopener">${esc(p)}</a>`,
      headV: p,
      cells: [
        { html: ext ? `<code class="ltr">.${esc(ext)}</code>` : "—", v: ext },
        { html: esc(bytesLabel(lang, size)), v: size, cls: "num" },
      ],
      actions: [
        { kind: "copy", label: x.copy, value: url, primary: true },
        { kind: "link", label: x.open, href: url, external: true, primary: true },
      ],
      filters: { type: ext || "-" },
    };
  });
  const types = [...new Set(rows.map((r) => r.filters?.type ?? "-"))].sort();
  return `${dataTable({
    lang,
    id: "files-table",
    caption: x.files,
    headLabel: x.path,
    cols: [
      { label: IX[lang].type, srOnly: true },
      { label: x.size, sort: "num" },
    ],
    rows,
    empty: x.filesCount(0),
    filters: [
      {
        key: "type",
        label: x.files,
        options: types.map((ty) => [ty, ty === "-" ? "—" : `.${ty}`] as [string, string]),
      },
    ],
    pageSize: 50,
  })}${
    o.kind === "team" && o.canEdit
      ? `<p class="block"><a class="button small ghost" href="${href(`${o.base}?tab=settings`)}">${esc(STRINGS[lang].team.replace)}</a></p>`
      : ""
  }`;
}

function siteDataTab(lang: Lang, o: SiteDetailOpts, self: string, teamBase: string): string {
  const x = DX[lang];
  const t = STRINGS[lang];
  const href = (p: string) => localePath(lang, p);
  const bb = o.backendBrowser;
  if (bb.state === "off")
    return `<p class="notice">${esc(bb.reason ?? t.team.backendBrowserOff)}</p>`;
  const mutate = o.kind === "team" && o.canEdit;
  const kvRows: DtRow[] = bb.kv.map((kk) => ({
    label: kk.key,
    head: `<code class="kv-key ltr" dir="ltr">${esc(kk.key)}</code>`,
    headV: kk.key,
    cells: [
      {
        html:
          kk.full === undefined
            ? `<span class="meta">—</span>`
            : `<details class="kv-value"><summary><code dir="ltr">${esc(kk.preview ?? "")}</code></summary><pre tabindex="0" dir="ltr">${esc(kk.full)}</pre>${kk.truncated ? `<p class="meta">${esc(t.team.valueTruncated)}</p>` : ""}</details>`,
        cls: "cell-value",
      },
      {
        html: kk.bytes !== undefined ? esc(bytesLabel(lang, kk.bytes)) : "—",
        v: kk.bytes ?? 0,
        cls: "num",
      },
    ],
    actions: mutate
      ? [
          {
            kind: "post",
            label: x.deleteKey,
            action: href(`${teamBase}/kv/delete`),
            danger: true,
            confirm: x.confirm,
            hidden: { key: kk.key, back: self },
          },
        ]
      : [],
  }));
  const fileRows: DtRow[] = bb.files.map((f) => ({
    label: f.name,
    head: `<a class="row-link ltr" dir="ltr" href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a>`,
    headV: f.name,
    cells: [
      { html: esc(bytesLabel(lang, f.size)), v: f.size, cls: "num" },
      { html: relTime(f.createdAt, lang), v: f.createdAt },
    ],
    actions: mutate
      ? [
          {
            kind: "post",
            label: x.deleteKey,
            action: href(`${teamBase}/files/delete`),
            danger: true,
            confirm: x.confirm,
            hidden: { fileId: f.id, back: self },
          },
        ]
      : [],
  }));
  const more = bb.otherKeys.length
    ? `<details class="more-keys"><summary>${esc(x.moreKeys(bb.otherKeys.length))}</summary><ul class="chips">${bb.otherKeys.map((kk) => `<li><code dir="ltr">${esc(kk)}</code></li>`).join("")}</ul></details>`
    : "";
  return `${bb.error ? `<p class="flash err" role="alert">${esc(bb.error)}</p>` : ""}
  <section class="block" aria-labelledby="kv-title"><h2 class="h3" id="kv-title">${esc(x.kvKeys)} <span class="tab-count">${esc(fmt(lang, bb.totalKeys))}</span></h2>
  ${dataTable({ lang, id: "kv-table", caption: x.kvKeys, headLabel: x.key, cols: [{ label: x.value }, { label: x.size, sort: "num" }], rows: kvRows, csrf: o.csrf, empty: x.noKv, cls: "kv-dt" })}${more}</section>
  <section class="block" aria-labelledby="up-title"><h2 class="h3" id="up-title">${esc(x.uploads)}</h2>
  ${dataTable({
    lang,
    id: "uploads-table",
    caption: x.uploads,
    headLabel: x.path,
    cols: [
      { label: x.size, sort: "num" },
      { label: x.created, sort: "date" },
    ],
    rows: fileRows,
    csrf: o.csrf,
    empty: x.noUploads,
  })}</section>`;
}

function siteSettingsTab(lang: Lang, o: SiteDetailOpts, self: string, teamBase: string): string {
  const x = DX[lang];
  const t = STRINGS[lang];
  const href = (p: string) => localePath(lang, p);
  const s = o.site;
  const admin = o.kind === "admin";
  const tokenAction = admin ? href(`/admin/sites/${s.id}/token`) : href(`${teamBase}/token`);
  const del = admin ? href(`/admin/sites/${s.id}/delete`) : href(`${teamBase}/delete`);
  const delBack = admin
    ? backField(o.owner ? href(`/admin/teams/${o.owner.id}?tab=spaces`) : href("/admin/sites"))
    : "";
  const token = `<section class="panel stack-form" aria-labelledby="tok-title"><h2 id="tok-title" class="h3">${icon("key")} ${esc(x.editToken)}</h2><p class="meta">${esc(x.tokenHelp)}</p>
    ${
      o.canEdit
        ? postForm(
            tokenAction,
            o.csrf,
            `${backField(self)}<button class="button small warn" type="submit">${icon("rotate")}${esc(x.regenerate)}</button>`,
            { confirm: x.regenerateConfirm },
          )
        : `<p class="meta">${esc(x.readOnly)}</p>`
    }</section>`;
  const replace = !admin && o.canEdit && o.replaceForm ? o.replaceForm : "";
  const danger = o.canEdit
    ? `<section class="danger-zone" aria-labelledby="dz-title"><h2 id="dz-title" class="h3">${esc(x.danger)}</h2>${dangerRow(
        x.deleteSpace,
        x.deleteSpaceHelp,
        postForm(
          del,
          o.csrf,
          `${delBack}<button class="button small danger" type="submit">${icon("trash")}${esc(t.common.del)}</button>`,
          { confirm: t.team.confirmDelete },
        ),
      )}</section>`
    : `<p class="notice">${esc(x.readOnly)}</p>`;
  const ix = IX[lang];
  const repoForm =
    !admin && o.canEdit
      ? `<form method="post" action="${href(`${teamBase}/repo`)}" class="panel stack-form">
    ${csrfField(o.csrf)}${backField(self)}
    <h2 class="h3">${icon("repo")} ${esc(ix.repo)}</h2>
    <p class="meta">${esc(ix.siteRepoHelp)}</p>
    <label class="field">${esc(ix.repoUrl)} <input name="repoUrl" type="url" dir="ltr" placeholder="https://github.com/org/repo" value="${esc(s.repo?.url ?? "")}"></label>
    <div class="inline-fields"><label class="field">${esc(ix.branch)} <input name="branch" dir="ltr" placeholder="main" value="${esc(s.repo?.branch ?? "")}"></label>
    <label class="field">${esc(ix.commit)} <input name="commitSha" dir="ltr" pattern="[0-9a-fA-F]{7,40}" value="${esc(s.repo?.commitSha ?? "")}"></label></div>
    <button class="button small" type="submit">${esc(ix.saveLinks)}</button>
  </form>`
      : "";
  return `<div class="settings-grid">${replace}${token}${repoForm}</div>${danger}`;
}
