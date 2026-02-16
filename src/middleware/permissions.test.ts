import { describe, it, expect, vi, beforeEach } from "vitest";
import { PermissionManager } from "./permissions.js";

// ─── Mocks ──────────────────────────────────────────────────────────────────

function createMockPrisma() {
  return {
    userPermission: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
    orgSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  };
}

describe("PermissionManager", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let manager: PermissionManager;

  beforeEach(() => {
    prisma = createMockPrisma();
    manager = new PermissionManager(prisma as any);
  });

  describe("updateOrgSettings", () => {
    it("should upsert with transcript merge settings", async () => {
      prisma.orgSettings.upsert.mockResolvedValue({});

      await manager.updateOrgSettings("org-1", {
        transcriptMergeMaxWords: 120_000,
        transcriptTruncationMode: "NEWEST_FIRST",
      });

      expect(prisma.orgSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: "org-1" },
          create: expect.objectContaining({
            organizationId: "org-1",
            transcriptMergeMaxWords: 120_000,
            transcriptTruncationMode: "NEWEST_FIRST",
          }),
          update: expect.objectContaining({
            transcriptMergeMaxWords: 120_000,
            transcriptTruncationMode: "NEWEST_FIRST",
          }),
        })
      );
    });

    it("should not include undefined values in the update", async () => {
      prisma.orgSettings.upsert.mockResolvedValue({});

      await manager.updateOrgSettings("org-1", {
        transcriptMergeMaxWords: 200_000,
        // transcriptTruncationMode is NOT provided (undefined)
      });

      const calledWith = prisma.orgSettings.upsert.mock.calls[0][0];
      expect(calledWith.update).toHaveProperty("transcriptMergeMaxWords", 200_000);
      expect(calledWith.update).not.toHaveProperty("transcriptTruncationMode");
    });

    it("should work with both legacy and new settings together", async () => {
      prisma.orgSettings.upsert.mockResolvedValue({});

      await manager.updateOrgSettings("org-1", {
        landingPagesEnabled: false,
        maxPagesPerUser: 5,
        transcriptMergeMaxWords: 76_800,
        transcriptTruncationMode: "OLDEST_FIRST",
      });

      const calledWith = prisma.orgSettings.upsert.mock.calls[0][0];
      expect(calledWith.update).toHaveProperty("landingPagesEnabled", false);
      expect(calledWith.update).toHaveProperty("maxPagesPerUser", 5);
      expect(calledWith.update).toHaveProperty("transcriptMergeMaxWords", 76_800);
      expect(calledWith.update).toHaveProperty("transcriptTruncationMode", "OLDEST_FIRST");
    });

    it("should pass only defined values when some are undefined", async () => {
      prisma.orgSettings.upsert.mockResolvedValue({});

      await manager.updateOrgSettings("org-1", {
        landingPagesEnabled: undefined,
        transcriptMergeMaxWords: 100_000,
      });

      const calledWith = prisma.orgSettings.upsert.mock.calls[0][0];
      expect(calledWith.update).not.toHaveProperty("landingPagesEnabled");
      expect(calledWith.update).toHaveProperty("transcriptMergeMaxWords", 100_000);
    });
  });

  describe("grantPermission", () => {
    it("should upsert the permission", async () => {
      prisma.userPermission.upsert.mockResolvedValue({});

      await manager.grantPermission("user-1", "PUBLISH_LANDING_PAGE", "admin-1");

      expect(prisma.userPermission.upsert).toHaveBeenCalledWith({
        where: {
          userId_permission: {
            userId: "user-1",
            permission: "PUBLISH_LANDING_PAGE",
          },
        },
        create: {
          userId: "user-1",
          permission: "PUBLISH_LANDING_PAGE",
          grantedById: "admin-1",
        },
        update: { grantedById: "admin-1" },
      });
    });
  });

  describe("revokePermission", () => {
    it("should delete the permission", async () => {
      prisma.userPermission.deleteMany.mockResolvedValue({ count: 1 });

      await manager.revokePermission("user-1", "PUBLISH_LANDING_PAGE");

      expect(prisma.userPermission.deleteMany).toHaveBeenCalledWith({
        where: { userId: "user-1", permission: "PUBLISH_LANDING_PAGE" },
      });
    });
  });

  describe("getUserPermissions", () => {
    it("should return permission types for a user", async () => {
      prisma.userPermission.findMany.mockResolvedValue([
        { permission: "CREATE_LANDING_PAGE" },
        { permission: "VIEW_ANALYTICS" },
      ]);

      const perms = await manager.getUserPermissions("user-1");
      expect(perms).toEqual(["CREATE_LANDING_PAGE", "VIEW_ANALYTICS"]);
    });
  });
});
