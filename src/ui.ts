import { ASSET_VERSION } from "./assets.js";
import { PLATFORM_URL } from "./brand.js";
import type { Config } from "./config.js";
import { hashIndex, initialOf } from "./cover.js";
import type { DocPage } from "./docs.js";
import { bytesLabel, hoursLabel, type Lang, type LimitValues, STRINGS } from "./i18n.js";
import type { MemberRole } from "./members.js";
import { currentNavAccount } from "./nav-state.js";
import { isPermanentIso } from "./store.js";
import type { VisitSummary } from "./visits.js";

export const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** `/docs` <-> `/ar/docs`, `/` <-> `/ar`. */
export function localePath(lang: Lang, path: string): string {
  const bare = path.replace(/^\/ar(?=\/|$)/, "") || "/";
  if (lang === "en") return bare;
  return bare === "/" ? "/ar" : `/ar${bare}`;
}

const MB = 1024 * 1024;

export function limitValues(lang: Lang, c: Config): LimitValues {
  return {
    maxFileMb: Math.round(c.maxFileBytes / MB),
    maxSiteMb: Math.round(c.maxSiteBytes / MB),
    maxFiles: c.maxFiles,
    defaultTtl: hoursLabel(lang, c.defaultTtlHours),
    maxTtl: hoursLabel(lang, c.maxTtlHours),
    uploadsPerHour: c.uploadsPerHour,
  };
}

/** The public directory: live sites of teams that are listed, grouped by team. */
export interface Directory {
  generatedAt: string;
  /** Site ids to spotlight on the home page (FEATURED_SITES, else the newest page). */
  featured?: string[];
  teams: {
    id: string;
    name: string;
    sites: {
      id: string;
      title: string;
      url: string;
      createdAt: string;
      expiresAt: string;
      /** Same-origin URL of the site's cover image, or null (a placeholder is drawn). */
      cover?: string | null;
    }[];
  }[];
}

/** A one-shot message shown at the top of a dashboard page. */
export interface Flash {
  kind: "ok" | "err";
  text: string;
  /** A secret shown once (a new team key). */
  secret?: { label: string; note: string; value: string };
  /** A link to show (e.g. the site just published). */
  link?: string;
}

/** A server-rendered UTC time; the page script swaps in the visitor's local time. */
function timeTag(lang: Lang, iso: string): string {
  if (isPermanentIso(iso)) {
    return `<span class="badge on perm">${esc(STRINGS[lang].team.permanent)}</span>`;
  }
  const d = new Date(iso);
  const text = new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(d);
  return `<time datetime="${esc(d.toISOString())}" data-local>${esc(text)} UTC</time>`;
}

