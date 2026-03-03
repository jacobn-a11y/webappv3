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

describe("dashboard overview contract", () => {
  const prisma = {
    userRoleAssignment: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    story: {
      count: vi.fn(),
    },
    landingPage: {
      count: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    },
    integrationConfig: {
      count: vi.fn(),
    },
    approvalRequest: {
      count: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.userRoleAssignment.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      name: "Alex Admin",
      email: "alex@example.com",
      role: "ADMIN",
    });
    prisma.user.findMany.mockResolvedValue([{ id: "user-1", name: "Alex Admin" }]);
    prisma.integrationConfig.count.mockResolvedValue(1);
    prisma.approvalRequest.count.mockResolvedValue(2);
    prisma.landingPage.aggregate.mockResolvedValue({ _sum: { viewCount: 140 } });
    prisma.landingPage.groupBy.mockResolvedValue([{ createdById: "user-1", _count: 3 }]);
  });

  it("preserves GET /api/dashboard/home payload contract", async () => {
    prisma.story.count
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(3);
    prisma.landingPage.count.mockResolvedValueOnce(9);

    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/home");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        user: {
          id: "user-1",
          name: "Alex Admin",
          email: "alex@example.com",
          base_role: "ADMIN",
        },
        persona: "REVOPS_ADMIN",
        summary: {
          stories_30d: 12,
          pages_30d: 9,
          failed_integrations: 1,
          pending_approvals: 2,
          post_sale_stories_30d: 5,
          mofu_stories_30d: 4,
          bofu_stories_30d: 3,
          total_page_views: 140,
        },
      });
      expect(Array.isArray(res.body.recommended_actions)).toBe(true);
      expect(res.body.recommended_actions.length).toBeGreaterThan(0);
    } finally {
      close();
    }
  });

  it("preserves GET /api/dashboard/stats payload contract", async () => {
    prisma.landingPage.count
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(4);
    prisma.landingPage.aggregate.mockResolvedValueOnce({ _sum: { viewCount: 321 } });
    prisma.landingPage.groupBy.mockResolvedValueOnce([{ createdById: "user-1", _count: 8 }]);

    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/stats");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        totalPages: 12,
        publishedPages: 8,
        draftPages: 4,
        totalViews: 321,
        pagesByUser: [{ userId: "user-1", name: "Alex Admin", count: 8 }],
      });
    } finally {
      close();
    }
  });
});
