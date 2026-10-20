/** Security headers shared by every response surface. */
export function baseHeaders(h: Headers): void {
  h.set("X-Content-Type-Options", "nosniff");
  // App pages opt into "same-origin" (so browsers send Origin on their own form
  // posts); everything else, including uploaded sites, sends no referrer.
  if (!h.has("Referrer-Policy")) h.set("Referrer-Policy", "no-referrer");
}

/** Strict CSP for the app's own pages (upload UI, manage page). */
export const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * CSP for user-uploaded content. `sandbox` without `allow-same-origin` gives
 * every uploaded page an opaque origin: it cannot read the app's cookies or
 * storage, or call the app's API as the visitor. `frame-ancestors 'none'`
 * stops uploaded pages from being framed for clickjacking.
 */
export const SITE_CSP = [
  "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");