const ltr = (s: string) => `<span dir="ltr" class="ltr">${esc(s)}</span>`;
const hostless = (url: string) => url.replace(/^https?:\/\//, "");

/** "Expires <time>", or just "Permanent". */
function expiryLine(lang: Lang, iso: string): string {
  return isPermanentIso(iso)
    ? timeTag(lang, iso)
    : `${esc(STRINGS[lang].directory.expires)} ${timeTag(lang, iso)}`;
}

function ttlOptions(
  lang: Lang,
  c: Config,
  selected = c.defaultTtlHours,
  permanent = false,
): string {
  const set = new Set([1, 6, 24, 72, 168, c.defaultTtlHours, c.maxTtlHours]);
  const perm = permanent
    ? `<option value="permanent">${esc(STRINGS[lang].team.permanentOption)}</option>`
    : "";
  return (
    perm +
    [...set]
      .filter((h) => h >= c.minTtlHours && h <= c.maxTtlHours)
      .sort((a, b) => a - b)
      .map(
        (h) =>
          `<option value="${h}"${h === selected ? " selected" : ""}>${esc(hoursLabel(lang, h))}</option>`,
      )
      .join("")
  );
}

// ---- layout -----------------------------------------------------------------

interface LayoutOpts {
  lang: Lang;
  title: string;
  description: string;
  path: string;
  body: string;
  config: Config;
  active?: "home" | "publish" | "docs" | "team";
  noindex?: boolean;
  /** Paths are language-specific (true) or the alternate language doesn't exist (false). */
  alternate?: boolean;
}

function brandMark(lang: Lang): string {
  const t = STRINGS[lang];
  return `<span class="brand-mark" aria-hidden="true">م</span><span class="brand-name">${esc(t.product)}</span>`;
}

function layout(o: LayoutOpts): string {
  const t = STRINGS[o.lang];
  const other: Lang = o.lang === "en" ? "ar" : "en";
  const href = (p: string) => localePath(o.lang, p);
  const canonical = `${o.config.publicUrl}${localePath(o.lang, o.path)}`;
  const cur = (k: LayoutOpts["active"]) => (o.active === k ? ' aria-current="page"' : "");
  const links = `<a href="${href("/")}"${cur("home")}>${esc(t.nav.home)}</a>
      <a href="${href("/new")}"${cur("publish")}>${esc(t.nav.publish)}</a>
      <a href="${href("/docs")}"${cur("docs")}>${esc(t.nav.docs)}</a>`;
  const platform = o.lang === "ar" ? PLATFORM_URL : `${PLATFORM_URL}/en/`;
  const account = currentNavAccount();
  const accountHref = href(
    account === "admin" ? "/admin" : account === "team" ? "/team" : "/login",
  );
  const accountLabel =
    account === "admin" ? t.nav.adminConsole : account === "team" ? t.nav.dashboard : t.nav.signIn;
  return `<!doctype html>
<html lang="${o.lang}" dir="${t.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#145a49">${o.noindex ? '\n<meta name="robots" content="noindex, nofollow">' : ""}
<meta property="og:site_name" content="${esc(t.product)}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="${o.lang === "ar" ? "ar_EG" : "en_US"}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="alternate" hreflang="en" href="${esc(o.config.publicUrl + localePath("en", o.path))}">
<link rel="alternate" hreflang="ar" href="${esc(o.config.publicUrl + localePath("ar", o.path))}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/assets/fonts/zad/Zad-Regular.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/app.css?v=${ASSET_VERSION}">
</head>
<body>
<a class="skip" href="#main">${esc(t.skip)}</a>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="wordmark" href="${href("/")}" aria-label="${esc(`${t.product}: ${t.nav.home}`)}">${brandMark(o.lang)}</a>
    <nav class="desktop-nav" aria-label="${esc(t.nav.label)}">
      ${links}
    </nav>
    <div class="header-tools">
      <a class="locale-link" href="${localePath(other, o.path)}" hreflang="${other}" lang="${other}">${esc(t.switchLabel)}</a>
      <a class="button small" href="${accountHref}"${cur("team")}>${esc(accountLabel)}</a>
      <details class="mobile-menu">
        <summary><span class="sr-only">${esc(t.nav.label)}</span><span aria-hidden="true" class="burger"></span></summary>
        <nav aria-label="${esc(t.nav.label)}">
          ${links}
          <a href="${accountHref}">${esc(accountLabel)}</a>
        </nav>
      </details>
    </div>
  </div>
</header>
<main id="main" tabindex="-1">
${o.body}
</main>
<footer class="site-footer">
  <div class="wrap footer-grid">
    <div>
      <a class="wordmark small" href="${href("/")}">${brandMark(o.lang)}</a>
      <p>${esc(t.footer.about)}</p>
    </div>
    <div>
      <h2>${esc(t.footer.product)}</h2>
      <a href="${href("/new")}">${esc(t.nav.publish)}</a>
      <a href="${accountHref}">${esc(accountLabel)}</a>
      <a href="${href("/docs")}">${esc(t.nav.docs)}</a>
    </div>
    <div>
      <h2>${esc(t.footer.resources)}</h2>
      <a href="/docs/api" lang="en">API</a>
      <a href="/openapi.json" lang="en">OpenAPI</a>
      <a href="/llms.txt" lang="en">llms.txt</a>
      <a href="/docs/self-hosting" lang="en">Self-host</a>
    </div>
    <div>
      <h2>${esc(t.footer.platform)}</h2>
      <a href="${platform}">marsaplatform.com</a>
    </div>
  </div>
  <div class="wrap footer-bottom"><p>${esc(t.footer.note)}</p></div>
</footer>
<script src="/assets/app.js?v=${ASSET_VERSION}" type="module"></script>
</body>
</html>`;
}

// ---- shared pieces ---------------------------------------------------------------

function flashBox(lang: Lang, f?: Flash | null): string {
  if (!f) return "";
  const t = STRINGS[lang];
  const secret = f.secret
    ? `<div class="secret"><h2 class="h3">${esc(f.secret.label)}</h2><p>${esc(f.secret.note)}</p><div class="copy-row"><code id="secretValue" class="token" dir="ltr">${esc(f.secret.value)}</code><button type="button" class="button small ghost" data-copy="#secretValue" data-copied="${esc(t.common.copied)}">${esc(t.common.copy)}</button></div></div>`
    : "";
  const link = f.link
    ? `<div class="copy-row"><a id="flashLink" class="strong-link" href="${esc(f.link)}" target="_blank" rel="noopener" dir="ltr">${esc(hostless(f.link))}</a><button type="button" class="button small ghost" data-copy="#flashLink" data-copied="${esc(t.common.copied)}">${esc(t.common.copy)}</button></div>`
    : "";
  return `<div class="flash ${f.kind}" role="${f.kind === "err" ? "alert" : "status"}" tabindex="-1" id="flash"><p>${esc(f.text)}</p>${link}${secret}</div>`;
}

const csrfField = (token: string) => `<input type="hidden" name="_csrf" value="${esc(token)}">`;

function postForm(
  action: string,
  csrf: string,
  inner: string,
  opts: { confirm?: string; cls?: string } = {},
): string {
  return `<form method="post" action="${esc(action)}" class="${opts.cls ?? "inline-form"}"${opts.confirm ? ` data-confirm="${esc(opts.confirm)}"` : ""}>${csrfField(csrf)}${inner}</form>`;
}

function pageHead(eyebrow: string, title: string, sub: string, aside = ""): string {
  return `<div class="page-heading${aside ? " with-aside" : ""}"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${title}</h1>${sub ? `<p>${esc(sub)}</p>` : ""}</div>${aside}</div>`;
}

const td = (label: string, inner: string, cls = "") =>
  `<td data-label="${esc(label)}"${cls ? ` class="${cls}"` : ""}>${inner}</td>`;

function emptyState(title: string, sub: string, action = ""): string {
  return `<div class="empty-state"><svg viewBox="0 0 64 64" aria-hidden="true" focusable="false"><rect x="10" y="14" width="44" height="36" rx="6" class="stroke"/><path d="M10 24h44M20 34h16M20 41h24" class="stroke"/></svg><h2 class="h3">${esc(title)}</h2><p>${esc(sub)}</p>${action}</div>`;
}

// ---- landing -------------------------------------------------------------------

type DirSite = Directory["teams"][number]["sites"][number];

/** Placeholder palettes (see .ph-0 … .ph-5 in app.css). */
const PALETTES = 6;
const paletteOf = (key: string) => hashIndex(key, PALETTES);

/** A drawn stand-in for a site with no cover image: its first letter on a page sketch. */
function placeholderArt(title: string, key: string): string {
  return `<svg class="thumb-art ph-${paletteOf(key)}" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
<rect class="ph-bg" width="320" height="180"/>
<circle class="ph-orb" cx="292" cy="-6" r="92"/>
<rect class="ph-win" x="26" y="28" width="178" height="124" rx="9"/>
<path class="ph-bar" d="M35 28h160a9 9 0 0 1 9 9v13H26V37a9 9 0 0 1 9-9z"/>
<circle class="ph-dot" cx="40" cy="39" r="3.4"/><circle class="ph-dot" cx="51" cy="39" r="3.4"/><circle class="ph-dot" cx="62" cy="39" r="3.4"/>
<rect class="ph-line strong" x="42" y="66" width="92" height="9" rx="4.5"/>
<rect class="ph-line" x="42" y="86" width="142" height="6" rx="3"/>
<rect class="ph-line" x="42" y="99" width="124" height="6" rx="3"/>
<rect class="ph-line" x="42" y="112" width="134" height="6" rx="3"/>
<rect class="ph-pill" x="42" y="128" width="46" height="12" rx="4"/>
<path class="ph-wave" d="M0 166c20 0 20-8 40-8s20 8 40 8 20-8 40-8 20 8 40 8 20-8 40-8 20 8 40 8 20-8 40-8 20 8 40 8"/>
<text class="ph-glyph" x="258" y="112" text-anchor="middle">${esc(initialOf(title))}</text>
</svg>`;
}

/** Light palettes for the standalone placeholder (same values as .ph-0 … .ph-5 in app.css). */
const PH_COLORS: ReadonlyArray<{ pb: string; pw: string; pl: string; pa: string }> = [
  { pb: "#dceccf", pw: "#fbfcfa", pl: "#c3d6bf", pa: "#145a49" },
  { pb: "#d7ebe7", pw: "#fbfdfc", pl: "#b9d5cf", pa: "#0f5c5a" },
  { pb: "#efe6d2", pw: "#fffdf8", pl: "#dccfb3", pa: "#7a5413" },
  { pb: "#e3e8d1", pw: "#fcfdf8", pl: "#cdd5b4", pa: "#4f5d1c" },
  { pb: "#dfe5ef", pw: "#fbfcfe", pl: "#c5cfdf", pa: "#284a7a" },
  { pb: "#eedfdc", pw: "#fffbfa", pl: "#dcc6c1", pa: "#8a3a2b" },
];

/**
 * The drawn placeholder as a self-contained SVG file (no CSS, no fonts, no external refs),
 * served by /covers/<id> when a listed site has no usable cover image.
 */
export function placeholderSvg(title: string, key: string): string {
  const p = PH_COLORS[paletteOf(key)] ?? {
    pb: "#dceccf",
    pw: "#fbfcfa",
    pl: "#c3d6bf",
    pa: "#145a49",
  };
  const style = `.ph-bg{fill:${p.pb}}.ph-orb{fill:${p.pa};opacity:.14}.ph-win{fill:${p.pw}}.ph-bar{fill:${p.pl};opacity:.55}.ph-dot{fill:${p.pa};opacity:.45}.ph-line{fill:${p.pl}}.ph-line.strong{fill:${p.pa};opacity:.55}.ph-pill{fill:${p.pa};opacity:.85}.ph-wave{fill:none;stroke:${p.pa};stroke-width:2.4;stroke-linecap:round;opacity:.4}.ph-glyph{fill:${p.pa};font:800 76px/1 system-ui,-apple-system,"Segoe UI",Tahoma,Arial,sans-serif}`;
  return placeholderArt(title, key)
    .replace(
      /^<svg class="thumb-art ph-\d" /,
      `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" role="img" `,
    )
    .replace(
      ' aria-hidden="true" focusable="false">',
      `><title>${esc(title)}</title><style>${style}</style>`,
    );
}

/** The 16:9 preview of a site: its cover image, or the drawn placeholder. */
function thumb(lang: Lang, x: DirSite, teamId: string, eager = false): string {
  const inner = x.cover
    ? `<img src="${esc(x.cover)}" alt="${esc(STRINGS[lang].landing.preview(x.title))}" width="640" height="360" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`
    : placeholderArt(x.title, teamId);
  return `<span class="thumb${x.cover ? " has-cover" : ""}">${inner}</span>`;
}

function teamBadge(name: string, id: string): string {
  return `<span class="team-avatar ph-${paletteOf(id)}" aria-hidden="true">${esc(initialOf(name))}</span>`;
}

function directoryCard(lang: Lang, x: DirSite, teamId: string): string {
  return `<li class="dir-card"><a class="dir-link" href="${esc(x.url)}" target="_blank" rel="noopener">${thumb(lang, x, teamId)}<span class="dir-body"><span class="dir-title"><bdi>${esc(x.title)}</bdi></span><span class="dir-url">${ltr(hostless(x.url))}</span></span></a><p class="meta dir-expiry">${expiryLine(lang, x.expiresAt)}</p></li>`;
}

function directorySection(lang: Lang, dir: Directory): string {
  const t = STRINGS[lang].directory;
  const groups = dir.teams.length
    ? dir.teams
        .map(
          (team) => `<div class="dir-team" role="group" aria-labelledby="dir-${esc(team.id)}">
      <h3 id="dir-${esc(team.id)}" class="dir-team-head">${teamBadge(team.name, team.id)}<bdi>${esc(team.name)}</bdi> <span class="count">${esc(t.pages(team.sites.length))}</span></h3>
      <ul class="dir-grid">${team.sites.map((x) => directoryCard(lang, x, team.id)).join("")}</ul>
    </div>`,
        )
        .join("\n")
    : `<p class="notice">${esc(t.empty)}</p>`;
  return `<section id="directory" class="section wrap" aria-labelledby="directory-title">
  <div class="section-heading">
    <h2 id="directory-title">${esc(t.title)}</h2>
    <p>${esc(t.sub)}</p>
  </div>
  ${groups}
</section>`;
}

/** The spotlighted page: the first live FEATURED_SITES id, else the newest team page. */
function featuredSection(lang: Lang, dir: Directory): string {
  const t = STRINGS[lang];
  for (const id of dir.featured ?? []) {
    for (const team of dir.teams) {
      const x = team.sites.find((y) => y.id === id);
      if (!x) continue;
      return `<section class="section wrap featured" aria-labelledby="featured-title">
  <article class="feature-card">
    <a class="feature-thumb" href="${esc(x.url)}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">${thumb(lang, x, team.id, true)}</a>
    <div class="feature-body">
      <p class="eyebrow">${esc(t.landing.featured)}</p>
      <h2 id="featured-title"><bdi>${esc(x.title)}</bdi></h2>
      <p class="feature-team">${teamBadge(team.name, team.id)}<span>${esc(t.landing.by)} <bdi>${esc(team.name)}</bdi></span></p>
      <p class="dir-url">${ltr(hostless(x.url))}</p>
      <p class="meta">${expiryLine(lang, x.expiresAt)}</p>
      <div class="actions">
        <a class="button" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(t.landing.open)} <span aria-hidden="true" class="arrow"></span></a>
        <a class="text-link" href="#directory">${esc(t.landing.allPages)}</a>
      </div>
    </div>
  </article>
</section>`;
    }
  }
  return "";
}

const fmt = (lang: Lang, n: number) =>
  new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-GB").format(n);

function heroStats(lang: Lang, c: Config, dir: Directory): string {
  const t = STRINGS[lang].landing;
  const pages = dir.teams.reduce((n, team) => n + team.sites.length, 0);
  const item = (value: string, label: string) =>
    `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
  return `<dl class="hero-stats" aria-label="${esc(t.statsLabel)}">${item(fmt(lang, dir.teams.length), t.statTeams)}${item(fmt(lang, pages), t.statPages)}${item(hoursLabel(lang, c.maxTtlHours), t.statTtl)}</dl>`;
}

const STEP_ICONS = [
  '<path d="M24 30V12M16 20l8-8 8 8M10 30v5a4 4 0 0 0 4 4h20a4 4 0 0 0 4-4v-5"/>',
  '<path d="M21 27a6 6 0 0 0 8.5 0l5-5a6 6 0 0 0-8.5-8.5l-2 2M27 21a6 6 0 0 0-8.5 0l-5 5a6 6 0 0 0 8.5 8.5l2-2"/>',
  '<circle cx="24" cy="25" r="13"/><path d="M24 17v8l6 4M19 8h10"/>',
];

function howStrip(lang: Lang): string {
  const t = STRINGS[lang];
  return `<section class="how-strip" aria-labelledby="how-title">
  <div class="wrap">
    <div class="how-head"><p class="eyebrow">${esc(t.landing.howEyebrow)}</p><h2 id="how-title">${esc(t.how.title)}</h2></div>
    <ol class="how-steps">
      ${t.how.steps
        .map(
          ([h, p], i) =>
            `<li><span class="how-icon" aria-hidden="true"><svg viewBox="0 0 48 48" focusable="false">${STEP_ICONS[i] ?? ""}</svg></span><div><h3><span class="how-num">${esc(fmt(lang, i + 1))}</span> ${esc(h)}</h3><p>${esc(p)}</p></div></li>`,
        )
        .join("")}
    </ol>
  </div>
</section>`;
}

function uploader(lang: Lang, c: Config, headingLevel: "h1" | "h2"): string {
  const t = STRINGS[lang];
  const l = limitValues(lang, c);
  return `<section id="try" class="section try" aria-labelledby="try-title">
  <div class="wrap narrow">
    <div class="section-heading">
      <${headingLevel} id="try-title">${esc(t.try.title)}</${headingLevel}>
      <p>${esc(t.try.sub)}</p>
    </div>
    <div id="drop" class="drop" tabindex="0" role="group" aria-label="${esc(t.try.drop)}">
      <svg class="drop-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path class="stroke" d="M24 30V10M15 19l9-9 9 9M8 30v6a4 4 0 0 0 4 4h24a4 4 0 0 0 4-4v-6"/></svg>
      <p class="drop-title">${esc(t.try.drop)}</p>
      <div class="actions center">
        <label class="button"><input id="pickFiles" type="file" multiple class="sr-only"><span>${esc(t.try.pickFiles)}</span></label>
        <label class="button ghost"><input id="pickDir" type="file" webkitdirectory class="sr-only"><span>${esc(t.try.pickDir)}</span></label>
      </div>
      <label class="ttl"><span>${esc(t.try.expires)}</span> <select id="ttl">${ttlOptions(lang, c)}</select></label>
      <p class="meta">${esc(t.limits.limitItems(l)[0] ?? "")}</p>
    </div>
    <p id="status" class="status" role="status" aria-live="polite"></p>
    <div id="result" class="flash ok" hidden>
      <h3>${esc(t.try.ready)}</h3>
      <div class="copy-row"><a id="link" class="strong-link" target="_blank" rel="noopener" dir="ltr"></a> <button id="copy" type="button" class="button small ghost">${esc(t.try.copy)}</button></div>
      <p class="meta">${esc(t.try.tokenNote)}</p>
      <code id="token" class="token" dir="ltr"></code>
    </div>
    ${currentNavAccount() === "team" ? `<p class="meta team-hint"><a class="text-link" href="${localePath(lang, "/team")}">${esc(t.nav.dashboard)}</a></p>` : `<p class="meta team-hint"><a class="text-link" href="${localePath(lang, "/login")}">${esc(t.try.teamHint)}</a></p>`}
    <h3 class="mine-title">${esc(t.try.mine)}</h3>
    <ul id="mine" class="mine" data-empty="${esc(t.try.none)}"></ul>
  </div>
</section>`;
}

function agentSnippet(c: Config): string {
  return `<pre class="code" dir="ltr"><code>(cd out &amp;&amp; zip -qr ../site.zip .)
curl -s -X POST "${esc(c.publicUrl)}/api/sites?ttlHours=24" \\
  -H "Content-Type: application/zip" --data-binary @site.zip
# =&gt; { "url": "${esc(c.publicUrl)}/s/k3v9x2mq7a/", "expiresAt": "…", "editToken": "…" }</code></pre>`;
}

const HERO_ART = `<svg class="hero-art" viewBox="0 0 420 320" role="img" aria-label="Pages becoming a shareable link">
  <rect x="28" y="30" width="250" height="176" rx="10" class="paper"/>
  <rect x="28" y="30" width="250" height="34" rx="10" class="paper-top"/>
  <circle cx="48" cy="47" r="5" class="dot"/><circle cx="64" cy="47" r="5" class="dot"/><circle cx="80" cy="47" r="5" class="dot"/>
  <rect x="50" y="86" width="140" height="13" rx="6" class="line strong"/>
  <rect x="50" y="112" width="200" height="9" rx="4.5" class="line"/>
  <rect x="50" y="130" width="176" height="9" rx="4.5" class="line"/>
  <rect x="50" y="148" width="190" height="9" rx="4.5" class="line"/>
  <rect x="50" y="172" width="78" height="20" rx="5" class="pill"/>
  <rect x="150" y="150" width="244" height="64" rx="10" class="link-card"/>
  <circle cx="184" cy="182" r="15" class="link-icon"/>
  <path d="M178 182h12M185 176l6 6-6 6" class="link-arrow"/>
  <rect x="212" y="171" width="150" height="9" rx="4.5" class="on-dark"/>
  <rect x="212" y="187" width="92" height="7" rx="3.5" class="on-dark faint"/>
  <path d="M0 262c35 0 35-12 70-12s35 12 70 12 35-12 70-12 35 12 70 12 35-12 70-12 35 12 70 12" class="wave"/>
  <path d="M0 288c35 0 35-12 70-12s35 12 70 12 35-12 70-12 35 12 70 12 35-12 70-12 35 12 70 12" class="wave faint"/>
  <g class="clock"><circle cx="350" cy="78" r="28" class="clock-face"/><path d="M350 63v15l10 7" class="clock-hand"/></g>
</svg>`;

export function landingHtml(
  lang: Lang,
  c: Config,
  dir: Directory = { generatedAt: "", teams: [] },
): string {
  const t = STRINGS[lang];
  const href = (p: string) => localePath(lang, p);
  const l = limitValues(lang, c);
  const body = `
<section class="hero wrap">
  <div class="hero-copy">
    <p class="eyebrow">${esc(t.hero.eyebrow)}</p>
    <h1>${esc(t.hero.title)}</h1>
    <p class="hero-description">${esc(t.hero.sub)}</p>
    <div class="actions">
      <a class="button" href="${href("/new")}">${esc(t.hero.ctaTry)}</a>
      ${(() => {
        const acct = currentNavAccount();
        return acct === "admin"
          ? `<a class="button ghost" href="${href("/admin")}">${esc(t.nav.adminConsole)}</a>`
          : acct === "team"
            ? `<a class="button ghost" href="${href("/team")}">${esc(t.nav.dashboard)}</a>`
            : `<a class="button ghost" href="${href("/login")}">${esc(t.hero.ctaTeam)}</a>`;
      })()}
      <a class="text-link" href="#directory">${esc(t.directory.title)} <span aria-hidden="true" class="arrow"></span></a>
    </div>
    ${heroStats(lang, c, dir)}
  </div>
  <figure class="hero-figure">${HERO_ART}</figure>
</section>
<div class="principles-strip"><div class="wrap">${t.strip.map((x, i) => (i === 0 ? `<p>${esc(x)}</p>` : `<span>${esc(x)}</span>`)).join("")}</div></div>

${howStrip(lang)}

${featuredSection(lang, dir)}

${directorySection(lang, dir)}

<section class="section band" aria-labelledby="why-title">
  <div class="wrap">
    <div class="section-heading"><h2 id="why-title">${esc(t.why.title)}</h2></div>
    <div class="three">
      ${t.why.items.map(([h, p]) => `<article class="feature"><h3>${esc(h)}</h3><p>${esc(p)}</p></article>`).join("")}
    </div>
  </div>
</section>

<section class="section wrap" aria-labelledby="teams-title">
  <div class="tool-band">
    <div>
      <h2 id="teams-title">${esc(t.teamsBand.title)}</h2>
      <p>${esc(t.teamsBand.sub)}</p>
    </div>
    <div class="actions">
      ${currentNavAccount() === "team" ? `<a class="button" href="${href("/team")}">${esc(t.nav.dashboard)}</a>` : `<a class="button" href="${href("/login")}">${esc(t.teamsBand.cta)}</a>`}
      <a class="text-link" href="/docs/teams">${esc(t.teamsBand.docs)}</a>
    </div>
  </div>
</section>

<section class="section band" aria-labelledby="uses-title">
  <div class="wrap">
    <div class="section-heading"><h2 id="uses-title">${esc(t.uses.title)}</h2><p>${esc(t.uses.sub)}</p></div>
    <div class="card-grid">
      ${t.uses.items.map(([h, p]) => `<article class="card"><h3>${esc(h)}</h3><p>${esc(p)}</p></article>`).join("")}
    </div>
    <p class="more"><a class="text-link" href="/docs/use-cases">${esc(t.uses.more)}</a></p>
  </div>
</section>

<section class="section wrap two-col" aria-labelledby="agents-title">
  <div>
    <h2 id="agents-title">${esc(t.agents.title)}</h2>
    <p>${esc(t.agents.sub)}</p>
    <div class="actions"><a class="button small ghost" href="/llms.txt">${esc(t.agents.llms)}</a> <a class="button small ghost" href="/openapi.json">${esc(t.agents.openapi)}</a> <a class="text-link" href="/docs/agents">${esc(t.agents.guide)}</a></div>
  </div>
  ${agentSnippet(c)}
</section>

${uploader(lang, c, "h2")}

<section class="section band" aria-labelledby="limits-title">
  <div class="wrap two-col">
    <div>
      <h2 id="limits-title">${esc(t.limits.title)}</h2>
      <p>${esc(t.limits.sub)}</p>
      <ul class="checks">${t.limits
        .limitItems(l)
        .map((x) => `<li>${esc(x)}</li>`)
        .join("")}</ul>
    </div>
    <div>
      <h3>${esc(t.limits.privacyTitle)}</h3>
      <ul class="checks">${t.limits.privacy.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    </div>
  </div>
</section>

<section class="section wrap two-col" aria-labelledby="self-title">
  <div>
    <h2 id="self-title">${esc(t.selfhost.title)}</h2>
    <p>${esc(t.selfhost.sub)}</p>
    <div class="actions"><a class="button small ghost" href="/docs/self-hosting">${esc(t.selfhost.cta)}</a></div>
  </div>
  <pre class="code" dir="ltr"><code>docker compose up -d --build
# =&gt; http://localhost:8080</code></pre>
</section>`;
  return layout({
    lang,
    title: `${t.product}: ${t.hero.title}`,
    description: t.hero.sub,
    path: "/",
    body,
    config: c,
    active: "home",
  });
}

export function newHtml(lang: Lang, c: Config): string {
  const t = STRINGS[lang];
  return layout({
    lang,
    title: `${t.try.title} · ${t.product}`,
    description: t.hero.sub,
    path: "/new",
    body: uploader(lang, c, "h1"),
    config: c,
    active: "publish",
  });
}

// ---- sign-in ---------------------------------------------------------------------

export interface LoginOpts {
  kind: "team" | "admin";
  csrf: string;
  error?: string;
  notice?: string;
  disabled?: boolean;
}

export function loginHtml(lang: Lang, c: Config, o: LoginOpts): string {
  const t = STRINGS[lang];
  const team = o.kind === "team";
  const title = team ? t.login.title : t.admin.loginTitle;
  const sub = team ? t.login.sub : t.admin.loginSub;
  const action = localePath(lang, team ? "/login" : "/admin/login");
  const field = team ? "key" : "token";
  const err = o.error
    ? `<div class="flash err" role="alert" id="flash" tabindex="-1"><p id="login-error">${esc(o.error)}</p></div>`
    : "";
  const note = o.notice ? `<div class="flash ok" role="status"><p>${esc(o.notice)}</p></div>` : "";
  const memberForm = team
    ? `<form method="post" action="${action}" class="panel login-form member-login">
      ${csrfField(o.csrf)}
      <h2 class="h3">${esc(t.members.memberTitle)}</h2>
      <label for="username">${esc(t.members.username)}</label>
      <input id="username" name="username" type="text" dir="ltr" required autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="32">
      <label for="password">${esc(t.members.password)}</label>
      <input id="password" name="password" type="password" dir="ltr" required autocomplete="current-password" maxlength="200">
      <button class="button" type="submit">${esc(t.members.signInMember)}</button>
    </form>
    <h2 class="h3 login-or">${esc(t.members.keyTitle)}</h2>
    <p class="meta">${esc(t.members.keySub)}</p>`
    : "";
  const form = o.disabled
    ? `<p class="notice">${esc(t.admin.disabled)}</p>`
    : `${memberForm}<form method="post" action="${action}" class="panel login-form" autocomplete="off">
      ${csrfField(o.csrf)}
      <label for="${field}">${esc(team ? t.login.keyLabel : t.admin.tokenLabel)}</label>
      <input id="${field}" name="${field}" type="password" dir="ltr" required autocomplete="off" spellcheck="false" aria-describedby="${field}-help${o.error ? " login-error" : ""}"${o.error ? ' aria-invalid="true"' : ""}${team ? "" : " autofocus"}>
      ${team ? `<p class="form-help" id="${field}-help">${esc(t.login.keyHelp)}</p>` : `<p class="form-help" id="${field}-help"></p>`}
      <button class="button" type="submit">${esc(t.login.submit)}</button>
    </form>`;
  const body = `<div class="wrap page-narrow">
  ${pageHead(team ? t.team.eyebrow : t.admin.eyebrow, esc(title), sub)}
  ${err}${note}
  ${form}
  <p class="meta login-foot">${team ? `${esc(t.login.noKey)} · <a class="text-link" href="${localePath(lang, "/admin/login")}">${esc(t.login.adminLink)}</a>` : `<a class="text-link" href="${localePath(lang, "/login")}">${esc(t.login.title)}</a>`}</p>
</div>`;
  return layout({
    lang,
    title: `${title} · ${t.product}`,
    description: sub,
    path: team ? "/login" : "/admin/login",
    body,
    config: c,
    active: "team",
    noindex: !team,
  });
}

// ---- team dashboard --------------------------------------------------------------

export interface TeamSiteRow {
  id: string;
  title: string;
  url: string;
  createdAt: string;
  expiresAt: string;
  totalBytes: number;
  fileCount: number;
  listed: boolean;
  unlisted: boolean;
  permanent: boolean;
  visits?: VisitSummary;
}

function sparkline(lang: Lang, v: VisitSummary): string {
  const t = STRINGS[lang];
  const W = 120;
  const H = 28;
  const vals = v.days.map((d) => d.views);
  const max = Math.max(1, ...vals);
  const step = W / Math.max(1, vals.length - 1);
  const pts = vals
    .map((n, i) => `${(i * step).toFixed(1)},${(H - 2 - (n / max) * (H - 4)).toFixed(1)}`)
    .join(" ");
  return `<svg class="spark" dir="ltr" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(t.visits.chart(fmt(lang, v.views30)))}" focusable="false"><polygon class="spark-area" points="0,${H} ${pts} ${W},${H}"/><polyline class="spark-line" points="${pts}"/></svg>`;
}

function visitsCell(lang: Lang, v: VisitSummary | undefined): string {
  if (!v) return `<span class="meta">–</span>`;
  const t = STRINGS[lang];
  return `<div class="visits-cell">${sparkline(lang, v)}<span class="meta">${esc(t.visits.short(fmt(lang, v.views7), fmt(lang, v.views30)))}</span></div>`;
}

function visitsSection(lang: Lang, v: VisitSummary | undefined): string {
  const t = STRINGS[lang];
  if (!v) {
    return `<section class="block visits-block" aria-labelledby="visits-title"><h2 id="visits-title">${esc(t.visits.title)}</h2><p class="meta">${esc(t.visits.off)}</p></section>`;
  }
  const W = 600;
  const H = 120;
  const gap = 4;
  const bw = W / v.days.length - gap;
  const max = Math.max(1, ...v.days.map((d) => d.views));
  const bars = v.days
    .map((d, i) => {
      const h = d.views ? Math.max(2, (d.views / max) * (H - 6)) : 1;
      return `<rect x="${(i * (bw + gap) + gap / 2).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" class="${d.views ? "bar" : "bar zero"}"><title>${esc(t.visits.day(d.day, fmt(lang, d.views), fmt(lang, d.visitors)))}</title></rect>`;
    })
    .join("");
  const fact = (label: string, n: number) =>
    `<div><dt>${esc(label)}</dt><dd class="num">${esc(fmt(lang, n))}</dd></div>`;
  return `<section class="block visits-block" aria-labelledby="visits-title">
    <h2 id="visits-title">${esc(t.visits.title)}</h2>
    <dl class="facts visits-facts">
      ${fact(t.visits.today, v.today)}
      ${fact(`${t.visits.views} · ${t.visits.last7}`, v.views7)}
      ${fact(`${t.visits.views} · ${t.visits.last30}`, v.views30)}
      ${fact(`${t.visits.visitors} · ${t.visits.last7}`, v.visitors7)}
      ${fact(`${t.visits.visitors} · ${t.visits.last30}`, v.visitors30)}
    </dl>
    <figure class="visits-chart">
      <svg dir="ltr" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(t.visits.chart(fmt(lang, v.views30)))}">${bars}</svg>
      <figcaption dir="ltr"><span>${esc(v.days[0]?.day ?? "")}</span><span>${esc(v.days[v.days.length - 1]?.day ?? "")}</span></figcaption>
    </figure>
    <p class="meta">${esc(t.visits.privacy)}</p>
  </section>`;
}

export interface MeView {
  name: string;
  role: MemberRole;
  /** Signed in with the team key (acts as owner). */
  viaKey: boolean;
}

export interface AuditView {
  at: string;
  who: string;
  kind: "member" | "key" | "admin" | "api" | "mcp";
  action: string;
  detail?: string;
  site?: { id: string; title: string } | null;
}

const canEdit = (me?: MeView) => (me?.role ?? "owner") !== "viewer";

function auditTable(lang: Lang, rows: AuditView[], withSite: boolean, labelId: string): string {
  const t = STRINGS[lang];
  if (!rows.length) return `<p class="meta">${esc(t.members.auditNone)}</p>`;
  const body = rows
    .map((e) => {
      const what =
        t.members.actions[e.action] ??
        (e.action.startsWith("mcp:") ? `MCP · ${e.action.slice(4)}` : e.action);
      const site =
        withSite && e.site
          ? ` · <a class="text-link" href="${localePath(lang, `/team/sites/${e.site.id}`)}"><bdi>${esc(e.site.title)}</bdi></a>`
          : withSite && e.site === null
            ? ""
            : "";
      return `<tr><td data-label="${esc(t.members.when)}">${timeTag(lang, e.at)}</td>${td(t.members.who, `<bdi>${esc(e.kind === "member" ? e.who : (t.members.actorLabels[e.who] ?? e.who))}</bdi> <span class="badge muted">${esc(t.members.actorKinds[e.kind])}</span>`)}${td(t.members.what, `${esc(what)}${e.detail ? ` <span class="meta">${/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(e.detail) ? timeTag(lang, e.detail) : `<bdi>${esc(e.detail)}</bdi>`}</span>` : ""}${site}`)}</tr>`;
    })
    .join("");
  return `<div class="table-wrap"><table class="data stack audit-table" aria-labelledby="${labelId}"><thead><tr><th scope="col">${esc(t.members.when)}</th><th scope="col">${esc(t.members.who)}</th><th scope="col">${esc(t.members.what)}</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

export interface TeamPageOpts {
  me?: MeView;
  team: { id: string; name: string; backend: boolean; directory: boolean; permanent: boolean };
  quota: { sites: number; bytes: number };
  usage: { sites: number; bytes: number };
  backendConfigured: boolean;
  sites: TeamSiteRow[];
  csrf: string;
  flash?: Flash | null;
}

function teamHead(
  lang: Lang,
  o: { team: TeamPageOpts["team"]; csrf: string; me?: MeView },
  sub = "",
  active: "sites" | "members" = "sites",
): string {
  const t = STRINGS[lang];
  const out = postForm(
    localePath(lang, "/logout"),
    o.csrf,
    `<button class="button small ghost" type="submit">${esc(t.common.signOut)}</button>`,
  );
  const cur = (k: string) => (k === active ? ' aria-current="page"' : "");
  const nav = `<nav class="segmented" aria-label="${esc(t.team.eyebrow)}"><a class="button small ghost" href="${localePath(lang, "/team")}"${cur("sites")}>${esc(t.team.sites)}</a><a class="button small ghost" href="${localePath(lang, "/team/members")}"${cur("members")}>${esc(t.members.nav)}</a></nav>`;
  const who = o.me
    ? t.members.signedInAs(
        o.me.viaKey ? t.members.viaKey : o.me.name,
        o.me.viaKey ? t.members.roles.owner : t.members.roles[o.me.role],
      )
    : "";
  return pageHead(
    t.team.eyebrow,
    `<bdi>${esc(o.team.name)}</bdi>`,
    sub || who,
    `<div class="head-tools">${nav}${out}</div>`,
  );
}

const quotaState = (o: TeamPageOpts) =>
  o.usage.sites >= o.quota.sites || o.usage.bytes >= o.quota.bytes * 0.9 ? "warn" : "on";

function statusList(lang: Lang, o: TeamPageOpts): string {
  const t = STRINGS[lang];
  const backend = !o.team.backend
    ? ["off", t.team.backendOff]
    : o.backendConfigured
      ? ["on", t.team.backendOn]
      : ["warn", t.team.backendNotConfigured];
  return `<ul class="status-list">
    <li><span class="dot-status on" aria-hidden="true"></span><strong>${esc(t.team.sites)}:</strong> ${esc(t.team.sitesCount(o.sites.length))}</li>
    <li><span class="dot-status ${backend[0]}" aria-hidden="true"></span><strong>${esc(t.team.backend)}:</strong> ${esc(backend[1] ?? "")}</li>
    <li><span class="dot-status ${o.team.directory ? "on" : "off"}" aria-hidden="true"></span>${esc(o.team.directory ? t.team.directoryOn : t.team.directoryOff)}</li>
    ${o.team.permanent ? `<li><span class="dot-status on" aria-hidden="true"></span>${esc(t.team.permanentOn)}</li>` : ""}
    <li><span class="dot-status ${quotaState(o)}" aria-hidden="true"></span>${esc(t.team.quotaUse(`${o.usage.sites}/${o.quota.sites}`, `${bytesLabel(lang, o.usage.bytes)} / ${bytesLabel(lang, o.quota.bytes)}`))}</li>
  </ul>`;
}

function teamUploader(
  lang: Lang,
  c: Config,
  csrf: string,
  action: string,
  title: string,
  sub: string,
  submit: string,
  withTtl: boolean,
  compact = false,
  permanent = false,
): string {
  const t = STRINGS[lang];
  const l = limitValues(lang, c);
  return `<form method="post" action="${esc(action)}" enctype="multipart/form-data" class="panel team-upload${compact ? " compact" : ""}" data-upload data-uploading="${esc(t.team.uploading)}" data-failed="${esc(t.team.failed)}">
    ${csrfField(csrf)}
    <h2 class="h3">${esc(title)}</h2>
    <p>${esc(sub)}</p>
    <div class="drop" data-drop tabindex="0" role="group" aria-label="${esc(t.try.drop)}">
      <svg class="drop-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path class="stroke" d="M24 30V10M15 19l9-9 9 9M8 30v6a4 4 0 0 0 4 4h24a4 4 0 0 0 4-4v-6"/></svg>
      <p class="drop-title">${esc(t.try.drop)}</p>
      <div class="actions center">
        <label class="button ghost"><input name="files" type="file" multiple class="sr-only" data-pick required><span>${esc(t.team.pickZip)}</span></label>
        <label class="button ghost js-only"><input type="file" webkitdirectory class="sr-only" data-pick-dir><span>${esc(t.try.pickDir)}</span></label>
      </div>
      <p class="meta" data-chosen aria-live="polite"></p>
      <p class="meta">${esc(t.limits.limitItems(l)[0] ?? "")}</p>
    </div>
    <div class="form-row">
      ${withTtl ? `<label class="ttl"><span>${esc(t.try.expires)}</span> <select name="ttlHours">${ttlOptions(lang, c, c.defaultTtlHours, permanent)}</select></label>` : ""}
      <button class="button" type="submit">${esc(submit)}</button>
    </div>
    <p class="status" role="status" aria-live="polite" data-status></p>
  </form>`;
}

export function teamHtml(lang: Lang, c: Config, o: TeamPageOpts): string {
  const t = STRINGS[lang];
  const href = (p: string) => localePath(lang, p);
  const rows = o.sites
    .map((s) => {
      const listing = !o.team.directory
        ? `<span class="badge muted">${esc(t.team.hidden)}</span>`
        : `<span class="badge ${s.listed ? "on" : "muted"}">${esc(s.listed ? t.team.listed : t.team.hidden)}</span>`;
      return `<tr>
        <th scope="row"><a href="${href(`/team/sites/${s.id}`)}"><bdi>${esc(s.title)}</bdi></a></th>
        ${td(t.common.link, `<a href="${esc(s.url)}" target="_blank" rel="noopener" class="url">${ltr(hostless(s.url))}</a>`)}
        ${td(t.common.expires, timeTag(lang, s.expiresAt))}
        ${td(t.common.size, esc(bytesLabel(lang, s.totalBytes)))}
        ${td(t.admin.directory, listing)}
        ${td(t.visits.column, visitsCell(lang, s.visits))}
        <td class="cell-actions"><div class="acts"><a class="button small ghost" href="${href(`/team/sites/${s.id}`)}">${esc(t.team.manage)}</a>${
          canEdit(o.me)
            ? postForm(
                href(`/team/sites/${s.id}/delete`),
                o.csrf,
                `<button class="button small danger" type="submit">${esc(t.common.del)}</button>`,
                { confirm: t.team.confirmDelete },
              )
            : ""
        }</div></td>
      </tr>`;
    })
    .join("");
  const table = o.sites.length
    ? `<div class="table-wrap"><table class="data stack">
      <caption class="sr-only">${esc(t.team.sites)}</caption>
      <thead><tr><th scope="col">${esc(t.common.title)}</th><th scope="col">${esc(t.common.link)}</th><th scope="col">${esc(t.common.expires)}</th><th scope="col">${esc(t.common.size)}</th><th scope="col">${esc(t.admin.directory)}</th><th scope="col">${esc(t.visits.column)}</th><th scope="col"><span class="sr-only">${esc(t.common.actions)}</span></th></tr></thead>
      <tbody>${rows}</tbody></table></div>`
    : emptyState(t.team.empty, t.team.emptySub);
  const body = `<div class="wrap page-wide">
  ${teamHead(lang, o)}
  ${flashBox(lang, o.flash)}
  ${statusList(lang, o)}
  <section aria-labelledby="sites-title" class="block">
    <h2 id="sites-title">${esc(t.team.sites)}</h2>
    ${table}
  </section>
  ${
    canEdit(o.me)
      ? `<section aria-label="${esc(t.team.publishTitle)}" class="block">
    ${teamUploader(lang, c, o.csrf, href("/team/sites"), t.team.publishTitle, t.team.publishSub, t.team.publish, true, false, o.team.permanent)}
  </section>`
      : ""
  }
  <section aria-labelledby="agents-title" class="block two-col">
    <div>
      <h2 id="agents-title">${esc(t.team.agentsTitle)}</h2>
      <p>${esc(t.team.agentsSub)}</p>
      <div class="actions"><a class="button small ghost" href="/llms.txt">llms.txt</a><a class="text-link" href="/docs/teams">${esc(t.teamsBand.docs)}</a></div>
    </div>
    <pre class="code" dir="ltr"><code># MARSA_TEAM_KEY=marsa_team_…   (keep it secret)
(cd out &amp;&amp; zip -qr ../site.zip .)
curl -s -X POST "${esc(c.publicUrl)}/api/sites?ttlHours=72" \\
  -H "X-Team-Key: $MARSA_TEAM_KEY" \\
  -H "Content-Type: application/zip" --data-binary @site.zip

# Agent prompt:
# Read ${esc(c.publicUrl)}/llms.txt, publish ./out with the
# X-Team-Key header from $MARSA_TEAM_KEY, and reply with the URL.</code></pre>
  </section>
</div>`;
  return layout({
    lang,
    title: `${t.team.eyebrow} · ${o.team.name} · ${t.product}`,
    description: t.team.eyebrow,
    path: "/team",
    body,
    config: c,
    active: "team",
    noindex: true,
  });
}

export interface KvRowView {
  key: string;
  bytes?: number;
  preview?: string;
  full?: string;
  truncated?: boolean;
}

export interface McpPanel {
  endpoint: string;
  tokens: { id: string; name: string; scope: "ro" | "rw"; prefix: string; createdAt: string }[];
}

export interface TeamSitePageOpts extends TeamPageOpts {
  site: TeamSiteRow & { files: [string, number][]; ceiling: string };
  mcp?: McpPanel;
  audit?: AuditView[];
  backendBrowser:
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
}

export function teamSiteHtml(lang: Lang, c: Config, o: TeamSitePageOpts): string {
  const t = STRINGS[lang];
  const href = (p: string) => localePath(lang, p);
  const s = o.site;
  const base = `/team/sites/${s.id}`;
  const listed = o.team.directory && s.listed;
  const listingForm = o.team.directory
    ? postForm(
        href(`${base}/listing`),
        o.csrf,
        `<input type="hidden" name="listed" value="${s.unlisted ? "1" : "0"}"><button class="button small ghost" type="submit">${esc(s.unlisted ? t.team.show : t.team.hide)}</button>`,
      )
    : "";
  const files = s.files
    .slice(0, 200)
    .map(
      ([p, size]) =>
        `<li><span class="file-path" dir="ltr">${esc(p)}</span><span class="file-size">${esc(bytesLabel(lang, size))}</span></li>`,
    )
    .join("");

  const bb = o.backendBrowser;
  let backendHtml: string;
  let backendStatus = "";
  if (bb.state === "off") {
    backendHtml = `<p class="notice">${esc(bb.reason ?? t.team.backendBrowserOff)}</p>`;
  } else {
    backendStatus = `<ul class="status-list compact">
      <li><span class="dot-status ${bb.totalKeys ? "on" : "off"}" aria-hidden="true"></span><strong>${esc(t.team.kvTitle)}:</strong> ${esc(t.team.kvCount(bb.totalKeys))}</li>
      <li><span class="dot-status ${bb.files.length ? "on" : "off"}" aria-hidden="true"></span><strong>${esc(t.team.backendFilesTitle)}:</strong> ${esc(t.team.backendFilesCount(bb.files.length))}</li>
    </ul>`;
    const kvRows = bb.kv
      .map((k) => {
        const value =
          k.full === undefined
            ? `<span class="meta">…</span>`
            : `<details class="kv-value"><summary><code dir="ltr">${esc(k.preview ?? "")}</code></summary><pre dir="ltr">${esc(k.full)}</pre>${k.truncated ? `<p class="meta">${esc(t.team.valueTruncated)}</p>` : ""}</details>`;
        return `<tr><th scope="row"><code class="kv-key" dir="ltr">${esc(k.key)}</code>${k.bytes !== undefined ? `<div class="meta">${esc(bytesLabel(lang, k.bytes))}</div>` : ""}</th>${td(t.team.value, value, "cell-value")}<td class="cell-actions">${
          !canEdit(o.me)
            ? ""
            : postForm(
                href(`${base}/kv/delete`),
                o.csrf,
                `<input type="hidden" name="key" value="${esc(k.key)}"><button class="button small danger" type="submit" aria-label="${esc(`${t.common.del}: ${k.key}`)}">${esc(t.common.del)}</button>`,
                { confirm: t.common.confirm },
              )
        }</td></tr>`;
      })
      .join("");
    const more = bb.otherKeys.length
      ? `<details class="more-keys"><summary>${esc(t.team.moreKeys(bb.otherKeys.length))}</summary><ul class="key-chips">${bb.otherKeys.map((k) => `<li><code dir="ltr">${esc(k)}</code></li>`).join("")}</ul></details>`
      : bb.moreKeys
        ? `<p class="meta">${esc(t.team.moreKeys(bb.moreKeys))}</p>`
        : "";
    const fileRows = bb.files
      .map(
        (f) =>
          `<tr><th scope="row"><a href="${esc(f.url)}" target="_blank" rel="noopener" dir="ltr">${esc(f.name)}</a></th>${td(t.common.size, esc(bytesLabel(lang, f.size)))}${td(t.common.created, timeTag(lang, f.createdAt))}<td class="cell-actions">${
            !canEdit(o.me)
              ? ""
              : postForm(
                  href(`${base}/files/delete`),
                  o.csrf,
                  `<input type="hidden" name="fileId" value="${esc(f.id)}"><button class="button small danger" type="submit" aria-label="${esc(`${t.common.del}: ${f.name}`)}">${esc(t.common.del)}</button>`,
                  { confirm: t.common.confirm },
                )
          }</td></tr>`,
      )
      .join("");
    backendHtml = `${bb.error ? `<p class="flash err" role="alert">${esc(bb.error)}</p>` : ""}
    <h3 id="kv-title">${esc(t.team.kvTitle)}</h3>
    ${
      bb.kv.length
        ? `<div class="table-wrap"><table class="data stack kv-table" aria-labelledby="kv-title"><thead><tr><th scope="col">${esc(t.team.key)}</th><th scope="col">${esc(t.team.value)}</th><th scope="col"><span class="sr-only">${esc(t.common.actions)}</span></th></tr></thead><tbody>${kvRows}</tbody></table></div>${more}`
        : `<p class="meta">${esc(t.team.kvEmpty)}</p>`
    }
    <h3 id="bfiles-title">${esc(t.team.backendFilesTitle)}</h3>
    ${
      bb.files.length
        ? `<div class="table-wrap"><table class="data stack" aria-labelledby="bfiles-title"><thead><tr><th scope="col">${esc(t.common.title)}</th><th scope="col">${esc(t.common.size)}</th><th scope="col">${esc(t.common.created)}</th><th scope="col"><span class="sr-only">${esc(t.common.actions)}</span></th></tr></thead><tbody>${fileRows}</tbody></table></div>`
        : `<p class="meta">${esc(t.team.backendFilesEmpty)}</p>`
    }`;
  }
  const tools = `<div class="head-tools"><a class="button small" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(t.team.openSite)} <span class="arrow" aria-hidden="true"></span></a><button type="button" class="button small ghost" data-copy="#siteUrl" data-copied="${esc(t.common.copied)}">${esc(t.common.copy)}</button></div>`;
  const body = `<div class="wrap page-wide">
  <p><a class="breadcrumb" href="${href("/team")}"><span class="arrow back" aria-hidden="true"></span> ${esc(t.team.back)}</a></p>
  ${pageHead(o.team.name, `<bdi>${esc(s.title)}</bdi>`, "", tools)}
  ${flashBox(lang, o.flash)}
  <section aria-labelledby="settings-title">
    <div class="site-summary panel">
      <h2 class="h3" id="settings-title">${esc(t.team.settingsTitle)}</h2>
      <dl class="facts">
        <div class="fact-wide"><dt>${esc(t.common.link)}</dt><dd><a id="siteUrl" class="strong-link" href="${esc(s.url)}" target="_blank" rel="noopener" dir="ltr">${esc(hostless(s.url))}</a></dd></div>
        <div><dt>${esc(t.common.expires)}</dt><dd>${timeTag(lang, s.expiresAt)}</dd></div>
        <div><dt>${esc(t.common.created)}</dt><dd>${timeTag(lang, s.createdAt)}</dd></div>
        <div><dt>${esc(t.common.size)}</dt><dd>${esc(bytesLabel(lang, s.totalBytes))} · ${esc(t.common.files(s.fileCount))}</dd></div>
        <div><dt>${esc(t.admin.directory)}</dt><dd><span class="badge ${listed ? "on" : "muted"}">${esc(listed ? t.team.listed : t.team.hidden)}</span></dd></div>
      </dl>
      ${
        canEdit(o.me)
          ? `<div class="actions site-actions">
        ${postForm(
          href(`${base}/extend`),
          o.csrf,
          `<label class="ttl"><span>${esc(t.team.extendTo)}</span> <select name="ttlHours">${ttlOptions(lang, c, c.defaultTtlHours, false)}</select></label> <button class="button small" type="submit">${esc(t.team.extend)}</button>`,
          { cls: "inline-form extend-form" },
        )}
        ${
          o.team.permanent && !s.permanent
            ? postForm(
                href(`${base}/permanent`),
                o.csrf,
                `<button class="button small ghost" type="submit">${esc(t.team.makePermanent)}</button>`,
              )
            : ""
        }
        ${listingForm}
        ${postForm(
          href(`${base}/delete`),
          o.csrf,
          `<button class="button small danger" type="submit">${esc(t.common.del)}</button>`,
          { confirm: t.team.confirmDelete, cls: "inline-form push-end" },
        )}
      </div>`
          : ""
      }
      <p class="meta">${s.permanent ? esc(t.team.permanentNote) : `${esc(t.team.capped)} (${timeTag(lang, s.ceiling)})`}</p>
    </div>
  </section>
  ${visitsSection(lang, s.visits)}
  ${
    canEdit(o.me)
      ? `<section class="block" aria-label="${esc(t.team.replace)}">
    ${teamUploader(lang, c, o.csrf, href(`${base}/replace`), t.team.replace, t.team.replaceHelp, t.team.replace, false, true)}
  </section>`
      : ""
  }
  <section class="block" aria-labelledby="files-title">
    <h2 id="files-title">${esc(t.team.filesTitle)} <span class="count">${esc(t.common.files(s.fileCount))}</span></h2>
    <ul class="file-list">${files}</ul>
  </section>
  <section class="block backend-block" aria-labelledby="backend-title">
    <h2 id="backend-title">${esc(t.team.backend)}</h2>
    ${backendStatus}
    ${backendHtml}
  </section>
  ${o.mcp ? mcpSection(lang, o.mcp, o.csrf, href(base), s.id, canEdit(o.me)) : ""}
  ${
    o.audit
      ? `<section class="block audit-block" aria-labelledby="audit-title">
    <h2 id="audit-title">${esc(t.members.auditSiteTitle)}</h2>
    ${auditTable(lang, o.audit, false, "audit-title")}
  </section>`
      : ""
  }
</div>`;
  return layout({
    lang,
    title: `${s.title} · ${o.team.name} · ${t.product}`,
    description: t.team.eyebrow,
    path: base,
    body,
    config: c,
    active: "team",
    noindex: true,
  });
}

function mcpSection(
  lang: Lang,
  m: McpPanel,
  csrf: string,
  base: string,
  siteId: string,
  editable = true,
): string {
  const t = STRINGS[lang];
  const rows = m.tokens
    .map(
      (x) =>
        `<tr><th scope="row"><bdi>${esc(x.name)}</bdi></th>${td(t.mcp.scope, `<span class="badge ${x.scope === "rw" ? "warn" : "on"}">${esc(x.scope === "rw" ? t.mcp.rw : t.mcp.ro)}</span>`)}${td(t.admin.key, `<code class="ltr">${esc(x.prefix)}…</code>`)}${td(t.common.created, timeTag(lang, x.createdAt))}<td class="cell-actions">${
          !editable
            ? ""
            : postForm(
                `${base}/mcp/${x.id}/delete`,
                csrf,
                `<button class="button small danger" type="submit" aria-label="${esc(`${t.mcp.revoke}: ${x.name}`)}">${esc(t.mcp.revoke)}</button>`,
                { confirm: t.mcp.confirmRevoke },
              )
        }</td></tr>`,
    )
    .join("");
  const table = m.tokens.length
    ? `<div class="table-wrap"><table class="data stack" aria-labelledby="mcp-tokens-title"><thead><tr><th scope="col">${esc(t.mcp.name)}</th><th scope="col">${esc(t.mcp.scope)}</th><th scope="col">${esc(t.admin.key)}</th><th scope="col">${esc(t.common.created)}</th><th scope="col"><span class="sr-only">${esc(t.common.actions)}</span></th></tr></thead><tbody>${rows}</tbody></table></div>`
    : `<p class="meta">${esc(t.mcp.none)}</p>`;
  const server = `marsa-${siteId}`;
  const ep = esc(m.endpoint);
  return `<section class="block mcp-block" id="mcp" aria-labelledby="mcp-title">
    <h2 id="mcp-title">${esc(t.mcp.title)}</h2>
    <p>${esc(t.mcp.sub)}</p>
    <div class="copy-row mcp-endpoint"><strong>${esc(t.mcp.endpoint)}:</strong> <code id="mcpUrl" dir="ltr">${ep}</code><button type="button" class="button small ghost" data-copy="#mcpUrl" data-copied="${esc(t.common.copied)}">${esc(t.common.copy)}</button></div>
    <h3 id="mcp-tokens-title">${esc(t.mcp.tokens)}</h3>
    ${table}
    ${
      !editable
        ? ""
        : `<form method="post" action="${esc(`${base}/mcp`)}" class="panel mcp-create">
      ${csrfField(csrf)}
      <div class="form-row">
        <label class="grow"><span>${esc(t.mcp.name)}</span><input name="name" type="text" required maxlength="60" dir="auto" placeholder="${esc(t.mcp.namePlaceholder)}"></label>
        <label><span>${esc(t.mcp.scope)}</span><select name="scope"><option value="ro">${esc(t.mcp.ro)}</option><option value="rw">${esc(t.mcp.rw)}</option></select></label>
        <button class="button" type="submit">${esc(t.mcp.create)}</button>
      </div>
      <p class="meta">${esc(t.mcp.rwNote)}</p>
    </form>`
    }
    <h3>${esc(t.mcp.snippets)}</h3>
    <p class="meta">${esc(t.mcp.snippetNote)}</p>
    <div class="two-col mcp-snippets">
      <div><p class="snippet-label">Cursor · <code>.cursor/mcp.json</code> · Claude Desktop (Connectors)</p><pre class="code" dir="ltr"><code>{
  "mcpServers": {
    "${esc(server)}": {
      "url": "${ep}",
      "headers": { "Authorization": "Bearer marsa_mcp_…" }
    }
  }
}</code></pre></div>
      <div><p class="snippet-label">Claude Code</p><pre class="code" dir="ltr"><code>claude mcp add --transport http ${esc(server)} \\
  ${ep} \\
  --header "Authorization: Bearer marsa_mcp_…"</code></pre>
      <p class="snippet-label">VS Code · <code>.vscode/mcp.json</code></p><pre class="code" dir="ltr"><code>{ "servers": { "${esc(server)}": {
  "type": "http", "url": "${ep}",
  "headers": { "Authorization": "Bearer marsa_mcp_…" } } } }</code></pre></div>
    </div>
  </section>`;
}

// ---- members -------------------------------------------------------------------

export interface MembersPageOpts extends TeamPageOpts {
  meId: string | null;
  members: {
    id: string;
    name: string;
    username: string;
    role: MemberRole;
    createdAt: string;
    lastLoginAt?: string;
  }[];
  invites: {
    id: string;
    role: MemberRole;
    createdAt: string;
    expiresAt: string;
    createdBy: string;
  }[];
  audit: AuditView[];
}

const roleOptions = (lang: Lang, sel: MemberRole) =>
  (["owner", "editor", "viewer"] as const)
    .map(
      (r) =>
        `<option value="${r}"${r === sel ? " selected" : ""}>${esc(STRINGS[lang].members.roles[r])}</option>`,
    )
    .join("");

export function membersHtml(lang: Lang, c: Config, o: MembersPageOpts): string {
  const t = STRINGS[lang];
  const tm = t.members;
  const href = (p: string) => localePath(lang, p);
  const owner = (o.me?.role ?? "owner") === "owner";
  const rows = o.members
    .map((m) => {
      const self = m.id === o.meId;
      const roleCell =
        owner && !self
          ? postForm(
              href(`/team/members/${m.id}/role`),
              o.csrf,
              `<label class="sr-only" for="role-${m.id}">${esc(`${tm.role} · ${m.name}`)}</label><select id="role-${m.id}" name="role">${roleOptions(lang, m.role)}</select><button type="submit" class="button small ghost">${esc(tm.save)}</button>`,
              { cls: "inline-form role-form" },
            )
          : `<span class="badge ${m.role === "owner" ? "on" : "muted"}">${esc(tm.roles[m.role])}</span>`;
      return `<tr><th scope="row"><bdi>${esc(m.name)}</bdi>${self ? ` <span class="badge on">✓</span>` : ""}<div class="meta ltr">${esc(m.username)}</div></th>${td(tm.role, roleCell)}${td(tm.joined, timeTag(lang, m.createdAt))}${td(tm.lastSeen, m.lastLoginAt ? timeTag(lang, m.lastLoginAt) : `<span class="meta">${esc(tm.never)}</span>`)}<td class="cell-actions">${
        owner && !self
          ? postForm(
              href(`/team/members/${m.id}/delete`),
              o.csrf,
              `<button class="button small danger" type="submit" aria-label="${esc(`${tm.remove}: ${m.name}`)}">${esc(tm.remove)}</button>`,
              { confirm: tm.confirmRemove },
            )
          : ""
      }</td></tr>`;
    })
    .join("");
  const people = o.members.length
    ? `<div class="table-wrap"><table class="data stack" aria-labelledby="people-title"><thead><tr><th scope="col">${esc(tm.nameCol)}</th><th scope="col">${esc(tm.role)}</th><th scope="col">${esc(tm.joined)}</th><th scope="col">${esc(tm.lastSeen)}</th><th scope="col"><span class="sr-only">${esc(t.common.actions)}</span></th></tr></thead><tbody>${rows}</tbody></table></div>`
    : `<p class="meta">${esc(tm.none)}</p>`;
  const inviteRows = o.invites
    .map(
      (i) =>
        `<tr><th scope="row"><span class="badge muted">${esc(tm.roles[i.role])}</span></th>${td(tm.expires, timeTag(lang, i.expiresAt))}${td(tm.by, `<bdi>${esc(i.createdBy)}</bdi>`)}<td class="cell-actions">${postForm(
          href(`/team/members/invites/${i.id}/delete`),
          o.csrf,
          `<button class="button small ghost" type="submit">${esc(tm.revoke)}</button>`,
        )}</td></tr>`,
    )
    .join("");
  const invites = owner
    ? `<section class="block" aria-labelledby="invites-title">
    <h2 id="invites-title">${esc(tm.invitesTitle)}</h2>
    ${o.invites.length ? `<div class="table-wrap"><table class="data stack" aria-labelledby="invites-title"><thead><tr><th scope="col">${esc(tm.role)}</th><th scope="col">${esc(tm.expires)}</th><th scope="col">${esc(tm.by)}</th><th scope="col"><span class="sr-only">${esc(t.common.actions)}</span></th></tr></thead><tbody>${inviteRows}</tbody></table></div>` : `<p class="meta">${esc(tm.invitesNone)}</p>`}
    <form method="post" action="${href("/team/members/invite")}" class="panel invite-panel">
      ${csrfField(o.csrf)}
      <p>${esc(tm.inviteSub)}</p>
      <div class="form-row">
        <label><span>${esc(tm.role)}</span><select name="role">${roleOptions(lang, "editor")}</select></label>
        <label><span>${esc(tm.inviteExpiry)}</span><select name="ttlHours">${[24, 72, 168].map((h) => `<option value="${h}"${h === 72 ? " selected" : ""}>${esc(tm.hours(h))}</option>`).join("")}</select></label>
        <button class="button" type="submit">${esc(tm.invite)}</button>
      </div>
      <ul class="role-help meta">${(["owner", "editor", "viewer"] as const).map((r) => `<li><strong>${esc(tm.roles[r])}</strong>: ${esc(tm.roleHelp[r])}</li>`).join("")}</ul>
    </form>
  </section>`
    : "";
  const account = o.meId
    ? `<section class="block two-col account-block" aria-labelledby="account-title">
    <form method="post" action="${href("/team/account/password")}" class="panel">
      ${csrfField(o.csrf)}
      <h2 class="h3" id="account-title">${esc(tm.accountTitle)}: ${esc(tm.changePassword)}</h2>
      <label for="cur-pw">${esc(tm.current)}</label>
      <input id="cur-pw" name="current" type="password" dir="ltr" required autocomplete="current-password" maxlength="200">
      <label for="new-pw">${esc(tm.newPassword)}</label>
      <input id="new-pw" name="password" type="password" dir="ltr" required autocomplete="new-password" minlength="10" maxlength="200" aria-describedby="new-pw-help">
      <p class="form-help" id="new-pw-help">${esc(tm.passwordHelp)}</p>
      <label for="new-pw2">${esc(tm.confirm)}</label>
      <input id="new-pw2" name="confirm" type="password" dir="ltr" required autocomplete="new-password" minlength="10" maxlength="200">
      <button class="button" type="submit">${esc(tm.changePassword)}</button>
    </form>
    <div class="panel">
      <h2 class="h3">${esc(tm.signOutAll)}</h2>
      <p>${esc(tm.signOutAllHelp)}</p>
      ${postForm(href("/team/account/signout-all"), o.csrf, `<button class="button ghost" type="submit">${esc(tm.signOutAll)}</button>`)}
    </div>
  </section>`
    : `<p class="notice">${esc(tm.keyAccount)}</p>`;
  const body = `<div class="wrap page-wide">
  ${teamHead(lang, o, "", "members")}
  ${flashBox(lang, o.flash)}
  <section class="block" aria-labelledby="people-title">
    <h2 id="people-title">${esc(tm.listTitle)} <span class="count">${esc(tm.count(o.members.length))}</span></h2>
    ${people}
  </section>
  ${invites}
  ${account}
  <section class="block audit-block" aria-labelledby="audit-title">
    <h2 id="audit-title">${esc(tm.auditTitle)}</h2>
    ${auditTable(lang, o.audit, true, "audit-title")}
  </section>
</div>`;
  return layout({
    lang,
    title: `${tm.title} · ${o.team.name} · ${t.product}`,
    description: tm.sub,
    path: "/team/members",
    body,
    config: c,
    active: "team",
    noindex: true,
  });
}

export function joinHtml(
  lang: Lang,
  c: Config,
  o: {
    team: string;
    role: MemberRole;
    csrf: string;
    action: string;
    error?: string;
    values?: { username?: string; name?: string };
  },
): string {
  const t = STRINGS[lang];
  const tm = t.members;
  const err = o.error
    ? `<div class="flash err" role="alert" id="flash" tabindex="-1"><p id="join-error">${esc(o.error)}</p></div>`
    : "";
  const body = `<div class="wrap page-narrow">
  ${pageHead(t.team.eyebrow, `<bdi>${esc(tm.joinTitle(o.team))}</bdi>`, tm.joinSub(tm.roles[o.role]))}
  ${err}
  <form method="post" action="${esc(o.action)}" class="panel login-form join-form">
    ${csrfField(o.csrf)}
    <label for="name">${esc(tm.displayName)}</label>
    <input id="name" name="name" type="text" dir="auto" required maxlength="80" autocomplete="name" value="${esc(o.values?.name ?? "")}" autofocus>
    <label for="username">${esc(tm.username)}</label>
    <input id="username" name="username" type="text" dir="ltr" required minlength="3" maxlength="32" pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}" autocomplete="username" autocapitalize="none" spellcheck="false" aria-describedby="username-help" value="${esc(o.values?.username ?? "")}">
    <p class="form-help" id="username-help">${esc(tm.usernameHelp)}</p>
    <label for="password">${esc(tm.password)}</label>
    <input id="password" name="password" type="password" dir="ltr" required minlength="10" maxlength="200" autocomplete="new-password" aria-describedby="password-help">
    <p class="form-help" id="password-help">${esc(tm.passwordHelp)}</p>
    <label for="confirm">${esc(tm.confirm)}</label>
    <input id="confirm" name="confirm" type="password" dir="ltr" required minlength="10" maxlength="200" autocomplete="new-password">
    <button class="button" type="submit">${esc(tm.join)}</button>
  </form>
