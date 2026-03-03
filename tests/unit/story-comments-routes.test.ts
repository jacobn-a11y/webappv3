import express, { type NextFunction, type Request, type Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { requestServer } from "../helpers/request-server.js";
import { createStoryCommentRoutes } from "../../src/api/story-comments-routes.js";

function createMockPrisma() {
  return {
    landingPage: {
      findFirst: vi.fn().mockResolvedValue({
        id: "page-1",
      }),
    },
    storyQualityFeedback: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({
        id: "feedback-1",
        notes: "Looks good",
        originalValue: null,
        targetType: "STORY",
        targetId: "story-1",
        createdAt: new Date("2026-03-03T00:00:00.000Z"),
        submittedBy: {
          id: "user-1",
          name: "Alex",
          email: "alex@example.com",
        },
      }),
    },
  };
}

function createApp(prisma: ReturnType<typeof createMockPrisma>) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as { organizationId?: string }).organizationId = "org-1";
    (req as { userId?: string }).userId = "user-1";
    next();
  });
  app.use("/api/stories", createStoryCommentRoutes(prisma as any));
  return app;
}

describe("story-comments-routes", () => {
  it("creates a story comment", async () => {
    const prisma = createMockPrisma();
    const app = createApp(prisma);

    await requestServer(app).then(async ({ request, close }) => {
      try {
        const res = await request
          .post("/api/stories/story-1/comments")
          .send({ message: "Looks good", target: "story" })
          .expect(201);

        expect(res.body.id).toBe("feedback-1");
        expect(prisma.storyQualityFeedback.create).toHaveBeenCalledTimes(1);
      } finally {
        close();
      }
    });
  });

  it("lists page comments when the page belongs to the story", async () => {
    const prisma = createMockPrisma();
    prisma.storyQualityFeedback.findMany.mockResolvedValue([
      {
        id: "feedback-1",
        notes: "Check this",
        originalValue: null,
        targetType: "PAGE",
        targetId: "page-1",
        createdAt: new Date("2026-03-03T00:00:00.000Z"),
        submittedBy: {
          id: "user-1",
          name: "Alex",
          email: "alex@example.com",
        },
      },
    ]);
    const app = createApp(prisma);

    await requestServer(app).then(async ({ request, close }) => {
      try {
        const res = await request
          .get("/api/stories/story-1/comments?target=page&page_id=page-1")
          .expect(200);
        expect(res.body.comments).toHaveLength(1);
      } finally {
        close();
      }
    });
  });

  it("rejects page thread requests when page does not match story", async () => {
    const prisma = createMockPrisma();
    prisma.landingPage.findFirst.mockResolvedValue(null);
    const app = createApp(prisma);

    await requestServer(app).then(async ({ request, close }) => {
      try {
        const res = await request
          .get("/api/stories/story-1/comments?target=page&page_id=page-other")
          .expect(400);
        expect(res.body.error).toContain("does not belong");
      } finally {
        close();
      }
    });
  });
});
