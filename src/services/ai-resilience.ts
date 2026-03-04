import type {
  AIClient,
  ChatCompletionOptions,
  ChatCompletionResult,
} from "./ai-client.js";
import logger from "../lib/logger.js";
import { createClient, type RedisClientType } from "redis";

// ─── Redis client (lazy singleton) ────────────────────────────────────────────

let redisClient: RedisClientType | null = null;
let redisUnavailable = false;

async function getRedisClient(): Promise<RedisClientType | null> {
  if (redisClient) return redisClient;
  if (redisUnavailable) return null;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    redisClient = createClient({ url }) as RedisClientType;
    await redisClient.connect();
    return redisClient;
  } catch {
    redisUnavailable = true;
    return null;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface CircuitState {
  failures: number;
  openUntil: number;
}

// ─── In-memory fallback ───────────────────────────────────────────────────────

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

// ─── Circuit state helpers (Redis + in-memory fallback) ───────────────────────

async function stateFor(key: string): Promise<CircuitState> {
  const redis = await getRedisClient();
  if (redis) {
    try {
      const redisKey = `circuit:${key}`;
      const [failures, openUntil] = await Promise.all([
        redis.hGet(redisKey, "failures"),
        redis.hGet(redisKey, "openUntil"),
      ]);
      return {
        failures: failures ? parseInt(failures, 10) : 0,
        openUntil: openUntil ? parseInt(openUntil, 10) : 0,
      };
    } catch {
      // Fall through to in-memory
    }
  }

  const existing = breakerState.get(key);
  if (existing) return existing;
  const created: CircuitState = { failures: 0, openUntil: 0 };
  breakerState.set(key, created);
  return created;
}

async function isCircuitOpen(key: string): Promise<boolean> {
  const state = await stateFor(key);
  return state.openUntil > Date.now();
}

async function recordSuccess(key: string): Promise<void> {
  const redis = await getRedisClient();
  if (redis) {
    try {
      const redisKey = `circuit:${key}`;
      await redis.hSet(redisKey, { failures: "0", openUntil: "0" });
      await redis.expire(redisKey, 300);
      return;
    } catch {
      // Fall through to in-memory
    }
  }

  const state = breakerState.get(key) ?? { failures: 0, openUntil: 0 };
  state.failures = 0;
  state.openUntil = 0;
  breakerState.set(key, state);
}

async function recordFailure(
  key: string,
  threshold: number,
  cooldownMs: number
): Promise<number> {
  const redis = await getRedisClient();
  if (redis) {
    try {
      const redisKey = `circuit:${key}`;
      const failures = await redis.hIncrBy(redisKey, "failures", 1);
      if (failures >= threshold) {
        await redis.hSet(redisKey, "openUntil", String(Date.now() + cooldownMs));
      }
      await redis.expire(redisKey, Math.max(300, Math.ceil(cooldownMs / 1000) + 60));
      return failures;
    } catch {
      // Fall through to in-memory
    }
  }

  const state = breakerState.get(key) ?? { failures: 0, openUntil: 0 };
  state.failures += 1;
  if (state.failures >= threshold) {
    state.openUntil = Date.now() + cooldownMs;
  }
  breakerState.set(key, state);
  return state.failures;
}

// ─── Failover AI Client ──────────────────────────────────────────────────────

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
    const shouldSkipPrimary = await isCircuitOpen(circuitKey);

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
        await recordSuccess(circuitKey);
        return result;
      } catch (error) {
        lastError = error;
        const message = normalizeErrorMessage(error);
        const failures = await recordFailure(
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
