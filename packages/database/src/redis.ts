import { Redis } from 'ioredis';

export interface LockHandle {
  acquired: boolean;
  release: () => Promise<void>;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

export class RedisService {
  private client: Redis | null = null;
  private isConnected = false;
  private inMemoryLocks = new Map<string, number>();
  private inMemoryRateLimits = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly redisUrl?: string) {
    if (this.redisUrl && !process.env['MOCK_REDIS']) {
      try {
        this.client = new Redis(this.redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          connectTimeout: 2000,
          retryStrategy: () => null // don't hang if redis is not running
        });
      } catch {
        this.client = null;
      }
    }
  }

  public async connect(): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.connect();
      this.isConnected = true;
      return true;
    } catch {
      this.isConnected = false;
      return false;
    }
  }

  public async disconnect(): Promise<void> {
    if (this.client && this.isConnected) {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
      this.isConnected = false;
    }
  }

  /**
   * Acquire a short-lived distributed lock with TTL.
   */
  public async acquireLock(key: string, ttlMs = 5000): Promise<LockHandle> {
    const lockKey = `lock:${key}`;
    const token = Math.random().toString(36).slice(2);

    if (this.client && this.isConnected) {
      try {
        const result = await this.client.set(lockKey, token, 'PX', ttlMs, 'NX');
        if (result === 'OK') {
          return {
            acquired: true,
            release: async () => {
              const script = `
                if redis.call("get", KEYS[1]) == ARGV[1] then
                  return redis.call("del", KEYS[1])
                else
                  return 0
                end
              `;
              try {
                await this.client!.eval(script, 1, lockKey, token);
              } catch {
                // Ignore release errors
              }
            }
          };
        }
        return { acquired: false, release: async () => {} };
      } catch {
        // Fallback to in-memory lock
      }
    }

    // In-memory fallback
    const now = Date.now();
    const existingExpiry = this.inMemoryLocks.get(lockKey);
    if (existingExpiry && existingExpiry > now) {
      return { acquired: false, release: async () => {} };
    }

    this.inMemoryLocks.set(lockKey, now + ttlMs);
    return {
      acquired: true,
      release: async () => {
        this.inMemoryLocks.delete(lockKey);
      }
    };
  }

  /**
   * Rate limiting using sliding window.
   */
  public async checkRateLimit(
    key: string,
    maxRequests: number,
    windowSeconds: number
  ): Promise<RateLimitResult> {
    const rateKey = `ratelimit:${key}`;

    if (this.client && this.isConnected) {
      try {
        const current = await this.client.incr(rateKey);
        if (current === 1) {
          await this.client.expire(rateKey, windowSeconds);
        }
        const ttl = await this.client.ttl(rateKey);
        const allowed = current <= maxRequests;
        return {
          allowed,
          remaining: Math.max(0, maxRequests - current),
          resetSeconds: ttl > 0 ? ttl : windowSeconds
        };
      } catch {
        // Fallback to in-memory
      }
    }

    // In-memory fallback
    const now = Date.now();
    const entry = this.inMemoryRateLimits.get(rateKey);

    if (!entry || entry.resetAt <= now) {
      this.inMemoryRateLimits.set(rateKey, { count: 1, resetAt: now + windowSeconds * 1000 });
      return {
        allowed: true,
        remaining: maxRequests - 1,
        resetSeconds: windowSeconds
      };
    }

    entry.count += 1;
    const allowed = entry.count <= maxRequests;
    const remaining = Math.max(0, maxRequests - entry.count);
    const resetSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));

    return { allowed, remaining, resetSeconds };
  }
}
