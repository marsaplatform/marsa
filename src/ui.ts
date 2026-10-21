import type { AgentInviteView, AgentKeyView } from "./agent-keys.js";
import { EXPIRY_MAX_DAYS, SCOPES } from "./agent-keys.js";
import { ASSET_VERSION } from "./assets.js";
import { PLATFORM_URL } from "./brand.js";
import type { Config, Operator } from "./config.js";
import { hashIndex, initialOf } from "./cover.js";
import { type DocPage, docsFor } from "./docs.js";
import {
  actorText,
  bytesLabel,
  detailText,
  hoursLabel,
  type Lang,
  type LimitValues,
  STRINGS,
} from "./i18n.js";
import type { MemberRole } from "./members.js";
import { currentNavAccount } from "./nav-state.js";
import { type Notice, noticeText, noticeTone, type WebhookView } from "./notify.js";
import type { Recipe, RecipeSummary } from "./recipes.js";
import type { RepoLink, RepoStatus } from "./repo-status.js";
import { isPermanentIso } from "./store.js";
import {
  agentKeyCols,
  agentKeyRows,
  healthFilter,
  keyStateFilter,
  memberCols,
  memberRows,
  roleFilter,
  siteStatusFilter,
  siteRows as siteTableRows,
  workerRows,
  workerStatusFilter,
} from "./ui-detail.js";
import { type InsightRow, kindFilter, languageFilter, repoFilter } from "./ui-insight.js";
import { dataTable, relTime as relTimeTag } from "./ui-table.js";
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

/**
 * 0.16.0: times render in the instance's display time zone (DISPLAY_TZ, default
 * Asia/Dubai) with the zone named; the page script then swaps in the visitor's own zone.
 */
let displayTz = "Asia/Dubai";
export function setDisplayTimeZone(tz: string): void {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    displayTz = tz;
  } catch {
    // keep the default
  }
}
export const displayTimeZone = () => displayTz;

export type TimeFmt = "full" | "hour" | "day" | "hm";
/** A time in the display zone: "full" date+time, "hour" (14 Oct 13:00), "day", "hm" (13:05). */
export function fmtTime(lang: Lang, t: string | number, f: TimeFmt = "full"): string {
  const opts: Intl.DateTimeFormatOptions =
    f === "full"
      ? { dateStyle: "medium", timeStyle: "short" }
      : f === "hour"
        ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
        : f === "day"
          ? { day: "numeric", month: "short" }
          : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", {
    ...opts,
    timeZone: displayTz,
  }).format(new Date(t));
}
/** The display zone's short name at that moment ("GMT+4"). */
export function tzName(lang: Lang, t: string | number): string {
  const parts = new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", {
    timeZone: displayTz,
    timeZoneName: "shortOffset",
  }).formatToParts(new Date(t));
  return parts.find((p) => p.type === "timeZoneName")?.value ?? displayTz;
}

export function timeTag(lang: Lang, iso: string): string {
  if (isPermanentIso(iso)) {
    return `<span class="badge on perm">${esc(STRINGS[lang].team.permanent)}</span>`;
  }
  const d = new Date(iso);
  return `<time datetime="${esc(d.toISOString())}" data-local>${esc(fmtTime(lang, d.getTime()))} ${esc(tzName(lang, d.getTime()))}</time>`;
}

