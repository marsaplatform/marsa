import { UploadError } from "./errors.js";

/**
 * Normalize and validate an uploaded file path. Rejects path traversal and
 * absolute paths (zip-slip) and signals dotfiles for stripping.
 * Returns the cleaned forward-slash path, or `null` when the entry should be
 * dropped (dotfile / empty / directory marker).
 *
 * Adapted from canvas-drop (MIT).
 */
export function normalizeEntryPath(raw: string): string | null {
  const unified = raw.replace(/\\/g, "/");
  if (/^[a-zA-Z]:\//.test(unified)) {
    throw new UploadError("INVALID_PATH", `absolute path not allowed: ${raw}`, raw);
  }
  if (unified.includes("\0")) {
    throw new UploadError("INVALID_PATH", "path contains a NUL byte", raw);
  }
  const p = unified.replace(/^\.?\/+/, "");
  if (p === "" || p.endsWith("/")) return null;

  const segments = p.split("/").filter((seg) => seg !== "." && seg !== "");
  if (segments.length === 0) return null;
  for (const seg of segments) {
    if (seg === "..") {
      throw new UploadError("ZIP_SLIP_REJECTED", `path escapes the site root: ${raw}`, raw);
    }
    if (seg.startsWith(".")) return null; // .git, .env, .DS_Store ... are stripped
  }
  const out = segments.join("/");
  if (out.length > 512) throw new UploadError("INVALID_PATH", "path too long", raw);
  return out;
}

/**
 * If every file lives under one shared top-level folder (common when zipping a
 * folder or dropping a directory), strip that folder so `site/index.html`
 * becomes `index.html`.
 */
export function stripCommonRoot(paths: string[]): string[] {
  if (paths.length === 0) return paths;
  const first = paths[0]?.split("/")[0];
  if (!first || !paths.every((p) => p.includes("/") && p.split("/")[0] === first)) return paths;
  return paths.map((p) => p.slice(first.length + 1));
}
