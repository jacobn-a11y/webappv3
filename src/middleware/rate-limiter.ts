/**
 * Rate Limiting Middleware
 *
 * Protects API endpoints from abuse and runaway costs.
 *
 * Three tiers:
 *   1. **Global** — baseline limit on all authenticated routes (200 req/min)
 *   2. **Expensive** — stricter limit on OpenAI-calling endpoints:
 *      /api/rag/query and /api/stories/build (20 req/min)
 *   3. **Webhook** — separate limit for inbound webhooks from Merge.dev
 *      to prevent replay attacks (60 req/min)
 *
 * Rate limits are keyed by organizationId when available, falling back
 * to IP address. This prevents one user from affecting other orgs.
 *
 * In production, use RedisStore for distributed rate limiting across
 * multiple server instances. In development, the default MemoryStore
 * is used.
 */

import rateLimit from "express-rate-limit";
import type { Request } from "express";

// ─── Key Generator ──────────────────────────────────────────────────────────

interface AuthenticatedRequest extends Request {
  organizationId?: string;
  userId?: string;
}

/**
 * Generates a rate limit key from org ID + user ID, or falls back to IP.
 * This ensures limits are per-user-per-org, not per-IP (which would
 * penalize shared office networks).
 */
function keyGenerator(req: AuthenticatedRequest): string {
  if (req.organizationId && req.userId) {
    return `${req.organizationId}:${req.userId}`;
  }
  if (req.organizationId) {
    return req.organizationId;
  }
  return req.ip ?? "unknown";
}

/**
 * For webhooks, key by IP since there's no user/org in the auth sense.
 */
function webhookKeyGenerator(req: Request): string {
  return `webhook:${req.ip ?? "unknown"}`;
}

// ─── Rate Limit Tiers ───────────────────────────────────────────────────────

const STANDARD_HEADERS = true;
const LEGACY_HEADERS = false;

/**
 * Shared validation config — disable the IPv6 key generator validation
 * since our primary key generators use org/user IDs, not raw IPs.
 * IP is only a fallback for unauthenticated requests.
 */
const SHARED_VALIDATE = { keyGeneratorIpFallback: false } as const;

/**
 * Global rate limiter for all authenticated API routes.
 * 200 requests per minute per user.
 */
export const globalRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 200,
  standardHeaders: STANDARD_HEADERS,
  legacyHeaders: LEGACY_HEADERS,
  keyGenerator,
  validate: SHARED_VALIDATE,
  message: {
    error: "rate_limit_exceeded",
    message: "Too many requests. Please try again shortly.",
    retry_after_seconds: 60,
  },
});

/**
 * Strict rate limiter for expensive endpoints that call OpenAI.
 * /api/rag/query and /api/stories/build — 20 requests per minute per user.
 *
 * These endpoints incur significant API costs ($0.01–$0.10+ per call),
 * so a lower limit protects against both abuse and accidental loops.
 */
export const expensiveRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 20,
  standardHeaders: STANDARD_HEADERS,
  legacyHeaders: LEGACY_HEADERS,
  keyGenerator,
  validate: SHARED_VALIDATE,
  message: {
    error: "rate_limit_exceeded",
    message:
      "Too many AI requests. These endpoints call external AI services — please slow down.",
    retry_after_seconds: 60,
  },
});

/**
 * Webhook rate limiter for Merge.dev inbound webhooks.
 * 60 requests per minute per source IP.
 */
export const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 60,
  standardHeaders: STANDARD_HEADERS,
  legacyHeaders: LEGACY_HEADERS,
  keyGenerator: webhookKeyGenerator,
  validate: SHARED_VALIDATE,
  message: {
    error: "rate_limit_exceeded",
    message: "Too many webhook requests.",
    retry_after_seconds: 60,
  },
});

/**
 * Auth/billing endpoint limiter — tighter to prevent brute force.
 * 10 requests per minute per IP.
 */
export const authRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: STANDARD_HEADERS,
  legacyHeaders: LEGACY_HEADERS,
  keyGenerator: (req: Request) => req.ip ?? "unknown",
  validate: SHARED_VALIDATE,
  message: {
    error: "rate_limit_exceeded",
    message: "Too many authentication attempts. Please wait.",
    retry_after_seconds: 60,
  },
});
