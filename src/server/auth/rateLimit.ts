export interface RateLimiter {
  /** True when `key` already has `max` failures inside the window. */
  isLimited(key: string, now?: number): boolean;
  /** Milliseconds until the oldest failure leaves the window (0 when not limited). */
  retryAfterMs(key: string, now?: number): number;
  /** Counts one failure (or one request, for the request limiter). */
  record(key: string, now?: number): void;
  reset(key: string): void;
}

/**
 * In-memory sliding-window limiter. State is per process, which is fine for a single instance;
 * use a shared store before running several.
 */
export function createRateLimiter(opts: { max: number; windowMs: number }): RateLimiter {
  const hits = new Map<string, number[]>();

  function recent(key: string, now: number): number[] {
    const kept = (hits.get(key) ?? []).filter((t) => now - t < opts.windowMs);
    if (kept.length) hits.set(key, kept);
    else hits.delete(key);
    return kept;
  }

  function prune(now: number) {
    for (const key of hits.keys()) recent(key, now);
  }

  return {
    isLimited(key, now = Date.now()) {
      return recent(key, now).length >= opts.max;
    },
    retryAfterMs(key, now = Date.now()) {
      const list = recent(key, now);
      if (list.length < opts.max) return 0;
      return opts.windowMs - (now - list[list.length - opts.max]);
    },
    record(key, now = Date.now()) {
      prune(now);
      const list = recent(key, now);
      list.push(now);
      hits.set(key, list);
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;

/** Failed sign-ins per email + IP: 5 in 15 minutes. */
export const signInLimiter = createRateLimiter({ max: 5, windowMs: FIFTEEN_MINUTES });
/** Failed second-factor codes per session: 5 in 15 minutes. */
export const twoFactorLimiter = createRateLimiter({ max: 5, windowMs: FIFTEEN_MINUTES });
/** Sign-in link and reset requests per email + IP: 5 in 15 minutes, to stop mail flooding. */
export const emailRequestLimiter = createRateLimiter({ max: 5, windowMs: FIFTEEN_MINUTES });
