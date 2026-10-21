/**
 * 0.15.2 UI: Worker detail tabs (Variables & secrets, Health, Logs, Usage), lightweight
 * inline SVG charts, table cells (health + 24h sparkline) and the token permission
 * checklists on the admin Cloudflare settings page. AR + EN.
 */
import type { PermCheck, PermReport } from "./cf-permissions.js";
import { actorText, type Lang } from "./i18n.js";
import { csrfField, esc, icon, postForm, timeTag } from "./ui.js";
import { badge, type DtRow, dataTable, relTime } from "./ui-table.js";
import type { LogsResult, UsageRange, UsageSeries } from "./worker-analytics.js";
import type { EnvView } from "./worker-env.js";
import type { HealthView } from "./worker-health.js";
import type { KeyUsageRow } from "./worker-ops.js";

export const OX = {
  en: {
    env: "Variables & secrets",
    health: "Health",
    logs: "Logs",
    usage: "Usage",
    name: "Name",
    type: "Type",
    status: "Status",
    updated: "Last updated",
    source: "Source",
    kinds: {
      var: "Plain var",
      secret: "Secret",
      system: "Spaces-managed",
      binding: "Binding",
      missing: "Missing",
      unset: "Used in code",
    } as Record<string, string>,
    st: { set: "Set", empty: "Empty", missing: "Missing", unset: "Not set" } as Record<
      string,
      string
    >,
    unsetNote: (n: number) =>
      `${n} name${n === 1 ? "" : "s"} used in the code without a default and not set. Set ${n === 1 ? "it" : "them"} if needed, or add to requiredEnv to get a warning.`,
    srcLive: "Cloudflare (live)",
    srcSpaces: "Spaces record",
    envHelp:
      "Names, types and status only. Secret values are write-only: Spaces never shows or returns them, and plain var values are not shown either.",
    liveFail: (e: string) =>
      `Could not read the live bindings from Cloudflare (${e}); showing Spaces' record.`,
    missingTitle: (n: number) => `${n} expected name${n === 1 ? "" : "s"} not set`,
    whyDeclared: "declared in requiredEnv",
    whyCode: "used in the code (env.X) — set it, or ignore if optional",
    expected: "Expected",
    setSecret: "Set or rotate a secret",
    setSecretHelp:
      "The value is sent straight to Cloudflare and cannot be read back. Rotating = setting a new value for an existing name.",
    secretValue: "Secret value",
    saveSecret: "Save secret",
    setVar: "Set a plain var",
    setVarHelp:
      "Redeploys the newest stored code with the new value (a new version). The value is not shown afterwards.",
    varValue: "Value",
    saveVar: "Save var",
    del: "Delete",
    delConfirm: (n: string) => `Delete ${n}? Code that reads it will get undefined.`,
    setIt: "Set value",
    requiredEnvHint:
      'Declare what the code needs with "requiredEnv": ["API_KEY", …] on deploy (or POST …/links).',
    noEnv: "No vars or secrets yet.",
    bundled: "large (bundled)",
    up: "Up",
    down: "Down",
    unknown: "Not checked yet",
    off: "Monitoring off",
    uptime: "Uptime",
    h24: "24h",
    d7: "7 days",
    d30: "30 days",
    latency: "Avg latency (24h)",
    lastCheck: "Last check",
    every: (s: number) => `Checked every ${s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`}`,
    via: { get: "GET of the URL", mcp: "MCP initialize" } as Record<string, string>,
    incidents: "Incidents",
    noIncidents: "No incidents in the last 7 days.",
    from: "From",
    to: "To",
    ongoing: "ongoing",
    checks: "Checks",
    checkNow: "Check now",
    enable: "Turn monitoring on",
    disable: "Turn monitoring off",
    healthHelp:
      "One request per interval: a GET of the URL (web Workers: any answer below 400 counts as up; MCP servers: below 500), or MCP initialize for MCP servers without their own auth. Set a health path or expected status below if / is not a good check. Two failures in a row = down; you get one notification (bell + webhooks) when it goes down and one when it recovers.",
    target: "What the check asks",
    healthPath: "Health path",
    healthPathHint: "e.g. /health (empty = the Worker's URL)",
    healthExpect: "Expected status",
    healthExpectHint: "e.g. 2xx, 200-399, 200,404 or <400 (empty = default)",
    saveTarget: "Save check",
    legacy: (s: string) =>
      `This Worker answered ${s} at / before 0.16.0, so it still counts as up with the old "below 500" rule. Set a health path or expected status to use the new rule.`,
    latencyChart: "Latency over the last 24h (red = failed check)",
    logsHelp:
      "Recent errors for the last 24h. Exception counts by hour come from Cloudflare analytics; full log lines need Workers Logs on this Worker. Messages are scrubbed of anything that looks like a secret; query strings are dropped.",
    logsOn: "Workers Logs: on",
    logsOff: "Workers Logs: off",
    turnLogsOn: "Turn Workers Logs on",
    turnLogsOff: "Turn Workers Logs off",
    wlDenied: (e: string) =>
      `Workers Logs are on but the token cannot read them: ${e}. Add "Account · Workers Observability: Read" to the Cloudflare token.`,
    wlError: (e: string) => `Workers Logs query failed: ${e}`,
    anDenied: (e: string) =>
      `Analytics are not readable with this token: ${e}. Add "Account · Account Analytics: Read".`,
    anError: (e: string) => `Analytics query failed: ${e}`,
    time: "Time",
    level: "Level",
    src: "Source",
    kind: "Kind",
    message: "Message",
    path: "Path",
    noLogs: "No errors or log lines in the last 24 hours.",
    srcs: {
      "workers-logs": "Workers Logs",
      analytics: "Analytics",
      health: "Health check",
      deploy: "Deploy",
    } as Record<string, string>,
    requests: "Requests",
    errors: "Errors",
    cpu: "CPU (median)",
    range: "Range",
    usageHelp:
      "From Cloudflare analytics (cached 5 min). Per-key counts come from Spaces' own rate-limit counters.",
    perKey: "Requests per end-user key",
    key: "Key",
    total: "Total",
    limited: "Rate-limited",
    trend: "Trend",
    noKeys: "No end-user keys for this Worker.",
    usageError: (e: string) => `Cloudflare analytics unavailable: ${e}`,
    refresh: "Refresh",
    perms: "Token permissions",
    permsWorkers: "Workers token (Spaces → Cloudflare)",
    permsBackend: "Data/files backend (KV token + R2 keys)",
    permsHelp:
      "Each line is checked with one harmless read (no changes). Green = granted, red = missing, grey = optional or not checked. Results are cached for 5 minutes; token values are never shown.",
    permission: "Permission",
    unlocks: "Unlocks",
    result: "Result",
    recheck: "Recheck",
    tokenActive: "Token is active",
    editConfirmed: "Edit confirmed by a successful deploy",
    editPending: "Read OK; edit is confirmed by the first deploy",
    checked: "checked",
    checking: "Checking the token now. Reload in a few seconds to see the result.",
    granted: "Granted",
    missing: "Missing",
    unchecked: "Not checked",
    optional: "optional",
    progress: (g: number, n: number) => `${g}/${n} required granted`,
    notConfigured: "Not configured.",
    feat: {
      everything: "Everything below",
      deploy: "Deploy, redeploy, roll back, delete Workers",
      env: "Variables & secrets list; set/rotate/delete secrets",
      usage: "Usage charts, error counts, table sparklines",
      logs: "Logs tab (Workers Logs lines)",
      hosts: "Custom hostnames (route + DNS record)",
      workersdev: "workers.dev URLs",
      tail: "Live tail (not used yet)",
      kvbind: "KV bindings on Workers (not used yet)",
      r2bind: "R2 bindings on Workers (not used yet)",
      kv: "Spaces KV data API",
      files: "Spaces files API (R2)",
    } as Record<string, string>,
    intervalLabel: "Health check interval (seconds)",
    saveInterval: "Save interval",
  },
  ar: {
    env: "المتغيرات والأسرار",
    health: "الصحة",
    logs: "السجلات",
    usage: "الاستخدام",
    name: "الاسم",
    type: "النوع",
    status: "الحالة",
    updated: "آخر تحديث",
    source: "المصدر",
    kinds: {
      var: "متغير عادي",
      secret: "سر",
      system: "تديره Spaces",
      binding: "ربط",
      missing: "ناقص",
      unset: "مستخدم في الكود",
    } as Record<string, string>,
    st: { set: "مضبوط", empty: "فارغ", missing: "ناقص", unset: "غير مضبوط" } as Record<
      string,
      string
    >,
    unsetNote: (n: number) =>
      `${n} من الأسماء مستخدمة في الكود بلا قيمة افتراضية وغير مضبوطة. اضبطها إن احتجتها، أو أضفها إلى requiredEnv ليظهر تنبيه.`,
    srcLive: "Cloudflare (مباشر)",
    srcSpaces: "سجل Spaces",
    envHelp:
      "الأسماء والأنواع والحالة فقط. قيم الأسرار للكتابة فقط: لا تعرضها Spaces ولا ترجعها أبدًا، ولا تُعرض قيم المتغيرات العادية أيضًا.",
    liveFail: (e: string) =>
      `تعذّر قراءة الربط المباشر من Cloudflare (${e})؛ المعروض من سجل Spaces.`,
    missingTitle: (n: number) => `${n} من الأسماء المتوقعة غير مضبوطة`,
    whyDeclared: "مُعلن في requiredEnv",
    whyCode: "مستخدم في الكود (env.X) — اضبطه أو تجاهله لو اختياري",
    expected: "متوقع",
    setSecret: "إضافة سر أو تغييره",
    setSecretHelp:
      "تذهب القيمة مباشرة إلى Cloudflare ولا يمكن قراءتها بعد ذلك. التغيير = ضبط قيمة جديدة لاسم موجود.",
    secretValue: "قيمة السر",
    saveSecret: "حفظ السر",
    setVar: "ضبط متغير عادي",
    setVarHelp: "يعيد نشر أحدث كود محفوظ بالقيمة الجديدة (إصدار جديد). لا تُعرض القيمة بعد الحفظ.",
    varValue: "القيمة",
    saveVar: "حفظ المتغير",
    del: "حذف",
    delConfirm: (n: string) => `حذف ${n}؟ الكود الذي يقرؤه سيحصل على undefined.`,
    setIt: "ضبط القيمة",
    requiredEnvHint:
      'أعلن ما يحتاجه الكود بـ "requiredEnv": ["API_KEY", …] عند النشر (أو POST …/links).',
    noEnv: "لا متغيرات ولا أسرار بعد.",
    bundled: "كبير (مدمج)",
    up: "يعمل",
    down: "متوقف",
    unknown: "لم يُفحص بعد",
    off: "المراقبة متوقفة",
    uptime: "نسبة التشغيل",
    h24: "٢٤ ساعة",
    d7: "٧ أيام",
    d30: "٣٠ يومًا",
    latency: "متوسط زمن الاستجابة (٢٤ ساعة)",
    lastCheck: "آخر فحص",
    every: (s: number) => `يُفحص كل ${s >= 60 ? `${Math.round(s / 60)} دقيقة` : `${s} ثانية`}`,
    via: { get: "طلب GET للرابط", mcp: "MCP initialize" } as Record<string, string>,
    incidents: "الأعطال",
    noIncidents: "لا أعطال في آخر ٧ أيام.",
    from: "من",
    to: "إلى",
    ongoing: "مستمر",
    checks: "الفحوص",
    checkNow: "افحص الآن",
    enable: "تشغيل المراقبة",
    disable: "إيقاف المراقبة",
    healthHelp:
      "طلب واحد كل فترة: GET للرابط (وركرات الويب: أي رد أقل من 400 يعني أنه يعمل؛ خوادم MCP: أقل من 500)، أو MCP initialize لخوادم MCP التي ليس لها مصادقة خاصة. حدّد مسار فحص أو حالة متوقعة أدناه إن لم يكن / مناسبًا للفحص. فشلان متتاليان = متوقف؛ يصلك إشعار واحد (الجرس + الويب هوك) عند التوقف وواحد عند العودة.",
    target: "ماذا يطلب الفحص",
    healthPath: "مسار الفحص",
    healthPathHint: "مثل ‎/health (فارغ = رابط الوركر)",
    healthExpect: "الحالة المتوقعة",
    healthExpectHint: "مثل 2xx أو 200-399 أو 200,404 أو ‎<400 (فارغ = الافتراضي)",
    saveTarget: "حفظ الفحص",
    legacy: (s: string) =>
      `ردّ هذا الوركر بـ ${s} على / قبل الإصدار 0.16.0، لذا ما زال يُعدّ عاملًا بالقاعدة القديمة «أقل من 500». حدّد مسار فحص أو حالة متوقعة لتطبيق القاعدة الجديدة.`,
    latencyChart: "زمن الاستجابة خلال آخر ٢٤ ساعة (الأحمر = فحص فاشل)",
    logsHelp:
      "آخر الأخطاء خلال ٢٤ ساعة. أعداد الاستثناءات بالساعة من تحليلات Cloudflare؛ أسطر السجل الكاملة تحتاج تشغيل Workers Logs لهذا الوركر. تُنقّى الرسائل من أي شيء يشبه سرًّا، وتُحذف معاملات الاستعلام من الروابط.",
    logsOn: "سجلات Workers: تعمل",
    logsOff: "سجلات Workers: متوقفة",
    turnLogsOn: "تشغيل سجلات Workers",
    turnLogsOff: "إيقاف سجلات Workers",
    wlDenied: (e: string) =>
      `سجلات Workers تعمل لكن الرمز لا يستطيع قراءتها: ${e}. أضف "Account · Workers Observability: Read" لرمز Cloudflare.`,
    wlError: (e: string) => `فشل استعلام سجلات Workers: ${e}`,
    anDenied: (e: string) =>
      `التحليلات غير مقروءة بهذا الرمز: ${e}. أضف "Account · Account Analytics: Read".`,
    anError: (e: string) => `فشل استعلام التحليلات: ${e}`,
    time: "الوقت",
    level: "المستوى",
    src: "المصدر",
    kind: "النوع",
    message: "الرسالة",
    path: "المسار",
    noLogs: "لا أخطاء ولا أسطر سجل خلال آخر ٢٤ ساعة.",
    srcs: {
      "workers-logs": "سجلات Workers",
      analytics: "التحليلات",
      health: "فحص الصحة",
      deploy: "النشر",
    } as Record<string, string>,
    requests: "الطلبات",
    errors: "الأخطاء",
    cpu: "المعالج (الوسيط)",
    range: "المدى",
    usageHelp:
      "من تحليلات Cloudflare (تُخزّن ٥ دقائق). أعداد كل مفتاح من عدّادات حدود الطلبات في Spaces.",
    perKey: "الطلبات لكل مفتاح مستخدم",
    key: "المفتاح",
    total: "الإجمالي",
    limited: "مرفوضة بالحد",
    trend: "الاتجاه",
    noKeys: "لا مفاتيح مستخدمين لهذا الوركر.",
    usageError: (e: string) => `تحليلات Cloudflare غير متاحة: ${e}`,
    refresh: "تحديث",
    perms: "صلاحيات الرمز",
    permsWorkers: "رمز الوركرز (Spaces ← Cloudflare)",
    permsBackend: "تخزين البيانات والملفات (رمز KV + مفاتيح R2)",
    permsHelp:
      "كل سطر يُفحص بقراءة واحدة غير ضارة (بلا أي تغيير). الأخضر = ممنوحة، الأحمر = ناقصة، الرمادي = اختيارية أو لم تُفحص. تُخزّن النتائج ٥ دقائق ولا تُعرض قيمة الرمز أبدًا.",
    permission: "الصلاحية",
    unlocks: "ما تتيحه",
    result: "النتيجة",
    recheck: "إعادة الفحص",
    tokenActive: "الرمز فعّال",
    editConfirmed: "تأكّدت صلاحية التعديل بنشر ناجح",
    editPending: "القراءة تعمل؛ تتأكد صلاحية التعديل مع أول نشر",
    checked: "آخر فحص",
    checking: "يجري فحص المفتاح الآن. أعد تحميل الصفحة بعد ثوانٍ لترى النتيجة.",
    granted: "ممنوحة",
    missing: "ناقصة",
    unchecked: "لم تُفحص",
    optional: "اختيارية",
    progress: (g: number, n: number) => `${g}/${n} من الصلاحيات المطلوبة ممنوحة`,
    notConfigured: "غير مُعدّ.",
    feat: {
      everything: "كل ما يلي",
      deploy: "نشر الوركرز وإعادة نشرها والرجوع وحذفها",
      env: "قائمة المتغيرات والأسرار؛ إضافة الأسرار وتغييرها وحذفها",
      usage: "رسوم الاستخدام وأعداد الأخطاء وخطوط الجداول",
      logs: "تبويب السجلات (أسطر Workers Logs)",
      hosts: "النطاقات المخصصة (المسار + سجل DNS)",
      workersdev: "روابط workers.dev",
      tail: "المتابعة الحية (غير مستخدمة بعد)",
      kvbind: "ربط KV بالوركرز (غير مستخدم بعد)",
      r2bind: "ربط R2 بالوركرز (غير مستخدم بعد)",
      kv: "واجهة بيانات KV في Spaces",
      files: "واجهة الملفات في Spaces (R2)",
    } as Record<string, string>,
    intervalLabel: "فترة فحص الصحة (بالثواني)",
    saveInterval: "حفظ الفترة",
  },
};

const fmtN = (lang: Lang, n: number) => n.toLocaleString(lang === "ar" ? "ar-EG" : "en-US");
const pctLabel = (lang: Lang, p: number | null) => (p === null ? "—" : `${fmtN(lang, p)}%`);

// ---- charts ----------------------------------------------------------------------------

/** A tiny sparkline (requests over 24h) for table cells. */
export function sparkline(values: number[], label: string, w = 96, h = 24): string {
  if (!values.length) return "";
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map(
    (v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`,
  );
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}"><polyline fill="none" stroke="currentColor" stroke-width="1.5" points="${pts.join(" ")}"/></svg>`;
}

