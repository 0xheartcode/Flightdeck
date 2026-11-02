/** Sliding-window rate limiter: allows `limit` events per `windowMs`. */
export class RateLimiter {
  private readonly hits: number[] = [];

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Record an attempt; returns false (and does not record) when over the limit. */
  allow(now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    while (this.hits.length > 0) {
      const oldest = this.hits[0];
      if (oldest === undefined || oldest >= cutoff) break;
      this.hits.shift();
    }
    if (this.hits.length >= this.limit) return false;
    this.hits.push(now);
    return true;
  }
}