export const ltr = (s: string) => `<span dir="ltr" class="ltr">${esc(s)}</span>`;
export const hostless = (url: string) => url.replace(/^https?:\/\//, "");

/** "Expires <time>", or just "Permanent". */
function expiryLine(lang: Lang, iso: string): string {
  return isPermanentIso(iso)
    ? timeTag(lang, iso)
    : `${esc(STRINGS[lang].directory.expires)} ${timeTag(lang, iso)}`;
}

export function ttlOptions(
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
      <a href="${href("/privacy")}">${esc(V14[o.lang].privacy)}</a>
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

export function flashBox(lang: Lang, f?: Flash | null): string {
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

export const csrfField = (token: string) =>
  `<input type="hidden" name="_csrf" value="${esc(token)}">`;

export function postForm(
  action: string,
  csrf: string,
  inner: string,
  opts: { confirm?: string; cls?: string } = {},
): string {
  return `<form method="post" action="${esc(action)}" class="${opts.cls ?? "inline-form"}"${opts.confirm ? ` data-confirm="${esc(opts.confirm)}"` : ""}>${csrfField(csrf)}${inner}</form>`;
}

export function pageHead(eyebrow: string, title: string, sub: string, aside = ""): string {
  return `<div class="page-heading${aside ? " with-aside" : ""}"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${title}</h1>${sub ? `<p>${esc(sub)}</p>` : ""}</div>${aside}</div>`;
}

export const td = (label: string, inner: string, cls = "") =>
  `<td data-label="${esc(label)}"${cls ? ` class="${cls}"` : ""}>${inner}</td>`;

export function emptyState(title: string, sub: string, action = ""): string {
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

export const fmt = (lang: Lang, n: number) =>
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
  return `<pre tabindex="0" class="code" dir="ltr"><code>(cd out &amp;&amp; zip -qr ../site.zip .)
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
  <pre tabindex="0" class="code" dir="ltr"><code>docker compose up -d --build
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
  <p class="meta login-foot">${team ? `${esc(t.login.noKey)} · <a class="text-link" href="${localePath(lang, "/admin/login")}">${esc(t.login.adminLink)}</a>` : `<a class="text-link" href="${localePath(lang, "/login")}">${esc(t.login.title)}</a>`} · <a class="text-link" href="${localePath(lang, "/privacy")}">${esc(V14[lang].privacy)}</a></p>
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
  /** 0.15.1: linked source repo and its cached GitHub status. */
  repo?: RepoLink | null;
  repoStatus?: RepoStatus | null;
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

export function visitsCell(lang: Lang, v: VisitSummary | undefined): string {
  if (!v) return `<span class="meta">–</span>`;
  const t = STRINGS[lang];
  return `<div class="visits-cell">${sparkline(lang, v)}<span class="meta">${esc(t.visits.short(fmt(lang, v.views7), fmt(lang, v.views30)))}</span></div>`;
}

export function visitsSection(lang: Lang, v: VisitSummary | undefined): string {
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

export const canEdit = (me?: MeView) => (me?.role ?? "owner") !== "viewer";

export function auditTable(
  lang: Lang,
  rows: AuditView[],
  withSite: boolean,
  labelId: string,
): string {
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
      return `<tr><td data-label="${esc(t.members.when)}">${timeTag(lang, e.at)}</td>${td(t.members.who, `<bdi>${esc(e.kind === "member" ? e.who : actorText(lang, e.who))}</bdi> <span class="badge muted">${esc(t.members.actorKinds[e.kind])}</span>`)}${td(t.members.what, `${esc(what)}${e.detail ? ` <span class="meta">${/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(e.detail) ? timeTag(lang, e.detail) : `<bdi>${esc(detailText(lang, e.detail))}</bdi>`}</span>` : ""}${site}`)}</tr>`;
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
  _o: { team: TeamPageOpts["team"]; csrf: string; me?: MeView },
  sub = "",
  active = "overview",
  actions = "",
): string {
  const t = STRINGS[lang];
  return pageHead(
    t.team.eyebrow,
    esc(DS[lang].nav[active] ?? active),
    sub,
    `<div class="head-tools">${actions}</div>`,
  );
}

/** Sidebar context for a team page: the team name and who is signed in. */
export function teamCtx(lang: Lang, o: { team: { name: string }; me?: MeView }): DashCtx {
  const t = STRINGS[lang];
  return {
    name: o.team.name,
    sub: o.me
      ? t.members.signedInAs(
          o.me.viaKey ? t.members.viaKey : o.me.name,
          o.me.viaKey ? t.members.roles.owner : t.members.roles[o.me.role],
        )
      : "",
  };
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

export function teamUploader(
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

function sitesTable(lang: Lang, o: TeamPageOpts, sites: TeamSiteRow[], id: string, tools: boolean) {
  const t = STRINGS[lang];
  const href = (p: string) => localePath(lang, p);
  const { rows, cols } = siteTableRows(lang, sites, {
    detail: (s) => href(`/team/sites/${s.id}`),
    canEdit: canEdit(o.me),
    deleteAction: (s) => href(`/team/sites/${s.id}/delete`),
    showListing: o.team.directory,
  });
  return dataTable({
    lang,
    id,
    caption: t.team.sites,
    headLabel: t.common.title,
    cols,
    rows,
    csrf: o.csrf,
    empty: t.team.sites,
    filters: [siteStatusFilter(lang), repoFilter(lang, sites)],
    search: tools && sites.length > 3,
  });
}

/** Compact list of the newest spaces for the overview (title + address, expiry, visits). */
function recentTable(lang: Lang, sites: TeamSiteRow[]): string {
  const t = STRINGS[lang];
  const href = (p: string) => localePath(lang, p);
  return dataTable({
    lang,
    id: "recent-spaces",
    caption: t.team.sites,
    headLabel: t.common.title,
    cols: [
      { label: t.common.expires, sort: "date" },
      { label: t.visits.column, sort: "num" },
    ],
    rows: sites.map((s) => ({
      label: s.title,
      href: href(`/team/sites/${s.id}`),
      head: `<a class="row-link" href="${href(`/team/sites/${s.id}`)}"><bdi>${esc(s.title)}</bdi></a><div class="meta">${ltr(hostless(s.url))}</div>`,
      cells: [
        { html: timeTag(lang, s.expiresAt), v: isPermanentIso(s.expiresAt) ? "9999" : s.expiresAt },
        { html: visitsCell(lang, s.visits), v: s.visits?.views30 ?? 0 },
      ],
      actions: [
        { kind: "link", label: t.team.manage, href: href(`/team/sites/${s.id}`), primary: true },
        { kind: "copy", label: t.common.copy, value: s.url, primary: true },
        { kind: "link", label: t.team.openSite, href: s.url, external: true },
      ],
    })),
    empty: t.team.sites,
    search: false,
    cls: "recent-table",
  });
}

const agentPublishSnippet = (
  c: Config,
) => `<pre tabindex="0" class="code" dir="ltr"><code># MARSA_TEAM_KEY=marsa_team_…   (keep it secret)
(cd out &amp;&amp; zip -qr ../site.zip .)
curl -s -X POST "${esc(c.publicUrl)}/api/sites?ttlHours=72" \\
  -H "X-Team-Key: $MARSA_TEAM_KEY" \\
  -H "Content-Type: application/zip" --data-binary @site.zip

# Agent prompt:
# Read ${esc(c.publicUrl)}/llms.txt, publish ./out with the
# X-Team-Key header from $MARSA_TEAM_KEY, and reply with the URL.</code></pre>`;

export interface TeamOverview {
  audit: AuditView[];
  members: number;
  invites: number;
  workers: { enabled: boolean; count: number; max: number };
  /** 0.16.0: getting-started steps; unset or empty = hidden (dismissed). */
  checklist?: ChecklistStep[];
}

/** Team overview: stat cards, recent spaces, quick publish and recent activity. */
export function teamHtml(
  lang: Lang,
  c: Config,
  o: TeamPageOpts & { overview?: TeamOverview },
): string {
  const t = STRINGS[lang];
  const d = DS[lang];
  const href = (p: string) => localePath(lang, p);
  const ov = o.overview ?? {
    audit: [],
    members: 0,
    invites: 0,
    workers: { enabled: false, count: 0, max: 0 },
  };
  const v30 = o.sites.reduce((n, s) => n + (s.visits?.views30 ?? 0), 0);
  const v7 = o.sites.reduce((n, s) => n + (s.visits?.views7 ?? 0), 0);
  const counting = o.sites.some((s) => s.visits);
  const cards = `<div class="stat-grid">
    ${statCard("sites", d.stats.spaces, esc(fmt(lang, o.usage.sites)), esc(d.stats.of(fmt(lang, o.usage.sites), fmt(lang, o.quota.sites))), { value: o.usage.sites, max: o.quota.sites }, href("/team/sites"))}
    ${statCard("storage", d.stats.storage, esc(bytesLabel(lang, o.usage.bytes)), esc(d.stats.of(bytesLabel(lang, o.usage.bytes), bytesLabel(lang, o.quota.bytes))), { value: o.usage.bytes, max: o.quota.bytes })}
    ${counting ? statCard("views", d.stats.views, esc(fmt(lang, v30)), esc(d.stats.views7(fmt(lang, v7))), undefined, href("/team/sites")) : ""}
    ${statCard("members", d.stats.members, esc(fmt(lang, ov.members)), ov.invites ? esc(d.stats.invites(ov.invites)) : "", undefined, href("/team/members"))}
    ${
      ov.workers.enabled
        ? statCard(
            "workers",
            d.stats.workers,
            esc(fmt(lang, ov.workers.count)),
            esc(d.stats.of(fmt(lang, ov.workers.count), fmt(lang, ov.workers.max))),
            { value: ov.workers.count, max: ov.workers.max },
            href("/team/workers"),
          )
        : statCard(
            "workers",
            d.stats.workers,
            "—",
            esc(d.stats.workersOff),
            undefined,
            href("/team/workers"),
          )
    }
  </div>`;
  const edit = canEdit(o.me);
  const actions = edit
    ? `<a class="button small" href="#publish">${icon("plus")}${esc(d.publish)}</a>${ov.workers.enabled ? `<a class="button small ghost" href="${href("/team/workers#deploy")}">${esc(d.deploy)}</a>` : ""}${(o.me?.role ?? "owner") === "owner" ? `<a class="button small ghost" href="${href("/team/members#invite")}">${esc(d.invite)}</a>` : ""}`
    : "";
  const recent = [...o.sites].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
  const body = `<div class="page-wide">
  ${teamHead(lang, o, d.overviewSub, "overview", actions)}
  ${flashBox(lang, o.flash)}
  ${ov.checklist ? checklistHtml(lang, ov.checklist, { csrf: o.csrf, canDismiss: (o.me?.role ?? "owner") === "owner" }) : ""}
  ${cards}
  ${statusList(lang, o)}
  <div class="dash-cols">
    <section aria-labelledby="sites-title" class="card-block">
      <div class="block-head"><h2 id="sites-title">${esc(d.recentSpaces)}</h2>${o.sites.length > recent.length ? `<a class="text-link" href="${href("/team/sites")}">${esc(d.viewAll)} (${fmt(lang, o.sites.length)})</a>` : ""}</div>
      ${recent.length ? recentTable(lang, recent) : emptyState(t.team.empty, t.team.emptySub, edit ? `<a class="button" href="#publish">${esc(d.publish)}</a>` : "")}
    </section>
    <section aria-labelledby="act-title" class="card-block">
      <div class="block-head"><h2 id="act-title">${esc(d.recentActivity)}</h2><a class="text-link" href="${href("/team/activity")}">${esc(d.viewAll)}</a></div>
      ${activityFeed(lang, ov.audit)}
    </section>
  </div>
  ${
    edit
      ? `<section id="publish" aria-label="${esc(t.team.publishTitle)}" class="block">
    ${teamUploader(lang, c, o.csrf, href("/team/sites"), t.team.publishTitle, t.team.publishSub, t.team.publish, true, false, o.team.permanent)}
  </section>`
      : ""
  }
</div>`;
  return dashLayout({
    lang,
    config: c,
    kind: "team",
    active: "overview",
    title: `${d.overview} · ${o.team.name} · ${t.product}`,
    description: t.team.eyebrow,
    path: "/team",
    body,
    csrf: o.csrf,
    ctx: teamCtx(lang, o),
  });
}

/** All of the team's spaces, with search and sort, the uploader and the agent snippet. */
export function teamSitesHtml(lang: Lang, c: Config, o: TeamPageOpts): string {
  const t = STRINGS[lang];
  const d = DS[lang];
  const href = (p: string) => localePath(lang, p);
  const edit = canEdit(o.me);
  const body = `<div class="page-wide">
  ${teamHead(lang, o, t.team.sitesCount(o.sites.length), "sites", edit ? `<a class="button small" href="#publish">${icon("plus")}${esc(d.publish)}</a>` : "")}
  ${flashBox(lang, o.flash)}
  ${statusList(lang, o)}
  <section aria-labelledby="sites-title" class="block">
    <h2 id="sites-title" class="sr-only">${esc(t.team.sites)}</h2>
    ${o.sites.length ? sitesTable(lang, o, o.sites, "sites-table", true) : emptyState(t.team.empty, t.team.emptySub, edit ? `<a class="button" href="#publish">${esc(d.publish)}</a>` : "")}
  </section>
  ${
    edit
      ? `<section id="publish" aria-label="${esc(t.team.publishTitle)}" class="block">
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
    ${agentPublishSnippet(c)}
  </section>
</div>`;
  return dashLayout({
    lang,
    config: c,
    kind: "team",
    active: "sites",
    title: `${d.nav.sites} · ${o.team.name} · ${t.product}`,
    description: t.team.eyebrow,
    path: "/team/sites",
    body,
    csrf: o.csrf,
    ctx: teamCtx(lang, o),
  });
}

/** The team's full activity log, with filters. */
export function teamActivityHtml(
  lang: Lang,
  c: Config,
  o: TeamPageOpts & { audit: AuditView[]; kind: string; q: string },
): string {
  const t = STRINGS[lang];
  const d = DS[lang];
  const href = (p: string) => localePath(lang, p);
  const kinds = ["member", "key", "api", "mcp", "admin"] as const;
  const filter = `<form method="get" action="${href("/team/activity")}" class="filters" role="search">
    <label><span>${esc(d.search)}</span><input type="search" name="q" value="${esc(o.q)}" placeholder="${esc(d.searchPh)}"></label>
    <label><span>${esc(d.who)}</span><select name="kind"><option value="">${esc(d.everyone)}</option>${kinds.map((k) => `<option value="${k}"${o.kind === k ? " selected" : ""}>${esc(t.members.actorKinds[k])}</option>`).join("")}</select></label>
    <button class="button small" type="submit">${esc(d.filter)}</button>${o.q || o.kind ? `<a class="text-link" href="${href("/team/activity")}">${esc(d.reset)}</a>` : ""}
  </form>${activityDownloads(lang, href("/team/activity/export"))}`;
  const body = `<div class="page-wide">
  ${teamHead(lang, o, d.activitySub, "activity")}
  ${flashBox(lang, o.flash)}
  <section class="block" aria-labelledby="audit-title">
    <h2 id="audit-title" class="sr-only">${esc(d.activity)}</h2>
    ${filter}
    <p class="meta">${esc(d.shown(o.audit.length))}</p>
    ${auditTable(lang, o.audit, true, "audit-title")}
  </section>
</div>`;
  return dashLayout({
    lang,
    config: c,
    kind: "team",
    active: "activity",
    title: `${d.activity} · ${o.team.name} · ${t.product}`,
    description: d.activitySub,
    path: "/team/activity",
    body,
    csrf: o.csrf,
    ctx: teamCtx(lang, o),
  });
}

/** Team settings: details, features, quotas, API access and the signed-in member's account. */
export function teamSettingsHtml(
  lang: Lang,
  c: Config,
  o: TeamPageOpts & {
    meId: string | null;
    keyPrefix: string;
    slug: string | null;
    workers: { enabled: boolean; count: number; max: number; kb: number };
    /** 0.16.0: owner-only panels (sign the whole team out). */
    extra?: string;
  },
): string {
  const t = STRINGS[lang];
  const d = DS[lang];
  const tm = t.members;
  const href = (p: string) => localePath(lang, p);
  const onOff = (on: boolean, label: string) =>
    `<li><span class="badge ${on ? "on" : "muted"}">${esc(on ? d.on : d.off)}</span> ${esc(label)}</li>`;
  const bar = (label: string, used: number, max: number, text: string) => {
    const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
    return `<div class="quota-row"><div class="quota-label"><span>${esc(label)}</span><span class="meta">${esc(text)}</span></div><progress class="quota${pct >= 90 ? " full" : pct >= 70 ? " high" : ""}" max="100" value="${pct}" aria-label="${esc(`${label}: ${pct}%`)}">${pct}%</progress></div>`;
  };
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
  const body = `<div class="page-wide">
  ${teamHead(lang, o, d.settingsSub, "settings")}
  ${flashBox(lang, o.flash)}
  <div class="card-grid">
    <section class="card-block" aria-labelledby="ti-title">
      <h2 id="ti-title" class="h3">${esc(d.teamInfo)}</h2>
      <dl class="facts">
        <div><dt>${esc(d.name)}</dt><dd><bdi>${esc(o.team.name)}</bdi></dd></div>
        <div><dt>${esc(d.id)}</dt><dd><code class="ltr">${esc(o.team.id)}</code></dd></div>
        <div><dt>${esc(d.slug)}</dt><dd>${o.slug ? `<code class="ltr">${esc(o.slug)}</code>` : "—"}</dd></div>
      </dl>
    </section>
    <section class="card-block" aria-labelledby="tf-title">
      <h2 id="tf-title" class="h3">${esc(d.features)}</h2>
      <ul class="feature-list">
        ${onOff(o.team.backend, t.team.backend)}
        ${onOff(o.team.directory, t.admin.directory)}
        ${onOff(o.team.permanent, t.admin.permanent)}
        ${onOff(o.workers.enabled, d.nav.workers ?? "Workers")}
      </ul>
    </section>
    <section class="card-block" aria-labelledby="tq-title">
      <h2 id="tq-title" class="h3">${esc(d.quotas)}</h2>
      ${bar(d.stats.spaces, o.usage.sites, o.quota.sites, d.stats.of(fmt(lang, o.usage.sites), fmt(lang, o.quota.sites)))}
      ${bar(d.stats.storage, o.usage.bytes, o.quota.bytes, d.stats.of(bytesLabel(lang, o.usage.bytes), bytesLabel(lang, o.quota.bytes)))}
      ${o.workers.enabled ? bar(d.stats.workers, o.workers.count, o.workers.max, d.stats.of(fmt(lang, o.workers.count), fmt(lang, o.workers.max))) : ""}
    </section>
    <section class="card-block" aria-labelledby="tk-title">
      <h2 id="tk-title" class="h3">${esc(d.api)}</h2>
      <p>${esc(d.apiNote(o.keyPrefix))}</p>
      <div class="actions"><a class="text-link" href="/docs/api">API</a><a class="text-link" href="${href("/team/workers")}">${esc(d.nav.workers ?? "")}</a></div>
    </section>
  </div>
  ${account}
  ${o.extra ?? ""}
</div>`;
  return dashLayout({
    lang,
    config: c,
    kind: "team",
    active: "settings",
    title: `${d.settings} · ${o.team.name} · ${t.product}`,
    description: d.settingsSub,
    path: "/team/settings",
    body,
    csrf: o.csrf,
    ctx: teamCtx(lang, o),
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

export function mcpSection(
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
      <div><p class="snippet-label">Cursor · <code>.cursor/mcp.json</code></p><pre tabindex="0" class="code" dir="ltr"><code>{
  "mcpServers": {
    "${esc(server)}": {
      "url": "${ep}",
      "headers": { "Authorization": "Bearer marsa_mcp_…" }
    }
  }
}</code></pre></div>
      <div><p class="snippet-label">Claude Code</p><pre tabindex="0" class="code" dir="ltr"><code>claude mcp add --transport http ${esc(server)} \\
  ${ep} \\
  --header "Authorization: Bearer marsa_mcp_…"</code></pre>
      <p class="snippet-label">VS Code · <code>.vscode/mcp.json</code></p><pre tabindex="0" class="code" dir="ltr"><code>{ "servers": { "${esc(server)}": {
  "type": "http", "url": "${ep}",
  "headers": { "Authorization": "Bearer marsa_mcp_…" } } } }</code></pre>
      <p class="snippet-label">Claude Desktop · <code>claude_desktop_config.json</code> (mcp-remote)</p><pre tabindex="0" class="code" dir="ltr"><code>{ "mcpServers": { "${esc(server)}": {
  "command": "npx",
  "args": ["-y", "mcp-remote", "${ep}",
           "--header", "Authorization:\${AUTH_HEADER}"],
  "env": { "AUTH_HEADER": "Bearer marsa_mcp_…" } } } }</code></pre></div>
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
  const people = dataTable({
    lang,
    id: "members-table",
    caption: tm.listTitle,
    headLabel: tm.nameCol,
    cols: memberCols(lang),
    rows: memberRows(lang, o.members, {
      canManage: owner,
      selfId: o.meId ?? null,
      roleAction: (m) => href(`/team/members/${m.id}/role`),
      removeAction: (m) => href(`/team/members/${m.id}/delete`),
    }),
    csrf: o.csrf,
    empty: tm.none,
    filters: [roleFilter(lang)],
  });
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
    ? `<section class="block" id="invite" aria-labelledby="invites-title">
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
  const d = DS[lang];
  const account = o.meId
    ? `<p class="notice">${esc(tm.accountTitle)}: <a class="text-link" href="${href("/team/settings")}">${esc(d.settings)}</a></p>`
    : `<p class="notice">${esc(tm.keyAccount)}</p>`;
  const body = `<div class="page-wide">
  ${teamHead(lang, o, tm.count(o.members.length), "members", owner ? `<a class="button small" href="#invite">${icon("plus")}${esc(d.invite)}</a>` : "")}
  ${flashBox(lang, o.flash)}
  <section class="block" aria-labelledby="people-title">
    <h2 id="people-title">${esc(tm.listTitle)} <span class="count">${esc(tm.count(o.members.length))}</span></h2>
    ${people}
  </section>
  ${invites}
  ${account}
  <section class="block audit-block" aria-labelledby="audit-title">
    <div class="block-head"><h2 id="audit-title">${esc(tm.auditTitle)}</h2><a class="text-link" href="${href("/team/activity")}">${esc(d.viewAll)}</a></div>
    ${auditTable(lang, o.audit.slice(0, 20), true, "audit-title")}
  </section>
</div>`;
  return dashLayout({
    lang,
    config: c,
    kind: "team",
    active: "members",
    title: `${tm.title} · ${o.team.name} · ${t.product}`,
    description: tm.sub,
    path: "/team/members",
    body,
    csrf: o.csrf,
    ctx: teamCtx(lang, o),
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
  <p class="meta login-foot"><a class="text-link" href="${localePath(lang, "/privacy")}">${esc(V14[lang].privacy)}</a></p>
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

/** Page-level actions in the heading (navigation and sign-out live in the sidebar). */
export function adminTools(
  _lang: Lang,
  _active: "teams" | "sites" | "workers" | "activity" | "settings",
  _csrf: string,
  actions = "",
): string {
  return `<div class="head-tools">${actions}</div>`;
}

export const ADMIN_CTX = (_lang: Lang): DashCtx => ({ name: null, sub: "" });

export interface AdminStats {
  sites: number;
  bytes: number;
  guests: number;
  permanent: number;
  views30: number | null;
  views7: number | null;
  workers: number;
  workersTeams: number;
  /** 0.16.0: Workers whose health check says down right now (names). */
  down?: string[];
  members: number;
}

export function adminTeamsHtml(
  lang: Lang,
  c: Config,
  o: {
    teams: (AdminTeamRow & { workers?: boolean; slug?: string | null; workerCount?: number })[];
    csrf: string;
    flash?: Flash | null;
    backendConfigured: boolean;
    stats?: AdminStats;
    cfConfigured?: boolean;
  },
): string {
  const t = STRINGS[lang];
  const d = DS[lang];
  const href = (p: string) => localePath(lang, p);
  const live = o.teams.reduce((n, x) => n + x.liveSites, 0);
  const st = o.stats;
  const on = (v: boolean | undefined, label: string) =>
    `<span class="badge ${v ? "on" : "muted"}" title="${esc(label)}">${esc(v ? t.common.on : d.off)}</span>`;
  const table = o.teams.length
    ? `${dataTable({
        lang,
        id: "teams-table",
        caption: t.admin.teams,
        headLabel: t.admin.name,
        cols: [
          { label: t.admin.liveSites, sort: "num" },
          { label: t.members.title, sort: "num" },
          { label: d.workersCol, sort: "num" },
          { label: t.admin.quota },
          { label: t.admin.backend, sort: "text" },
          { label: t.admin.directory, sort: "text" },
          { label: t.admin.permanent, sort: "text" },
          { label: t.common.created, sort: "date" },
        ],
        rows: o.teams.map((tm) => {
          const base = `/admin/teams/${tm.id}`;
          return {
            label: tm.name,
            href: href(base),
            head: `<a class="row-link" href="${href(base)}"><bdi>${esc(tm.name)}</bdi></a><div class="meta ltr">${esc(tm.id)}</div>`,
            headV: tm.name,
            cells: [
              {
                html: `<a class="text-link" href="${href(`${base}?tab=spaces`)}">${esc(fmt(lang, tm.liveSites))}</a>`,
                v: tm.liveSites,
                cls: "num",
              },
              {
                html: `<a class="text-link" href="${href(`${base}?tab=members`)}">${esc(fmt(lang, tm.members))}</a>`,
                v: tm.members,
                cls: "num",
              },
              {
                html: tm.workers
                  ? `<span class="badge on">${esc(t.common.on)}</span> <span class="meta">${esc(fmt(lang, tm.workerCount ?? 0))}</span>`
                  : `<span class="badge muted">${esc(d.off)}</span>`,
                v: tm.workers ? (tm.workerCount ?? 0) + 1 : 0,
              },
              {
                html: `${esc(fmt(lang, tm.quotaSites))} · ${esc(`${fmt(lang, tm.quotaMb)} MB`)}${tm.customQuota ? " ✱" : ""}`,
              },
              { html: on(tm.backend, t.admin.backend), v: tm.backend ? "1" : "0" },
              { html: on(tm.directory, t.admin.directory), v: tm.directory ? "1" : "0" },
              { html: on(tm.permanent, t.admin.permanent), v: tm.permanent ? "1" : "0" },
              { html: relTimeTag(tm.createdAt, lang), v: tm.createdAt },
            ],
            actions: [
              { kind: "link" as const, label: DS[lang].manage, href: href(base), primary: true },
              {
                kind: "link" as const,
                label: t.members.title,
                href: href(`${base}?tab=members`),
                icon: "members",
              },
              {
                kind: "link" as const,
                label: d.stats.spaces,
                href: href(`${base}?tab=spaces`),
                icon: "sites",
              },
              {
                kind: "link" as const,
                label: d.stats.workers,
                href: href(`${base}?tab=workers`),
                icon: "workers",
              },
              {
                kind: "link" as const,
                label: d.settings,
                href: href(`${base}?tab=settings`),
                icon: "settings",
              },
              {
                kind: "post" as const,
                label: t.admin.rotate,
                action: href(`${base}/rotate`),
                icon: "rotate",
                confirm: d.rotateConfirm,
              },
              {
                // 0.16.0: deleting needs the typed name, on the team's Settings tab.
                kind: "link" as const,
                label: t.common.del,
                href: href(`${base}?tab=settings#dz-title`),
                icon: "trash",
              },
            ],
            filters: { workers: tm.workers ? "on" : "off" },
          };
        }),
        csrf: o.csrf,
        empty: t.admin.none,
        filters: [
          {
            key: "workers",
            label: d.workersCol,
            options: [
              ["on", `${d.workersCol}: ${t.common.on}`],
              ["off", `${d.workersCol}: ${d.off}`],
            ],
          },
        ],
      })}
      <p class="meta table-note">${esc(t.admin.keyHelp)}</p>`
    : emptyState(
        t.admin.none,
        t.admin.createSub,
        `<a class="button" href="#create">${icon("plus")}${esc(d.newTeam)}</a>`,
      );
  const cards = st
    ? `<div class="stat-grid">
    ${statCard("teams", d.stats.teams, esc(fmt(lang, o.teams.length)), esc(d.stats.teamsSub(st.members)))}
    ${statCard("sites", d.stats.spaces, esc(fmt(lang, st.sites)), esc(`${bytesLabel(lang, st.bytes)} · ${d.stats.guests(st.guests)} · ${d.stats.perm(st.permanent)}`), undefined, href("/admin/sites"))}
    ${statCard("workers", d.stats.workers, esc(fmt(lang, st.workers)), esc(d.stats.workersSub(st.workersTeams)), undefined, href("/admin/workers"))}
    ${
      st.down && st.workers
        ? statCard(
            "health",
            d.stats.downNow,
            esc(fmt(lang, st.down.length)),
            st.down.length
              ? `<bdi dir="ltr">${esc(st.down.slice(0, 3).join(", "))}${st.down.length > 3 ? " …" : ""}</bdi>`
              : esc(d.stats.allUp),
            undefined,
            href(`/admin/workers${st.down.length ? "?health=down" : ""}`),
          )
        : ""
    }
    ${st.views30 !== null ? statCard("views", d.stats.views30, esc(fmt(lang, st.views30)), esc(d.stats.views7(fmt(lang, st.views7 ?? 0)))) : ""}
  </div>`
    : "";
  const body = `<div class="page-wide">
  ${pageHead(t.admin.eyebrow, esc(d.overview), d.adminOverviewSub, adminTools(lang, "teams", o.csrf, `<a class="button small" href="#create">${icon("plus")}${esc(d.newTeam)}</a>`))}
  ${flashBox(lang, o.flash)}
  ${cards}
  <ul class="status-list">
    <li><span class="dot-status on" aria-hidden="true"></span><strong>${esc(t.admin.teams)}:</strong> ${esc(t.admin.teamsCount(o.teams.length))}</li>
    <li><span class="dot-status ${live ? "on" : "off"}" aria-hidden="true"></span>${esc(t.admin.liveTotal(live))}</li>
    <li><span class="dot-status ${o.backendConfigured ? "on" : "warn"}" aria-hidden="true"></span>${esc(o.backendConfigured ? t.admin.serverBackendOn : t.admin.serverBackendOff)}</li>
  </ul>
  <section class="block" aria-labelledby="teams-title">
    <h2 id="teams-title">${esc(t.admin.teams)}</h2>
    ${table}
  </section>
  <section class="block" id="create" aria-labelledby="create-title">
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
      <button class="button" type="submit" data-busy>${esc(t.admin.create)}</button>
    </form>
  </section>
  <section class="block two-col" aria-labelledby="how-title">
    <div>
      <h2 id="how-title">${esc(t.admin.howTitle)}</h2>
      <ul class="checks">${t.admin.how.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      <div class="actions"><a class="text-link" href="/docs/teams">${esc(t.admin.docsLink)}</a></div>
    </div>
    <pre tabindex="0" class="code" dir="ltr"><code># MARSA_TEAM_KEY=marsa_team_…   (keep it secret)
curl -s -X POST "${esc(c.publicUrl)}/api/sites" \\
  -H "X-Team-Key: $MARSA_TEAM_KEY" \\
  -H "Content-Type: application/zip" --data-binary @site.zip

# Team members sign in at:
# ${esc(c.publicUrl)}${esc(localePath(lang, "/login"))}</code></pre>
  </section>
</div>`;
  return dashLayout({
    lang,
    config: c,
    kind: "admin",
    active: "overview",
    title: `${t.admin.title} · ${t.admin.eyebrow} · ${t.product}`,
    description: t.admin.sub,
    path: "/admin",
    body,
    csrf: o.csrf,
    ctx: ADMIN_CTX(lang),
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
  fileCount?: number;
  permanent: boolean;
  visits?: VisitSummary;
  repo?: RepoLink | null;
  repoStatus?: RepoStatus | null;
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
  const back = href(
    `/admin/sites${o.owner && o.owner !== "all" ? `?owner=${encodeURIComponent(o.owner)}` : ""}`,
  );
  const { rows, cols } = siteTableRows(
    lang,
    o.sites.map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      totalBytes: s.totalBytes,
      fileCount: s.fileCount ?? 0,
      listed: false,
      unlisted: false,
      permanent: s.permanent,
      ...(s.visits ? { visits: s.visits } : {}),
      repo: s.repo ?? null,
      repoStatus: s.repoStatus ?? null,
      owner: s.ownerId ? { id: s.ownerId, name: s.owner ?? s.ownerId } : null,
    })),
    {
      detail: (s) => href(`/admin/sites/${s.id}`),
      canEdit: true,
      deleteAction: (s) => href(`/admin/sites/${s.id}/delete`),
      showOwner: true,
      ownerHref: (s) => href(`/admin/teams/${s.owner?.id ?? ""}?tab=spaces`),
      back,
    },
  );
  const ownerOpts: [string, string][] = [
    ...o.teams
      .filter((x) => o.sites.some((s) => s.ownerId === x.id))
      .map((x) => [x.id, x.name] as [string, string]),
    ...(o.sites.some((s) => !s.ownerId) ? [["guest", t.admin.guests] as [string, string]] : []),
  ];
  const table = dataTable({
    lang,
    id: "admin-sites",
    caption: t.admin.sitesTitle,
    headLabel: t.common.title,
    cols,
    rows,
    csrf: o.csrf,
    empty: t.admin.noSites,
    filters: [
      siteStatusFilter(lang),
      { key: "team", label: t.admin.owner, options: ownerOpts },
      repoFilter(lang, o.sites),
    ],
  });
  const body = `<div class="page-wide">
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
    ${o.sites.length ? table : emptyState(t.admin.noSites, t.admin.sitesSub)}
  </section>
</div>`;
  return dashLayout({
    lang,
    config: c,
    kind: "admin",
    active: "sites",
    title: `${t.admin.sitesTitle} · ${t.admin.eyebrow} · ${t.product}`,
    description: t.admin.sitesSub,
    path: "/admin/sites",
    body,
    csrf: o.csrf,
    ctx: ADMIN_CTX(lang),
  });
}

// ---- docs ------------------------------------------------------------------------

function docsNav(lang: Lang, docs: DocPage[], current?: string): string {
  const t = STRINGS[lang];
  const list = docsFor(lang, docs);
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
  const list = docsFor(lang, docs);
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
  <a class="card doc-card" href="${localePath(lang, "/docs/recipes")}"><h2 class="h3">${esc(R14[lang].recipes)}</h2><p>${esc(R14[lang].publicSub)}</p></a>
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

// ---- team Workers (0.12.0) ---------------------------------------------------------------

/** Strings for the Workers pages (kept here, next to the markup). */
export const WS = {
  en: {
    nav: "Workers",
    title: "Workers",
    sub: "Deploy small Cloudflare Workers (APIs, MCP servers) for your team. Spaces publishes them for you; you never need a Cloudflare key.",
    off: "Workers are off for this team. Ask the admin to turn them on.",
    notConfigured: "The admin has not connected Cloudflare yet.",
    none: "No Workers yet",
    noneSub: "Deploy one with the form below, the API or the space MCP.",
    name: "Name",
    url: "Address",
    status: "Status",
    size: "Size",
    env: "Vars and secrets",
    deployed: "Deployed",
    statuses: {
      active: "Live",
      disabled: "Disabled by the admin",
      failed: "Failed",
      deploying: "Deploying",
    } as Record<string, string>,
    deployTitle: "Deploy a Worker",
    deploySub:
      "One JavaScript ES module (export default { fetch(request, env) { … } }). Deploying an existing name replaces its code.",
    nameHelp: (slug: string, zone: string) =>
      `1-30 characters: a-z, 0-9 and hyphens. Address: ${slug}-<name>.${zone}`,
    file: "Script file (.js)",
    code: "…or paste the code",
    vars: "Env vars (NAME=value, one per line)",
    varsHelp:
      "Plain values, visible to the team. Leave empty on a redeploy to keep the current ones.",
    secrets: "Secrets (NAME=value, one per line)",
    secretsHelp:
      "Write-only: stored as Worker secrets on Cloudflare and never shown again. Use NAME= (empty) to remove one.",
    deploy: "Deploy",
    del: "Delete",
    confirmDelete: "Delete this Worker? Its address stops working at once.",
    deployed1: "Deployed.",
    deleted: "Worker deleted.",
    quota: (n: number, max: number, kb: number) =>
      `${n} of ${max} Workers · up to ${kb} KB per script`,
    agentsTitle: "For agents",
    agentsSub:
      "Agents use the team key (or a read-write space MCP token: tools list_workers, deploy_worker, delete_worker). They never need a Cloudflare key.",
    viewOnly: "Viewers can see Workers but not change them.",
    // admin
    adminTitle: "Workers",
    adminSub:
      "One Cloudflare token for the whole platform. Teams deploy through Spaces and never see it.",
    settings: "Cloudflare connection",
    tokenSet: (l4: string) => `Token set (…${l4})`,
    tokenUnset: "No token set",
    noKey:
      "MARSA_SECRETS_KEY is not set on the server, so the token cannot be stored. Add it to the server env and restart.",
    token: "API token",
    tokenHelp:
      "Needs Workers Scripts: Edit (account), Workers Routes: Edit and DNS: Edit (zone). Write-only: it is encrypted on the server and never shown again.",
    account: "Account id",
    accountHelp: "Optional when the token sees one account or the zone.",
    zone: "Zone (domain)",
    zoneHelp: "Workers get <team>-<name>.<zone>. Empty = workers.dev addresses.",
    save: "Save and verify",
    verify: "Verify token",
    clear: "Remove token",
    confirmClear: "Remove the Cloudflare token? (Only possible when no team Workers exist.)",
    verified: "Last check",
    saved: "Saved. The token was verified with Cloudflare.",
    verifiedFlash: (s: string) => `Cloudflare says the token is: ${s}`,
    cleared: "Token removed.",
    teamsTitle: "Teams",
    enabled: "Workers",
    slug: "Slug",
    slugHelp:
      "2-20 lowercase letters/digits; used in script names and addresses. Fixed while the team has Workers.",
    maxWorkers: "Max Workers",
    maxKb: "Max KB",
    count: "Workers",
    turnOffConfirm: "Turn Workers off for this team? Every Worker of the team will be deleted.",
    allTitle: "All team Workers",
    team: "Team",
    disable: "Disable",
    enable: "Enable",
    teamSaved: "Team Workers settings saved.",
    platformLog: "Platform activity",
    left: "Defaults: WORKERS_DEFAULT_MAX Workers and WORKER_MAX_KB KB per team.",
  },
  ar: {
    nav: "الوركرات",
    title: "الوركرات",
    sub: "انشر وركرات صغيرة على كلاودفلير (واجهات API أو خوادم MCP) لفريقك. المساحات تنشرها نيابةً عنك، ولا تحتاج أبدًا مفتاح كلاودفلير.",
    off: "الوركرات غير مفعّلة لهذا الفريق. اطلب من المسؤول تفعيلها.",
    notConfigured: "لم يربط المسؤول حساب كلاودفلير بعد.",
    none: "لا توجد وركرات بعد",
    noneSub: "انشر واحدًا من النموذج بالأسفل أو من الـ API أو من MCP المساحة.",
    name: "الاسم",
    url: "العنوان",
    status: "الحالة",
    size: "الحجم",
    env: "المتغيرات والأسرار",
    deployed: "آخر نشر",
    statuses: {
      active: "يعمل",
      disabled: "أوقفه المسؤول",
      failed: "فشل",
      deploying: "جارٍ النشر",
    } as Record<string, string>,
    deployTitle: "انشر وركر",
    deploySub:
      "ملف JavaScript واحد بصيغة ES module ‏(export default { fetch(request, env) { … } }). النشر باسم موجود يستبدل الكود.",
    nameHelp: (slug: string, zone: string) =>
      `من 1 إلى 30 حرفًا: a-z و0-9 والشرطة. العنوان: ${slug}-<name>.${zone}`,
    file: "ملف السكربت (.js)",
    code: "…أو الصق الكود",
    vars: "متغيرات البيئة (NAME=value في كل سطر)",
    varsHelp: "قيم عادية يراها الفريق. اتركها فارغة عند إعادة النشر للإبقاء على الحالية.",
    secrets: "الأسرار (NAME=value في كل سطر)",
    secretsHelp:
      "للكتابة فقط: تُحفظ كأسرار للوركر على كلاودفلير ولا تظهر مرة أخرى. اكتب NAME= فارغة لحذف سر.",
    deploy: "انشر",
    del: "احذف",
    confirmDelete: "تحذف هذا الوركر؟ سيتوقف عنوانه فورًا.",
    deployed1: "تم النشر.",
    deleted: "تم حذف الوركر.",
    quota: (n: number, max: number, kb: number) =>
      `${n} من ${max} وركرات · حتى ${kb} كيلوبايت للسكربت`,
    agentsTitle: "للوكلاء",
    agentsSub:
      "الوكيل يستخدم مفتاح الفريق (أو رمز MCP للمساحة بصلاحية قراءة وكتابة: الأدوات list_workers وdeploy_worker وdelete_worker). لا يحتاج أبدًا مفتاح كلاودفلير.",
    viewOnly: "المشاهد يرى الوركرات ولا يستطيع تعديلها.",
    adminTitle: "الوركرات",
    adminSub: "مفتاح كلاودفلير واحد للمنصة كلها. الفرق تنشر عبر المساحات ولا تراه أبدًا.",
    settings: "ربط كلاودفلير",
    tokenSet: (l4: string) => `المفتاح محفوظ (…${l4})`,
    tokenUnset: "لا يوجد مفتاح",
    noKey:
      "المتغير MARSA_SECRETS_KEY غير مضبوط على الخادم، فلا يمكن حفظ المفتاح. أضفه لملف البيئة وأعد التشغيل.",
    token: "مفتاح API",
    tokenHelp:
      "يحتاج صلاحيات: Workers Scripts: Edit على الحساب، وWorkers Routes: Edit وDNS: Edit على النطاق. للكتابة فقط: يُشفَّر على الخادم ولا يظهر مرة أخرى.",
    account: "معرّف الحساب",
    accountHelp: "اختياري إذا كان المفتاح يرى حسابًا واحدًا أو النطاق.",
    zone: "النطاق (الدومين)",
    zoneHelp: "كل وركر يأخذ <team>-<name>.<zone>. فارغ = عناوين workers.dev.",
    save: "احفظ وتحقّق",
    verify: "تحقّق من المفتاح",
    clear: "احذف المفتاح",
    confirmClear: "تحذف مفتاح كلاودفلير؟ (ممكن فقط إذا لم توجد وركرات للفرق.)",
    verified: "آخر تحقّق",
    saved: "تم الحفظ، وتحقّقت كلاودفلير من المفتاح.",
    verifiedFlash: (s: string) => `حالة المفتاح عند كلاودفلير: ${s}`,
    cleared: "تم حذف المفتاح.",
    teamsTitle: "الفرق",
    enabled: "الوركرات",
    slug: "الاسم المختصر",
    slugHelp:
      "من 2 إلى 20 حرفًا إنجليزيًا صغيرًا أو رقمًا؛ يُستخدم في أسماء السكربتات والعناوين. لا يتغير طالما للفريق وركرات.",
    maxWorkers: "أقصى عدد",
    maxKb: "أقصى حجم KB",
    count: "الوركرات",
    turnOffConfirm: "توقف الوركرات لهذا الفريق؟ سيتم حذف كل وركرات الفريق.",
    allTitle: "كل وركرات الفرق",
    team: "الفريق",
    disable: "أوقف",
    enable: "شغّل",
    teamSaved: "تم حفظ إعدادات وركرات الفريق.",
    platformLog: "سجل المنصة",
    left: "الافتراضي: WORKERS_DEFAULT_MAX وركرات وWORKER_MAX_KB كيلوبايت لكل فريق.",
  },
} as const;

export interface WorkerRowView {
  /** Newest stored version (0.14.0), null when nothing is stored yet. */
  version?: number | null;
  id: string;
  name: string;
  url: string;
  status: string;
  bytes: number;
  vars: Record<string, string>;
  secrets: string[];
  deployedAt: string | null;
  deployedBy: string;
  lastError: string | null;
  team?: { id: string; name: string | null };
  /** 0.15.0 list columns. */
  keysOn?: boolean;
  keysCount?: number;
  requests7?: number | null;
  insight?: InsightRow;
}

export interface TeamWorkersOpts extends TeamPageOpts {
  info: {
    enabled: boolean;
    configured: boolean;
    slug: string | null;
    quota: { workers: number; kb: number };
    workers: WorkerRowView[];
  };
  zone: string | null;
}

export function teamWorkersHtml(
  lang: Lang,
  c: Config,
  o: TeamWorkersOpts & { redeploy?: string },
): string {
  const t = STRINGS[lang];
  const w = WS[lang];
  const d = DS[lang];
  const href = (p: string) => localePath(lang, p);
  const edit = canEdit(o.me);
  const i = o.info;
  const canDeploy = i.enabled && i.configured && edit;
  const redeploy = o.redeploy && i.workers.some((x) => x.name === o.redeploy) ? o.redeploy : "";
  const { rows, cols } = workerRows(lang, i.workers, {
    detail: (x) => href(`/team/workers/${x.name}`),
    admin: false,
    canEdit: edit && canDeploy,
  });
  const list = i.workers.length
    ? dataTable({
        lang,
        id: "workers-table",
        caption: w.title,
        headLabel: w.name,
        cols,
        rows,
        csrf: o.csrf,
        empty: w.none,
        filters: [
          workerStatusFilter(lang, i.workers),
          healthFilter(lang, i.workers),
          kindFilter(lang, i.workers),
          languageFilter(lang, i.workers),
          repoFilter(lang, i.workers),
        ],
      })
    : emptyState(
        w.none,
        w.noneSub,
        canDeploy ? `<a class="button" href="#deploy">${icon("plus")}${esc(d.newWorker)}</a>` : "",
      );
  const zone = o.zone ?? "workers.dev";
  const form = canDeploy
    ? `<section class="block" id="deploy" aria-labelledby="deploy-title">
    <details class="panel deploy-panel"${redeploy || !i.workers.length ? " open" : ""}>
      <summary><h2 class="h3" id="deploy-title">${esc(redeploy ? `${d.redeploy}: ${redeploy}` : w.deployTitle)}</h2></summary>
    <form method="post" action="${href("/team/workers/deploy")}" enctype="multipart/form-data">
      ${csrfField(o.csrf)}
      <p>${esc(w.deploySub)}</p>
      <label for="wname">${esc(w.name)}</label>
      <input id="wname" name="name" type="text" dir="ltr" required maxlength="30" pattern="[a-z0-9](?:[a-z0-9\\-]{0,28}[a-z0-9])?" aria-describedby="wname-help" autocomplete="off" value="${esc(redeploy)}">
      <p class="form-help" id="wname-help">${esc(w.nameHelp(i.slug ?? "team", zone))}</p>
      <div class="two-col tight">
        <div><label for="wfile">${esc(w.file)}</label>
        <input id="wfile" name="file" type="file" accept=".js,.mjs,text/javascript,application/javascript"></div>
      </div>
      <label for="wcode">${esc(w.code)}</label>
      <textarea id="wcode" name="code" rows="10" dir="ltr" spellcheck="false" class="code-input" placeholder="export default { async fetch(request, env) { return new Response('hello'); } };"></textarea>
      <div class="two-col tight">
        <div><label for="wvars">${esc(w.vars)}</label>
        <textarea id="wvars" name="vars" rows="3" dir="ltr" spellcheck="false" aria-describedby="wvars-help" placeholder="GREETING=hello"></textarea>
        <p class="form-help" id="wvars-help">${esc(w.varsHelp)}</p></div>
        <div><label for="wsecrets">${esc(w.secrets)}</label>
        <textarea id="wsecrets" name="secrets" rows="3" dir="ltr" spellcheck="false" autocomplete="off" aria-describedby="wsecrets-help" placeholder="API_KEY=…"></textarea>
        <p class="form-help" id="wsecrets-help">${esc(w.secretsHelp)}</p></div>
      </div>
      <label for="wnote">${esc(V14[lang].note)}</label>
      <input id="wnote" name="note" type="text" maxlength="200" autocomplete="off" aria-describedby="wnote-help">
      <p class="form-help" id="wnote-help">${esc(V14[lang].noteHelp)}</p>
      <button class="button" type="submit" data-busy>${esc(w.deploy)}</button>
    </form>
    </details>
  </section>`
    : "";
  const teamRef = i.slug ?? o.team.id;
  const agents = `<section class="block two-col" aria-labelledby="agents-title">
    <div>
      <h2 id="agents-title">${esc(d.agentSnippet)}</h2>
      <p>${esc(d.agentSnippetSub(teamRef))}</p>
      <p class="meta">${esc(d.mcpTip)}</p>
      <div class="actions"><button type="button" class="button small ghost js-only" data-copy="#agent-snippet" data-copied="${esc(t.common.copied)}">${icon("copy")}${esc(d.copy)}</button><a class="text-link" href="${href("/docs/workers")}">${esc(t.admin.docsLink)}</a></div>
    </div>
    <pre tabindex="0" class="code" dir="ltr"><code id="agent-snippet"># MARSA_TEAM_KEY=marsa_team_…   (keep it secret)
curl -s -X PUT "${esc(c.publicUrl)}/api/teams/${esc(teamRef)}/workers/hello" \\
  -H "X-Team-Key: $MARSA_TEAM_KEY" \\
  -H "Content-Type: application/javascript" --data-binary @worker.js

curl -s "${esc(c.publicUrl)}/api/teams/${esc(teamRef)}/workers" -H "X-Team-Key: $MARSA_TEAM_KEY"</code></pre>
  </section>`;
  const state = !i.configured
    ? `<p class="notice">${esc(w.notConfigured)}</p>`
    : !i.enabled
      ? `<p class="notice">${esc(w.off)}</p>`
      : `<div class="stat-grid narrow">${statCard("workers", d.stats.workers, esc(fmt(lang, i.workers.length)), esc(w.quota(i.workers.length, i.quota.workers, i.quota.kb)), { value: i.workers.length, max: i.quota.workers })}</div>${edit ? "" : `<p class="meta">${esc(w.viewOnly)}</p>`}`;
  const body = `<div class="page-wide">
  ${teamHead(lang, o, w.sub, "workers", canDeploy ? `<a class="button small" href="#deploy">${icon("plus")}${esc(d.newWorker)}</a>` : "")}
  ${flashBox(lang, o.flash)}
  ${state}
  <section class="block" aria-labelledby="workers-title">
    <h2 id="workers-title">${esc(w.title)} <span class="count">${esc(String(i.workers.length))}</span></h2>
    ${list}
  </section>
  ${form}
  ${i.enabled ? agents : ""}
</div>`;
  return dashLayout({
    lang,
    config: c,
    kind: "team",
    active: "workers",
    title: `${w.title} · ${o.team.name} · ${t.product}`,
    description: w.sub,
    path: "/team/workers",
    body,
    csrf: o.csrf,
    ctx: teamCtx(lang, o),
  });
}

export interface AdminWorkersOpts {
  settings: {
    configured: boolean;
    encryption: boolean;
    last4: string | null;
    accountId: string | null;
    zoneName: string | null;
    verifiedAt: string | null;
    status: string | null;
  };
  teams: {
    id: string;
    name: string;
    workers: boolean;
    slug: string | null;
    maxWorkers: number | null;
    maxWorkerKb: number | null;
    quota: { workers: number; kb: number };
    count: number;
  }[];
  workers: WorkerRowView[];
  audit: AuditView[];
  csrf: string;
  flash?: Flash | null;
}

export function adminWorkersHtml(lang: Lang, c: Config, o: AdminWorkersOpts): string {
  const t = STRINGS[lang];
  const w = WS[lang];
  const href = (p: string) => localePath(lang, p);
  const st = o.settings;
  const settingsLine = `<section class="block" aria-labelledby="cf-title">
    <h2 id="cf-title" class="sr-only">${esc(w.settings)}</h2>
    <ul class="status-list">
      <li><span class="dot-status ${st.configured ? "on" : "warn"}" aria-hidden="true"></span><strong>${esc(w.settings)}:</strong> ${esc(st.last4 ? w.tokenSet(st.last4) : w.tokenUnset)}${st.configured ? ` · <code class="ltr">${esc(st.zoneName ?? "workers.dev")}</code>` : ""}</li>
    </ul>
    <p class="meta">${esc(DS[lang].cfOnSettings)} <a class="text-link" href="${href("/admin/settings")}">${esc(DS[lang].openSettings)}</a></p>
  </section>`;
  const teams = `<section class="block" aria-labelledby="wteams-title">
    <h2 id="wteams-title">${esc(w.teamsTitle)}</h2>
    ${dataTable({
      lang,
      id: "wteams-table",
      caption: w.teamsTitle,
      headLabel: t.admin.name,
      cols: [
        { label: w.enabled, sort: "text" },
        { label: w.count, sort: "num" },
        { label: `${w.enabled} · ${w.slug} · ${w.maxWorkers} · ${w.maxKb}` },
      ],
      rows: o.teams.map((x) => ({
        label: x.name,
        href: href(`/admin/teams/${x.id}?tab=workers`),
        head: `<a class="row-link" href="${href(`/admin/teams/${x.id}?tab=workers`)}"><bdi>${esc(x.name)}</bdi></a><div class="meta ltr">${esc(x.id)}</div>`,
        headV: x.name,
        cells: [
          {
            html: `<span class="badge ${x.workers ? "on" : "muted"}">${esc(x.workers ? t.common.on : DS[lang].off)}</span>`,
            v: x.workers ? "1" : "0",
          },
          { html: esc(fmt(lang, x.count)), v: x.count, cls: "num" },
          {
            html: postForm(
              href(`/admin/workers/teams/${x.id}`),
              o.csrf,
              `<label class="check small"><input type="checkbox" name="enabled" value="1"${x.workers ? " checked" : ""}> ${esc(w.enabled)}</label>
          <label class="quota-field"><span class="ql">${esc(w.slug)}</span><span class="sr-only"> · ${esc(x.name)}</span><input name="slug" type="text" dir="ltr" maxlength="20" placeholder="${esc(w.slug)}" value="${esc(x.slug ?? "")}"${x.count ? " readonly" : ""}></label>
          <label class="quota-field"><span class="ql">${esc(w.maxWorkers)}</span><span class="sr-only"> · ${esc(x.name)}</span><input name="maxWorkers" type="number" min="0" max="100" placeholder="${x.quota.workers}" value="${x.maxWorkers ?? ""}"></label>
          <label class="quota-field"><span class="ql">${esc(w.maxKb)}</span><span class="sr-only"> · ${esc(x.name)}</span><input name="maxWorkerKb" type="number" min="0" max="10240" placeholder="${x.quota.kb}" value="${x.maxWorkerKb ?? ""}"></label>
          <button type="submit" class="button small ghost">${esc(t.common.save)}</button>`,
              {
                cls: "inline-form quota-form",
                ...(x.workers && x.count ? { confirm: w.turnOffConfirm } : {}),
              },
            ),
          },
        ],
        actions: [
          {
            kind: "link" as const,
            label: DS[lang].manage,
            href: href(`/admin/teams/${x.id}?tab=workers`),
            primary: true,
          },
          {
            kind: "link" as const,
            label: DS[lang].settings,
            href: href(`/admin/teams/${x.id}?tab=settings`),
            icon: "settings",
          },
        ],
        filters: { status: x.workers ? "on" : "off" },
      })),
      csrf: o.csrf,
      empty: t.admin.none,
    })}
    <p class="meta table-note">${esc(w.slugHelp)}</p>
  </section>`;
  const { rows: wRows, cols: wCols } = workerRows(lang, o.workers, {
    detail: (x) => href(`/admin/teams/${x.team?.id ?? "-"}/workers/${x.name}`),
    admin: true,
    canEdit: true,
    showTeam: true,
    teamHref: (x) => href(`/admin/teams/${x.team?.id ?? "-"}`),
  });
  const teamOpts = [
    ...new Map(
      o.workers.filter((x) => x.team).map((x) => [x.team?.id ?? "", x.team?.name ?? ""]),
    ).entries(),
  ];
  const all = `<section class="block" aria-labelledby="wall-title">
    <h2 id="wall-title">${esc(w.allTitle)} <span class="count">${esc(String(o.workers.length))}</span></h2>
    ${dataTable({
      lang,
      id: "workers-table",
      caption: w.allTitle,
      headLabel: w.name,
      cols: wCols,
      rows: wRows,
      csrf: o.csrf,
      empty: w.none,
      filters: [
        workerStatusFilter(lang, o.workers),
        healthFilter(lang, o.workers),
        kindFilter(lang, o.workers),
        languageFilter(lang, o.workers),
        repoFilter(lang, o.workers),
        {
          key: "team",
          label: w.team,
          options: teamOpts.map(([id, name]) => [id, name || id] as [string, string]),
        },
      ],
    })}
  </section>`;
  const body = `<div class="page-wide">
  ${pageHead(t.admin.eyebrow, esc(w.adminTitle), w.adminSub, adminTools(lang, "workers", o.csrf))}
  ${flashBox(lang, o.flash)}
  ${settingsLine}
  ${teams}
  ${all}
  <section class="block audit-block" aria-labelledby="plog-title">
    <div class="block-head"><h2 id="plog-title">${esc(w.platformLog)}</h2><a class="text-link" href="${href("/admin/activity?team=platform")}">${esc(DS[lang].viewAll)}</a></div>
    ${auditTable(lang, o.audit.slice(0, 10), false, "plog-title")}
  </section>
</div>`;
  return dashLayout({
    lang,
    config: c,
    kind: "admin",
    active: "workers",
    title: `${w.adminTitle} · ${t.admin.eyebrow} · ${t.product}`,
    description: w.adminSub,
    path: "/admin/workers",
    body,
    csrf: o.csrf,
    ctx: ADMIN_CTX(lang),
  });
}

/** Cloudflare connection card (token is write-only: only the last 4 characters are ever shown). */
function cfCard(lang: Lang, st: AdminWorkersOpts["settings"], csrf: string): string {
  const w = WS[lang];
  const href = (p: string) => localePath(lang, p);
  return `<section class="card-block two-col cf-card" aria-labelledby="cf-title">
    <div>
      <h2 id="cf-title">${esc(w.settings)}</h2>
      ${st.encryption ? "" : `<p class="notice">${esc(w.noKey)}</p>`}
      <ul class="status-list">
        <li><span class="dot-status ${st.configured ? "on" : "warn"}" aria-hidden="true"></span>${esc(st.last4 ? w.tokenSet(st.last4) : w.tokenUnset)}</li>
        ${st.accountId ? `<li><strong>${esc(w.account)}:</strong> <code class="ltr">${esc(st.accountId)}</code></li>` : ""}
        ${st.configured ? `<li><strong>${esc(w.zone)}:</strong> <code class="ltr">${esc(st.zoneName ?? "workers.dev")}</code></li>` : ""}
        ${st.verifiedAt ? `<li><strong>${esc(w.verified)}:</strong> ${timeTag(lang, st.verifiedAt)} · <span dir="ltr">${esc(st.status ?? "")}</span></li>` : ""}
      </ul>
      ${st.configured ? `<div class="acts">${postForm(href("/admin/workers/settings/verify"), csrf, `<button class="button small ghost" type="submit">${esc(w.verify)}</button>`)}${postForm(href("/admin/workers/settings/clear"), csrf, `<button class="button small danger" type="submit">${esc(w.clear)}</button>`, { confirm: w.confirmClear })}</div>` : ""}
    </div>
    <form method="post" action="${href("/admin/workers/settings")}" class="panel" autocomplete="off">
      ${csrfField(csrf)}
      <label for="cftoken">${esc(w.token)}</label>
      <input id="cftoken" name="token" type="password" dir="ltr" autocomplete="off" maxlength="200" ${st.configured ? `placeholder="…${esc(st.last4 ?? "")}"` : "required"} aria-describedby="cftoken-help">
      <p class="form-help" id="cftoken-help">${esc(w.tokenHelp)}</p>
      <label for="cfacct">${esc(w.account)}</label>
      <input id="cfacct" name="accountId" type="text" dir="ltr" maxlength="32" value="${esc(st.accountId ?? "")}" aria-describedby="cfacct-help">
      <p class="form-help" id="cfacct-help">${esc(w.accountHelp)}</p>
      <label for="cfzone">${esc(w.zone)}</label>
      <input id="cfzone" name="zone" type="text" dir="ltr" maxlength="253" value="${esc(st.zoneName ?? (st.configured ? "" : "marsaplatform.com"))}" aria-describedby="cfzone-help">
      <p class="form-help" id="cfzone-help">${esc(w.zoneHelp)}</p>
      <button class="button" type="submit"${st.encryption ? "" : " disabled"}>${esc(w.save)}</button>
    </form>
  </section>`;
}

export interface AdminSettingsOpts {
  settings: AdminWorkersOpts["settings"];
  /** 0.15.2: prerendered token permission checklists + health interval. */
  extra?: string;
  /** 0.16.0: backups, deleted teams, sign out everywhere. */
  lifecycle?: string;
  server: {
    version: string;
    publicUrl: string;
    backend: boolean;
    secretsKey: boolean;
    sessionKey: boolean;
    maxUploadMb: number;
    teamSites: number;
    teamMb: number;
    workersMax: number;
    workerKb: number;
    health?: {
      kind: string;
      kv: { ok: boolean; error?: string };
      files: { ok: boolean; error?: string };
    } | null;
  };
  csrf: string;
  flash?: Flash | null;
}

export function adminSettingsHtml(lang: Lang, c: Config, o: AdminSettingsOpts): string {
  const t = STRINGS[lang];
  const d = DS[lang];
  const sv = o.server;
  const yes = (on: boolean, a: string = d.present, b: string = d.missing) =>
    `<span class="badge ${on ? "on" : "warn"}">${esc(on ? a : b)}</span>`;
  const body = `<div class="page-wide">
  ${pageHead(t.admin.eyebrow, esc(d.settings), d.adminSettingsSub, adminTools(lang, "settings", o.csrf))}
  ${flashBox(lang, o.flash)}
  ${cfCard(lang, o.settings, o.csrf)}
  ${o.lifecycle ?? ""}
  ${o.extra ?? ""}
  <section class="card-block" aria-labelledby="srv-title">
    <h2 id="srv-title" class="h3">${esc(d.server)}</h2>
    <dl class="facts">
      <div><dt>${esc(d.version)}</dt><dd><code class="ltr">${esc(sv.version)}</code></dd></div>
      <div class="fact-wide"><dt>${esc(d.publicUrl)}</dt><dd><a class="text-link" href="${esc(sv.publicUrl)}" dir="ltr">${esc(hostless(sv.publicUrl))}</a></dd></div>
      <div><dt>${esc(d.backendSrv)}</dt><dd>${yes(sv.backend, d.on, d.off)}</dd></div>
      ${
        sv.health
          ? (["kv", "files"] as const)
              .map((k) => {
                const h = sv.health?.[k];
                return `<div class="fact-wide"><dt>${esc(k === "kv" ? d.healthKv : d.healthFiles)}</dt><dd>${yes(!!h?.ok, d.healthOk, d.healthFail)}${h?.error ? ` <span class="meta">${esc(h.error)}</span>` : ""}</dd></div>`;
              })
              .join("")
          : ""
      }
      <div><dt>${esc(d.secretsKey)}</dt><dd>${yes(sv.secretsKey)}</dd></div>
      <div class="fact-wide"><dt>${esc(d.sessions)}</dt><dd>${esc(sv.sessionKey ? d.sessionsPersistent : d.sessionsEphemeral)}</dd></div>
      <div><dt>${esc(d.limits)}</dt><dd>${esc(`${fmt(lang, sv.maxUploadMb)} MB`)}</dd></div>
      <div><dt>${esc(d.defaults)}</dt><dd>${esc(`${fmt(lang, sv.teamSites)} · ${fmt(lang, sv.teamMb)} MB · ${fmt(lang, sv.workersMax)} × ${fmt(lang, sv.workerKb)} KB`)}</dd></div>
    </dl>
  </section>
</div>`;
  return dashLayout({
    lang,
    config: c,
    kind: "admin",
    active: "settings",
    title: `${d.settings} · ${t.admin.eyebrow} · ${t.product}`,
    description: d.adminSettingsSub,
    path: "/admin/settings",
    body,
    csrf: o.csrf,
    ctx: ADMIN_CTX(lang),
  });
}

/** 0.16.0: download the whole log (CSV for spreadsheets, JSONL for scripts). */
function activityDownloads(lang: Lang, base: string): string {
  const sep = base.includes("?") ? "&" : "?";
  const l =
    lang === "ar"
      ? { dl: "تنزيل السجل", csv: "CSV", jsonl: "JSONL" }
      : { dl: "Download the log", csv: "CSV", jsonl: "JSONL" };
  return `<p class="meta activity-dl">${icon("download")} ${esc(l.dl)}: <a class="text-link" href="${esc(`${base}${sep}format=csv`)}" download>${l.csv}</a> · <a class="text-link" href="${esc(`${base}${sep}format=jsonl`)}" download>${l.jsonl}</a></p>`;
}

export function adminActivityHtml(
  lang: Lang,
  c: Config,
  o: {
    audit: (AuditView & { team?: { id: string; name: string } | null })[];
    teams: { id: string; name: string }[];
    team: string;
    kind: string;
    q: string;
    csrf: string;
    flash?: Flash | null;
  },
): string {
  const t = STRINGS[lang];
  const d = DS[lang];
  const href = (p: string) => localePath(lang, p);
  const kinds = ["member", "key", "api", "mcp", "admin"] as const;
  const opt = (v: string, label: string, sel: string) =>
    `<option value="${esc(v)}"${sel === v ? " selected" : ""}>${esc(label)}</option>`;
  const filter = `<form method="get" action="${href("/admin/activity")}" class="filters" role="search">
    <label><span>${esc(d.search)}</span><input type="search" name="q" value="${esc(o.q)}" placeholder="${esc(d.searchPh)}"></label>
    <label><span>${esc(d.pickTeam)}</span><select name="team">${opt("", d.allTeams, o.team)}${opt("platform", d.platform, o.team)}${o.teams.map((x) => opt(x.id, x.name, o.team)).join("")}</select></label>
    <label><span>${esc(d.who)}</span><select name="kind">${opt("", d.everyone, o.kind)}${kinds.map((k) => opt(k, t.members.actorKinds[k], o.kind)).join("")}</select></label>
    <button class="button small" type="submit">${esc(d.filter)}</button>${o.q || o.kind || o.team ? `<a class="text-link" href="${href("/admin/activity")}">${esc(d.reset)}</a>` : ""}
  </form>${activityDownloads(lang, href(`/admin/activity/export${o.team ? `?team=${encodeURIComponent(o.team)}` : ""}`))}`;
  const table = dataTable({
    lang,
    id: "activity-table",
    caption: d.activity,
    headLabel: t.members.when,
    headSort: false,
    cols: [
      { label: d.pickTeam, sort: "text" },
      { label: d.who, sort: "text" },
      { label: t.members.what },
    ],
    rows: o.audit.map((e) => {
      const what =
        t.members.actions[e.action] ??
        (e.action.startsWith("mcp:") ? `MCP · ${e.action.slice(4)}` : e.action);
      const who = e.kind === "member" ? e.who : actorText(lang, e.who);
      const target = e.site
        ? href(`/admin/sites/${e.site.id}`)
        : e.team
          ? href(`/admin/teams/${e.team.id}?tab=activity`)
          : undefined;
      return {
        label: `${what} · ${e.team?.name ?? d.platform}`,
        ...(target ? { href: target } : {}),
        head: timeTag(lang, e.at),
        headV: e.at,
        cells: [
          {
            html: e.team
              ? `<a class="text-link" href="${href(`/admin/teams/${encodeURIComponent(e.team.id)}`)}"><bdi>${esc(e.team.name)}</bdi></a>`
              : `<span class="badge muted">${esc(d.platform)}</span>`,
            v: (e.team?.name ?? "").toLowerCase(),
          },
          {
            html: `<span class="badge k-${esc(e.kind)}">${esc(t.members.actorKinds[e.kind as (typeof kinds)[number]] ?? e.kind)}</span> <bdi>${esc(who)}</bdi>`,
            v: who.toLowerCase(),
          },
          {
            html: `${esc(what)}${e.detail ? ` <span class="meta"><bdi>${esc(detailText(lang, e.detail))}</bdi></span>` : ""}${e.site ? ` · <a class="text-link" href="${href(`/admin/sites/${e.site.id}`)}"><bdi>${esc(e.site.title)}</bdi></a>` : ""}`,
          },
        ],
        filters: { kind: e.kind },
      };
    }),
    empty: d.noActivity,
    search: false,
    pageSize: 50,
    cls: "audit-table",
  });
  const body = `<div class="page-wide">
  ${pageHead(t.admin.eyebrow, esc(d.activity), d.adminActivitySub, adminTools(lang, "activity", o.csrf))}
  ${flashBox(lang, o.flash)}
  <section class="block" aria-labelledby="pa-title">
    <h2 id="pa-title" class="sr-only">${esc(d.activity)}</h2>
    ${filter}
    <p class="meta">${esc(d.shown(o.audit.length))}</p>
    ${table}
  </section>
</div>`;
  return dashLayout({
    lang,
    config: c,
    kind: "admin",
    active: "activity",
    title: `${d.activity} · ${t.admin.eyebrow} · ${t.product}`,
    description: d.adminActivitySub,
    path: "/admin/activity",
    body,
    csrf: o.csrf,
    ctx: ADMIN_CTX(lang),
  });
}

// ---- dashboard shell (0.13.0) ----------------------------------------------------------------

/** Dashboard strings (team dashboard + admin console). */
export const DS = {
  en: {
    menu: "Menu",
    close: "Close menu",
    publicSite: "Public site",
    guide: "Guide",
    crumbs: "Breadcrumb",
    teamArea: "Team dashboard",
    adminArea: "Admin console",
    nav: {
      overview: "Overview",
      sites: "Spaces",
      workers: "Workers",
      mcp: "MCP servers",
      notes: "Agent notes",
      members: "Members",
      agents: "Agent keys",
      recipes: "Recipes",
      alerts: "Notifications",
      activity: "Activity",
      settings: "Settings",
    } as Record<string, string>,
    overview: "Overview",
    overviewSub: "Your team at a glance: spaces, visits, people and Workers.",
    stats: {
      spaces: "Live spaces",
      storage: "Storage",
      views: "Views, last 30 days",
      views7: (n: string) => `${n} in the last 7 days`,
      members: "Members",
      invites: (n: number) => (n === 1 ? "1 pending invite" : `${n} pending invites`),
      workers: "Workers",
      workersOff: "Off for this team",
      of: (a: string, b: string) => `${a} of ${b}`,
      teams: "Teams",
      teamsSub: (m: number) => (m === 1 ? "1 member in total" : `${m} members in total`),
      guests: (n: number) => `${n} guest`,
      perm: (n: number) => `${n} permanent`,
      workersSub: (n: number) => (n === 1 ? "1 team can deploy" : `${n} teams can deploy`),
      downNow: "Down now",
      allUp: "All checked Workers are up",
      views30: "Views, last 30 days",
    },
    quick: "Quick actions",
    publish: "Publish a space",
    deploy: "Deploy a Worker",
    invite: "Invite a member",
    recentActivity: "Recent activity",
    recentSpaces: "Recent spaces",
    viewAll: "View all",
    noActivity: "Nothing has happened yet.",
    activity: "Activity",
    activitySub: "Every change by members, the team key, edit tokens, MCP tokens and the admin.",
    adminActivitySub: "Changes across all teams, and platform settings.",
    search: "Search",
    searchPh: "Type to filter…",
    who: "Actor",
    everyone: "Everyone",
    allTeams: "All teams",
    platform: "Platform",
    filter: "Filter",
    reset: "Reset",
    shown: (n: number) => (n === 1 ? "1 entry" : `${n} entries`),
    noMatch: "No rows match.",
    sortBy: (c: string) => `Sort by ${c}`,
    settings: "Settings",
    settingsSub: "Team details, features, quotas and your account.",
    teamInfo: "Team",
    name: "Name",
    id: "Team id",
    slug: "Workers slug",
    features: "Features",
    quotas: "Quotas and usage",
    api: "API access",
    apiNote: (p: string) =>
      `Agents use the team key (it starts with ${p}…). It was shown once when it was issued; only the admin can issue a new one, and the old one stops working at once.`,
    on: "On",
    off: "Off",
    adminOverviewSub: "The whole platform: teams, spaces, Workers and visits. Manage teams below.",
    newTeam: "New team",
    more: "More",
    dangerZone: "Danger zone",
    rotateWarn:
      "Issue a new key: it is shown once. The old key stops working immediately, so agents and scripts using it fail until they get the new one.",
    rotateConfirm:
      "Issue a new team key? The current key stops working right now. Agents and scripts that use it will fail until you give them the new key.",
    workersCol: "Workers",
    manage: "Manage",
    adminSettingsSub: "Cloudflare connection for team Workers, and how this server is configured.",
    server: "Server",
    version: "Version",
    publicUrl: "Public URL",
    backendSrv: "Data/files backend",
    healthKv: "KV store (live check)",
    healthFiles: "File store (live check)",
    healthOk: "Working",
    healthFail: "Failing",
    secretsKey: "Secrets key (MARSA_SECRETS_KEY)",
    sessions: "Session key",
    sessionsPersistent: "Set (sessions survive restarts)",
    sessionsEphemeral: "Random per start (everyone is signed out on restart)",
    limits: "Upload limits",
    defaults: "Default team quotas",
    present: "Set",
    missing: "Not set",
    cfOnSettings: "The Cloudflare token is managed in Settings.",
    openSettings: "Open settings",
    confirm: "Confirm",
    cancel: "Cancel",
    dismiss: "Dismiss",
    redeploy: "Redeploy",
    copy: "Copy",
    copied: "Copied",
    newWorker: "New Worker",
    lastDeploy: "Last deploy",
    by: "by",
    agentSnippet: "How agents use this",
    agentSnippetSub: (slug: string) =>
      `Ready to paste: the team slug (${slug}) is filled in. Put the team key in MARSA_TEAM_KEY; it never goes in a page or a repository.`,
    mcpTip:
      "Or connect a space's MCP with a read-write token: the tools list_workers, deploy_worker and delete_worker appear automatically.",
    pickTeam: "Team",
  },
  ar: {
    menu: "القائمة",
    close: "أغلق القائمة",
    publicSite: "الموقع العام",
    guide: "الدليل",
    crumbs: "مسار التنقل",
    teamArea: "لوحة الفريق",
    adminArea: "لوحة المسؤول",
    nav: {
      overview: "نظرة عامة",
      sites: "المساحات",
      workers: "الوركرات",
      mcp: "خوادم MCP",
      notes: "ملاحظات الوكلاء",
      members: "الأعضاء",
      agents: "مفاتيح الوكلاء",
      recipes: "الوصفات",
      alerts: "الإشعارات",
      activity: "سجل النشاط",
      settings: "الإعدادات",
    } as Record<string, string>,
    overview: "نظرة عامة",
    overviewSub: "فريقك في لمحة: المساحات والزيارات والأعضاء والوركرات.",
    stats: {
      spaces: "المساحات الحية",
      storage: "التخزين",
      views: "المشاهدات في آخر 30 يومًا",
      views7: (n: string) => `${n} في آخر 7 أيام`,
      members: "الأعضاء",
      invites: (n: number) => (n === 1 ? "دعوة واحدة معلّقة" : `${n} دعوات معلّقة`),
      workers: "الوركرات",
      workersOff: "غير مفعّلة لهذا الفريق",
      of: (a: string, b: string) => `${a} من ${b}`,
      teams: "الفرق",
      teamsSub: (m: number) => (m === 1 ? "عضو واحد إجمالًا" : `${m} أعضاء إجمالًا`),
      guests: (n: number) => `${n} زائر`,
      perm: (n: number) => `${n} دائم`,
      workersSub: (n: number) => (n === 1 ? "فريق واحد يستطيع النشر" : `${n} فرق تستطيع النشر`),
      downNow: "متوقفة الآن",
      allUp: "كل الوركرات المفحوصة تعمل",
      views30: "المشاهدات في آخر 30 يومًا",
    },
    quick: "إجراءات سريعة",
    publish: "انشر مساحة",
    deploy: "انشر وركر",
    invite: "ادعُ عضوًا",
    recentActivity: "آخر النشاط",
    recentSpaces: "أحدث المساحات",
    viewAll: "عرض الكل",
    noActivity: "لا يوجد نشاط بعد.",
    activity: "سجل النشاط",
    activitySub:
      "كل تغيير قام به الأعضاء أو مفتاح الفريق أو مفاتيح التعديل أو رموز MCP أو المسؤول.",
    adminActivitySub: "التغييرات في كل الفرق، وإعدادات المنصة.",
    search: "بحث",
    searchPh: "اكتب للتصفية…",
    who: "المنفّذ",
    everyone: "الكل",
    allTeams: "كل الفرق",
    platform: "المنصة",
    filter: "تصفية",
    reset: "إعادة ضبط",
    shown: (n: number) => (n === 1 ? "سجل واحد" : `${n} سجلات`),
    noMatch: "لا توجد نتائج مطابقة.",
    sortBy: (c: string) => `رتّب حسب ${c}`,
    settings: "الإعدادات",
    settingsSub: "بيانات الفريق والمزايا والحصص وحسابك.",
    teamInfo: "الفريق",
    name: "الاسم",
    id: "معرّف الفريق",
    slug: "الاسم المختصر للوركرات",
    features: "المزايا",
    quotas: "الحصص والاستخدام",
    api: "الوصول عبر الـ API",
    apiNote: (p: string) =>
      `الوكلاء تستخدم مفتاح الفريق (يبدأ بـ ${p}…). ظهر المفتاح مرة واحدة عند إصداره، والمسؤول وحده يستطيع إصدار مفتاح جديد، وعندها يتوقف القديم فورًا.`,
    on: "مفعّل",
    off: "متوقف",
    adminOverviewSub:
      "المنصة كلها: الفرق والمساحات والوركرات والزيارات. أدِر الفرق من الجدول بالأسفل.",
    newTeam: "فريق جديد",
    more: "المزيد",
    dangerZone: "منطقة الخطر",
    rotateWarn:
      "إصدار مفتاح جديد: يظهر مرة واحدة فقط، ويتوقف المفتاح القديم فورًا، فتفشل الوكلاء والسكربتات التي تستخدمه حتى تحصل على الجديد.",
    rotateConfirm:
      "تصدر مفتاحًا جديدًا للفريق؟ سيتوقف المفتاح الحالي الآن، وستفشل الوكلاء والسكربتات التي تستخدمه حتى تعطيها المفتاح الجديد.",
    workersCol: "الوركرات",
    manage: "إدارة",
    adminSettingsSub: "ربط كلاودفلير لوركرات الفرق، وإعدادات هذا الخادم.",
    server: "الخادم",
    version: "الإصدار",
    publicUrl: "العنوان العام",
    backendSrv: "خدمة البيانات والملفات",
    healthKv: "مخزن KV (فحص مباشر)",
    healthFiles: "مخزن الملفات (فحص مباشر)",
    healthOk: "يعمل",
    healthFail: "معطّل",
    secretsKey: "مفتاح التشفير (MARSA_SECRETS_KEY)",
    sessions: "مفتاح الجلسات",
    sessionsPersistent: "مضبوط (الجلسات تبقى بعد إعادة التشغيل)",
    sessionsEphemeral: "عشوائي مع كل تشغيل (يخرج الجميع عند إعادة التشغيل)",
    limits: "حدود الرفع",
    defaults: "الحصص الافتراضية للفرق",
    present: "مضبوط",
    missing: "غير مضبوط",
    cfOnSettings: "مفتاح كلاودفلير يُدار من صفحة الإعدادات.",
    openSettings: "افتح الإعدادات",
    confirm: "تأكيد",
    cancel: "إلغاء",
    dismiss: "إغلاق",
    redeploy: "أعد النشر",
    copy: "انسخ",
    copied: "تم النسخ",
    newWorker: "وركر جديد",
    lastDeploy: "آخر نشر",
    by: "بواسطة",
    agentSnippet: "كيف تستخدمه الوكلاء",
    agentSnippetSub: (slug: string) =>
      `جاهز للنسخ: الاسم المختصر للفريق (${slug}) مكتوب بالفعل. ضع مفتاح الفريق في MARSA_TEAM_KEY، ولا تضعه أبدًا في صفحة أو مستودع.`,
    mcpTip:
      "أو اربط MCP إحدى المساحات برمز قراءة وكتابة، فتظهر الأدوات list_workers وdeploy_worker وdelete_worker تلقائيًا.",
    pickTeam: "الفريق",
  },
} as const;

const ICONS: Record<string, string> = {
  overview: '<path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z"/>',
  sites:
    '<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 9h16M8 6.5h.01"/>',
  workers: '<path d="M8 9l-3 3 3 3M16 9l3 3-3 3M13.5 6l-3 12"/>',
  mcp: '<path d="M5 12h4l2-5 2 10 2-5h4"/><circle cx="12" cy="12" r="9.5"/>',
  repo: '<circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="8" r="2.2"/><path d="M6 8.2v7.6M18 10.2c0 4-6 3-11 6"/>',
  members:
    '<path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 19v-1a4 4 0 0 0-3-3.9M15.5 4.6a3 3 0 0 1 0 5.8"/>',
  activity: '<path d="M3 12h4l3 7 4-14 3 7h4"/>',
  settings:
    '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1"/>',
  teams: '<path d="M3 21V8l9-5 9 5v13M9 21v-6h6v6"/>',
  storage:
    '<path d="M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3M4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  views:
    '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12"/><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  out: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 5v16M19 19v2H6"/>',
  copy: '<path d="M9 9h10v10H9zM5 15V5h10"/>',
  agents:
    '<path d="M15 7a4 4 0 1 1-3.9 4.9L4 19v2h3v-2h2v-2h2l1.4-1.4A4 4 0 0 1 15 7zM16 10h.01"/>',
  alerts: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/>',
  recipes: '<path d="M6 3h10l4 4v14H6zM16 3v4h4M9 11h8M9 15h8M9 19h5"/>',
  key: '<path d="M14 10a4 4 0 1 0-3.5 4l1.5 1.5h2v2h2v2h3v-3l-5.1-5.1A4 4 0 0 0 14 10zM9.5 9.5h.01"/>',
  more: '<path d="M12 5.5h.01M12 12h.01M12 18.5h.01" stroke-width="3"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  open: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  redeploy: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>',
  power: '<path d="M12 3v9M6.4 6.4a8 8 0 1 0 11.2 0"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  filter: '<path d="M4 5h16l-6 8v5l-4 2v-7z"/>',
  rotate: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/>',
  health: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  notes: '<path d="M5 4h14v12l-4 4H5zM15 20v-4h4M8 9h8M8 13h5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
};
export const icon = (name: string, cls = "icon") =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] ?? ""}</svg>`;

export interface DashCtx {
  /** Team name (team area) or null (admin). */
  name: string | null;
  /** Small line under it: "Signed in as … · Owner". */
  sub: string;
}

export interface DashOpts {
  lang: Lang;
  config: Config;
  kind: "team" | "admin";
  active: string;
  title: string;
  description: string;
  path: string;
  body: string;
  csrf: string;
  ctx: DashCtx;
  /** Extra crumbs after the section (e.g. a site title). */
  crumbs?: { label: string; href?: string }[];
}

export const TEAM_NAV = [
  ["overview", "/team"],
  ["sites", "/team/sites"],
  ["workers", "/team/workers"],
  ["mcp", "/team/mcp"],
  ["notes", "/team/notes"],
  ["members", "/team/members"],
  ["agents", "/team/agents"],
  ["recipes", "/team/recipes"],
  ["alerts", "/team/notifications"],
  ["activity", "/team/activity"],
  ["settings", "/team/settings"],
] as const;
export const ADMIN_NAV = [
  ["overview", "/admin"],
  ["sites", "/admin/sites"],
  ["workers", "/admin/workers"],
  ["mcp", "/admin/mcp"],
  ["notes", "/admin/notes"],
  ["activity", "/admin/activity"],
  ["recipes", "/admin/recipes"],
  ["alerts", "/admin/notifications"],
  ["settings", "/admin/settings"],
] as const;

/** 0.16.0: global search (⌘K) and the getting-started checklist. */
export const K16 = {
  en: {
    search: "Search",
    searchLabel: "Search the dashboard",
    searchPh: "Spaces, Workers, MCP servers, notes, docs…",
    searchNone: "No results",
    searchHint: "↑ ↓ to move · Enter to open · Esc to close",
    searchFail: "Search failed. Try again.",
    checklist: "Getting started",
    checklistSub: (done: number, all: number) => `${done} of ${all} done`,
    dismiss: "Hide",
    dismissLabel: "Hide the getting-started checklist",
    stepSpace: "Publish your first space",
    stepSpaceHelp: "Drop a folder or a .zip below, or let an agent publish it.",
    stepMember: "Invite a teammate",
    stepMemberHelp: "Each person gets their own sign-in and role.",
    stepAgent: "Create an agent key",
    stepAgentHelp: "Give each agent a scoped, expiring key instead of the team key.",
    stepWorker: "Deploy a Worker",
    stepWorkerHelp: "APIs, webhooks and MCP servers, without a Cloudflare key.",
    stepDocs: "Read the guide for agents",
    stepDocsHelp: "A prompt and snippets so an agent can publish and return a link.",
    done: "Done",
    todo: "To do",
  },
  ar: {
    search: "بحث",
    searchLabel: "البحث في اللوحة",
    searchPh: "المساحات والوركرات وخوادم MCP والملاحظات والتوثيق…",
    searchNone: "لا نتائج",
    searchHint: "↑ ↓ للتنقل · Enter للفتح · Esc للإغلاق",
    searchFail: "تعذّر البحث. حاول مرة أخرى.",
    checklist: "خطوات البدء",
    checklistSub: (done: number, all: number) =>
      `${done.toLocaleString("ar-EG")} من ${all.toLocaleString("ar-EG")} مكتملة`,
    dismiss: "إخفاء",
    dismissLabel: "إخفاء قائمة خطوات البدء",
    stepSpace: "انشر أول مساحة",
    stepSpaceHelp: "أفلت مجلدًا أو ملف zip أدناه، أو دع وكيلًا ينشرها.",
    stepMember: "ادعُ زميلًا",
    stepMemberHelp: "لكل شخص دخوله ودوره الخاص.",
    stepAgent: "أنشئ مفتاح وكيل",
    stepAgentHelp: "أعطِ كل وكيل مفتاحًا محدد الصلاحيات ينتهي، بدل مفتاح الفريق.",
    stepWorker: "انشر وركر",
    stepWorkerHelp: "واجهات API وWebhooks وخوادم MCP، بلا مفتاح Cloudflare.",
    stepDocs: "اقرأ دليل الوكلاء",
    stepDocsHelp: "تعليمات ومقتطفات ليتمكن الوكيل من النشر وإعادة رابط.",
    done: "مكتملة",
    todo: "لم تكتمل",
  },
};

export interface ChecklistStep {
  key: "space" | "member" | "agent" | "worker" | "docs";
  done: boolean;
  href: string;
}

/** The team overview's getting-started card (0.16.0). Hidden when every step is done. */
export function checklistHtml(
  lang: Lang,
  steps: ChecklistStep[],
  o: { csrf: string; canDismiss: boolean },
): string {
  const k = K16[lang];
  const doneN = steps.filter((x) => x.done).length;
  if (!steps.length || doneN === steps.length) return "";
  const label = (key: ChecklistStep["key"]) =>
    ({
      space: [k.stepSpace, k.stepSpaceHelp],
      member: [k.stepMember, k.stepMemberHelp],
      agent: [k.stepAgent, k.stepAgentHelp],
      worker: [k.stepWorker, k.stepWorkerHelp],
      docs: [k.stepDocs, k.stepDocsHelp],
    })[key];
  const items = steps
    .map((x) => {
      const [title, help] = label(x.key);
      return `<li class="check-step${x.done ? " is-done" : ""}"><span class="check-mark" aria-hidden="true">${x.done ? "✓" : ""}</span><div><a href="${esc(localePath(lang, x.href))}">${esc(title ?? "")}</a><span class="sr-only"> (${esc(x.done ? k.done : k.todo)})</span><span class="meta">${esc(help ?? "")}</span></div></li>`;
    })
    .join("");
  const hide = o.canDismiss
    ? postForm(
        localePath(lang, "/team/checklist/hide"),
        o.csrf,
        `<button class="button ghost small" type="submit" aria-label="${esc(k.dismissLabel)}">${esc(k.dismiss)}</button>`,
      )
    : "";
  const pct = Math.round((doneN / steps.length) * 100);
  return `<section class="card checklist" aria-labelledby="checklist-h">
  <div class="checklist-head"><div><h2 id="checklist-h" class="h3">${esc(k.checklist)}</h2><p class="meta">${esc(k.checklistSub(doneN, steps.length))}</p></div>${hide}</div>
  <progress class="checklist-bar" max="100" value="${pct}" aria-label="${esc(k.checklistSub(doneN, steps.length))}">${pct}%</progress>
  <ol class="check-steps">${items}</ol>
</section>`;
}

/** The ⌘K button for the top bar and its dialog (filled by app.js from /team|admin/search). */
function searchUi(lang: Lang, kind: "team" | "admin"): { button: string; dialog: string } {
  const k = K16[lang];
  const url = localePath(lang, kind === "team" ? "/team/search" : "/admin/search");
  return {
    button: `<button type="button" class="search-open js-only" data-search-open aria-haspopup="dialog" aria-controls="search-dialog">${icon("search")}<span class="search-open-text">${esc(k.search)}</span><kbd data-search-kbd>Ctrl K</kbd></button>`,
    dialog: `<dialog class="search-dialog" id="search-dialog" aria-label="${esc(k.searchLabel)}" data-url="${esc(url)}" data-none="${esc(k.searchNone)}" data-fail="${esc(k.searchFail)}">
  <div class="search-box">${icon("search")}<label class="sr-only" for="search-q">${esc(k.searchLabel)}</label><input id="search-q" type="search" role="combobox" aria-expanded="false" aria-controls="search-results" aria-autocomplete="list" autocomplete="off" spellcheck="false" maxlength="100" placeholder="${esc(k.searchPh)}"><kbd>Esc</kbd></div>
  <ul id="search-results" class="search-results" role="listbox" aria-label="${esc(k.searchLabel)}"></ul>
  <p class="search-status meta" role="status" aria-live="polite"></p>
  <p class="search-hint meta">${esc(k.searchHint)}</p>
</dialog>`,
  };
}

/** The signed-in app shell: top bar, sidebar navigation (a drawer on phones), breadcrumbs. */
/**
 * 0.16.0: one title format for every dashboard page: "<page> · <team name> · Marsa Spaces"
 * for teams and "<page> · Admin · Marsa Spaces" (AR "· الإدارة ·") for the admin.
 */
export function dashTitle(o: Pick<DashOpts, "lang" | "kind" | "title" | "ctx">): string {
  const t = STRINGS[o.lang];
  const tail = ` · ${t.product}`;
  const area = o.kind === "admin" ? t.admin.eyebrow : (o.ctx.name ?? "");
  if (!area || o.title.includes(` · ${area} · `) || o.title === `${area}${tail}`) return o.title;
  const head = o.title.endsWith(tail) ? o.title.slice(0, -tail.length) : o.title;
  return `${head} · ${area}${tail}`;
}

export function dashLayout(o: DashOpts): string {
  const t = STRINGS[o.lang];
  const d = DS[o.lang];
  const other: Lang = o.lang === "en" ? "ar" : "en";
  const href = (p: string) => localePath(o.lang, p);
  const nav = (o.kind === "team" ? TEAM_NAV : ADMIN_NAV)
    .map(
      ([k, p]) =>
        `<li><a href="${href(p)}"${k === o.active ? ' aria-current="page"' : ""}>${icon(k === "overview" && o.kind === "admin" ? "teams" : k)}<span>${esc(d.nav[k] ?? k)}</span></a></li>`,
    )
    .join("");
  const area = o.kind === "team" ? d.teamArea : d.adminArea;
  const home = href(o.kind === "team" ? "/team" : "/admin");
  const crumbs = [
    { label: area, href: home },
    ...(o.active === "overview" && !o.crumbs?.length
      ? []
      : [
          {
            label: d.nav[o.active] ?? o.title,
            ...(o.crumbs?.length
              ? {
                  href: href(
                    (
                      (o.kind === "team" ? TEAM_NAV : ADMIN_NAV) as readonly (readonly [
                        string,
                        string,
                      ])[]
                    ).find(([k]) => k === o.active)?.[1] ?? "/",
                  ),
                }
              : {}),
          },
        ]),
    ...(o.crumbs ?? []),
  ];
  const crumbHtml = `<nav class="crumbs" aria-label="${esc(d.crumbs)}"><ol>${crumbs
    .map((c, i) =>
      i === crumbs.length - 1
        ? `<li><span aria-current="location"><bdi>${esc(c.label)}</bdi></span></li>`
        : `<li><a href="${esc(c.href ?? "#")}"><bdi>${esc(c.label)}</bdi></a></li>`,
    )
    .join("")}</ol></nav>`;
  const su = searchUi(o.lang, o.kind);
  const ctx = `<div class="side-ctx"><span class="side-avatar" aria-hidden="true">${esc(initialOf(o.ctx.name ?? "M"))}</span><div><strong>${o.ctx.name ? `<bdi>${esc(o.ctx.name)}</bdi>` : esc(area)}</strong>${o.ctx.sub ? `<span class="meta">${esc(o.ctx.sub)}</span>` : ""}</div></div>`;
  return `<!doctype html>
