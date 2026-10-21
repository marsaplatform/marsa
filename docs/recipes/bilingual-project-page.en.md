---
title: Bilingual AR/EN project page on Spaces
summary: One static page per project (Arabic first, English second) with connect instructions, screenshots, correct RTL and a mobile check.
version: 2
updated: 2026-10-21
tags: sites, arabic, design
order: 2
---
## Goal

A clean, fast project page (for an MCP server, a dataset, a tool) published on Spaces, readable in Arabic and English, that tells a visitor in under a minute what it is, who it is for and how to connect. This is the pattern used for the Atlas, Malja and ERX pages.

## When to use

- You launched something (MCP server, Worker, report) and need a link to share.
- You want the page under your team (team key or agent key with `spaces:write`) so teammates can update it, and optionally make it permanent (the admin can mark team sites permanent).

## Folder structure

```
my-project-page/
├── index.html          # English page (lang="en"), links to /ar/
├── ar/
│   └── index.html      # Arabic page (lang="ar" dir="rtl"), links back to /
├── assets/
│   ├── style.css       # one stylesheet, logical properties (works in both directions)
│   ├── app.js          # optional: copy buttons, language switch
│   └── shot-1.webp     # screenshots, compressed, with width/height
├── cover.png           # 1200×630 at the root: Spaces uses it as the cover in the directory and dashboard
└── README.md           # optional: how to update the page (never put keys in it)
```

- Use relative links (`assets/style.css` from the root and `../assets/style.css` from `ar/`), so the page works on any host.
- `cover.(png|jpg|webp)` at the root wins. Without it, Spaces uses your `og:image`, then the first image on the page.
- Put the same `<meta property="og:image" content="cover.png">` in both pages, with an `og:title` in the page's language.
- **Link the source repo** (optional): after publishing, `PATCH /api/sites/<id>` with `{"repo": {"url": "https://github.com/<org>/<repo>", "branch": "main", "commitSha": "<sha>"}}` (edit token or team key), or set it in the space's **Settings** tab. The Spaces tables then show whether the repo is public or private and whether the page is synced with the branch.
- For an MCP server's page, deploy the Worker with `"meta": {"spaceSlug": "<this space id>"}` so the **MCP servers** page links the two.

## Steps

1. **Write the content first, Arabic and English**, in this order of sections:
   1. Hero: name, one-line promise, primary button (Connect / Open).
   2. What it does: 3–5 bullets.
   3. Who it is for.
   4. How to connect: copy-paste blocks (MCP URL, Claude/Cursor config, curl).
   5. Screenshots or a cover image (with `alt` text in both languages).
   6. Data sources, limits and privacy (what is stored, what is not).
   7. Contact / source / version and "last updated".
2. **Choose the layout:** two pages (`index.html` English, `ar/index.html` Arabic, as in the tree above) with a language link on each. For an Arabic-first audience you can swap them (Arabic at the root, `en/index.html`). One page with `lang`/`dir` per section also works, but two pages are simpler to keep correct.
3. **Get RTL right:** `<html lang="ar" dir="rtl">` on the Arabic page; use logical CSS (`margin-inline-start`, `padding-inline`, `text-align: start`); wrap code, URLs, emails and numbers mixed with Arabic in `<bdi>` or `dir="ltr"`; keep code blocks `dir="ltr"`.
4. **Fonts and type:** a system stack is fine (`system-ui, "Segoe UI", Tahoma, sans-serif`); Arabic needs a slightly larger size and line-height (1.7–1.8). No external font CDNs if you can avoid them.
5. **Images:** compress (WebP or optimized PNG), set `width`/`height`, `loading="lazy"` below the fold. Keep the whole site small (it loads on slow mobile networks).
6. **Mobile:** test at 360–390 px wide: no horizontal scroll, code blocks scroll inside their box (`overflow-x: auto`), tap targets ≥ 44 px.
7. **Publish** as a ZIP with your team key so it belongs to the team:
   ```sh
   (cd page && zip -qr ../page.zip .)
   curl -s -X POST "https://marsa.example.com/api/sites" \
     -H "X-Team-Key: $MARSA_AGENT_KEY" -H "Content-Type: application/zip" --data-binary @page.zip
   ```
   Keep the returned `editToken` secret (it updates the same link: `PUT /api/sites/<id>`).
