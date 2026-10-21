/**
 * 0.16.0 admin panels: backups, the team trash, "sign out everywhere", and the
 * typed-name team delete form.
 */
import type { BackupStatus } from "./backup.js";
import type { Lang } from "./i18n.js";
import { csrfField, esc, fmt, icon, localePath, postForm } from "./ui.js";
import { badge, relTime } from "./ui-table.js";

const L = {
  en: {
    backups: "Backups",
    backupsSub:
      "Every day the whole data folder is packed, encrypted (AES-256-GCM, key derived from BACKUP_KEY or MARSA_SECRETS_KEY) and stored off the server. Each backup is read back and checked.",
    offsite: "Off-site (R2)",
    local: "Local folder (not off-site)",
    off: "Off",
    where: "Stored in",
    last: "Last backup",
    lastOk: "Last good backup",
    next: "Next run",
    kept: "Kept",
    keptN: (n: string, d: string, w: string) => `${n} (keeps ${d} daily + ${w} weekly)`,
    restoreTest: "Last restore test",
    never: "Never",
    ok: "OK",
    failed: "Failed",
    files: (n: string) => `${n} files`,
    runNow: "Back up now",
    testRestore: "Test a restore",
    testRestoreHelp:
      "Restores the newest backup into a scratch folder, checks it, then deletes the folder. Live data is not touched.",
    howRestore: "How to restore",
    restoreSteps: [
      "List the backups and pick one (newest first):",
      "Restore it into a new, empty folder inside the data volume:",
      "Stop the service, swap the folders, start it again:",
    ],
    restoreNote:
      "Keep the key: a backup cannot be opened without BACKUP_KEY (or MARSA_SECRETS_KEY when no separate key is set).",
    history: "Recent runs",
    trash: "Deleted teams",
    trashSub:
      "Deleted teams wait here for 7 days. Restore brings back the team, its keys, members and Workers. After the grace period the team is deleted for good.",
    trashEmpty: "No deleted teams.",
    purgeOn: (d: string) => `Deleted for good ${d}`,
    deletedBy: "by",
    restore: "Restore",
    download: "Download export",
    deleteNow: "Delete now",
    typeName: "Type the team name to confirm",
    deleteNowConfirm: "Delete this team for good now? This cannot be undone.",
    sitesToo: "its spaces too",
    workersOff: (n: string) => `${n} Workers turned off`,
    sessions: "Sign out everywhere",
    sessionsAdminHelp:
      "Ends every admin session on every device, this one too. Sessions survive restarts, so this is how you end them all.",
    sessionsTeamHelp:
      "Ends every session of this team (team key and members) on every device, this one too.",
    signOutAll: "Sign out everywhere",
    signOutAllConfirm: "End every session, this one too?",
    lastEnded: "Last time",
    exportTeam: "Export team",
    exportHelp:
      "A zip with members (no passwords), activity, spaces and their files, data, Workers (code and versions), agent keys (no secrets), recipes, notes and notifications.",
    deleteTeam: "Delete this team",
    deleteHelp:
      "The team goes to Deleted teams for 7 days: an export is saved first, its Workers are turned off and its keys stop working. You can restore it until then.",
    alsoSites: "Delete its spaces too when the grace period ends",
    moved: (d: string) =>
      `Moved to Deleted teams. You can restore it until ${d} (Settings › Deleted teams).`,
    restored: "Team restored. Its keys, members and Workers work again.",
    purged: "Team deleted for good.",
    mismatch: "The name you typed does not match the team. Nothing was deleted.",
    backupOk: (n: string) => `Backup done and verified (${n}).`,
    backupFail: (e: string) => `Backup failed: ${e}`,
    restoreOk: (n: string) =>
      `Restore test passed: ${n} files restored into a scratch folder and checked.`,
    restoreFail: (e: string) => `Restore test failed: ${e}`,
    backupsOff: "Backups are off on this server.",
    teamSignedOut: "Every session of the team has ended. Sign in again.",
  },
  ar: {
    backups: "النسخ الاحتياطية",
    backupsSub:
      "كل يوم يُحزَم مجلد البيانات كاملًا ويُشفَّر (AES-256-GCM بمفتاح مشتق من BACKUP_KEY أو MARSA_SECRETS_KEY) ويُحفظ خارج الخادم. تُقرأ كل نسخة بعد حفظها ويُتحقَّق منها.",
    offsite: "خارج الخادم (R2)",
    local: "مجلد محلي (ليس خارج الخادم)",
    off: "متوقفة",
    where: "مكان الحفظ",
    last: "آخر نسخة",
    lastOk: "آخر نسخة سليمة",
    next: "التشغيل القادم",
    kept: "المحفوظ",
    keptN: (n: string, d: string, w: string) => `${n} (تُحفظ ${d} يومية + ${w} أسبوعية)`,
    restoreTest: "آخر اختبار استعادة",
    never: "أبدًا",
    ok: "سليمة",
    failed: "فشلت",
    files: (n: string) => `${n} ملفات`,
    runNow: "انسخ الآن",
    testRestore: "اختبر الاستعادة",
    testRestoreHelp:
      "تستعيد أحدث نسخة في مجلد مؤقت وتفحصها ثم تحذف المجلد. لا تُلمَس البيانات الحية.",
    howRestore: "طريقة الاستعادة",
    restoreSteps: [
      "اعرض النسخ واختر واحدة (الأحدث أولًا):",
      "استعدها في مجلد جديد فارغ داخل مجلد البيانات:",
      "أوقف الخدمة وبدّل المجلدين ثم شغّلها من جديد:",
    ],
    restoreNote:
      "احتفظ بالمفتاح: لا تُفتح النسخة بدون BACKUP_KEY (أو MARSA_SECRETS_KEY إن لم يُضبط مفتاح منفصل).",
    history: "آخر التشغيلات",
    trash: "الفرق المحذوفة",
    trashSub:
      "تبقى الفرق المحذوفة هنا 7 أيام. الاستعادة تعيد الفريق ومفاتيحه وأعضاءه ووركرزه. بعد المهلة يُحذف الفريق نهائيًا.",
    trashEmpty: "لا فرق محذوفة.",
    purgeOn: (d: string) => `يُحذف نهائيًا ${d}`,
    deletedBy: "بواسطة",
    restore: "استعد",
    download: "نزّل التصدير",
    deleteNow: "احذف الآن",
    typeName: "اكتب اسم الفريق للتأكيد",
    deleteNowConfirm: "تحذف هذا الفريق نهائيًا الآن؟ لا يمكن التراجع.",
    sitesToo: "ومساحاته أيضًا",
    workersOff: (n: string) => `أُوقف ${n} وركر`,
    sessions: "اخرج من كل الأجهزة",
    sessionsAdminHelp:
      "تنهي كل جلسات المشرف على كل الأجهزة، وهذه أيضًا. الجلسات تبقى بعد إعادة التشغيل، فهذه طريقة إنهائها كلها.",
    sessionsTeamHelp: "تنهي كل جلسات هذا الفريق (مفتاح الفريق والأعضاء) على كل الأجهزة، وهذه أيضًا.",
    signOutAll: "اخرج من كل الأجهزة",
    signOutAllConfirm: "تنهي كل الجلسات، وهذه أيضًا؟",
    lastEnded: "آخر مرة",
    exportTeam: "صدّر الفريق",
    exportHelp:
      "ملف zip فيه الأعضاء (بدون كلمات المرور) والنشاط والمساحات وملفاتها وبياناتها والوركرز (الكود والإصدارات) ومفاتيح الوكلاء (بدون أسرار) والوصفات والملاحظات والإشعارات.",
    deleteTeam: "احذف هذا الفريق",
    deleteHelp:
      "ينتقل الفريق إلى الفرق المحذوفة 7 أيام: يُحفظ تصدير أولًا وتُوقف وركرزه وتتوقف مفاتيحه. يمكنك استعادته حتى ذلك الحين.",
    alsoSites: "احذف مساحاته أيضًا عند انتهاء المهلة",
    moved: (d: string) =>
      `نُقل الفريق إلى الفرق المحذوفة. يمكنك استعادته حتى ${d} (الإعدادات › الفرق المحذوفة).`,
    restored: "استُعيد الفريق. عادت مفاتيحه وأعضاؤه ووركرزه للعمل.",
    purged: "حُذف الفريق نهائيًا.",
    mismatch: "الاسم المكتوب لا يطابق الفريق. لم يُحذف شيء.",
    backupOk: (n: string) => `تمت النسخة وتم التحقق منها (${n}).`,
    backupFail: (e: string) => `فشلت النسخة: ${e}`,
    restoreOk: (n: string) => `نجح اختبار الاستعادة: استُعيد ${n} ملفًا في مجلد مؤقت وفُحصت.`,
    restoreFail: (e: string) => `فشل اختبار الاستعادة: ${e}`,
    backupsOff: "النسخ الاحتياطية متوقفة على هذا الخادم.",
    teamSignedOut: "انتهت كل جلسات الفريق. سجّل الدخول من جديد.",
  },
};