<html lang="${o.lang}" dir="${t.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(dashTitle(o))}</title>
<meta name="description" content="${esc(o.description)}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#145a49">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/assets/fonts/zad/Zad-Regular.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/app.css?v=${ASSET_VERSION}">
</head>
<body class="dash-body">
<a class="skip" href="#main">${esc(t.skip)}</a>
<header class="dash-top">
  <button type="button" class="nav-toggle js-only" data-nav-toggle aria-controls="dash-nav" aria-expanded="false"><span aria-hidden="true" class="burger"></span><span class="sr-only">${esc(d.menu)}</span></button>
  <a class="wordmark" href="${href("/")}" aria-label="${esc(`${t.product}: ${t.nav.home}`)}">${brandMark(o.lang)}</a>
  <span class="dash-area">${esc(area)}</span>
  <div class="dash-top-tools">
    ${su.button}
    <!--marsa:bell:${o.kind}:${o.lang}-->
    <a class="locale-link" href="${localePath(other, o.path)}" hreflang="${other}" lang="${other}">${esc(t.switchLabel)}</a>
  </div>
</header>
<div class="dash">
  <aside class="dash-side" id="dash-nav" aria-label="${esc(area)}">
    ${ctx}
    <nav class="side-nav" aria-label="${esc(area)}"><ul>${nav}</ul></nav>
    <div class="side-foot">
      <a href="${href("/")}">${icon("ext")}<span>${esc(d.publicSite)}</span></a>
      <a href="${href(o.lang === "ar" ? "/docs/guide" : "/docs/teams")}">${icon("book")}<span>${esc(d.guide)}</span></a>
      ${postForm(href("/logout"), o.csrf, `<button class="side-out" type="submit">${icon("out")}<span>${esc(t.common.signOut)}</span></button>`, { cls: "side-out-form" })}
    </div>
  </aside>
  <div class="dash-scrim" data-nav-close hidden></div>
  <main id="main" class="dash-main" tabindex="-1">
    ${crumbHtml}
    ${o.body}
  </main>
