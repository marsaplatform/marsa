import { APP_NAME, APP_TAGLINE } from "./brand.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
${body}
</body>
</html>`;
}

export function indexHtml(): string {
  return shell(
    `${APP_NAME}: drop a site, get a link`,
    `<header class="top">
  <strong class="logo">${esc(APP_NAME)}</strong>
  <button id="lang" class="ghost" type="button">عربي</button>
</header>
<main>
  <h1 data-i18n="title">${esc(APP_TAGLINE)}</h1>
  <p class="sub" data-i18n="sub">Drag in a folder, some files, or a .zip. You get a public link that deletes itself when it expires.</p>

  <section id="drop" class="drop" tabindex="0">
    <p data-i18n="drop">Drop files, a folder, or a .zip here</p>
    <div class="row">
      <label class="btn"><input id="pickFiles" type="file" multiple hidden><span data-i18n="pickFiles">Choose files</span></label>
      <label class="btn"><input id="pickDir" type="file" webkitdirectory hidden><span data-i18n="pickDir">Choose folder</span></label>
    </div>
    <label class="ttl"><span data-i18n="expires">Expires after</span>
      <select id="ttl"></select>
    </label>
    <p id="limits" class="muted"></p>
  </section>

  <p id="status" role="status" aria-live="polite"></p>

  <section id="result" hidden>
    <h2 data-i18n="ready">Your link is ready</h2>
    <p><a id="link" target="_blank" rel="noopener"></a> <button id="copy" type="button" class="ghost" data-i18n="copy">Copy</button></p>
    <p class="muted"><span data-i18n="tokenNote">Edit/delete token (saved in this browser; keep a copy to manage it elsewhere):</span></p>
    <code id="token"></code>
  </section>

  <section>
    <h2 data-i18n="mine">Your drops in this browser</h2>
    <ul id="mine" class="list"></ul>
  </section>

  <details>
    <summary data-i18n="api">Deploy from a script or AI agent</summary>
<pre><code>curl -X POST -H "Content-Type: application/zip" \\
  --data-binary @site.zip "$ORIGIN/api/sites?ttlHours=24"

curl -X POST -H "Content-Type: application/json" "$ORIGIN/api/sites" \\
  -d '{"ttlHours":24,"files":[{"path":"index.html","content":"&lt;h1&gt;Hi&lt;/h1&gt;"}]}'

curl -X DELETE -H "Authorization: Bearer $EDIT_TOKEN" "$ORIGIN/api/sites/$ID"</code></pre>
  </details>
</main>
<footer class="muted" data-i18n="footer">${esc(APP_NAME)} is open source. Uploaded content is public to anyone with the link. Don't upload secrets.</footer>
<script src="/assets/app.js" type="module"></script>`,
  );
}

export function notFoundHtml(): string {
  return shell(
    `Not found · ${APP_NAME}`,
    `<main class="center"><h1>404</h1><p>This link doesn't exist. هذا الرابط غير موجود.</p><p><a href="/">${esc(APP_NAME)}</a></p></main>`,
  );
}

export function goneHtml(): string {
  return shell(
    `Expired · ${APP_NAME}`,
    `<main class="center"><h1>410</h1><p>This link has expired. انتهت صلاحية هذا الرابط.</p><p><a href="/">${esc(APP_NAME)}</a></p></main>`,
  );
}