/** Bars for requests with errors stacked in red; optional CPU line. */
export function usageChart(lang: Lang, s: UsageSeries, title: string): string {
  const W = 720;
  const H = 180;
  const P = 28;
  const n = s.points.length || 1;
  const bw = (W - P * 2) / n;
  const max = Math.max(1, ...s.points.map((p) => p.requests));
  const cpuMax = Math.max(0.001, ...s.points.map((p) => p.cpuMs ?? 0));
  const y = (v: number) => H - P - (v / max) * (H - P * 2);
  const bars = s.points
    .map((p, i) => {
      const x = P + i * bw;
      const tip = `${p.t.slice(0, s.range === "30d" ? 10 : 13).replace("T", " ")}${s.range === "30d" ? "" : ":00"} · ${fmtN(lang, p.requests)} / ${fmtN(lang, p.errors)}${p.cpuMs !== null ? ` · ${p.cpuMs} ms` : ""}`;
      return `<g><title>${esc(tip)}</title><rect class="bar-req" x="${(x + 0.5).toFixed(1)}" y="${y(p.requests).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${(H - P - y(p.requests)).toFixed(1)}"/>${p.errors ? `<rect class="bar-err" x="${(x + 0.5).toFixed(1)}" y="${y(p.errors).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${(H - P - y(p.errors)).toFixed(1)}"/>` : ""}</g>`;
    })
    .join("");
  const cpuPts = s.points
    .map((p, i) =>
      p.cpuMs === null
        ? null
        : `${(P + i * bw + bw / 2).toFixed(1)},${(H - P - (p.cpuMs / cpuMax) * (H - P * 2)).toFixed(1)}`,
    )
    .filter(Boolean);
  const first = s.points[0]?.t ?? "";
  const last = s.points.at(-1)?.t ?? "";
  const lab = (t: string) =>
    s.range === "30d" ? t.slice(5, 10) : t.slice(5, 13).replace("T", " ");
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}" preserveAspectRatio="none">
<line class="axis" x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}"/>
<text class="tick" x="${P}" y="${P - 8}">${esc(fmtN(lang, max))}</text>
${bars}${cpuPts.length > 1 ? `<polyline class="cpu-line" fill="none" points="${cpuPts.join(" ")}"/>` : ""}
<text class="tick" x="${P}" y="${H - 8}">${esc(lab(first))}</text><text class="tick" text-anchor="end" x="${W - P}" y="${H - 8}">${esc(lab(last))}</text>
</svg><figcaption class="chart-legend"><span class="lg req"></span>${esc(OX[lang].requests)} <span class="lg err"></span>${esc(OX[lang].errors)} <span class="lg cpu"></span>${esc(OX[lang].cpu)}</figcaption></figure>`;
}

/** Latency dots/line over 24h; failed checks as red ticks. */
export function latencyChart(lang: Lang, h: HealthView): string {
  const W = 720;
  const H = 140;
  const P = 24;
  const s = h.series;
  if (!s.length) return "";
  const t0 = Date.now() - 86_400_000;
  const max = Math.max(50, ...s.filter((c) => c.ok).map((c) => c.ms));
  const x = (t: number) => P + ((t - t0) / 86_400_000) * (W - P * 2);
  const y = (ms: number) => H - P - (ms / max) * (H - P * 2);
  const ok = s.filter((c) => c.ok).map((c) => `${x(c.t).toFixed(1)},${y(c.ms).toFixed(1)}`);
  const bad = s
    .filter((c) => !c.ok)
    .map(
      (c) =>
        `<line class="fail-tick" x1="${x(c.t).toFixed(1)}" y1="${P}" x2="${x(c.t).toFixed(1)}" y2="${H - P}"><title>${esc(`${new Date(c.t).toISOString().slice(11, 16)} UTC · ${c.s || "—"}`)}</title></line>`,
    )
    .join("");
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(OX[lang].latencyChart)}" preserveAspectRatio="none">
<line class="axis" x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}"/><text class="tick" x="${P}" y="${P - 6}">${esc(`${fmtN(lang, max)} ms`)}</text>
${bad}${ok.length > 1 ? `<polyline class="lat-line" fill="none" points="${ok.join(" ")}"/>` : ""}
</svg><figcaption class="chart-legend">${esc(OX[lang].latencyChart)}</figcaption></figure>`;
}

