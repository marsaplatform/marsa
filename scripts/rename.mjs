#!/usr/bin/env node
// Rename the project in one go: display name, package name, token prefix, docs.
// Usage: node scripts/rename.mjs "New Name"
import { readFileSync, writeFileSync } from "node:fs";

const next = process.argv[2]?.trim();
if (!next) {
  console.error('usage: node scripts/rename.mjs "New Name"');
  process.exit(1);
}
const slug = next
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const oldName = JSON.parse(readFileSync("src/brand.ts", "utf8").match(/APP_NAME = (".*?")/)[1]);
const oldSlug = pkg.name;

const files = [
  "package.json",
  "src/brand.ts",
  "src/tokens.ts",
  "test/app.test.ts",
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "NOTICE",
  "LICENSE",
  "docker-compose.yml",
  ".env.example",
];
const word = (s) => new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
for (const f of files) {
  let text;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  const out = text
    .replaceAll(`${oldSlug}_`, `${slug.replace(/-/g, "_")}_`) // edit-token prefix
    .replace(word(oldName), next)
    .replace(word(oldSlug), slug);
  if (out !== text) {
    writeFileSync(f, out);
    console.log(`updated ${f}`);
  }
}
console.log(
  `renamed "${oldName}" (${oldSlug}) -> "${next}" (${slug}). Run: npm install && npm test`,
);
