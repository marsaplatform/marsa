import { APP_NAME } from "./brand.js";
import type { Config } from "./config.js";
import type { DocPage } from "./docs.js";
import { hoursLabel, type Lang, type LimitValues, STRINGS } from "./i18n.js";

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
  teams: {
    id: string;
    name: string;
    sites: { id: string; title: string; url: string; createdAt: string; expiresAt: string }[];
  }[];
}

/** A server-rendered UTC time; the page script swaps in the visitor's local time. */
function timeTag(lang: Lang, iso: string): string {
  const d = new Date(iso);
  const text = new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(d);
  return `<time datetime="${esc(d.toISOString())}" data-local>${esc(text)} UTC</time>`;
}

function directorySection(lang: Lang, dir: Directory): string {
  const t = STRINGS[lang].directory;
  const groups = dir.teams.length
    ? dir.teams
        .map(
          (team) => `<div class="dir-team" role="group" aria-labelledby="dir-${esc(team.id)}">
      <h3 id="dir-${esc(team.id)}"><bdi>${esc(team.name)}</bdi> <span class="muted small">· ${esc(t.pages(team.sites.length))}</span></h3>
      <ul class="grid dir-grid">${team.sites
        .map(
          (x) =>
            `<li class="card-box dir-card"><a class="dir-title" href="${esc(x.url)}" target="_blank" rel="noopener"><bdi>${esc(x.title)}</bdi></a><p class="dir-url"><span dir="ltr">${esc(x.url.replace(/^https?:\/\//, ""))}</span></p><p class="muted small">${esc(t.expires)} ${timeTag(lang, x.expiresAt)}</p></li>`,
        )
        .join("")}</ul>
    </div>`,
        )
        .join("\n")
    : `<p class="dir-empty card-box">${esc(t.empty)}</p>`;
  return `<section id="directory" class="directory" aria-labelledby="directory-title">
  <div class="wrap">
    <h2 id="directory-title">${esc(t.title)}</h2>
    <p class="muted">${esc(t.sub)}</p>
    ${groups}
  </div>
</section>`;
}

interface LayoutOpts {
  lang: Lang;
  title: string;
  description: string;
  path: string;
  body: string;
  config: Config;
  active?: "home" | "try" | "docs";
  noindex?: boolean;
  script?: string;
}

const ANCHOR_SVG = `<svg class="mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><circle cx="16" cy="7" r="3.2" class="stroke"/><path d="M16 10.5V27M9 15h14M5.5 19.5C6.5 24 11 27 16 27s9.5-3 10.5-7.5" class="stroke"/><path d="M3.5 21.5l2-2.5 2.5 2M28.5 21.5l-2-2.5-2.5 2" class="stroke"/></svg>`;

function layout(o: LayoutOpts): string {
  const t = STRINGS[o.lang];
  const other: Lang = o.lang === "en" ? "ar" : "en";
  const href = (p: string) => localePath(o.lang, p);
  const canonical = `${o.config.publicUrl}${localePath(o.lang, o.path)}`;
  const cur = (k: LayoutOpts["active"]) => (o.active === k ? ' aria-current="page"' : "");
  return `<!doctype html>
<html lang="${o.lang}" dir="${t.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<meta name="color-scheme" content="light dark">${o.noindex ? '\n<meta name="robots" content="noindex, nofollow">' : ""}
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:type" content="website">
<link rel="canonical" href="${esc(canonical)}">
<link rel="alternate" hreflang="en" href="${esc(o.config.publicUrl + localePath("en", o.path))}">
<link rel="alternate" hreflang="ar" href="${esc(o.config.publicUrl + localePath("ar", o.path))}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<a class="skip" href="#main">${esc(t.skip)}</a>
<header class="site-header">
  <div class="wrap bar">
    <a class="brand" href="${href("/")}">${ANCHOR_SVG}<span>${esc(APP_NAME)}</span></a>
    <nav aria-label="Main">
      <a href="${href("/")}"${cur("home")}>${esc(t.nav.home)}</a>
      <a href="${href("/new")}"${cur("try")}>${esc(t.nav.try)}</a>
      <a href="${href("/docs")}"${cur("docs")}>${esc(t.nav.docs)}</a>
      <a href="/docs/api" class="hide-sm">${esc(t.nav.api)}</a>
      <a class="lang" href="${localePath(other, o.path)}" hreflang="${other}" lang="${other}">${esc(t.switchLabel)}</a>
    </nav>
  </div>
</header>
<main id="main" tabindex="-1">
${o.body}
</main>
<footer class="site-footer">
  <div class="wrap foot">
    <p>${esc(t.footer)}</p>
    <p class="links"><a href="${href("/docs")}">${esc(t.nav.docs)}</a> · <a href="/docs/api">API</a> · <a href="/openapi.json">OpenAPI</a> · <a href="/llms.txt">llms.txt</a> · <a href="/docs/self-hosting">Self-host</a></p>
  </div>
</footer>
<script src="${o.script ?? "/assets/app.js"}" type="module"></script>
</body>
</html>`;
}

function ttlOptions(lang: Lang, c: Config): string {
  const set = new Set([1, 6, 24, 72, 168, c.defaultTtlHours]);
  return [...set]
    .filter((h) => h >= c.minTtlHours && h <= c.maxTtlHours)
    .sort((a, b) => a - b)
    .map(
      (h) =>
        `<option value="${h}"${h === c.defaultTtlHours ? " selected" : ""}>${esc(hoursLabel(lang, h))}</option>`,
    )
    .join("");
}

function uploader(lang: Lang, c: Config, headingLevel: "h1" | "h2"): string {
  const t = STRINGS[lang];
  const l = limitValues(lang, c);
  return `<section id="try" class="try" aria-labelledby="try-title">
  <div class="wrap narrow">
    <${headingLevel} id="try-title">${esc(t.try.title)}</${headingLevel}>
    <p class="muted">${esc(t.try.sub)}</p>
    <div id="drop" class="drop" tabindex="0" role="group" aria-label="${esc(t.try.drop)}">
      <svg class="drop-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path class="stroke" d="M24 30V10M15 19l9-9 9 9M8 30v6a4 4 0 0 0 4 4h24a4 4 0 0 0 4-4v-6"/></svg>
      <p class="drop-title">${esc(t.try.drop)}</p>
      <div class="row">
        <label class="btn primary"><input id="pickFiles" type="file" multiple class="sr-only"><span>${esc(t.try.pickFiles)}</span></label>
        <label class="btn"><input id="pickDir" type="file" webkitdirectory class="sr-only"><span>${esc(t.try.pickDir)}</span></label>
      </div>
      <label class="ttl"><span>${esc(t.try.expires)}</span> <select id="ttl">${ttlOptions(lang, c)}</select></label>
      <p class="muted small">${esc(t.limits.limitItems(l)[0] ?? "")}</p>
    </div>
    <p id="status" role="status" aria-live="polite"></p>
    <div id="result" class="result" hidden>
      <h3>${esc(t.try.ready)}</h3>
      <p class="link-row"><a id="link" target="_blank" rel="noopener"></a> <button id="copy" type="button" class="btn small">${esc(t.try.copy)}</button></p>
      <p class="muted small">${esc(t.try.tokenNote)}</p>
      <code id="token" class="token"></code>
    </div>
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

const HERO_ART = `<svg class="hero-art" viewBox="0 0 420 300" role="img" aria-label="Files sailing into a harbor and becoming a link">
  <rect x="40" y="36" width="250" height="160" rx="14" class="card"/>
  <rect x="40" y="36" width="250" height="30" rx="14" class="card-top"/>
  <circle cx="60" cy="51" r="5" class="dot"/><circle cx="76" cy="51" r="5" class="dot"/><circle cx="92" cy="51" r="5" class="dot"/>
  <rect x="62" y="86" width="130" height="12" rx="6" class="line strong"/>
  <rect x="62" y="110" width="200" height="9" rx="4.5" class="line"/>
  <rect x="62" y="128" width="170" height="9" rx="4.5" class="line"/>
  <rect x="62" y="152" width="80" height="26" rx="13" class="pill"/>
  <rect x="170" y="120" width="210" height="58" rx="29" class="link-card"/>
  <circle cx="200" cy="149" r="14" class="link-icon"/>
  <path d="M195 149h10M200 144l5 5-5 5" class="link-arrow"/>
  <rect x="226" y="140" width="128" height="9" rx="4.5" class="line on-dark"/>
  <rect x="226" y="155" width="80" height="7" rx="3.5" class="line on-dark faint"/>
  <path d="M0 236c35 0 35-14 70-14s35 14 70 14 35-14 70-14 35 14 70 14 35-14 70-14 35 14 70 14" class="wave"/>
  <path d="M0 262c35 0 35-14 70-14s35 14 70 14 35-14 70-14 35 14 70 14 35-14 70-14 35 14 70 14" class="wave faint"/>
  <g class="clock"><circle cx="352" cy="74" r="26" class="clock-face"/><path d="M352 60v14l10 7" class="clock-hand"/></g>
</svg>`;

export function landingHtml(
  lang: Lang,
  c: Config,
  dir: Directory = { generatedAt: "", teams: [] },
): string {
  const t = STRINGS[lang];
  const href = (p: string) => localePath(lang, p);
  const l = limitValues(lang, c);
  const icons = ["M8 12h16M8 18h10", "M10 22l6-12 6 12M12 18h8", "M16 8v8l5 3"];
  const body = `
<section class="hero">
  <div class="wrap hero-grid">
    <div>
      <p class="eyebrow">${esc(t.hero.eyebrow)}</p>
      <h1>${esc(t.hero.title)}</h1>
      <p class="lead">${esc(t.hero.sub)}</p>
      <p class="cta"><a class="btn primary lg" href="#try">${esc(t.hero.ctaTry)}</a> <a class="btn lg" href="${href("/docs")}">${esc(t.hero.ctaDocs)}</a></p>
    </div>
    ${HERO_ART}
  </div>
</section>

${directorySection(lang, dir)}

<section class="band" aria-labelledby="why-title">
  <div class="wrap">
    <h2 id="why-title">${esc(t.why.title)}</h2>
    <div class="grid three">
      ${t.why.items
        .map(
          ([h, p], i) =>
            `<article class="card-box"><svg class="icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><circle cx="16" cy="16" r="13" class="stroke"/><path d="${icons[i]}" class="stroke"/></svg><h3>${esc(h)}</h3><p>${esc(p)}</p></article>`,
        )
        .join("")}
    </div>
  </div>
</section>

<section aria-labelledby="how-title">
  <div class="wrap">
    <h2 id="how-title">${esc(t.how.title)}</h2>
    <ol class="steps">
      ${t.how.steps.map(([h, p]) => `<li><h3>${esc(h)}</h3><p>${esc(p)}</p></li>`).join("")}
    </ol>
  </div>
</section>

<section class="band" aria-labelledby="uses-title">
  <div class="wrap">
    <h2 id="uses-title">${esc(t.uses.title)}</h2>
    <p class="muted">${esc(t.uses.sub)}</p>
    <div class="grid uses">
      ${t.uses.items.map(([h, p]) => `<article class="card-box"><h3>${esc(h)}</h3><p>${esc(p)}</p></article>`).join("")}
    </div>
    <p><a class="more" href="/docs/use-cases">${esc(t.uses.more)}</a></p>
  </div>
</section>

<section aria-labelledby="agents-title">
  <div class="wrap two-col">
    <div>
      <h2 id="agents-title">${esc(t.agents.title)}</h2>
      <p>${esc(t.agents.sub)}</p>
      <p class="cta"><a class="btn" href="/llms.txt">${esc(t.agents.llms)}</a> <a class="btn" href="/openapi.json">${esc(t.agents.openapi)}</a> <a class="btn" href="/docs/agents">${esc(t.nav.docs)}</a></p>
    </div>
    ${agentSnippet(c)}
  </div>
</section>

${uploader(lang, c, "h2")}

<section class="band" aria-labelledby="limits-title">
  <div class="wrap two-col">
    <div>
      <h2 id="limits-title">${esc(t.limits.title)}</h2>
      <p class="muted">${esc(t.limits.sub)}</p>
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

<section aria-labelledby="self-title">
  <div class="wrap two-col">
    <div>
      <h2 id="self-title">${esc(t.selfhost.title)}</h2>
      <p>${esc(t.selfhost.sub)}</p>
      <p><a class="btn" href="/docs/self-hosting">${esc(t.selfhost.cta)}</a></p>
    </div>
    <pre class="code" dir="ltr"><code>docker compose up -d --build
# =&gt; http://localhost:8080</code></pre>
  </div>
</section>`;
  return layout({
    lang,
    title: `${APP_NAME}: ${t.hero.title}`,
    description: t.hero.sub,
    path: "/",
    body,
    config: c,
    active: "home",
  });
}

export function adminHtml(lang: Lang, c: Config): string {
  const t = STRINGS[lang].admin;
  const body = `<div class="wrap admin" id="admin" data-rotate="${esc(t.rotate)}" data-del="${esc(t.del)}">
  <h1>${esc(t.title)}</h1>
  <p class="lead">${esc(t.sub)}</p>
  <form id="login" class="card-box admin-login" autocomplete="off">
    <label for="adminToken">${esc(t.tokenLabel)}</label>
    <div class="row start"><input id="adminToken" type="password" dir="ltr" required minlength="24" autocomplete="off" spellcheck="false"><button class="btn primary" type="submit">${esc(t.connect)}</button></div>
  </form>
  <p id="status" role="status" aria-live="polite"></p>
  <div id="panel" hidden>
    <div class="row between"><h2>${esc(t.teams)}</h2><button id="signOut" class="btn small" type="button">${esc(t.signOut)}</button></div>
    <div id="newKey" class="result" hidden>
      <h3>${esc(t.newKey)}</h3>
      <p class="muted small">${esc(t.newKeyNote)}</p>
      <code id="newKeyValue" class="token"></code>
    </div>
    <div class="table-wrap"><table class="teams">
      <thead><tr><th scope="col">${esc(t.name)}</th><th scope="col">${esc(t.backend)}</th><th scope="col">${esc(t.directory)}</th><th scope="col">${esc(t.liveSites)}</th><th scope="col">${esc(t.key)}</th><th scope="col">${esc(t.actions)}</th></tr></thead>
      <tbody id="teamRows"><tr><td colspan="6" class="muted">${esc(t.none)}</td></tr></tbody>
    </table></div>
    <form id="createTeam" class="card-box admin-create">
      <h3>${esc(t.create)}</h3>
      <label for="teamName">${esc(t.name)}</label>
      <input id="teamName" type="text" required maxlength="80" dir="auto">
      <label class="check"><input id="teamBackend" type="checkbox"> ${esc(t.backend)}</label>
      <label class="check"><input id="teamDirectory" type="checkbox" checked> ${esc(t.directory)}</label>
      <p><button class="btn primary" type="submit">${esc(t.create)}</button></p>
    </form>
    <h3>${esc(t.howTitle)}</h3>
    <ul class="checks">${t.how.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    <pre class="code" dir="ltr"><code>curl -s -X POST "${esc(c.publicUrl)}/api/sites" \\
  -H "X-Team-Key: $TEAM_KEY" \\
  -H "Content-Type: application/zip" --data-binary @site.zip</code></pre>
  </div>
</div>`;
  return layout({
    lang,
    title: `${t.title} · ${APP_NAME}`,
    description: t.sub,
    path: "/admin",
    body,
    config: c,
    noindex: true,
    script: "/assets/admin.js",
  });
}

export function newHtml(lang: Lang, c: Config): string {
  const t = STRINGS[lang];
  return layout({
    lang,
    title: `${t.try.title} · ${APP_NAME}`,
    description: t.hero.sub,
    path: "/new",
    body: uploader(lang, c, "h1"),
    config: c,
    active: "try",
  });
}

function docsNav(lang: Lang, docs: DocPage[], current?: string): string {
  const t = STRINGS[lang];
  const list = [...docs].sort((a, b) => (a.lang === lang ? -1 : 0) - (b.lang === lang ? -1 : 0));
  return `<nav class="docs-nav" aria-label="${esc(t.docs.title)}"><ul>${list
    .map((d) => {
      const url = d.lang === "ar" ? `/ar/docs/${d.slug}` : `/docs/${d.slug}`;
      const note =
        d.lang !== lang && lang === "ar"
          ? ` <span class="muted small">${esc(t.docs.englishOnly)}</span>`
          : "";
      return `<li><a href="${url}" lang="${d.lang}"${d.slug === current ? ' aria-current="page"' : ""}>${esc(d.title)}</a>${note}</li>`;
    })
    .join("")}</ul></nav>`;
}

export function docsIndexHtml(lang: Lang, c: Config, docs: DocPage[]): string {
  const t = STRINGS[lang];
  const list = [...docs].sort((a, b) => (a.lang === lang ? -1 : 0) - (b.lang === lang ? -1 : 0));
  const body = `<div class="wrap docs-head"><h1>${esc(t.docs.title)}</h1><p class="lead">${esc(t.docs.sub)}</p></div>
<div class="wrap grid docs-grid">${list
    .map((d) => {
      const url = d.lang === "ar" ? `/ar/docs/${d.slug}` : `/docs/${d.slug}`;
      const note =
        d.lang !== lang && lang === "ar"
          ? ` <span class="muted small">${esc(t.docs.englishOnly)}</span>`
          : "";
      return `<a class="card-box doc-card" href="${url}" lang="${d.lang}" dir="${d.lang === "ar" ? "rtl" : "ltr"}"><h2>${esc(d.title)}</h2><p>${esc(d.summary)}</p></a>${note}`;
    })
    .join("")}
  <a class="card-box doc-card" href="/llms.txt" lang="en" dir="ltr"><h2>llms.txt</h2><p>Plain-text instructions for AI agents.</p></a>
  <a class="card-box doc-card" href="/openapi.json" lang="en" dir="ltr"><h2>OpenAPI</h2><p>Machine-readable API spec (OpenAPI 3.1).</p></a>
</div>`;
  return layout({
    lang,
    title: `${t.docs.title} · ${APP_NAME}`,
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
  <aside>${docsNav(lang, docs, doc.slug)}<p><a href="${localePath(lang, "/docs")}">${esc(t.docs.back)}</a></p></aside>
  <article class="prose" lang="${doc.lang}" dir="${docDir}"><h1>${esc(doc.title)}</h1>${doc.html}</article>
</div>`;
  return layout({
    lang,
    title: `${doc.title} · ${APP_NAME}`,
    description: doc.summary,
    path: doc.lang === "ar" ? `/docs/${doc.slug}` : `/docs/${doc.slug}`,
    body,
    config: c,
    active: "docs",
  });
}

function message(lang: Lang, c: Config, code: string, text: string): string {
  const t = STRINGS[lang];
  return layout({
    lang,
    title: `${code} · ${APP_NAME}`,
    description: text,
    path: "/",
    body: `<div class="wrap narrow center"><p class="big-code">${code}</p><h1>${esc(text)}</h1><p><a class="btn primary" href="${localePath(lang, "/")}">${esc(t.home)}</a></p></div>`,
    config: c,
  });
}

export const notFoundHtml = (lang: Lang, c: Config) =>
  message(lang, c, "404", STRINGS[lang].notFound);
export const goneHtml = (lang: Lang, c: Config) => message(lang, c, "410", STRINGS[lang].gone);

export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0b3b5c"/><g fill="none" stroke="#7fe0d0" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="16" cy="8" r="2.6"/><path d="M16 11v15M10 15h12M6.5 19.5C7.5 23.5 11.5 26 16 26s8.5-2.5 9.5-6.5"/></g></svg>`;
