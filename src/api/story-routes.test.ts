import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createStoryRoutes } from "./story-routes.js";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockMergeTranscripts = vi.fn();

vi.mock("../services/transcript-merger.js", () => ({
  TranscriptMerger: class MockTranscriptMerger {
    mergeTranscripts = mockMergeTranscripts;
  },
}));

function createMockStoryBuilder() {
  return {
    buildStory: vi.fn(),
  };
}

function createMockPrisma() {
  return {
    story: {
      findMany: vi.fn(),
    },
    orgSettings: {
      findUnique: vi.fn(),
    },
    call: {
      findMany: vi.fn(),
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createApp(
  storyBuilder: ReturnType<typeof createMockStoryBuilder>,
  prisma: ReturnType<typeof createMockPrisma>
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).organizationId = "org-test";
    (req as any).userId = "user-test";
    next();
  });
  app.use("/api/stories", createStoryRoutes(storyBuilder as any, prisma as any));
  return app;
}

async function request(
  app: express.Express,
  method: "get" | "post",
  path: string,
  body?: Record<string, unknown>
): Promise<{ status: number; body: any }> {
  return new Promise((resolve) => {
    const http = require("http");
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      const options = {
        hostname: "127.0.0.1",
        port,
        path,
        method: method.toUpperCase(),
        headers: { "Content-Type": "application/json" },
      };

      const req = http.request(options, (res: any) => {
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => {
          server.close();
          resolve({
            status: res.statusCode,
            body: JSON.parse(data),
          });
        });
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Story Routes - Merge Transcripts Endpoint", () => {
  let storyBuilder: ReturnType<typeof createMockStoryBuilder>;
  let prisma: ReturnType<typeof createMockPrisma>;
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    storyBuilder = createMockStoryBuilder();
    prisma = createMockPrisma();
    app = createApp(storyBuilder, prisma);
  });

  describe("POST /api/stories/merge-transcripts", () => {
    it("should require account_id", async () => {
      const res = await request(app, "post", "/api/stories/merge-transcripts", {});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("validation_error");
    });

    it("should accept valid merge request with only account_id", async () => {
      mockMergeTranscripts.mockResolvedValue({
        markdown: "# Merged content",
        wordCount: 2,
        totalCalls: 1,
        includedCalls: 1,
        truncated: false,
        truncationBoundary: null,
        truncationMode: "OLDEST_FIRST",
      });

      const res = await request(app, "post", "/api/stories/merge-transcripts", {
        account_id: "acct-1",
      });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("markdown");
      expect(res.body).toHaveProperty("word_count");
      expect(res.body).toHaveProperty("total_calls");
      expect(res.body).toHaveProperty("included_calls");
      expect(res.body).toHaveProperty("truncated");
      expect(res.body).toHaveProperty("truncation_boundary");
      expect(res.body).toHaveProperty("truncation_mode");
    });

    it("should reject invalid truncation_mode", async () => {
      const res = await request(app, "post", "/api/stories/merge-transcripts", {
        account_id: "acct-1",
        truncation_mode: "INVALID",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("validation_error");
    });

    it("should reject max_words below minimum", async () => {
      const res = await request(app, "post", "/api/stories/merge-transcripts", {
        account_id: "acct-1",
        max_words: 100,
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("validation_error");
    });

    it("should accept valid optional parameters", async () => {
      mockMergeTranscripts.mockResolvedValue({
        markdown: "# Content",
        wordCount: 1,
        totalCalls: 1,
        includedCalls: 1,
        truncated: false,
        truncationBoundary: null,
        truncationMode: "NEWEST_FIRST",
      });

      const res = await request(app, "post", "/api/stories/merge-transcripts", {
        account_id: "acct-1",
        max_words: 50_000,
        truncation_mode: "NEWEST_FIRST",
        after_date: "2025-01-01T00:00:00.000Z",
        before_date: "2025-12-31T00:00:00.000Z",
      });

      expect(res.status).toBe(200);
    });

    it("should return truncation metadata in response", async () => {
      const boundary = new Date("2025-03-15");
      mockMergeTranscripts.mockResolvedValue({
        markdown: "# Truncated",
        wordCount: 100,
        totalCalls: 5,
        includedCalls: 3,
        truncated: true,
        truncationBoundary: boundary,
        truncationMode: "OLDEST_FIRST",
      });

      const res = await request(app, "post", "/api/stories/merge-transcripts", {
        account_id: "acct-1",
      });

      expect(res.status).toBe(200);
      expect(res.body.truncated).toBe(true);
      expect(res.body.total_calls).toBe(5);
      expect(res.body.included_calls).toBe(3);
      expect(res.body.truncation_boundary).toBe(boundary.toISOString());
      expect(res.body.truncation_mode).toBe("OLDEST_FIRST");
    });
  });

  describe("MergeTranscriptsSchema validation", () => {
    it("should accept OLDEST_FIRST truncation mode", async () => {
      mockMergeTranscripts.mockResolvedValue({
        markdown: "",
        wordCount: 0,
        totalCalls: 0,
        includedCalls: 0,
        truncated: false,
        truncationBoundary: null,
        truncationMode: "OLDEST_FIRST",
      });

      const res = await request(app, "post", "/api/stories/merge-transcripts", {
        account_id: "acct-1",
        truncation_mode: "OLDEST_FIRST",
      });

      expect(res.status).toBe(200);
    });

    it("should accept NEWEST_FIRST truncation mode", async () => {
      mockMergeTranscripts.mockResolvedValue({
        markdown: "",
        wordCount: 0,
        totalCalls: 0,
        includedCalls: 0,
        truncated: false,
        truncationBoundary: null,
        truncationMode: "NEWEST_FIRST",
      });

      const res = await request(app, "post", "/api/stories/merge-transcripts", {
        account_id: "acct-1",
        truncation_mode: "NEWEST_FIRST",
      });

      expect(res.status).toBe(200);
    });
  });
});