8. **Check links** after publishing (below) and fix anything that is not 200.

## Starter template

```html
<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>اسم المشروع: وعد في سطر</title>
<meta name="description" content="وصف قصير بالعربية">
<link rel="alternate" hreflang="en" href="en/">
<style>
  :root { color-scheme: light dark; --ink:#14201c; --accent:#145a49; }
  body { margin:0; font:17px/1.8 system-ui,"Segoe UI",Tahoma,sans-serif; color:var(--ink); }
  main { max-width: 760px; margin-inline: auto; padding: 24px 16px 64px; }
  pre { direction: ltr; text-align: left; overflow-x: auto; background:#0f1a17; color:#e8f3ef; padding:14px; border-radius:10px; }
  .button { display:inline-block; padding:12px 18px; background:var(--accent); color:#fff; border-radius:10px; text-decoration:none; }
  img { max-width:100%; height:auto; border-radius:10px; }
  nav { display:flex; justify-content:space-between; padding:12px 16px; }
</style>
</head>
<body>
<nav><strong>اسم المشروع</strong><a href="en/" hreflang="en" lang="en">English</a></nav>
<main>
  <h1>اسم المشروع</h1>
  <p>وعد المشروع في سطر واحد.</p>
  <p><a class="button" href="#connect">اتصل الآن</a></p>
  <h2>ماذا يفعل</h2>
  <ul><li>…</li><li>…</li><li>…</li></ul>
  <h2 id="connect">طريقة الاتصال</h2>
  <p>عنوان MCP: <bdi dir="ltr"><code>https://team-name.marsaplatform.com/mcp</code></bdi></p>
  <pre><code>{ "mcpServers": { "project": { "url": "https://team-name.marsaplatform.com/mcp" } } }</code></pre>
  <h2>المصادر والخصوصية</h2>
  <p>…</p>
  <img src="cover.webp" width="1200" height="630" alt="لقطة من الواجهة" loading="lazy">
  <p><small>آخر تحديث: <time datetime="2026-10-21">٢١ أكتوبر ٢٠٢٦</time></small></p>
</main>
</body>
</html>
```

The English page (`en/index.html`) is the same with `lang="en" dir="ltr"` and a link back to `../`.

## Checklist before deploy

- [ ] Both languages say the same thing; no machine-translated leftovers or English inside Arabic sentences without `<bdi>`.
- [ ] `lang`/`dir` set on each page; code and URLs are LTR.
- [ ] Every image has `alt` in the page's language; total site size is small (aim < 2 MB).
- [ ] No secrets, tokens or private emails in the HTML (it is public to anyone with the link).
- [ ] 360 px wide: no horizontal scrolling.
- [ ] Link check:
  ```sh
  B=https://marsa.example.com/s/<id>
  for p in / /en/ /cover.webp; do curl -s -o /dev/null -w "$p %{http_code}\n" "$B$p"; done
  ```
- [ ] The connect instructions were tried for real from a clean client.

## Common pitfalls

- **Mirrored code and URLs** in RTL: wrap them in `dir="ltr"` / `<bdi>`.
- **Punctuation jumping** to the wrong side next to Latin words: again `<bdi>`.
- **Absolute links to `/`** point to Spaces' home, not your site: use relative links (`en/`, `cover.webp`).
- **Huge screenshots** make the page slow on phones: resize to ~1200 px wide.
- **Publishing without the team key**: the site becomes a guest site with a short expiry and no team access.
- **Losing the edit token**: you can still manage team sites from the dashboard, but agents need the token or a team/agent key to update.
