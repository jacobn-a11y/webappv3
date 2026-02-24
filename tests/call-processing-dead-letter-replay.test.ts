import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  classifyCallProcessingFailure,
  replayRetryableDeadLetterJobs,
} from "../src/services/call-processing-dead-letter-replay.js";

describe("call-processing-dead-letter-replay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("classifies retryable and non-retryable failures", () => {
    expect(
      classifyCallProcessingFailure("429 Too Many Requests from provider")
    ).toEqual({
      className: "rate_limit",
      retryable: true,
    });

    expect(
      classifyCallProcessingFailure("Validation failed: missing transcript body")
    ).toEqual({
      className: "non_retryable",
      retryable: false,
    });
  });

  it("replays only retryable failed jobs for the requested org", async () => {
    const retryableRetry = vi.fn().mockResolvedValue(undefined);
    const nonRetryableRetry = vi.fn().mockResolvedValue(undefined);
    const otherOrgRetry = vi.fn().mockResolvedValue(undefined);

    const processingQueue = {
      getJobs: vi.fn().mockResolvedValue([
        {
          id: "job-retryable",
          data: {
            callId: "call_1",
            organizationId: "org_1",
            accountId: null,
            hasTranscript: true,
          },
          failedReason: "503 upstream unavailable",
          retry: retryableRetry,
        },
        {
          id: "job-non-retryable",
          data: {
            callId: "call_2",
            organizationId: "org_1",
            accountId: null,
            hasTranscript: true,
          },
          failedReason: "validation failed: account missing",
          retry: nonRetryableRetry,
        },
        {
          id: "job-other-org",
          data: {
            callId: "call_3",
            organizationId: "org_2",
            accountId: null,
            hasTranscript: true,
          },
          failedReason: "redis timeout",
          retry: otherOrgRetry,
        },
      ]),
    } as any;

    const summary = await replayRetryableDeadLetterJobs({
      processingQueue,
      organizationId: "org_1",
      trigger: "manual",
    });

    expect(summary.replayed).toBe(1);
    expect(summary.replayed_calls).toEqual(["call_1"]);
    expect(summary.skipped.non_retryable).toBe(1);
    expect(summary.skipped.different_organization).toBe(1);
    expect(retryableRetry).toHaveBeenCalledTimes(1);
    expect(nonRetryableRetry).not.toHaveBeenCalled();
    expect(otherOrgRetry).not.toHaveBeenCalled();
  });

  it("is idempotent across runs when failed jobs are already retried", async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    const processingQueue = {
      getJobs: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: "job-1",
            data: {
              callId: "call_1",
              organizationId: "org_1",
              accountId: null,
              hasTranscript: true,
            },
            failedReason: "redis timeout",
            retry,
          },
        ])
        .mockResolvedValueOnce([]),
    } as any;

    const first = await replayRetryableDeadLetterJobs({
      processingQueue,
      organizationId: "org_1",
      trigger: "manual",
    });
    const second = await replayRetryableDeadLetterJobs({
      processingQueue,
      organizationId: "org_1",
      trigger: "manual",
    });

    expect(first.replayed).toBe(1);
    expect(second.replayed).toBe(0);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
