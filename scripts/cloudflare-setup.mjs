#!/usr/bin/env node
// One-time setup of the Cloudflare resources Marsa's optional backend uses:
// a Workers KV namespace (values) and an R2 bucket (files). Safe to re-run:
// existing resources with the same name are reused, nothing else is touched.
//
// Needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (permissions:
// Workers KV Storage: Edit, Workers R2 Storage: Edit).
//   node --env-file=.env scripts/cloudflare-setup.mjs [--write-env PATH]
// Optional: CLOUDFLARE_KV_TITLE (default "marsa-kv"), R2_BUCKET (default "marsa-files").
//
// It prints the KV namespace id, the bucket and the R2 S3 access key id derived
// from the token (Access Key ID = token id, Secret = SHA-256 of the token value,
// see https://developers.cloudflare.com/r2/api/tokens/). Secrets are never printed.
// With --write-env PATH it writes CLOUDFLARE_KV_NAMESPACE_ID, R2_BUCKET,
// R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY into that file (created/kept at mode 600).
import { createHash } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const env = (k, d) => process.env[k]?.trim() || d;
const accountId = env("CLOUDFLARE_ACCOUNT_ID");
const token = env("CLOUDFLARE_API_TOKEN");
const kvTitle = env("CLOUDFLARE_KV_TITLE", "marsa-kv");
const bucket = env("R2_BUCKET", "marsa-files");
const apiBase = env("CLOUDFLARE_API_BASE", "https://api.cloudflare.com/client/v4").replace(
  /\/+$/,
  "",
);
const envFileArg = process.argv.indexOf("--write-env");
const envFile = envFileArg > -1 ? process.argv[envFileArg + 1] : "";

if (!accountId || !token) {
  console.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN first.");
  process.exit(1);
}
if (envFileArg > -1 && !envFile) {
  console.error("--write-env needs a path.");
  process.exit(1);
}

async function cf(method, path, body) {
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && json.success !== false, json };
}
const fail = (what, r) => {
  const e = r.json?.errors?.[0];
  console.error(`${what} failed (${r.status}): ${e ? `${e.code} ${e.message}` : "unknown error"}`);
  process.exit(1);
};

// 1. Token: account-owned tokens verify under /accounts, user tokens under /user.
let verify = await cf("GET", `/accounts/${accountId}/tokens/verify`);
if (!verify.ok) verify = await cf("GET", "/user/tokens/verify");
if (!verify.ok) fail("token verification", verify);
const tokenId = verify.json.result?.id;
console.log(`token    ok (${verify.json.result?.status ?? "active"})`);

// 2. KV namespace, found by title.
const ns = `/accounts/${accountId}/storage/kv/namespaces`;
let namespaceId;
for (let page = 1; !namespaceId; page++) {
  const r = await cf("GET", `${ns}?per_page=100&page=${page}`);
  if (!r.ok) fail("listing KV namespaces", r);
  namespaceId = r.json.result?.find((n) => n.title === kvTitle)?.id;
  if ((r.json.result?.length ?? 0) < 100) break;
}
if (namespaceId) {
  console.log(`exists   KV namespace ${kvTitle}`);
} else {
  const r = await cf("POST", ns, { title: kvTitle });
  if (!r.ok) fail(`creating KV namespace ${kvTitle}`, r);
  namespaceId = r.json.result.id;
  console.log(`created  KV namespace ${kvTitle}`);
}

// 3. R2 bucket, by name.
const b = `/accounts/${accountId}/r2/buckets`;
const got = await cf("GET", `${b}/${encodeURIComponent(bucket)}`);
if (got.ok) {
  console.log(`exists   R2 bucket ${bucket}`);
} else if (got.status === 404) {
  const r = await cf("POST", b, { name: bucket });
  if (!r.ok) fail(`creating R2 bucket ${bucket}`, r);
  console.log(`created  R2 bucket ${bucket}`);
} else {
  fail(`reading R2 bucket ${bucket}`, got);
}

const secret = createHash("sha256").update(token).digest("hex");
console.log("");
console.log(`CLOUDFLARE_ACCOUNT_ID=${accountId}`);
console.log(`CLOUDFLARE_KV_NAMESPACE_ID=${namespaceId}`);
console.log(`R2_BUCKET=${bucket}`);
console.log(`R2_ACCESS_KEY_ID=${tokenId ?? "<token id>"}`);
console.log("R2_SECRET_ACCESS_KEY=<sha256 of CLOUDFLARE_API_TOKEN, not printed>");

if (envFile) {
  const vars = {
    CLOUDFLARE_KV_NAMESPACE_ID: namespaceId,
    R2_BUCKET: bucket,
    R2_ACCESS_KEY_ID: tokenId,
    R2_SECRET_ACCESS_KEY: secret,
  };
  let text = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  for (const [k, v] of Object.entries(vars)) {
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text)
      ? text.replace(re, line)
      : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`;
  }
  writeFileSync(envFile, text, { mode: 0o600 });
  chmodSync(envFile, 0o600);
  console.log(`\nwrote the four values above into ${envFile} (mode 600)`);
}
