import type { AIOperation } from "@prisma/client";
import type {
  AIClient,
  AIProviderName,
  ChatCompletionOptions,
  ChatCompletionResult,
} from "./ai-client.js";
import type {
  UsageContext,
} from "./ai-usage-types.js";
import logger from "../lib/logger.js";

interface AIUsageTrackingPort {
  enforceLimit(organizationId: string, userId: string): Promise<void>;
  enforceBalance(organizationId: string, userId: string): Promise<void>;
  hasRecordedUsageCharge(idempotencyKey: string): boolean;
  markUsageChargeRecorded(idempotencyKey: string): void;
  computeCost(
    provider: AIProviderName,
    model: string,
    inputTokens: number,
    outputTokens: number
  ): Promise<number>;
  recordUsage(record: {
    organizationId: string;
    userId: string;
    provider: string;
    model: string;
    operation: AIOperation;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costCents: number;
  }): Promise<void>;
  deductBalance(
    organizationId: string,
    userId: string,
    amountCents: number,
    description: string
  ): Promise<void>;
  checkAndNotify(organizationId: string, userId: string): Promise<void>;
  checkSpendAnomalies(organizationId: string, userId: string): Promise<void>;
}

/**
 * Wraps an AIClient to automatically track usage, enforce limits,
 * and deduct balance (for platform-billed calls).
 */
export class TrackedAIClient implements AIClient {
  private inner: AIClient;
  private tracker: AIUsageTrackingPort;
  private context: UsageContext;
  private isPlatformBilled: boolean;

  get providerName(): string {
    return this.inner.providerName;
  }
  get modelName(): string {
    return this.inner.modelName;
  }

  constructor(
    inner: AIClient,
    tracker: AIUsageTrackingPort,
    context: UsageContext,
    isPlatformBilled: boolean
  ) {
    this.inner = inner;
    this.tracker = tracker;
    this.context = context;
    this.isPlatformBilled = isPlatformBilled;
  }

  async chatCompletion(
    options: ChatCompletionOptions
  ): Promise<ChatCompletionResult> {
    // Enforce limits before the call
    await this.tracker.enforceLimit(
      this.context.organizationId,
      this.context.userId
    );

    // If platform-billed, check that the user has sufficient balance
    if (this.isPlatformBilled) {
      await this.tracker.enforceBalance(
        this.context.organizationId,
        this.context.userId
      );
    }

    // Make the actual AI call
    const result = await this.inner.chatCompletion(options);

    const chargeIdempotencyKey = options.idempotencyKey?.trim()
      ? `${this.context.organizationId}:${this.context.userId}:${this.context.operation}:${options.idempotencyKey.trim()}`
      : null;
    const alreadyCharged = chargeIdempotencyKey
      ? this.tracker.hasRecordedUsageCharge(chargeIdempotencyKey)
      : false;

    if (alreadyCharged) {
      return result;
    }

    // Compute cost (only for platform-billed calls)
    let costCents = 0;
    if (this.isPlatformBilled) {
      costCents = await this.tracker.computeCost(
        this.inner.providerName as AIProviderName,
        this.inner.modelName,
        result.inputTokens,
        result.outputTokens
      );
    }

    // Record usage
    await this.tracker.recordUsage({
      organizationId: this.context.organizationId,
      userId: this.context.userId,
      provider: this.inner.providerName,
      model: this.inner.modelName,
      operation: this.context.operation as AIOperation,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.totalTokens,
      costCents,
    });

    // If platform-billed, deduct from balance
    if (this.isPlatformBilled && costCents > 0) {
      await this.tracker.deductBalance(
        this.context.organizationId,
        this.context.userId,
        costCents,
        `${this.context.operation} using ${this.inner.providerName}/${this.inner.modelName}`
      );
    }

    if (chargeIdempotencyKey) {
      this.tracker.markUsageChargeRecorded(chargeIdempotencyKey);
    }

    // Check notification thresholds (non-blocking)
    this.tracker
      .checkAndNotify(this.context.organizationId, this.context.userId)
      .catch((err) =>
        logger.error("Usage notification check failed", { error: err })
      );
    this.tracker
      .checkSpendAnomalies(this.context.organizationId, this.context.userId)
      .catch((err) =>
        logger.error("Spend anomaly check failed", { error: err })
      );

    return result;
  }
}
