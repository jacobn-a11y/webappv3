/**
 * E2E API Tests — POST /api/rag/query
 *
 * Covers:
 *  - Input validation (Zod schema → 400 with structured errors)
 *  - Trial gate (expired → 402, active trial → pass, paid plan → pass)
 *  - Successful queries returning sources with citations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createTestApp } from "../helpers/create-test-app.js";
import {
  ACTIVE_ORG,
  EXPIRED_ORG,
  PAID_ORG,
  buildMockRAGResponse,
} from "../helpers/seed.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    query: "What ROI did Acme Solutions achieve?",
    account_id: "acct-test-001",
    organization_id: "org-test-active",
    ...overrides,
  };
}

/** Creates a mock PrismaClient that returns the given org on findUnique */
function mockPrisma(org: Record<string, unknown> | null = ACTIVE_ORG) {
  const isPaidPlan =
    !!org &&
    typeof (org as { plan?: unknown }).plan === "string" &&
    (org as { plan: string }).plan !== "FREE_TRIAL";

  return {
    organization: {
      findUnique: vi.fn().mockResolvedValue(org),
    },
    subscription: {
      findFirst: vi.fn().mockResolvedValue(
        isPaidPlan
          ? {
              id: "sub-test-active",
              status: "ACTIVE",
              currentPeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            }
          : null
      ),
    },
  };
}

function mockRAGEngine(response = buildMockRAGResponse()) {
  return { query: vi.fn().mockResolvedValue(response) };
}

function mockStoryBuilder() {
  return { buildStory: vi.fn() };
}

// ─── Input Validation ───────────────────────────────────────────────────────

describe("POST /api/rag/query — input validation", () => {
  let app: ReturnType<typeof createTestApp>;
  let ragEngine: ReturnType<typeof mockRAGEngine>;

  beforeEach(() => {
    ragEngine = mockRAGEngine();
    app = createTestApp({
      prisma: mockPrisma(),
      ragEngine,
      storyBuilder: mockStoryBuilder(),
    });
  });

  it("returns 400 when the body is empty", async () => {
    const res = await request(app).post("/api/rag/query").send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
    expect(res.body.details).toBeInstanceOf(Array);
    expect(res.body.details.length).toBeGreaterThanOrEqual(1);
  });

  it("returns 400 when query is missing", async () => {
    const res = await request(app)
      .post("/api/rag/query")
      .send(validPayload({ query: undefined }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: expect.arrayContaining(["query"]) }),
      ])
    );
  });

  it("returns 400 when query is too short (< 3 chars)", async () => {
    const res = await request(app)
      .post("/api/rag/query")
      .send(validPayload({ query: "ab" }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["query"],
          message: expect.stringContaining("3"),
        }),
      ])
    );
  });

  it("returns 400 when query exceeds 1000 characters", async () => {
    const res = await request(app)
      .post("/api/rag/query")
      .send(validPayload({ query: "x".repeat(1001) }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["query"] }),
      ])
    );
  });

  it("returns 400 when account_id is missing", async () => {
    const res = await request(app)
      .post("/api/rag/query")
      .send(validPayload({ account_id: undefined }));

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expect.arrayContaining(["account_id"]),
        }),
      ])
    );
  });

  it("returns 400 when organization_id is missing", async () => {
    const res = await request(app)
      .post("/api/rag/query")
      .send(validPayload({ organization_id: undefined }));

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expect.arrayContaining(["organization_id"]),
        }),
      ])
    );
  });

  it("returns 400 when top_k is not an integer", async () => {
    const res = await request(app)
      .post("/api/rag/query")
      .send(validPayload({ top_k: 3.5 }));

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["top_k"] }),
      ])
    );
  });

  it("returns 400 when top_k exceeds 20", async () => {
    const res = await request(app)
      .post("/api/rag/query")
      .send(validPayload({ top_k: 25 }));

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["top_k"] }),
      ])
    );
  });

  it("returns 400 when funnel_stages is not an array", async () => {
    const res = await request(app)
      .post("/api/rag/query")
      .send(validPayload({ funnel_stages: "BOFU" }));

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["funnel_stages"] }),
      ])
    );
  });

  it("does not call the RAG engine when validation fails", async () => {
    await request(app).post("/api/rag/query").send({});
    expect(ragEngine.query).not.toHaveBeenCalled();
  });
});

// ─── Trial Gate ─────────────────────────────────────────────────────────────