// ---- table cells ---------------------------------------------------------------------------

export function healthBadge(lang: Lang, state: HealthView["state"]): string {
  const x = OX[lang];
  return state === "up"
    ? badge(x.up, "on")
    : state === "down"
      ? badge(x.down, "err")
      : state === "off"
        ? badge(x.off, "muted")
        : badge(x.unknown, "muted");
}

export function healthCellHtml(
  lang: Lang,
  h: { state: HealthView["state"]; d7: number | null } | undefined,
): string {
  if (!h) return "—";
  return `${healthBadge(lang, h.state)}${h.d7 !== null ? ` <span class="meta">${esc(pctLabel(lang, h.d7))} · ${esc(OX[lang].d7)}</span>` : ""}`;
}

export function sparkCellHtml(lang: Lang, s: UsageSeries | undefined): string {
  if (!s || s.error) return `<span class="meta">—</span>`;
  return `${sparkline(
    s.points.map((p) => p.requests),
    `${OX[lang].requests} 24h: ${s.total.requests}`,
  )} <span class="meta">${esc(fmtN(lang, s.total.requests))}</span>`;
}

// ---- tabs ------------------------------------------------------------------------------------

export interface OpsTabCtx {
  lang: Lang;
  csrf: string;
  /** This page (with ?tab=…) for back links. */
  self: string;
  /** Form action builder: "secret" → /team/workers/x/secret or /admin/workers/:id/secret */
  act: (what: "secret" | "var" | "health" | "logs") => string;
  canEdit: boolean;
  /** Plain vars can be edited (needs a stored version). */
  canVars: boolean;
  /** Prefill for the secret name (?name=…). */
  prefill?: string;
  /** 0.16.0: declared health path and expected statuses. */
  healthTarget?: { path: string; expect: string };
}

