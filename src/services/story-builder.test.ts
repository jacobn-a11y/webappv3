import { describe, it, expect, vi, beforeEach } from "vitest";
import { StoryBuilder } from "./story-builder.js";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockMergeTranscripts = vi.fn();

vi.mock("./transcript-merger.js", () => ({
  TranscriptMerger: class MockTranscriptMerger {
    mergeTranscripts = mockMergeTranscripts;
  },
}));

const mockChatCreate = vi.fn();

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: mockChatCreate,
      },
    };
  },
}));

function createMockPrisma() {
  return {
    account: {
      findUniqueOrThrow: vi.fn(),
    },
    call: {
      findMany: vi.fn(),
    },
    story: {
      create: vi.fn(),
    },
    highValueQuote: {
      create: vi.fn(),
    },
    orgSettings: {
      findUnique: vi.fn(),
    },
  };
}

describe("StoryBuilder", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let builder: StoryBuilder;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    builder = new StoryBuilder(prisma as any, "test-api-key", "gpt-4o");
  });

  describe("constructor", () => {
    it("should create a StoryBuilder instance", () => {
      expect(builder).toBeInstanceOf(StoryBuilder);
    });

    it("should accept a custom model parameter", () => {
      const customBuilder = new StoryBuilder(prisma as any, "key", "gpt-4-turbo");
      expect(customBuilder).toBeInstanceOf(StoryBuilder);
    });
  });

  describe("buildStory", () => {
    it("should return empty result when no transcripts are found", async () => {
      prisma.account.findUniqueOrThrow.mockResolvedValue({
        id: "acct-1",
        name: "TestCorp",
      });

      mockMergeTranscripts.mockResolvedValue({
        markdown: "",
        wordCount: 0,
        totalCalls: 0,
        includedCalls: 0,
        truncated: false,
        truncationBoundary: null,
        truncationMode: "OLDEST_FIRST",
      });

      prisma.call.findMany.mockResolvedValue([]);

      const result = await builder.buildStory({
        accountId: "acct-1",
        organizationId: "org-1",
      });

      expect(result.title).toBe("No Data Available");
      expect(result.markdownBody).toContain("No transcripts found");
      expect(result.quotes).toEqual([]);
    });

    it("should fetch account details by accountId", async () => {
      prisma.account.findUniqueOrThrow.mockResolvedValue({
        id: "acct-1",
        name: "TestCorp",
      });

      mockMergeTranscripts.mockResolvedValue({
        markdown: "",
        wordCount: 0,
        totalCalls: 0,
        includedCalls: 0,
        truncated: false,
        truncationBoundary: null,
        truncationMode: "OLDEST_FIRST",
      });

      prisma.call.findMany.mockResolvedValue([]);

      await builder.buildStory({
        accountId: "acct-1",
        organizationId: "org-1",
      });

      expect(prisma.account.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "acct-1" },
      });
    });

    it("should call mergeTranscripts with correct accountId and organizationId", async () => {
      prisma.account.findUniqueOrThrow.mockResolvedValue({
        id: "acct-1",
        name: "TestCorp",
      });

      mockMergeTranscripts.mockResolvedValue({
        markdown: "",
        wordCount: 0,
        totalCalls: 0,
        includedCalls: 0,
        truncated: false,
        truncationBoundary: null,
        truncationMode: "OLDEST_FIRST",
      });

      prisma.call.findMany.mockResolvedValue([]);

      await builder.buildStory({
        accountId: "acct-1",
        organizationId: "org-1",
      });

      expect(mockMergeTranscripts).toHaveBeenCalledWith({
        accountId: "acct-1",
        organizationId: "org-1",
      });
    });

    it("should generate narrative and persist story when transcripts exist", async () => {
      prisma.account.findUniqueOrThrow.mockResolvedValue({
        id: "acct-1",
        name: "TestCorp",
      });

      mockMergeTranscripts.mockResolvedValue({
        markdown: "# Merged\n\nTranscript content here.",
        wordCount: 4,
        totalCalls: 1,
        includedCalls: 1,
        truncated: false,
        truncationBoundary: null,
        truncationMode: "OLDEST_FIRST",
      });

      prisma.call.findMany.mockResolvedValue([
        {
          id: "call-1",
          title: "Demo",
          occurredAt: new Date("2025-06-15"),
          transcript: {
            chunks: [
              {
                text: "We closed the deal.",
                speaker: "Alice",
                tags: [
                  { funnelStage: "BOFU", topic: "roi_financial_outcomes", confidence: 0.9 },
                ],
              },
            ],
          },
        },
      ]);

      // Mock both LLM calls: narrative generation and quote extraction
      mockChatCreate
        .mockResolvedValueOnce({
          choices: [{ message: { content: "# TestCorp: Journey\n\n## Summary\n\nGreat story." } }],
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: '{ "quotes": [] }' } }],
        });

      prisma.story.create.mockResolvedValue({ id: "story-1" });

      const result = await builder.buildStory({
        accountId: "acct-1",
        organizationId: "org-1",
      });

      expect(result.markdownBody).toContain("TestCorp");
      expect(prisma.story.create).toHaveBeenCalled();
    });
  });

  describe("title generation", () => {
    it("should use custom title when provided", async () => {
      prisma.account.findUniqueOrThrow.mockResolvedValue({
        id: "acct-1",
        name: "TestCorp",
      });

      mockMergeTranscripts.mockResolvedValue({
        markdown: "",
        wordCount: 0,
        totalCalls: 0,
        includedCalls: 0,
        truncated: false,
        truncationBoundary: null,
        truncationMode: "OLDEST_FIRST",
      });

      prisma.call.findMany.mockResolvedValue([]);

      const result = await builder.buildStory({
        accountId: "acct-1",
        organizationId: "org-1",
        title: "My Custom Title",
      });

      expect(result.title).toBe("My Custom Title");
    });
  });
});