describe("POST /api/rag/query — trial gate", () => {
  beforeEach(() => {
    process.env.BILLING_ENABLED = "true";
  });

  afterEach(() => {
    delete process.env.BILLING_ENABLED;
  });

  it("returns 402 when the org trial has expired", async () => {
    const app = createTestApp({
      prisma: mockPrisma(EXPIRED_ORG),
      ragEngine: mockRAGEngine(),
      storyBuilder: mockStoryBuilder(),
      organizationId: EXPIRED_ORG.id,
    });

    const res = await request(app)
      .post("/api/rag/query")
      .send(validPayload());

    expect(res.status).toBe(402);
    expect(res.body.error).toBe("trial_expired");
    expect(res.body.message).toMatch(/trial.*expired/i);
    expect(res.body.upgradeUrl).toBeDefined();
  });

  it("passes through when the org trial is still active", async () => {
    const ragEngine = mockRAGEngine();
    const app = createTestApp({
      prisma: mockPrisma(ACTIVE_ORG),
      ragEngine,
      storyBuilder: mockStoryBuilder(),
      organizationId: ACTIVE_ORG.id,
    });

    const res = await request(app)
      .post("/api/rag/query")
      .send(validPayload());

    expect(res.status).toBe(200);
    expect(ragEngine.query).toHaveBeenCalledTimes(1);
  });

  it("passes through when the org has a paid plan", async () => {
    const ragEngine = mockRAGEngine();
    const app = createTestApp({
      prisma: mockPrisma(PAID_ORG),
      ragEngine,
      storyBuilder: mockStoryBuilder(),
      organizationId: PAID_ORG.id,
    });

    const res = await request(app)
      .post("/api/rag/query")
      .send(validPayload());

    expect(res.status).toBe(200);
    expect(ragEngine.query).toHaveBeenCalledTimes(1);
  });

  it("returns 401 when no auth token / organizationId is present", async () => {
    const app = createTestApp({
      prisma: mockPrisma(),
      ragEngine: mockRAGEngine(),
      storyBuilder: mockStoryBuilder(),
      organizationId: null,
    });

    const res = await request(app)
      .post("/api/rag/query")
      .send(validPayload());

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/auth/i);
  });

  it("returns 404 when the organization does not exist", async () => {
    const app = createTestApp({
      prisma: mockPrisma(null),
      ragEngine: mockRAGEngine(),
      storyBuilder: mockStoryBuilder(),
      organizationId: "org-nonexistent",
    });

    const res = await request(app)
      .post("/api/rag/query")
      .send(validPayload());

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});

// ─── Successful Queries ─────────────────────────────────────────────────────

describe("POST /api/rag/query — successful queries", () => {
  let app: ReturnType<typeof createTestApp>;
  let ragEngine: ReturnType<typeof mockRAGEngine>;

  beforeEach(() => {
    ragEngine = mockRAGEngine();
    app = createTestApp({
      prisma: mockPrisma(),
      ragEngine,
      storyBuilder: mockStoryBuilder(),
    });
  });

  it("returns 200 with answer, sources, and tokens_used", async () => {
    const res = await request(app)
      .post("/api/rag/query")
      .send(validPayload());

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("answer");
    expect(res.body).toHaveProperty("sources");
    expect(res.body).toHaveProperty("tokens_used");
    expect(typeof res.body.answer).toBe("string");
    expect(typeof res.body.tokens_used).toBe("number");
  });

  it("answer contains [Source N] citation markers", async () => {
    const res = await request(app)
      .post("/api/rag/query")
      .send(validPayload());

    expect(res.body.answer).toMatch(/\[Source \d+\]/);
  });

  it("sources array contains properly structured objects", async () => {
    const res = await request(app)
      .post("/api/rag/query")
      .send(validPayload());

    expect(res.body.sources).toBeInstanceOf(Array);
    expect(res.body.sources.length).toBeGreaterThan(0);

    for (const source of res.body.sources) {
      expect(source).toEqual(
        expect.objectContaining({
          chunk_id: expect.any(String),
          call_id: expect.any(String),
          call_title: expect.any(String),
          call_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          text: expect.any(String),
          relevance_score: expect.any(Number),
        })
      );
      // speaker may be null or a string
      expect(
        source.speaker === null || typeof source.speaker === "string"
      ).toBe(true);
    }
  });

  it("sources are ordered by relevance score descending", async () => {
    const res = await request(app)
      .post("/api/rag/query")
      .send(validPayload());

    const scores = res.body.sources.map(
      (s: { relevance_score: number }) => s.relevance_score
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  it("forwards top_k and funnel_stages to the RAG engine", async () => {
    await request(app)
      .post("/api/rag/query")
      .send(validPayload({ top_k: 5, funnel_stages: ["BOFU", "POST_SALE"] }));

    expect(ragEngine.query).toHaveBeenCalledWith(
      expect.objectContaining({
        topK: 5,
        funnelStages: ["BOFU", "POST_SALE"],
      })
    );
  });

  it("maps request field names to camelCase service parameters", async () => {
    await request(app).post("/api/rag/query").send(validPayload());

    expect(ragEngine.query).toHaveBeenCalledWith(
      expect.objectContaining({
        query: validPayload().query,
        accountId: validPayload().account_id,
        organizationId: validPayload().organization_id,
      })
    );
  });

  it("returns 500 when the RAG engine throws", async () => {
    ragEngine.query.mockRejectedValueOnce(new Error("Pinecone timeout"));

    const res = await request(app)
      .post("/api/rag/query")
      .send(validPayload());

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});