const back = (p: string) => `<input type="hidden" name="back" value="${esc(p)}">`;

export function envTab(o: OpsTabCtx, v: EnvView): string {
  const { lang } = o;
  const x = OX[lang];
  const tone = (s: string) => (s === "set" ? "on" : s === "empty" ? "warn" : "err");
  const rows: DtRow[] = v.entries.map((e) => {
    const actions: DtRow["actions"] = [];
    if (o.canEdit && (e.kind === "secret" || (e.kind === "var" && o.canVars))) {
      actions.push({
        kind: "post",
        label: x.del,
        action: o.act(e.kind === "secret" ? "secret" : "var"),
        danger: true,
        confirm: x.delConfirm(e.name),
        hidden: { name: e.name, op: "delete", back: o.self },
      });
    }
    if (o.canEdit && (e.kind === "missing" || e.kind === "unset" || e.kind === "secret"))
      actions.push({
        kind: "link",
        label: x.setIt,
        href: `${o.self}${o.self.includes("?") ? "&" : "?"}name=${encodeURIComponent(e.name)}#env-secret`,
        icon: "key",
        primary: true,
      });
    return {
      label: e.name,
      head: `<code class="ltr">${esc(e.name)}</code>`,
      headV: e.name,
      cells: [
        {
          html: badge(
            x.kinds[e.kind] ?? e.kind,
            e.kind === "missing" ? "err" : e.kind === "secret" ? "info" : "muted",
          ),
          v: e.kind,
        },
        { html: `<code class="ltr">${esc(e.type)}</code>`, v: e.type },
        {
          html: `${badge(x.st[e.status] ?? e.status, tone(e.status))}${e.bundled ? ` <span class="meta">${esc(x.bundled)}</span>` : ""}`,
          v: e.status,
        },
        {
          html: e.expected
            ? `<span class="meta">${esc(e.expected === "declared" ? x.whyDeclared : x.whyCode)}</span>`
            : "",
          v: e.expected ?? "",
        },
        {
          html: e.updatedAt
            ? `${relTime(e.updatedAt, lang)}${e.updatedBy ? ` <span class="meta"><bdi>${esc(actorText(lang, e.updatedBy))}</bdi></span>` : ""}`
            : "—",
          v: e.updatedAt ?? "",
        },
        {
          html: `<span class="meta">${esc(e.source === "cloudflare" ? x.srcLive : x.srcSpaces)}</span>`,
          v: e.source,
        },
      ],
      actions,
      filters: { kind: e.kind, status: e.status },
    };
  });
  const missing = v.missing.length
    ? `<div class="flash warn" role="status"><strong>${esc(x.missingTitle(v.missing.length))}</strong><ul class="missing-env">${v.missing
        .map(
          (m) =>
            `<li><code class="ltr">${esc(m.name)}</code> <span class="meta">${esc(m.why === "declared" ? x.whyDeclared : x.whyCode)}</span></li>`,
        )
        .join("")}</ul></div>`
    : "";
  const unsetN = v.unset?.length ?? 0;
  const info = unsetN ? `<p class="meta env-unset">${esc(x.unsetNote(unsetN))}</p>` : "";
  const live = v.liveError ? `<p class="notice">${esc(x.liveFail(v.liveError))}</p>` : "";
  const table = dataTable({
    lang,
    id: "env-table",
    caption: x.env,
    headLabel: x.name,
    cols: [
      { label: x.type, sort: "text" },
      { label: "Cloudflare", sort: "text" },
      { label: x.status, sort: "text" },
      { label: x.expected },
      { label: x.updated, sort: "date" },
      { label: x.source },
      { label: "", srOnly: true },
    ],
    rows,
    csrf: o.csrf,
    empty: x.noEnv,
    filters: [
      {
        key: "kind",
        label: x.type,
        options: [...new Set(v.entries.map((e) => e.kind))].map((k) => [k, x.kinds[k] ?? k]),
      },
      {
        key: "status",
        label: x.status,
        options: [...new Set(v.entries.map((e) => e.status))].map((k) => [k, x.st[k] ?? k]),
      },
    ],
  });
  const forms = o.canEdit
    ? `<div class="detail-cols">
  <form method="post" action="${esc(o.act("secret"))}" class="panel stack-form" id="env-secret" autocomplete="off">${csrfField(o.csrf)}${back(o.self)}<input type="hidden" name="op" value="set">
    <h2 class="h3">${icon("key")} ${esc(x.setSecret)}</h2><p class="meta">${esc(x.setSecretHelp)}</p>
    <label for="sec-name">${esc(x.name)}</label><input id="sec-name" name="name" dir="ltr" required pattern="[A-Za-z_][A-Za-z0-9_]{0,63}" value="${esc(o.prefill ?? "")}" list="env-names" autocomplete="off" spellcheck="false">
    <label for="sec-value">${esc(x.secretValue)}</label><input id="sec-value" name="value" type="password" dir="ltr" required autocomplete="new-password" spellcheck="false">
    <button class="button small" type="submit" data-busy>${esc(x.saveSecret)}</button></form>
  ${
    o.canVars
      ? `<form method="post" action="${esc(o.act("var"))}" class="panel stack-form" autocomplete="off">${csrfField(o.csrf)}${back(o.self)}<input type="hidden" name="op" value="set">
    <h2 class="h3">${esc(x.setVar)}</h2><p class="meta">${esc(x.setVarHelp)}</p>
    <label for="var-name">${esc(x.name)}</label><input id="var-name" name="name" dir="ltr" required pattern="[A-Za-z_][A-Za-z0-9_]{0,63}" autocomplete="off" spellcheck="false">
    <label for="var-value">${esc(x.varValue)}</label><input id="var-value" name="value" dir="ltr" autocomplete="off" spellcheck="false">
    <button class="button small" type="submit" data-busy>${esc(x.saveVar)}</button></form>`
      : ""
  }
  <datalist id="env-names">${v.entries
    .filter((e) => e.kind === "secret" || e.kind === "missing")
    .map((e) => `<option value="${esc(e.name)}">`)
    .join("")}</datalist></div>`
    : "";
  return `<p class="meta">${esc(x.envHelp)}</p>${live}${missing}${info}${table}<p class="meta">${esc(x.requiredEnvHint)}</p>${forms}`;
}

