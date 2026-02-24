import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  PROCESS_CALL_JOB_DEFAULT_OPTIONS,
  buildProcessCallJobOptions,
  enqueueProcessCallJob,
} from "../src/lib/queue-policy.js";
import { metrics } from "../src/lib/metrics.js";

describe("queue-policy", () => {
  beforeEach(() => {
    metrics.resetForTesting();
  });

  it("builds default process-call options", () => {
    expect(buildProcessCallJobOptions()).toEqual(
      PROCESS_CALL_JOB_DEFAULT_OPTIONS
    );
  });

  it("includes explicit job id when provided", () => {
    expect(
      buildProcessCallJobOptions({ jobId: "process-call:abc123" })
    ).toEqual({
      ...PROCESS_CALL_JOB_DEFAULT_OPTIONS,
      jobId: "process-call:abc123",
    });
  });

  it("retries enqueue after transient failures", async () => {
    const add = vi
      .fn()
      .mockRejectedValueOnce(new Error("redis timeout"))
      .mockRejectedValueOnce(new Error("redis timeout"))
      .mockResolvedValueOnce({});

    await enqueueProcessCallJob({
      queue: { add },
      source: "unit-test",
      enqueueAttempts: 3,
      enqueueBaseDelayMs: 1,
      payload: {
        callId: "call_1",
        organizationId: "org_1",
        accountId: null,
        hasTranscript: true,
      },
    });

    expect(add).toHaveBeenCalledTimes(3);
    expect(add).toHaveBeenLastCalledWith(
      "process-call",
      {
        callId: "call_1",
        organizationId: "org_1",
        accountId: null,
        hasTranscript: true,
      },
      PROCESS_CALL_JOB_DEFAULT_OPTIONS
    );
  });

  it("throws after retries are exhausted", async () => {
    const add = vi.fn().mockRejectedValue(new Error("redis down"));

    await expect(
      enqueueProcessCallJob({
        queue: { add },
        source: "unit-test",
        enqueueAttempts: 2,
        enqueueBaseDelayMs: 1,
        payload: {
          callId: "call_2",
          organizationId: "org_1",
          accountId: null,
          hasTranscript: true,
        },
      })
    ).rejects.toThrow("redis down");

    expect(add).toHaveBeenCalledTimes(2);
  });

  it("records enqueue failure diagnostics in metrics snapshot", async () => {
    const add = vi.fn().mockRejectedValue(new Error("redis down"));

    await expect(
      enqueueProcessCallJob({
        queue: { add },
        source: "webhook:gong",
        enqueueAttempts: 2,
        enqueueBaseDelayMs: 1,
        payload: {
          callId: "call_metrics_1",
          organizationId: "org_1",
          accountId: null,
          hasTranscript: true,
        },
      })
    ).rejects.toThrow("redis down");

    const snapshot = metrics.getSnapshot();
    expect(snapshot.queue_observability.process_call_enqueue.failures).toBe(1);
    expect(
      snapshot.queue_observability.process_call_enqueue.failures_by_source[
        "webhook:gong"
      ]
    ).toBe(1);
    expect(
      snapshot.queue_observability.process_call_enqueue.recent_failures[0]
        ?.callId
    ).toBe("call_metrics_1");
  });
});
