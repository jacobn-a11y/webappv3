/**
 * E2E API Tests — POST /api/stories/build
 *
 * Covers:
 *  - Input validation (Zod schema → 400 with structured errors)
 *  - Trial gate (expired → 402, active trial → pass, paid plan → pass)
 *  - Successful builds returning structured Markdown with quotes
 *  - Topic and funnel_stage filter pass-through
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createTestApp } from "../helpers/create-test-app.js";
import {
  ACTIVE_ORG,
  EXPIRED_ORG,
  PAID_ORG,
  buildMockStoryResponse,
} from "../helpers/seed.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    account_id: "acct-test-001",
    funnel_stages: ["BOFU"],
    filter_topics: ["roi_financial_outcomes"],
    title: "Acme ROI Story",
    ...overrides,
  };
}

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
    // story-routes GET /:accountId uses prisma.story.findMany — not tested here
    // but we include it so the mock is type-complete
    story: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

function mockStoryBuilder(response = buildMockStoryResponse()) {
  return { buildStory: vi.fn().mockResolvedValue(response) };
}

function mockRAGEngine() {
  return { query: vi.fn() };
}

// ─── Input Validation ───────────────────────────────────────────────────────

describe("POST /api/stories/build — input validation", () => {
  let app: ReturnType<typeof createTestApp>;
  let storyBuilder: ReturnType<typeof mockStoryBuilder>;

  beforeEach(() => {
    storyBuilder = mockStoryBuilder();
    app = createTestApp({
      prisma: mockPrisma(),
      ragEngine: mockRAGEngine(),
      storyBuilder,
    });
  });

  it("returns 400 when the body is empty", async () => {
    const res = await request(app).post("/api/stories/build").send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
    expect(res.body.details).toBeInstanceOf(Array);
    expect(res.body.details.length).toBeGreaterThanOrEqual(1);
  });

  it("returns 400 when account_id is missing", async () => {
    const res = await request(app)
      .post("/api/stories/build")
      .send(validPayload({ account_id: undefined }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expect.arrayContaining(["account_id"]),
        }),
      ])
    );
  });

  it("returns 400 when account_id is an empty string", async () => {
    const res = await request(app)
      .post("/api/stories/build")
      .send(validPayload({ account_id: "" }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["account_id"] }),
      ])
    );
  });

  it("returns 400 when funnel_stages is not an array", async () => {
    const res = await request(app)
      .post("/api/stories/build")
      .send(validPayload({ funnel_stages: "BOFU" }));

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["funnel_stages"] }),
      ])
    );
  });

  it("returns 400 when filter_topics is not an array", async () => {
    const res = await request(app)
      .post("/api/stories/build")
      .send(validPayload({ filter_topics: "roi_financial_outcomes" }));

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["filter_topics"] }),
      ])
    );
  });

  it("Zod errors include path and message for each issue", async () => {
    // Send a payload missing account_id with bad funnel_stages
    const res = await request(app)
      .post("/api/stories/build")
      .send({ funnel_stages: "not-an-array" });

    expect(res.status).toBe(400);
    for (const detail of res.body.details) {
      expect(detail).toHaveProperty("path");
      expect(detail).toHaveProperty("message");
      expect(typeof detail.message).toBe("string");
    }
  });

  it("does not call the story builder when validation fails", async () => {
    await request(app).post("/api/stories/build").send({});
    expect(storyBuilder.buildStory).not.toHaveBeenCalled();
  });
});

// ─── Trial Gate ─────────────────────────────────────────────────────────────

describe("POST /api/stories/build — trial gate", () => {
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
      .post("/api/stories/build")
      .send(validPayload());

    expect(res.status).toBe(402);
    expect(res.body.error).toBe("trial_expired");
    expect(res.body.message).toMatch(/trial.*expired/i);
    expect(res.body.upgradeUrl).toBe("/api/billing/checkout");
  });

  it("passes through when the org trial is still active", async () => {
    const storyBuilder = mockStoryBuilder();
    const app = createTestApp({
      prisma: mockPrisma(ACTIVE_ORG),
      ragEngine: mockRAGEngine(),
      storyBuilder,
      organizationId: ACTIVE_ORG.id,
    });

    const res = await request(app)
      .post("/api/stories/build")
      .send(validPayload());

    expect(res.status).toBe(200);
    expect(storyBuilder.buildStory).toHaveBeenCalledTimes(1);
  });

  it("passes through when the org has a paid plan", async () => {
    const storyBuilder = mockStoryBuilder();
    const app = createTestApp({
      prisma: mockPrisma(PAID_ORG),
      ragEngine: mockRAGEngine(),
      storyBuilder,
      organizationId: PAID_ORG.id,
    });

    const res = await request(app)
      .post("/api/stories/build")
      .send(validPayload());

    expect(res.status).toBe(200);
    expect(storyBuilder.buildStory).toHaveBeenCalledTimes(1);
  });

  it("returns 401 when no organizationId is present (unauthenticated)", async () => {
    const app = createTestApp({
      prisma: mockPrisma(),
      ragEngine: mockRAGEngine(),
      storyBuilder: mockStoryBuilder(),
      organizationId: null,
    });

    const res = await request(app)
      .post("/api/stories/build")
      .send(validPayload());

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/auth/i);
  });
});

// ─── Successful Story Builds ────────────────────────────────────────────────

describe("POST /api/stories/build — successful builds", () => {
  let app: ReturnType<typeof createTestApp>;
  let storyBuilder: ReturnType<typeof mockStoryBuilder>;

  beforeEach(() => {
    storyBuilder = mockStoryBuilder();
    app = createTestApp({
      prisma: mockPrisma(),
      ragEngine: mockRAGEngine(),
      storyBuilder,
    });
  });

  it("returns 200 with title, markdown, and quotes", async () => {
    const res = await request(app)
      .post("/api/stories/build")
      .send(validPayload());

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("title");
    expect(res.body).toHaveProperty("markdown");
    expect(res.body).toHaveProperty("quotes");
    expect(typeof res.body.title).toBe("string");
    expect(typeof res.body.markdown).toBe("string");
    expect(res.body.quotes).toBeInstanceOf(Array);
  });

  it("markdown body contains expected Markdown structure", async () => {
    const res = await request(app)
      .post("/api/stories/build")
      .send(validPayload());

    const md: string = res.body.markdown;

    // Must contain top-level heading
    expect(md).toMatch(/^# .+/m);
    // Must contain at least one sub-heading
    expect(md).toMatch(/^## .+/m);
    // Must contain a timeline table
    expect(md).toMatch(/\|.*Date.*\|.*Milestone.*\|/i);
    // Must contain bold metrics
    expect(md).toMatch(/\*\*.+\*\*/);
    // Must contain a blockquote (Notable Quotes section)
    expect(md).toMatch(/^> ".+"/m);
  });

  it("markdown is between 800 and 5000 characters", async () => {
    const res = await request(app)
      .post("/api/stories/build")
      .send(validPayload());

    const length = res.body.markdown.length;
    expect(length).toBeGreaterThan(800);
    expect(length).toBeLessThan(5000);
  });

  it("quotes array contains properly structured objects", async () => {
    const res = await request(app)
      .post("/api/stories/build")
      .send(validPayload());

    expect(res.body.quotes.length).toBeGreaterThan(0);

    for (const quote of res.body.quotes) {
      expect(quote).toEqual(
        expect.objectContaining({
          quote_text: expect.any(String),
          call_id: expect.any(String),
        })
      );
      // Optional fields may be null or string
      for (const field of [
        "speaker",
        "context",
        "metric_type",
        "metric_value",
      ]) {
        expect(
          quote[field] === null || typeof quote[field] === "string"
        ).toBe(true);
      }
    }
  });

  it("quotes include metric_type and metric_value", async () => {
    const res = await request(app)
      .post("/api/stories/build")
      .send(validPayload());

    const quotesWithMetrics = res.body.quotes.filter(
      (q: { metric_value: string | null }) => q.metric_value !== null
    );
    expect(quotesWithMetrics.length).toBeGreaterThan(0);

    for (const q of quotesWithMetrics) {
      expect(q.metric_type).toBeTruthy();
      expect(q.metric_value).toBeTruthy();
    }
  });

  it("forwards filter_topics and funnel_stages to the story builder", async () => {
    await request(app)
      .post("/api/stories/build")
      .send(
        validPayload({
          funnel_stages: ["BOFU", "POST_SALE"],
          filter_topics: ["roi_financial_outcomes", "quantified_operational_metrics"],
        })
      );

    expect(storyBuilder.buildStory).toHaveBeenCalledWith(
      expect.objectContaining({
        funnelStages: ["BOFU", "POST_SALE"],
        filterTopics: [
          "roi_financial_outcomes",
          "quantified_operational_metrics",
        ],
      })
    );
  });

  it("forwards account_id and organizationId to the story builder", async () => {
    await request(app)
      .post("/api/stories/build")
      .send(validPayload());

    expect(storyBuilder.buildStory).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "acct-test-001",
        organizationId: ACTIVE_ORG.id,
      })
    );
  });

  it("optional fields (funnel_stages, filter_topics, title) can be omitted", async () => {
    const res = await request(app)
      .post("/api/stories/build")
      .send({ account_id: "acct-test-001" });

    expect(res.status).toBe(200);
    expect(storyBuilder.buildStory).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "acct-test-001",
      })
    );
  });

  it("returns 500 when the story builder throws", async () => {
    storyBuilder.buildStory.mockRejectedValueOnce(
      new Error("OpenAI rate limit")
    );

    const res = await request(app)
      .post("/api/stories/build")
      .send(validPayload());

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});