export function healthTab(o: OpsTabCtx, h: HealthView, active: boolean): string {
  const { lang } = o;
  const x = OX[lang];
  const stat = (label: string, val: string) =>
    `<div class="stat-card"><div class="stat-head"><span>${esc(label)}</span></div><div class="stat-value small">${val}</div></div>`;
  const controls = o.canEdit
    ? `<div class="row-acts">${
        active && h.enabled
          ? postForm(
              o.act("health"),
              o.csrf,
              `${back(o.self)}<input type="hidden" name="op" value="check"><button class="button small" type="submit" data-busy>${icon("redeploy")}${esc(x.checkNow)}</button>`,
            )
          : ""
      }${postForm(o.act("health"), o.csrf, `${back(o.self)}<input type="hidden" name="op" value="${h.enabled ? "off" : "on"}"><button class="button small ghost" type="submit">${icon("power")}${esc(h.enabled ? x.disable : x.enable)}</button>`)}</div>`
    : "";
  const incRows: DtRow[] = h.incidents.map((i, n) => ({
    label: `#${n + 1}`,
    head: timeTag(lang, i.from),
    headV: i.from,
    cells: [
      { html: i.to ? timeTag(lang, i.to) : badge(x.ongoing, "err"), v: i.to ?? "" },
      { html: esc(fmtN(lang, i.checks)), v: i.checks },
      { html: `<code class="ltr">${i.status ? `HTTP ${i.status}` : "—"}</code>`, v: i.status },
    ],
  }));
  return `<div class="detail-head slim"><div>${healthBadge(lang, h.state)} ${h.since ? `<span class="meta">${relTime(h.since, lang)}</span>` : ""}<p class="meta">${esc(x.every(h.intervalSec))}${h.last ? ` · ${esc(x.via[h.last.via] ?? h.last.via)}` : ""}</p></div>${controls}</div>
<div class="stat-grid">
${stat(`${x.uptime} · ${x.h24}`, esc(pctLabel(lang, h.uptime.h24)))}
${stat(`${x.uptime} · ${x.d7}`, esc(pctLabel(lang, h.uptime.d7)))}
${stat(`${x.uptime} · ${x.d30}`, esc(pctLabel(lang, h.uptime.d30)))}
${stat(x.latency, esc(h.avgMs24 === null ? "—" : `${fmtN(lang, h.avgMs24)} ms`))}
${stat(x.lastCheck, h.last ? `${timeTag(lang, h.last.at)} <span class="meta">${h.last.s ? `HTTP ${h.last.s}` : "—"} · ${fmtN(lang, h.last.ms)} ms</span>` : "—")}
</div>
${latencyChart(lang, h)}
<section class="panel"><h2 class="h3">${esc(x.incidents)}</h2>${dataTable({ lang, id: "incidents", caption: x.incidents, headLabel: x.from, cols: [{ label: x.to }, { label: x.checks, sort: "num" }, { label: x.status }], rows: incRows, empty: x.noIncidents, search: false })}</section>
${healthTargetPanel(o, h)}
<p class="meta">${esc(x.healthHelp)}</p>`;
}

