/**
 * Redis-Backed Rate Limiter
 *
 * Uses Redis INCR + EXPIRE for distributed rate limiting across
 * multiple instances. Falls back to in-memory Map when Redis
 * is unavailable (dev/test).
 */

import type { Request, Response, NextFunction } from "express";
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimiterOptions {
  /** Maximum requests allowed within the window. */
  maxRequests: number;
  /** Time window in milliseconds. */
  windowMs: number;
  /** Custom message for 429 responses. */
  message?: string;
  /** Name used as Redis key prefix. */
  name?: string;
}

// ─── Rate limiter factory ─────────────────────────────────────────────────────

/**
 * Creates a rate limiting middleware.
 *
 * @param options - Configuration for the rate limiter
 * @returns Express middleware function
 */
export function createRateLimiter(options: RateLimiterOptions) {
  const { maxRequests, windowMs, message, name } = options;
  const store = new Map<string, RateLimitEntry>();

  // Periodic cleanup of expired entries to prevent memory leaks (fallback only)
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.resetAt) {
        store.delete(key);
      }
    }
  }, windowMs * 2);

  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  const ttlSeconds = Math.max(1, Math.ceil(windowMs / 1000));

  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";

    const redis = await getRedisClient();

    if (redis) {
      const redisKey = `ratelimit:${name ?? "default"}:${ip}`;
      try {
        const count = await redis.incr(redisKey);
        if (count === 1) {
          await redis.expire(redisKey, ttlSeconds);
        }

        if (count > maxRequests) {
          const ttl = await redis.ttl(redisKey);
          const retryAfter = ttl > 0 ? ttl : ttlSeconds;
          res.setHeader("Retry-After", retryAfter.toString());
          res.status(429).json({
            error: "rate_limit_exceeded",
            message: message ?? "Too many requests. Please try again later.",
            retry_after_seconds: retryAfter,
          });
          return;
        }

        next();
        return;
      } catch {
        // Redis error — fall through to in-memory
      }
    }

    // In-memory fallback
    const now = Date.now();
    const entry = store.get(ip);

    if (!entry || now > entry.resetAt) {
      store.set(ip, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    entry.count++;

    if (entry.count > maxRequests) {
      const retryAfterMs = entry.resetAt - now;
      res.setHeader("Retry-After", Math.ceil(retryAfterMs / 1000).toString());
      res.status(429).json({
        error: "rate_limit_exceeded",
        message: message ?? "Too many requests. Please try again later.",
        retry_after_seconds: Math.ceil(retryAfterMs / 1000),
      });
      return;
    }

    next();
  };
}

/**
 * Stricter rate limiter for password-protected endpoints.
 * Limits to 5 attempts per minute per IP to prevent brute-force.
 */
export const passwordRateLimiter = createRateLimiter({
  maxRequests: 5,
  windowMs: 60_000, // 1 minute
  message: "Too many password attempts. Please wait before trying again.",
  name: "password",
});

/**
 * General API rate limiter.
 * Limits to 100 requests per minute per IP.
 */
export const apiRateLimiter = createRateLimiter({
  maxRequests: 100,
  windowMs: 60_000, // 1 minute
  name: "api",
});

/**
 * Webhook rate limiter.
 * Higher limit for webhooks since they come from trusted sources.
 */
export const webhookRateLimiter = createRateLimiter({
  maxRequests: 200,
  windowMs: 60_000, // 1 minute
  name: "webhook",
});

/**
 * Export rate limiter.
 * Stricter than API limit — PDF/DOCX export launches Puppeteer (heavyweight).
 */
export const exportRateLimiter = createRateLimiter({
  maxRequests: 10,
  windowMs: 60_000, // 1 minute
  message: "Too many export requests. Please wait before trying again.",
  name: "export",
});
