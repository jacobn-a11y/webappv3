import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import {
  applySupportImpersonation,
  requireImpersonationWriteScope,
} from "../src/middleware/support-impersonation.js";

describe("support impersonation middleware", () => {
  const prisma = {
    userPermission: {
      findUnique: vi.fn(),
    },
    supportImpersonationSession: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    orgSettings: {
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.orgSettings.findUnique.mockResolvedValue(null);
    prisma.auditLog.create.mockResolvedValue({ id: "audit-1" });
  });

  it("returns 403 when non-admin actor has no manage permission", async () => {
    const middleware = applySupportImpersonation(prisma);
    prisma.userPermission.findUnique.mockResolvedValue(null);

    const req = {
      headers: { "x-support-impersonation-token": "token" },
      organizationId: "org-1",
      userId: "actor-1",
      userRole: "MEMBER",
      ip: "127.0.0.1",
      method: "GET",
      path: "/api/dashboard/home",
      get: vi.fn().mockReturnValue("agent"),
    } as unknown as Request;

    const status = vi.fn().mockReturnThis();
    const json = vi.fn().mockReturnThis();
    const res = { status, json } as unknown as Response;
    const next = vi.fn();

    await middleware(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "support_impersonation_not_allowed" })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("applies impersonated target context when session is valid", async () => {
    const middleware = applySupportImpersonation(prisma);
    prisma.userPermission.findUnique.mockResolvedValue({ id: "perm-1" });
    prisma.supportImpersonationSession.findFirst.mockResolvedValue({
      id: "imp-1",
      targetUserId: "target-1",
      reason: "Debugging customer report issue",
      scope: ["READ_ONLY"],
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      targetUser: { id: "target-1", role: "MEMBER" },
    });

    const req = {
      headers: { "x-support-impersonation-token": "token" },
      organizationId: "org-1",
      userId: "actor-1",
      userRole: "MEMBER",
      ip: "127.0.0.1",
      method: "GET",
      path: "/api/dashboard/home",
      get: vi.fn().mockReturnValue("agent"),
    } as unknown as Request & {
      userId: string;
      userRole: string;
      impersonation?: { actorUserId: string; targetUserId: string; scope: string[] };
    };

    const status = vi.fn().mockReturnThis();
    const json = vi.fn().mockReturnThis();
    const res = { status, json } as unknown as Response;
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.userId).toBe("target-1");
    expect(req.impersonation).toEqual(
      expect.objectContaining({ actorUserId: "actor-1", targetUserId: "target-1" })
    );
    expect(prisma.supportImpersonationSession.update).toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it("blocks write requests for read-only impersonation scope", () => {
    const req = {
      method: "POST",
      impersonation: {
        sessionId: "imp-1",
        actorUserId: "actor-1",
        targetUserId: "target-1",
        scope: ["READ_ONLY"],
        reason: "debug",
        expiresAt: new Date().toISOString(),
      },
    } as unknown as Request;

    const status = vi.fn().mockReturnThis();
    const json = vi.fn().mockReturnThis();
    const res = { status, json } as unknown as Response;
    const next = vi.fn();

    requireImpersonationWriteScope(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "support_impersonation_read_only" })
    );
    expect(next).not.toHaveBeenCalled();
  });
});
