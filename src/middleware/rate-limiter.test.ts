/**
 * Rate Limiter Security Tests
 *
 * Validates that rate limiting properly prevents brute-force attacks
 * on sensitive endpoints (password-protected pages, API routes).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRateLimiter } from "./rate-limiter.js";
import type { Request, Response, NextFunction } from "express";

function createMockReq(ip = "127.0.0.1"): Partial<Request> {
  return {
    ip,
    socket: { remoteAddress: ip } as never,
  };
}

function createMockRes(): Partial<Response> & { statusCode: number; body: unknown; headers: Record<string, string> } {
  const res = {
    statusCode: 200,
    body: null as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name] = value;
      return res;
    },
  };
  return res as never;
}

describe("Rate Limiter", () => {
  let limiter: ReturnType<typeof createRateLimiter>;

  beforeEach(() => {
    limiter = createRateLimiter({
      maxRequests: 3,
      windowMs: 60_000,
      message: "Too many requests",
    });
  });

  it("should allow requests within the limit", () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    limiter(req as Request, res as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it("should allow up to maxRequests requests", () => {
    const req = createMockReq();
    const next = vi.fn();

    for (let i = 0; i < 3; i++) {
      const res = createMockRes();
      limiter(req as Request, res as unknown as Response, next as NextFunction);
    }

    expect(next).toHaveBeenCalledTimes(3);
  });

  it("should block requests exceeding the limit", () => {
    const req = createMockReq();
    const next = vi.fn();

    // Exhaust the limit
    for (let i = 0; i < 3; i++) {
      const res = createMockRes();
      limiter(req as Request, res as unknown as Response, next as NextFunction);
    }

    // 4th request should be blocked
    const res = createMockRes();
    limiter(req as Request, res as unknown as Response, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(3);
    expect(res.statusCode).toBe(429);
    expect((res.body as { error: string }).error).toBe("rate_limit_exceeded");
  });

  it("should set Retry-After header on 429 response", () => {
    const req = createMockReq();
    const next = vi.fn();

    for (let i = 0; i < 3; i++) {
      const res = createMockRes();
      limiter(req as Request, res as unknown as Response, next as NextFunction);
    }

    const res = createMockRes();
    limiter(req as Request, res as unknown as Response, next as NextFunction);

    expect(res.headers["Retry-After"]).toBeDefined();
    expect(parseInt(res.headers["Retry-After"])).toBeGreaterThan(0);
  });

  it("should track different IPs independently", () => {
    const next = vi.fn();

    // IP 1: make 3 requests
    const req1 = createMockReq("10.0.0.1");
    for (let i = 0; i < 3; i++) {
      const res = createMockRes();
      limiter(req1 as Request, res as unknown as Response, next as NextFunction);
    }

    // IP 2: should still be allowed
    const req2 = createMockReq("10.0.0.2");
    const res = createMockRes();
    limiter(req2 as Request, res as unknown as Response, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(4);
    expect(res.statusCode).toBe(200);
  });

  it("should include custom message in error response", () => {
    const req = createMockReq();
    const next = vi.fn();

    for (let i = 0; i < 4; i++) {
      const res = createMockRes();
      limiter(req as Request, res as unknown as Response, next as NextFunction);
      if (i === 3) {
        expect((res.body as { message: string }).message).toBe(
          "Too many requests"
        );
      }
    }
  });
});
