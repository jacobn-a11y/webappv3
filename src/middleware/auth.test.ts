/**
 * Authentication Middleware Security Tests
 *
 * Validates that the auth middleware fails closed — rejecting
 * requests without valid authentication context.
 */

import { describe, it, expect, vi } from "vitest";
import { requireAuth, type AuthenticatedRequest } from "./auth.js";
import type { Response, NextFunction } from "express";

function createMockRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
  };
  return res;
}

describe("requireAuth middleware", () => {
  it("should reject requests without organizationId", () => {
    const req = { userId: "user-1" } as AuthenticatedRequest;
    const res = createMockRes();
    const next = vi.fn();

    requireAuth(req, res as unknown as Response, next as NextFunction);

    expect(res.statusCode).toBe(401);
    expect((res.body as { error: string }).error).toBe("authentication_required");
    expect(next).not.toHaveBeenCalled();
  });

  it("should reject requests without userId", () => {
    const req = { organizationId: "org-1" } as AuthenticatedRequest;
    const res = createMockRes();
    const next = vi.fn();

    requireAuth(req, res as unknown as Response, next as NextFunction);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("should reject requests with neither organizationId nor userId", () => {
    const req = {} as AuthenticatedRequest;
    const res = createMockRes();
    const next = vi.fn();

    requireAuth(req, res as unknown as Response, next as NextFunction);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("should allow requests with both organizationId and userId", () => {
    const req = {
      organizationId: "org-1",
      userId: "user-1",
    } as AuthenticatedRequest;
    const res = createMockRes();
    const next = vi.fn();

    requireAuth(req, res as unknown as Response, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it("should not modify the response for authenticated requests", () => {
    const req = {
      organizationId: "org-1",
      userId: "user-1",
    } as AuthenticatedRequest;
    const res = createMockRes();
    const next = vi.fn();

    requireAuth(req, res as unknown as Response, next as NextFunction);

    expect(res.body).toBeNull();
  });
});
