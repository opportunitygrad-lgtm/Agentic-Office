import type { Redis } from "ioredis";

/**
 * Fixed-window counters used to throttle sensitive endpoints (login,
 * password reset, invitation acceptance). Redis in production; in-memory
 * for tests and when Redis is unavailable.
 */
export interface ThrottleStore {
  /** Increments `key` and returns the count within the current window. */
  hit(key: string, windowSeconds: number): Promise<number>;
  peek(key: string): Promise<number>;
  reset(key: string): Promise<void>;
}

export class MemoryThrottle implements ThrottleStore {
  private readonly counts = new Map<string, { n: number; until: number }>();
  async hit(key: string, windowSeconds: number) {
    const now = Date.now();
    const cur = this.counts.get(key);
    const next =
      cur && cur.until > now
        ? { n: cur.n + 1, until: cur.until }
        : { n: 1, until: now + windowSeconds * 1000 };
    this.counts.set(key, next);
    return next.n;
  }
  async peek(key: string) {
    const cur = this.counts.get(key);
    return cur && cur.until > Date.now() ? cur.n : 0;
  }
  async reset(key: string) {
    this.counts.delete(key);
  }
}

export class RedisThrottle implements ThrottleStore {
  private readonly fallback = new MemoryThrottle();
  constructor(private readonly redis: Redis) {}
  async hit(key: string, windowSeconds: number) {
    try {
      const k = `aibos:throttle:${key}`;
      const n = await this.redis.incr(k);
      if (n === 1) await this.redis.expire(k, windowSeconds);
      return n;
    } catch {
      return this.fallback.hit(key, windowSeconds);
    }
  }
  async peek(key: string) {
    try {
      return Number((await this.redis.get(`aibos:throttle:${key}`)) ?? 0);
    } catch {
      return this.fallback.peek(key);
    }
  }
  async reset(key: string) {
    try {
      await this.redis.del(`aibos:throttle:${key}`);
    } catch {
      await this.fallback.reset(key);
    }
  }
}

export const LIMITS = {
  loginPerIp: { max: 30, window: 15 * 60 },
  loginFailuresPerEmail: { max: 5, window: 15 * 60 },
  resetPerIp: { max: 10, window: 60 * 60 },
  resetPerEmail: { max: 3, window: 60 * 60 },
  tokenPerIp: { max: 20, window: 15 * 60 },
} as const;
