import { Buffer } from "node:buffer";
import type { Entry, ZipFile } from "yauzl";
import yauzl from "yauzl";
import { UploadError } from "./errors.js";
import { isBlocked } from "./mime.js";
import { normalizeEntryPath, stripCommonRoot } from "./paths.js";

/** A single file to publish: site-relative path + raw bytes. */
export interface UploadEntry {
  path: string;
  bytes: Uint8Array;
}

export interface Limits {
  maxFileBytes: number;
  maxSiteBytes: number;
  maxFiles: number;
}

/** One file in a JSON `files[]` payload. */
export interface FileInput {
  path: string;
  content: string;
  /** `utf8` (default) for text, `base64` for binary. */
  encoding?: "utf8" | "base64";
}

export function fromFilesArray(files: FileInput[]): UploadEntry[] {
  return files.map((f) => {
    if (typeof f?.path !== "string" || typeof f?.content !== "string") {
      throw new UploadError("INVALID_REQUEST", "each file needs a string path and content");
    }
    const encoding = f.encoding ?? "utf8";
    if (encoding === "utf8") return { path: f.path, bytes: new TextEncoder().encode(f.content) };
    if (encoding === "base64") {
      return { path: f.path, bytes: new Uint8Array(Buffer.from(f.content, "base64")) };
    }
    throw new UploadError("INVALID_ENCODING", `unknown encoding: ${String(encoding)}`, f.path);
  });
}

function zipError(message: string, path?: string): UploadError {
  if (/invalid relative path|absolute path/i.test(message)) {
    return new UploadError("ZIP_SLIP_REJECTED", message, path);
  }
  return new UploadError("INVALID_ZIP", message, path);
}

function openZip(buffer: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) {
        reject(zipError(err?.message ?? "could not open zip"));
        return;
      }
      resolve(zip);
    });
  });
}

function readEntryBytes(zip: ZipFile, entry: Entry, maxFileBytes: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(new UploadError("INVALID_ZIP", err?.message ?? "could not read zip entry"));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      stream.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxFileBytes) {
          stream.destroy();
          reject(
            new UploadError("ZIP_BOMB_REJECTED", "entry too large while inflating", entry.fileName),
          );
          return;
        }
        chunks.push(chunk);
      });
      stream.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
      stream.on("error", (e) => reject(new UploadError("INVALID_ZIP", e.message, entry.fileName)));
    });
  });
}

/**
 * Read a ZIP archive entry by entry. Each entry's declared size is checked
 * BEFORE inflating, and the running total is bounded, so a zip bomb is
 * rejected before it can exhaust memory. Adapted from canvas-drop (MIT).
 */
export async function fromZip(buffer: Buffer, limits: Limits): Promise<UploadEntry[]> {
  const zip = await openZip(buffer);
  const out: UploadEntry[] = [];
  let total = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on("error", (e: Error) => reject(zipError(e.message)));
      zip.on("end", () => resolve());
      zip.on("entry", (entry: Entry) => {
        (async () => {
          if (entry.fileName.endsWith("/")) return;
          if (entry.uncompressedSize > limits.maxFileBytes) {
            throw new UploadError(
              "FILE_TOO_LARGE",
              "file exceeds the per-file cap",
              entry.fileName,
            );
          }
          total += entry.uncompressedSize;
          if (total > limits.maxSiteBytes) {
            throw new UploadError("SITE_TOO_LARGE", "archive exceeds the site size cap");
          }
          if (out.length >= limits.maxFiles * 2) {
            throw new UploadError("TOO_MANY_FILES", "archive has too many entries");
          }
          out.push({
            path: entry.fileName,
            bytes: await readEntryBytes(zip, entry, limits.maxFileBytes),
          });
        })().then(
          () => zip.readEntry(),
          (e) => reject(e),
        );
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
  return out;
}

/**
 * Validate and normalize a raw upload: path safety, dotfile stripping, blocked
 * file types, size/count caps. Returns a path -> bytes map ready to store.
 */
export function prepareSite(entries: UploadEntry[], limits: Limits): Map<string, Uint8Array> {
  const cleaned: UploadEntry[] = [];
  for (const e of entries) {
    const p = normalizeEntryPath(e.path);
    if (p === null) continue;
    if (p.startsWith("__MACOSX/")) continue;
    cleaned.push({ path: p, bytes: e.bytes });
  }
  if (cleaned.length === 0) throw new UploadError("EMPTY_UPLOAD", "no files to publish");

  const paths = stripCommonRoot(cleaned.map((e) => e.path));
  const site = new Map<string, Uint8Array>();
  let total = 0;
  cleaned.forEach((e, i) => {
    const path = paths[i] as string;
    if (isBlocked(path)) {
      throw new UploadError("BLOCKED_FILE_TYPE", `file type not allowed: ${path}`, path);
    }
    if (e.bytes.byteLength > limits.maxFileBytes) {
      throw new UploadError("FILE_TOO_LARGE", `${path} exceeds the per-file cap`, path);
    }
    total += e.bytes.byteLength;
    if (total > limits.maxSiteBytes) {
      throw new UploadError("SITE_TOO_LARGE", "upload exceeds the site size cap");
    }
    site.set(path, e.bytes);
  });
  if (site.size > limits.maxFiles) {
    throw new UploadError("TOO_MANY_FILES", `upload exceeds ${limits.maxFiles} files`);
  }
  return site;
}
