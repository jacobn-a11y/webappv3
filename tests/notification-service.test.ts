import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotificationService } from "../src/services/notification-service.js";

// ─── Mock Prisma ─────────────────────────────────────────────────────────────

function createMockPrisma() {
  return {
    notification: {
      create: vi.fn().mockResolvedValue({ id: "notif-1" }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

describe("NotificationService", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: NotificationService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new NotificationService(prisma as never);
  });

  describe("create", () => {
    it("creates a notification with all fields", async () => {
      const result = await service.create({
        organizationId: "org-1",
        userId: "user-1",
        type: "STORY_COMPLETED",
        title: "Story ready",
        body: "Your story is ready.",
        metadata: { storyId: "story-1" },
      });

      expect(result).toEqual({ id: "notif-1" });
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: "org-1",
          userId: "user-1",
          type: "STORY_COMPLETED",
          title: "Story ready",
          body: "Your story is ready.",
          metadata: { storyId: "story-1" },
        }),
      });
    });

    it("creates a broadcast notification when userId is null", async () => {
      await service.create({
        organizationId: "org-1",
        type: "CALL_PROCESSED",
        title: "Call processed",
        body: "A call has been processed.",
      });

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: null,
        }),
      });
    });
  });

  describe("listForUser", () => {
    it("fetches notifications for a user including broadcasts", async () => {
      const mockNotifs = [
        {
          id: "n1",
          type: "STORY_COMPLETED",
          title: "Story ready",
          body: "Done",
          metadata: null,
          read: false,
          createdAt: new Date("2024-01-01"),
        },
      ];
      prisma.notification.findMany.mockResolvedValue(mockNotifs);
      prisma.notification.count
        .mockResolvedValueOnce(1) // total
        .mockResolvedValueOnce(1); // unread

      const result = await service.listForUser("org-1", "user-1");

      expect(result.notifications).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.unreadCount).toBe(1);

      // Verify the query includes both user-specific and broadcast
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: "org-1",
            OR: [{ userId: "user-1" }, { userId: null }],
          }),
        })
      );
    });

    it("supports unreadOnly filter", async () => {
      prisma.notification.findMany.mockResolvedValue([]);
      prisma.notification.count.mockResolvedValue(0);

      await service.listForUser("org-1", "user-1", { unreadOnly: true });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            read: false,
          }),
        })
      );
    });

    it("supports pagination via limit and offset", async () => {
      prisma.notification.findMany.mockResolvedValue([]);
      prisma.notification.count.mockResolvedValue(0);

      await service.listForUser("org-1", "user-1", {
        limit: 10,
        offset: 20,
      });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 20,
        })
      );
    });
  });

  describe("markAsRead", () => {
    it("marks a notification as read", async () => {
      await service.markAsRead("notif-1", "user-1");

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: {
          id: "notif-1",
          OR: [{ userId: "user-1" }, { userId: null }],
        },
        data: { read: true },
      });
    });
  });

  describe("markAllAsRead", () => {
    it("marks all unread notifications as read", async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 5 });

      const result = await service.markAllAsRead("org-1", "user-1");

      expect(result).toEqual({ count: 5 });
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          OR: [{ userId: "user-1" }, { userId: null }],
          read: false,
        },
        data: { read: true },
      });
    });
  });

  describe("getUnreadCount", () => {
    it("returns the count of unread notifications", async () => {
      prisma.notification.count.mockResolvedValue(7);

      const count = await service.getUnreadCount("org-1", "user-1");

      expect(count).toBe(7);
    });
  });

  // ─── Convenience Methods ──────────────────────────────────────────

  describe("notifyStoryCompleted", () => {
    it("creates a STORY_COMPLETED notification", async () => {
      await service.notifyStoryCompleted(
        "org-1",
        "user-1",
        "story-1",
        "My Case Study"
      );

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: "STORY_COMPLETED",
          title: "Story ready",
          metadata: { storyId: "story-1" },
        }),
      });
    });
  });

  describe("notifyCallProcessed", () => {
    it("creates a broadcast CALL_PROCESSED notification", async () => {
      await service.notifyCallProcessed("org-1", "call-1");

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: "CALL_PROCESSED",
          userId: null,
          metadata: { callId: "call-1" },
        }),
      });
    });
  });

  describe("notifyCallProcessingFailed", () => {
    it("creates a CALL_PROCESSING_FAILED notification with error", async () => {
      await service.notifyCallProcessingFailed(
        "org-1",
        "call-1",
        "OpenAI timeout"
      );

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: "CALL_PROCESSING_FAILED",
          metadata: { callId: "call-1", error: "OpenAI timeout" },
        }),
      });
    });
  });

  describe("notifyTrialExpiring", () => {
    it("creates a TRIAL_EXPIRING notification with days remaining", async () => {
      await service.notifyTrialExpiring("org-1", 3);

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: "TRIAL_EXPIRING",
          body: expect.stringContaining("3 days"),
        }),
      });
    });

    it("handles singular day correctly", async () => {
      await service.notifyTrialExpiring("org-1", 1);

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          body: expect.stringContaining("1 day"),
        }),
      });
    });
  });

  describe("notifyPagePublished", () => {
    it("creates a PAGE_PUBLISHED notification", async () => {
      await service.notifyPagePublished(
        "org-1",
        "page-1",
        "My Landing Page",
        "user-1"
      );

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: "PAGE_PUBLISHED",
          metadata: { pageId: "page-1", publishedByUserId: "user-1" },
        }),
      });
    });
  });

  describe("notifyPageNeedsApproval", () => {
    it("creates a PAGE_NEEDS_APPROVAL notification", async () => {
      await service.notifyPageNeedsApproval(
        "org-1",
        "page-1",
        "Draft Page",
        "user-1"
      );

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: "PAGE_NEEDS_APPROVAL",
          metadata: { pageId: "page-1", submittedByUserId: "user-1" },
        }),
      });
    });
  });
});
