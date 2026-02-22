import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createDashboardRoutes } from "../../src/api/dashboard-routes.js";
import { RoleProfileService } from "../../src/services/role-profiles.js";
import { AccountAccessService } from "../../src/services/account-access.js";

function createApp(
  prisma: any,
  auth: { userId?: string; userRole?: string } = {}
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Record<string, unknown>).organizationId = "org-1";
    (req as Record<string, unknown>).userId = auth.userId ?? "user-1";
    (req as Record<string, unknown>).userRole = auth.userRole ?? "MEMBER";
    next();
  });
  app.use("/api/dashboard", createDashboardRoutes(prisma));
  return app;
}

describe("admin controls readiness", () => {
  const prisma = {
    userSession: {
      findMany: vi.fn(),
    },
    userPermission: {
      findUnique: vi.fn(),
    },
    supportImpersonationSession: {
      findMany: vi.fn(),
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

    vi.spyOn(RoleProfileService.prototype, "getEffectivePolicy").mockResolvedValue({
      permissions: [],
      canAccessAnonymousStories: true,
      canGenerateAnonymousStories: true,
      canAccessNamedStories: false,
      canGenerateNamedStories: false,
      defaultAccountScopeType: "ALL_ACCOUNTS",
      defaultAccountIds: [],
      maxTokensPerDay: null,
      maxTokensPerMonth: null,
      maxRequestsPerDay: null,
      maxRequestsPerMonth: null,
      maxStoriesPerMonth: null,
      source: "fallback",
    });
    vi.spyOn(AccountAccessService.prototype, "canAccessAccount").mockResolvedValue(true);
  });

  it("denies session inventory to member without manage permission", async () => {
    prisma.userPermission.findUnique.mockResolvedValue(null);
    const app = createApp(prisma, { userRole: "MEMBER" });

    const res = await request(app).get("/api/dashboard/security/sessions");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("permission_denied");
  });

  it("allows session inventory to admin", async () => {
    prisma.userSession.findMany.mockResolvedValue([
      {
        id: "sess-1",
        userId: "user-2",
        deviceLabel: "Mac",
        ipAddress: "10.0.0.1",
        userAgent: "agent",
        lastSeenAt: new Date(),
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
        revokedAt: null,
        user: { id: "user-2", email: "user2@example.com", name: "User 2", role: "MEMBER" },
      },
    ]);

    const app = createApp(prisma, { userRole: "ADMIN" });
    const res = await request(app).get("/api/dashboard/security/sessions");

    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(1);
    expect(res.body.sessions[0].user_email).toBe("user2@example.com");
  });

  it("denies support impersonation session list to non-admin without permission", async () => {
    prisma.userPermission.findUnique.mockResolvedValue(null);

    const app = createApp(prisma, { userRole: "MEMBER", userId: "user-3" });
    const res = await request(app).get(
      "/api/dashboard/support/impersonation/sessions"
    );

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("permission_denied");
  });
});
