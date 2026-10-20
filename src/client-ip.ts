import type { Context } from "hono";

/**
 * Best-effort client IP. Behind a reverse proxy (TRUST_PROXY=true) uses
 * X-Real-IP, else the LAST X-Forwarded-For hop (the one your proxy appended;
 * earlier hops are client-controlled). Otherwise the socket address.
 */
export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const real = c.req.header("x-real-ip")?.trim();
    if (real) return real;
    const xff = c.req.header("x-forwarded-for");
    if (xff) {
      const hops = xff
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const last = hops[hops.length - 1];
      if (last) return last;
    }
  }
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
    ?.incoming;
  return incoming?.socket?.remoteAddress ?? "unknown";
}
