/**
 * Rate Limiting Middleware
 *
 * Implements a sliding-window rate limiter using Redis sorted sets.
 * Each API key is limited to a configurable number of requests per window
 * (default: 100 requests per 60 seconds).
 *
 * Uses the same Redis instance that BullMQ connects to.
 */

import { Redis } from "ioredis";
import type { Response, NextFunction } from "express";
import type { ApiKeyAuthRequest } from "./api-key-auth.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RateLimiterConfig {
  /** Redis connection URL. Defaults to REDIS_URL env var or redis://localhost:6379. */
  redisUrl?: string;
  /** Maximum requests allowed within the window. Default: 100. */
  maxRequests?: number;
  /** Window size in seconds. Default: 60. */
  windowSeconds?: number;
  /** Key prefix in Redis. Default: "rl:". */
  keyPrefix?: string;
}

// ─── Middleware Factory ──────────────────────────────────────────────────────

export function createRateLimiter(config: RateLimiterConfig = {}) {
  const {
    redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379",
    maxRequests = 100,
    windowSeconds = 60,
    keyPrefix = "rl:",
  } = config;

  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    lazyConnect: true,
  });

  let connected = false;
  redis.connect().then(() => {
    connected = true;
  }).catch(() => {
    // If Redis is unavailable, rate limiting will be bypassed (fail-open)
  });

  return async (
    req: ApiKeyAuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const identifier = req.apiKeyId;
    if (!identifier) {
      // No API key attached — skip rate limiting (auth middleware should block)
      next();
      return;
    }

    // Fail-open if Redis is down — don't block legitimate requests
    if (!connected) {
      next();
      return;
    }

    const redisKey = `${keyPrefix}${identifier}`;
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;

    try {
      const pipeline = redis.pipeline();

      // Remove entries outside the sliding window
      pipeline.zremrangebyscore(redisKey, 0, windowStart);

      // Count entries in the current window
      pipeline.zcard(redisKey);

      // Add the current request (score = timestamp, member = unique id)
      pipeline.zadd(redisKey, now, `${now}:${Math.random().toString(36).slice(2, 8)}`);

      // Set TTL so keys auto-expire
      pipeline.expire(redisKey, windowSeconds + 1);

      const results = await pipeline.exec();
      if (!results) {
        next();
        return;
      }

      // results[1] is the ZCARD result: [error, count]
      const currentCount = (results[1]?.[1] as number) ?? 0;

      // Set rate limit headers on every response
      const remaining = Math.max(0, maxRequests - currentCount - 1);
      const resetAt = Math.ceil((now + windowSeconds * 1000) / 1000);
      res.setHeader("X-RateLimit-Limit", maxRequests);
      res.setHeader("X-RateLimit-Remaining", remaining);
      res.setHeader("X-RateLimit-Reset", resetAt);

      if (currentCount >= maxRequests) {
        const retryAfter = Math.ceil(windowSeconds - (now - windowStart) / 1000);
        res.setHeader("Retry-After", Math.max(1, retryAfter));
        res.status(429).json({
          error: "rate_limit_exceeded",
          message: `Rate limit of ${maxRequests} requests per ${windowSeconds} seconds exceeded. Try again later.`,
          limit: maxRequests,
          window_seconds: windowSeconds,
          retry_after: Math.max(1, retryAfter),
        });
        return;
      }

      next();
    } catch {
      // Fail-open on Redis errors
      next();
    }
  };
}
