// Deploy dist/worker.js through the Spaces API (no wrangler, no Cloudflare token needed).
// Env: MARSA_URL, MARSA_TEAM, MARSA_AGENT_KEY (scope workers:deploy), WORKER_NAME, NOTE.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { TOOL_NAMES } from "../src/mcp/server.js";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`set ${k} (see .env.example)`);
  return v;
};
const base = process.env.MARSA_URL ?? "https://spaces.marsaplatform.com";
const team = need("MARSA_TEAM");
const name = need("WORKER_NAME");
const key = need("MARSA_AGENT_KEY");
const git = (args: string) => {
  try {
    return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
};
const commitSha = git("rev-parse HEAD");
const branch = git("rev-parse --abbrev-ref HEAD");
// https form of the origin remote (git@github.com:org/repo.git → https://github.com/org/repo)
const repoUrl = git("remote get-url origin")
  .replace(/^git@github\.com:/, "https://github.com/")
  .replace(/\.git$/, "");
const note = process.env.NOTE ?? (commitSha ? `git ${commitSha.slice(0, 7)}` : "deploy");

const body = {
  code: readFileSync("dist/worker.js", "utf8"),
  note,
  // Declared so the Spaces Workers table shows the right type, stack and tool count.
  meta: { kind: "mcp", language: "typescript", framework: "hono", toolsCount: TOOL_NAMES.length },
  // Lets Spaces show the repo and whether the deployed commit is the branch's latest.
  ...(repoUrl.startsWith("https://") ? { repo: { url: repoUrl, branch, commitSha } } : {}),
  // Optional: calling other Workers of the same team (see the recipe).
  // compatibilityFlags: ["global_fetch_strictly_public"],
  // bindings: [{ name: "NEWS", worker: "news" }],
};
const res = await fetch(`${base}/api/teams/${team}/workers/${name}`, {
  method: "PUT",
  headers: { "content-type": "application/json", "x-team-key": key },
  body: JSON.stringify(body),
});
const out = (await res.json()) as { worker?: { url: string; version: number }; error?: { code: string; message: string } };
if (!res.ok || !out.worker) {
  console.error(`deploy failed: ${res.status} ${out.error?.code ?? ""} ${out.error?.message ?? ""}`);
  process.exit(1);
}
console.log(`deployed v${out.worker.version}: ${out.worker.url}/mcp`);
