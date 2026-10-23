/**
 * Minimal in-memory fixed-window rate limiter.
 *
 * State lives in the memory of one server instance, so on serverless hosting
 * the limit applies per warm instance. That is enough to slow down scripted
 * abuse of public endpoints such as /api/register. Use a shared store (Redis,
 * Upstash) if a hard global limit is ever required.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_TRACKED_KEYS = 5000;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets (only meaningful when blocked). */
  retryAfterSec: number;
};

export function checkRateLimit(
  key: string,
  options: { limit: number; windowMs: number },
  now: number = Date.now()
): RateLimitResult {
  // Drop expired buckets when the map grows, so memory stays bounded.
  if (buckets.size >= MAX_TRACKED_KEYS) {
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k);
    }
    if (buckets.size >= MAX_TRACKED_KEYS) buckets.clear();
  }

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return { allowed: true, remaining: options.limit - 1, retryAfterSec: 0 };
  }

  if (existing.count >= options.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: options.limit - existing.count,
    retryAfterSec: 0,
  };
}

/** Best-effort client address from proxy headers. */
export function getClientIp(headers: {
  get(name: string): string | null;
}): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim() || 'unknown';
  return headers.get('x-real-ip')?.trim() || 'unknown';
}

/** Test helper: clear all counters. */
export function resetRateLimits() {
  buckets.clear();
}