</div>
<div class="toasts" id="toasts" role="status" aria-live="polite"></div>
${su.dialog}
<dialog class="confirm-dialog" id="confirm-dialog" aria-labelledby="confirm-text">
  <form method="dialog">
    <p id="confirm-text"></p>
    <div class="actions"><button class="button ghost" value="cancel" type="submit">${esc(d.cancel)}</button><button class="button danger" value="ok" type="submit" data-ok>${esc(d.confirm)}</button></div>
  </form>
</dialog>
<script src="/assets/app.js?v=${ASSET_VERSION}" type="module"></script>
</body>
</html>`;
}

/** A stat card: label, big value, optional sub line and progress bar. */
export function statCard(
  ic: string,
  label: string,
  value: string,
  sub = "",
  bar?: { value: number; max: number },
  link?: string,
): string {
  const pct = bar && bar.max > 0 ? Math.min(100, Math.round((bar.value / bar.max) * 100)) : 0;
  const meter = bar
    ? `<progress class="quota${pct >= 90 ? " full" : pct >= 70 ? " high" : ""}" max="100" value="${pct}" aria-label="${esc(`${label}: ${pct}%`)}">${pct}%</progress>`
    : "";
  const inner = `<div class="stat-head">${icon(ic)}<span>${esc(label)}</span></div><div class="stat-value">${value}</div>${meter}${sub ? `<div class="stat-sub">${sub}</div>` : ""}`;
  return link
    ? `<a class="stat-card" href="${esc(link)}">${inner}</a>`
    : `<div class="stat-card">${inner}</div>`;
}

/** Sortable header cell (the script adds the button behaviour). */
export const sortTh = (label: string, kind: "text" | "num" | "date" = "text") =>
  `<th scope="col" data-sort="${kind}">${esc(label)}</th>`;

/** A compact activity feed (newest first). */
export function activityFeed(lang: Lang, rows: AuditView[], withSite = true): string {
  const t = STRINGS[lang];
  if (!rows.length) return `<p class="meta">${esc(DS[lang].noActivity)}</p>`;
  return `<ol class="feed">${rows
    .map((e) => {
      const what =
        t.members.actions[e.action] ??
        (e.action.startsWith("mcp:") ? `MCP · ${e.action.slice(4)}` : e.action);
      const who = e.kind === "member" ? e.who : actorText(lang, e.who);
      const site =
        withSite && e.site
          ? ` · <a class="text-link" href="${localePath(lang, `/team/sites/${e.site.id}`)}"><bdi>${esc(e.site.title)}</bdi></a>`
          : "";
      return `<li><span class="feed-dot k-${esc(e.kind)}" aria-hidden="true"></span><div><p><strong><bdi>${esc(who)}</bdi></strong> ${esc(what)}${e.detail && !/^\d{4}-\d\d-\d\dT/.test(e.detail) ? ` <span class="meta"><bdi>${esc(detailText(lang, e.detail))}</bdi></span>` : ""}${site}</p>${timeTag(lang, e.at)}</div></li>`;
    })
    .join("")}</ol>`;
}

// ---- 0.14.0: versions, agent keys, notifications, privacy --------------------------------

export const V14 = {
  en: {
    version: "Version",
    status: "Status",
    rowActions: "Actions",
    versions: "Versions",
    noVersion: "No stored version — the next deploy will be saved",
    newCode: "Deploy new code",
    note: "Note (optional)",
    noteHelp: "Stored with this version, e.g. what changed. Up to 200 characters.",
    versionsSub: (n: string) =>
      `The last 10 deploys of ${n}: one-click redeploy, roll back, or download the code.`,
    current: "Current",
    when: "When",
    who: "By",
    action: "Action",
    size: "Size",
    sha: "SHA-256",
    env: "Vars and secrets",
    actions: { deploy: "Deploy", redeploy: "Redeploy", rollback: "Rollback" } as Record<
      string,
      string
    >,
    rolledFrom: (n: number) => `from v${n}`,
    rollback: "Roll back to this",
    rollbackConfirm: (n: number) =>
      `Deploy version ${n} again? Its code and vars replace the current ones; secrets stay as they are.`,
    download: "Download code",
    redeployed: "Redeployed.",
    rolledBack: (n: number) => `Rolled back to v${n}.`,
    missingSecrets: (k: string) =>
      `Rolled back. This version also used secrets that are not set now: ${k}`,
    secretsNote: "Secret values are never stored: only their names.",
    privacy: "Privacy",
    // agent keys
    agentsSub:
      "Scoped API keys for agents and tools. Each key has an expiry and only the scopes you pick.",
    keysTitle: "Agent keys",
    keyName: "Name",
    keyDesc: "Description (optional)",
    scopes: "Scopes",
    expiry: "Expires in",
    days: (n: number) => `${n} days`,
    customDays: "Custom (days)",
    customHelp: `Required. 1 to ${EXPIRY_MAX_DAYS} days.`,
    create: "Create key",
    createTitle: "New agent key",
    createInvite: "Create invite link",
    inviteTitle: "Invite an agent",
    inviteSub:
      "A one-time link, valid 24 hours. The agent opens it for instructions and claims its own key once; then the link stops working.",
    keyCreated: "Agent key created.",
    keySecret: "Your new agent key",
    keyNote: "Copy it now: it is shown only once. Spaces stores only a hash.",
    inviteCreated: "Invite link created.",
    inviteLabel: "Agent invite link",
    inviteNote:
      "Shown once. Send it to the agent over a private channel; it works once, for 24 hours.",
    revoke: "Revoke",
    revokeConfirm: "Revoke this agent key? Agents using it stop working at once.",
    revoked: "Key revoked.",
    cancelInvite: "Cancel",
    prefix: "Key",
    lastUsed: "Last used",
    never: "Never",
    expires: "Expires",
    state: { active: "Active", expired: "Expired", revoked: "Revoked" } as Record<string, string>,
    noKeys: "No agent keys yet.",
    noKeysSub: "Create one for an agent, or send it an invite link.",
    openInvites: "Open invite links",
    viaInvite: "via invite",
    ownersOnly: "Only team owners can manage agent keys.",
    scopeHelp: {
      "workers:read": "List Workers, versions and code",
      "workers:deploy": "Deploy, redeploy, roll back and delete Workers",
      "workers:secrets": "Set, rotate and delete Worker secrets (write-only)",
      "spaces:read": "List and read the team's spaces",
      "spaces:write": "Publish, replace, extend and delete spaces",
      "kv:read": "Read KV values and uploaded files",
      "kv:write": "Write KV values and files",
      mcp: "Use a space's MCP server with this key",
    } as Record<string, string>,
    // notifications
    alertsSub: "Deploys, rollbacks, keys, members and security events. Newest first.",
    adminAlertsSub: "Every team's alerts plus platform events (Cloudflare token, storage checks).",
    unread: (n: number) => (n === 1 ? "1 unread" : `${n} unread`),
    noAlerts: "No notifications yet.",
    noAlertsSub: "Deploys, key changes and member changes show up here.",
    markRead: "Mark all as read",
    bell: (n: number) => (n ? `Notifications: ${n} unread` : "Notifications"),
    webhook: "Outgoing webhook",
    webhookSub:
      "Optional. Each notification is POSTed as JSON with `text` and `content` (Slack and Discord read these), signed with HMAC-SHA256 in X-Marsa-Signature. Up to 3 attempts.",
    adminWebhookSub:
      "Optional. Receives every notification on the platform. Same JSON and signature as team webhooks.",
    webhookUrl: "Webhook URL (https)",
    saveHook: "Save webhook",
    testHook: "Send test",
    removeHook: "Remove",
    removeHookConfirm: "Remove this webhook?",
    hookSaved: "Webhook saved.",
    hookSecret: "Signing secret",
    hookSecretNote:
      'Shown once. Verify X-Marsa-Signature = sha256=HMAC(secret, timestamp + "." + body).',
    hookRemoved: "Webhook removed.",
    hookTestOk: (s: number) => `Test delivered (HTTP ${s}).`,
    hookTestFail: (s: number | null) => `Test failed${s ? ` (HTTP ${s})` : " (no response)"}.`,
    hookNone: "No webhook set.",
    lastDelivery: "Last delivery",
    ok: "OK",
    failed: "Failed",
    platform: "Platform",
  },
  ar: {
    version: "الإصدار",
    status: "الحالة",
    rowActions: "إجراءات",
    versions: "الإصدارات",
    noVersion: "لا يوجد إصدار محفوظ — سيُحفظ النشر القادم",
    newCode: "انشر كودًا جديدًا",
    note: "ملاحظة (اختيارية)",
    noteHelp: "تُحفظ مع هذا الإصدار، مثل ما الذي تغيّر. حتى 200 حرف.",
    versionsSub: (n: string) =>
      `آخر 10 عمليات نشر لـ ${n}: إعادة نشر بنقرة، أو رجوع لإصدار سابق، أو تنزيل الكود.`,
    current: "الحالي",
    when: "متى",
    who: "بواسطة",
    action: "العملية",
    size: "الحجم",
    sha: "SHA-256",
    env: "المتغيرات والأسرار",
    actions: { deploy: "نشر", redeploy: "إعادة نشر", rollback: "رجوع" } as Record<string, string>,
    rolledFrom: (n: number) => `من v${n}`,
    rollback: "ارجع لهذا الإصدار",
    rollbackConfirm: (n: number) =>
      `هل تنشر الإصدار ${n} من جديد؟ سيحل كوده ومتغيراته محل الحالية، وتبقى الأسرار كما هي.`,
    download: "نزّل الكود",
    redeployed: "تمت إعادة النشر.",
    rolledBack: (n: number) => `تم الرجوع إلى v${n}.`,
    missingSecrets: (k: string) => `تم الرجوع. هذا الإصدار كان يستخدم أسرارًا غير موجودة الآن: ${k}`,
    secretsNote: "قيم الأسرار لا تُحفظ أبدًا: أسماؤها فقط.",
    privacy: "الخصوصية",
    agentsSub:
      "مفاتيح API محددة الصلاحيات للوكلاء والأدوات. لكل مفتاح تاريخ انتهاء والصلاحيات التي تختارها فقط.",
    keysTitle: "مفاتيح الوكلاء",
    keyName: "الاسم",
    keyDesc: "الوصف (اختياري)",
    scopes: "الصلاحيات",
    expiry: "ينتهي بعد",
    days: (n: number) => (n === 7 ? "7 أيام" : `${n} يومًا`),
    customDays: "مدة مخصصة (بالأيام)",
    customHelp: `مطلوب. من يوم إلى ${EXPIRY_MAX_DAYS} يومًا.`,
    create: "أنشئ المفتاح",
    createTitle: "مفتاح وكيل جديد",
    createInvite: "أنشئ رابط دعوة",
    inviteTitle: "ادعُ وكيلًا",
    inviteSub:
      "رابط يُستخدم مرة واحدة وصالح 24 ساعة. يفتحه الوكيل ليقرأ التعليمات ثم يستلم مفتاحه مرة واحدة، وبعدها يتوقف الرابط.",
    keyCreated: "تم إنشاء مفتاح الوكيل.",
    keySecret: "مفتاح الوكيل الجديد",
    keyNote: "انسخه الآن: يظهر مرة واحدة فقط. لا نحفظ إلا بصمته (hash).",
    inviteCreated: "تم إنشاء رابط الدعوة.",
    inviteLabel: "رابط دعوة الوكيل",
    inviteNote: "يظهر مرة واحدة. أرسله للوكيل عبر قناة خاصة؛ يعمل مرة واحدة خلال 24 ساعة.",
    revoke: "ألغِ",
    revokeConfirm: "هل تلغي مفتاح الوكيل هذا؟ سيتوقف أي وكيل يستخدمه فورًا.",
    revoked: "تم إلغاء المفتاح.",
    cancelInvite: "ألغِ",
    prefix: "المفتاح",
    lastUsed: "آخر استخدام",
    never: "لم يُستخدم",
    expires: "ينتهي",
    state: { active: "فعّال", expired: "منتهي", revoked: "ملغى" } as Record<string, string>,
    noKeys: "لا توجد مفاتيح وكلاء بعد.",
    noKeysSub: "أنشئ مفتاحًا لوكيل، أو أرسل له رابط دعوة.",
    openInvites: "روابط دعوة مفتوحة",
    viaInvite: "عبر دعوة",
    ownersOnly: "إدارة مفاتيح الوكلاء لمالكي الفريق فقط.",
    scopeHelp: {
      "workers:read": "عرض الوركرات وإصداراتها وكودها",
      "workers:deploy": "نشر الوركرات وإعادة نشرها والرجوع بها وحذفها",
      "workers:secrets": "إضافة أسرار الوركرات وتغييرها وحذفها (كتابة فقط)",
      "spaces:read": "عرض مساحات الفريق وقراءتها",
      "spaces:write": "نشر المساحات واستبدالها وتمديدها وحذفها",
      "kv:read": "قراءة قيم KV والملفات المرفوعة",
      "kv:write": "كتابة قيم KV والملفات",
      mcp: "استخدام خادم MCP لأي مساحة بهذا المفتاح",
    } as Record<string, string>,
    alertsSub: "عمليات النشر والرجوع والمفاتيح والأعضاء وأحداث الأمان. الأحدث أولًا.",
    adminAlertsSub: "إشعارات كل الفرق مع أحداث المنصة (رمز Cloudflare وفحوص التخزين).",
    unread: (n: number) => (n === 1 ? "واحد غير مقروء" : `${n} غير مقروءة`),
    noAlerts: "لا توجد إشعارات بعد.",
    noAlertsSub: "تظهر هنا عمليات النشر وتغييرات المفاتيح والأعضاء.",
    markRead: "علّم الكل كمقروء",
    bell: (n: number) => (n ? `الإشعارات: ${n} غير مقروءة` : "الإشعارات"),
    webhook: "Webhook صادر",
    webhookSub:
      "اختياري. يُرسل كل إشعار بطلب POST بصيغة JSON فيه الحقلان text وcontent (يقرؤهما Slack وDiscord)، وموقّع بـ HMAC-SHA256 في الترويسة X-Marsa-Signature. حتى 3 محاولات.",
    adminWebhookSub: "اختياري. يستقبل كل إشعارات المنصة، بنفس صيغة JSON والتوقيع.",
    webhookUrl: "رابط الـ Webhook (https)",
    saveHook: "احفظ الـ Webhook",
    testHook: "أرسل تجربة",
    removeHook: "احذف",
    removeHookConfirm: "هل تحذف هذا الـ Webhook؟",
    hookSaved: "تم حفظ الـ Webhook.",
    hookSecret: "سر التوقيع",
    hookSecretNote:
      'يظهر مرة واحدة. تحقق من X-Marsa-Signature = sha256=HMAC(السر، الطابع الزمني + "." + المحتوى).',
    hookRemoved: "تم حذف الـ Webhook.",
    hookTestOk: (s: number) => `وصلت التجربة (HTTP ${s}).`,
    hookTestFail: (s: number | null) => `فشلت التجربة${s ? ` (HTTP ${s})` : " (لا رد)"}.`,
    hookNone: "لا يوجد Webhook.",
    lastDelivery: "آخر إرسال",
    ok: "نجح",
    failed: "فشل",
    platform: "المنصة",
  },
};

/** The bell in the top bar (filled in per request by the web routes). */
export function bellHtml(lang: Lang, kind: "team" | "admin", unread: number): string {
  const v = V14[lang];
  const to = localePath(lang, kind === "team" ? "/team/notifications" : "/admin/notifications");
  const n = unread > 99 ? "99+" : String(unread);
  return `<a class="bell${unread ? " has-unread" : ""}" href="${to}" aria-label="${esc(v.bell(unread))}">${icon("alerts")}${unread ? `<span class="bell-count" aria-hidden="true">${esc(n)}</span>` : ""}</a>`;
}

/** Scope checkboxes + expiry radios for the key and invite forms. */
function keyFields(lang: Lang, idp: string): string {
  const v = V14[lang];
  const scopes = SCOPES.map(
    (sc) =>
      `<label class="check"><input type="checkbox" name="scopes" value="${sc}"${sc === "spaces:read" || sc === "workers:read" ? " checked" : ""}><span><code class="ltr">${esc(sc)}</code> <span class="meta">${esc(v.scopeHelp[sc] ?? "")}</span></span></label>`,
  ).join("");
  const presets = [7, 30, 90]
    .map(
      (n) =>
        `<label class="check inline"><input type="radio" name="expiry" value="${n}"${n === 30 ? " checked" : ""}><span>${esc(v.days(n))}</span></label>`,
    )
    .join("");
  return `<label for="${idp}-name">${esc(v.keyName)}</label>
      <input id="${idp}-name" name="name" type="text" required maxlength="60" autocomplete="off">
      <label for="${idp}-desc">${esc(v.keyDesc)}</label>
      <input id="${idp}-desc" name="description" type="text" maxlength="300" autocomplete="off">
      <fieldset class="scope-set"><legend>${esc(v.scopes)}</legend>${scopes}</fieldset>
      <fieldset class="expiry-set"><legend>${esc(v.expiry)}</legend>${presets}
        <label class="check inline"><input type="radio" name="expiry" value="custom"><span>${esc(v.customDays)}</span></label>
        <input class="days-input" name="customDays" type="number" min="1" max="${EXPIRY_MAX_DAYS}" inputmode="numeric" aria-label="${esc(v.customDays)}" aria-describedby="${idp}-exp-help">
        <p class="form-help" id="${idp}-exp-help">${esc(v.customHelp)}</p>
      </fieldset>`;
}

export interface TeamAgentsOpts extends TeamPageOpts {
  keys: AgentKeyView[];
  invites: AgentInviteView[];
  isOwner: boolean;
}

export function teamAgentsHtml(lang: Lang, c: Config, o: TeamAgentsOpts): string {
  const t = STRINGS[lang];
  const v = V14[lang];
  const href = (p: string) => localePath(lang, p);
  const scopeTags = (xs: string[]) =>
    xs.map((x) => `<code class="ltr scope">${esc(x)}</code>`).join(" ");
  const table = o.keys.length
    ? dataTable({
        lang,
        id: "agent-keys",
        caption: v.keysTitle,
        headLabel: v.keyName,
        cols: agentKeyCols(lang),
        rows: agentKeyRows(lang, o.keys, {
          ...(o.isOwner
            ? { revokeAction: (k: AgentKeyView) => href(`/team/agents/${k.id}/revoke`) }
            : {}),
        }),
        csrf: o.csrf,
        empty: v.noKeys,
        filters: [keyStateFilter(lang, o.keys)],
      })
    : emptyState(v.noKeys, v.noKeysSub);
  const invites = o.invites.length
    ? `<section class="block" aria-labelledby="inv-title"><h2 id="inv-title" class="h3">${esc(v.openInvites)} <span class="count">${o.invites.length}</span></h2><ul class="plain-list">${o.invites
        .map(
          (i) =>
            `<li><strong><bdi>${esc(i.name)}</bdi></strong> <code class="ltr">${esc(i.prefix)}…</code> ${scopeTags(i.scopes)} <span class="meta">${esc(v.expires)} ${timeTag(lang, i.expiresAt)}</span> ${o.isOwner ? postForm(href(`/team/agents/invites/${i.id}/cancel`), o.csrf, `<button class="button small ghost" type="submit">${esc(v.cancelInvite)}</button>`) : ""}</li>`,
        )
        .join("")}</ul></section>`
    : "";
  const forms = o.isOwner
    ? `<section class="block two-col" aria-label="${esc(v.createTitle)}">
    <form method="post" action="${href("/team/agents")}" class="panel key-form">
      ${csrfField(o.csrf)}
      <h2 class="h3">${icon("agents")} ${esc(v.createTitle)}</h2>
      ${keyFields(lang, "k")}
      <button class="button" type="submit">${esc(v.create)}</button>
    </form>
    <form method="post" action="${href("/team/agents/invite")}" class="panel key-form">
      ${csrfField(o.csrf)}
      <h2 class="h3">${icon("plus")} ${esc(v.inviteTitle)}</h2>
      <p class="meta">${esc(v.inviteSub)}</p>
      ${keyFields(lang, "i")}
      <button class="button ghost" type="submit">${esc(v.createInvite)}</button>
    </form>
  </section>`
    : `<p class="notice">${esc(v.ownersOnly)}</p>`;
  const body = `<div class="page-wide">
  ${teamHead(lang, o, v.agentsSub, "agents")}
  ${flashBox(lang, o.flash)}
  <section class="block" aria-labelledby="keys-title">
    <h2 id="keys-title">${esc(v.keysTitle)} <span class="count">${esc(String(o.keys.filter((k) => k.state === "active").length))}</span></h2>
    ${table}
  </section>
  ${invites}
  ${forms}
