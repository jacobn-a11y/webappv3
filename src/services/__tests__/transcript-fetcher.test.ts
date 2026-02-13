import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TranscriptFetcher,
  TranscriptFetchError,
  getProviderPollingConfig,
  transcriptFetchBackoffStrategy,
  type TranscriptFetchJob,
} from "../transcript-fetcher.js";

// ─── Mocks ───────────────────────────────────────────────────────────────────

function createMockPrisma() {
  return {
    transcript: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  } as unknown as Parameters<
    ConstructorParameters<typeof TranscriptFetcher>[0]["prisma"] extends infer P
      ? () => P
      : never
  > extends never
    ? ReturnType<never>
    : any;
}

function createMockQueue() {
  return {
    add: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function createBaseJob(overrides: Partial<TranscriptFetchJob> = {}): TranscriptFetchJob {
  return {
    callId: "call-123",
    organizationId: "org-456",
    accountId: "acct-789",
    mergeRecordingId: "merge-rec-001",
    linkedAccountId: "linked-acct-001",
    provider: "GONG",
    ...overrides,
  };
}

// ─── Provider Polling Config ─────────────────────────────────────────────────

describe("getProviderPollingConfig", () => {
  it("returns Gong-specific config", () => {
    const config = getProviderPollingConfig("GONG");
    expect(config.initialDelayMs).toBe(30_000);
    expect(config.maxAttempts).toBe(10);
  });

  it("returns Chorus-specific config", () => {
    const config = getProviderPollingConfig("CHORUS");
    expect(config.initialDelayMs).toBe(20_000);
    expect(config.maxAttempts).toBe(10);
  });

  it("returns default config for unknown providers", () => {
    const config = getProviderPollingConfig("ZOOM");
    expect(config.initialDelayMs).toBe(10_000);
    expect(config.maxAttempts).toBe(8);
  });

  it("returns default config for OTHER provider", () => {
    const config = getProviderPollingConfig("OTHER");
    expect(config.initialDelayMs).toBe(10_000);
    expect(config.maxAttempts).toBe(8);
  });
});

// ─── Custom Backoff Strategy ─────────────────────────────────────────────────

describe("transcriptFetchBackoffStrategy", () => {
  it("uses provider-specific initial delay on first retry", () => {
    const job = { data: createBaseJob({ provider: "GONG" }) };
    const delay = transcriptFetchBackoffStrategy(1, "custom", new Error(), job);
    expect(delay).toBe(30_000);
  });

  it("doubles delay on each subsequent retry", () => {
    const job = { data: createBaseJob({ provider: "GONG" }) };
    const delay1 = transcriptFetchBackoffStrategy(1, "custom", new Error(), job);
    const delay2 = transcriptFetchBackoffStrategy(2, "custom", new Error(), job);
    const delay3 = transcriptFetchBackoffStrategy(3, "custom", new Error(), job);

    expect(delay1).toBe(30_000);
    expect(delay2).toBe(60_000);
    expect(delay3).toBe(120_000);
  });

  it("caps delay at maxDelayMs", () => {
    const job = { data: createBaseJob({ provider: "GONG" }) };
    // 30_000 * 2^9 = 15_360_000 — should be capped at 300_000
    const delay = transcriptFetchBackoffStrategy(10, "custom", new Error(), job);
    expect(delay).toBe(300_000);
  });

  it("uses default config for unknown providers", () => {
    const job = { data: createBaseJob({ provider: "ZOOM" }) };
    const delay = transcriptFetchBackoffStrategy(1, "custom", new Error(), job);
    expect(delay).toBe(10_000);
  });
});

// ─── TranscriptFetchError ────────────────────────────────────────────────────

describe("TranscriptFetchError", () => {
  it("defaults to retryable", () => {
    const err = new TranscriptFetchError("test");
    expect(err.retryable).toBe(true);
    expect(err.name).toBe("TranscriptFetchError");
  });

  it("can be marked non-retryable", () => {
    const err = new TranscriptFetchError("not found", false);
    expect(err.retryable).toBe(false);
  });
});

// ─── TranscriptFetcher Service ───────────────────────────────────────────────

describe("TranscriptFetcher", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let processingQueue: ReturnType<typeof createMockQueue>;
  let fetcher: TranscriptFetcher;

  beforeEach(() => {
    prisma = createMockPrisma();
    processingQueue = createMockQueue();
    fetcher = new TranscriptFetcher({
      prisma,
      processingQueue,
      mergeApiKey: "test-api-key",
      mergeApiBase: "https://api.merge.dev/api/filestorage/v1",
    });
    vi.restoreAllMocks();
  });

  describe("fetchTranscript", () => {
    it("skips fetch and re-queues if transcript already exists", async () => {
      prisma.transcript.findUnique.mockResolvedValue({
        id: "t-1",
        callId: "call-123",
        fullText: "existing transcript",
      });

      await fetcher.fetchTranscript(createBaseJob());

      // Should not call create
      expect(prisma.transcript.create).not.toHaveBeenCalled();
      // Should re-queue for processing
      expect(processingQueue.add).toHaveBeenCalledWith(
        "process-call",
        expect.objectContaining({
          callId: "call-123",
          hasTranscript: true,
        }),
        expect.any(Object)
      );
    });

    it("fetches transcript from Merge.dev and stores it", async () => {
      prisma.transcript.findUnique.mockResolvedValue(null);
      prisma.transcript.create.mockResolvedValue({ id: "t-new" });

      const transcriptText = "Hello this is a test transcript from the call.";

      // Mock the global fetch
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "merge-rec-001", transcript: transcriptText }),
        })
      );

      await fetcher.fetchTranscript(createBaseJob());

      // Should store transcript
      expect(prisma.transcript.create).toHaveBeenCalledWith({
        data: {
          callId: "call-123",
          fullText: transcriptText,
          wordCount: transcriptText.split(/\s+/).length,
        },
      });

      // Should re-queue for processing
      expect(processingQueue.add).toHaveBeenCalledWith(
        "process-call",
        expect.objectContaining({
          callId: "call-123",
          organizationId: "org-456",
          accountId: "acct-789",
          hasTranscript: true,
        }),
        expect.objectContaining({
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
        })
      );
    });

    it("throws retryable error when transcript not yet available", async () => {
      prisma.transcript.findUnique.mockResolvedValue(null);

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "merge-rec-001", transcript: undefined }),
        })
      );

      await expect(fetcher.fetchTranscript(createBaseJob())).rejects.toThrow(
        TranscriptFetchError
      );

      try {
        await fetcher.fetchTranscript(createBaseJob());
      } catch (err) {
        expect(err).toBeInstanceOf(TranscriptFetchError);
        expect((err as TranscriptFetchError).retryable).toBe(true);
      }

      // Should not store or re-queue
      expect(prisma.transcript.create).not.toHaveBeenCalled();
      expect(processingQueue.add).not.toHaveBeenCalled();
    });

    it("throws non-retryable error on 404", async () => {
      prisma.transcript.findUnique.mockResolvedValue(null);

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          statusText: "Not Found",
        })
      );

      try {
        await fetcher.fetchTranscript(createBaseJob());
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TranscriptFetchError);
        expect((err as TranscriptFetchError).retryable).toBe(false);
        expect((err as TranscriptFetchError).message).toContain("not found");
      }
    });

    it("throws retryable error on 429 rate limit", async () => {
      prisma.transcript.findUnique.mockResolvedValue(null);

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
        })
      );

      try {
        await fetcher.fetchTranscript(createBaseJob());
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TranscriptFetchError);
        expect((err as TranscriptFetchError).retryable).toBe(true);
      }
    });

    it("throws retryable error on 500 server error", async () => {
      prisma.transcript.findUnique.mockResolvedValue(null);

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
        })
      );

      try {
        await fetcher.fetchTranscript(createBaseJob());
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TranscriptFetchError);
        expect((err as TranscriptFetchError).retryable).toBe(true);
      }
    });

    it("throws non-retryable error on 400 client error", async () => {
      prisma.transcript.findUnique.mockResolvedValue(null);

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          statusText: "Bad Request",
        })
      );

      try {
        await fetcher.fetchTranscript(createBaseJob());
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TranscriptFetchError);
        expect((err as TranscriptFetchError).retryable).toBe(false);
      }
    });

    it("sends correct headers to Merge.dev API", async () => {
      prisma.transcript.findUnique.mockResolvedValue(null);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: "merge-rec-001", transcript: "text" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      prisma.transcript.create.mockResolvedValue({ id: "t-1" });

      await fetcher.fetchTranscript(createBaseJob());

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.merge.dev/api/filestorage/v1/recordings/merge-rec-001",
        {
          method: "GET",
          headers: {
            Authorization: "Bearer test-api-key",
            "X-Account-Token": "linked-acct-001",
            "Content-Type": "application/json",
          },
        }
      );
    });

    it("handles null accountId in re-queued processing job", async () => {
      prisma.transcript.findUnique.mockResolvedValue(null);
      prisma.transcript.create.mockResolvedValue({ id: "t-1" });

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "merge-rec-001", transcript: "text" }),
        })
      );

      await fetcher.fetchTranscript(createBaseJob({ accountId: null }));

      expect(processingQueue.add).toHaveBeenCalledWith(
        "process-call",
        expect.objectContaining({ accountId: null }),
        expect.any(Object)
      );
    });
  });
});
