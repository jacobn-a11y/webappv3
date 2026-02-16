import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { createTrialGate } from "../src/middleware/billing.js";

function mockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    organizationId: "org-1",
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

function mockNext(): NextFunction {
  return vi.fn();
}

describe("createTrialGate", () => {
  beforeEach(() => {
    process.env.BILLING_ENABLED = "true";
  });

  afterEach(() => {
    delete process.env.BILLING_ENABLED;
  });

  it("returns 401 if no organizationId", async () => {
    const prisma = {} as never;
    const stripe = {} as never;
    const middleware = createTrialGate(prisma, stripe);
    const req = mockReq({ organizationId: undefined });
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 404 if organization not found", async () => {
    const prisma = {
      organization: { findUnique: vi.fn().mockResolvedValue(null) },
    } as never;
    const stripe = {} as never;
    const middleware = createTrialGate(prisma, stripe);
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows through when plan is not FREE_TRIAL", async () => {
    const prisma = {
      organization: {
        findUnique: vi.fn().mockResolvedValue({ plan: "STARTER" }),
      },
    } as never;
    const stripe = {} as never;
    const middleware = createTrialGate(prisma, stripe);
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("returns 402 when trial has expired", async () => {
    const expired = new Date(Date.now() - 86400000); // yesterday
    const prisma = {
      organization: {
        findUnique: vi.fn().mockResolvedValue({
          plan: "FREE_TRIAL",
          trialEndsAt: expired,
        }),
      },
    } as never;
    const stripe = {} as never;
    const middleware = createTrialGate(prisma, stripe);
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(402);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows through when trial is still active", async () => {
    const future = new Date(Date.now() + 86400000 * 7); // 7 days from now
    const prisma = {
      organization: {
        findUnique: vi.fn().mockResolvedValue({
          plan: "FREE_TRIAL",
          trialEndsAt: future,
        }),
      },
    } as never;
    const stripe = {} as never;
    const middleware = createTrialGate(prisma, stripe);
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("allows through when trial has no expiry date", async () => {
    const prisma = {
      organization: {
        findUnique: vi.fn().mockResolvedValue({
          plan: "FREE_TRIAL",
          trialEndsAt: null,
        }),
      },
    } as never;
    const stripe = {} as never;
    const middleware = createTrialGate(prisma, stripe);
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("includes upgrade URL in 402 response", async () => {
    const expired = new Date(Date.now() - 1000);
    const prisma = {
      organization: {
        findUnique: vi.fn().mockResolvedValue({
          plan: "FREE_TRIAL",
          trialEndsAt: expired,
        }),
      },
    } as never;
    const stripe = {} as never;
    const middleware = createTrialGate(prisma, stripe);
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "trial_expired",
        upgradeUrl: expect.stringContaining("/api/billing/checkout"),
      })
    );
  });
});