export const APP_CSS = `
:root{--bg:#0f1115;--fg:#e9edf3;--muted:#98a2b3;--accent:#5cc8ff;--card:#171a21;--line:#2a2f3a}
*{box-sizing:border-box}
body{margin:0;font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Arabic",sans-serif;background:var(--bg);color:var(--fg)}
.top{display:flex;justify-content:space-between;align-items:center;padding:16px 24px;border-bottom:1px solid var(--line)}
.logo{font-size:20px;letter-spacing:.5px}
main{max-width:760px;margin:0 auto;padding:32px 24px}
main.center{text-align:center;padding-top:15vh}
h1{font-size:clamp(26px,4vw,38px);line-height:1.2;margin:0 0 8px}
.sub,.muted{color:var(--muted)}
.drop{margin:28px 0;padding:36px 24px;border:2px dashed var(--line);border-radius:14px;background:var(--card);text-align:center;transition:border-color .15s,background .15s}
.drop.over{border-color:var(--accent);background:#1b2230}
.row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin:16px 0}
.btn,button{cursor:pointer;border-radius:10px;padding:10px 16px;border:1px solid var(--accent);background:var(--accent);color:#04121b;font:inherit;font-weight:600}
.ghost{background:transparent;color:var(--fg);border-color:var(--line)}
.ttl{display:inline-flex;gap:8px;align-items:center}
select{font:inherit;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:6px 8px}
a{color:var(--accent)}
code,pre{background:var(--card);border:1px solid var(--line);border-radius:8px}
code{padding:2px 6px;word-break:break-all;direction:ltr;unicode-bidi:isolate;display:inline-block}
#link,.list a{direction:ltr;unicode-bidi:isolate}
pre{padding:12px;overflow:auto;direction:ltr;text-align:left}
pre code{border:0;padding:0}
.list{list-style:none;padding:0}
.list li{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}
footer{text-align:center;padding:24px;font-size:14px}
#status.err{color:#ff8a8a}
`;

export const APP_JS = `
const T = {
  en: {
    title: ${JSON.stringify(APP_TAGLINE)},
    sub: "Drag in a folder, some files, or a .zip. You get a public link that deletes itself when it expires.",
    drop: "Drop files, a folder, or a .zip here", pickFiles: "Choose files", pickDir: "Choose folder",
    expires: "Expires after", ready: "Your link is ready", copy: "Copy", copied: "Copied",
    tokenNote: "Edit/delete token (saved in this browser; keep a copy to manage it elsewhere):",
    mine: "Your drops in this browser", api: "Deploy from a script or AI agent",
    footer: ${JSON.stringify(`${APP_NAME} is open source. Uploaded content is public to anyone with the link. Don't upload secrets.`)},
    uploading: "Uploading…", del: "Delete", expiresAt: "expires", none: "Nothing yet.",
    limits: (c) => "Up to " + c.maxFiles + " files, " + mb(c.maxFileBytes) + " per file, " + mb(c.maxSiteBytes) + " total.",
    hours: (h) => h < 24 ? h + (h === 1 ? " hour" : " hours") : (h / 24) + (h === 24 ? " day" : " days"),
  },
  ar: {
    title: "ارفع موقعك الثابت وخد رابط. من غير حساب.",
    sub: "اسحب فولدر أو ملفات أو ملف zip. هتاخد رابط عام بيتمسح لوحده لما مدته تخلص.",
    drop: "اسحب الملفات أو الفولدر أو ملف zip هنا", pickFiles: "اختار ملفات", pickDir: "اختار فولدر",
    expires: "ينتهي بعد", ready: "الرابط جاهز", copy: "نسخ", copied: "اتنسخ",
    tokenNote: "مفتاح التعديل والمسح (محفوظ في المتصفح ده، احتفظ بنسخة لو هتديره من مكان تاني):",
    mine: "اللي رفعته من المتصفح ده", api: "النشر من سكريبت أو AI agent",
    footer: ${JSON.stringify(`${APP_NAME} مفتوح المصدر. أي حد معاه الرابط يقدر يشوف المحتوى، فماترفعش أي بيانات سرية.`)},
    uploading: "جاري الرفع…", del: "مسح", expiresAt: "ينتهي", none: "لسه مفيش.",
    limits: (c) => "لحد " + c.maxFiles + " ملف، " + mb(c.maxFileBytes) + " للملف، " + mb(c.maxSiteBytes) + " إجمالي.",
    hours: (h) => h < 24 ? h + " ساعة" : (h / 24) + " يوم",
  },
};
const mb = (b) => "\u2066" + Math.round(b / 1048576) + " MB\u2069";
const $ = (id) => document.getElementById(id);
let lang = localStorage.getItem("lang") || "en";
let cfg = null;
const KEY = "drops";
const drops = () => JSON.parse(localStorage.getItem(KEY) || "[]");
const saveDrops = (d) => localStorage.setItem(KEY, JSON.stringify(d));

