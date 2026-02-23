import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { requireAuth } from "../../src/middleware/auth.js";

function mockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    organizationId: "org-1",
    userId: "user-1",
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function mockNext(): NextFunction {
  return vi.fn();
}

describe("requireAuth middleware", () => {
  it("returns 401 when organizationId is missing", () => {
    const req = mockReq({ organizationId: undefined });
    const res = mockRes();
    const next = mockNext();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "authentication_required" })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when userId is missing", () => {
    const req = mockReq({ userId: undefined });
    const res = mockRes();
    const next = mockNext();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next when auth context is present", () => {
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
