import { describe, expect, it, vi } from "vitest";
import type {
  AIClient,
  ChatCompletionOptions,
  ChatCompletionResult,
} from "../src/services/ai-client.js";
import { FailoverAIClient } from "../src/services/ai-resilience.js";

function makeClient(
  providerName: string,
  modelName: string,
  handler: (options: ChatCompletionOptions) => Promise<ChatCompletionResult>
): AIClient {
  return {
    providerName,
    modelName,
    chatCompletion: handler,
  };
}

describe("FailoverAIClient", () => {
  it("falls back to secondary provider on transient primary failure", async () => {
    const primary = makeClient(
      "openai",
      "gpt-4o",
      vi.fn().mockRejectedValue(new Error("503 service unavailable"))
    );
    const fallback = makeClient(
      "anthropic",
      "claude-sonnet-4-20250514",
      vi.fn().mockResolvedValue({
        content: "ok from fallback",
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      })
    );

    const resilient = new FailoverAIClient(primary, fallback, {
      failureThreshold: 2,
      cooldownMs: 10_000,
      maxAttempts: 1,
    });

    const result = await resilient.chatCompletion({
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.content).toBe("ok from fallback");
    expect(primary.chatCompletion).toHaveBeenCalledTimes(1);
    expect(fallback.chatCompletion).toHaveBeenCalledTimes(1);
  });

  it("opens circuit after repeated failures and skips primary during cooldown", async () => {
    const primary = makeClient(
      "openai",
      "gpt-4o",
      vi.fn().mockRejectedValue(new Error("timeout"))
    );
    const fallback = makeClient(
      "google",
      "gemini-2.0-flash",
      vi.fn().mockResolvedValue({
        content: "fallback path",
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
      })
    );

    const resilient = new FailoverAIClient(primary, fallback, {
      failureThreshold: 1,
      cooldownMs: 60_000,
      maxAttempts: 1,
      circuitKey: `test-circuit-${Date.now()}`,
    });

    await resilient.chatCompletion({
      messages: [{ role: "user", content: "first" }],
    });
    await resilient.chatCompletion({
      messages: [{ role: "user", content: "second" }],
    });

    expect(primary.chatCompletion).toHaveBeenCalledTimes(1);
    expect(fallback.chatCompletion).toHaveBeenCalledTimes(2);
  });

  it("honors retry budget when no fallback provider exists", async () => {
    const primary = makeClient(
      "openai",
      "gpt-4o",
      vi.fn().mockRejectedValue(new Error("timeout"))
    );
    const resilient = new FailoverAIClient(primary, null, {
      failureThreshold: 10,
      cooldownMs: 60_000,
      maxAttempts: 3,
      circuitKey: `test-budget-${Date.now()}`,
    });

    await expect(
      resilient.chatCompletion({
        messages: [{ role: "user", content: "retry me" }],
      })
    ).rejects.toThrow("timeout");

    expect(primary.chatCompletion).toHaveBeenCalledTimes(3);
  });
});
