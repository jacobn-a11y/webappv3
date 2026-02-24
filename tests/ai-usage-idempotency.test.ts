import { describe, expect, it, vi } from "vitest";
import { TrackedAIClient } from "../src/services/ai-usage-tracker.js";
import type { AIClient } from "../src/services/ai-client.js";

describe("TrackedAIClient idempotency", () => {
  it("does not double record usage/cost for duplicate idempotency keys", async () => {
    const inner: AIClient = {
      providerName: "openai",
      modelName: "gpt-4o",
      chatCompletion: vi.fn().mockResolvedValue({
        content: "ok",
        inputTokens: 100,
        outputTokens: 40,
        totalTokens: 140,
      }),
    };

    const tracker = {
      enforceLimit: vi.fn().mockResolvedValue(undefined),
      enforceBalance: vi.fn().mockResolvedValue(undefined),
      computeCost: vi.fn().mockResolvedValue(12),
      recordUsage: vi.fn().mockResolvedValue(undefined),
      deductBalance: vi.fn().mockResolvedValue(undefined),
      checkAndNotify: vi.fn().mockResolvedValue(undefined),
      checkSpendAnomalies: vi.fn().mockResolvedValue(undefined),
      hasRecordedUsageCharge: vi
        .fn()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true),
      markUsageChargeRecorded: vi.fn(),
    } as any;

    const tracked = new TrackedAIClient(
      inner,
      tracker,
      {
        organizationId: "org_1",
        userId: "user_1",
        operation: "STORY_GENERATION",
      },
      true
    );

    await tracked.chatCompletion({
      messages: [{ role: "user", content: "first" }],
      idempotencyKey: "story-req-1:narrative",
    });
    await tracked.chatCompletion({
      messages: [{ role: "user", content: "second" }],
      idempotencyKey: "story-req-1:narrative",
    });

    expect(inner.chatCompletion).toHaveBeenCalledTimes(2);
    expect(tracker.recordUsage).toHaveBeenCalledTimes(1);
    expect(tracker.deductBalance).toHaveBeenCalledTimes(1);
    expect(tracker.markUsageChargeRecorded).toHaveBeenCalledTimes(1);
  });
});