</div>`;
  return layout({
    lang,
    title: `${tm.joinTitle(o.team)} · ${t.product}`,
    description: tm.joinSub(tm.roles[o.role]),
    path: "/join",
    body,
    config: c,
    active: "team",
    noindex: true,
  });
}

// ---- admin ---------------------------------------------------------------------

export interface AdminTeamRow {
  id: string;
  name: string;
  backend: boolean;
  directory: boolean;
  permanent: boolean;
  quotaSites: number;
  quotaMb: number;
  customQuota: boolean;
  keyPrefix: string;
  liveSites: number;
  members: number;
  createdAt: string;
}

/** Section switch + sign-out, shown in the page heading like the team dashboard's tools. */
function adminTools(lang: Lang, active: "teams" | "sites", csrf: string): string {
  const t = STRINGS[lang];
  const href = (p: string) => localePath(lang, p);
  const cur = (k: string) => (k === active ? ' aria-current="page"' : "");
  return `<div class="head-tools"><nav class="segmented" aria-label="${esc(t.admin.tabsLabel)}"><a class="button small ghost" href="${href("/admin")}"${cur("teams")}>${esc(t.admin.teamsTab)}</a><a class="button small ghost" href="${href("/admin/sites")}"${cur("sites")}>${esc(t.admin.sitesTab)}</a></nav>${postForm(
    href("/logout"),
    csrf,
    `<button class="button small ghost" type="submit">${esc(t.common.signOut)}</button>`,
  )}</div>`;
}

export function adminTeamsHtml(
  lang: Lang,
  c: Config,
  o: { teams: AdminTeamRow[]; csrf: string; flash?: Flash | null; backendConfigured: boolean },
): string {
  const t = STRINGS[lang];
  const href = (p: string) => localePath(lang, p);
  const live = o.teams.reduce((n, x) => n + x.liveSites, 0);
  const rows = o.teams
    .map((tm) => {
      const base = `/admin/teams/${tm.id}`;
      // Same pattern as a site's "Listed / Hidden" on the team pages: a badge with
      // the state and one button that flips it.
      const toggle = (field: "backend" | "directory" | "permanent", label: string) =>
        `<div class="acts"><span class="badge ${tm[field] ? "on" : "muted"}">${esc(tm[field] ? t.common.on : t.common.off)}</span>${postForm(
          href(`${base}/update`),
          o.csrf,
          `<input type="hidden" name="${field}" value="${tm[field] ? "0" : "1"}"><button type="submit" class="button small ghost" aria-label="${esc(`${tm[field] ? t.admin.turnOff : t.admin.turnOn}: ${label} · ${tm.name}`)}">${esc(tm[field] ? t.admin.turnOff : t.admin.turnOn)}</button>`,
        )}</div>`;
      return `<tr>
        <th scope="row"><bdi>${esc(tm.name)}</bdi><div class="meta ltr">${esc(tm.id)}</div></th>
        ${td(t.admin.backend, toggle("backend", t.admin.backend))}
        ${td(t.admin.directory, toggle("directory", t.admin.directory))}
        ${td(t.admin.permanent, toggle("permanent", t.admin.permanent))}
        ${td(
          t.admin.quota,
          postForm(
            href(`${base}/update`),
            o.csrf,
            `<label class="quota-field"><span class="sr-only">${esc(`${t.admin.quotaSites} · ${tm.name}`)}</span><input name="maxSites" type="number" min="0" max="100000" inputmode="numeric" placeholder="${tm.quotaSites}" value="${tm.customQuota ? tm.quotaSites : ""}" aria-describedby="quota-help" title="${esc(t.admin.quotaSites)}"></label><label class="quota-field"><span class="sr-only">${esc(`${t.admin.quotaMb} · ${tm.name}`)}</span><input name="maxMb" type="number" min="0" max="100000" inputmode="numeric" placeholder="${tm.quotaMb}" value="${tm.customQuota ? tm.quotaMb : ""}" aria-describedby="quota-help" title="${esc(t.admin.quotaMb)}"></label><button type="submit" class="button small ghost">${esc(t.common.save)}</button>`,
            { cls: "inline-form quota-form" },
          ),
        )}
        ${td(t.admin.liveSites, `<a class="text-link" href="${href(`/admin/sites?owner=${tm.id}`)}">${esc(String(tm.liveSites))}</a>`)}
        ${td(
          t.members.title,
          `<div class="meta">${esc(t.members.count(tm.members))}</div>${postForm(
            href(`${base}/invite`),
            o.csrf,
            `<label class="sr-only" for="inv-${esc(tm.id)}">${esc(`${t.members.role} · ${tm.name}`)}</label><select id="inv-${esc(tm.id)}" name="role">${(["owner", "editor", "viewer"] as const).map((r) => `<option value="${r}">${esc(t.members.roles[r])}</option>`).join("")}</select><button type="submit" class="button small ghost">${esc(t.members.invite)}</button>`,
            { cls: "inline-form invite-form" },
          )}`,
        )}
        ${td(t.admin.key, `<code class="ltr">${esc(tm.keyPrefix)}…</code>`)}
        ${td(
          t.common.actions,
          `<div class="acts">${postForm(href(`${base}/rotate`), o.csrf, `<button class="button small ghost" type="submit">${esc(t.admin.rotate)}</button>`, { confirm: t.admin.confirmRotate })}${postForm(
            href(`${base}/delete`),
            o.csrf,
            `<label class="check small"><input type="checkbox" name="sites" value="delete"> ${esc(t.admin.alsoDeleteSites)}</label><button class="button small danger" type="submit">${esc(t.common.del)}</button>`,
            { confirm: t.admin.confirmDelete },
          )}</div>`,
          "cell-actions",
        )}
      </tr>`;
    })
    .join("");
  const table = o.teams.length
    ? `<div class="table-wrap"><table class="data stack">
      <caption class="sr-only">${esc(t.admin.teams)}</caption>
      <thead><tr><th scope="col">${esc(t.admin.name)}</th><th scope="col">${esc(t.admin.backend)}</th><th scope="col">${esc(t.admin.directory)}</th><th scope="col">${esc(t.admin.permanent)}</th><th scope="col">${esc(t.admin.quota)}</th><th scope="col">${esc(t.admin.liveSites)}</th><th scope="col">${esc(t.members.title)}</th><th scope="col">${esc(t.admin.key)}</th><th scope="col"><span class="sr-only">${esc(t.common.actions)}</span></th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <p class="meta table-note">${esc(t.admin.keyHelp)}</p>
      <p class="meta table-note" id="quota-help">${esc(`${t.admin.quotaSites} / ${t.admin.quotaMb}: ${t.admin.quotaHelp}`)}</p>`
    : emptyState(t.admin.none, t.admin.createSub);
  const body = `<div class="wrap page-wide">
  ${pageHead(t.admin.eyebrow, esc(t.admin.title), t.admin.sub, adminTools(lang, "teams", o.csrf))}
  ${flashBox(lang, o.flash)}
  <ul class="status-list">
    <li><span class="dot-status on" aria-hidden="true"></span><strong>${esc(t.admin.teams)}:</strong> ${esc(t.admin.teamsCount(o.teams.length))}</li>
    <li><span class="dot-status ${live ? "on" : "off"}" aria-hidden="true"></span>${esc(t.admin.liveTotal(live))}</li>
    <li><span class="dot-status ${o.backendConfigured ? "on" : "warn"}" aria-hidden="true"></span>${esc(o.backendConfigured ? t.admin.serverBackendOn : t.admin.serverBackendOff)}</li>
  </ul>
  <section class="block" aria-labelledby="teams-title">
    <h2 id="teams-title">${esc(t.admin.teams)}</h2>
    ${table}
  </section>
  <section class="block" aria-labelledby="create-title">
    <form method="post" action="${href("/admin/teams")}" class="panel">
      ${csrfField(o.csrf)}
      <h2 class="h3" id="create-title">${esc(t.admin.create)}</h2>
      <p>${esc(t.admin.createSub)}</p>
      <label for="teamName">${esc(t.admin.name)}</label>
      <input id="teamName" name="name" type="text" required maxlength="80" dir="auto">
      <div class="form-row checks-row">
        <label class="check"><input name="backend" type="checkbox" value="1"> ${esc(t.admin.backend)}</label>
        <label class="check"><input name="directory" type="checkbox" value="1" checked> ${esc(t.admin.directory)}</label>
        <label class="check"><input name="permanent" type="checkbox" value="1"> ${esc(t.admin.permanent)}</label>
      </div>
      <button class="button" type="submit">${esc(t.admin.create)}</button>
    </form>
  </section>
  <section class="block two-col" aria-labelledby="how-title">
    <div>
      <h2 id="how-title">${esc(t.admin.howTitle)}</h2>
      <ul class="checks">${t.admin.how.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      <div class="actions"><a class="text-link" href="/docs/teams">${esc(t.admin.docsLink)}</a></div>
    </div>
    <pre class="code" dir="ltr"><code># MARSA_TEAM_KEY=marsa_team_…   (keep it secret)
curl -s -X POST "${esc(c.publicUrl)}/api/sites" \\
  -H "X-Team-Key: $MARSA_TEAM_KEY" \\
  -H "Content-Type: application/zip" --data-binary @site.zip

# Team members sign in at:
# ${esc(c.publicUrl)}${esc(localePath(lang, "/login"))}</code></pre>
  </section>
</div>`;
  return layout({
    lang,
    title: `${t.admin.title} · ${t.admin.eyebrow} · ${t.product}`,
    description: t.admin.sub,
    path: "/admin",
    body,
    config: c,
    noindex: true,
  });
}

export interface AdminSiteRow {
  id: string;
  title: string;
  url: string;
  owner: string | null;
  ownerId: string | null;
  createdAt: string;
  expiresAt: string;
  totalBytes: number;
  permanent: boolean;
  visits?: VisitSummary;
}

export function adminSitesHtml(
  lang: Lang,
  c: Config,
  o: {
    sites: AdminSiteRow[];
    teams: { id: string; name: string }[];
    owner: string;
    csrf: string;
    flash?: Flash | null;
  },
): string {
  const t = STRINGS[lang];
  const href = (p: string) => localePath(lang, p);
  const opt = (v: string, label: string) =>
    `<option value="${esc(v)}"${o.owner === v ? " selected" : ""}>${esc(label)}</option>`;
  const total = o.sites.reduce((n, s) => n + s.totalBytes, 0);
  const guests = o.sites.filter((s) => !s.owner).length;
  const perms = o.sites.filter((s) => s.permanent).length;
  const views30 = o.sites.reduce((n, s) => n + (s.visits?.views30 ?? 0), 0);
  const counting = o.sites.some((s) => s.visits);
  const rows = o.sites
    .map(
      (s) => `<tr>
      <th scope="row"><bdi>${esc(s.title)}</bdi></th>
      ${td(t.admin.owner, s.owner ? `<a class="text-link" href="${href(`/admin/sites?owner=${s.ownerId}`)}"><bdi>${esc(s.owner)}</bdi></a>` : `<span class="badge muted">${esc(t.common.guest)}</span>`)}
      ${td(t.common.link, `<a href="${esc(s.url)}" target="_blank" rel="noopener" class="url">${ltr(hostless(s.url))}</a>`)}
      ${td(t.common.expires, timeTag(lang, s.expiresAt))}
      ${td(t.common.size, esc(bytesLabel(lang, s.totalBytes)))}
      ${td(t.visits.column, visitsCell(lang, s.visits))}
      ${td(
        t.common.actions,
        `<div class="acts">${postForm(
          href(`/admin/sites/${s.id}/delete`),
          o.csrf,
          `<input type="hidden" name="owner" value="${esc(o.owner)}"><button class="button small danger" type="submit">${esc(t.common.del)}</button>`,
          { confirm: t.team.confirmDelete },
        )}${
          s.permanent
            ? postForm(
                href(`/admin/sites/${s.id}/permanent`),
                o.csrf,
                `<input type="hidden" name="owner" value="${esc(o.owner)}"><input type="hidden" name="permanent" value="0"><button class="button small ghost" type="submit">${esc(t.admin.revoke)}</button>`,
                { confirm: t.common.confirm },
              )
            : ""
        }</div>`,
        "cell-actions",
      )}</tr>`,
    )
    .join("");
  const body = `<div class="wrap page-wide">
  ${pageHead(t.admin.eyebrow, esc(t.admin.sitesTitle), t.admin.sitesSub, adminTools(lang, "sites", o.csrf))}
  ${flashBox(lang, o.flash)}
  <ul class="status-list">
    <li><span class="dot-status ${o.sites.length ? "on" : "off"}" aria-hidden="true"></span><strong>${esc(t.admin.sitesTab)}:</strong> ${esc(t.admin.total(o.sites.length, bytesLabel(lang, total)))}</li>
    <li><span class="dot-status on" aria-hidden="true"></span>${esc(t.admin.liveTotal(o.sites.length - guests))}</li>
    <li><span class="dot-status ${guests ? "warn" : "off"}" aria-hidden="true"></span>${esc(t.admin.guestsCount(guests))}</li>
    <li><span class="dot-status ${perms ? "on" : "off"}" aria-hidden="true"></span>${esc(t.admin.permanentCount(perms))}</li>
    ${counting ? `<li><span class="dot-status ${views30 ? "on" : "off"}" aria-hidden="true"></span>${esc(t.visits.adminTotal(fmt(lang, views30)))}</li>` : ""}
  </ul>
  <section class="block" aria-labelledby="sites-title">
    <h2 id="sites-title" class="sr-only">${esc(t.admin.sitesTitle)}</h2>
    <form method="get" action="${href("/admin/sites")}" class="panel filter-panel">
      <div class="form-row">
        <label for="owner">${esc(t.admin.filter)}</label>
        <select id="owner" name="owner">${opt("all", t.admin.all)}${opt("guest", t.admin.guests)}${opt("permanent", t.admin.permanentFilter)}${o.teams.map((x) => opt(x.id, x.name)).join("")}</select>
        <button class="button small" type="submit">${esc(t.admin.apply)}</button>
      </div>
    </form>
    ${
      o.sites.length
        ? `<div class="table-wrap"><table class="data stack">
      <caption class="sr-only">${esc(t.admin.sitesTitle)}</caption>
      <thead><tr><th scope="col">${esc(t.common.title)}</th><th scope="col">${esc(t.admin.owner)}</th><th scope="col">${esc(t.common.link)}</th><th scope="col">${esc(t.common.expires)}</th><th scope="col">${esc(t.common.size)}</th><th scope="col">${esc(t.visits.column)}</th><th scope="col"><span class="sr-only">${esc(t.common.actions)}</span></th></tr></thead>
      <tbody>${rows}</tbody></table></div>`
        : emptyState(t.admin.noSites, t.admin.sitesSub)
    }
  </section>
</div>`;
  return layout({
    lang,
    title: `${t.admin.sitesTitle} · ${t.admin.eyebrow} · ${t.product}`,
    description: t.admin.sitesSub,
    path: "/admin/sites",
    body,
    config: c,
    noindex: true,
  });
}

// ---- docs ------------------------------------------------------------------------

function docsNav(lang: Lang, docs: DocPage[], current?: string): string {
  const t = STRINGS[lang];
  const list = [...docs].sort((a, b) => (a.lang === lang ? -1 : 0) - (b.lang === lang ? -1 : 0));
  return `<nav class="docs-nav" aria-label="${esc(t.docs.title)}"><ul>${list
    .map((d) => {
      const url = d.lang === "ar" ? `/ar/docs/${d.slug}` : `/docs/${d.slug}`;
      const note =
        d.lang !== lang && lang === "ar"
          ? ` <span class="meta">${esc(t.docs.englishOnly)}</span>`
          : "";
      return `<li><a href="${url}" lang="${d.lang}" dir="${d.lang === "ar" ? "rtl" : "ltr"}"${d.slug === current ? ' aria-current="page"' : ""}>${esc(d.title)}</a>${note}</li>`;
    })
    .join("")}</ul></nav>`;
}

export function docsIndexHtml(lang: Lang, c: Config, docs: DocPage[]): string {
  const t = STRINGS[lang];
  const list = [...docs].sort((a, b) => (a.lang === lang ? -1 : 0) - (b.lang === lang ? -1 : 0));
  const body = `<div class="wrap page-wide">${pageHead(t.footer.product, esc(t.docs.title), t.docs.sub)}
<div class="card-grid docs-grid">${list
    .map((d) => {
      const url = d.lang === "ar" ? `/ar/docs/${d.slug}` : `/docs/${d.slug}`;
      const note =
        d.lang !== lang && lang === "ar"
          ? `<span class="meta">${esc(t.docs.englishOnly)}</span>`
          : "";
      return `<a class="card doc-card" href="${url}" lang="${d.lang}" dir="${d.lang === "ar" ? "rtl" : "ltr"}"><h2 class="h3">${esc(d.title)}</h2><p>${esc(d.summary)}</p>${note}</a>`;
    })
    .join("")}
  <a class="card doc-card" href="/llms.txt" lang="en" dir="ltr"><h2 class="h3">llms.txt</h2><p>Plain-text instructions for AI agents.</p></a>
  <a class="card doc-card" href="/openapi.json" lang="en" dir="ltr"><h2 class="h3">OpenAPI</h2><p>Machine-readable API spec (OpenAPI 3.1).</p></a>
</div></div>`;
  return layout({
    lang,
    title: `${t.docs.title} · ${t.product}`,
    description: t.docs.sub,
    path: "/docs",
    body,
    config: c,
    active: "docs",
  });
}

export function docPageHtml(lang: Lang, c: Config, doc: DocPage, docs: DocPage[]): string {
  const t = STRINGS[lang];
  const docDir = doc.lang === "ar" ? "rtl" : "ltr";
  const body = `<div class="wrap docs-layout">
  <aside>${docsNav(lang, docs, doc.slug)}<p><a class="text-link" href="${localePath(lang, "/docs")}">${esc(t.docs.back)}</a></p></aside>
  <article class="prose" lang="${doc.lang}" dir="${docDir}"><h1>${esc(doc.title)}</h1>${doc.html}</article>
</div>`;
  return layout({
    lang,
    title: `${doc.title} · ${t.product}`,
    description: doc.summary,
    path: `/docs/${doc.slug}`,
    body,
    config: c,
    active: "docs",
  });
}

// ---- messages --------------------------------------------------------------------

export function messageHtml(
  lang: Lang,
  c: Config,
  code: string,
  title: string,
  sub: string,
  action?: { href: string; label: string },
): string {
  const t = STRINGS[lang];
  const a = action ?? { href: localePath(lang, "/"), label: t.home };
  return layout({
    lang,
    title: `${code} · ${t.product}`,
    description: title,
    path: "/",
    body: `<div class="wrap result-panel"><p class="big-code" aria-hidden="true">${esc(code)}</p><h1>${esc(title)}</h1><p>${esc(sub)}</p><div class="actions"><a class="button" href="${esc(a.href)}">${esc(a.label)}</a><a class="text-link" href="${localePath(lang, "/docs")}">${esc(t.nav.docs)}</a></div></div>`,
    config: c,
    noindex: true,
  });
}

export const notFoundHtml = (lang: Lang, c: Config) =>
  messageHtml(lang, c, "404", STRINGS[lang].notFound, STRINGS[lang].notFoundSub);
export const goneHtml = (lang: Lang, c: Config) =>
  messageHtml(lang, c, "410", STRINGS[lang].gone, STRINGS[lang].goneSub);

export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="13" fill="#145a49"/><text x="32" y="44" text-anchor="middle" font-family="Tahoma,sans-serif" font-size="48" fill="#f6faf7">م</text></svg>`;
