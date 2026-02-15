/**
 * Tests for Rate Limiter Middleware
 *
 * Tests the sliding-window rate limiter logic using mocked Redis.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Response, NextFunction } from "express";
import type { ApiKeyAuthRequest } from "../middleware/api-key-auth.js";

// Mock ioredis before importing the rate limiter
const mockExec = vi.fn();
const mockPipeline = vi.fn().mockReturnValue({
  zremrangebyscore: vi.fn().mockReturnThis(),
  zcard: vi.fn().mockReturnThis(),
  zadd: vi.fn().mockReturnThis(),
  expire: vi.fn().mockReturnThis(),
  exec: mockExec,
});

vi.mock("ioredis", () => {
  class MockRedis {
    pipeline = mockPipeline;
    connect = vi.fn().mockResolvedValue(undefined);
    status = "ready";
  }
  return { Redis: MockRedis };
});

import { createRateLimiter } from "../middleware/rate-limiter.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockRequest(apiKeyId?: string): ApiKeyAuthRequest {
  return {
    apiKeyId,
    headers: {},
  } as ApiKeyAuthRequest;
}

function mockResponse(): Response & { _headers: Record<string, string | number> } {
  const headers: Record<string, string | number> = {};
  return {
    _headers: headers,
    setHeader: vi.fn((key: string, value: string | number) => {
      headers[key] = value;
    }),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response & { _headers: Record<string, string | number> };
}

function mockNext(): NextFunction {
  return vi.fn();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("createRateLimiter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows requests under the limit", async () => {
    mockExec.mockResolvedValue([
      [null, 0], // zremrangebyscore
      [null, 50], // zcard: 50 requests in window
      [null, 1], // zadd
      [null, 1], // expire
    ]);

    const limiter = createRateLimiter({ maxRequests: 100, windowSeconds: 60 });

    // Wait for the Redis connection promise to resolve
    await new Promise((resolve) => setTimeout(resolve, 10));

    const req = mockRequest("key_1");
    const res = mockResponse();
    const next = mockNext();

    await limiter(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Limit", 100);
    expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Remaining", 49);
  });

  it("rejects requests over the limit with 429", async () => {
    mockExec.mockResolvedValue([
      [null, 0], // zremrangebyscore
      [null, 100], // zcard: 100 requests (at limit)
      [null, 1], // zadd
      [null, 1], // expire
    ]);

    const limiter = createRateLimiter({ maxRequests: 100, windowSeconds: 60 });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const req = mockRequest("key_1");
    const res = mockResponse();
    const next = mockNext();

    await limiter(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "rate_limit_exceeded",
        limit: 100,
        window_seconds: 60,
      })
    );
    expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Remaining", 0);
  });

  it("sets Retry-After header on rate limit", async () => {
    mockExec.mockResolvedValue([
      [null, 0],
      [null, 100],
      [null, 1],
      [null, 1],
    ]);

    const limiter = createRateLimiter({ maxRequests: 100, windowSeconds: 60 });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const req = mockRequest("key_1");
    const res = mockResponse();
    const next = mockNext();

    await limiter(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith(
      "Retry-After",
      expect.any(Number)
    );
  });

  it("skips rate limiting when no API key is present", async () => {
    const limiter = createRateLimiter({ maxRequests: 100, windowSeconds: 60 });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const req = mockRequest(undefined);
    const res = mockResponse();
    const next = mockNext();

    await limiter(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockPipeline).not.toHaveBeenCalled();
  });

  it("fails open on Redis error", async () => {
    mockExec.mockRejectedValue(new Error("Redis connection failed"));

    const limiter = createRateLimiter({ maxRequests: 100, windowSeconds: 60 });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const req = mockRequest("key_1");
    const res = mockResponse();
    const next = mockNext();

    await limiter(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("respects custom maxRequests and windowSeconds", async () => {
    mockExec.mockResolvedValue([
      [null, 0],
      [null, 10], // at limit for maxRequests=10
      [null, 1],
      [null, 1],
    ]);

    const limiter = createRateLimiter({ maxRequests: 10, windowSeconds: 30 });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const req = mockRequest("key_1");
    const res = mockResponse();
    const next = mockNext();

    await limiter(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, window_seconds: 30 })
    );
  });
});
