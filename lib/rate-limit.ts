/**
 * Simple in-memory IP rate limiter for auth-gated endpoints.
 *
 * Not distributed — fine for a single-container self-hosted app. Resets
 * on process restart, which is acceptable for the limits we need
 * (login + setup attempts).
 *
 * Tracks (window-start, count) per key. When the window expires the
 * entry is reset. Rejects with the seconds until the window resets.
 */

interface Bucket {
  windowStart: number;
  count: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  /** Max attempts per window. */
  max: number;
  /** Window duration in seconds. */
  windowSeconds: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** Remaining attempts in the current window. */
  remaining: number;
  /** Seconds until the current window resets (and attempts refresh). 0 if ok. */
  retryAfter: number;
}

export function rateLimit(
  key: string,
  opts: RateLimitOptions,
): RateLimitResult {
  const now = Math.floor(Date.now() / 1000);
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= opts.windowSeconds) {
    buckets.set(key, { windowStart: now, count: 1 });
    return { ok: true, remaining: opts.max - 1, retryAfter: 0 };
  }
  bucket.count += 1;
  if (bucket.count > opts.max) {
    const retryAfter = opts.windowSeconds - (now - bucket.windowStart);
    return { ok: false, remaining: 0, retryAfter: Math.max(1, retryAfter) };
  }
  return {
    ok: true,
    remaining: opts.max - bucket.count,
    retryAfter: 0,
  };
}

/** Test helper: clear all buckets. */
export function _resetRateLimit(): void {
  buckets.clear();
}