/** 0.16.0: the rule the check uses, the legacy note, and the path/expected-status form. */
function healthTargetPanel(o: OpsTabCtx, h: HealthView): string {
  const x = OX[o.lang];
  const legacy =
    h.legacy && h.last
      ? `<p class="notice">${esc(x.legacy(h.last.s ? `HTTP ${h.last.s}` : "4xx"))}</p>`
      : "";
  const rule = h.rule ? `<p class="meta"><code class="ltr">${esc(h.rule)}</code></p>` : "";
  const form =
    o.canEdit && o.healthTarget
      ? `<form method="post" action="${esc(o.act("health"))}" class="health-target">${csrfField(o.csrf)}${back(o.self)}<input type="hidden" name="op" value="target">
<div class="field"><label for="hc-path">${esc(x.healthPath)}</label><input id="hc-path" name="healthPath" dir="ltr" maxlength="200" placeholder="/health" value="${esc(o.healthTarget.path)}" aria-describedby="hc-path-h"><p class="meta" id="hc-path-h">${esc(x.healthPathHint)}</p></div>
<div class="field"><label for="hc-exp">${esc(x.healthExpect)}</label><input id="hc-exp" name="healthExpect" dir="ltr" maxlength="60" placeholder="2xx" value="${esc(o.healthTarget.expect)}" aria-describedby="hc-exp-h"><p class="meta" id="hc-exp-h">${esc(x.healthExpectHint)}</p></div>
<button class="button small" type="submit">${esc(x.saveTarget)}</button></form>`
      : "";
  return `<section class="panel" aria-labelledby="hc-target"><h2 class="h3" id="hc-target">${esc(x.target)}</h2>${rule}${legacy}${form}</section>`;
}

