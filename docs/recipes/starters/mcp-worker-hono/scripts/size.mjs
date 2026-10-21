// Fails the check when the bundle is not one ES module or is too large for the team quota.
import { readFileSync } from "node:fs";
const code = readFileSync("dist/worker.js", "utf8");
const kb = Buffer.byteLength(code) / 1024;
if (!/export\s*\{[^}]*\bas default\b[^}]*\}|export\s+default\b/.test(code)) {
  console.error("dist/worker.js has no default export");
  process.exit(1);
}
const max = Number(process.env.MAX_KB ?? 1024);
console.log(`dist/worker.js: ${kb.toFixed(1)} KB (limit ${max} KB)`);
if (kb > max) process.exit(1);
