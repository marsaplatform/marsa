import type { Context } from "hono";

interface NodeBindings {
  incoming?: { socket?: { remoteAddress?: string } };
  server?: { incoming?: { socket?: { remoteAddress?: string } } };
}

/**
 * Best-effort client IP. Behind a reverse proxy (TRUST_PROXY=true) uses
 * X-Real-IP, else the LAST X-Forwarded-For hop (the one your proxy appended;
 * earlier hops are client-controlled). Otherwise the socket address.
 * The IP is only used as an in-memory rate-limit key; it is never stored or logged.
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
  const env = c.env as NodeBindings | undefined;
  const incoming = env?.server?.incoming ?? env?.incoming;
  return incoming?.socket?.remoteAddress ?? "unknown";
}
