import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createDashboardRoutes } from "../../src/api/dashboard-routes.js";
import { requestServer } from "../helpers/request-server.js";

function createApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Record<string, unknown>).organizationId = "org-1";
    (req as Record<string, unknown>).userId = "user-1";
    (req as Record<string, unknown>).userRole = "ADMIN";
    next();
  });
  app.use("/api/dashboard", createDashboardRoutes(prisma));
  return app;
}

describe("dashboard collaboration/access contract", () => {
  const prisma = {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    userRoleAssignment: {
      findUnique: vi.fn(),
    },
    teamWorkspace: {
      findMany: vi.fn(),
    },
    sharedAsset: {
      findMany: vi.fn(),
    },
    userPermission: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    orgSettings: {
      findUnique: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.findUnique.mockResolvedValue({ role: "ADMIN" });
    prisma.userRoleAssignment.findUnique.mockResolvedValue(null);
    prisma.teamWorkspace.findMany.mockResolvedValue([]);
    prisma.sharedAsset.findMany.mockResolvedValue([]);
    prisma.userPermission.upsert.mockResolvedValue({});
    prisma.userPermission.deleteMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.create.mockResolvedValue({ id: "audit-1" });
    prisma.orgSettings.findUnique.mockResolvedValue(null);
  });

  it("preserves GET /api/dashboard/permissions matrix shape", async () => {
    prisma.user.findMany.mockResolvedValue([
      {
        id: "user-1",
        name: "Admin One",
        email: "admin@example.com",
        role: "ADMIN",
        permissions: [{ permission: "MANAGE_PERMISSIONS" }],
      },
    ]);

    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/permissions");

      expect(res.status).toBe(200);
      expect(res.body.users).toEqual([
        {
          userId: "user-1",
          userName: "Admin One",
          userEmail: "admin@example.com",
          role: "ADMIN",
          permissions: ["MANAGE_PERMISSIONS"],
        },
      ]);
    } finally {
      close();
    }
  });

  it("preserves GET /api/dashboard/workspaces response mapping", async () => {
    prisma.teamWorkspace.findMany.mockResolvedValue([
      {
        id: "ws-1",
        name: "RevOps",
        description: "Ops workspace",
        team: "REVOPS",
        visibility: "ORG",
        ownerUserId: "user-1",
        savedViewConfig: null,
        allowedRoleProfileKeys: ["REVOPS"],
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ]);

    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/workspaces");

      expect(res.status).toBe(200);
      expect(res.body.workspaces).toEqual([
        {
          id: "ws-1",
          name: "RevOps",
          description: "Ops workspace",
          team: "REVOPS",
          visibility: "ORG",
          owner_user_id: "user-1",
          saved_view_config: null,
          allowed_role_profile_keys: ["REVOPS"],
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-02T00:00:00.000Z",
        },
      ]);
    } finally {
      close();
    }
  });

  it("preserves GET /api/dashboard/assets response mapping", async () => {
    prisma.sharedAsset.findMany.mockResolvedValue([
      {
        id: "asset-1",
        workspaceId: "ws-1",
        assetType: "STORY",
        title: "Proof Point",
        description: "Top customer quote",
        sourceStoryId: "story-1",
        sourcePageId: null,
        sourceAccountId: "acc-1",
        visibility: "ORG",
        ownerUserId: "user-1",
        allowedRoleProfileKeys: ["REVOPS"],
        metadata: { tag: "important" },
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ]);

    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/assets");

      expect(res.status).toBe(200);
      expect(res.body.assets).toEqual([
        {
          id: "asset-1",
          workspace_id: "ws-1",
          asset_type: "STORY",
          title: "Proof Point",
          description: "Top customer quote",
          source_story_id: "story-1",
          source_page_id: null,
          source_account_id: "acc-1",
          visibility: "ORG",
          owner_user_id: "user-1",
          allowed_role_profile_keys: ["REVOPS"],
          metadata: { tag: "important" },
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-02T00:00:00.000Z",
        },
      ]);
    } finally {
      close();
    }
  });

  it("preserves POST /api/dashboard/permissions/grant and revoke contract", async () => {
    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const grant = await request.post("/api/dashboard/permissions/grant").send({
        user_id: "user-2",
        permission: "VIEW_ANALYTICS",
      });
      expect(grant.status).toBe(200);
      expect(grant.body).toEqual({ granted: true });

      const revoke = await request.post("/api/dashboard/permissions/revoke").send({
        user_id: "user-2",
        permission: "VIEW_ANALYTICS",
      });
      expect(revoke.status).toBe(200);
      expect(revoke.body).toEqual({ revoked: true });
    } finally {
      close();
    }
  });
});
