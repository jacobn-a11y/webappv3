/**
 * Tests for Rate Limiter Middleware
 *
 * Tests the in-memory sliding-window rate limiter.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { createRateLimiter } from "../middleware/rate-limiter.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockRequest(ip?: string): Request {
  return {
    ip: ip ?? "127.0.0.1",
    socket: { remoteAddress: ip ?? "127.0.0.1" },
    headers: {},
  } as unknown as Request;
}

function mockResponse(): Response & { _status?: number } {
  const res = {
    setHeader: vi.fn().mockReturnThis(),
    status: vi.fn().mockImplementation(function (this: Response, code: number) {
      (this as Response & { _status?: number })._status = code;
      return this;
    }),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response & { _status?: number };
  return res;
}

function mockNext(): NextFunction {
  return vi.fn();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("createRateLimiter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows requests under the limit", () => {
    const limiter = createRateLimiter({ maxRequests: 100, windowMs: 60_000 });

    const req = mockRequest("10.0.0.1");
    const res = mockResponse();
    const next = mockNext();

    limiter(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("rejects requests over the limit with 429", () => {
    const limiter = createRateLimiter({ maxRequests: 2, windowMs: 60_000 });
    const ip = "10.0.0.2";

    // First two requests should pass
    for (let i = 0; i < 2; i++) {
      const req = mockRequest(ip);
      const res = mockResponse();
      const next = mockNext();
      limiter(req, res, next);
      expect(next).toHaveBeenCalled();
    }

    // Third request should be rate limited
    const req = mockRequest(ip);
    const res = mockResponse();
    const next = mockNext();
    limiter(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "rate_limit_exceeded",
      })
    );
  });

  it("sets Retry-After header on rate limit", () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60_000 });
    const ip = "10.0.0.3";

    // First request passes
    limiter(mockRequest(ip), mockResponse(), mockNext());

    // Second request gets rate limited
    const req = mockRequest(ip);
    const res = mockResponse();
    const next = mockNext();
    limiter(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", expect.any(String));
  });

  it("tracks rate limits per IP address", () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60_000 });

    // IP A: first request passes
    const reqA = mockRequest("10.0.0.10");
    const resA = mockResponse();
    const nextA = mockNext();
    limiter(reqA, resA, nextA);
    expect(nextA).toHaveBeenCalled();

    // IP B: first request also passes (different IP)
    const reqB = mockRequest("10.0.0.11");
    const resB = mockResponse();
    const nextB = mockNext();
    limiter(reqB, resB, nextB);
    expect(nextB).toHaveBeenCalled();

    // IP A: second request is rate limited
    const reqA2 = mockRequest("10.0.0.10");
    const resA2 = mockResponse();
    const nextA2 = mockNext();
    limiter(reqA2, resA2, nextA2);
    expect(nextA2).not.toHaveBeenCalled();
    expect(resA2.status).toHaveBeenCalledWith(429);
  });

  it("supports custom error message", () => {
    const limiter = createRateLimiter({
      maxRequests: 1,
      windowMs: 60_000,
      message: "Slow down!",
    });
    const ip = "10.0.0.4";

    // Exhaust limit
    limiter(mockRequest(ip), mockResponse(), mockNext());

    // Next request should get custom message
    const req = mockRequest(ip);
    const res = mockResponse();
    const next = mockNext();
    limiter(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Slow down!",
      })
    );
  });

  it("respects different maxRequests values", () => {
    const limiter = createRateLimiter({ maxRequests: 3, windowMs: 60_000 });
    const ip = "10.0.0.5";

    // Three requests should pass
    for (let i = 0; i < 3; i++) {
      const req = mockRequest(ip);
      const res = mockResponse();
      const next = mockNext();
      limiter(req, res, next);
      expect(next).toHaveBeenCalled();
    }

    // Fourth request should be rate limited
    const req = mockRequest(ip);
    const res = mockResponse();
    const next = mockNext();
    limiter(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });
});

describe("rate limiter exports", () => {
  it("exports createRateLimiter as a function", () => {
    expect(typeof createRateLimiter).toBe("function");
  });
});