</div>`;
  return dashLayout({
    lang,
    config: c,
    kind: "team",
    active: "agents",
    title: `${v.keysTitle} · ${o.team.name} · ${t.product}`,
    description: v.agentsSub,
    path: "/team/agents",
    body,
    csrf: o.csrf,
    ctx: teamCtx(lang, o),
  });
}

export interface NoticeRow extends Notice {
  unread: boolean;
  teamName?: string | null;
}

function noticeList(lang: Lang, rows: NoticeRow[], withTeam: boolean): string {
  const v = V14[lang];
  return `<ol class="notice-list">${rows
    .map((n) => {
      const team =
        withTeam && n.teamName !== undefined
          ? `<span class="badge muted"><bdi>${esc(n.teamName ?? v.platform)}</bdi></span> `
          : "";
      return `<li class="notice-item tone-${noticeTone(n.kind)}${n.unread ? " unread" : ""}"><span class="notice-dot" aria-hidden="true"></span><div><p>${team}<bdi>${esc(noticeText(lang, n))}</bdi>${n.unread ? ` <span class="sr-only">(${esc(v.unread(1))})</span>` : ""}</p>${timeTag(lang, n.at)}</div></li>`;
    })
    .join("")}</ol>`;
}

function webhookCard(
  lang: Lang,
  hook: WebhookView | null,
  action: string,
  csrf: string,
  sub: string,
  canManage: boolean,
): string {
  const v = V14[lang];
  const last = hook?.last
    ? `<p class="meta">${esc(v.lastDelivery)}: <span class="badge ${hook.last.ok ? "on" : "warn"}">${esc(hook.last.ok ? v.ok : v.failed)}</span> ${hook.last.status ? `HTTP ${hook.last.status}` : ""} · ${timeTag(lang, hook.last.at)}</p>`
    : "";
  const current = hook
    ? `<p><code class="ltr">${esc(hook.url.replace(/(https?:\/\/[^/]+\/).{6,}$/, "$1…"))}</code></p>${last}${
        canManage
          ? `<div class="acts">${postForm(`${action}/test`, csrf, `<button class="button small ghost" type="submit" data-busy>${esc(v.testHook)}</button>`)}${postForm(`${action}/delete`, csrf, `<button class="button small danger" type="submit">${esc(v.removeHook)}</button>`, { confirm: v.removeHookConfirm })}</div>`
          : ""
      }`
    : `<p class="meta">${esc(v.hookNone)}</p>`;
  const form = canManage
    ? `<form method="post" action="${action}" class="stack-form">${csrfField(csrf)}<label for="hook-url">${esc(v.webhookUrl)}</label><input id="hook-url" name="url" type="url" dir="ltr" required maxlength="500" placeholder="https://hooks.slack.com/services/…" autocomplete="off"><button class="button small" type="submit">${esc(v.saveHook)}</button></form>`
    : "";
  return `<section class="block panel" aria-labelledby="hook-title"><h2 id="hook-title" class="h3">${esc(v.webhook)}</h2><p class="meta">${esc(sub)}</p>${current}${form}</section>`;
}

export interface NotificationsOpts {
  notices: NoticeRow[];
  unread: number;
  hook: WebhookView | null;
  canManage: boolean;
  csrf: string;
  flash?: Flash | null;
}

export function teamNotificationsHtml(
  lang: Lang,
  c: Config,
  o: TeamPageOpts & NotificationsOpts,
): string {
  const t = STRINGS[lang];
  const v = V14[lang];
  const href = (p: string) => localePath(lang, p);
  const list = o.notices.length
    ? noticeList(lang, o.notices, false)
    : emptyState(v.noAlerts, v.noAlertsSub);
  const body = `<div class="page-wide">
  ${teamHead(lang, o, v.alertsSub, "alerts", o.unread ? postForm(href("/team/notifications/read"), o.csrf, `<button class="button small ghost" type="submit">${esc(v.markRead)}</button>`) : "")}
  ${flashBox(lang, o.flash)}
  <div class="alerts-grid">
  <section class="block" aria-labelledby="alerts-title">
    <h2 id="alerts-title">${esc(DS[lang].nav.alerts ?? "")} ${o.unread ? `<span class="count">${esc(v.unread(o.unread))}</span>` : ""}</h2>
    ${list}
  </section>
  ${webhookCard(lang, o.hook, href("/team/notifications/webhook"), o.csrf, v.webhookSub, o.canManage)}
  </div>
