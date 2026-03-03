import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createDashboardRoutes } from "../../src/api/dashboard-routes.js";
import { requestServer } from "../helpers/request-server.js";

function createApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Record<string, unknown>).organizationId = "org-1";
    (req as Record<string, unknown>).userId = "admin-1";
    (req as Record<string, unknown>).userRole = "ADMIN";
    next();
  });
  app.use("/api/dashboard", createDashboardRoutes(prisma));
  return app;
}

describe("dashboard data quality contract", () => {
  const prisma = {
    story: {
      count: vi.fn(),
      aggregate: vi.fn(),
      findFirst: vi.fn(),
    },
    storyClaimLineage: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    storyQualityFeedback: {
      count: vi.fn(),
    },
    integrationRun: {
      count: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves GET /api/dashboard/data-quality/overview shape", async () => {
    prisma.story.count.mockResolvedValue(12);
    prisma.story.aggregate
      .mockResolvedValueOnce({ _avg: { confidenceScore: 0.87 } })
      .mockResolvedValueOnce({ _avg: { confidenceScore: 0.8 } });
    prisma.storyClaimLineage.count.mockResolvedValue(18);
    prisma.storyQualityFeedback.count.mockResolvedValueOnce(3).mockResolvedValueOnce(9);
    prisma.integrationRun.count.mockResolvedValueOnce(4).mockResolvedValueOnce(2);
    prisma.story.findFirst.mockResolvedValue({ generatedAt: new Date("2026-01-20T00:00:00.000Z") });

    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/data-quality/overview");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        stories_total: 12,
        confidence: {
          avg_30d: 0.87,
          avg_prev_30d: 0.8,
          drift_delta: 0.07,
          drift_status: "WARN",
        },
        lineage: {
          claims_30d: 18,
          coverage_ratio: 1.5,
        },
        sync_errors: {
          failures_30d: 4,
          failures_prev_30d: 2,
          delta: 2,
        },
        human_feedback: {
          open: 3,
          applied: 9,
        },
      });
      expect(res.body.freshness.last_story_at).toBe("2026-01-20T00:00:00.000Z");
    } finally {
      close();
    }
  });

  it("preserves GET /api/dashboard/data-quality/stories/:storyId/lineage mapping", async () => {
    prisma.story.findFirst.mockResolvedValue({
      id: "story-1",
      title: "QBR Narrative",
      confidenceScore: 0.91,
      lineageSummary: "3 claims traced",
    });
    prisma.storyClaimLineage.findMany.mockResolvedValue([
      {
        id: "cl-1",
        claimType: "QUOTE",
        claimText: "Growth accelerated",
        sourceCallId: "call-1",
        sourceChunkId: "chunk-1",
        sourceTimestampMs: 120000,
        confidenceScore: 0.9,
        metadata: { source: "gong" },
        createdAt: new Date("2026-01-21T00:00:00.000Z"),
      },
    ]);

    const app = createApp(prisma);
    const { request, close } = await requestServer(app);
    try {
      const res = await request.get("/api/dashboard/data-quality/stories/story-1/lineage");

      expect(res.status).toBe(200);
      expect(res.body.story).toEqual({
        id: "story-1",
        title: "QBR Narrative",
        confidence_score: 0.91,
        lineage_summary: "3 claims traced",
      });
      expect(res.body.claims).toEqual([
        {
          id: "cl-1",
          claim_type: "QUOTE",
          claim_text: "Growth accelerated",
          source_call_id: "call-1",
          source_chunk_id: "chunk-1",
          source_timestamp_ms: 120000,
          confidence_score: 0.9,
          metadata: { source: "gong" },
          created_at: "2026-01-21T00:00:00.000Z",
        },
      ]);
    } finally {
      close();
    }
  });
});
