import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { requireOrgSecurityPolicy } from "../../src/middleware/security-policy.js";

function mockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    organizationId: "org-1",
    userId: "user-1",
    ip: "10.0.0.5",
    headers: {},
    socket: { remoteAddress: "10.0.0.5" },
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

describe("requireOrgSecurityPolicy IP allowlist handling", () => {
  it("uses req.ip as source of truth instead of x-forwarded-for header", async () => {
    const prisma = {
      orgSettings: {
        findUnique: vi.fn().mockResolvedValue({
          securityPolicy: { ip_allowlist_enabled: true },
        }),
      },
      orgIpAllowlistEntry: {
        findMany: vi.fn().mockResolvedValue([{ cidr: "10.0.0.0/24" }]),
      },
    } as any;

    const middleware = requireOrgSecurityPolicy(prisma, {
      enforceIpAllowlistIfConfigured: true,
    });
    const req = mockReq({
      ip: "10.0.0.42",
      headers: { "x-forwarded-for": "203.0.113.99" },
    });
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("blocks spoof attempts where header is allowlisted but req.ip is not", async () => {
    const prisma = {
      orgSettings: {
        findUnique: vi.fn().mockResolvedValue({
          securityPolicy: { ip_allowlist_enabled: true },
        }),
      },
      orgIpAllowlistEntry: {
        findMany: vi.fn().mockResolvedValue([{ cidr: "10.0.0.0/24" }]),
      },
    } as any;

    const middleware = requireOrgSecurityPolicy(prisma, {
      enforceIpAllowlistIfConfigured: true,
    });
    const req = mockReq({
      ip: "203.0.113.44",
      headers: { "x-forwarded-for": "10.0.0.10" },
    });
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "ip_restricted" })
    );
  });
});
