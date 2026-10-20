/** Static assets for the app's own pages, served from memory with strict CSP (no inline code). */

export const APP_CSS = `
:root{
  --bg:#f7f5f0;--bg2:#efece4;--fg:#10212e;--muted:#526170;--line:#dcd7cb;
  --sea:#0b3b5c;--sea2:#11557f;--foam:#2bb3a0;--foam-soft:#d7f2ec;--sand:#e9b65c;
  --card:#ffffff;--code:#0e2433;--code-fg:#d9eef5;--focus:#e08a1e;
  --radius:16px;--shadow:0 1px 2px rgba(16,33,46,.06),0 8px 24px rgba(16,33,46,.06);
  --font:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans Arabic","Noto Sans",Tahoma,sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
}
@media (prefers-color-scheme:dark){
  :root{--bg:#0b1620;--bg2:#0f1e2b;--fg:#e6eef3;--muted:#9fb1bf;--line:#20364a;--card:#112333;
  --sea:#7fd3ff;--sea2:#a9e2ff;--foam:#5ad6c2;--foam-soft:#123a3a;--code:#07121a;--shadow:none}
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important;animation:none!important}}
body{margin:0;font:17px/1.6 var(--font);background:var(--bg);color:var(--fg);-webkit-font-smoothing:antialiased}
[dir=rtl] body{line-height:1.8}
a{color:var(--sea2)}
@media (prefers-color-scheme:dark){a{color:var(--sea)}}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px;border-radius:6px}
.skip{position:absolute;inset-inline-start:-999px;top:8px;background:var(--fg);color:var(--bg);padding:8px 14px;border-radius:8px;z-index:10}
.skip:focus{inset-inline-start:8px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.wrap{max-width:1120px;margin:0 auto;padding:0 24px}
.narrow{max-width:760px}
.center{text-align:center;padding-block:12vh}
.muted{color:var(--muted)}
.small{font-size:.88rem}
h1,h2,h3{line-height:1.2;letter-spacing:-.01em;margin:0 0 .5em}
[dir=rtl] h1,[dir=rtl] h2,[dir=rtl] h3{letter-spacing:0;line-height:1.35}
h1{font-size:clamp(2rem,4.6vw,3.4rem)}
h2{font-size:clamp(1.5rem,2.8vw,2.1rem)}
h3{font-size:1.15rem}
section{padding-block:72px}
.band{background:var(--bg2)}
.site-header{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.bar{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:64px}
.brand{display:inline-flex;align-items:center;gap:10px;font-weight:750;font-size:1.2rem;color:var(--fg);text-decoration:none}
.mark{width:30px;height:30px}
.stroke{fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.brand .mark{color:var(--foam)}
nav{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
nav a{color:var(--fg);text-decoration:none;padding:8px 12px;border-radius:10px;font-weight:550}
nav a:hover,nav a[aria-current=page]{background:var(--bg2)}
nav .lang{border:1px solid var(--line)}
@media (max-width:640px){.hide-sm{display:none}nav a{padding:6px 8px}}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;border-radius:12px;padding:10px 18px;border:1.5px solid var(--line);background:var(--card);color:var(--fg);font:inherit;font-weight:650;text-decoration:none;transition:transform .12s,border-color .12s,background .12s}
.btn:hover{border-color:var(--foam);transform:translateY(-1px)}
.btn.primary{background:var(--sea);border-color:var(--sea);color:#fff}
@media (prefers-color-scheme:dark){.btn.primary{color:#04131d}}
.btn.primary:hover{background:var(--sea2);border-color:var(--sea2)}
.btn.lg{padding:14px 24px;font-size:1.05rem}
.btn.small{padding:6px 12px;font-size:.9rem}
.cta{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}
.hero{padding-block:72px 56px;background:radial-gradient(1200px 500px at 85% -10%,var(--foam-soft),transparent 60%)}
.hero-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:48px;align-items:center}
@media (max-width:900px){.hero-grid{grid-template-columns:1fr}.hero-art{max-width:460px}}
.eyebrow{display:inline-block;font-weight:650;font-size:.9rem;color:var(--sea2);background:var(--card);border:1px solid var(--line);padding:6px 12px;border-radius:999px;margin:0 0 18px}
@media (prefers-color-scheme:dark){.eyebrow{color:var(--sea)}}
.lead{font-size:1.2rem;color:var(--muted);max-width:40em}
.hero-art{width:100%;height:auto}
.hero-art .card{fill:var(--card);stroke:var(--line);stroke-width:1.5}
.hero-art .card-top{fill:var(--bg2)}
.hero-art .dot{fill:var(--line)}
.hero-art .line{fill:var(--line)}
.hero-art .line.strong{fill:var(--muted);opacity:.55}
.hero-art .pill{fill:var(--foam);opacity:.85}
.hero-art .link-card{fill:var(--sea);filter:drop-shadow(0 10px 18px rgba(11,59,92,.25))}
.hero-art .link-icon{fill:var(--foam)}
.hero-art .link-arrow{fill:none;stroke:#fff;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.hero-art .on-dark{fill:#fff;opacity:.85}
.hero-art .on-dark.faint{opacity:.45}
.hero-art .wave{fill:none;stroke:var(--foam);stroke-width:3;stroke-linecap:round}
.hero-art .wave.faint{opacity:.4}
.hero-art .clock-face{fill:var(--sand)}
.hero-art .clock-hand{fill:none;stroke:#10212e;stroke-width:3;stroke-linecap:round}
@media (prefers-reduced-motion:no-preference){.hero-art .link-card,.hero-art .link-icon,.hero-art .link-arrow,.hero-art .on-dark{animation:dock 3.2s ease-in-out infinite alternate}}
@keyframes dock{from{transform:translateY(0)}to{transform:translateY(-6px)}}
.grid{display:grid;gap:20px;margin-top:28px}
.three{grid-template-columns:repeat(3,1fr)}
.uses{grid-template-columns:repeat(auto-fit,minmax(176px,1fr))}
@media (max-width:820px){.three{grid-template-columns:1fr}}
.card-box{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:22px;box-shadow:var(--shadow)}
.card-box p{margin:0;color:var(--muted)}
.icon{width:36px;height:36px;color:var(--foam);margin-bottom:10px}
.steps{list-style:none;padding:0;margin:28px 0 0;display:grid;grid-template-columns:repeat(3,1fr);gap:20px;counter-reset:s}
@media (max-width:820px){.steps{grid-template-columns:1fr}}
.steps li{counter-increment:s;position:relative;padding:22px;padding-top:58px;border:1px solid var(--line);border-radius:var(--radius);background:var(--card)}
.steps li::before{content:counter(s);position:absolute;top:18px;inset-inline-start:22px;width:30px;height:30px;border-radius:50%;background:var(--foam);color:#04131d;font-weight:750;display:grid;place-items:center}
.steps p{margin:0;color:var(--muted)}
.more{font-weight:650}
.two-col{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:40px;align-items:start}
@media (max-width:900px){.two-col{grid-template-columns:1fr}}
.code{background:var(--code);color:var(--code-fg);border-radius:var(--radius);padding:18px 20px;overflow:auto;font:14px/1.6 var(--mono);text-align:left;margin:0}
.checks{list-style:none;padding:0;margin:16px 0 0}
.checks li{position:relative;padding-inline-start:30px;margin-bottom:10px}
.checks li::before{content:"";position:absolute;inset-inline-start:0;top:.45em;width:16px;height:16px;border-radius:50%;background:var(--foam-soft);border:2px solid var(--foam)}
.try{scroll-margin-top:72px}
.drop{margin:24px 0 12px;padding:40px 24px;border:2px dashed var(--line);border-radius:20px;background:var(--card);text-align:center;transition:border-color .15s,background .15s}
.drop.over{border-color:var(--foam);background:var(--foam-soft)}
.drop-icon{width:44px;height:44px;color:var(--foam)}
.drop-title{font-weight:650;font-size:1.1rem;margin:6px 0 0}
.row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin:18px 0}
.row label:focus-within{outline:3px solid var(--focus);outline-offset:2px}
.ttl{display:inline-flex;gap:8px;align-items:center}
select{font:inherit;background:var(--bg);color:var(--fg);border:1.5px solid var(--line);border-radius:10px;padding:6px 10px}
#status{min-height:1.6em;font-weight:600}
#status.err{color:#c43d3d}
.result{border:1.5px solid var(--foam);background:var(--foam-soft);border-radius:var(--radius);padding:20px;margin-bottom:24px}
.link-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
#link,.mine a,.token,code{direction:ltr;unicode-bidi:isolate}
#link{font-weight:700;word-break:break-all}
.token{display:block;font:13px/1.5 var(--mono);background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;word-break:break-all;text-align:left}
.mine-title{margin-top:28px}
.mine{list-style:none;padding:0;margin:0}
.mine li{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid var(--line)}
.mine li.empty{color:var(--muted)}
.mine a{word-break:break-all}
.site-footer{border-top:1px solid var(--line);padding-block:28px;color:var(--muted);font-size:.92rem}
.foot{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
.foot p{margin:0}
.big-code{font-size:4rem;font-weight:800;color:var(--foam);margin:0}
.docs-head{padding-block:56px 8px}
.docs-grid{grid-template-columns:repeat(auto-fit,minmax(260px,1fr));padding-bottom:72px}
.doc-card{text-decoration:none;color:var(--fg);transition:border-color .12s,transform .12s}
.doc-card:hover{border-color:var(--foam);transform:translateY(-2px)}
.doc-card h2{font-size:1.2rem}
.docs-layout{display:grid;grid-template-columns:240px 1fr;gap:40px;padding-block:40px 72px}
@media (max-width:860px){.docs-layout{grid-template-columns:1fr}}
.docs-nav ul{list-style:none;padding:0;margin:0}
.docs-nav a{display:block;padding:6px 10px;border-radius:8px;text-decoration:none;color:var(--fg)}
.docs-nav a[aria-current=page]{background:var(--bg2);font-weight:650}
.prose{min-width:0;max-width:820px}
.prose h1{font-size:clamp(1.8rem,3.4vw,2.6rem)}
.prose h2{margin-top:1.6em;font-size:1.5rem}
.prose pre{background:var(--code);color:var(--code-fg);border-radius:12px;padding:16px 18px;overflow:auto;font:14px/1.6 var(--mono);direction:ltr;text-align:left}
.prose :not(pre)>code{font:.9em var(--mono);background:var(--bg2);border:1px solid var(--line);border-radius:6px;padding:1px 6px}
.prose .table{overflow-x:auto}
.prose table{border-collapse:collapse;width:100%;font-size:.95rem}
.prose th,.prose td{border:1px solid var(--line);padding:8px 10px;text-align:start;vertical-align:top}
.prose th{background:var(--bg2)}
.directory{scroll-margin-top:72px}
.dir-team{margin-top:32px}
.dir-url span{unicode-bidi:isolate}
.dir-team h3{margin-bottom:0}
.dir-grid{list-style:none;padding:0;margin-top:14px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
.dir-card{display:flex;flex-direction:column;gap:6px}
.dir-card p{margin:0}
.dir-title{font-weight:700;font-size:1.05rem;word-break:break-word;text-decoration:none}
.dir-title:hover{text-decoration:underline}
.dir-url{font:13px/1.5 var(--mono);color:var(--muted);word-break:break-all}
.dir-empty{margin-top:24px;text-align:center;color:var(--muted)}
[hidden]{display:none!important}
.admin{padding-block:48px 72px}
.admin-login,.admin-create{margin:20px 0;display:flex;flex-direction:column;gap:10px;max-width:560px}
.admin input[type=text],.admin input[type=password]{font:inherit;background:var(--bg);color:var(--fg);border:1.5px solid var(--line);border-radius:10px;padding:8px 12px;flex:1;min-width:0}
.row.start{justify-content:flex-start;margin:0}
.row.between{justify-content:space-between;align-items:center;margin:24px 0 12px}
.check{display:flex;gap:8px;align-items:center}
.check input,.teams input[type=checkbox]{width:20px;height:20px;accent-color:var(--foam)}
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius);background:var(--card)}
.teams{border-collapse:collapse;width:100%;font-size:.95rem}
.teams th,.teams td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:start;vertical-align:middle}
.teams th{background:var(--bg2);font-weight:650}
.teams tr:last-child td{border-bottom:0}
.teams .acts{display:flex;gap:8px;flex-wrap:wrap}
.teams code{font:12px var(--mono)}
`;

