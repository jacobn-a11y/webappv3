import type {
  AIClient,
  ChatCompletionOptions,
  ChatCompletionResult,
} from "./ai-client.js";
import logger from "../lib/logger.js";

interface CircuitState {
  failures: number;
  openUntil: number;
}

const breakerState = new Map<string, CircuitState>();

export interface FailoverAIClientOptions {
  circuitKey?: string;
  failureThreshold?: number;
  cooldownMs?: number;
  maxAttempts?: number;
}

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTransientProviderError(message: string): boolean {
  const value = message.toLowerCase();
  return (
    /\b(429|rate.?limit|quota)\b/.test(value) ||
    /\b(5\d{2}|service unavailable|gateway timeout|bad gateway)\b/.test(value) ||
    /\b(timeout|timed out|connection reset|socket|network|temporar)\b/.test(
      value
    )
  );
}

function stateFor(key: string): CircuitState {
  const existing = breakerState.get(key);
  if (existing) return existing;
  const created: CircuitState = { failures: 0, openUntil: 0 };
  breakerState.set(key, created);
  return created;
}

function isCircuitOpen(key: string): boolean {
  const state = stateFor(key);
  return state.openUntil > Date.now();
}

function recordSuccess(key: string): void {
  const state = stateFor(key);
  state.failures = 0;
  state.openUntil = 0;
}

function recordFailure(
  key: string,
  threshold: number,
  cooldownMs: number
): number {
  const state = stateFor(key);
  state.failures += 1;
  if (state.failures >= threshold) {
    state.openUntil = Date.now() + cooldownMs;
  }
  return state.failures;
}

export class FailoverAIClient implements AIClient {
  private primary: AIClient;
  private fallback: AIClient | null;
  private options: Required<FailoverAIClientOptions>;

  get providerName(): string {
    return this.primary.providerName;
  }

  get modelName(): string {
    return this.primary.modelName;
  }

  constructor(
    primary: AIClient,
    fallback?: AIClient | null,
    options?: FailoverAIClientOptions
  ) {
    const baseKey = `${primary.providerName}:${primary.modelName}`;
    this.primary = primary;
    this.fallback = fallback ?? null;
    this.options = {
      circuitKey: options?.circuitKey ?? baseKey,
      failureThreshold: Math.max(1, options?.failureThreshold ?? 3),
      cooldownMs: Math.max(5_000, options?.cooldownMs ?? 60_000),
      maxAttempts: Math.max(1, options?.maxAttempts ?? 2),
    };
  }

  async chatCompletion(
    options: ChatCompletionOptions
  ): Promise<ChatCompletionResult> {
    const { circuitKey, failureThreshold, cooldownMs, maxAttempts } =
      this.options;

    const maxPrimaryAttempts = this.fallback ? 1 : maxAttempts;
    const shouldSkipPrimary = isCircuitOpen(circuitKey);

    if (shouldSkipPrimary && this.fallback) {
      logger.warn("AI circuit open; routing request to fallback provider", {
        circuitKey,
        primaryProvider: this.primary.providerName,
        fallbackProvider: this.fallback.providerName,
      });
      return this.fallback.chatCompletion(options);
    }

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxPrimaryAttempts; attempt += 1) {
      try {
        const result = await this.primary.chatCompletion(options);
        recordSuccess(circuitKey);
        return result;
      } catch (error) {
        lastError = error;
        const message = normalizeErrorMessage(error);
        const failures = recordFailure(
          circuitKey,
          failureThreshold,
          cooldownMs
        );
        const retryable = isTransientProviderError(message);

        const hasPrimaryRetryBudget = attempt < maxPrimaryAttempts;
        if (retryable && hasPrimaryRetryBudget && !this.fallback) {
          logger.warn("Retrying AI primary provider after transient failure", {
            circuitKey,
            attempt,
            failures,
            provider: this.primary.providerName,
            model: this.primary.modelName,
            error: message,
          });
          continue;
        }

        if (retryable && this.fallback) {
          logger.warn("Falling back to secondary AI provider", {
            circuitKey,
            attempt,
            failures,
            primaryProvider: this.primary.providerName,
            fallbackProvider: this.fallback.providerName,
            error: message,
          });
          return this.fallback.chatCompletion(options);
        }

        throw error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError ?? "AI provider failure"));
  }
}
