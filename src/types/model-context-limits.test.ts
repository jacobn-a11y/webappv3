import { describe, it, expect } from "vitest";
import {
  MODEL_CONTEXT_LIMITS,
  getMaxRecommendedWords,
  type ModelContextLimit,
} from "./model-context-limits.js";

describe("MODEL_CONTEXT_LIMITS", () => {
  it("should contain exactly 10 models", () => {
    expect(MODEL_CONTEXT_LIMITS).toHaveLength(10);
  });

  it("should include models from all three providers", () => {
    const providers = new Set(MODEL_CONTEXT_LIMITS.map((m) => m.provider));
    expect(providers).toContain("Anthropic");
    expect(providers).toContain("Google");
    expect(providers).toContain("OpenAI");
  });

  it("should include at least 2 models from each provider", () => {
    const counts = { Anthropic: 0, Google: 0, OpenAI: 0 };
    for (const m of MODEL_CONTEXT_LIMITS) {
      counts[m.provider]++;
    }
    expect(counts.Anthropic).toBeGreaterThanOrEqual(2);
    expect(counts.Google).toBeGreaterThanOrEqual(2);
    expect(counts.OpenAI).toBeGreaterThanOrEqual(2);
  });

  it("should have recommended tokens equal to 80% of context tokens for each model", () => {
    for (const m of MODEL_CONTEXT_LIMITS) {
      expect(m.recommendedTokens).toBe(Math.round(m.contextTokens * 0.8));
    }
  });

  it("should have recommended words less than recommended tokens (words < tokens)", () => {
    for (const m of MODEL_CONTEXT_LIMITS) {
      expect(m.recommendedWords).toBeLessThan(m.recommendedTokens);
    }
  });

  it("should have all positive values", () => {
    for (const m of MODEL_CONTEXT_LIMITS) {
      expect(m.contextTokens).toBeGreaterThan(0);
      expect(m.recommendedTokens).toBeGreaterThan(0);
      expect(m.recommendedWords).toBeGreaterThan(0);
    }
  });

  it("should include specific well-known models", () => {
    const modelNames = MODEL_CONTEXT_LIMITS.map((m) => m.model);
    expect(modelNames).toContain("Claude Opus 4.6");
    expect(modelNames).toContain("Claude Sonnet 4.5");
    expect(modelNames).toContain("GPT-4.1");
    expect(modelNames).toContain("GPT-4o");
    expect(modelNames).toContain("Gemini 2.5 Pro");
  });

  describe("individual model context windows", () => {
    const findModel = (name: string): ModelContextLimit =>
      MODEL_CONTEXT_LIMITS.find((m) => m.model === name)!;

    it("Claude Opus 4.6 should have 200K context", () => {
      const model = findModel("Claude Opus 4.6");
      expect(model.contextTokens).toBe(200_000);
      expect(model.recommendedWords).toBe(120_000);
    });

    it("GPT-4.1 should have 1M context", () => {
      const model = findModel("GPT-4.1");
      expect(model.contextTokens).toBe(1_000_000);
      expect(model.recommendedWords).toBe(600_000);
    });

    it("GPT-4o should have 128K context", () => {
      const model = findModel("GPT-4o");
      expect(model.contextTokens).toBe(128_000);
      expect(model.recommendedWords).toBe(76_800);
    });

    it("Gemini 2.5 Pro should have 1M context", () => {
      const model = findModel("Gemini 2.5 Pro");
      expect(model.contextTokens).toBe(1_000_000);
      expect(model.recommendedWords).toBe(600_000);
    });
  });
});

describe("getMaxRecommendedWords", () => {
  it("should return 600,000 (80% of 1M token models)", () => {
    expect(getMaxRecommendedWords()).toBe(600_000);
  });

  it("should return the highest recommended word count across all models", () => {
    const max = Math.max(...MODEL_CONTEXT_LIMITS.map((m) => m.recommendedWords));
    expect(getMaxRecommendedWords()).toBe(max);
  });
});
