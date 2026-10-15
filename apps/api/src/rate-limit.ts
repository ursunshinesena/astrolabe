/**
 * Sliding-window limiter: at most `limit` hits per `windowMs` for each key
 * (CLAUDE.md §6.9 — max 3 execution requests per user per 10s).
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit = 3,
    private readonly windowMs = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a hit and returns true if it is allowed. */
  allow(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((at) => t - at < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    return true;
  }
}
