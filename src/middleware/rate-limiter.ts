/**
 * Simple In-Memory Rate Limiter
 *
 * Provides request rate limiting without external dependencies.
 * Uses a sliding window counter per IP address.
 *
 * For production at scale, replace with Redis-backed rate limiting.
 */

import type { Request, Response, NextFunction } from "express";

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
}

/**
 * Creates a rate limiting middleware.
 *
 * @param options - Configuration for the rate limiter
 * @returns Express middleware function
 */
export function createRateLimiter(options: RateLimiterOptions) {
  const { maxRequests, windowMs, message } = options;
  const store = new Map<string, RateLimitEntry>();

  // Periodic cleanup of expired entries to prevent memory leaks
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.resetAt) {
        store.delete(key);
      }
    }
  }, windowMs * 2);

  // Allow cleanup interval to be garbage collected on process exit
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const now = Date.now();

    const entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      // New window
      store.set(key, { count: 1, resetAt: now + windowMs });
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
});

/**
 * General API rate limiter.
 * Limits to 100 requests per minute per IP.
 */
export const apiRateLimiter = createRateLimiter({
  maxRequests: 100,
  windowMs: 60_000, // 1 minute
});

/**
 * Webhook rate limiter.
 * Higher limit for webhooks since they come from trusted sources.
 */
export const webhookRateLimiter = createRateLimiter({
  maxRequests: 200,
  windowMs: 60_000, // 1 minute
});
