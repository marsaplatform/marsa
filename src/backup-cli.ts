/**
 * Backup command line (0.16.0). Runs inside the container, with the same env:
 *
 *   node dist/backup-cli.js list                    backups in the store, newest first
 *   node dist/backup-cli.js run                     take a backup now
 *   node dist/backup-cli.js verify [key]            decrypt + check hashes (default: newest)
 *   node dist/backup-cli.js restore <key|file> <dir> restore into an EMPTY directory
 *
 * Restore never touches the live data directory: restore into a new directory,
 * stop the service, swap the directories, start it again (see docs/backups.md).
 */
import { readFile } from "node:fs/promises";
import { CloudflareBackend } from "./backend/cloudflare.js";
import {
  BACKUP_PREFIX,
  BackupService,
  type BlobStore,
  DirBlobStore,
  r2BlobStore,
  restoreTo,
  verifyBlob,
} from "./backup.js";
import { APP_VERSION } from "./brand.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const store: BlobStore | null = config.cloudflare
  ? r2BlobStore(new CloudflareBackend(config.cloudflare), config.cloudflare.r2Bucket)
  : config.backup.dir
    ? new DirBlobStore(config.backup.dir)
    : null;
const svc = new BackupService({
  dataDir: config.dataDir,
  store,
  secret: config.backup.secret,
  app: APP_VERSION,
  hourUtc: config.backup.hourUtc,
  keepDaily: config.backup.keepDaily,
  keepWeekly: config.backup.keepWeekly,
  maxBytes: config.backup.maxBytes,
});
const key = svc.keyBytes;
const die = (m: string): never => {
  console.error(m);
  process.exit(1);
};
if (!store) die("no backup store (configure the R2 backend or BACKUP_DIR)");
if (!key) die("no backup key (BACKUP_KEY or MARSA_SECRETS_KEY)");
const s = store as BlobStore;
const k = key as Buffer;

const newest = async () => {
  const all = (await s.list(BACKUP_PREFIX)).sort((a, b) => b.key.localeCompare(a.key));
  return all[0]?.key ?? die("no backups yet");
};
const load = async (ref: string): Promise<Uint8Array> => {
  if (ref.startsWith(BACKUP_PREFIX)) return (await s.get(ref)) ?? die(`not found: ${ref}`);
  return new Uint8Array(await readFile(ref));
};

const [cmd, a1, a2] = process.argv.slice(2);
if (cmd === "list") {
  const all = (await s.list(BACKUP_PREFIX)).sort((a, b) => b.key.localeCompare(a.key));
  for (const o of all) console.log(`${o.key}\t${o.size}\t${o.lastModified}`);
  console.log(`${all.length} backup(s) in ${s.where}`);
} else if (cmd === "run") {
  const r = await svc.run("manual");
  console.log(JSON.stringify(r));
  if (!r.ok) process.exit(1);
} else if (cmd === "verify") {
  const ref = a1 ?? (await newest());
  const m = verifyBlob(await load(ref), k);
  console.log(
    `OK ${ref}: ${m.files.length} files, ${m.bytes} bytes, made ${m.createdAt} by ${m.app}`,
  );
} else if (cmd === "restore") {
  if (!a1 || !a2) die("usage: restore <key|file> <empty dir>");
  const m = await restoreTo(await load(a1 as string), k, a2 as string);
  console.log(
    `restored ${m.files.length} files (${m.bytes} bytes, made ${m.createdAt}) into ${a2}`,
  );
} else {
  die("usage: backup-cli list | run | verify [key] | restore <key|file> <dir>");
}
