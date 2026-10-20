/**
 * In-process fixed-window rate limiter keyed by client IP. Single process, no
 * broker; good enough for a small self-hosted instance. Idea adapted from
 * canvas-drop (MIT).
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

const MAX_KEYS = 50_000;

export class RateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  hit(key: string, limit: number, windowMs: number): RateLimitResult {
    const ts = this.now();
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= ts) {
      if (!b && this.buckets.size >= MAX_KEYS) this.sweep(ts);
      b = { count: 0, resetAt: ts + windowMs };
      this.buckets.set(key, b);
    }
    b.count++;
    const allowed = b.count <= limit;
    return {
      allowed,
      remaining: Math.max(0, limit - b.count),
      retryAfterSec: allowed ? 0 : Math.ceil((b.resetAt - ts) / 1000),
    };
  }

  sweep(ts = this.now()): void {
    for (const [k, b] of this.buckets) if (b.resetAt <= ts) this.buckets.delete(k);
    // Still full of live buckets: drop the oldest insertions to bound memory.
    while (this.buckets.size >= MAX_KEYS) {
      const first = this.buckets.keys().next().value;
      if (first === undefined) break;
      this.buckets.delete(first);
    }
  }
}
