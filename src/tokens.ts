import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no look-alikes (l, o, 0, 1)

/** A short, URL-safe, unguessable-enough site id (10 chars ~ 50 bits). */
export function newSiteId(length = 10): string {
  const bytes = randomBytes(length);
  let out = "";
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return out;
}

/** A 256-bit edit/delete token, shown to the uploader exactly once. */
export function newEditToken(): string {
  return `marsa_${randomBytes(32).toString("base64url")}`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison of two strings (via their sha256, so lengths always match). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1]?.trim() || null;
}
