export interface RateLimitRule {
  windowMs: number;
  maxRequests: number;
}

export interface RateLimitStatus {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export class SlidingWindowRateLimiter {
  private hits = new Map<string, number[]>();

  public static readonly RULES: Record<string, RateLimitRule> = {
    LOGIN: { windowMs: 15 * 60 * 1000, maxRequests: 5 },       // 5 attempts per 15 minutes per IP
    REGISTER: { windowMs: 60 * 60 * 1000, maxRequests: 3 },     // 3 attempts per hour per IP
    BETS: { windowMs: 60 * 1000, maxRequests: 60 },            // 60 requests per minute per user
    WEBHOOKS: { windowMs: 60 * 1000, maxRequests: 120 }        // 120 per minute per IP
  };

  /**
   * Evaluates incoming request key against sliding window limits.
   */
  public check(key: string, rule: RateLimitRule, now = Date.now()): RateLimitStatus {
    const windowStart = now - rule.windowMs;
    const timestamps = (this.hits.get(key) || []).filter(t => t > windowStart);

    if (timestamps.length >= rule.maxRequests) {
      const oldest = timestamps[0]!;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + rule.windowMs - now) / 1000));
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);
    return {
      allowed: true,
      remaining: rule.maxRequests - timestamps.length,
      retryAfterSeconds: 0
    };
  }

  public reset(key?: string): void {
    if (key) {
      this.hits.delete(key);
    } else {
      this.hits.clear();
    }
  }
}
