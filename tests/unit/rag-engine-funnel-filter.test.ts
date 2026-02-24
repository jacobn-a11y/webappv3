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

  it("caches repeated query requests by normalized key", async () => {
    const { engine, querySpy } = makeEngine();
    const embedSpy = (engine as any).embed as ReturnType<typeof vi.fn>;

    await engine.query({
      query: "  What was the main blocker?  ",
      accountId: "acct-1",
      organizationId: "org-1",
      funnelStages: ["BOFU"],
    });
    await engine.query({
      query: "what was the main blocker?",
      accountId: "acct-1",
      organizationId: "org-1",
      funnelStages: ["BOFU"],
    });

    expect(embedSpy).toHaveBeenCalledTimes(1);
    expect(querySpy).toHaveBeenCalledTimes(1);
  });

  it("hydrates source chunks in a single batched DB call", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "chunk_1",
        text: "first",
        speaker: "Alice",
        transcript: {
          call: {
            id: "call_1",
            title: "Kickoff",
            occurredAt: new Date("2026-02-20T10:00:00.000Z"),
          },
        },
      },
      {
        id: "chunk_2",
        text: "second",
        speaker: "Bob",
        transcript: {
          call: {
            id: "call_2",
            title: "Follow Up",
            occurredAt: new Date("2026-02-21T10:00:00.000Z"),
          },
        },
      },
    ]);

    const prisma = { transcriptChunk: { findMany } } as any;
    const engine = new RAGEngine(prisma, {
      openaiApiKey: "test-openai-key",
      pineconeApiKey: "test-pinecone-key",
      pineconeIndex: "test-index",
    });

    const sources = await (engine as any).hydrateSources([
      { id: "m1", score: 0.9, metadata: { chunk_id: "chunk_2" } },
      { id: "m2", score: 0.8, metadata: { chunk_id: "chunk_1" } },
    ]);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(sources).toHaveLength(2);
    // preserves match order
    expect(sources[0].chunkId).toBe("chunk_2");
    expect(sources[1].chunkId).toBe("chunk_1");
  });

  it("prunes old vectors and clears embedding references", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "chunk_1", embeddingId: "vec_1" },
      { id: "chunk_2", embeddingId: "vec_2" },
    ]);
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const deleteMany = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      transcriptChunk: {
        findMany,
        updateMany,
      },
    } as any;

    const engine = new RAGEngine(prisma, {
      openaiApiKey: "test-openai-key",
      pineconeApiKey: "test-pinecone-key",
      pineconeIndex: "test-index",
    });

    (engine as any).pinecone = {
      Index: vi.fn().mockReturnValue({
        deleteMany,
      }),
    };

    const count = await engine.pruneVectors({
      organizationId: "org-1",
      olderThan: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(count).toBe(2);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith(["vec_1", "vec_2"]);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["chunk_1", "chunk_2"] } },
      })
    );
  });
});
