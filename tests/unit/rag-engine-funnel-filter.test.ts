import { describe, it, expect, vi } from "vitest";
import { RAGEngine } from "../../src/services/rag-engine.js";

function makeEngine() {
  const prisma = {} as any;
  const engine = new RAGEngine(prisma, {
    openaiApiKey: "test-openai-key",
    pineconeApiKey: "test-pinecone-key",
    pineconeIndex: "test-index",
  });

  const querySpy = vi.fn().mockResolvedValue({ matches: [] });
  (engine as any).pinecone = {
    Index: vi.fn().mockReturnValue({
      query: querySpy,
      upsert: vi.fn(),
    }),
  };
  (engine as any).embed = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
  (engine as any).hydrateSources = vi.fn().mockResolvedValue([]);

  return { engine, querySpy };
}

describe("RAGEngine funnel stage filters", () => {
  it("uses funnel_stages metadata key for query()", async () => {
    const { engine, querySpy } = makeEngine();

    await engine.query({
      query: "What was the main blocker?",
      accountId: "acct-1",
      organizationId: "org-1",
      funnelStages: ["BOFU"],
    });

    expect(querySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({
          funnel_stages: { $in: ["BOFU"] },
        }),
      })
    );
  });

  it("uses funnel_stages metadata key for chat()", async () => {
    const { engine, querySpy } = makeEngine();

    await engine.chat({
      query: "Any risks called out?",
      accountId: null,
      organizationId: "org-1",
      history: [],
      funnelStages: ["POST_SALE"],
    });

    expect(querySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({
          funnel_stages: { $in: ["POST_SALE"] },
        }),
      })
    );
  });
});