/** Flash texts for the lifecycle routes. */
export const lifecycleText = (lang: Lang) => L[lang];

const mb = (lang: Lang, n?: number) =>
  n === undefined
    ? ""
    : n < 1024 * 1024
      ? `${fmt(lang, Math.max(1, Math.round(n / 1024)))} KB`
      : `${fmt(lang, Math.round((n / 1024 / 1024) * 10) / 10)} MB`;

export interface TrashRow {
  id: string;
  name: string;
  deletedAt: string;
  purgeAfter: string;
  deletedBy: string;
  deleteSites: boolean;
  workersTurnedOff: number;
  hasExport: boolean;
}

/** Admin Settings: the backups card. */
export function backupsSection(lang: Lang, s: BackupStatus, csrf: string, back: string): string {
  const x = L[lang];
  const href = (p: string) => localePath(lang, p);
  const run = (r: BackupStatus["last"]) =>
    r
      ? `${badge(r.ok ? x.ok : x.failed, r.ok ? "on" : "err")} ${relTime(r.at, lang)}${r.ok && r.bytes !== undefined ? ` <span class="meta">${esc(`${mb(lang, r.bytes)} · ${x.files(fmt(lang, r.files ?? 0))}`)}</span>` : ""}${!r.ok && r.error ? ` <span class="meta">${esc(r.error)}</span>` : ""}`
      : `<span class="meta">${esc(x.never)}</span>`;
  const rt = s.restoreTest;
  const backField = `<input type="hidden" name="back" value="${esc(back)}">`;
  const cmd = (c: string) => `<pre tabindex="0" dir="ltr"><code>${esc(c)}</code></pre>`;
  const steps = [
    "docker compose exec marsa node dist/backup-cli.js list",
    "docker compose exec marsa node dist/backup-cli.js restore _marsa-backups/<month>/<file>.msb /data/tmp/restore",
    "docker compose stop marsa\nmv /var/lib/marsa-data/tmp/restore /var/lib/marsa-data.restored\nmv /var/lib/marsa-data /var/lib/marsa-data.old && mv /var/lib/marsa-data.restored /var/lib/marsa-data\ndocker compose start marsa",
  ];
  const where = !s.enabled
    ? `${badge(x.off, "warn")}${s.reason ? ` <span class="meta">${esc(s.reason)}</span>` : ""}`
    : `${badge(s.offsite ? x.offsite : x.local, s.offsite ? "on" : "warn")} <code class="ltr">${esc((s.where ?? "").replace(/^(R2 bucket|directory) /, ""))}</code>`;
  return `<section class="card-block" id="backups" aria-labelledby="bk-title">
  <h2 id="bk-title" class="h3">${icon("download")} ${esc(x.backups)}</h2>
  <p class="meta">${esc(x.backupsSub)}</p>
  <dl class="facts">
    <div class="fact-wide"><dt>${esc(x.where)}</dt><dd>${where}</dd></div>
    <div class="fact-wide"><dt>${esc(x.last)}</dt><dd>${run(s.last)}</dd></div>
    ${s.last && !s.last.ok ? `<div class="fact-wide"><dt>${esc(x.lastOk)}</dt><dd>${run(s.lastOk)}</dd></div>` : ""}
    <div><dt>${esc(x.next)}</dt><dd>${s.nextDue ? relTime(s.nextDue, lang) : `<span class="meta">—</span>`}</dd></div>
    <div><dt>${esc(x.kept)}</dt><dd>${esc(x.keptN(fmt(lang, s.kept.length), fmt(lang, s.schedule.keepDaily), fmt(lang, s.schedule.keepWeekly)))}</dd></div>
    <div class="fact-wide"><dt>${esc(x.restoreTest)}</dt><dd>${rt ? `${badge(rt.ok ? x.ok : x.failed, rt.ok ? "on" : "err")} ${relTime(rt.at, lang)}${rt.files !== undefined ? ` <span class="meta">${esc(x.files(fmt(lang, rt.files)))}</span>` : ""}${rt.error ? ` <span class="meta">${esc(rt.error)}</span>` : ""}` : `<span class="meta">${esc(x.never)}</span>`}</dd></div>
  </dl>
  ${
    s.enabled
      ? `<div class="acts">${postForm(href("/admin/backups/run"), csrf, `${backField}<button class="button small" type="submit" data-busy>${esc(x.runNow)}</button>`)}${postForm(href("/admin/backups/test-restore"), csrf, `${backField}<button class="button small ghost" type="submit" data-busy title="${esc(x.testRestoreHelp)}">${esc(x.testRestore)}</button>`)}</div>
  <p class="form-help">${esc(x.testRestoreHelp)}</p>`
      : ""
  }
  <details class="restore-how"><summary>${esc(x.howRestore)}</summary>
    <ol class="restore-steps">${x.restoreSteps.map((t, i) => `<li><p>${esc(t)}</p>${cmd(steps[i] ?? "")}</li>`).join("")}</ol>
    <p class="meta">${esc(x.restoreNote)}</p>
  </details>
</section>`;
}

