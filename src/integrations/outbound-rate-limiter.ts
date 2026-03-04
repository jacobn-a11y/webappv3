/**
 * Distributed token-bucket rate limiter for outbound API calls.
 * Prevents exceeding provider rate limits during sync/backfill.
 *
 * Uses Redis for distributed token tracking when available,
 * falls back to in-memory for dev/test.
 */

import { createClient, type RedisClientType } from "redis";

// ─── Redis client (lazy singleton) ────────────────────────────────────────────

let redisClient: RedisClientType | null = null;
let redisUnavailable = false;

async function getRedisClient(): Promise<RedisClientType | null> {
  if (redisClient) return redisClient;
  if (redisUnavailable) return null;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    redisClient = createClient({ url }) as RedisClientType;
    await redisClient.connect();
    return redisClient;
  } catch {
    redisUnavailable = true;
    return null;
  }
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────

export class OutboundRateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly maxTokens: number,
    private readonly refillRatePerSecond: number,
    private readonly name?: string
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    if (this.name) {
      const redis = await getRedisClient();
      if (redis) {
        return this.acquireRedis(redis);
      }
    }
    return this.acquireLocal();
  }

  private async acquireRedis(redis: RedisClientType): Promise<void> {
    const key = `outbound-ratelimit:${this.name}`;
    const intervalMs = Math.ceil(1000 / this.refillRatePerSecond);

    try {
      const now = Date.now();
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.pExpire(key, intervalMs);
      }
      if (count > this.maxTokens) {
        const pttl = await redis.pTTL(key);
        const waitMs = pttl > 0 ? pttl : intervalMs;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    } catch {
      // Redis error — fall through to local
      return this.acquireLocal();
    }
  }

  private async acquireLocal(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const waitMs = Math.ceil((1 / this.refillRatePerSecond) * 1000);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.refill();
    this.tokens = Math.max(0, this.tokens - 1);
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRatePerSecond);
    this.lastRefill = now;
  }
}
