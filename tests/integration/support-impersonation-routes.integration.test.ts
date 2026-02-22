import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { requestServer } from "../helpers/request-server.js";
import { createDashboardRoutes } from "../../src/api/dashboard-routes.js";

function createApp(
  prisma: any,
  auth: { userId?: string; userRole?: string } = {}
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Record<string, unknown>).organizationId = "org-1";
    (req as Record<string, unknown>).userId = auth.userId ?? "user-admin";
    (req as Record<string, unknown>).userRole = auth.userRole ?? "ADMIN";
    next();
  });
  app.use("/api/dashboard", createDashboardRoutes(prisma));
  return app;
}

describe("support impersonation dashboard routes", () => {
  const prisma = {
    supportImpersonationSession: {
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
    userPermission: {
      findUnique: vi.fn(),
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

  it("starts impersonation session for admin actor", async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: "target-1",
      role: "MEMBER",
      email: "target@example.com",
    });
    prisma.supportImpersonationSession.create.mockResolvedValue({
      id: "imp-1",
      actorUserId: "user-admin",
      targetUserId: "target-1",
      reason: "Troubleshoot dashboard issue",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    const app = createApp(prisma, { userRole: "ADMIN" });
    const { request, close } = await requestServer(app);
    try {
      const res = await request
        .post("/api/dashboard/support/impersonation/start")
        .send({
          target_user_id: "target-1",
          reason: "Troubleshoot dashboard issue",
          ttl_minutes: 30,
        });

      expect(res.status).toBe(201);
    expect(typeof res.body.support_impersonation_token).toBe("string");
      expect(res.body.target_user_id).toBe("target-1");
      expect(prisma.supportImpersonationSession.create).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalled();
    } finally {
      close();
    }
  });

  it("denies start for non-admin without manage permission", async () => {
    prisma.userPermission.findUnique.mockResolvedValue(null);

    const app = createApp(prisma, { userRole: "MEMBER", userId: "user-1" });
    const { request, close } = await requestServer(app);
    try {
      const res = await request
        .post("/api/dashboard/support/impersonation/start")
        .send({
          target_user_id: "target-1",
          reason: "Need temporary access for support",
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("permission_denied");
    } finally {
      close();
    }
  });

  it("lists and revokes impersonation sessions", async () => {
    prisma.supportImpersonationSession.findMany.mockResolvedValue([
      {
        id: "imp-1",
        actorUserId: "user-admin",
        targetUserId: "target-1",
        actorUser: { id: "user-admin", email: "admin@example.com", name: "Admin", role: "ADMIN" },
        targetUser: { id: "target-1", email: "target@example.com", name: "Target", role: "MEMBER" },
        revokedByUser: null,
        revokedByUserId: null,
        reason: "Investigation",
        scope: ["READ_ONLY"],
        startedAt: new Date(),
        lastUsedAt: null,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        revokedAt: null,
      },
    ]);
    prisma.supportImpersonationSession.findFirst.mockResolvedValue({
      id: "imp-1",
      targetUserId: "target-1",
      revokedAt: null,
    });
    prisma.supportImpersonationSession.update.mockResolvedValue({ id: "imp-1" });

    const app = createApp(prisma, { userRole: "ADMIN" });
    const { request, close } = await requestServer(app);
    try {
      const listRes = await request.get(
        "/api/dashboard/support/impersonation/sessions"
      );
      expect(listRes.status).toBe(200);
      expect(listRes.body.sessions).toHaveLength(1);

      const revokeRes = await request.post(
        "/api/dashboard/support/impersonation/imp-1/revoke"
      );
      expect(revokeRes.status).toBe(200);
      expect(revokeRes.body.revoked).toBe(true);
      expect(prisma.supportImpersonationSession.update).toHaveBeenCalled();
    } finally {
      close();
    }
  });
});
