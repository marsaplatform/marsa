import type { SiteMeta } from "./store.js";

/**
 * Cover images for the public directory.
 *
 * Nothing is fetched from outside and nothing is rendered in a browser: a
 * cover is always a raster image that is already part of the site.
 * In order of preference:
 *   1. a file named cover.(png|jpg|jpeg|webp|avif|gif) at the site root,
 *   2. the page's og:image / twitter:image, if it points to a file inside the site,
 *   3. the first <img> in index.html that points to a file inside the site.
 * Anything else (no image, SVG, external URL, too big) gets a generated placeholder.
 */

/** Largest image the directory will serve as a cover. */
export const COVER_MAX_BYTES = 2 * 1024 * 1024;

const RASTER = new Set(["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif"]);
const NAMES = ["cover.png", "cover.jpg", "cover.jpeg", "cover.webp", "cover.avif", "cover.gif"];

export interface Cover {
  path: string;
  mime: string;
  source: "file" | "og" | "img";
}

const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

/** Resolve a URL found in index.html to a file path inside the site, or null. */
export function localPath(raw: string, siteId: string, publicUrl: string): string | null {
  let ref = decodeEntities(raw.trim());
  if (!ref || ref.length > 1024) return null;
  if (/^(data|javascript|blob):/i.test(ref)) return null;
  const base = `https://site.invalid/s/${siteId}/`;
  // An absolute link to this very site on this instance counts as local.
  const own = `${publicUrl.replace(/\/+$/, "")}/s/${siteId}/`;
  if (ref.startsWith(own)) ref = ref.slice(own.length);
  else if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(ref)) return null; // external
  let u: URL;
  try {
    u = new URL(ref, base);
  } catch {
    return null;
  }
  if (u.origin !== "https://site.invalid" || !u.pathname.startsWith(`/s/${siteId}/`)) return null;
  let path: string;
  try {
    path = decodeURIComponent(u.pathname.slice(`/s/${siteId}/`.length));
  } catch {
    return null;
  }
  return path || null;
}

function usable(meta: SiteMeta, path: string | null): { path: string; mime: string } | null {
  if (!path || !Object.hasOwn(meta.files, path)) return null;
  const f = meta.files[path];
  if (!f || !RASTER.has(f.mime) || f.size <= 0 || f.size > COVER_MAX_BYTES) return null;
  return { path, mime: f.mime };
}

const attr = (tag: string, name: string) =>
  new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
const attrValue = (tag: string, name: string) => {
  const m = attr(tag, name);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
};

/** Pick a cover for a site. `indexHtml` is the start of index.html, if the site has one. */
export function pickCover(
  meta: SiteMeta,
  indexHtml: Uint8Array | null,
  publicUrl: string,
): Cover | null {
  for (const name of NAMES) {
    const hit = usable(meta, name);
    if (hit) return { ...hit, source: "file" };
  }
  if (!indexHtml) return null;
  const html = new TextDecoder().decode(indexHtml.subarray(0, 128 * 1024));
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attrValue(tag, "property") ?? attrValue(tag, "name") ?? "").toLowerCase();
    if (key !== "og:image" && key !== "twitter:image") continue;
    const hit = usable(meta, localPath(attrValue(tag, "content") ?? "", meta.id, publicUrl));
    if (hit) return { ...hit, source: "og" };
  }
  const body = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of body.match(/<img\b[^>]*>/gi) ?? []) {
    const hit = usable(meta, localPath(attrValue(tag, "src") ?? "", meta.id, publicUrl));
    if (hit) return { ...hit, source: "img" };
  }
  return null;
}

/** Does the file really start like the image type it claims to be? */
export function looksLike(mime: string, b: Uint8Array): boolean {
  const at = (i: number, ...xs: number[]) => xs.every((x, j) => b[i + j] === x);
  const ascii = (i: number, s: string) => at(i, ...[...s].map((ch) => ch.charCodeAt(0)));
  switch (mime) {
    case "image/png":
      return at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/jpeg":
      return at(0, 0xff, 0xd8, 0xff);
    case "image/gif":
      return ascii(0, "GIF87a") || ascii(0, "GIF89a");
    case "image/webp":
      return ascii(0, "RIFF") && ascii(8, "WEBP");
    case "image/avif":
      return ascii(4, "ftyp") && (ascii(8, "avif") || ascii(8, "avis"));
    default:
      return false;
  }
}

/** A stable small number for a string (placeholder colour, etc.). */
export function hashIndex(s: string, n: number): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % n;
}

/** The first visible letter of a title (a whole grapheme, so Arabic and emoji stay intact). */
export function initialOf(title: string): string {
  const clean = title.replace(/[\s\p{P}\p{S}]+/gu, " ").trim();
  if (!clean) return "م";
  const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const { segment } of seg.segment(clean)) return segment.toLocaleUpperCase();
  return "م";
}
