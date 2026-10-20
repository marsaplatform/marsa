#!/usr/bin/env node
// Publish a folder to Marsa with no dependencies (Node.js 20+), using the JSON format.
// Usage: MARSA_URL=http://localhost:8080 node deploy.mjs <folder> [ttlHours]
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const [dir, ttl = "24"] = process.argv.slice(2);
if (!dir) {
  console.error("usage: node deploy.mjs <folder> [ttlHours]");
  process.exit(1);
}
const base = process.env.MARSA_URL || "http://localhost:8080";

async function* walk(d) {
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const files = [];
for await (const p of walk(dir)) {
  files.push({
    path: relative(dir, p).split("\\").join("/"),
    content: (await readFile(p)).toString("base64"),
    encoding: "base64",
  });
}

const res = await fetch(`${base}/api/sites`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ttlHours: Number(ttl), files }),
});
const site = await res.json();
if (!res.ok) {
  console.error(`${site.error?.code}: ${site.error?.message}`);
  process.exit(1);
}
console.log(
  JSON.stringify(
    { url: site.url, expiresAt: site.expiresAt, id: site.id, editToken: site.editToken },
    null,
    2,
  ),
);
