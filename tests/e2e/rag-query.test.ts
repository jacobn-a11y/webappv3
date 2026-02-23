/**
 * E2E API Tests — RAG query/chat authorization and validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestAppWithServer } from "../helpers/create-test-app.js";
import {
  ACTIVE_ORG,
  EXPIRED_ORG,
  PAID_ORG,
  buildMockRAGResponse,
} from "../helpers/seed.js";

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    query: "What ROI did Acme Solutions achieve?",
    account_id: "acct-test-001",
    organization_id: "org-test-active",
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
    userAccountAccess: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

function mockRAGEngine(response = buildMockRAGResponse()) {
  return {
    query: vi.fn().mockResolvedValue(response),
    chat: vi.fn().mockResolvedValue(response),
  };
}

function mockStoryBuilder() {
  return { buildStory: vi.fn() };
}

describe("POST /api/rag/query — validation and tenant guard", () => {
  let req: Awaited<ReturnType<typeof createTestAppWithServer>>["request"];
  let closeServer: () => void;
  let ragEngine: ReturnType<typeof mockRAGEngine>;

  beforeEach(async () => {
    ragEngine = mockRAGEngine();
    const s = await createTestAppWithServer({
      prisma: mockPrisma(),
      ragEngine,
      storyBuilder: mockStoryBuilder(),
    });
    req = s.request;
    closeServer = s.close;
  });

  afterEach(() => {
    closeServer?.();
  });

  it("returns 400 for invalid body", async () => {
    const res = await req.post("/api/rag/query").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
    expect(ragEngine.query).not.toHaveBeenCalled();
  });

  it("accepts missing organization_id and uses authenticated org context", async () => {
    const res = await req
      .post("/api/rag/query")
      .send(validPayload({ organization_id: undefined }));

    expect(res.status).toBe(200);
    expect(ragEngine.query).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-test-active",
      })
    );
  });

  it("returns 403 when organization_id mismatches authenticated org", async () => {
    const res = await req
      .post("/api/rag/query")
      .send(validPayload({ organization_id: "org-spoofed" }));

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("organization_mismatch");
    expect(ragEngine.query).not.toHaveBeenCalled();
  });

  it("returns 400 when top_k is not an integer", async () => {
    const res = await req
      .post("/api/rag/query")
      .send(validPayload({ top_k: 3.5 }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });
});

describe("POST /api/rag/query — trial gate", () => {
  beforeEach(() => {
    process.env.BILLING_ENABLED = "true";
  });

  afterEach(() => {
    delete process.env.BILLING_ENABLED;
  });

  it("returns 402 when trial expired", async () => {
    const { request, close } = await createTestAppWithServer({
      prisma: mockPrisma(EXPIRED_ORG),
      ragEngine: mockRAGEngine(),
      storyBuilder: mockStoryBuilder(),
      organizationId: EXPIRED_ORG.id,
    });
    try {
      const res = await request.post("/api/rag/query").send(validPayload());
      expect(res.status).toBe(402);
      expect(res.body.error).toBe("trial_expired");
    } finally {
      close();
    }
  });

  it("returns 401 without authenticated org context", async () => {
    const { request, close } = await createTestAppWithServer({
      prisma: mockPrisma(),
      ragEngine: mockRAGEngine(),
      storyBuilder: mockStoryBuilder(),
      organizationId: null,
    });
    try {
      const res = await request.post("/api/rag/query").send(validPayload());
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });

  it("returns 404 when org does not exist", async () => {
    const { request, close } = await createTestAppWithServer({
      prisma: mockPrisma(null),
      ragEngine: mockRAGEngine(),
      storyBuilder: mockStoryBuilder(),
      organizationId: "org-missing",
    });
    try {
      const res = await request.post("/api/rag/query").send(validPayload());
      expect(res.status).toBe(404);
    } finally {
      close();
    }
  });

  it("passes for paid plans", async () => {
    const ragEngine = mockRAGEngine();
    const { request, close } = await createTestAppWithServer({
      prisma: mockPrisma(PAID_ORG),
      ragEngine,
      storyBuilder: mockStoryBuilder(),
      organizationId: PAID_ORG.id,
    });
    try {
      const res = await request
        .post("/api/rag/query")
        .send(validPayload({ organization_id: PAID_ORG.id }));
      expect(res.status).toBe(200);
      expect(ragEngine.query).toHaveBeenCalledTimes(1);
    } finally {
      close();
    }
  });
});

describe("RAG account access enforcement", () => {
  it("blocks restricted users from querying unauthorized accounts", async () => {
    const ragEngine = mockRAGEngine();
    const { request, close } = await createTestAppWithServer({
      prisma: mockPrisma(),
      ragEngine,
      storyBuilder: mockStoryBuilder(),
      userId: "user-restricted",
      userRole: "MEMBER",
      organizationId: ACTIVE_ORG.id,
    });
    try {
      const res = await request
        .post("/api/rag/query")
        .send(validPayload({ organization_id: undefined }));

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("permission_denied");
      expect(ragEngine.query).not.toHaveBeenCalled();
    } finally {
      close();
    }
  });

  it("blocks restricted users from chat on unauthorized accounts", async () => {
    const ragEngine = mockRAGEngine();
    const { request, close } = await createTestAppWithServer({
      prisma: mockPrisma(),
      ragEngine,
      storyBuilder: mockStoryBuilder(),
      userId: "user-restricted",
      userRole: "MEMBER",
      organizationId: ACTIVE_ORG.id,
    });
    try {
      const res = await request.post("/api/rag/chat").send({
        query: "What changed?",
        account_id: "acct-test-001",
        history: [],
      });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("permission_denied");
      expect(ragEngine.chat).not.toHaveBeenCalled();
    } finally {
      close();
    }
  });

  it("allows chat without account_id", async () => {
    const ragEngine = mockRAGEngine();
    const { request, close } = await createTestAppWithServer({
      prisma: mockPrisma(),
      ragEngine,
      storyBuilder: mockStoryBuilder(),
    });
    try {
      const res = await request.post("/api/rag/chat").send({
        query: "Summarize themes",
        account_id: null,
        history: [],
      });

      expect(res.status).toBe(200);
      expect(ragEngine.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: null,
          organizationId: "org-test-active",
        })
      );
    } finally {
      close();
    }
  });
});