export const APP_JS = `
const lang = document.documentElement.lang === "ar" ? "ar" : "en";
const T = {
  en: { uploading: "Uploading…", del: "Delete", expires: "expires", copied: "Copied", copy: "Copy link", failed: "Upload failed" },
  ar: { uploading: "جاري الرفع…", del: "مسح", expires: "ينتهي", copied: "اتنسخ", copy: "انسخ الرابط", failed: "الرفع فشل" },
}[lang];
const $ = (id) => document.getElementById(id);
const KEY = "drops";
const drops = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
const saveDrops = (d) => localStorage.setItem(KEY, JSON.stringify(d));

function renderMine() {
  const ul = $("mine");
  if (!ul) return;
  ul.textContent = "";
  const list = drops().filter((d) => Date.parse(d.expiresAt) > Date.now());
  saveDrops(list);
  if (!list.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = ul.dataset.empty || "";
    ul.appendChild(li);
    return;
  }
  for (const d of list) {
    const li = document.createElement("li");
    const left = document.createElement("div");
    const a = document.createElement("a");
    a.href = d.url; a.target = "_blank"; a.rel = "noopener"; a.textContent = d.url;
    const meta = document.createElement("div");
    meta.className = "muted small";
    meta.textContent = T.expires + " " + new Date(d.expiresAt).toLocaleString(lang === "ar" ? "ar-EG" : undefined);
    left.append(a, meta);
    const del = document.createElement("button");
    del.className = "btn small"; del.type = "button"; del.textContent = T.del;
    del.addEventListener("click", async () => {
      del.disabled = true;
      const r = await fetch("/api/sites/" + encodeURIComponent(d.id), { method: "DELETE", headers: { Authorization: "Bearer " + d.editToken } });
      if (r.ok || r.status === 404 || r.status === 410) { saveDrops(drops().filter((x) => x.id !== d.id)); renderMine(); }
      else del.disabled = false;
    });
    li.append(left, del);
    ul.appendChild(li);
  }
}

function status(msg, err) { const s = $("status"); s.textContent = msg || ""; s.className = err ? "err" : ""; }

async function upload(items) {
  if (!items.length) return;
  status(T.uploading);
  const fd = new FormData();
  for (const { file, path } of items) { fd.append("files", file, file.name); fd.append("paths", path); }
  fd.append("ttlHours", $("ttl").value);
  try {
    const r = await fetch("/api/sites", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { status((j.error && j.error.message) || (T.failed + " (HTTP " + r.status + ")"), true); return; }
    status("");
    $("result").hidden = false;
    $("link").href = j.url; $("link").textContent = j.url;
    $("token").textContent = j.editToken;
    $("copy").textContent = T.copy;
    saveDrops([{ id: j.id, url: j.url, expiresAt: j.expiresAt, editToken: j.editToken }, ...drops()]);
    renderMine();
    $("link").focus();
  } catch (e) { status(T.failed + ": " + e, true); }
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
if (drop) {
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("over")));
  drop.addEventListener("drop", async (e) => {
    e.preventDefault();
    const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (entries.length) { upload((await Promise.all(entries.map((en) => walk(en, "")))).flat()); return; }
    upload([...e.dataTransfer.files].map((f) => ({ file: f, path: f.name })));
  });
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("pickFiles").click(); } });
  $("pickFiles").addEventListener("change", (e) => upload([...e.target.files].map((f) => ({ file: f, path: f.name }))));
  $("pickDir").addEventListener("change", (e) => upload([...e.target.files].map((f) => ({ file: f, path: f.webkitRelativePath || f.name }))));
  $("copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("link").href); $("copy").textContent = T.copied; } catch {}
  });
  renderMine();
}

// Show directory expiry times in the visitor's own time zone.
for (const el of document.querySelectorAll("time[data-local]")) {
  const d = new Date(el.getAttribute("datetime"));
  if (!isNaN(d)) el.textContent = d.toLocaleString(lang === "ar" ? "ar-EG" : undefined, { dateStyle: "medium", timeStyle: "short" });
}
`;

