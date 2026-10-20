import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Static assets for the app's own pages, served from memory with strict CSP (no inline code). */

/**
 * Zad (SIL OFL-1.1; IBM Plex Sans Arabic derivative), the typeface of
 * marsaplatform.com, self-hosted from public/fonts/zad (see OFL.txt there).
 * Missing files fall back to the system font stack.
 */
const FONT_FILES = ["Zad-Regular.woff2", "Zad-Medium.woff2", "Zad-Bold.woff2", "OFL.txt"] as const;
const fonts = new Map<string, { type: string; body: Uint8Array }>();
for (const name of FONT_FILES) {
  try {
    const body = readFileSync(
      fileURLToPath(new URL(`../public/fonts/zad/${name}`, import.meta.url)),
    );
    fonts.set(name, {
      type: name.endsWith(".txt") ? "text/plain; charset=utf-8" : "font/woff2",
      body: new Uint8Array(body),
    });
  } catch {
    // not shipped in this build
  }
}
export const fontAsset = (name: string) => fonts.get(name) ?? null;

export const APP_CSS = `
@font-face{font-family:"Zad";font-style:normal;font-weight:400;font-display:swap;src:url("/assets/fonts/zad/Zad-Regular.woff2") format("woff2")}
@font-face{font-family:"Zad";font-style:normal;font-weight:500;font-display:swap;src:url("/assets/fonts/zad/Zad-Medium.woff2") format("woff2")}
@font-face{font-family:"Zad";font-style:normal;font-weight:600 800;font-display:swap;src:url("/assets/fonts/zad/Zad-Bold.woff2") format("woff2")}
:root{color-scheme:light;--bg:#f5f8f5;--surface:#edf3ee;--paper:#fbfcfa;--ink:#152e29;--muted:#52665e;--line:#cedbd2;--accent:#145a49;--on-accent:#f6faf7;--soft:#dceccf;--danger:#a33122;--danger-soft:#f6e3df;--warn:#8a5a00;--code:#10241f;--code-ink:#dcebe1;--shadow:0 18px 40px #183b2710;--radius:8px;
  --font:Zad,"IBM Plex Sans Arabic",system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#11231f;--surface:#182e27;--paper:#1c342c;--ink:#edf4ed;--muted:#b4c9bc;--line:#385548;--accent:#c8e6aa;--on-accent:#15362a;--soft:#294b38;--danger:#ffb4a6;--danger-soft:#4a2620;--warn:#f3c66b;--code:#0b1915;--shadow:0 18px 40px #06110c30}}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:24px}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important;animation:none!important}}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font);font-size:17px;line-height:1.8;-webkit-font-smoothing:antialiased;font-synthesis:none}
[lang=en] body,body:lang(en){line-height:1.65}
a{color:inherit;text-decoration:none}
a:hover{color:var(--accent)}
button,input,select,textarea{font:inherit;color:inherit}
button{cursor:pointer}
button:disabled{cursor:default;opacity:.55}
h1,h2,h3,p{margin:0}
h1,h2,h3{line-height:1.35;text-wrap:balance}
h1,h2{font-weight:750}
h3,.h3{font-size:21px;font-weight:700}
p{color:var(--muted)}
:focus-visible{outline:3px solid var(--accent);outline-offset:4px;border-radius:4px}
main:focus{outline:none}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.js-only{display:none!important}
.js .js-only{display:inline-flex!important}
.wrap{width:min(1240px,calc(100% - 64px));margin-inline:auto}
.narrow{width:min(820px,calc(100% - 48px))}
.ltr,code,.token,.url{direction:ltr;unicode-bidi:isolate}
.skip{position:fixed;top:8px;inset-inline-start:8px;transform:translateY(-180%);z-index:30;background:var(--accent);color:var(--on-accent);padding:10px 20px;border-radius:var(--radius)}
.skip:focus{transform:none;color:var(--on-accent)}
.meta{font-size:14px;color:var(--muted)}
.notice{background:var(--surface);padding:18px 22px;border-inline-start:3px solid var(--accent);margin-block:20px;font-size:15px;border-radius:0 var(--radius) var(--radius) 0}
[dir=rtl] .notice{border-radius:var(--radius) 0 0 var(--radius)}

/* header */
.site-header{border-bottom:1px solid var(--line);background:var(--bg);position:relative;z-index:10}
.header-inner{min-height:76px;display:flex;align-items:center;justify-content:space-between;gap:28px}
.wordmark{display:inline-flex;gap:10px;align-items:center;font-size:24px;font-weight:800;line-height:1.1;letter-spacing:-.5px;flex-shrink:0}
.wordmark:hover{color:var(--ink)}
.wordmark.small{font-size:20px}
.brand-mark{display:inline-grid;place-items:center;background:var(--accent);color:var(--on-accent);width:34px;height:34px;border-radius:var(--radius);font-size:24px;letter-spacing:0;padding-bottom:3px;font-weight:700}
.desktop-nav{display:flex;gap:28px;align-items:center;font-size:15px;font-weight:600;margin-inline-end:auto;margin-inline-start:24px}
.desktop-nav a{position:relative;padding-block:16px}
.desktop-nav a[aria-current=page]::after{content:"";position:absolute;bottom:6px;inset-inline:0;height:2px;background:var(--accent)}
.header-tools{display:flex;align-items:center;gap:16px}
.locale-link{font-size:14px;font-weight:600;padding:6px 4px}
.mobile-menu{display:none;position:relative}
.mobile-menu summary{list-style:none;cursor:pointer;width:44px;height:44px;display:grid;place-items:center;border:1px solid var(--line);border-radius:var(--radius)}
.mobile-menu summary::-webkit-details-marker{display:none}
.burger,.burger::before,.burger::after{display:block;width:18px;height:2px;background:var(--ink);border-radius:2px;position:relative}
.burger::before,.burger::after{content:"";position:absolute}
.burger::before{top:-6px}.burger::after{top:6px}
.mobile-menu nav{position:absolute;inset-inline-end:0;top:52px;background:var(--paper);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);min-width:220px;padding:8px;display:flex;flex-direction:column}
.mobile-menu nav a{padding:10px 14px;border-radius:6px;font-weight:600}
.mobile-menu nav a:hover{background:var(--surface)}

/* buttons and links */
.button{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:50px;padding:10px 24px;background:var(--accent);color:var(--on-accent);border:1px solid var(--accent);border-radius:var(--radius);font-weight:650;font-size:16px;white-space:nowrap;line-height:1.5;transition:transform .18s,filter .18s;cursor:pointer}
.button:hover{color:var(--on-accent);filter:brightness(1.12);transform:translateY(-1px)}
.button:active{transform:translateY(1px)}
.button.small{min-height:40px;font-size:14px;padding:7px 16px}
.button.ghost{background:transparent;color:var(--ink);border-color:var(--line)}
.button.ghost:hover{border-color:var(--accent);color:var(--accent);filter:none}
.button.danger{background:transparent;color:var(--danger);border-color:color-mix(in srgb,var(--danger) 40%,var(--line))}
.button.danger:hover{background:var(--danger-soft);color:var(--danger);filter:none}
.button[aria-current=page]{box-shadow:inset 0 0 0 2px var(--on-accent)}
label.button:focus-within{outline:3px solid var(--accent);outline-offset:3px}
.text-link{display:inline-flex;align-items:center;gap:10px;font-weight:650;color:var(--accent)}
.text-link:hover{text-decoration:underline;text-underline-offset:6px}
.arrow::after{content:"→"}
[dir=rtl] .arrow::after{content:"←"}
.arrow.back::after{content:"←"}
[dir=rtl] .arrow.back::after{content:"→"}
.strong-link{font-weight:700;color:var(--accent);word-break:break-all}
.actions{display:flex;align-items:center;flex-wrap:wrap;gap:14px 20px;margin-top:24px}
.actions.center{justify-content:center;margin-top:16px}

/* landing */
.hero{display:grid;grid-template-columns:1.05fr .95fr;gap:64px;align-items:center;padding-block:64px 52px}
.eyebrow{font-size:13px;font-weight:650;color:var(--accent);letter-spacing:.03em;margin-bottom:16px}
.hero h1{font-size:clamp(38px,4.6vw,64px);line-height:1.25;letter-spacing:-1.2px;margin-bottom:22px}
[lang=en] .hero h1{letter-spacing:-2px;line-height:1.12}
.hero-description{font-size:19px;line-height:1.9;max-width:34em}
.hero-figure{margin:0;background:var(--soft);border-radius:var(--radius);padding:28px;box-shadow:var(--shadow)}
.hero-art{width:100%;height:auto;display:block}
.hero-art .paper{fill:var(--paper);stroke:var(--line);stroke-width:1.5}
.hero-art .paper-top{fill:var(--surface)}
.hero-art .dot,.hero-art .line{fill:var(--line)}
.hero-art .line.strong{fill:var(--muted);opacity:.55}
.hero-art .pill{fill:var(--accent);opacity:.85}
.hero-art .link-card{fill:var(--accent)}
.hero-art .link-icon{fill:var(--on-accent);opacity:.2}
.hero-art .link-arrow{fill:none;stroke:var(--on-accent);stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.hero-art .on-dark{fill:var(--on-accent);opacity:.85}
.hero-art .on-dark.faint{opacity:.45}
.hero-art .wave{fill:none;stroke:var(--accent);stroke-width:3;stroke-linecap:round;opacity:.6}
.hero-art .wave.faint{opacity:.25}
.hero-art .clock-face{fill:var(--paper);stroke:var(--accent);stroke-width:2}
.hero-art .clock-hand{fill:none;stroke:var(--accent);stroke-width:3;stroke-linecap:round}
.principles-strip{border-block:1px solid var(--line)}
.principles-strip .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px 24px;min-height:70px;font-size:14px;flex-wrap:wrap;padding-block:12px}
.principles-strip p{font-weight:650;color:var(--ink)}
.principles-strip span{color:var(--muted)}
.section{padding-block:72px}
.band{background:var(--surface);border-block:1px solid var(--line)}
.section-heading{max-width:780px;margin-bottom:32px}
.section-heading h2,.section h2{font-size:clamp(28px,2.8vw,40px);letter-spacing:-.5px;margin-bottom:14px}
.section-heading p{font-size:18px}
.section h3{margin-bottom:8px}
.three{display:grid;grid-template-columns:repeat(3,1fr);gap:32px}
.feature{border-top:2px solid var(--accent);padding-top:20px}
.feature p{font-size:16px}
.card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:20px;padding:0;margin:0;list-style:none}
.card{background:var(--paper);border:1px solid var(--line);border-radius:var(--radius);padding:24px;min-width:0}
.card p{font-size:15px}
a.card{display:block;transition:border-color .15s,transform .15s}
a.card:hover{border-color:var(--accent);transform:translateY(-2px);color:var(--ink)}
.more{margin-top:24px}
.steps{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(3,1fr);gap:32px;counter-reset:s}
.steps li{counter-increment:s;padding-inline-start:52px;position:relative}
.steps li::before{content:counter(s);position:absolute;inset-inline-start:0;top:2px;width:36px;height:36px;border-radius:var(--radius);background:var(--soft);color:var(--accent);font-weight:750;display:grid;place-items:center}
.steps p{font-size:16px}
.tool-band{background:var(--soft);padding:40px 44px;border-radius:var(--radius);display:grid;grid-template-columns:1fr auto;align-items:center;gap:48px}
.tool-band h2{font-size:32px}
.tool-band p{max-width:60ch;color:var(--ink);opacity:.85}
.tool-band .actions{margin-top:0}
.two-col{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:48px;align-items:start}
.code{background:var(--code);color:var(--code-ink);border-radius:var(--radius);padding:20px 22px;overflow:auto;font:13.5px/1.7 var(--mono);text-align:left;margin:0;direction:ltr}
.checks{list-style:none;padding:0;margin:18px 0 0}
.checks li{position:relative;padding-inline-start:28px;margin-bottom:10px;color:var(--muted);font-size:16px}
.checks li::before{content:"✓";position:absolute;inset-inline-start:0;color:var(--accent);font-weight:700}

/* directory */
.dir-team{margin-top:28px}
.dir-team h3{font-size:20px;margin-bottom:14px;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.count{font-size:13px;font-weight:600;color:var(--muted);background:var(--surface);border:1px solid var(--line);padding:1px 10px;border-radius:999px}
.dir-card{display:flex;flex-direction:column;gap:6px}
.dir-title{font-weight:700;font-size:18px;line-height:1.5}
.dir-title:hover{text-decoration:underline;text-underline-offset:5px}
.dir-url{font-size:13px;color:var(--accent);word-break:break-all}

/* uploader */
.try{scroll-margin-top:24px}
.drop{margin:8px 0 12px;padding:36px 24px;border:2px dashed var(--line);border-radius:var(--radius);background:var(--paper);text-align:center;transition:border-color .15s,background .15s}
.drop:focus-visible{outline-offset:2px}
.drop.over{border-color:var(--accent);background:var(--soft)}
.drop-icon{width:44px;height:44px;color:var(--accent)}
.stroke{fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.drop-title{font-weight:650;font-size:18px;color:var(--ink);margin-top:6px}
.ttl{display:inline-flex;gap:10px;align-items:center;margin-top:12px;font-weight:600;font-size:15px}
input,select,textarea{background:var(--paper);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:9px 12px;min-height:46px}
select{padding-inline-end:28px}
input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
input[aria-invalid=true]{border-color:var(--danger)}
.status{min-height:1.6em;font-weight:600;margin-top:10px}
.status.err{color:var(--danger)}
.flash{border:1px solid var(--line);border-inline-start:4px solid var(--accent);background:var(--paper);border-radius:var(--radius);padding:18px 22px;margin-block:20px}
.flash:focus{outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 35%,transparent)}
.flash p{color:var(--ink);font-weight:600}
.flash.err{border-inline-start-color:var(--danger);background:var(--danger-soft)}
.flash.err p{color:var(--danger)}
.flash h3{margin-bottom:8px}
.copy-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:10px}
.token{display:block;font:13px/1.6 var(--mono);background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:10px 12px;word-break:break-all;text-align:left;flex:1;min-width:0}
.secret{margin-top:16px;padding-top:16px;border-top:1px solid var(--line)}
.secret p{font-weight:400;color:var(--muted);font-size:15px}
.team-hint{margin-top:12px}
.mine-title{margin-top:32px;margin-bottom:8px}
.mine{list-style:none;padding:0;margin:0}
.mine li{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid var(--line)}
.mine li.empty{color:var(--muted)}
.mine a{word-break:break-all;color:var(--accent);font-weight:600}

/* pages: login, dashboard, admin */
.page-wide{padding-block:48px 80px}
.page-narrow{width:min(620px,calc(100% - 48px));padding-block:56px 90px}
.page-heading{margin-bottom:28px}
.page-heading.with-aside{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;flex-wrap:wrap}
.page-heading h1{font-size:clamp(30px,3.4vw,46px);letter-spacing:-.6px;line-height:1.3;margin-bottom:10px}
.page-heading>div>p:not(.eyebrow),.page-heading>p{font-size:18px;max-width:62ch}
.head-tools{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.segmented{display:flex;gap:6px;flex-wrap:wrap}
.button[aria-current=page]{background:var(--soft);border-color:var(--accent);color:var(--accent)}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:28px}
.panel>h2{margin-bottom:6px}
.panel label{display:block;font-weight:650;font-size:15px;margin-top:14px;margin-bottom:6px}
.panel input[type=text],.panel input[type=password]{width:100%}
.panel .button{margin-top:18px}
.form-help{font-size:13px;margin-top:6px}
.login-form{display:flex;flex-direction:column}
.login-form .button{align-self:flex-start}
.login-foot{margin-top:20px}
label.check{display:flex;gap:10px;align-items:center;font-weight:600;margin-top:12px}
label.check input{min-height:0;width:18px;height:18px;accent-color:var(--accent)}
label.check.small{font-size:13px;font-weight:500;margin:0}
.block{margin-top:44px}
.block>h2,.block h2{font-size:26px;margin-bottom:16px}
.status-list{list-style:none;display:flex;flex-wrap:wrap;gap:10px 28px;padding:16px 20px;margin:0;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);font-size:15px}
.status-list li{display:flex;gap:8px;align-items:center}
.dot-status{width:10px;height:10px;border-radius:50%;background:var(--muted);flex-shrink:0}
.dot-status.on{background:#2f8f5b}
.dot-status.off{background:var(--line);border:1px solid var(--muted)}
.dot-status.warn{background:#d39a1e}
.table-wrap{position:relative;overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius);background:var(--paper)}
table.data{width:100%;border-collapse:collapse;font-size:15px}
table.data th,table.data td{padding:12px 16px;text-align:start;border-bottom:1px solid var(--line);vertical-align:middle}
table.data thead th{font-size:13px;font-weight:650;color:var(--muted);background:var(--surface);white-space:nowrap}
table.data tbody tr:last-child>*{border-bottom:0}
table.data tbody th{font-weight:650}
table.data tbody th a:hover,table.data a.url:hover{text-decoration:underline;text-underline-offset:4px}
table.data a.url{color:var(--accent);font-size:13px;word-break:break-all}
table.data time{white-space:nowrap;font-size:14px}
table.data th .meta{font-size:12.5px;font-weight:500;margin-top:2px}
table.data td.cell-actions .acts,table.data td.cell-actions .inline-form{justify-content:flex-end}
.table-note{font-size:13px;margin-top:10px}
.filter-panel{padding:16px 20px;margin-bottom:16px}
.filter-panel label{margin:0}
.filter-panel select{min-width:220px}
.checks-row{gap:8px 28px}
.checks-row label.check{margin-top:4px}
.value{font:12.5px/1.5 var(--mono);white-space:pre-wrap;word-break:break-all;display:block;max-width:46ch;max-height:7.5em;overflow:auto}
.acts{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.inline-form{display:inline-flex;gap:8px;align-items:center;margin:0;flex-wrap:wrap}
.badge{display:inline-block;font-size:12px;font-weight:650;padding:2px 10px;border-radius:999px;border:1px solid var(--line);white-space:nowrap}
.badge.on{background:var(--soft);color:var(--accent);border-color:transparent}
.badge.muted{color:var(--muted)}
.team-upload .drop{margin-top:16px}
.form-row{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-top:8px}
.form-row .ttl{margin-top:0}
.form-row .button{margin-top:0}
.site-summary .facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:16px;margin:20px 0 0}
.facts dt{font-size:13px;color:var(--muted);font-weight:600}
.facts dd{margin:2px 0 0;font-weight:600}
.site-summary .actions{border-top:1px solid var(--line);padding-top:18px;margin-top:20px}
.site-summary .ttl{margin-top:0}
.breadcrumb{display:inline-flex;gap:8px;color:var(--accent);font-size:14px;font-weight:600;margin-bottom:18px}
.file-list{list-style:none;padding:0;margin:0;max-height:420px;overflow:auto;border:1px solid var(--line);border-radius:var(--radius);background:var(--paper)}
.file-list li{display:flex;justify-content:space-between;gap:12px;padding:8px 14px;border-bottom:1px solid var(--line);font:13px/1.6 var(--mono)}
.file-list li:last-child{border-bottom:0}
.empty-state{text-align:center;padding:48px 20px;border:1px dashed var(--line);border-radius:var(--radius);background:var(--paper)}
.empty-state svg{width:56px;height:56px;color:var(--accent);opacity:.7}
.empty-state h2{margin-block:10px 6px}
.result-panel{padding-block:72px 96px;max-width:760px}
.big-code{font-size:72px;font-weight:800;color:var(--accent);line-height:1;margin-bottom:12px}
.result-panel h1{font-size:clamp(28px,3vw,40px);margin-bottom:12px}
.result-panel p{font-size:18px}

/* docs */
.docs-grid{margin-top:8px}
.doc-card h2{margin-bottom:6px}
.docs-layout{display:grid;grid-template-columns:240px minmax(0,1fr);gap:48px;padding-block:44px 80px}
.docs-nav ul{list-style:none;padding:0;margin:0 0 16px}
.docs-nav a{display:block;padding:7px 12px;border-radius:6px;font-size:15px}
.docs-nav a[aria-current=page]{background:var(--surface);font-weight:650;color:var(--accent)}
.prose{min-width:0;max-width:820px;font-size:17px;line-height:1.9;overflow-wrap:anywhere}
.prose h1{font-size:clamp(30px,3.2vw,42px);margin-bottom:18px}
.prose h2{font-size:27px;margin-block:36px 12px}
.prose h3{margin-block:24px 10px}
.prose p{margin-bottom:16px}
.prose ul,.prose ol{color:var(--muted);padding-inline-start:24px}
.prose a{color:var(--accent);text-decoration:underline;text-underline-offset:4px}
.prose pre{background:var(--code);color:var(--code-ink);border-radius:var(--radius);padding:16px 18px;overflow:auto;font:13.5px/1.7 var(--mono);direction:ltr;text-align:left}
.prose :not(pre)>code{font:.88em var(--mono);background:var(--surface);border:1px solid var(--line);border-radius:4px;padding:1px 6px}
.prose .table{overflow-x:auto}
.prose table{border-collapse:collapse;width:100%;font-size:15px}
.prose th,.prose td{border:1px solid var(--line);padding:8px 10px;text-align:start}
.prose blockquote{border-inline-start:3px solid var(--accent);margin:24px 0;padding:10px 22px;background:var(--surface)}

/* footer */
.site-footer{border-top:1px solid var(--line);padding-top:48px;background:var(--surface);margin-top:0}
.footer-grid{display:grid;grid-template-columns:1.6fr repeat(3,1fr);gap:48px;padding-bottom:40px}
.footer-grid p{font-size:14px;max-width:38ch;margin-top:18px}
.footer-grid h2{font-size:15px;margin-bottom:14px}
.footer-grid>div:not(:first-child) a{display:block;font-size:14px;margin-block:8px;color:var(--muted)}
.footer-grid a:hover{text-decoration:underline;text-underline-offset:4px;color:var(--accent)}
.footer-bottom{border-top:1px solid var(--line);padding-block:18px;font-size:13px}
.footer-bottom p{font-size:13px}

/* responsive */
@media (max-width:1000px){
  .hero{grid-template-columns:1fr;gap:36px;padding-top:44px}
  .hero-figure{max-width:560px}
  .tool-band{grid-template-columns:1fr;gap:20px;padding:32px}
  .footer-grid{grid-template-columns:1fr 1fr;gap:32px}
  .docs-layout{grid-template-columns:1fr;gap:20px}
}
@media (max-width:820px){
  .wrap{width:calc(100% - 40px)}
  .desktop-nav{display:none}
  .mobile-menu{display:block}
  .header-inner{min-height:66px;gap:12px}
  .header-tools{gap:10px}
  .header-tools>.button.small{display:none}
  .three,.steps,.two-col{grid-template-columns:1fr;gap:28px}
  .section{padding-block:52px}
  .hero-description{font-size:17px}
  .page-wide{padding-block:32px 64px}
  .panel{padding:20px}
  table.data th,table.data td{padding:10px 12px}
  /* data tables become a stack of cards: one card per row, label beside each value */
  .table-wrap:has(table.stack){border:0;background:none;overflow:visible}
  table.data.stack,table.data.stack tbody,table.data.stack tr,table.data.stack th,table.data.stack td{display:block;width:100%}
  table.data.stack thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
  table.data.stack tr{background:var(--paper);border:1px solid var(--line);border-radius:var(--radius);margin-bottom:12px;overflow:hidden}
  table.data.stack tbody th{background:var(--surface);border-bottom:1px solid var(--line);font-size:16px}
  table.data.stack td{display:flex;justify-content:space-between;align-items:center;gap:12px;border-bottom:1px solid var(--line)}
  table.data.stack tbody tr:last-child>*{border-bottom:1px solid var(--line)}
  table.data.stack tbody tr>:last-child{border-bottom:0}
  table.data.stack td::before{content:attr(data-label);font-size:13px;font-weight:650;color:var(--muted);flex-shrink:0}
  table.data.stack td.cell-actions{display:block}
  table.data.stack td.cell-actions::before{display:none}
  table.data.stack td.cell-actions .acts,table.data.stack td.cell-actions .inline-form{justify-content:flex-start}
  .filter-panel select{min-width:0;flex:1}
}
@media (max-width:520px){
  body{font-size:16px}
  .wordmark{font-size:20px}
  .brand-mark{width:30px;height:30px;font-size:21px}
  .footer-grid{grid-template-columns:1fr}
  .principles-strip span{display:none}
  .drop{padding:28px 14px}
  .button{padding-inline:18px}
}
`;