/** Admin Settings: deleted teams waiting out their grace period. */
export function trashSection(lang: Lang, rows: TrashRow[], csrf: string, back: string): string {
  const x = L[lang];
  const href = (p: string) => localePath(lang, p);
  const backField = `<input type="hidden" name="back" value="${esc(back)}">`;
  const item = (r: TrashRow) => {
    const fid = `tr-${esc(r.id)}`;
    return `<li class="trash-row">
    <div><strong dir="auto">${esc(r.name)}</strong> <code class="ltr meta">${esc(r.id)}</code>
      <p class="meta">${relTime(r.deletedAt, lang)} ${esc(x.deletedBy)} ${esc(r.deletedBy)} · ${esc(x.purgeOn(""))}${relTime(r.purgeAfter, lang)}${r.workersTurnedOff ? ` · ${esc(x.workersOff(fmt(lang, r.workersTurnedOff)))}` : ""}${r.deleteSites ? ` · ${esc(x.sitesToo)}` : ""}</p></div>
    <div class="acts">
      ${postForm(href(`/admin/trash/${r.id}/restore`), csrf, `${backField}<button class="button small" type="submit">${icon("rotate")}${esc(x.restore)}</button>`)}
      ${r.hasExport ? `<a class="button small ghost" href="${esc(href(`/admin/trash/${r.id}/export`))}" download>${icon("download")}${esc(x.download)}</a>` : ""}
      <form method="post" action="${esc(href(`/admin/trash/${r.id}/purge`))}" class="inline-form" data-confirm="${esc(x.deleteNowConfirm)}">${csrfField(csrf)}${backField}
        <label for="${fid}" class="visually-hidden">${esc(x.typeName)}</label><input id="${fid}" name="confirm" required autocomplete="off" dir="auto" placeholder="${esc(r.name)}" class="confirm-input">
        <button class="button small danger" type="submit">${icon("trash")}${esc(x.deleteNow)}</button></form>
    </div></li>`;
  };
  return `<section class="card-block" id="trash" aria-labelledby="trash-title">
  <h2 id="trash-title" class="h3">${icon("trash")} ${esc(x.trash)}</h2>
  <p class="meta">${esc(x.trashSub)}</p>
  ${rows.length ? `<ul class="trash-list">${rows.map(item).join("")}</ul>` : `<p class="meta">${esc(x.trashEmpty)}</p>`}
</section>`;
}

