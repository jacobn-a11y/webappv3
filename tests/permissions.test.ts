import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import {
  requireLandingPagesEnabled,
  requirePermission,
  requirePageOwnerOrPermission,
} from "../src/middleware/permissions.js";

// ─── Mock Helpers ────────────────────────────────────────────────────────────

function mockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    organizationId: "org-1",
    userId: "user-1",
    userRole: "MEMBER",
    params: {},
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

// ─── requireLandingPagesEnabled ──────────────────────────────────────────────

describe("requireLandingPagesEnabled", () => {
  it("returns 401 if no organizationId", async () => {
    const prisma = {} as never;
    const middleware = requireLandingPagesEnabled(prisma);
    const req = mockReq({ organizationId: undefined });
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next when settings allow landing pages", async () => {
    const prisma = {
      orgSettings: {
        findUnique: vi.fn().mockResolvedValue({ landingPagesEnabled: true }),
      },
    } as never;
    const middleware = requireLandingPagesEnabled(prisma);
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("returns 403 when landing pages are disabled", async () => {
    const prisma = {
      orgSettings: {
        findUnique: vi.fn().mockResolvedValue({ landingPagesEnabled: false }),
      },
    } as never;
    const middleware = requireLandingPagesEnabled(prisma);
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next when no settings exist (defaults to enabled)", async () => {
    const prisma = {
      orgSettings: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    } as never;
    const middleware = requireLandingPagesEnabled(prisma);
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

// ─── requirePermission ──────────────────────────────────────────────────────

describe("requirePermission", () => {
  it("returns 401 if no userId", async () => {
    const prisma = {} as never;
    const middleware = requirePermission(prisma, "create");
    const req = mockReq({ userId: undefined });
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows OWNER through without checking permissions", async () => {
    const prisma = {} as never;
    const middleware = requirePermission(prisma, "create");
    const req = mockReq({ userRole: "OWNER" });
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("allows ADMIN through without checking permissions", async () => {
    const prisma = {} as never;
    const middleware = requirePermission(prisma, "create");
    const req = mockReq({ userRole: "ADMIN" });
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("allows MEMBER with explicit permission", async () => {
    const prisma = {
      orgSettings: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ dataGovernancePolicy: null, allowedPublishers: [] }),
      },
      userRoleAssignment: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      userPermission: {
        findUnique: vi.fn().mockResolvedValue({ id: "perm-1" }),
      },
    } as never;
    const middleware = requirePermission(prisma, "create");
    const req = mockReq({ userRole: "MEMBER" });
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("denies MEMBER without permission", async () => {
    const prisma = {
      userPermission: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      userRoleAssignment: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      orgSettings: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ dataGovernancePolicy: null, allowedPublishers: [] }),
      },
    } as never;
    const middleware = requirePermission(prisma, "create");
    const req = mockReq({ userRole: "MEMBER" });
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows publish when user role is in allowedPublishers", async () => {
    const prisma = {
      userPermission: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      userRoleAssignment: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      orgSettings: {
        findUnique: vi
          .fn()
          .mockResolvedValue({
            dataGovernancePolicy: null,
            allowedPublishers: ["MEMBER"],
          }),
      },
    } as never;
    const middleware = requirePermission(prisma, "publish");
    const req = mockReq({ userRole: "MEMBER" });
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("returns 500 for unknown action", async () => {
    const prisma = {} as never;
    const middleware = requirePermission(prisma, "nonexistent_action");
    const req = mockReq({ userRole: "MEMBER" });
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── requirePageOwnerOrPermission ───────────────────────────────────────────

describe("requirePageOwnerOrPermission", () => {
  it("returns 401 if no userId", async () => {
    const prisma = {} as never;
    const middleware = requirePageOwnerOrPermission(prisma);
    const req = mockReq({ userId: undefined, params: { pageId: "page-1" } });
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("allows ADMIN through", async () => {
    const prisma = {} as never;
    const middleware = requirePageOwnerOrPermission(prisma);
    const req = mockReq({ userRole: "ADMIN", params: { pageId: "page-1" } });
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("allows page owner through", async () => {
    const prisma = {
      landingPage: {
        findFirst: vi.fn().mockResolvedValue({ createdById: "user-1" }),
      },
    } as never;
    const middleware = requirePageOwnerOrPermission(prisma);
    const req = mockReq({
      userRole: "MEMBER",
      params: { pageId: "page-1" },
    });
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("returns 404 if page not found", async () => {
    const prisma = {
      landingPage: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as never;
    const middleware = requirePageOwnerOrPermission(prisma);
    const req = mockReq({
      userRole: "MEMBER",
      params: { pageId: "page-1" },
    });
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("allows non-owner with EDIT_ANY permission", async () => {
    const prisma = {
      landingPage: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ createdById: "other-user" }),
      },
      userRoleAssignment: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      userPermission: {
        findUnique: vi.fn().mockResolvedValue({ id: "perm-1" }),
      },
    } as never;
    const middleware = requirePageOwnerOrPermission(prisma);
    const req = mockReq({
      userRole: "MEMBER",
      params: { pageId: "page-1" },
    });
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("denies non-owner without EDIT_ANY permission", async () => {
    const prisma = {
      landingPage: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ createdById: "other-user" }),
      },
      userRoleAssignment: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      userPermission: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    } as never;
    const middleware = requirePageOwnerOrPermission(prisma);
    const req = mockReq({
      userRole: "MEMBER",
      params: { pageId: "page-1" },
    });
    const res = mockRes();
    const next = mockNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});
