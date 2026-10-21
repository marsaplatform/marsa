import { createHash } from "node:crypto";
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
.dir-team{margin-top:36px}
.dir-team-head{font-size:20px;margin-bottom:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.count{font-size:13px;font-weight:600;color:var(--muted);background:var(--surface);border:1px solid var(--line);padding:1px 10px;border-radius:999px}
.dir-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:22px;padding:0;margin:0;list-style:none}
.dir-card{background:var(--paper);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;min-width:0;display:flex;flex-direction:column;transition:border-color .15s,transform .15s,box-shadow .15s}
.dir-card:hover,.dir-card:focus-within{border-color:var(--accent);transform:translateY(-3px);box-shadow:var(--shadow)}
.dir-link{display:flex;flex-direction:column;color:inherit}
.dir-link:hover{color:inherit}
.dir-link:focus-visible{outline-offset:-3px;border-radius:var(--radius) var(--radius) 0 0}
.dir-body{display:flex;flex-direction:column;gap:4px;padding:16px 20px 0}
.dir-title{font-weight:700;font-size:18px;line-height:1.5;color:var(--ink)}
.dir-link:hover .dir-title{text-decoration:underline;text-underline-offset:5px;color:var(--accent)}
.dir-url{font-size:13px;color:var(--accent);word-break:break-all}
.dir-expiry{padding:6px 20px 18px;margin-top:auto}
.thumb{display:block;aspect-ratio:16/9;background:var(--surface);border-bottom:1px solid var(--line);overflow:hidden;position:relative}
.thumb img,.thumb .thumb-art{display:block;width:100%;height:100%;object-fit:cover;object-position:top center;transition:transform .35s}
.dir-card:hover .thumb img,.dir-card:hover .thumb-art,.feature-card:hover .thumb img,.feature-card:hover .thumb-art{transform:scale(1.03)}
/* drawn placeholders: one palette per team */
.thumb-art .ph-bg{fill:var(--pb)}
.thumb-art .ph-orb{fill:var(--pa);opacity:.14}
.thumb-art .ph-win{fill:var(--pw)}
.thumb-art .ph-bar{fill:var(--pl);opacity:.55}
.thumb-art .ph-dot{fill:var(--pa);opacity:.45}
.thumb-art .ph-line{fill:var(--pl)}
.thumb-art .ph-line.strong{fill:var(--pa);opacity:.55}
.thumb-art .ph-pill{fill:var(--pa);opacity:.85}
.thumb-art .ph-wave{fill:none;stroke:var(--pa);stroke-width:2.4;stroke-linecap:round;opacity:.4}
.thumb-art .ph-glyph{fill:var(--pa);font:800 76px/1 var(--font)}
.ph-0{--pb:#dceccf;--pw:#fbfcfa;--pl:#c3d6bf;--pa:#145a49}
.ph-1{--pb:#d7ebe7;--pw:#fbfdfc;--pl:#b9d5cf;--pa:#0f5c5a}
.ph-2{--pb:#efe6d2;--pw:#fffdf8;--pl:#dccfb3;--pa:#7a5413}
.ph-3{--pb:#e3e8d1;--pw:#fcfdf8;--pl:#cdd5b4;--pa:#4f5d1c}
.ph-4{--pb:#dfe5ef;--pw:#fbfcfe;--pl:#c5cfdf;--pa:#284a7a}
.ph-5{--pb:#eedfdc;--pw:#fffbfa;--pl:#dcc6c1;--pa:#8a3a2b}
@media (prefers-color-scheme:dark){
  .ph-0{--pb:#21402f;--pw:#1c342c;--pl:#385548;--pa:#c8e6aa}
  .ph-1{--pb:#18403d;--pw:#173431;--pl:#2f5a55;--pa:#9fe0d4}
  .ph-2{--pb:#3d3420;--pw:#2e281b;--pl:#5a4c2e;--pa:#f0cf8a}
  .ph-3{--pb:#33391d;--pw:#282d18;--pl:#4d5530;--pa:#d6e29a}
  .ph-4{--pb:#1f2f45;--pw:#1a2638;--pl:#34465f;--pa:#a9c5ef}
  .ph-5{--pb:#3f2622;--pw:#30201d;--pl:#5a3b35;--pa:#f2b3a5}
}
.team-avatar{display:inline-grid;place-items:center;width:34px;height:34px;flex-shrink:0;border-radius:var(--radius);background:var(--pb);color:var(--pa);font-weight:800;font-size:18px;line-height:1}

/* featured */
.featured{padding-bottom:8px}
.feature-card{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);background:var(--paper);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow)}
.feature-thumb{display:block;min-width:0}
.feature-thumb .thumb{height:100%;min-height:100%;border-bottom:0;border-inline-end:1px solid var(--line)}
.feature-body{padding:40px 44px;display:flex;flex-direction:column;justify-content:center;gap:10px;min-width:0}
.feature-body .eyebrow{margin-bottom:0}
.featured h2{font-size:clamp(26px,2.6vw,36px);margin:0}
.feature-team{display:flex;align-items:center;gap:10px;color:var(--ink);font-weight:600}
.feature-body .actions{margin-top:14px}

/* hero stats + how strip */
.hero-stats{display:grid;grid-template-columns:repeat(3,minmax(0,auto));justify-content:start;gap:12px 40px;margin:36px 0 0;padding-top:24px;border-top:1px solid var(--line)}
.hero-stats div{display:flex;flex-direction:column-reverse;gap:2px}
.hero-stats dd{margin:0;font-size:30px;font-weight:800;line-height:1.2;color:var(--accent)}
.hero-stats dt{font-size:14px;color:var(--muted)}
.how-strip{background:var(--surface);border-bottom:1px solid var(--line);padding-block:44px}
.how-strip .wrap{display:grid;grid-template-columns:minmax(180px,.5fr) minmax(0,2fr);gap:40px;align-items:start}
.how-head h2{font-size:clamp(24px,2.2vw,32px);margin:0}
.how-head .eyebrow{margin-bottom:6px}
.how-steps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:28px}
.how-steps li{display:flex;gap:16px;align-items:flex-start}
.how-icon{display:grid;place-items:center;width:52px;height:52px;flex-shrink:0;border-radius:var(--radius);background:var(--paper);border:1px solid var(--line)}
.how-icon svg{width:30px;height:30px;fill:none;stroke:var(--accent);stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.how-steps h3{font-size:18px;margin-bottom:4px}
.how-num{color:var(--accent);margin-inline-end:2px}
.how-steps p{font-size:15px;line-height:1.7}

/* permanent sites + quotas */
.badge.perm{font-weight:700}
.quota-form{display:grid;grid-template-columns:repeat(2,minmax(0,70px));gap:6px;align-items:center}
.quota-form .button{grid-column:1/-1;justify-self:start}
.quota-field input{width:100%;padding:6px 8px;font-size:14px;border:1px solid var(--line);border-radius:var(--radius);background:var(--paper)}
@media (max-width:820px){.quota-form{grid-template-columns:repeat(2,90px)}}

/* members */
.member-login{margin-bottom:8px}
.member-login h2{margin:0 0 4px}
.login-or{margin:28px 0 2px}
.invite-form,.role-form{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:4px}
.invite-form select,.role-form select{width:auto;min-width:0;padding:4px 8px;font-size:13px}
.invite-panel .form-row{align-items:flex-end;flex-wrap:wrap;gap:12px}
.invite-panel label{display:flex;flex-direction:column;gap:4px;font-weight:600;font-size:14px}
.role-help{margin:12px 0 0;padding-inline-start:18px}
.role-help li{margin:2px 0}
.audit-table td{vertical-align:top}
.account-block .panel input{width:100%}
.head-tools .segmented{margin-inline-end:8px}

/* visits */
.visits-cell{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.spark{display:block;flex:none;color:var(--accent)}
.spark-line{fill:none;stroke:currentColor;stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round}
.spark-area{fill:currentColor;opacity:.12}
.visits-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;margin:12px 0 0}
.visits-facts dd.num{font-size:24px;font-variant-numeric:tabular-nums}
.visits-chart{margin:18px 0 6px}
.visits-chart svg{display:block;width:100%;height:120px}
.visits-chart .bar{fill:var(--accent)}
.visits-chart .bar.zero{fill:var(--line)}
.visits-chart figcaption{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-top:6px;font-family:var(--mono)}

/* MCP panel */
.mcp-block>p{max-width:70ch}
.mcp-endpoint{margin:14px 0 6px;flex-wrap:wrap}
.mcp-endpoint code{font-size:14px;word-break:break-all}
.mcp-create{margin-top:16px}
.mcp-create .form-row{align-items:flex-end;flex-wrap:wrap;gap:12px}
.mcp-create label{display:flex;flex-direction:column;gap:4px;font-weight:600;font-size:14px}
.mcp-create label.grow{flex:1 1 240px}
.mcp-create input,.mcp-create select{width:100%}
.snippet-label{font-size:13px;font-weight:650;color:var(--ink);margin:10px 0 6px}
.mcp-snippets .code{font-size:12.5px}
.mcp-snippets>div{min-width:0}
.mcp-block h3{margin-top:22px}

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
.team-upload.compact .drop{padding:20px 16px;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px 18px}
.team-upload.compact .drop-icon{width:30px;height:30px}
.team-upload.compact .drop-title,.team-upload.compact .drop .actions{margin:0}
.team-upload.compact .drop .meta{flex-basis:100%;margin:0}
.team-upload.compact .drop .meta:empty{display:none}
.page-heading h1{overflow-wrap:anywhere}
.status-list.compact{margin-bottom:20px}
.status-list a{word-break:break-all}
[dir=rtl] .kv-key,[dir=rtl] .file-path{text-align:right}
.facts .fact-wide{grid-column:1/-1}
.site-summary>h2{margin-bottom:0}
.site-actions{align-items:center;gap:12px}
.push-end{margin-inline-start:auto}
.backend-block h3{font-size:19px;margin:28px 0 12px}
.backend-block h3:first-of-type{margin-top:8px}
table.kv-table{table-layout:fixed}
table.kv-table thead th:first-child{width:30%}
table.kv-table thead th:last-child{width:112px}
.kv-key{font:13px/1.5 var(--mono);word-break:break-all;color:var(--ink);display:block;text-align:left}
.kv-value summary{list-style:none;cursor:pointer;display:flex;gap:10px;align-items:center;min-width:0;border-radius:6px;padding:4px 6px;margin:-4px -6px}
.kv-value summary::-webkit-details-marker{display:none}
.kv-value summary::before{content:"+";flex-shrink:0;width:20px;height:20px;border:1px solid var(--line);border-radius:5px;display:inline-grid;place-items:center;font:600 13px/1 var(--mono);color:var(--accent)}
.kv-value[open] summary::before{content:"−"}
.kv-value summary:hover{background:var(--surface)}
.kv-value summary code{font-family:inherit;font-size:13px;line-height:1.6;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1;text-align:left}
.kv-value pre{margin:10px 0 0;background:var(--code);color:var(--code-ink);border-radius:var(--radius);padding:14px 16px;font:12.5px/1.65 var(--mono);white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto;text-align:left}
.more-keys{margin-top:12px}
.more-keys summary{cursor:pointer;color:var(--accent);font-weight:600;font-size:14px}
.key-chips{list-style:none;display:flex;flex-wrap:wrap;gap:8px;padding:0;margin:12px 0 0}
.key-chips code{display:inline-block;font:12.5px/1.5 var(--mono);background:var(--paper);border:1px solid var(--line);border-radius:6px;padding:2px 8px}
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
.file-list li{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:9px 16px;border-bottom:1px solid var(--line);font-size:14px}
.file-path{font:13px/1.6 var(--mono);word-break:break-all;text-align:left}
.file-size{color:var(--muted);font-size:13px;white-space:nowrap}
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
  .feature-card{grid-template-columns:1fr}
  .feature-thumb .thumb{aspect-ratio:16/9;height:auto;border-inline-end:0;border-bottom:1px solid var(--line)}
  .feature-body{padding:28px}
  .how-strip .wrap{grid-template-columns:1fr;gap:24px}
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
  .how-steps{grid-template-columns:1fr;gap:20px}
  .hero-stats{gap:12px 28px}
  .hero-stats dd{font-size:26px}
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
  table.kv-table{table-layout:auto}
  table.kv-table.stack tr{display:grid;grid-template-columns:minmax(0,1fr) auto}
  table.kv-table.stack tbody th{grid-column:1;grid-row:1;border-bottom:0}
  table.kv-table.stack td.cell-actions{grid-column:2;grid-row:1;width:auto;display:flex;align-items:center;background:var(--surface);border-bottom:0}
  table.kv-table.stack td.cell-value{grid-column:1/-1;border-top:1px solid var(--line);border-bottom:0}
  table.kv-table.stack td.cell-value::before{display:none}
  table.data.stack td.cell-value{display:block}
  table.data.stack td.cell-value::before{display:block;margin-bottom:6px}
  .push-end{margin-inline-start:0}
  .head-tools{width:100%}
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
  .hero-stats{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 16px}
  .hero-stats dd{font-size:22px}
  .hero-stats dt{font-size:12.5px;line-height:1.5}
  .dir-grid{grid-template-columns:1fr}
  .feature-body{padding:22px 20px}
  .drop{padding:28px 14px}
  .button{padding-inline:18px}
}

/* ---- dashboard shell (0.13.0) ---------------------------------------------------- */
.dash-body{font-size:16px;line-height:1.7}
.dash-top{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:14px;height:60px;padding-inline:clamp(12px,2vw,24px);background:var(--bg);border-bottom:1px solid var(--line)}
.dash-top .wordmark{font-size:20px}
.dash-top .brand-mark{width:30px;height:30px;font-size:20px}
.dash-area{font-size:13px;font-weight:650;color:var(--muted);padding:3px 10px;border:1px solid var(--line);border-radius:999px;white-space:nowrap}
.dash-top-tools{margin-inline-start:auto;display:flex;align-items:center;gap:12px}
.nav-toggle{width:42px;height:42px;place-items:center;border:1px solid var(--line);border-radius:var(--radius);background:transparent;padding:0}
.dash{display:grid;grid-template-columns:252px minmax(0,1fr);min-height:calc(100vh - 60px);background:linear-gradient(to right,var(--surface) 251px,var(--line) 251px,var(--line) 252px,transparent 252px)}
[dir=rtl] .dash{background:linear-gradient(to left,var(--surface) 251px,var(--line) 251px,var(--line) 252px,transparent 252px)}
.dash-main .page-heading .eyebrow{display:none}
.recent-table th .meta{word-break:break-all}
.dash-side{position:sticky;top:60px;align-self:start;height:calc(100vh - 60px);overflow-y:auto;display:flex;flex-direction:column;gap:18px;padding:20px 14px;background:var(--surface);border-inline-end:1px solid var(--line)}
.side-ctx{display:flex;gap:12px;align-items:center;padding:4px 8px 14px;border-bottom:1px solid var(--line)}
.side-ctx strong{display:block;font-size:15px;line-height:1.4;overflow-wrap:anywhere}
.side-ctx .meta{display:block;font-size:12.5px;line-height:1.5}
.side-avatar{flex:none;display:grid;place-items:center;width:38px;height:38px;border-radius:10px;background:var(--accent);color:var(--on-accent);font-weight:750;font-size:18px}
.side-nav ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.side-nav a,.side-foot a,.side-out{display:flex;align-items:center;gap:12px;padding:9px 12px;border-radius:8px;font-size:15px;font-weight:600;color:var(--ink);width:100%;border:0;background:none;text-align:start}
.side-nav a:hover,.side-foot a:hover,.side-out:hover{background:color-mix(in srgb,var(--accent) 9%,transparent);color:var(--ink)}
.side-nav a[aria-current=page]{background:var(--paper);color:var(--accent);box-shadow:inset 3px 0 0 var(--accent),0 1px 2px #0000000d}
[dir=rtl] .side-nav a[aria-current=page]{box-shadow:inset -3px 0 0 var(--accent),0 1px 2px #0000000d}
.side-foot{margin-top:auto;border-top:1px solid var(--line);padding-top:12px;display:flex;flex-direction:column;gap:2px}
.side-foot a,.side-out{font-size:14px;color:var(--muted)}
.side-out-form{margin:0}
.icon{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.dash-main{min-width:0;padding:22px clamp(16px,3vw,40px) 64px;max-width:1320px;width:100%}
.dash-main .page-wide{padding-block:4px 40px}
.dash-main .page-heading{margin-bottom:22px;align-items:flex-end}
.dash-main .page-heading h1{font-size:clamp(26px,2.4vw,34px);letter-spacing:-.3px;margin-bottom:4px}
.dash-main .page-heading>div>p:not(.eyebrow){font-size:15.5px}
.dash-main .eyebrow{margin-bottom:6px}
.dash-main .block{margin-top:32px}
.dash-main .block>h2,.dash-main .block h2,.block-head h2{font-size:21px;margin-bottom:12px}
.dash-main .head-tools .button .icon{width:16px;height:16px}
.crumbs ol{list-style:none;margin:0 0 14px;padding:0;display:flex;flex-wrap:wrap;gap:6px;font-size:13px;color:var(--muted)}
.crumbs li{display:flex;align-items:center;gap:6px;min-width:0}
.crumbs li+li::before{content:"/";opacity:.5}
.crumbs a:hover{color:var(--accent);text-decoration:underline;text-underline-offset:3px}
.crumbs [aria-current]{color:var(--ink);font-weight:600;overflow-wrap:anywhere}
.h4{font-size:15px;font-weight:700;color:var(--ink)}
/* stat cards */
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:18px}
.stat-grid.narrow{max-width:420px}
.stat-card{display:flex;flex-direction:column;gap:6px;padding:16px 18px;background:var(--paper);border:1px solid var(--line);border-radius:12px;color:var(--ink);transition:border-color .15s,box-shadow .15s}
a.stat-card:hover{border-color:var(--accent);box-shadow:var(--shadow);color:var(--ink)}
.stat-head{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600;color:var(--muted)}
.stat-head .icon{color:var(--accent)}
.stat-value{font-size:30px;font-weight:750;line-height:1.2;font-variant-numeric:tabular-nums}
.stat-sub{font-size:13px;color:var(--muted)}
progress.quota{appearance:none;-webkit-appearance:none;width:100%;height:6px;border:0;border-radius:99px;background:var(--line);overflow:hidden;color:var(--accent)}
progress.quota::-webkit-progress-bar{background:var(--line);border-radius:99px}
progress.quota::-webkit-progress-value{background:var(--accent);border-radius:99px}
progress.quota::-moz-progress-bar{background:var(--accent);border-radius:99px}
progress.quota.high::-webkit-progress-value{background:var(--warn)}
progress.quota.high::-moz-progress-bar{background:var(--warn)}
progress.quota.full::-webkit-progress-value{background:var(--danger)}
progress.quota.full::-moz-progress-bar{background:var(--danger)}
.quota-row{margin-top:14px}
.quota-label{display:flex;justify-content:space-between;gap:12px;font-size:14px;font-weight:600;margin-bottom:6px}
/* cards and columns */
.dash-cols{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(0,1fr);gap:20px;margin-top:26px;align-items:start}
.card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
.card-block{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:20px;min-width:0}
.card-block>h2.h3,.card-block h2.h3{font-size:17px;margin-bottom:10px}
.card-block .table-wrap{border-radius:8px}
.block-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
.block-head .text-link{font-size:14px}
.cf-card{margin-bottom:20px;gap:28px}
.feature-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;font-size:15px}
.panel .feature-list+p{margin:14px 0 0}
.facts.compact{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 16px;margin:12px 0 0}
.card-block .facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px 18px;margin:8px 0 0}
.facts dd{overflow-wrap:anywhere}
/* activity feed */
.feed{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.feed li{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}
.feed li:last-child{border-bottom:0}
.feed p{color:var(--ink);font-size:14.5px;line-height:1.6;overflow-wrap:anywhere}
.feed time{font-size:12.5px;color:var(--muted)}
.feed-dot{flex:none;width:9px;height:9px;border-radius:50%;margin-top:8px;background:var(--accent)}
.feed-dot.k-key,.badge.k-key{background:#c9a227}
.feed-dot.k-api,.badge.k-api{background:#3f7cc4}
.feed-dot.k-mcp,.badge.k-mcp{background:#8a5cc2}
.feed-dot.k-admin,.badge.k-admin{background:var(--danger)}
.badge.k-member{background:var(--soft);color:var(--accent);border-color:transparent}
.badge.k-key,.badge.k-api,.badge.k-mcp,.badge.k-admin{color:#fff;border-color:transparent}
/* table tools */
.js-only-block{display:none!important}
.js .js-only-block{display:flex!important}
.table-tools{gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.search-field input,.filters input[type=search],.filters select{min-height:40px;padding:6px 12px;border:1px solid var(--line);border-radius:var(--radius);background:var(--paper);min-width:min(260px,100%)}
.search-field{flex:1 1 240px;max-width:360px}
.search-field input{width:100%}
.no-match{margin-top:10px}
tr[hidden]{display:none!important}
th[data-sort] .sort-btn{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:4px;border-radius:4px}
th[data-sort] .sort-btn::after{content:"↕";opacity:.45;font-size:12px}
th[aria-sort=ascending] .sort-btn::after{content:"↑";opacity:1}
th[aria-sort=descending] .sort-btn::after{content:"↓";opacity:1}
th[data-sort] .sort-btn:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.filters{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;padding:14px 16px;margin-bottom:12px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius)}
.filters label{display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:650;color:var(--muted)}
.filters .text-link{font-size:14px;align-self:center}
.copy-cell{display:inline-flex;align-items:center;gap:6px;max-width:100%}
.icon-btn{display:inline-grid;place-items:center;width:32px;height:32px;flex:none;border:1px solid var(--line);border-radius:6px;background:transparent;color:var(--muted);padding:0}
.icon-btn:hover{color:var(--accent);border-color:var(--accent)}
.icon-btn.done{color:var(--accent);border-color:var(--accent);background:var(--soft)}
.icon-btn .icon{width:16px;height:16px}
.js .icon-btn.js-only{display:inline-flex!important;align-items:center;justify-content:center}
.starter-box{margin-block-end:1.25rem;border-inline-start:4px solid var(--accent,#0f5f4a)}
.starter-box h2{display:flex;align-items:center;gap:.4rem;margin:0 0 .4rem}
.starter-box details{margin-block-start:.6rem}
pre.tree{max-height:26rem;overflow:auto;font-size:.82rem;line-height:1.5;padding:.75rem;border-radius:8px;background:var(--code,#f4f6f5);direction:ltr;text-align:left}
.notes-callout{display:flex;gap:.6rem;align-items:flex-start;margin-block:1rem;font-size:.92rem}
.notes-callout>.icon{flex:none;margin-block-start:.15rem}
.notes-callout code{font-size:.85em}
.how-notes{margin-block-end:1rem}
.how-notes summary{cursor:pointer;font-weight:600;display:flex;align-items:center;gap:.4rem}
.how-notes pre{overflow-x:auto;font-size:.8rem;white-space:pre}
.note-msg{white-space:pre-wrap;overflow-wrap:anywhere;max-width:38rem;min-width:12rem}
.note-reply{margin-block-start:.4rem;padding:.35rem .55rem;border-inline-start:3px solid var(--accent,#0f5f4a);background:var(--soft,#f2f5f4);border-radius:4px;white-space:pre-wrap;overflow-wrap:anywhere}
.note-reply-form{margin-block-start:.35rem}
.note-reply-form summary{cursor:pointer;font-size:.85rem;display:inline-flex;align-items:center;gap:.3rem}
.note-reply-form form{display:grid;gap:.4rem;margin-block-start:.4rem}
.note-reply-form textarea{width:100%;min-width:14rem}
.repo-badges{display:flex;flex-wrap:wrap;gap:.25rem;margin-block-start:.2rem}
/* switches and per-row menus */
.pill-toggle{display:inline-flex;align-items:center;gap:8px;min-height:32px;padding:3px 12px 3px 4px;border:1px solid var(--line);border-radius:999px;background:var(--paper);font-size:13px;font-weight:650;color:var(--muted)}
[dir=rtl] .pill-toggle{padding:3px 4px 3px 12px}
.pill-toggle .knob{width:22px;height:22px;border-radius:50%;background:var(--line);transition:background .15s}
.pill-toggle.on{background:var(--soft);border-color:transparent;color:var(--accent)}
.pill-toggle.on .knob{background:var(--accent)}
.pill-toggle:hover{border-color:var(--accent)}
.row-more summary{list-style:none;cursor:pointer}
.row-more summary::-webkit-details-marker{display:none}
.row-more[open] summary{background:var(--surface)}
.more-panel{display:flex;flex-direction:column;gap:10px;margin-top:8px;padding:14px;min-width:260px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);text-align:start}
.more-panel .inline-form{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.danger-box{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px dashed color-mix(in srgb,var(--danger) 45%,var(--line));border-radius:var(--radius);background:color-mix(in srgb,var(--danger-soft) 45%,transparent)}
.danger-box .h4{color:var(--danger)}
.button.warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 45%,var(--line))}
#teams-table td{vertical-align:middle}
#teams-table .quota-form{display:grid;grid-template-columns:repeat(2,72px) auto;align-items:center}
#teams-table .quota-form .button{grid-column:auto}
#teams-table td.cell-actions{min-width:120px}
/* workers */
.worker-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
.worker-card{display:flex;flex-direction:column;gap:10px;padding:18px;background:var(--paper);border:1px solid var(--line);border-radius:12px;min-width:0}
.worker-head{display:flex;justify-content:space-between;align-items:center;gap:10px}
.worker-head h3{font-size:17px;overflow-wrap:anywhere}
.worker-card .copy-row{display:flex;align-items:center;gap:8px;min-width:0}
.worker-card .acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:auto;padding-top:6px}
.worker-card .flash{margin:0;padding:10px 14px;font-size:14px}
.deploy-panel>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px}
.deploy-panel>summary::-webkit-details-marker{display:none}
.deploy-panel>summary::before{content:"+";display:inline-grid;place-items:center;width:28px;height:28px;border-radius:8px;background:var(--accent);color:var(--on-accent);font-weight:700}
.deploy-panel[open]>summary::before{content:"−"}
.deploy-panel>summary h2{margin:0}
.deploy-panel textarea,.deploy-panel input[type=text]{width:100%}
.two-col.tight{gap:16px;align-items:start}
/* toasts, dialog, busy */
.toasts{position:fixed;bottom:20px;inset-inline-end:20px;z-index:60;display:flex;flex-direction:column;gap:10px;max-width:min(420px,calc(100vw - 40px))}
.toast{background:var(--ink);color:var(--bg);padding:12px 18px;border-radius:10px;box-shadow:var(--shadow);font-weight:600;font-size:14.5px;animation:toast-in .2s ease-out}
.toast.err{background:var(--danger);color:#fff}
.toast.out{opacity:0;transform:translateY(8px);transition:opacity .25s,transform .25s}
@keyframes toast-in{from{opacity:0;transform:translateY(8px)}}
.confirm-dialog{border:1px solid var(--line);border-radius:14px;padding:24px;max-width:min(460px,calc(100vw - 32px));background:var(--paper);color:var(--ink);box-shadow:0 30px 60px #0003}
.confirm-dialog::backdrop{background:#0b1a1566}
.confirm-dialog p{color:var(--ink);font-size:16px;font-weight:600;line-height:1.7}
.confirm-dialog .actions{justify-content:flex-end;margin-top:20px;gap:10px}
[aria-busy=true]{position:relative;color:transparent!important}
[aria-busy=true]::after{content:"";position:absolute;inset:0;margin:auto;width:16px;height:16px;border-radius:50%;border:2px solid var(--muted);border-top-color:transparent;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.dash-scrim{display:none}
@media (min-width:961px){.js .nav-toggle{display:none!important}}
@media (max-width:1100px){.dash-cols{grid-template-columns:1fr}}
@media (max-width:960px){
  .dash,[dir=rtl] .dash{grid-template-columns:1fr;background:none}
  .dash-side{position:static;height:auto;border-inline-end:0;border-bottom:1px solid var(--line);padding:12px}
  .side-nav ul{flex-direction:row;flex-wrap:wrap}
  .side-foot{flex-direction:row;flex-wrap:wrap;margin-top:0}
  .js .dash-side{position:fixed;top:0;bottom:0;inset-inline-start:0;z-index:50;width:min(300px,86vw);height:100vh;height:100dvh;border-inline-end:1px solid var(--line);border-bottom:0;padding:20px 14px;transform:translateX(-105%);transition:transform .22s ease;visibility:hidden}
  [dir=rtl].js .dash-side{transform:translateX(105%)}
  .js .dash-side .side-nav ul{flex-direction:column}
  .js .dash-side .side-foot{flex-direction:column;margin-top:auto}
  .nav-open .dash-side{transform:none!important;visibility:visible!important;box-shadow:0 0 40px #0004}
  .nav-open .dash-scrim:not([hidden]){display:block;position:fixed;inset:0;z-index:45;background:#0b1a1566}
  .dash-area{display:none}
  .dash-main{padding:16px 16px 56px}
  .stat-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .stat-card{padding:12px 14px}
  .stat-value{font-size:24px}
  .worker-grid{grid-template-columns:1fr}
  .facts.compact{grid-template-columns:1fr 1fr}
  .search-field{max-width:none}
  .more-panel{min-width:0}
  .filters{flex-direction:column;align-items:stretch}
  .filters input[type=search],.filters select{min-width:0;width:100%}
  .dash-main .page-heading.with-aside{align-items:flex-start}
}
@media (max-width:420px){.stat-grid{grid-template-columns:1fr 1fr}.stat-head{font-size:12.5px}}
/* 0.14.0: admin worker cell, bell, notifications, agent keys, versions, privacy */
.wk-cell{flex-direction:column;align-items:flex-start;flex-wrap:nowrap;gap:6px;white-space:nowrap}
.wk-count{min-width:28px;text-align:center}
.badge.warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 45%,var(--line))}
.bell{position:relative;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:999px;color:var(--ink);border:1px solid var(--line);background:var(--paper)}
.bell:hover{border-color:var(--accent)}
.bell .icon{width:20px;height:20px}
.bell-count{position:absolute;top:-5px;inset-inline-end:-6px;min-width:19px;height:19px;padding:0 5px;border-radius:999px;background:var(--danger);color:#fff;font-size:11px;font-weight:700;line-height:19px;text-align:center}
.alerts-grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr);gap:24px;align-items:start}
@media (max-width:900px){.alerts-grid{grid-template-columns:minmax(0,1fr)}}
.notice-list{list-style:none;margin:0;padding:0;display:grid;gap:2px}
.notice-item{display:flex;gap:12px;padding:12px 14px;border-radius:var(--radius);border:1px solid transparent}
.notice-item>div{min-width:0}
.notice-item p{margin:0 0 2px;overflow-wrap:anywhere}
.notice-item.unread{background:var(--paper);border-color:var(--line)}
.notice-item.unread p{font-weight:650}
.notice-dot{flex:none;width:10px;height:10px;border-radius:50%;margin-top:7px;background:var(--accent)}
.tone-warn .notice-dot{background:#d39a1e}
.tone-ok .notice-dot{background:#2f9d62}
.stack-form{display:grid;gap:8px;margin-top:12px}
.key-form h2{display:flex;align-items:center;gap:8px}
.scope-set,.expiry-set{border:1px solid var(--line);border-radius:var(--radius);padding:10px 14px 14px;margin:14px 0 0}
.scope-set legend,.expiry-set legend{font-weight:650;padding:0 6px}
.scope-set label.check{align-items:flex-start;margin-top:8px;font-weight:500}
.scope-set label.check input{margin-top:3px}
.expiry-set label.check.inline{display:inline-flex;margin-inline-end:16px}
.days-input{max-width:120px;margin-top:8px}
code.scope{font-size:12px;padding:1px 6px;border-radius:6px;background:var(--surface);border:1px solid var(--line)}
.plain-list{list-style:none;padding:0;margin:0;display:grid;gap:8px}
.plain-list li{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.versions-table tr.current-row td{background:color-mix(in srgb,var(--soft) 45%,transparent)}
.versions-table td.row-acts .acts{flex-wrap:nowrap}
.policy .policy-section{margin-top:28px}
.policy .policy-section h2{display:flex;align-items:center;gap:8px;font-size:1.25rem}
.policy .policy-section ul{padding-inline-start:20px;display:grid;gap:8px}
mark.placeholder{background:#fff2b8;color:#4a3700;padding:0 4px;border-radius:4px}
.recipe-card .recipe-meta{display:flex;gap:8px;align-items:center;margin-bottom:6px}
.recipe-tags{display:flex;flex-wrap:wrap;gap:4px;margin:8px 0 0}
.recipe-tags code{font-size:.78em}
.recipe-api{margin-top:16px;overflow-wrap:anywhere}
.recipe-form .two-col{gap:20px}
.recipe-form textarea,.code-area{width:100%;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.88em;line-height:1.55;min-height:220px}
.prose.recipe .lead{font-size:1.08em;color:var(--muted,inherit)}
.prose.recipe pre{direction:ltr;text-align:left;overflow-x:auto}
.uk-usage{white-space:nowrap}
.inline-field{display:inline-flex;align-items:center;gap:8px;margin-inline-end:16px}
.uk-settings .check{margin:8px 0}

/* ---- 0.15.0: data tables, row links, menus, tabs, detail pages ---- */
table.dt tbody tr[data-href]{cursor:pointer}
table.dt tbody tr[data-href]:hover>*{background:var(--surface)}
table.dt tbody tr:focus-within>*{background:var(--surface)}
table.dt a.row-link{font-weight:650;color:var(--ink)}
table.dt a.row-link:hover,table.dt a.row-link:focus-visible{text-decoration:underline;text-underline-offset:4px}
table.dt th[scope=row] .meta{font-weight:500}
table.dt td,table.dt th{white-space:normal}
table.dt td.num{font-variant-numeric:tabular-nums}
.col-actions{width:1%}
.row-acts{display:flex;gap:4px;align-items:center;justify-content:flex-end;flex-wrap:nowrap}
.row-acts .menu-form{display:inline-flex;margin:0}
.icon-btn.danger{color:var(--danger,#b42318)}
details.kebab{position:relative;display:inline-block}
details.kebab>summary{list-style:none;cursor:pointer}
details.kebab>summary::-webkit-details-marker{display:none}
.kebab-menu{z-index:60;min-width:200px;background:var(--paper);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.14);padding:6px;display:grid;gap:2px}
html:not(.js) .kebab-menu{position:static;margin-top:6px}
.kebab-menu .menu-form{display:block;margin:0}
.menu-item{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;border:0;background:none;border-radius:8px;font:inherit;font-size:14px;color:var(--ink);text-align:start;cursor:pointer;text-decoration:none}
.menu-item:hover,.menu-item:focus-visible{background:var(--surface);outline:none}
.menu-item.danger{color:var(--danger,#b42318)}
.menu-item .icon{width:18px;height:18px;flex-shrink:0}
.dt-tools{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 12px}
.dt-tools .search-field{flex:1 1 220px;min-width:0}
.dt-tools .search-field input{width:100%}
.dt-filter{display:inline-flex;align-items:center;gap:6px}
.dt-filter .icon{width:16px;height:16px;color:var(--muted)}
.dt-filter select{max-width:220px}
.dt-count{margin-inline-start:auto}
.dt-pager{display:flex;gap:12px;align-items:center;justify-content:center;margin-top:12px}
.dt-none{padding:16px;text-align:center}
.empty-state.small{padding:20px;text-align:center;border:1px dashed var(--line);border-radius:var(--radius)}
.tabs{border-bottom:1px solid var(--line);margin:8px 0 20px;overflow-x:auto;scrollbar-width:thin}
.tabs ul{display:flex;gap:4px;list-style:none;margin:0;padding:0;min-width:max-content}
.tabs a{display:inline-flex;align-items:center;gap:6px;padding:10px 14px;color:var(--muted);text-decoration:none;font-weight:600;border-bottom:2px solid transparent;margin-bottom:-1px}
.tabs a:hover{color:var(--ink)}
.tabs a[aria-current=page]{color:var(--accent);border-bottom-color:var(--accent)}
.tab-count{font-size:12px;background:var(--surface);border-radius:999px;padding:1px 8px;color:var(--muted)}
.detail-head{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;margin-bottom:8px}
.detail-head h1{margin:0;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.detail-head .eyebrow{margin:0 0 4px}
.detail-links{display:flex;flex-direction:column;gap:6px;margin-top:8px;min-width:0}
.detail-links .copy-row{margin:0;min-width:0}
.detail-links code{overflow-wrap:anywhere}
.detail-actions{display:flex;gap:8px;flex-wrap:wrap}
.facts-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin:0}
.facts-grid>div{background:var(--surface);border-radius:12px;padding:12px 14px;min-width:0}
.facts-grid dt{font-size:13px;color:var(--muted);font-weight:600;margin-bottom:4px}
.facts-grid dd{margin:0;overflow-wrap:anywhere}
.stat-value.small{font-size:22px}
.detail-head.slim{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin:0 0 14px}
.flash.warn{border:1px solid color-mix(in srgb,var(--warn) 45%,var(--line));background:color-mix(in srgb,var(--warn) 8%,var(--paper));color:var(--ink);padding:10px 14px;border-radius:10px}
.missing-env{margin:6px 0 0;padding-inline-start:18px}
.range-chips{display:flex;gap:6px;margin:0 0 12px}
.range-chips .chip{display:inline-block;padding:4px 12px;border:1px solid var(--line);border-radius:999px;color:var(--ink);font-size:14px}
.range-chips .chip.active{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}
.chart{margin:0 0 16px;background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:10px}
.chart svg{width:100%;height:180px;display:block;direction:ltr}
.chart .axis{stroke:var(--line);stroke-width:1}
.chart .tick{fill:var(--muted);font-size:11px;font-family:var(--mono)}
.chart .bar-req{fill:color-mix(in srgb,var(--accent) 55%,transparent)}
.chart .bar-err{fill:var(--danger)}
.chart .cpu-line{stroke:var(--warn);stroke-width:1.5}
.chart .lat-line{stroke:var(--accent);stroke-width:1.5}
.chart .fail-tick{stroke:var(--danger);stroke-width:2;opacity:.8}
.chart-legend{display:flex;flex-wrap:wrap;align-items:center;gap:6px;color:var(--muted);font-size:13px;margin-top:6px}
.chart-legend .lg{display:inline-block;width:10px;height:10px;border-radius:2px;margin-inline-start:8px}
.chart-legend .lg.req{background:color-mix(in srgb,var(--accent) 55%,transparent)}
.chart-legend .lg.err{background:var(--danger)}
.chart-legend .lg.cpu{background:var(--warn)}
.spark{vertical-align:middle;color:var(--accent);direction:ltr}
.log-msg{display:inline-block;max-width:520px;white-space:pre-wrap;word-break:break-word;font-family:var(--mono);font-size:12.5px}
.light{display:inline-block;flex:none;width:14px;height:14px;border-radius:50%;margin-top:4px;background:var(--muted);box-shadow:0 0 0 3px color-mix(in srgb,var(--muted) 20%,transparent)}
.light.on{background:#16a34a;box-shadow:0 0 0 3px rgba(22,163,74,.2)}
.light.err{background:var(--danger);box-shadow:0 0 0 3px color-mix(in srgb,var(--danger) 25%,transparent)}
.light.off{background:#9ca3af;box-shadow:0 0 0 3px rgba(156,163,175,.25)}
.perms-wrap{margin-top:22px}
.perm-list{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:8px}
.perm-row{display:flex;gap:12px;align-items:flex-start;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--paper)}
.perm-row p{margin:0}
.perm-note{font-family:var(--mono);font-size:12px;word-break:break-word}
.perm-progress .perm-bar{width:100%}
.perm-progress p{margin:6px 0 0}
.chips{display:flex;flex-wrap:wrap;gap:6px;list-style:none;padding:0;margin:0}
.chips li code{background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:2px 10px;font-size:13px}
.danger-zone{border:1px solid var(--danger,#b42318);border-radius:var(--radius);padding:16px 18px;margin-top:24px}
.danger-zone h2{color:var(--danger,#b42318)}
.danger-zone .row{display:flex;gap:12px;justify-content:space-between;align-items:center;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--line)}
.danger-zone .row:first-of-type{border-top:0}
.danger-row{display:flex;gap:12px;justify-content:space-between;align-items:center;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--line)}
.danger-row:first-of-type,.danger-zone h2+.danger-row{border-top:0}
.danger-row>div{min-width:0;flex:1 1 260px}
.danger-row form{margin:0;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.detail-title{min-width:0}
.detail-title h1{display:flex;flex-wrap:wrap;gap:8px;align-items:center;overflow-wrap:anywhere;margin:0 0 6px}
.copy-line{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:4px 0;min-width:0}
.copy-line code,.copy-line a{overflow-wrap:anywhere;min-width:0}
.detail-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));gap:16px;align-items:start}
.detail-cols>*{min-width:0}
.site-over{display:grid;grid-template-columns:minmax(0,260px) minmax(0,1fr);gap:20px;align-items:start}
.site-over>*{min-width:0}
.preview-link{display:block;line-height:0}
.preview-link:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:12px}
.secret-list{list-style:none;margin:0 0 12px;padding:0;display:grid;gap:6px}
.secret-list li{display:flex;gap:8px;justify-content:space-between;align-items:center;flex-wrap:wrap;background:var(--surface);border-radius:10px;padding:6px 10px}
.secret-list form{margin:0}
.code-input{width:100%;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.tab-panel{min-width:0}
.preview-thumb{width:240px;max-width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:12px;border:1px solid var(--line);background:var(--surface)}
.health{display:inline-flex;gap:8px;align-items:center}
.settings-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:16px;align-items:start}
.settings-grid>.panel{margin:0}
@media (max-width:760px){
  table.data.stack.dt td.cell-actions{display:flex;justify-content:flex-end;background:var(--surface)}
  table.data.stack.dt tbody th{display:flex;flex-direction:column;gap:2px}
  .detail-head{flex-direction:column}
  .site-over{grid-template-columns:1fr}
  .dt-count{margin-inline-start:0}
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

// ---- dashboard shell (0.13.0): drawer, dialog confirmations, toasts, busy buttons,
// table filter/sort, relative times. Everything degrades to plain links and forms.
const toastBox = $("toasts");
function toast(msg, err) {
  if (!toastBox || !msg) return;
  const el = document.createElement("div");
  el.className = "toast" + (err ? " err" : "");
  el.textContent = msg;
  toastBox.appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 300); }, 3600);
}
const navBtn = document.querySelector("[data-nav-toggle]");
const side = $("dash-nav");
const scrim = document.querySelector("[data-nav-close]");
if (navBtn && side) {
  const setNav = (open) => {
    document.body.classList.toggle("nav-open", open);
    navBtn.setAttribute("aria-expanded", String(open));
    if (scrim) scrim.hidden = !open;
    if (open) { const a = side.querySelector("[aria-current=page]") || side.querySelector("a"); if (a) setTimeout(() => a.focus(), 50); }
  };
  navBtn.addEventListener("click", () => setNav(!document.body.classList.contains("nav-open")));
  if (scrim) scrim.addEventListener("click", () => { setNav(false); navBtn.focus(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.body.classList.contains("nav-open")) { setNav(false); navBtn.focus(); } });
}
const dlg = $("confirm-dialog");
for (const form of document.querySelectorAll("form[data-confirm]")) {
  form.addEventListener("submit", (e) => {
    if (form.dataset.confirmed === "1") { form.dataset.confirmed = ""; return; }
    if (!dlg || typeof dlg.showModal !== "function") { if (!confirm(form.dataset.confirm)) e.preventDefault(); return; }
    e.preventDefault();
    const sub = e.submitter;
    $("confirm-text").textContent = form.dataset.confirm;
    dlg.returnValue = "";
    dlg.onclose = () => {
      if (dlg.returnValue !== "ok") return;
      form.dataset.confirmed = "1";
      if (form.requestSubmit) form.requestSubmit(sub && sub.form === form ? sub : undefined); else form.submit();
    };
    dlg.showModal();
    const cancel = dlg.querySelector("[value=cancel]");
    if (cancel) cancel.focus();
  });
}
document.addEventListener("submit", (e) => {
  const f = e.target;
  if (e.defaultPrevented || !(f instanceof HTMLFormElement) || f.method !== "post" || f.hasAttribute("data-upload")) return;
  const b = e.submitter || f.querySelector("[type=submit]");
  if (b) setTimeout(() => { b.setAttribute("aria-busy", "true"); b.disabled = true; }, 0);
});
window.addEventListener("pageshow", () => { for (const b of document.querySelectorAll("[aria-busy=true]")) { b.removeAttribute("aria-busy"); b.disabled = false; } });
for (const tools of document.querySelectorAll("[data-table-tools]")) {
  const table = $(tools.dataset.tableTools);
  const input = tools.querySelector("[data-filter]");
  if (!table || !input || !table.tBodies[0]) continue;
  const count = tools.querySelector("[data-count]");
  const none = tools.nextElementSibling && tools.nextElementSibling.matches("[data-no-match]") ? tools.nextElementSibling : null;
  const rows = [...table.tBodies[0].rows];
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    let n = 0;
    for (const r of rows) { const hit = !q || r.textContent.toLowerCase().includes(q); r.hidden = !hit; if (hit) n++; }
    if (count) count.textContent = q ? n + " / " + rows.length : "";
    if (none) none.hidden = n > 0;
  });
}
for (const th of document.querySelectorAll("th[data-sort]")) {
  const table = th.closest("table");
  const idx = [...th.parentNode.children].indexOf(th);
  const kind = th.dataset.sort;
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "sort-btn"; btn.textContent = th.textContent; th.textContent = ""; th.appendChild(btn);
  btn.addEventListener("click", () => {
    const dir = th.getAttribute("aria-sort") === "ascending" ? "descending" : "ascending";
    for (const o of table.querySelectorAll("th[aria-sort]")) o.removeAttribute("aria-sort");
    th.setAttribute("aria-sort", dir);
    const body = table.tBodies[0];
    const val = (r) => { const c = r.children[idx]; const v = c ? (c.dataset.v !== undefined ? c.dataset.v : c.textContent.trim().toLowerCase()) : ""; return kind === "num" ? Number(v) || 0 : v; };
    const sorted = [...body.rows].sort((a, b) => { const x = val(a), y = val(b); const r = kind === "num" ? x - y : String(x).localeCompare(String(y), lang); return dir === "ascending" ? r : -r; });
    for (const r of sorted) body.appendChild(r);
    table.dispatchEvent(new Event("dt:update"));
  });
}
if (document.body.classList.contains("dash-body") && Intl.RelativeTimeFormat) {
  const rtf = new Intl.RelativeTimeFormat(lang === "ar" ? "ar-EG" : "en", { numeric: "auto" });
  const units = [["year", 31536e6], ["month", 2592e6], ["week", 6048e5], ["day", 864e5], ["hour", 36e5], ["minute", 6e4]];
  for (const el of document.querySelectorAll(".dash-main time[datetime]")) {
    const d = new Date(el.getAttribute("datetime"));
    if (isNaN(d)) continue;
    const diff = d.getTime() - Date.now();
    const abs = Math.abs(diff);
    el.title = d.toLocaleString(lang === "ar" ? "ar-EG" : undefined, { dateStyle: "full", timeStyle: "short" });
    if (abs < 6e4) { el.textContent = lang === "ar" ? "الآن" : "just now"; continue; }
    const u = units.find(([, ms]) => abs >= ms) || units[units.length - 1];
    el.textContent = rtf.format(Math.round(diff / u[1]), u[0]);
  }
}

// ---- confirmations, copy buttons, focus the flash message -----------------------
for (const b of document.querySelectorAll("[data-copy]")) {
  b.addEventListener("click", async () => {
    const el = document.querySelector(b.dataset.copy);
    if (!el) return;
    const text = el.href || el.textContent;
    try {
      await navigator.clipboard.writeText(text);
      if (b.classList.contains("icon-btn")) { b.classList.add("done"); setTimeout(() => b.classList.remove("done"), 1600); }
      else { const old = b.innerHTML; b.textContent = b.dataset.copied || "✓"; setTimeout(() => { b.innerHTML = old; }, 1600); }
      toast(b.dataset.copied || "✓");
    } catch {}
  });
}

// ---- data tables (0.15.0): clickable rows, search + filters + pages, "more" menus ------
for (const b of document.querySelectorAll("[data-copy-text]")) {
  b.addEventListener("click", async (e) => {
    e.preventDefault();
    try { await navigator.clipboard.writeText(b.dataset.copyText); toast(b.dataset.copied || "✓"); } catch {}
    const d = b.closest("details"); if (d) d.open = false;
  });
}
document.addEventListener("click", (e) => {
  const tr = e.target.closest && e.target.closest("tr[data-href]");
  if (!tr || e.defaultPrevented) return;
  if (e.target.closest("a,button,summary,details,form,input,select,textarea,label")) return;
  if (window.getSelection && String(window.getSelection()).length) return;
  if (e.ctrlKey || e.metaKey || e.button === 1) window.open(tr.dataset.href, "_blank", "noopener");
  else location.href = tr.dataset.href;
});
document.addEventListener("auxclick", (e) => {
  const tr = e.target.closest && e.target.closest("tr[data-href]");
  if (tr && e.button === 1 && !e.target.closest("a,button")) window.open(tr.dataset.href, "_blank", "noopener");
});
for (const table of document.querySelectorAll("table[data-dt]")) {
  const id = table.id;
  const tools = document.querySelector('[data-dt-tools="' + id + '"]');
  const pager = document.querySelector('[data-dt-pager="' + id + '"]');
  const none = document.querySelector('[data-dt-none="' + id + '"]');
  const size = Number(table.dataset.pageSize) || 25;
  const q = tools && tools.querySelector("[data-dt-q]");
  const sels = tools ? [...tools.querySelectorAll("[data-dt-f]")] : [];
  const count = tools && tools.querySelector("[data-dt-count]");
  let page = 0;
  const apply = () => {
    const rows = [...table.tBodies[0].rows];
    const text = q ? q.value.trim().toLowerCase() : "";
    const hits = rows.filter((r) => (!text || r.textContent.toLowerCase().includes(text)) && sels.every((s) => !s.value || r.getAttribute("data-f-" + s.dataset.dtF) === s.value));
    const pages = Math.max(1, Math.ceil(hits.length / size));
    if (page >= pages) page = pages - 1;
    const set = new Set(hits.slice(page * size, page * size + size));
    for (const r of rows) r.hidden = !set.has(r);
    if (count) count.textContent = hits.length === rows.length ? count.dataset.all || count.textContent : hits.length + " / " + rows.length;
    if (none) none.hidden = hits.length > 0;
    if (pager) {
      pager.hidden = pages < 2;
      const label = (table.dataset.lPage || "# / #").replace("#", String(page + 1)).replace("#", String(pages));
      pager.querySelector("[data-dt-page]").textContent = label;
      pager.querySelector("[data-dt-prev]").disabled = page === 0;
      pager.querySelector("[data-dt-next]").disabled = page >= pages - 1;
    }
  };
  if (count) count.dataset.all = count.textContent;
  if (q) q.addEventListener("input", () => { page = 0; apply(); });
  for (const s of sels) s.addEventListener("change", () => { page = 0; apply(); });
  if (pager) {
    pager.querySelector("[data-dt-prev]").addEventListener("click", () => { page--; apply(); table.scrollIntoView({ block: "nearest" }); });
    pager.querySelector("[data-dt-next]").addEventListener("click", () => { page++; apply(); table.scrollIntoView({ block: "nearest" }); });
  }
  table.addEventListener("dt:update", apply);
  apply();
}
const kebabs = [...document.querySelectorAll("details.kebab")];
const placeMenu = (d) => {
  const m = d.querySelector(".kebab-menu");
  const r = d.querySelector("summary").getBoundingClientRect();
  m.style.position = "fixed";
  m.style.top = Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8) + "px";
  const rtl = document.documentElement.dir === "rtl";
  m.style.left = (rtl ? Math.max(8, r.left) : Math.max(8, r.right - m.offsetWidth)) + "px";
};
for (const d of kebabs) {
  d.addEventListener("toggle", () => {
    if (!d.open) return;
    for (const o of kebabs) if (o !== d) o.open = false;
    placeMenu(d);
    const first = d.querySelector("[role=menuitem]"); if (first) first.focus();
  });
  d.addEventListener("keydown", (e) => {
    const items = [...d.querySelectorAll("[role=menuitem]")];
    const i = items.indexOf(document.activeElement);
    if (e.key === "Escape") { d.open = false; d.querySelector("summary").focus(); }
    else if (e.key === "ArrowDown" && items.length) { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === "ArrowUp" && items.length) { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  });
}
document.addEventListener("click", (e) => { for (const d of kebabs) if (d.open && !d.contains(e.target)) d.open = false; });
addEventListener("scroll", () => { for (const d of kebabs) if (d.open) d.open = false; }, { passive: true });
document.documentElement.classList.add("js");
const flash = document.getElementById("flash");
// In the dashboards a plain success message becomes a toast; errors, links and
// one-time keys stay on the page (and keep the focus) so nothing is missed.
if (flash && toastBox && flash.classList.contains("ok") && !flash.querySelector(".copy-row,.secret")) {
  toast(flash.textContent.trim());
  flash.hidden = true;
} else if (flash) flash.focus();
for (const d of document.querySelectorAll("details.mobile-menu")) {
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && d.open) { d.open = false; d.querySelector("summary").focus(); } });
}
`;

/** Content hash of the CSS + JS, appended to their URLs so a deploy is never served stale CSS from a CDN cache. */
export const ASSET_VERSION = createHash("sha256")
  .update(APP_CSS)
  .update(APP_JS)
  .digest("hex")
  .slice(0, 10);