export const APP_JS = `
const lang = document.documentElement.lang === "ar" ? "ar" : "en";
const T = {
  en: { uploading: "Publishing…", del: "Delete", expires: "Expires", copied: "Copied", copy: "Copy link", failed: "Publishing failed" },
  ar: { uploading: "جارٍ النشر…", del: "حذف", expires: "ينتهي", copied: "تم النسخ", copy: "انسخ الرابط", failed: "تعذّر النشر" },
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
    a.href = d.url; a.target = "_blank"; a.rel = "noopener"; a.dir = "ltr"; a.textContent = d.url.replace(/^https?:\\/\\//, "");
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = T.expires + " " + new Date(d.expiresAt).toLocaleString(lang === "ar" ? "ar-EG" : undefined);
    left.append(a, meta);
    const del = document.createElement("button");
    del.className = "button small danger"; del.type = "button"; del.textContent = T.del;
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

function status(msg, err) { const s = $("status"); s.textContent = msg || ""; s.className = err ? "status err" : "status"; }

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

// ---- team dashboard: drag-and-drop / folder uploads with the CSRF token ----------
for (const form of document.querySelectorAll("form[data-upload]")) {
  const drop = form.querySelector("[data-drop]");
  const pick = form.querySelector("[data-pick]");
  const pickDir = form.querySelector("[data-pick-dir]");
  const chosen = form.querySelector("[data-chosen]");
  const st = form.querySelector("[data-status]");
  const submit = form.querySelector("button[type=submit]");
  let items = null; // [{file, path}] from a drop or a folder pick
  const show = (list) => { chosen.textContent = list.length === 1 ? list[0].path : list.length + " × " + (list[0] ? list[0].path.split("/")[0] + "…" : ""); };
  const setItems = (list) => { items = list; pick.required = !list.length; show(list); };
  const say = (msg, err) => { st.textContent = msg || ""; st.className = err ? "status err" : "status"; };
  pick.addEventListener("change", () => { items = null; show([...pick.files].map((f) => ({ file: f, path: f.name }))); });
  if (pickDir) pickDir.addEventListener("change", () => setItems([...pickDir.files].map((f) => ({ file: f, path: f.webkitRelativePath || f.name }))));
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("over")));
  drop.addEventListener("drop", async (e) => {
    e.preventDefault();
    const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    setItems(entries.length ? (await Promise.all(entries.map((en) => walk(en, "")))).flat() : [...e.dataTransfer.files].map((f) => ({ file: f, path: f.name })));
  });
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick.click(); } });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const list = items && items.length ? items : [...pick.files].map((f) => ({ file: f, path: f.name }));
    if (!list.length) { pick.focus(); return; }
    const fd = new FormData();
    for (const [k, v] of new FormData(form)) if (k !== "files") fd.append(k, v);
    for (const { file, path } of list) { fd.append("files", file, file.name); fd.append("paths", path); }
    submit.disabled = true; say(form.dataset.uploading);
    try {
      const r = await fetch(form.action, { method: "POST", body: fd, headers: { Accept: "application/json", "X-CSRF-Token": fd.get("_csrf") }, credentials: "same-origin" });
      const j = await r.json().catch(() => ({}));
      if (j.redirect) { location.assign(j.redirect); return; }
      say((j.error && j.error.message) || (form.dataset.failed + " (HTTP " + r.status + ")"), true);
    } catch (err) { say(form.dataset.failed + ": " + err, true); }
    submit.disabled = false;
  });
}

// ---- confirmations, copy buttons, focus the flash message -----------------------
for (const form of document.querySelectorAll("form[data-confirm]")) {
  form.addEventListener("submit", (e) => { if (!confirm(form.dataset.confirm)) e.preventDefault(); });
}
for (const b of document.querySelectorAll("[data-copy]")) {
  b.addEventListener("click", async () => {
    const el = document.querySelector(b.dataset.copy);
    if (!el) return;
    const text = el.href || el.textContent;
    try { await navigator.clipboard.writeText(text); const old = b.textContent; b.textContent = b.dataset.copied || "✓"; setTimeout(() => { b.textContent = old; }, 1600); } catch {}
  });
}
document.documentElement.classList.add("js");
const flash = document.getElementById("flash");
if (flash) flash.focus();
for (const d of document.querySelectorAll("details.mobile-menu")) {
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && d.open) { d.open = false; d.querySelector("summary").focus(); } });
}
`;