export function logsTab(o: OpsTabCtx, logsOn: boolean, r: LogsResult): string {
  const { lang } = o;
  const x = OX[lang];
  const notes = [
    r.workersLogs === "denied"
      ? `<p class="flash err" role="alert">${esc(x.wlDenied(r.workersLogsError ?? ""))}</p>`
      : "",
    r.workersLogs === "error"
      ? `<p class="notice">${esc(x.wlError(r.workersLogsError ?? ""))}</p>`
      : "",
    r.analytics === "denied"
      ? `<p class="flash err" role="alert">${esc(x.anDenied(r.analyticsError ?? ""))}</p>`
      : "",
    r.analytics === "error"
      ? `<p class="notice">${esc(x.anError(r.analyticsError ?? ""))}</p>`
      : "",
  ].join("");
  const toggle = o.canEdit
    ? postForm(
        o.act("logs"),
        o.csrf,
        `${back(o.self)}<input type="hidden" name="op" value="${logsOn ? "off" : "on"}"><button class="button small ghost" type="submit" data-busy>${esc(logsOn ? x.turnLogsOff : x.turnLogsOn)}</button>`,
      )
    : "";
  const lvTone = (l: string) => (l === "error" ? "err" : l === "warn" ? "warn" : "muted");
  const rows: DtRow[] = r.entries.map((e, i) => ({
    label: `${e.kind} ${i + 1}`,
    head: timeTag(lang, e.at),
    headV: e.at,
    cells: [
      { html: badge(e.level, lvTone(e.level)), v: e.level },
      { html: esc(x.srcs[e.source] ?? e.source), v: e.source },
      { html: `<code class="ltr">${esc(e.kind)}</code>`, v: e.kind },
      { html: `<span class="log-msg ltr" dir="ltr">${esc(e.message)}</span>`, v: e.message },
      {
        html: e.url
          ? `<code class="ltr">${esc(e.url)}</code>${e.status ? ` <span class="meta">${e.status}</span>` : ""}`
          : "—",
        v: e.url ?? "",
      },
    ],
    filters: { level: e.level, source: e.source, kind: e.kind },
  }));
  const uniq = (k: "level" | "source" | "kind") => [...new Set(r.entries.map((e) => e[k]))];
  return `<div class="detail-head slim"><div>${badge(logsOn ? x.logsOn : x.logsOff, logsOn ? "on" : "muted")} <span class="meta">${esc(x.checked)} ${relTime(r.at, lang)}</span></div><div class="row-acts"><a class="button small ghost" href="${esc(`${o.self}${o.self.includes("?") ? "&" : "?"}refresh=1`)}">${icon("redeploy")}${esc(x.refresh)}</a>${toggle}</div></div>
${notes}${dataTable({
  lang,
  id: "logs-table",
  caption: x.logs,
  headLabel: x.time,
  cols: [
    { label: x.level, sort: "text" },
    { label: x.src },
    { label: x.kind },
    { label: x.message },
    { label: x.path },
  ],
  rows,
  empty: x.noLogs,
  filters: [
    { key: "level", label: x.level, options: uniq("level").map((v) => [v, v]) },
    { key: "source", label: x.src, options: uniq("source").map((v) => [v, x.srcs[v] ?? v]) },
    { key: "kind", label: x.kind, options: uniq("kind").map((v) => [v, v]) },
  ],
  pageSize: 25,
})}<p class="meta">${esc(x.logsHelp)}</p>`;
}

