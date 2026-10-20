#!/usr/bin/env node
// One-time setup of the Appwrite resources Marsa's optional backend uses.
// Reads the same APPWRITE_* variables as the server (from the environment or .env).
// Usage: node --env-file=.env scripts/appwrite-setup.mjs
// Safe to re-run: existing resources are kept.
import { Client, Storage, TablesDB, TablesDBIndexType } from "node-appwrite";

const env = (k, d) => process.env[k]?.trim() || d;
const endpoint = env("APPWRITE_ENDPOINT");
const projectId = env("APPWRITE_PROJECT_ID");
const apiKey = env("APPWRITE_API_KEY");
const databaseId = env("APPWRITE_DATABASE_ID");
const tableId = env("APPWRITE_KV_TABLE_ID", "marsa_kv");
const bucketId = env("APPWRITE_BUCKET_ID", "marsa_files");
const maxFileMb = Number(env("MAX_FILE_MB", "10"));

if (!endpoint || !projectId || !apiKey || !databaseId) {
  console.error(
    "Set APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY and APPWRITE_DATABASE_ID first.",
  );
  process.exit(1);
}

const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
const tables = new TablesDB(client);
const storage = new Storage(client);

async function ensure(label, fn) {
  try {
    await fn();
    console.log(`created  ${label}`);
  } catch (err) {
    if (err?.code === 409) console.log(`exists   ${label}`);
    else throw err;
  }
}

await ensure(`database ${databaseId}`, () => tables.create({ databaseId, name: "Marsa" }));
// No table-level permissions: only the server API key can read or write.
await ensure(`table ${tableId}`, () =>
  tables.createTable({
    databaseId,
    tableId,
    name: "Marsa KV",
    permissions: [],
    rowSecurity: false,
  }),
);
await ensure("column siteId", () =>
  tables.createStringColumn({ databaseId, tableId, key: "siteId", size: 32, required: true }),
);
await ensure("column key", () =>
  tables.createStringColumn({ databaseId, tableId, key: "key", size: 128, required: true }),
);
await ensure("column value", () =>
  tables.createLongtextColumn({ databaseId, tableId, key: "value", required: true }),
);
// Columns are created asynchronously; give Appwrite a moment before indexing them.
await new Promise((r) => setTimeout(r, 3000));
await ensure("index by_site", () =>
  tables.createIndex({
    databaseId,
    tableId,
    key: "by_site",
    type: TablesDBIndexType.Key,
    columns: ["siteId"],
  }),
);
await ensure(`bucket ${bucketId}`, () =>
  storage.createBucket({
    bucketId,
    name: "Marsa files",
    permissions: [],
    fileSecurity: false,
    maximumFileSize: maxFileMb * 1024 * 1024,
  }),
);
console.log("Done. Restart Marsa; the log should say: data/files backend: appwrite (...)");