function applyLang() {
  const t = T[lang];
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const v = t[el.dataset.i18n];
    if (typeof v === "string") el.textContent = v;
  });
  $("lang").textContent = lang === "ar" ? "English" : "عربي";
  if (cfg) {
    $("limits").textContent = t.limits(cfg);
    const sel = $("ttl");
    const cur = sel.value;
    sel.innerHTML = "";
    const opts = [1, 6, 24, 72, 168].filter((h) => h >= cfg.ttlHours.min && h <= cfg.ttlHours.max);
    if (!opts.includes(cfg.ttlHours.default)) opts.push(cfg.ttlHours.default);
    opts.sort((a, b) => a - b).forEach((h) => {
      const o = document.createElement("option");
      o.value = String(h);
      o.textContent = t.hours(h);
      sel.appendChild(o);
    });
    sel.value = cur || String(cfg.ttlHours.default);
  }
  renderMine();
}

function renderMine() {
  const t = T[lang];
  const ul = $("mine");
  ul.innerHTML = "";
  const now = Date.now();
  const list = drops().filter((d) => Date.parse(d.expiresAt) > now);
  saveDrops(list);
  if (!list.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = t.none;
    ul.appendChild(li);
    return;
  }
  for (const d of list) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = d.url; a.target = "_blank"; a.rel = "noopener"; a.textContent = d.url;
    const meta = document.createElement("span");
    meta.className = "muted";
    meta.textContent = t.expiresAt + " " + new Date(d.expiresAt).toLocaleString(lang);
    const del = document.createElement("button");
    del.className = "ghost"; del.type = "button"; del.textContent = t.del;
    del.onclick = async () => {
      const r = await fetch("/api/sites/" + d.id, { method: "DELETE", headers: { Authorization: "Bearer " + d.editToken } });
      if (r.ok || r.status === 404 || r.status === 410) { saveDrops(drops().filter((x) => x.id !== d.id)); renderMine(); }
    };
    const left = document.createElement("div");
    left.append(a, document.createElement("br"), meta);
    li.append(left, del);
    ul.appendChild(li);
  }
}

function status(msg, err) { const s = $("status"); s.textContent = msg || ""; s.className = err ? "err" : ""; }

async function upload(items) {
  if (!items.length) return;
  status(T[lang].uploading);
  const fd = new FormData();
  for (const { file, path } of items) { fd.append("files", file, file.name); fd.append("paths", path); }
  fd.append("ttlHours", $("ttl").value);
  try {
    const r = await fetch("/api/sites", { method: "POST", body: fd });
    const j = await r.json();
    if (!r.ok) { status((j.error && j.error.message) || ("HTTP " + r.status), true); return; }
    status("");
    $("result").hidden = false;
    $("link").href = j.url; $("link").textContent = j.url;
    $("token").textContent = j.editToken;
    saveDrops([{ id: j.id, url: j.url, expiresAt: j.expiresAt, editToken: j.editToken }, ...drops()]);
    renderMine();
  } catch (e) { status(String(e), true); }
}

function walk(entry, prefix) {
  return new Promise((resolve) => {
    if (entry.isFile) { entry.file((f) => resolve([{ file: f, path: prefix + f.name }]), () => resolve([])); return; }
    if (!entry.isDirectory) { resolve([]); return; }
    const reader = entry.createReader();
    const all = [];
    const next = () => reader.readEntries(async (batch) => {
      if (!batch.length) { const nested = await Promise.all(all.map((e) => walk(e, prefix + entry.name + "/"))); resolve(nested.flat()); return; }
      all.push(...batch); next();
    }, () => resolve([]));
    next();
  });
}

const drop = $("drop");
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("over")));
drop.addEventListener("drop", async (e) => {
  e.preventDefault();
  const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (entries.length) { upload((await Promise.all(entries.map((en) => walk(en, "")))).flat()); return; }
  upload([...e.dataTransfer.files].map((f) => ({ file: f, path: f.name })));
});
$("pickFiles").addEventListener("change", (e) => upload([...e.target.files].map((f) => ({ file: f, path: f.name }))));
$("pickDir").addEventListener("change", (e) => upload([...e.target.files].map((f) => ({ file: f, path: f.webkitRelativePath || f.name }))));
$("copy").addEventListener("click", async () => { await navigator.clipboard.writeText($("link").href); $("copy").textContent = T[lang].copied; });
$("lang").addEventListener("click", () => { lang = lang === "ar" ? "en" : "ar"; localStorage.setItem("lang", lang); applyLang(); });

fetch("/api/config").then((r) => r.json()).then((c) => { cfg = c; applyLang(); });
applyLang();
`;