export function usageTab(
  o: OpsTabCtx,
  range: UsageRange,
  s: UsageSeries,
  keys: KeyUsageRow[],
  rangeHref: (r: UsageRange) => string,
): string {
  const { lang } = o;
  const x = OX[lang];
  const ranges = (["24h", "7d", "30d"] as UsageRange[])
    .map(
      (r) =>
        `<a class="chip${r === range ? " active" : ""}" href="${esc(rangeHref(r))}"${r === range ? ' aria-current="true"' : ""}>${esc(r === "24h" ? x.h24 : r === "7d" ? x.d7 : x.d30)}</a>`,
    )
    .join("");
  const stat = (label: string, val: string) =>
    `<div class="stat-card"><div class="stat-head"><span>${esc(label)}</span></div><div class="stat-value small">${esc(val)}</div></div>`;
  const keyRows: DtRow[] = keys.map((k) => ({
    label: k.label || k.prefix,
    head: `<bdi>${esc(k.label || "—")}</bdi> <code class="ltr meta">${esc(k.prefix)}…</code>`,
    headV: k.label,
    cells: [
      {
        html: sparkline(
          k.days.map((d) => d.n),
          `${k.label}: ${k.total}`,
        ),
        v: k.total,
      },
      { html: esc(fmtN(lang, k.total)), v: k.total },
      { html: k.limited ? badge(fmtN(lang, k.limited), "warn") : "0", v: k.limited },
      { html: badge(k.state, k.state === "active" ? "on" : "muted"), v: k.state },
    ],
  }));
  return `<nav class="range-chips" aria-label="${esc(x.range)}">${ranges}</nav>
${s.error ? `<p class="flash err" role="alert">${esc(x.usageError(s.error))}</p>` : ""}
<div class="stat-grid">${stat(x.requests, fmtN(lang, s.total.requests))}${stat(x.errors, fmtN(lang, s.total.errors))}${stat(x.cpu, s.total.cpuMs === null ? "—" : `${s.total.cpuMs} ms`)}</div>
${usageChart(lang, s, `${x.requests} · ${range}`)}
<section class="panel"><h2 class="h3">${esc(x.perKey)}</h2>${dataTable({ lang, id: "key-usage", caption: x.perKey, headLabel: x.key, cols: [{ label: x.trend }, { label: x.total, sort: "num" }, { label: x.limited, sort: "num" }, { label: x.status }], rows: keyRows, empty: x.noKeys, search: false })}</section>
<p class="meta">${esc(x.usageHelp)}</p>`;
}

// ---- token permissions ---------------------------------------------------------------------

function light(c: PermCheck): string {
  const cls = c.state === "granted" ? "on" : c.state === "missing" && c.required ? "err" : "off";
  return `<span class="light ${cls}" aria-hidden="true"></span>`;
}

/** 0.16.0: our own notes are translated; Cloudflare's messages stay as they are (LTR). */
function permNote(lang: Lang, note: string): string {
  const x = OX[lang];
  const m = /^edit confirmed by a successful deploy \((.+)\)$/.exec(note);
  if (m)
    return `<p class="meta perm-note">${esc(x.editConfirmed)} · ${timeTag(lang, m[1] as string)}</p>`;
  if (note === "read OK; edit is confirmed by the first deploy")
    return `<p class="meta perm-note">${esc(x.editPending)}</p>`;
  return `<p class="meta perm-note" dir="ltr">${esc(note)}</p>`;
}

export function permsPanel(
  lang: Lang,
  title: string,
  r: PermReport,
  recheck: string,
  csrf: string,
  self: string,
): string {
  const x = OX[lang];
  if (!r.configured)
    return `<section class="panel perms"><h2 class="h3">${esc(title)}</h2><p class="meta">${esc(x.notConfigured)}</p></section>`;
  const head = `<div class="detail-head slim"><h2 class="h3">${esc(title)}</h2>${postForm(recheck, csrf, `${back(self)}<button class="button small ghost" type="submit" data-busy>${icon("redeploy")}${esc(x.recheck)}</button>`)}</div>`;
  if (!r.at)
    return `<section class="panel perms" aria-busy="true">${head}<p class="meta">${esc(x.checking)}</p></section>`;
  const pct = r.required ? Math.round((r.granted / r.required) * 100) : 0;
  const items = r.checks
    .map((c) => {
      const stateLabel =
        c.state === "granted" ? x.granted : c.state === "missing" ? x.missing : x.unchecked;
      return `<li class="perm-row perm-${c.state}${c.required ? "" : " perm-optional"}" data-perm="${esc(c.id)}">${light(c)}<div class="perm-body"><p><strong${c.id === "token" ? "" : ' dir="ltr"'}>${esc(c.id === "token" ? x.tokenActive : c.permission)}</strong>${c.required ? "" : ` <span class="badge muted">${esc(x.optional)}</span>`} <span class="meta">— ${esc(stateLabel)}</span></p><p class="meta">${esc(x.unlocks)}: ${esc(x.feat[c.unlocks] ?? c.unlocks)}</p>${c.note ? permNote(lang, c.note) : ""}</div></li>`;
    })
    .join("");
  return `<section class="panel perms"><div class="detail-head slim"><h2 class="h3">${esc(title)}</h2>${postForm(recheck, csrf, `${back(self)}<button class="button small ghost" type="submit" data-busy>${icon("redeploy")}${esc(x.recheck)}</button>`)}</div>
<div class="perm-progress"><progress class="quota perm-bar" max="${Math.max(1, r.required)}" value="${r.granted}" aria-label="${esc(x.progress(r.granted, r.required))}">${pct}%</progress><p><strong>${esc(x.progress(r.granted, r.required))}</strong> <span class="meta">${relTime(r.at, lang)}</span></p></div>
<ul class="perm-list">${items}</ul></section>`;
}

export function permsSection(
  lang: Lang,
  workers: PermReport | null,
  backend: PermReport | null,
  recheck: string,
  csrf: string,
  self: string,
  intervalForm = "",
): string {
  const x = OX[lang];
  return `<section class="perms-wrap" id="permissions"><h2>${esc(x.perms)}</h2><p class="meta">${esc(x.permsHelp)}</p>
${workers ? permsPanel(lang, x.permsWorkers, workers, recheck, csrf, self) : ""}
${backend ? permsPanel(lang, x.permsBackend, backend, recheck, csrf, self) : ""}${intervalForm}</section>`;
}

export function intervalForm(
  lang: Lang,
  action: string,
  csrf: string,
  self: string,
  sec: number,
): string {
  const x = OX[lang];
  return `<form method="post" action="${esc(action)}" class="panel inline-form">${csrfField(csrf)}${back(self)}<label for="hc-int">${esc(x.intervalLabel)}</label> <input id="hc-int" class="days-input" name="intervalSec" type="number" min="60" max="3600" value="${sec}" inputmode="numeric"> <button class="button small" type="submit">${esc(x.saveInterval)}</button></form>`;
}
