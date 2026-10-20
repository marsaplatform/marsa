#!/usr/bin/env node
// End-to-end smoke test against a running server.
// Usage: BASE_URL=http://localhost:8080 node scripts/smoke.mjs
const base = (process.env.BASE_URL || "http://localhost:8080").replace(/\/+$/, "");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const health = await fetch(`${base}/healthz`);
if (!health.ok) fail(`/healthz returned ${health.status}`);

// 0) Public pages answer.
for (const path of [
  "/",
  "/ar",
  "/new",
  "/docs",
  "/docs/api",
  "/ar/docs/guide",
  "/llms.txt",
  "/openapi.json",
  "/login",
  "/ar/login",
  "/assets/fonts/zad/Zad-Regular.woff2",
  "/docs/teams",
  "/api/directory",
]) {
  const r = await fetch(`${base}${path}`);
  if (r.status !== 200) fail(`${path} returned ${r.status}`);
}
// The admin sign-in exists (200) or is disabled without ADMIN_TOKEN (404).
for (const path of ["/admin/login", "/ar/admin/login"]) {
  const r = await fetch(`${base}${path}`);
  if (r.status !== 200 && r.status !== 404) fail(`${path} returned ${r.status}`);
}
console.log("pages OK: /, /ar, /new, /docs, /llms.txt, /openapi.json");

// 1) Guest multipart upload (what the drag-and-drop UI sends).
const fd = new FormData();
fd.append(
  "files",
  new Blob(["<!doctype html><h1>smoke</h1>"], { type: "text/html" }),
  "index.html",
);
fd.append("paths", "demo/index.html");
fd.append("files", new Blob(["body{color:red}"], { type: "text/css" }), "style.css");
fd.append("paths", "demo/style.css");
fd.append("ttlHours", "1");
const up = await fetch(`${base}/api/sites`, { method: "POST", body: fd });
const site = await up.json();
if (up.status !== 201) fail(`upload returned ${up.status}: ${JSON.stringify(site)}`);
console.log(`uploaded ${site.fileCount} files -> ${site.url} (expires ${site.expiresAt})`);

// 2) The share link serves the page, sandboxed.
const page = await fetch(site.url);
const html = await page.text();
if (page.status !== 200 || !html.includes("smoke")) fail(`share link returned ${page.status}`);
if (!page.headers.get("content-security-policy")?.includes("sandbox")) fail("missing sandbox CSP");
console.log("share link OK, sandbox CSP present");

// 3) Blocked type is refused.
const bad = await fetch(`${base}/api/sites`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ files: [{ path: "x.php", content: "<?php" }] }),
});
if (bad.status !== 415) fail(`blocked type returned ${bad.status}`);
console.log("blocked file type refused (415)");

// 4) The edit token deletes it.
const del = await fetch(`${base}/api/sites/${site.id}`, {
  method: "DELETE",
  headers: { authorization: `Bearer ${site.editToken}` },
});
if (del.status !== 204) fail(`delete returned ${del.status}`);
const gone = await fetch(site.url);
if (gone.status !== 404) fail(`deleted site returned ${gone.status}`);
console.log("delete with edit token OK");
console.log("SMOKE OK");
