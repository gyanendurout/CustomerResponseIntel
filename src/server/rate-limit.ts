// Fixed-window per-key rate limiter, in memory. Best-effort: each serverless instance keeps its own counters.
// Swap for a shared store (e.g. Upstash) if strict global limits are ever needed.

export interface TakeResult { ok: boolean; remaining: number; retryAfterSec: number }

const MAX_TRACKED_KEYS = 10_000;

export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = 60_000,
    private readonly clock: () => number = Date.now,
  ) {}

  take(key: string): TakeResult {
    const now = this.clock();
    let w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      if (this.windows.size >= MAX_TRACKED_KEYS) this.windows.clear();
      w = { start: now, count: 0 };
      this.windows.set(key, w);
    }
    if (w.count >= this.limit) {
      return { ok: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((w.start + this.windowMs - now) / 1000)) };
    }
    w.count += 1;
    return { ok: true, remaining: this.limit - w.count, retryAfterSec: 0 };
  }
}