</div>`;
  return dashLayout({
    lang,
    config: c,
    kind: "team",
    active: "alerts",
    title: `${DS[lang].nav.alerts} · ${o.team.name} · ${t.product}`,
    description: v.alertsSub,
    path: "/team/notifications",
    body,
    csrf: o.csrf,
    ctx: teamCtx(lang, o),
  });
}

export function adminNotificationsHtml(lang: Lang, c: Config, o: NotificationsOpts): string {
  const t = STRINGS[lang];
  const v = V14[lang];
  const href = (p: string) => localePath(lang, p);
  const list = o.notices.length
    ? noticeList(lang, o.notices, true)
    : emptyState(v.noAlerts, v.noAlertsSub);
  const body = `<div class="page-wide">
  ${pageHead(t.admin.eyebrow, esc(DS[lang].nav.alerts ?? ""), v.adminAlertsSub, adminTools(lang, "activity", o.csrf, o.unread ? postForm(href("/admin/notifications/read"), o.csrf, `<button class="button small ghost" type="submit">${esc(v.markRead)}</button>`) : ""))}
  ${flashBox(lang, o.flash)}
  <div class="alerts-grid">
  <section class="block" aria-labelledby="alerts-title">
    <h2 id="alerts-title">${esc(DS[lang].nav.alerts ?? "")} ${o.unread ? `<span class="count">${esc(v.unread(o.unread))}</span>` : ""}</h2>
    ${list}
  </section>
  ${webhookCard(lang, o.hook, href("/admin/notifications/webhook"), o.csrf, v.adminWebhookSub, true)}
  </div>