/** Admin console script (/admin). The token lives only in sessionStorage of this tab. */
export const ADMIN_JS = `
const lang = document.documentElement.lang === "ar" ? "ar" : "en";
const T = {
  en: { bad: "Wrong admin token.", off: "The admin API is disabled on this instance (ADMIN_TOKEN not set).", fail: "Request failed", confirmDel: "Delete this team? Its sites stay up until they expire.", confirmRotate: "Make a new key? The old key stops working right away.", on: "on", saved: "Saved.", created: "Team created.", rotated: "New key created.", deleted: "Team deleted.", none: "No teams yet." },
  ar: { bad: "مفتاح الأدمن غلط.", off: "الـ admin API مقفول على النسخة دي (ADMIN_TOKEN مش متظبط).", fail: "الطلب فشل", confirmDel: "تمسح الفريق ده؟ مواقعه هتفضل شغالة لحد ما تنتهي.", confirmRotate: "تعمل مفتاح جديد؟ المفتاح القديم هيبطل على طول.", on: "شغال", saved: "اتحفظ.", created: "الفريق اتعمل.", rotated: "اتعمل مفتاح جديد.", deleted: "الفريق اتمسح.", none: "مفيش فرق لسه." },
}[lang];
const $ = (id) => document.getElementById(id);
const SKEY = "marsa-admin-token";
let token = sessionStorage.getItem(SKEY) || "";

function status(msg, err) { const s = $("status"); s.textContent = msg || ""; s.className = err ? "err" : ""; }

async function api(method, path, body) {
  const r = await fetch("/api/admin" + path, {
    method,
    headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { signOut(); status(T.bad, true); throw new Error("401"); }
  if (r.status === 404 && path === "/teams") { signOut(); status(T.off, true); throw new Error("404"); }
  if (!r.ok) { status(((j.error && j.error.message) || T.fail) + " (HTTP " + r.status + ")", true); throw new Error(String(r.status)); }
  return j;
}

function showKey(key) {
  $("newKey").hidden = false;
  $("newKeyValue").textContent = key;
  $("newKey").scrollIntoView({ block: "nearest" });
}

function cell(child) { const td = document.createElement("td"); if (typeof child === "string") td.textContent = child; else if (child) td.appendChild(child); return td; }

function toggle(team, field) {
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = !!team[field];
  box.setAttribute("aria-label", team.name + ": " + field);
  box.addEventListener("change", async () => {
    box.disabled = true;
    try { await api("PATCH", "/teams/" + encodeURIComponent(team.id), { [field]: box.checked }); status(T.saved); }
    catch { box.checked = !box.checked; }
    box.disabled = false;
  });
  return box;
}

function button(label, onClick) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "btn small"; b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

async function load() {
  const { teams } = await api("GET", "/teams");
  const tbody = $("teamRows");
  tbody.textContent = "";
  if (!teams.length) {
    const tr = document.createElement("tr");
    const td = cell(T.none); td.colSpan = 6; td.className = "muted";
    tr.appendChild(td); tbody.appendChild(tr);
  }
  for (const team of teams) {
    const tr = document.createElement("tr");
    const name = document.createElement("span"); name.dir = "auto"; name.textContent = team.name;
    const key = document.createElement("code"); key.textContent = team.keyPrefix + "…";
    const acts = document.createElement("div"); acts.className = "acts";
    acts.append(
      button(document.querySelector("#admin").dataset.rotate || "Rotate", async () => {
        if (!confirm(T.confirmRotate)) return;
        const r = await api("POST", "/teams/" + encodeURIComponent(team.id) + "/rotate");
        showKey(r.key); status(T.rotated); load();
      }),
      button(document.querySelector("#admin").dataset.del || "Delete", async () => {
        if (!confirm(T.confirmDel)) return;
        await api("DELETE", "/teams/" + encodeURIComponent(team.id));
        status(T.deleted); load();
      }),
    );
    tr.append(cell(name), cell(toggle(team, "backend")), cell(toggle(team, "directory")), cell(String(team.liveSites || 0)), cell(key), cell(acts));
    tbody.appendChild(tr);
  }
}

function signOut() {
  token = ""; sessionStorage.removeItem(SKEY);
  $("panel").hidden = true; $("login").hidden = false; $("newKey").hidden = true;
}

async function open() {
  try { await load(); $("login").hidden = true; $("panel").hidden = false; status(""); } catch {}
}

$("login").addEventListener("submit", (e) => {
  e.preventDefault();
  token = $("adminToken").value.trim();
  $("adminToken").value = "";
  sessionStorage.setItem(SKEY, token);
  open();
});
$("signOut").addEventListener("click", () => { signOut(); status(""); });
$("createTeam").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const r = await api("POST", "/teams", { name: $("teamName").value, backend: $("teamBackend").checked, directory: $("teamDirectory").checked });
    $("teamName").value = ""; $("teamBackend").checked = false; $("teamDirectory").checked = true;
    showKey(r.key); status(T.created); load();
  } catch {}
});
if (token) open();
`;
