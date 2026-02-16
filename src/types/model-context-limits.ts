/**
 * AI Model Context Window Reference Data
 *
 * Recommended word count limits based on 80% of the token context window
 * for the 10 most popular commercially available models from Anthropic,
 * Google, and OpenAI as of February 2026.
 *
 * Conversion: 1 token ≈ 0.75 English words (accounts for whitespace,
 * punctuation, and markdown formatting overhead).
 */

export interface ModelContextLimit {
  provider: "Anthropic" | "Google" | "OpenAI";
  model: string;
  contextTokens: number;
  /** 80% of context window in tokens */
  recommendedTokens: number;
  /** Approximate word count at 80% utilization */
  recommendedWords: number;
}

/**
 * The 10 most popular commercially available models and their
 * recommended merged transcript word count limits (80% of context window).
 */
export const MODEL_CONTEXT_LIMITS: ModelContextLimit[] = [
  {
    provider: "Anthropic",
    model: "Claude Opus 4.6",
    contextTokens: 200_000,
    recommendedTokens: 160_000,
    recommendedWords: 120_000,
  },
  {
    provider: "Anthropic",
    model: "Claude Sonnet 4.5",
    contextTokens: 200_000,
    recommendedTokens: 160_000,
    recommendedWords: 120_000,
  },
  {
    provider: "Anthropic",
    model: "Claude Sonnet 4",
    contextTokens: 200_000,
    recommendedTokens: 160_000,
    recommendedWords: 120_000,
  },
  {
    provider: "OpenAI",
    model: "GPT-4.1",
    contextTokens: 1_000_000,
    recommendedTokens: 800_000,
    recommendedWords: 600_000,
  },
  {
    provider: "OpenAI",
    model: "GPT-4o",
    contextTokens: 128_000,
    recommendedTokens: 102_400,
    recommendedWords: 76_800,
  },
  {
    provider: "OpenAI",
    model: "o3",
    contextTokens: 200_000,
    recommendedTokens: 160_000,
    recommendedWords: 120_000,
  },
  {
    provider: "OpenAI",
    model: "o4-mini",
    contextTokens: 200_000,
    recommendedTokens: 160_000,
    recommendedWords: 120_000,
  },
  {
    provider: "Google",
    model: "Gemini 2.5 Pro",
    contextTokens: 1_000_000,
    recommendedTokens: 800_000,
    recommendedWords: 600_000,
  },
  {
    provider: "Google",
    model: "Gemini 2.0 Flash",
    contextTokens: 1_000_000,
    recommendedTokens: 800_000,
    recommendedWords: 600_000,
  },
  {
    provider: "Google",
    model: "Gemini 2.5 Flash-Lite",
    contextTokens: 1_000_000,
    recommendedTokens: 800_000,
    recommendedWords: 600_000,
  },
];

/**
 * Returns the highest recommended word count across all tracked models.
 * Used as the default max word count for transcript merging.
 */
export function getMaxRecommendedWords(): number {
  return Math.max(...MODEL_CONTEXT_LIMITS.map((m) => m.recommendedWords));
}