</div>`;
  return dashLayout({
    lang,
    config: c,
    kind: "admin",
    active: "alerts",
    title: `${DS[lang].nav.alerts} · ${t.product}`,
    description: v.adminAlertsSub,
    path: "/admin/notifications",
    body,
    csrf: o.csrf,
    ctx: ADMIN_CTX(lang),
  });
}

/**
 * The privacy policy (GDPR). Every statement describes what this code does; who operates
 * the instance comes from config.operator (OPERATOR_* variables, marsaplatform by default).
 */
type PolicySection = [string, string[]];

function privacyText(
  lang: Lang,
  op: Operator,
): { title: string; sub: string; updated: string; sections: PolicySection[] } {
  const auth = op.authority.url ? `${op.authority[lang]}, ${op.authority.url}` : op.authority[lang];
  // 0.16.0: the DPA reference stays a clearly marked placeholder until the operator confirms it.
  const dpa = op.cloudflareDpa
    ? lang === "en"
      ? `The agreement with Cloudflare: ${op.cloudflareDpa}.`
      : `الاتفاقية مع Cloudflare: ${op.cloudflareDpa}.`
    : lang === "en"
      ? "[PLACEHOLDER: reference to the Cloudflare Data Processing Addendum, not yet confirmed by the operator]"
      : "[مكان محجوز: مرجع ملحق معالجة البيانات لدى Cloudflare، لم يؤكده المشغّل بعد]";
  if (lang === "en")
    return {
      title: "Privacy policy",
      sub: "What this Marsa Spaces instance stores, why, for how long, who else handles it, and your rights under the EU General Data Protection Regulation (GDPR). It describes what the software does.",
      updated: "Last updated: 21 October 2026 (version 0.16.0)",
      sections: [
        [
          "Who is responsible (data controller)",
          [
            `Data controller: ${op.name.en}`,
            `Address: ${op.address.en}`,
            `Privacy contact: ${op.email}`,
            `Applicable law and jurisdiction: ${op.law.en}`,
          ],
        ],
        [
          "What you publish",
          [
            "The files you upload (HTML, CSS, images and so on) are stored on this server and served publicly at the site's link until it expires or is deleted. Anyone with the link can see them, and sites of teams that allow it are listed on the home page.",
            "Expired sites are deleted automatically, with their files, their visit counts and their data. Permanent sites stay until they are deleted.",
            "When you publish, you get an edit token. Only a SHA-256 hash of it is stored.",
          ],
        ],
        [
          "Accounts and teams",
          [
            "There is no email sign-up. A team member has a username, a display name and a password; the password is stored only as an scrypt hash.",
            "Team keys, invite links, MCP tokens and agent keys are shown once and stored only as SHA-256 hashes, with a short prefix so you can tell them apart.",
            "Each team has an activity log of the last 500 actions (who did what and when), visible to its members and the admin.",
            "Notifications (deploys, key and member changes) are kept for the team's owners and the admin, the newest 200 per team.",
            "Agent notes: agents and members can leave short notes for the team (at most 2000 characters, with anything that looks like a key or password redacted before it is stored). The newest 500 per team are kept.",
            "Ended sessions: when you sign out (or someone signs everyone out), the server keeps the session's id, or the time of the sign-out-everywhere, until the session would have expired, so the cookie stops working even after a restart.",
          ],
        ],
        [
          "Cookies",
          [
            "Signing in sets one session cookie (httpOnly, SameSite=Lax, Secure on https). It is strictly necessary for the sign-in to work. It expires after 7 days for teams and 12 hours for the admin by default, and signing out removes it.",
            "There are no advertising or tracking cookies. Public pages and published sites set no cookies.",
          ],
        ],
        [
          "Visit counts",
          [
            "Page views are counted per site and per day on this server. No cookies are used and no IP address or user agent is stored.",
            "Visitors are estimated with a hash of an hourly random salt, the site, the IP and the user agent. The salt is kept only in memory and replaced every hour, so the hashes cannot be linked or recomputed. Only daily totals are kept, for 90 days by default.",
            "Visitors who send Do Not Track or Global Privacy Control are counted as views only. Bots and link previews are not counted.",
          ],
        ],
        [
          "IP addresses",
          [
            "IP addresses are used in memory for rate limits (uploads, sign-in attempts, invite links) and are not written to disk by the application.",
            "When an agent key is used, a keyed hash (HMAC with a server secret) of the network it came from (IPv4 /24 or IPv6 /64) is kept with the key, at most 20 networks, to warn the team when the key is used from a new network. The IP address itself is not stored.",
            "If a team turns on API keys for a Worker, Spaces stores each end-user key as a SHA-256 hash with a prefix, the label and optional email the team entered, its limits and allowed tools, and request counts per day (kept 7 days) plus the last-use time. The caller's IP is not stored for these keys. The Worker sends the key to Spaces to check it on each request (or, if the team turns it on, from a short cache).",
            "Team recipes (markdown written by the team) are stored on the server and shown only to that team; built-in and platform recipes are public.",
          ],
        ],
        [
          "Team Workers",
          [
            "Each deploy is stored as a version on this server: the code, the plain variables, the names of the secrets, who deployed it, when, its size and SHA-256, and an optional note. The last 10 versions per Worker are kept and deleted with the Worker.",
            "Secret values are never stored by Spaces: they go straight to Cloudflare and only their names are kept.",
            "Health checks: if a team keeps them on, Spaces requests each Worker's address (or sends an MCP initialize call) every few minutes and stores the time, result, status code and response time. Single checks are kept 7 days and daily totals 31 days; they are deleted with the Worker.",
            "Logs and analytics: for the Worker pages, Spaces reads request counts, errors, CPU time and recent log lines from Cloudflare. They are kept only in memory for a few minutes, and anything that looks like a key or password is redacted before it is shown.",
            "Repository checks: if a team links a Worker or space to a GitHub repository, Spaces asks GitHub's public API whether the repository is public and whether the deployed commit is the newest one. GitHub receives the repository name and the server's IP address; the answers are cached in memory.",
          ],
        ],
        [
          "Purposes and legal bases",
          [
            "Running the service you or your team use (accounts, sign-in, publishing sites, Workers, keys, data and files, notifications and webhooks): performance of a contract or steps before one (Art. 6(1)(b) GDPR).",
            "Security and abuse prevention (rate limits, the activity log, new-network alerts for agent keys, hashed keys and tokens): our legitimate interest in keeping the service and its users safe (Art. 6(1)(f) GDPR).",
            "Anonymous daily visit totals shown to site owners: our legitimate interest in giving site owners basic statistics without tracking people (Art. 6(1)(f) GDPR).",
            "End-user API keys: a team may enter a label and an optional email for each key. The team decides whether to enter them and should tell those people; Spaces uses them only to show them to the team and run the key checks.",
          ],
        ],
        [
          "Service providers (processors) and recipients",
          [
            "Cloudflare: if the admin enables the data and files backend, KV values and uploaded files of allowed sites are stored with Cloudflare (Workers KV and R2). Team Workers are deployed to Cloudflare's network through the platform's Cloudflare account, and Cloudflare stores their code, plain variables and secrets.",
            "This site, including the signed-in dashboards, is served through Cloudflare, which adds its Web Analytics script (static.cloudflareinsights.com). It counts page views and measures load times without cookies; Cloudflare receives the page address, the referrer, the browser type and your IP address. Fonts and other assets are served from this server.",
            "Backups: once a day the whole data folder (accounts with hashed passwords, keys as hashes, activity, notes, Worker code and versions, settings) is encrypted on this server with AES-256-GCM and stored in Cloudflare R2. Cloudflare cannot read it; the key is not stored with the backups.",
            "GitHub: only for repository checks (above), and only for repositories a team links.",
            "Outgoing webhooks send notification text (team name, who did what) only to the URLs the team owner or admin sets.",
            "Published sites are public by design: anyone with the link can see them.",
          ],
        ],
        [
          "International transfers",
          [
            "Cloudflare runs a global network, so data handled by Cloudflare (above) may be processed outside the European Economic Area. Such transfers rely on the safeguards in Cloudflare's data processing terms, such as the EU Standard Contractual Clauses.",
            dpa,
            "GitHub is based in the United States; repository checks send it only the repository name and the server's IP address.",
          ],
        ],
        [
          "How long data is kept",
          [
            "Sites: until they expire or are deleted. Accounts, keys and team recipes: until they are deleted or revoked, or the team is deleted.",
            "Visit totals: 90 days by default. Activity log: the last 500 actions per team. Notifications: the newest 200 per team. Worker versions: the last 10 per Worker. End-user key counts: 7 days.",
            "Session cookies: 7 days (teams) or 12 hours (admin) at most. Rate-limit data stays in memory only.",
            "Health checks: 7 days (daily totals 31 days). Agent notes: the newest 500 per team. Worker logs and analytics: a few minutes, in memory.",
            "Deleted teams: kept for 7 days so the admin can restore them, then deleted for good. The export made at deletion is kept 30 more days, then deleted.",
            "Backups: 14 daily and 8 weekly copies, so deleted data can remain in an encrypted backup for up to about 8 weeks before it rotates out.",
          ],
        ],
        [
          "Security",
          [
            "The platform's Cloudflare API token and webhook signing secrets are encrypted at rest with AES-256-GCM, using a key that is not stored with the data.",
            "Keys and tokens are stored only as hashes (SHA-256), and passwords as scrypt hashes.",
            "Daily backups are encrypted with AES-256-GCM before they leave the server, checked after every upload, and a restore can be tested without touching live data.",
            "Agent keys carry scopes (for example workers:read or spaces:write) and a required expiry of at most one year; calls outside a key's scopes are refused. Keys can be revoked at any time.",
            "Webhooks are signed with HMAC-SHA256. Published sites run in a sandbox with a strict content security policy, separate from the app.",
          ],
        ],
        [
          "Your rights",
          [
            "You can delete your sites, KV values and files, and revoke keys and tokens from the dashboard or the API at any time. A team owner can remove members and sign the whole team out everywhere; the admin can export a team (a portable zip) and delete it, which removes its members, keys, notifications, notes and Workers after a 7-day grace period.",
            "Under the GDPR you have the right to access your personal data, to have it corrected or erased, to restrict its processing, to receive it in a portable format, and to object to processing based on legitimate interests (Articles 15 to 21).",
            `To use these rights, write to ${op.email}. We answer within one month, as the GDPR requires.`,
            `You also have the right to lodge a complaint with a data protection supervisory authority: ${auth}.`,
          ],
        ],
      ],
    };
  return {
    title: "سياسة الخصوصية",
    sub: "ما الذي تحفظه نسخة Marsa Spaces هذه، ولماذا، وإلى متى، ومن يتعامل معه أيضًا، وحقوقك بموجب اللائحة الأوروبية العامة لحماية البيانات (GDPR). تصف السياسة ما يفعله البرنامج فعليًا.",
    updated: "آخر تحديث: 21 أكتوبر 2026 (الإصدار 0.16.0)",
    sections: [
      [
        "المسؤول عن البيانات (المتحكّم)",
        [
          `المتحكّم في البيانات: ${op.name.ar}`,
          `العنوان: ${op.address.ar}`,
          `التواصل بشأن الخصوصية: ${op.email}`,
          `القانون والاختصاص القضائي: ${op.law.ar}`,
        ],
      ],
      [
        "ما تنشره",
        [
          "الملفات التي ترفعها (HTML وCSS والصور وغيرها) تُحفظ على هذا الخادم وتُعرض علنًا على رابط الموقع حتى تنتهي مدته أو يُحذف. يستطيع أي شخص لديه الرابط رؤيتها، وتظهر مواقع الفرق التي تسمح بذلك في الصفحة الرئيسية.",
          "تُحذف المواقع المنتهية تلقائيًا مع ملفاتها وعدّاد زياراتها وبياناتها. المواقع الدائمة تبقى حتى تُحذف.",
          "عند النشر تحصل على رمز تعديل، ولا نحفظ إلا بصمته (SHA-256).",
        ],
      ],
      [
        "الحسابات والفرق",
        [
          "لا يوجد تسجيل بالبريد الإلكتروني. لعضو الفريق اسم مستخدم واسم ظاهر وكلمة مرور تُحفظ كبصمة scrypt فقط.",
          "مفاتيح الفرق وروابط الدعوة ورموز MCP ومفاتيح الوكلاء تظهر مرة واحدة وتُحفظ كبصمات SHA-256 فقط، مع بادئة قصيرة للتمييز بينها.",
          "لكل فريق سجل نشاط بآخر 500 عملية (من فعل ماذا ومتى) يراه أعضاؤه والمدير.",
          "تُحفظ الإشعارات (النشر وتغييرات المفاتيح والأعضاء) لمالكي الفريق والمدير، آخر 200 إشعار لكل فريق.",
          "ملاحظات الوكلاء: يمكن للوكلاء والأعضاء ترك ملاحظات قصيرة للفريق (2000 حرف على الأكثر، ويُحجب قبل الحفظ كل ما يشبه مفتاحًا أو كلمة مرور). تُحفظ آخر 500 ملاحظة لكل فريق.",
          "الجلسات المنتهية: عند تسجيل الخروج (أو إخراج الجميع من كل الأجهزة) يحفظ الخادم معرّف الجلسة، أو وقت الإخراج الشامل، حتى موعد انتهاء الجلسة، فيتوقف الكوكي حتى بعد إعادة التشغيل.",
        ],
      ],
      [
        "ملفات تعريف الارتباط (الكوكيز)",
        [
          "تسجيل الدخول يضع كوكي جلسة واحدًا (httpOnly وSameSite=Lax وSecure على https)، وهو ضروري لعمل تسجيل الدخول. تنتهي افتراضيًا بعد 7 أيام للفرق و12 ساعة للمدير، ويحذفها تسجيل الخروج.",
          "لا توجد كوكيز إعلانية أو للتتبع. الصفحات العامة والمواقع المنشورة لا تضع أي كوكيز.",
        ],
      ],
      [
        "عدّ الزيارات",
        [
          "تُعدّ مشاهدات الصفحات لكل موقع ولكل يوم على هذا الخادم، بلا كوكيز، ولا يُحفظ عنوان IP ولا بيانات المتصفح.",
          "يُقدَّر عدد الزوار ببصمة من ملح عشوائي يتغير كل ساعة مع الموقع وعنوان IP وبيانات المتصفح. الملح في الذاكرة فقط ويُستبدل كل ساعة، فلا يمكن ربط البصمات أو إعادة حسابها. تُحفظ المجاميع اليومية فقط، لمدة 90 يومًا افتراضيًا.",
          "من يرسل Do Not Track أو Global Privacy Control يُعدّ مشاهدة فقط. لا تُعدّ الروبوتات ومعاينات الروابط.",
        ],
      ],
      [
        "عناوين IP",
        [
          "تُستخدم عناوين IP في الذاكرة لحدود المعدل (الرفع ومحاولات الدخول وروابط الدعوة) ولا يكتبها التطبيق على القرص.",
          "عند استخدام مفتاح وكيل تُحفظ مع المفتاح بصمة مفتاحية (HMAC بسر الخادم) للشبكة التي جاء منها الطلب (IPv4 ‏/24 أو IPv6 ‏/64)، 20 شبكة على الأكثر، لتنبيه الفريق إذا استُخدم المفتاح من شبكة جديدة. لا يُحفظ العنوان نفسه.",
          "إذا فعّل فريق مفاتيح API لوركر، تحفظ مساحات كل مفتاح للمستخدمين كبصمة SHA-256 مع بادئة، والاسم والبريد الاختياري اللذين أدخلهما الفريق، وحدوده وأدواته المسموحة، وعدد الطلبات لكل يوم (لمدة 7 أيام) ووقت آخر استخدام. لا يُحفظ عنوان IP للمتصل لهذه المفاتيح. يرسل الوركر المفتاح إلى مساحات للتحقق منه في كل طلب (أو من ذاكرة مؤقتة قصيرة إن فعّلها الفريق).",
          "وصفات الفريق (نصوص markdown يكتبها الفريق) تُحفظ على الخادم وتظهر لذلك الفريق فقط؛ الوصفات المدمجة ووصفات المنصة عامة.",
        ],
      ],
      [
        "وركرات الفرق",
        [
          "كل نشر يُحفظ كإصدار على هذا الخادم: الكود والمتغيرات العادية وأسماء الأسرار ومن نشره ومتى وحجمه وبصمته SHA-256 وملاحظة اختيارية. تُحفظ آخر 10 إصدارات لكل وركر وتُحذف معه.",
          "لا تحفظ Spaces قيم الأسرار أبدًا: تذهب مباشرة إلى Cloudflare ونحفظ أسماءها فقط.",
          "فحوص الصحة: إذا أبقاها الفريق مفعّلة، تطلب مساحات عنوان كل وركر (أو ترسل طلب MCP initialize) كل بضع دقائق وتحفظ الوقت والنتيجة ورمز الحالة وزمن الاستجابة. تُحفظ الفحوص المفردة 7 أيام والمجاميع اليومية 31 يومًا، وتُحذف مع الوركر.",
          "السجلات والإحصاءات: لصفحات الوركرات تقرأ مساحات من Cloudflare عدد الطلبات والأخطاء ووقت المعالج وآخر سطور السجل. تبقى في الذاكرة فقط لبضع دقائق، ويُحجب قبل العرض كل ما يشبه مفتاحًا أو كلمة مرور.",
          "فحص المستودعات: إذا ربط فريق وركر أو مساحة بمستودع GitHub، تسأل مساحات الـ API العامة لـ GitHub إن كان المستودع عامًا وإن كان الـ commit المنشور هو الأحدث. يصل إلى GitHub اسم المستودع وعنوان IP للخادم، وتُحفظ الإجابات مؤقتًا في الذاكرة.",
        ],
      ],
      [
        "الأغراض والأسس القانونية",
        [
          "تشغيل الخدمة التي تستخدمها أنت أو فريقك (الحسابات وتسجيل الدخول ونشر المواقع والوركرات والمفاتيح والبيانات والملفات والإشعارات والـ Webhooks): تنفيذ عقد أو خطوات تسبقه (المادة 6(1)(ب) من GDPR).",
          "الأمان ومنع إساءة الاستخدام (حدود المعدل وسجل النشاط وتنبيهات الشبكات الجديدة لمفاتيح الوكلاء وحفظ المفاتيح والرموز كبصمات): مصلحتنا المشروعة في حماية الخدمة ومستخدميها (المادة 6(1)(و) من GDPR).",
          "مجاميع الزيارات اليومية المجهولة التي يراها أصحاب المواقع: مصلحتنا المشروعة في تقديم إحصاءات أساسية دون تتبع الأشخاص (المادة 6(1)(و) من GDPR).",
          "مفاتيح API للمستخدمين: يمكن للفريق إدخال اسم وبريد اختياري لكل مفتاح. الفريق يقرر إدخالهما وعليه إبلاغ أصحابهما؛ وتستخدمهما مساحات فقط لعرضهما على الفريق وللتحقق من المفاتيح.",
        ],
      ],
      [
        "مزودو الخدمة (المعالجون) والجهات المتلقية",
        [
          "Cloudflare: إذا فعّل المدير خلفية البيانات والملفات، تُحفظ قيم KV والملفات المرفوعة للمواقع المسموح لها لدى Cloudflare ‏(Workers KV وR2). وتُنشر وركرات الفرق على شبكة Cloudflare عبر حساب Cloudflare الخاص بالمنصة، وتحفظ Cloudflare كودها ومتغيراتها وأسرارها.",
          "يُقدَّم هذا الموقع، ومنه لوحات التحكم بعد تسجيل الدخول، عبر Cloudflare التي تضيف سكربت Web Analytics الخاص بها (static.cloudflareinsights.com). يعدّ مشاهدات الصفحات ويقيس سرعة التحميل بلا كوكيز، ويصل إلى Cloudflare عنوان الصفحة والصفحة السابقة ونوع المتصفح وعنوان IP. الخطوط وبقية الملفات تُقدَّم من هذا الخادم.",
          "النسخ الاحتياطية: مرة كل يوم يُشفَّر مجلد البيانات كاملًا (الحسابات بكلمات مرور مبصومة، والمفاتيح كبصمات، والنشاط والملاحظات وكود الوركرات وإصداراتها والإعدادات) على هذا الخادم بـ AES-256-GCM ويُحفظ في Cloudflare R2. لا تستطيع Cloudflare قراءته، والمفتاح لا يُحفظ مع النسخ.",
          "GitHub: لفحص المستودعات فقط (أعلاه)، وللمستودعات التي يربطها فريق فقط.",
          "ترسل الـ Webhooks الصادرة نص الإشعار (اسم الفريق ومن فعل ماذا) فقط إلى الروابط التي يحددها مالك الفريق أو المدير.",
          "المواقع المنشورة عامة بطبيعتها: يستطيع أي شخص لديه الرابط رؤيتها.",
        ],
      ],
      [
        "النقل الدولي للبيانات",
        [
          "تشغّل Cloudflare شبكة عالمية، لذا قد تُعالَج البيانات التي تتعامل معها Cloudflare (أعلاه) خارج المنطقة الاقتصادية الأوروبية. يستند هذا النقل إلى الضمانات الواردة في شروط معالجة البيانات لدى Cloudflare، مثل البنود التعاقدية القياسية للاتحاد الأوروبي.",
          dpa,
          "مقر GitHub في الولايات المتحدة؛ ولا يرسل إليه فحص المستودعات إلا اسم المستودع وعنوان IP للخادم.",
        ],
      ],
      [
        "مدة الاحتفاظ بالبيانات",
        [
          "المواقع: حتى تنتهي مدتها أو تُحذف. الحسابات والمفاتيح ووصفات الفريق: حتى تُحذف أو تُلغى أو يُحذف الفريق.",
          "مجاميع الزيارات: 90 يومًا افتراضيًا. سجل النشاط: آخر 500 عملية لكل فريق. الإشعارات: آخر 200 لكل فريق. إصدارات الوركر: آخر 10 لكل وركر. عدّادات مفاتيح المستخدمين: 7 أيام.",
          "كوكي الجلسة: 7 أيام (للفرق) أو 12 ساعة (للمدير) على الأكثر. بيانات حدود المعدل في الذاكرة فقط.",
          "فحوص الصحة: 7 أيام (المجاميع اليومية 31 يومًا). ملاحظات الوكلاء: آخر 500 لكل فريق. سجلات الوركرات وإحصاءاتها: بضع دقائق في الذاكرة.",
          "الفرق المحذوفة: تبقى 7 أيام ليستطيع المدير استعادتها، ثم تُحذف نهائيًا. ويبقى التصدير المأخوذ عند الحذف 30 يومًا أخرى ثم يُحذف.",
          "النسخ الاحتياطية: 14 نسخة يومية و8 أسبوعية، لذا قد تبقى البيانات المحذوفة في نسخة مشفّرة نحو 8 أسابيع على الأكثر قبل أن تُستبدل.",
        ],
      ],
      [
        "الأمان",
        [
          "رمز Cloudflare الخاص بالمنصة وأسرار توقيع الـ Webhooks مشفّرة أثناء التخزين بـ AES-256-GCM بمفتاح لا يُحفظ مع البيانات.",
          "المفاتيح والرموز تُحفظ كبصمات فقط (SHA-256)، وكلمات المرور كبصمات scrypt.",
          "النسخ الاحتياطية اليومية تُشفَّر بـ AES-256-GCM قبل أن تغادر الخادم، ويُتحقَّق منها بعد كل رفع، ويمكن اختبار الاستعادة دون لمس البيانات الحية.",
          "لمفاتيح الوكلاء صلاحيات محددة (مثل workers:read أو spaces:write) وتاريخ انتهاء إلزامي لا يتجاوز سنة، ويُرفض أي طلب خارج صلاحيات المفتاح. ويمكن إلغاء المفاتيح في أي وقت.",
          "الـ Webhooks موقّعة بـ HMAC-SHA256. المواقع المنشورة تعمل في بيئة معزولة بسياسة أمان صارمة ومنفصلة عن التطبيق.",
        ],
      ],
      [
        "حقوقك",
        [
          "تستطيع حذف مواقعك وقيم KV والملفات، وإلغاء المفاتيح والرموز، من لوحة التحكم أو الـ API في أي وقت. يستطيع مالك الفريق إزالة الأعضاء وإخراج الفريق كله من كل الأجهزة، ويستطيع المدير تصدير فريق (ملف zip قابل للنقل) وحذفه، فتُحذف أعضاؤه ومفاتيحه وإشعاراته وملاحظاته ووركراته بعد مهلة 7 أيام.",
          "بموجب GDPR لك الحق في الاطلاع على بياناتك الشخصية، وتصحيحها أو محوها، وتقييد معالجتها، والحصول عليها بصيغة قابلة للنقل، والاعتراض على المعالجة القائمة على المصلحة المشروعة (المواد 15 إلى 21).",
          `لممارسة هذه الحقوق راسلنا على ${op.email}. نرد خلال شهر واحد كما تشترط اللائحة.`,
          `ولك أيضًا الحق في تقديم شكوى إلى سلطة رقابية لحماية البيانات: ${auth}.`,
        ],
      ],
    ],
  };
}

/** Escape a policy line, then turn the contact email and authority URL into links. */
function policyLine(x: string, op: Operator): string {
  let h = esc(x);
  const mail = esc(op.email);
  if (op.email)
    h = h
      .split(mail)
      // email_off: keep the address readable (Cloudflare would otherwise obfuscate it behind JS).
      .join(
        `<!--email_off--><a class="text-link ltr" dir="ltr" href="mailto:${mail}">${mail}</a><!--/email_off-->`,
      );
  const url = op.authority.url;
  if (url && /^https:\/\/[^\s"<>]+$/.test(url))
    h = h
      .split(esc(url))
      .join(
        `<a class="text-link ltr" dir="ltr" href="${esc(url)}" rel="noopener">${esc(url.replace(/^https:\/\//, ""))}</a>`,
      );
  return h;
}

export function privacyHtml(lang: Lang, c: Config): string {
  const op = c.operator;
  const p = privacyText(lang, op);
  const shieldAt = p.sections.findIndex(([h]) => h === (lang === "en" ? "Security" : "الأمان"));
  const sections = p.sections
    .map(
      ([h, items], i) =>
        `<section class="policy-section" aria-labelledby="p-${i}"><h2 id="p-${i}">${i === shieldAt ? `${icon("shield")} ` : ""}${esc(h)}</h2><ul>${items
          .map((x) =>
            x.startsWith("[")
              ? `<li><mark class="policy-placeholder">${esc(x)}</mark></li>`
              : `<li>${policyLine(x, op)}</li>`,
          )
          .join("")}</ul></section>`,
    )
    .join("");
  const body = `<div class="wrap page-narrow policy">
  ${pageHead(STRINGS[lang].product, esc(p.title), p.sub)}
  <p class="meta">${esc(p.updated)}</p>
  ${sections}
</div>`;
  return layout({
    lang,
    title: `${p.title} · ${STRINGS[lang].product}`,
    description: p.sub,
    path: "/privacy",
    body,
    config: c,
  });
}

// ---- 0.14.0: recipes + Worker API keys ---------------------------------------------------

export const R14 = {
  en: {
    recipes: "Recipes",
    recipesSub:
      "Step-by-step playbooks for agents and people: goal, when to use, steps, a starter template, a checklist and common pitfalls.",
    publicSub:
      "Built-in playbooks that worked for real Marsa projects. Agents can fetch them as markdown from the API or the space MCP.",
    scope: { builtin: "Built-in", platform: "Platform", team: "Team" } as Record<string, string>,
    version: (n: number) => `v${n}`,
    updated: "Updated",
    view: "Open",
    edit: "Edit",
    newRecipe: "New team recipe",
    newPlatform: "New platform recipe",
    slug: "Slug (a-z, 0-9, -)",
    titleEn: "Title (English)",
    titleAr: "Title (Arabic)",
    summaryEn: "Summary (English)",
    summaryAr: "Summary (Arabic)",
    bodyEn: "Body: markdown (English)",
    bodyAr: "Body: markdown (Arabic)",
    tags: "Tags (comma separated)",
    save: "Save recipe",
    del: "Delete",
    delConfirm: "Delete this recipe?",
    saved: (v: number) => `Recipe saved (v${v}).`,
    deleted: "Recipe deleted.",
    readOnly: "Built-in and platform recipes are read-only here.",
    viewerOnly: "Only owners and editors can write team recipes.",
    apiHint: "For agents",
    apiText:
      "GET /api/recipes and /api/recipes/<slug>?lang=ar|en&format=md; space MCP: list_recipes, get_recipe.",
    none: "No recipes yet.",
    english: "English",
    arabic: "العربية",
    onlyIn: (l: string) => `Only available in ${l}.`,
    back: "All recipes",
    sectionsHelp:
      "Use the sections: Goal, When to use, Steps, Starter template, Checklist before deploy, Common pitfalls.",
  },
  ar: {
    recipes: "الوصفات",
    recipesSub:
      "أدلة خطوة بخطوة للوكلاء والناس: الهدف، متى تُستخدم، الخطوات، قالب للبدء، قائمة تحقق، وأخطاء شائعة.",
    publicSub:
      "أدلة جاهزة نجحت في مشاريع مرسى فعلية. يستطيع الوكلاء جلبها كـ markdown من الـ API أو من MCP المساحة.",
    scope: { builtin: "مدمجة", platform: "المنصة", team: "الفريق" } as Record<string, string>,
    version: (n: number) => `الإصدار ${n}`,
    updated: "آخر تحديث",
    view: "افتح",
    edit: "عدّل",
    newRecipe: "وصفة جديدة للفريق",
    newPlatform: "وصفة جديدة للمنصة",
    slug: "المعرّف (a-z و0-9 و-)",
    titleEn: "العنوان (إنجليزي)",
    titleAr: "العنوان (عربي)",
    summaryEn: "الملخص (إنجليزي)",
    summaryAr: "الملخص (عربي)",
    bodyEn: "النص: markdown (إنجليزي)",
    bodyAr: "النص: markdown (عربي)",
    tags: "الوسوم (مفصولة بفواصل)",
    save: "احفظ الوصفة",
    del: "احذف",
    delConfirm: "حذف هذه الوصفة؟",
    saved: (v: number) => `حُفظت الوصفة (الإصدار ${v}).`,
    deleted: "حُذفت الوصفة.",
    readOnly: "الوصفات المدمجة ووصفات المنصة للقراءة فقط هنا.",
    viewerOnly: "يكتب وصفات الفريق المالكون والمحررون فقط.",
    apiHint: "للوكلاء",
    apiText:
      "GET /api/recipes و‎/api/recipes/<slug>?lang=ar|en&format=md؛ وفي MCP المساحة: list_recipes وget_recipe.",
    none: "لا وصفات بعد.",
    english: "English",
    arabic: "العربية",
    onlyIn: (l: string) => `متاحة بـ ${l} فقط.`,
    back: "كل الوصفات",
    sectionsHelp:
      "استعملوا الأقسام: الهدف، متى تستخدمها، الخطوات، القالب، قائمة التحقق قبل النشر، أخطاء شائعة.",
  },
};

const recipeCards = (lang: Lang, list: RecipeSummary[], hrefOf: (r: RecipeSummary) => string) => {
  const r14 = R14[lang];
  if (!list.length) return `<p class="meta">${esc(r14.none)}</p>`;
  return `<div class="card-grid docs-grid recipe-grid">${list
    .map((r) => {
      const dir = r.langs.includes(lang)
        ? lang === "ar"
          ? "rtl"
          : "ltr"
        : r.langs[0] === "ar"
          ? "rtl"
          : "ltr";
      return `<a class="card doc-card recipe-card" href="${esc(hrefOf(r))}" dir="${dir}"><div class="recipe-meta"><span class="badge ${r.scope === "team" ? "on" : "muted"}">${esc(r14.scope[r.scope] ?? r.scope)}</span> <span class="meta">${esc(r14.version(r.version))}</span></div><h2 class="h3"><bdi>${esc(r.title)}</bdi></h2><p><bdi>${esc(r.summary)}</bdi></p>${r.tags.length ? `<p class="recipe-tags">${r.tags.map((t) => `<code class="ltr">${esc(t)}</code>`).join(" ")}</p>` : ""}</a>`;
    })
    .join("")}</div>`;
};

/** Public: /docs/recipes */
/** 0.15.1: "hit a problem? leave a note" on the recipes pages (public and dashboard). */
export function notesCallout(lang: Lang, dash?: "team" | "admin"): string {
  const ar = lang === "ar";
  const guide = localePath(lang, "/docs/recipes/agent-notes");
  const page = dash ? localePath(lang, dash === "team" ? "/team/notes" : "/admin/notes") : "";
  return `<aside class="panel notes-callout" aria-label="${ar ? "ملاحظات الوكلاء" : "Agent notes"}">${icon("notes")}<div><strong>${ar ? "واجهتكم مشكلة أو وصفة غير واضحة؟" : "Hit a problem, or a recipe is unclear?"}</strong> ${
    ar
      ? 'اتركوا ملاحظة للمسؤول من أي مرحلة: <code class="ltr">POST /api/teams/&lt;team&gt;/notes</code> أو أداة MCP <code class="ltr">leave_note</code>.'
      : 'Leave a note for the admin at any stage: <code class="ltr">POST /api/teams/&lt;team&gt;/notes</code> or the MCP tool <code class="ltr">leave_note</code>.'
  } <a class="text-link" href="${guide}">${ar ? "كيف؟" : "How"}</a>${page ? ` · <a class="text-link" href="${page}">${ar ? "ملاحظات الوكلاء" : "Agent notes"}</a>` : ""}</div></aside>`;
}

export function recipesIndexHtml(lang: Lang, c: Config, list: RecipeSummary[]): string {
  const t = STRINGS[lang];
  const r14 = R14[lang];
  const body = `<div class="wrap page-wide">${pageHead(t.footer.product, esc(r14.recipes), r14.publicSub)}
${notesCallout(lang)}
${recipeCards(lang, list, (r) => localePath(lang, `/docs/recipes/${r.slug}`))}
<p class="meta recipe-api"><strong>${esc(r14.apiHint)}:</strong> <code class="ltr">${esc(r14.apiText)}</code></p>
</div>`;
  return layout({
    lang,
    title: `${r14.recipes} · ${t.product}`,
    description: r14.publicSub,
    path: "/docs/recipes",
    body,
    config: c,
    active: "docs",
  });
}

function recipeArticle(lang: Lang, r: Recipe, html: string, served: Lang, h = "h1"): string {
  const r14 = R14[lang];
  const title = (r.title[served] ?? r.title.en ?? r.title.ar ?? r.slug) as string;
  const summary = (r.summary[served] ?? "") as string;
  const other: Lang = served === "ar" ? "en" : "ar";
  const note =
    served !== lang
      ? `<p class="notice">${esc(r14.onlyIn(served === "ar" ? r14.arabic : r14.english))}</p>`
      : "";
  const alt = r.body[other] && served === lang ? "" : "";
  return `${note}<article class="prose recipe" lang="${served}" dir="${served === "ar" ? "rtl" : "ltr"}"><${h}>${esc(title)}</${h}>${summary ? `<p class="lead">${esc(summary)}</p>` : ""}<p class="meta"><span class="badge muted">${esc(r14.scope[r.scope] ?? r.scope)}</span> ${esc(r14.version(r.version))}${r.updatedAt ? ` · ${esc(r14.updated)} ${esc(r.updatedAt.slice(0, 10))}` : ""} · <code class="ltr">${esc(r.slug)}</code></p>${alt}${html}</article>`;
}

/** Public: /docs/recipes/:slug */
export function recipePageHtml(
  lang: Lang,
  c: Config,
  r: Recipe,
  html: string,
  served: Lang,
  list: RecipeSummary[],
  starter?: { name: string; zip: string; tree: string; count: number } | null,
): string {
  const t = STRINGS[lang];
  const r14 = R14[lang];
  const st = starter
    ? `<section class="panel starter-box" aria-labelledby="starter-h">
    <h2 class="h3" id="starter-h">${icon("download")} ${esc(lang === "ar" ? "القالب الجاهز للتنزيل" : "Starter template")}</h2>
    <p class="meta">${esc(lang === "ar" ? `${starter.count} ملفًا، تبني وتنجح اختباراتها. فكّوا الضغط، ثم npm install وnpm run check.` : `${starter.count} files that build and pass their own tests. Unzip, then npm install and npm run check.`)}</p>
    <p><a class="button" href="${esc(starter.zip)}" download>${icon("download")} <bdi dir="ltr">${esc(starter.name)}.zip</bdi></a></p>
    <details><summary>${esc(lang === "ar" ? "هيكل الملفات" : "File tree")}</summary><pre tabindex="0" dir="ltr" class="tree"><code>${esc(starter.tree)}</code></pre></details>
  </section>`
    : "";
  const nav = `<nav class="docs-nav" aria-label="${esc(r14.recipes)}"><ul>${list
    .map(
      (x) =>
        `<li><a href="${localePath(lang, `/docs/recipes/${x.slug}`)}"${x.slug === r.slug ? ' aria-current="page"' : ""}><bdi>${esc(x.title)}</bdi></a></li>`,
    )
    .join("")}</ul></nav>`;
  const body = `<div class="wrap docs-layout">
  <aside>${nav}<p><a class="text-link" href="${localePath(lang, "/docs/recipes")}">${esc(r14.back)}</a></p></aside>
  <div>${st}${recipeArticle(lang, r, html, served)}${notesCallout(lang)}</div>
</div>`;
  return layout({
    lang,
    title: `${(r.title[served] ?? r.slug) as string} · ${r14.recipes} · ${t.product}`,
    description: (r.summary[served] ?? "") as string,
    path: `/docs/recipes/${r.slug}`,
    body,
    config: c,
    active: "docs",
  });
}

function recipeForm(
  lang: Lang,
  action: string,
  csrf: string,
  r: Recipe | null,
  skeleton: { en: string; ar: string },
): string {
  const r14 = R14[lang];
  const v = (x: string | undefined) => esc(x ?? "");
  return `<form method="post" action="${action}" class="panel stack-form recipe-form">
  ${csrfField(csrf)}
  <h2 class="h3">${icon("recipes")} ${esc(r ? `${r14.edit}: ${r.slug}` : r14.newRecipe)}</h2>
  <p class="meta">${esc(r14.sectionsHelp)}</p>
  ${r ? `<input type="hidden" name="slug" value="${esc(r.slug)}">` : `<label for="rc-slug">${esc(r14.slug)}</label><input id="rc-slug" name="slug" required pattern="[a-z0-9][a-z0-9-]{0,46}[a-z0-9]?" maxlength="48" dir="ltr" autocomplete="off">`}
  <div class="two-col">
    <div><label for="rc-tar">${esc(r14.titleAr)}</label><input id="rc-tar" name="title_ar" maxlength="120" dir="rtl" value="${v(r?.title.ar)}">
    <label for="rc-sar">${esc(r14.summaryAr)}</label><input id="rc-sar" name="summary_ar" maxlength="300" dir="rtl" value="${v(r?.summary.ar)}">
    <label for="rc-bar">${esc(r14.bodyAr)}</label><textarea id="rc-bar" name="body_ar" rows="16" dir="rtl" class="code-area">${v(r ? r.body.ar : skeleton.ar)}</textarea></div>
    <div><label for="rc-ten">${esc(r14.titleEn)}</label><input id="rc-ten" name="title_en" maxlength="120" dir="ltr" value="${v(r?.title.en)}">
    <label for="rc-sen">${esc(r14.summaryEn)}</label><input id="rc-sen" name="summary_en" maxlength="300" dir="ltr" value="${v(r?.summary.en)}">
    <label for="rc-ben">${esc(r14.bodyEn)}</label><textarea id="rc-ben" name="body_en" rows="16" dir="ltr" class="code-area">${v(r ? r.body.en : skeleton.en)}</textarea></div>
  </div>
  <label for="rc-tags">${esc(r14.tags)}</label><input id="rc-tags" name="tags" maxlength="200" dir="ltr" value="${esc((r?.tags ?? []).join(", "))}">
  <button class="button" type="submit">${esc(r14.save)}</button>
</form>`;
}

export interface DashRecipesOpts {
  kind: "team" | "admin";
  list: RecipeSummary[];
  canWrite: boolean;
  csrf: string;
  flash?: Flash | null;
  skeleton: { en: string; ar: string };
}

/** Dashboard recipes table: every row opens the recipe; own recipes can be deleted. */
function recipeTable(lang: Lang, o: DashRecipesOpts, base: string, own: string): string {
  const r14 = R14[lang];
  const link = (r: RecipeSummary) =>
    localePath(lang, r.scope === own ? `${base}/${r.slug}` : `/docs/recipes/${r.slug}`);
  return dataTable({
    lang,
    id: "recipes-table",
    caption: r14.recipes,
    headLabel: STRINGS[lang].common.title,
    cols: [
      { label: lang === "ar" ? "النوع" : "Type", sort: "text" },
      { label: lang === "ar" ? "الوسوم" : "Tags" },
      { label: r14.updated, sort: "date" },
    ],
    rows: o.list.map((r) => ({
      label: r.title || r.slug,
      href: link(r),
      head: `<a class="row-link" href="${esc(link(r))}"><bdi>${esc(r.title || r.slug)}</bdi></a><div class="meta"><bdi>${esc(r.summary)}</bdi></div>`,
      cells: [
        {
          html: `<span class="badge ${r.scope === "team" ? "on" : r.scope === "platform" ? "info" : "muted"}">${esc(r14.scope[r.scope] ?? r.scope)}</span> <span class="meta">${esc(r14.version(r.version))}</span>`,
          v: r.scope,
        },
        { html: r.tags.map((x) => `<code class="ltr scope">${esc(x)}</code>`).join(" ") || "—" },
        { html: relTimeTag(r.updatedAt, lang), v: r.updatedAt },
      ],
      actions: [
        { kind: "link" as const, label: r14.view, href: link(r), primary: true },
        {
          kind: "link" as const,
          label: "/docs",
          href: localePath(lang, `/docs/recipes/${r.slug}`),
          external: true,
        },
        ...(o.canWrite && r.scope === own
          ? [
              {
                kind: "post" as const,
                label: r14.del,
                action: localePath(lang, `${base}/${r.slug}/delete`),
                danger: true,
                confirm: r14.delConfirm,
              },
            ]
          : []),
      ],
      filters: { scope: r.scope },
    })),
    csrf: o.csrf,
    empty: r14.none,
    filters: [
      {
        key: "scope",
        label: lang === "ar" ? "النوع" : "Type",
        options: [...new Set(o.list.map((r) => r.scope))].map(
          (x) => [x, r14.scope[x] ?? x] as [string, string],
        ),
      },
    ],
  });
}

/** Dashboard: /team/recipes and /admin/recipes */
export function dashRecipesHtml(
  lang: Lang,
  c: Config,
  o: DashRecipesOpts & Partial<TeamPageOpts>,
): string {
  const t = STRINGS[lang];
  const r14 = R14[lang];
  const base = o.kind === "team" ? "/team/recipes" : "/admin/recipes";
  const own = o.kind === "team" ? "team" : "platform";
  const form = o.canWrite
    ? recipeForm(lang, localePath(lang, base), o.csrf, null, o.skeleton)
    : `<p class="notice">${esc(r14.viewerOnly)}</p>`;
  const body = `<div class="page-wide">
  ${pageHead(o.kind === "team" ? t.team.eyebrow : DS[lang].adminArea, esc(r14.recipes), r14.recipesSub)}
  ${flashBox(lang, o.flash ?? null)}
  ${notesCallout(lang, o.kind)}
  <section class="block" aria-labelledby="rc-title">
    <h2 id="rc-title">${esc(r14.recipes)} <span class="count">${o.list.length}</span></h2>
    ${recipeTable(lang, o, base, own)}
    <p class="meta recipe-api"><strong>${esc(r14.apiHint)}:</strong> <code class="ltr">${esc(r14.apiText)}</code></p>
  </section>
  <section class="block" aria-label="${esc(r14.newRecipe)}">${form}</section>
</div>`;
  return dashLayout({
    lang,
    config: c,
    kind: o.kind,
    active: "recipes",
    title: `${r14.recipes} · ${t.product}`,
    description: r14.recipesSub,
    path: base,
    body,
    csrf: o.csrf,
    ctx:
      o.kind === "team" && o.team
        ? teamCtx(lang, { team: o.team, ...(o.me ? { me: o.me } : {}) })
        : ADMIN_CTX(lang),
  });
}

/** Dashboard: one team/platform recipe, rendered + edit form. */
export function dashRecipeHtml(
  lang: Lang,
  c: Config,
  o: DashRecipesOpts & Partial<TeamPageOpts> & { recipe: Recipe; html: string; served: Lang },
): string {
  const t = STRINGS[lang];
  const r14 = R14[lang];
  const base = o.kind === "team" ? "/team/recipes" : "/admin/recipes";
  const r = o.recipe;
  const tools = o.canWrite
    ? postForm(
        localePath(lang, `${base}/${r.slug}/delete`),
        o.csrf,
        `<button class="button small danger" type="submit">${esc(r14.del)}</button>`,
        { confirm: r14.delConfirm },
      )
    : "";
  const body = `<div class="page-wide">
  ${pageHead(o.kind === "team" ? t.team.eyebrow : DS[lang].adminArea, `<bdi>${esc((r.title[o.served] ?? r.slug) as string)}</bdi>`, "", `<div class="head-tools">${tools}<a class="button small ghost" href="${localePath(lang, base)}">${esc(r14.back)}</a></div>`)}
  ${flashBox(lang, o.flash ?? null)}
  <section class="block panel">${recipeArticle(lang, r, o.html, o.served, "h2")}</section>
  ${o.canWrite ? `<section class="block">${recipeForm(lang, localePath(lang, base), o.csrf, r, o.skeleton)}</section>` : ""}
</div>`;
  return dashLayout({
    lang,
    config: c,
    kind: o.kind,
    active: "recipes",
    title: `${r.slug} · ${r14.recipes} · ${t.product}`,
    description: (r.summary[o.served] ?? "") as string,
    path: `${base}/${r.slug}`,
    body,
    csrf: o.csrf,
    ctx:
      o.kind === "team" && o.team
        ? teamCtx(lang, { team: o.team, ...(o.me ? { me: o.me } : {}) })
        : ADMIN_CTX(lang),
    crumbs: [{ label: r.slug }],
  });
}

export const K14 = {
  en: {
    apiKeys: "API keys",
    sub: (w: string) =>
      `Keys for the people and apps that call ${w}. The Worker checks each request with Spaces (see the recipe "Protect your MCP with Spaces keys").`,
    require: "Require API keys",
    requireHelp:
      "When on, Spaces injects MARSA_KEYS_URL and MARSA_KEYS_SECRET into the Worker. Your code must call the helper (requireKey) to enforce it.",
    on: "On",
    off: "Off",
    perMinute: "Per minute",
    perDay: "Per day",
    defaults: "Worker defaults",
    saveSettings: "Save settings",
    settingsSaved: "Settings saved.",
    label: "Label",
    email: "Email (optional)",
    expiry: "Expires",
    never: "Never",
    days: (n: number) => `${n} days`,
    limits: "Limits (blank = Worker default)",
    tools: "Allowed tools (blank = all)",
    toolsPh: "search_items, get_item",
    create: "Create key",
    created: "Key created. Copy it now: it is shown only once.",
    secretLabel: "API key",
    secretNote: "Send it to the user privately. They send it as Authorization: Bearer <key>.",
    keys: "Keys",
    prefix: "Prefix",
    usage: "Requests",
    today: "today",
    week: "7 days",
    limited: "429s",
    lastUsed: "Last used",
    status: "Status",
    revoke: "Revoke",
    revokeConfirm: "Revoke this key? Calls with it stop at the next check.",
    revoked: "Key revoked.",
    noKeys: "No keys yet.",
    noKeysSub: "Create one per user or app, with its own limits.",
    state: { active: "Active", revoked: "Revoked", expired: "Expired" } as Record<string, string>,
    helper: "Helper for your Worker",
    helperText:
      "Paste the helper into the Worker and call requireKey(request, env, { tool }) before any work.",
    verify: "Verify endpoint",
    cache: (n: number) =>
      `The helper checks every request (exact limits). Optional { cache: ${n} } is faster but each Worker isolate caches on its own, so a key can go a little over its limit.`,
    readOnly: "Only owners and editors can manage keys.",
    notConfigured: "Workers are not configured on this instance.",
    rowActions: "Actions",
  },
  ar: {
    apiKeys: "مفاتيح API",
    sub: (w: string) =>
      `مفاتيح للأشخاص والتطبيقات التي تستدعي ${w}. يتحقق الوركر من كل طلب لدى مساحات (راجعوا وصفة «احمِ خادم MCP بمفاتيح مساحات»).`,
    require: "طلب مفاتيح API",
    requireHelp:
      "عند التفعيل تضيف مساحات MARSA_KEYS_URL وMARSA_KEYS_SECRET إلى الوركر. على الكود استدعاء المساعد (requireKey) لتطبيق ذلك.",
    on: "مفعّل",
    off: "متوقف",
    perMinute: "في الدقيقة",
    perDay: "في اليوم",
    defaults: "حدود الوركر الافتراضية",
    saveSettings: "احفظ الإعدادات",
    settingsSaved: "حُفظت الإعدادات.",
    label: "الاسم",
    email: "البريد (اختياري)",
    expiry: "ينتهي بعد",
    never: "لا ينتهي",
    days: (n: number) => `${n} يومًا`,
    limits: "الحدود (فارغ = حد الوركر)",
    tools: "الأدوات المسموحة (فارغ = الكل)",
    toolsPh: "search_items, get_item",
    create: "أنشئ المفتاح",
    created: "أُنشئ المفتاح. انسخه الآن: يظهر مرة واحدة فقط.",
    secretLabel: "مفتاح API",
    secretNote: "أرسله للمستخدم بشكل خاص. يرسله كـ Authorization: Bearer <key>.",
    keys: "المفاتيح",
    prefix: "البادئة",
    usage: "الطلبات",
    today: "اليوم",
    week: "٧ أيام",
    limited: "مرات 429",
    lastUsed: "آخر استخدام",
    status: "الحالة",
    revoke: "ألغِ",
    revokeConfirm: "إلغاء هذا المفتاح؟ تتوقف الطلبات به عند الفحص التالي.",
    revoked: "أُلغي المفتاح.",
    noKeys: "لا مفاتيح بعد.",
    noKeysSub: "أنشئوا مفتاحًا لكل مستخدم أو تطبيق، بحدوده الخاصة.",
    state: { active: "فعّال", revoked: "ملغى", expired: "منتهٍ" } as Record<string, string>,
    helper: "المساعد للوركر",
    helperText: "الصقوا المساعد في الوركر واستدعوا requireKey(request, env, { tool }) قبل أي عمل.",
    verify: "عنوان التحقق",
    cache: (n: number) =>
      `يتحقق المساعد من كل طلب (حدود دقيقة). الخيار { cache: ${n} } أسرع، لكن لكل نسخة من الوركر ذاكرتها فقد يتجاوز المفتاح حدّه قليلًا.`,
    readOnly: "يدير المفاتيح المالكون والمحررون فقط.",
    notConfigured: "الوركرات غير مضبوطة على هذا الخادم.",
    rowActions: "إجراءات",
  },
};