/** "Sign out everywhere" (admin settings or a team's settings). */
export function signOutAllSection(
  lang: Lang,
  action: string,
  csrf: string,
  kind: "admin" | "team",
  lastAt: number | null,
): string {
  const x = L[lang];
  return `<section class="card-block" aria-labelledby="so-title">
  <h2 id="so-title" class="h3">${esc(x.sessions)}</h2>
  <p class="meta">${esc(kind === "admin" ? x.sessionsAdminHelp : x.sessionsTeamHelp)}${lastAt ? ` ${esc(x.lastEnded)}: ` : ""}${lastAt ? relTime(new Date(lastAt).toISOString(), lang) : ""}</p>
  ${postForm(action, csrf, `<button class="button small warn" type="submit">${esc(x.signOutAll)}</button>`, { confirm: x.signOutAllConfirm })}
</section>`;
}

/** Danger-zone rows for a team (admin): export, then the typed-name soft delete. */
export function teamDeleteRows(
  lang: Lang,
  o: { base: string; csrf: string; name: string; id: string },
  dangerRow: (title: string, help: string, control: string) => string,
): string {
  const x = L[lang];
  const href = (p: string) => localePath(lang, p);
  return `${dangerRow(x.exportTeam, x.exportHelp, `<a class="button small ghost" href="${esc(href(`${o.base}/export`))}" download>${icon("download")}${esc(x.exportTeam)}</a>`)}
  ${dangerRow(
    x.deleteTeam,
    x.deleteHelp,
    `<form method="post" action="${esc(href(`${o.base}/delete`))}" class="stack-form delete-team-form">${csrfField(o.csrf)}
      <label for="del-confirm">${esc(x.typeName)}: <strong dir="auto">${esc(o.name)}</strong></label>
      <input id="del-confirm" name="confirm" required autocomplete="off" dir="auto" class="confirm-input">
      <label class="check small"><input type="checkbox" name="sites" value="delete"><span>${esc(x.alsoSites)}</span></label>
      <button class="button small danger" type="submit">${icon("trash")}${esc(x.deleteTeam)}</button></form>`,
  )}`;
}
