/**
 * A tiny fixed-window limiter for the hook endpoint. The bridge is localhost
 * only, but a runaway hook still must not grow memory, so excess calls are
 * dropped instead of queued. Time is injected so the checks are deterministic.
 */

export const DEFAULT_HOOK_RATE_PER_SECOND = 200;

export interface HookRateLimiter {
  /** True when this call fits in the current one second window. */
  allow(): boolean;
}

export function createHookRateLimiter(
  maxPerSecond: number = DEFAULT_HOOK_RATE_PER_SECOND,
  now: () => number = Date.now,
): HookRateLimiter {
  const limit = Math.max(1, Math.trunc(maxPerSecond));
  let windowStart = Math.trunc(now());
  let used = 0;

  return {
    allow(): boolean {
      const current = Math.trunc(now());
      // A wall clock that moves backwards starts a fresh window rather than
      // blocking every hook until it catches up.
      if (current < windowStart || current - windowStart >= 1000) {
        windowStart = current;
        used = 0;
      }
      if (used >= limit) return false;
      used += 1;
      return true;
    },
  };
}
