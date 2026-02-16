import { describe, it, expect, vi, beforeEach } from "vitest";
import { TranscriptMerger, DEFAULT_TRANSCRIPT_MERGE_MAX_WORDS, DEFAULT_TRUNCATION_MODE } from "./transcript-merger.js";

// ─── Mock Prisma ─────────────────────────────────────────────────────────────

function createMockPrisma() {
  return {
    orgSettings: {
      findUnique: vi.fn(),
    },
    call: {
      findMany: vi.fn(),
    },
  } as unknown as Parameters<typeof TranscriptMerger.prototype.mergeTranscripts extends (...args: infer A) => unknown ? never : never> & ReturnType<typeof createMockPrisma>;
}

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeCall(overrides: {
  id?: string;
  title?: string;
  occurredAt?: Date;
  duration?: number | null;
  fullText?: string;
  wordCount?: number;
  participants?: Array<{ name: string | null; email: string | null; isHost: boolean }>;
}) {
  const fullText = overrides.fullText ?? "This is a sample transcript with some words in it.";
  return {
    id: overrides.id ?? "call-1",
    title: overrides.title ?? "Demo Call",
    occurredAt: overrides.occurredAt ?? new Date("2025-06-15"),
    duration: "duration" in overrides ? overrides.duration : 1800,
    transcript: {
      fullText,
      wordCount: overrides.wordCount ?? fullText.split(/\s+/).length,
    },
    participants: overrides.participants ?? [
      { name: "Alice", email: "alice@example.com", isHost: true },
      { name: "Bob", email: "bob@client.com", isHost: false },
    ],
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("TranscriptMerger", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let merger: TranscriptMerger;

  beforeEach(() => {
    prisma = createMockPrisma();
    merger = new TranscriptMerger(prisma as any);
  });

  // ── Defaults ────────────────────────────────────────────────────────

  describe("default constants", () => {
    it("should have a default max words of 600,000", () => {
      expect(DEFAULT_TRANSCRIPT_MERGE_MAX_WORDS).toBe(600_000);
    });

    it("should default to OLDEST_FIRST truncation", () => {
      expect(DEFAULT_TRUNCATION_MODE).toBe("OLDEST_FIRST");
    });
  });

  // ── Empty results ──────────────────────────────────────────────────

  describe("when no transcripts exist", () => {
    it("should return empty result with zero counts", async () => {
      prisma.orgSettings.findUnique.mockResolvedValue(null);
      prisma.call.findMany.mockResolvedValue([]);

      const result = await merger.mergeTranscripts({
        accountId: "acct-1",
        organizationId: "org-1",
      });

      expect(result.markdown).toBe("");
      expect(result.wordCount).toBe(0);
      expect(result.totalCalls).toBe(0);
      expect(result.includedCalls).toBe(0);
      expect(result.truncated).toBe(false);
      expect(result.truncationBoundary).toBeNull();
    });
  });

  // ── Single call ────────────────────────────────────────────────────

  describe("when a single call exists", () => {
    it("should merge into markdown with call header and transcript body", async () => {
      prisma.orgSettings.findUnique.mockResolvedValue(null);
      prisma.call.findMany.mockResolvedValue([
        makeCall({
          id: "call-1",
          title: "Kickoff Meeting",
          occurredAt: new Date("2025-01-10"),
          duration: 3600,
          fullText: "We discussed the project timeline and milestones.",
        }),
      ]);

      const result = await merger.mergeTranscripts({
        accountId: "acct-1",
        organizationId: "org-1",
      });

      expect(result.totalCalls).toBe(1);
      expect(result.includedCalls).toBe(1);
      expect(result.truncated).toBe(false);
      expect(result.markdown).toContain("# Merged Transcripts (1 calls");
      expect(result.markdown).toContain("## Kickoff Meeting — 2025-01-10 (60 min)");
      expect(result.markdown).toContain("We discussed the project timeline and milestones.");
      expect(result.markdown).toContain("**Alice** (host)");
      expect(result.markdown).toContain("Bob");
      expect(result.wordCount).toBeGreaterThan(0);
    });

    it("should use 'Untitled Call' when title is null", async () => {
      prisma.orgSettings.findUnique.mockResolvedValue(null);
      prisma.call.findMany.mockResolvedValue([
        makeCall({ title: undefined }),
      ]);
      // Override the title to null in the mock
      (prisma.call.findMany as any).mockResolvedValue([
        { ...makeCall({}), title: null },
      ]);

      const result = await merger.mergeTranscripts({
        accountId: "acct-1",
        organizationId: "org-1",
      });

      expect(result.markdown).toContain("## Untitled Call");
    });

    it("should omit duration when null", async () => {
      prisma.orgSettings.findUnique.mockResolvedValue(null);
      prisma.call.findMany.mockResolvedValue([
        makeCall({ duration: null }),
      ]);

      const result = await merger.mergeTranscripts({
        accountId: "acct-1",
        organizationId: "org-1",
      });

      expect(result.markdown).not.toContain("min)");
    });
  });

  // ── Multiple calls (chronological ordering) ───────────────────────

  describe("when multiple calls exist", () => {
    it("should include all calls in chronological order", async () => {
      prisma.orgSettings.findUnique.mockResolvedValue(null);
      prisma.call.findMany.mockResolvedValue([
        makeCall({
          id: "call-1",
          title: "First Call",
          occurredAt: new Date("2025-01-01"),
          fullText: "First call transcript.",
        }),
        makeCall({
          id: "call-2",
          title: "Second Call",
          occurredAt: new Date("2025-02-01"),
          fullText: "Second call transcript.",
        }),
        makeCall({
          id: "call-3",
          title: "Third Call",
          occurredAt: new Date("2025-03-01"),
          fullText: "Third call transcript.",
        }),
      ]);

      const result = await merger.mergeTranscripts({
        accountId: "acct-1",
        organizationId: "org-1",
      });

      expect(result.totalCalls).toBe(3);
      expect(result.includedCalls).toBe(3);
      expect(result.truncated).toBe(false);
      expect(result.markdown).toContain("3 calls, 2025-01-01 to 2025-03-01");

      // Verify order: First before Second before Third
      const firstIdx = result.markdown.indexOf("First Call");
      const secondIdx = result.markdown.indexOf("Second Call");
      const thirdIdx = result.markdown.indexOf("Third Call");
      expect(firstIdx).toBeLessThan(secondIdx);
      expect(secondIdx).toBeLessThan(thirdIdx);
    });
  });

  // ── Truncation (OLDEST_FIRST) ─────────────────────────────────────

  describe("truncation with OLDEST_FIRST", () => {
    it("should drop oldest calls first when over word limit", async () => {
      prisma.orgSettings.findUnique.mockResolvedValue(null);

      // Each call has ~100 words. With header overhead (30), each is ~130.
      // 3 calls = ~390 words total. Set limit to 200.
      const longText = Array(100).fill("word").join(" ");
      prisma.call.findMany.mockResolvedValue([
        makeCall({
          id: "call-1",
          title: "Old Call",
          occurredAt: new Date("2025-01-01"),
          fullText: longText,
          wordCount: 100,
        }),
        makeCall({
          id: "call-2",
          title: "Middle Call",
          occurredAt: new Date("2025-06-01"),
          fullText: longText,
          wordCount: 100,
        }),
        makeCall({
          id: "call-3",
          title: "Recent Call",
          occurredAt: new Date("2025-12-01"),
          fullText: longText,
          wordCount: 100,
        }),
      ]);

      const result = await merger.mergeTranscripts({
        accountId: "acct-1",
        organizationId: "org-1",
        maxWords: 200,
        truncationMode: "OLDEST_FIRST",
      });

      expect(result.truncated).toBe(true);
      expect(result.totalCalls).toBe(3);
      // Should have dropped oldest call(s)
      expect(result.includedCalls).toBeLessThan(3);
      // The newest call should always be included
      expect(result.markdown).toContain("Recent Call");
      // Truncation boundary should be set
      expect(result.truncationBoundary).not.toBeNull();
    });

    it("should always keep at least one call even if over limit", async () => {
      prisma.orgSettings.findUnique.mockResolvedValue(null);

      const longText = Array(500).fill("word").join(" ");
      prisma.call.findMany.mockResolvedValue([
        makeCall({
          id: "call-1",
          title: "Massive Call",
          occurredAt: new Date("2025-01-01"),
          fullText: longText,
          wordCount: 500,
        }),
      ]);

      const result = await merger.mergeTranscripts({
        accountId: "acct-1",
        organizationId: "org-1",
        maxWords: 10, // Way below single call's word count
      });

      // Should still include the single call (never drop all)
      expect(result.includedCalls).toBe(1);
      // truncated=true because total words exceed limit, even though no calls could be dropped
      expect(result.truncated).toBe(true);
    });
  });

  // ── Truncation (NEWEST_FIRST) ─────────────────────────────────────

  describe("truncation with NEWEST_FIRST", () => {
    it("should drop newest calls first when over word limit", async () => {
      prisma.orgSettings.findUnique.mockResolvedValue(null);

      const longText = Array(100).fill("word").join(" ");
      prisma.call.findMany.mockResolvedValue([
        makeCall({
          id: "call-1",
          title: "Old Call",
          occurredAt: new Date("2025-01-01"),
          fullText: longText,
          wordCount: 100,
        }),
        makeCall({
          id: "call-2",
          title: "Middle Call",
          occurredAt: new Date("2025-06-01"),
          fullText: longText,
          wordCount: 100,
        }),
        makeCall({
          id: "call-3",
          title: "Recent Call",
          occurredAt: new Date("2025-12-01"),
          fullText: longText,
          wordCount: 100,
        }),
      ]);

      const result = await merger.mergeTranscripts({
        accountId: "acct-1",
        organizationId: "org-1",
        maxWords: 200,
        truncationMode: "NEWEST_FIRST",
      });

      expect(result.truncated).toBe(true);
      expect(result.totalCalls).toBe(3);
      expect(result.includedCalls).toBeLessThan(3);
      // The oldest call should always be included
      expect(result.markdown).toContain("Old Call");
      expect(result.truncationBoundary).not.toBeNull();
    });
  });

  // ── Org settings integration ──────────────────────────────────────

  describe("org settings integration", () => {
    it("should use org settings for maxWords when not overridden", async () => {
      prisma.orgSettings.findUnique.mockResolvedValue({
        transcriptMergeMaxWords: 50,
        transcriptTruncationMode: "NEWEST_FIRST",
      });

      const longText = Array(100).fill("word").join(" ");
      prisma.call.findMany.mockResolvedValue([
        makeCall({
          id: "call-1",
          title: "Call A",
          occurredAt: new Date("2025-01-01"),
          fullText: longText,
          wordCount: 100,
        }),
        makeCall({
          id: "call-2",
          title: "Call B",
          occurredAt: new Date("2025-06-01"),
          fullText: longText,
          wordCount: 100,
        }),
      ]);

      const result = await merger.mergeTranscripts({
        accountId: "acct-1",
        organizationId: "org-1",
      });

      // Should use org settings truncation mode (NEWEST_FIRST)
      expect(result.truncationMode).toBe("NEWEST_FIRST");
      // Should be truncated because org settings maxWords is 50
      expect(result.truncated).toBe(true);
      // NEWEST_FIRST: oldest call should be kept
      expect(result.markdown).toContain("Call A");
    });

    it("should override org settings when explicit options are provided", async () => {
      prisma.orgSettings.findUnique.mockResolvedValue({
        transcriptMergeMaxWords: 50,
        transcriptTruncationMode: "NEWEST_FIRST",
      });

      prisma.call.findMany.mockResolvedValue([
        makeCall({
          id: "call-1",
          fullText: "Short text.",
          wordCount: 2,
        }),
      ]);

      const result = await merger.mergeTranscripts({
        accountId: "acct-1",
        organizationId: "org-1",
        maxWords: 1_000_000,
        truncationMode: "OLDEST_FIRST",
      });

      expect(result.truncationMode).toBe("OLDEST_FIRST");
      expect(result.truncated).toBe(false);
    });

    it("should fall back to defaults when no org settings exist", async () => {
      prisma.orgSettings.findUnique.mockResolvedValue(null);
      prisma.call.findMany.mockResolvedValue([
        makeCall({ fullText: "Hello world.", wordCount: 2 }),
      ]);

      const result = await merger.mergeTranscripts({
        accountId: "acct-1",
        organizationId: "org-1",
      });

      // Should use DEFAULT_TRUNCATION_MODE
      expect(result.truncationMode).toBe("OLDEST_FIRST");
      // Should not be truncated (2 words < 600,000)
      expect(result.truncated).toBe(false);
    });
  });

  // ── Markdown output format ────────────────────────────────────────

  describe("markdown output format", () => {
    it("should include document title with call count and date range", async () => {
      prisma.orgSettings.findUnique.mockResolvedValue(null);
      prisma.call.findMany.mockResolvedValue([
        makeCall({
          occurredAt: new Date("2025-03-01"),
          title: "Call A",
        }),
        makeCall({
          id: "call-2",
          occurredAt: new Date("2025-09-15"),
          title: "Call B",
        }),
      ]);

      const result = await merger.mergeTranscripts({
        accountId: "acct-1",
        organizationId: "org-1",
      });

      expect(result.markdown).toContain("# Merged Transcripts (2 calls, 2025-03-01 to 2025-09-15)");
    });

    it("should include participant list with host bolded", async () => {
      prisma.orgSettings.findUnique.mockResolvedValue(null);
      prisma.call.findMany.mockResolvedValue([
        makeCall({
          participants: [
            { name: "Jane Doe", email: "jane@host.com", isHost: true },
            { name: null, email: "guest@client.com", isHost: false },
          ],
        }),
      ]);

      const result = await merger.mergeTranscripts({
        accountId: "acct-1",
        organizationId: "org-1",
      });

      expect(result.markdown).toContain("**Jane Doe** (host)");
      expect(result.markdown).toContain("guest@client.com");
    });

    it("should use 'Unknown' for participants without name or email", async () => {
      prisma.orgSettings.findUnique.mockResolvedValue(null);
      prisma.call.findMany.mockResolvedValue([
        makeCall({
          participants: [
            { name: null, email: null, isHost: false },
          ],
        }),
      ]);

      const result = await merger.mergeTranscripts({
        accountId: "acct-1",
        organizationId: "org-1",
      });

      expect(result.markdown).toContain("Unknown");
    });

    it("should include horizontal rules between calls", async () => {
      prisma.orgSettings.findUnique.mockResolvedValue(null);
      prisma.call.findMany.mockResolvedValue([
        makeCall({ id: "call-1", occurredAt: new Date("2025-01-01") }),
        makeCall({ id: "call-2", occurredAt: new Date("2025-02-01") }),
      ]);

      const result = await merger.mergeTranscripts({
        accountId: "acct-1",
        organizationId: "org-1",
      });

      expect(result.markdown).toContain("---");
    });
  });

  // ── Calls without transcripts ─────────────────────────────────────

  describe("calls without transcripts", () => {
    it("should filter out calls with null transcripts", async () => {
      prisma.orgSettings.findUnique.mockResolvedValue(null);
      prisma.call.findMany.mockResolvedValue([
        { ...makeCall({ id: "call-1", title: "Has Transcript" }), transcript: { fullText: "Content here.", wordCount: 2 } },
        { ...makeCall({ id: "call-2", title: "No Transcript" }), transcript: null },
      ]);

      const result = await merger.mergeTranscripts({
        accountId: "acct-1",
        organizationId: "org-1",
      });

      expect(result.totalCalls).toBe(1);
      expect(result.markdown).toContain("Has Transcript");
      expect(result.markdown).not.toContain("No Transcript");
    });
  });

  // ── Prisma query construction ─────────────────────────────────────

  describe("prisma query construction", () => {
    it("should pass accountId and organizationId to call query", async () => {
      prisma.orgSettings.findUnique.mockResolvedValue(null);
      prisma.call.findMany.mockResolvedValue([]);

      await merger.mergeTranscripts({
        accountId: "acct-123",
        organizationId: "org-456",
      });

      expect(prisma.call.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            accountId: "acct-123",
            organizationId: "org-456",
          }),
        })
      );
    });

    it("should include date filter when afterDate is provided", async () => {
      prisma.orgSettings.findUnique.mockResolvedValue(null);
      prisma.call.findMany.mockResolvedValue([]);

      const afterDate = new Date("2025-06-01");
      await merger.mergeTranscripts({
        accountId: "acct-1",
        organizationId: "org-1",
        afterDate,
      });

      expect(prisma.call.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            occurredAt: expect.objectContaining({ gte: afterDate }),
          }),
        })
      );
    });

    it("should include date filter when beforeDate is provided", async () => {
      prisma.orgSettings.findUnique.mockResolvedValue(null);
      prisma.call.findMany.mockResolvedValue([]);

      const beforeDate = new Date("2025-12-31");
      await merger.mergeTranscripts({
        accountId: "acct-1",
        organizationId: "org-1",
        beforeDate,
      });

      expect(prisma.call.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            occurredAt: expect.objectContaining({ lte: beforeDate }),
          }),
        })
      );
    });

    it("should not include occurredAt filter when no dates are provided", async () => {
      prisma.orgSettings.findUnique.mockResolvedValue(null);
      prisma.call.findMany.mockResolvedValue([]);

      await merger.mergeTranscripts({
        accountId: "acct-1",
        organizationId: "org-1",
      });

      const calledWith = (prisma.call.findMany as any).mock.calls[0][0];
      expect(calledWith.where.occurredAt).toBeUndefined();
    });
  });
});
