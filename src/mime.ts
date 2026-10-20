/**
 * Extension -> MIME mapping for site assets. Anything not in the safe map is
 * served as `text/plain` (never interpreted), always with `nosniff`.
 * Server-side executables and binaries are rejected at upload time.
 *
 * Adapted from canvas-drop (MIT).
 */
const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  bmp: "image/bmp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp4: "video/mp4",
  webm: "video/webm",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  pdf: "application/pdf",
  wasm: "application/wasm",
  csv: "text/csv; charset=utf-8",
  webmanifest: "application/manifest+json",
};

/** Rejected at upload: server-side scripts, executables, installers, archives-in-archives. */
export const BLOCKED_EXTENSIONS = new Set([
  "php",
  "phtml",
  "phar",
  "asp",
  "aspx",
  "jsp",
  "cgi",
  "pl",
  "py",
  "rb",
  "sh",
  "bash",
  "ps1",
  "exe",
  "msi",
  "bat",
  "cmd",
  "com",
  "scr",
  "dll",
  "so",
  "dylib",
  "bin",
  "apk",
  "dmg",
  "jar",
  "htaccess",
]);

export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

export function isBlocked(path: string): boolean {
  return BLOCKED_EXTENSIONS.has(extensionOf(path));
}

export function mimeFor(path: string): string {
  return MIME[extensionOf(path)] ?? "text/plain; charset=utf-8";
}
