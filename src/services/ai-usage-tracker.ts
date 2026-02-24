/**
 * AI Usage Tracker
 *
 * Tracks AI token/request usage per user and organization, enforces limits,
 * generates notifications, and handles balance deductions for platform AI.
 *
 * Also provides a TrackedAIClient wrapper (decorator pattern) that
 * automatically records usage, enforces limits, and deducts balance on
 * every AI call.
 *
 * Key concepts:
 *   - Platform-billed calls deduct from the user's prepaid balance
 *   - Custom-key calls don't deduct balance (org pays their provider directly)
 *   - Limits can be token-based, request-based, or story-count-based
 *   - Seat-based pricing multiplies per-seat budgets by org user count
 */

import type { PrismaClient, AIOperation } from "@prisma/client";
import type { AIClient, ChatCompletionOptions, ChatCompletionResult, AIProviderName } from "./ai-client.js";
import type { AIConfigService } from "./ai-config.js";
import logger from "../lib/logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UsageContext {
  organizationId: string;
  userId: string;
  operation: AIOperation;
}

export interface UsageSummary {
  dailyTokens: number;
  monthlyTokens: number;
  dailyRequests: number;
  monthlyRequests: number;
  monthlyStories: number;
}

export interface LimitStatus {
  allowed: boolean;
  reason?: string;
  usage: UsageSummary;
  limits: {
    maxTokensPerDay: number | null;
    maxTokensPerMonth: number | null;
    maxRequestsPerDay: number | null;
    maxRequestsPerMonth: number | null;
    maxStoriesPerMonth: number | null;
  };
  balance?: { balanceCents: number; lifetimeSpentCents: number } | null;
}

// ─── Tracked AI Client (Decorator) ──────────────────────────────────────────

/**
 * Wraps an AIClient to automatically track usage, enforce limits,
 * and deduct balance (for platform-billed calls).
 */
export class TrackedAIClient implements AIClient {
  private inner: AIClient;
  private tracker: AIUsageTracker;
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
    tracker: AIUsageTracker,
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
      operation: this.context.operation,
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
        console.error("Usage notification check failed:", err)
      );
    this.tracker
      .checkSpendAnomalies(this.context.organizationId, this.context.userId)
      .catch((err) =>
        console.error("Spend anomaly check failed:", err)
      );

    return result;
  }
}

// ─── Usage Tracker Service ───────────────────────────────────────────────────

export class AIUsageTracker {
  private prisma: PrismaClient;
  private configService: AIConfigService;
  private usageChargeDedup = new Map<string, number>();
  private usageChargeDedupTtlMs = 24 * 60 * 60 * 1000;

  constructor(prisma: PrismaClient, configService: AIConfigService) {
    this.prisma = prisma;
    this.configService = configService;
  }

  hasRecordedUsageCharge(idempotencyKey: string): boolean {
    this.pruneUsageChargeKeys();
    return this.usageChargeDedup.has(idempotencyKey);
  }

  markUsageChargeRecorded(idempotencyKey: string): void {
    this.pruneUsageChargeKeys();
    this.usageChargeDedup.set(
      idempotencyKey,
      Date.now() + this.usageChargeDedupTtlMs
    );
  }

  /**
   * Records a usage event after an AI call completes.
   */
  async recordUsage(record: {
    organizationId: string;
    userId: string;
    provider: string;
    model: string;
    operation: AIOperation;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costCents: number;
  }): Promise<void> {
    await this.prisma.aIUsageRecord.create({ data: record });
  }

  /**
   * Checks if a user is within their usage limits. Throws if exceeded.
   */
  async enforceLimit(
    organizationId: string,
    userId: string
  ): Promise<void> {
    const status = await this.getLimitStatus(organizationId, userId);
    if (!status.allowed) {
      throw new UsageLimitExceededError(
        status.reason ?? "Usage limit exceeded"
      );
    }
  }

  /**
   * Checks that the user has a positive balance. Throws if balance is zero.
   * Only relevant for platform-billed usage.
   */
  async enforceBalance(
    organizationId: string,
    userId: string
  ): Promise<void> {
    const balance = await this.prisma.userAIBalance.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });

    if (!balance) {
      // No balance record = no prepaid balance set up. Allow the call
      // (limits will still be enforced via AIUsageLimit).
      return;
    }

    if (balance.balanceCents <= 0) {
      throw new InsufficientBalanceError(
        "Your AI balance is $0.00. Please ask your admin to add funds."
      );
    }
  }

  /**
   * Computes the cost of an AI call using platform pricing.
   */
  async computeCost(
    provider: AIProviderName,
    model: string,
    inputTokens: number,
    outputTokens: number
  ): Promise<number> {
    const pricing = await this.configService.getModelPricing(provider, model);
    if (!pricing) return 0;

    const inputCost = (inputTokens / 1000) * pricing.inputCostPer1kTokens;
    const outputCost = (outputTokens / 1000) * pricing.outputCostPer1kTokens;
    return Math.round((inputCost + outputCost) * 100) / 100; // round to cents
  }

  /**
   * Deducts cost from the user's prepaid balance.
   */
  async deductBalance(
    organizationId: string,
    userId: string,
    amountCents: number,
    description: string
  ): Promise<void> {
    // Use a transaction to ensure atomicity
    await this.prisma.$transaction(async (tx) => {
      const balance = await tx.userAIBalance.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
      });

      if (!balance) return; // No balance tracking for this user

      const roundedCents = Math.round(amountCents * 100) / 100;

      await tx.userAIBalance.update({
        where: { id: balance.id },
        data: {
          balanceCents: { decrement: Math.ceil(roundedCents) },
          lifetimeSpentCents: { increment: Math.ceil(roundedCents) },
        },
      });

      await tx.userAITransaction.create({
        data: {
          balanceId: balance.id,
          type: "DEBIT",
          amountCents: Math.ceil(roundedCents),
          description,
        },
      });
    });
  }

  /**
   * Adds funds to a user's balance. Called by org admins.
   */
  async addBalance(
    organizationId: string,
    userId: string,
    amountCents: number,
    description?: string
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Upsert the balance record
      const balance = await tx.userAIBalance.upsert({
        where: { organizationId_userId: { organizationId, userId } },
        create: {
          organizationId,
          userId,
          balanceCents: amountCents,
        },
        update: {
          balanceCents: { increment: amountCents },
        },
      });

      await tx.userAITransaction.create({
        data: {
          balanceId: balance.id,
          type: "CREDIT",
          amountCents,
          description: description ?? `Balance top-up: $${(amountCents / 100).toFixed(2)}`,
        },
      });
    });
  }

  /**
   * Gets a user's current balance.
   */
  async getBalance(organizationId: string, userId: string) {
    return this.prisma.userAIBalance.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      include: {
        transactions: {
          orderBy: { createdAt: "desc" },
          take: 50,
        },
      },
    });
  }

  /**
   * Returns the current usage and limit status for a user.
   */
  async getLimitStatus(
    organizationId: string,
    userId: string
  ): Promise<LimitStatus> {
    const [usage, limit, balance] = await Promise.all([
      this.getCurrentUsage(organizationId, userId),
      this.getEffectiveLimit(organizationId, userId),
      this.prisma.userAIBalance.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
        select: { balanceCents: true, lifetimeSpentCents: true },
      }),
    ]);

    const limits = {
      maxTokensPerDay: limit?.maxTokensPerDay ?? null,
      maxTokensPerMonth: limit?.maxTokensPerMonth ?? null,
      maxRequestsPerDay: limit?.maxRequestsPerDay ?? null,
      maxRequestsPerMonth: limit?.maxRequestsPerMonth ?? null,
      maxStoriesPerMonth: limit?.maxStoriesPerMonth ?? null,
    };

    // Check each limit
    if (limits.maxTokensPerDay !== null && usage.dailyTokens >= limits.maxTokensPerDay) {
      return {
        allowed: false,
        reason: `Daily token limit reached (${usage.dailyTokens.toLocaleString()} / ${limits.maxTokensPerDay.toLocaleString()})`,
        usage, limits, balance,
      };
    }

    if (limits.maxTokensPerMonth !== null && usage.monthlyTokens >= limits.maxTokensPerMonth) {
      return {
        allowed: false,
        reason: `Monthly token limit reached (${usage.monthlyTokens.toLocaleString()} / ${limits.maxTokensPerMonth.toLocaleString()})`,
        usage, limits, balance,
      };
    }

    if (limits.maxRequestsPerDay !== null && usage.dailyRequests >= limits.maxRequestsPerDay) {
      return {
        allowed: false,
        reason: `Daily request limit reached (${usage.dailyRequests} / ${limits.maxRequestsPerDay})`,
        usage, limits, balance,
      };
    }

    if (limits.maxRequestsPerMonth !== null && usage.monthlyRequests >= limits.maxRequestsPerMonth) {
      return {
        allowed: false,
        reason: `Monthly request limit reached (${usage.monthlyRequests} / ${limits.maxRequestsPerMonth})`,
        usage, limits, balance,
      };
    }

    if (limits.maxStoriesPerMonth !== null && usage.monthlyStories >= limits.maxStoriesPerMonth) {
      return {
        allowed: false,
        reason: `Monthly case study limit reached (${usage.monthlyStories} / ${limits.maxStoriesPerMonth})`,
        usage, limits, balance,
      };
    }

    return { allowed: true, usage, limits, balance };
  }

  /**
   * Returns current usage for a user.
   */
  async getCurrentUsage(
    organizationId: string,
    userId: string
  ): Promise<UsageSummary> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [dailyAgg, monthlyAgg, dailyCount, monthlyCount, monthlyStories] =
      await Promise.all([
        this.prisma.aIUsageRecord.aggregate({
          where: { organizationId, userId, createdAt: { gte: startOfDay } },
          _sum: { totalTokens: true },
        }),
        this.prisma.aIUsageRecord.aggregate({
          where: { organizationId, userId, createdAt: { gte: startOfMonth } },
          _sum: { totalTokens: true },
        }),
        this.prisma.aIUsageRecord.count({
          where: { organizationId, userId, createdAt: { gte: startOfDay } },
        }),
        this.prisma.aIUsageRecord.count({
          where: { organizationId, userId, createdAt: { gte: startOfMonth } },
        }),
        this.prisma.aIUsageRecord.count({
          where: {
            organizationId,
            userId,
            operation: "STORY_GENERATION",
            createdAt: { gte: startOfMonth },
          },
        }),
      ]);

    return {
      dailyTokens: dailyAgg._sum.totalTokens ?? 0,
      monthlyTokens: monthlyAgg._sum.totalTokens ?? 0,
      dailyRequests: dailyCount,
      monthlyRequests: monthlyCount,
      monthlyStories,
    };
  }

  /**
   * Returns usage history for reporting.
   */
  async getUsageHistory(
    organizationId: string,
    userId?: string,
    days = 30
  ) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const where: Record<string, unknown> = {
      organizationId,
      createdAt: { gte: since },
    };
    if (userId) where.userId = userId;

    return this.prisma.aIUsageRecord.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: {
        id: true,
        userId: true,
        provider: true,
        model: true,
        operation: true,
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        costCents: true,
        createdAt: true,
      },
    });
  }

  /**
   * Checks notification thresholds and creates notifications as needed.
   */
  async checkAndNotify(
    organizationId: string,
    userId: string
  ): Promise<void> {
    const [usage, limit] = await Promise.all([
      this.getCurrentUsage(organizationId, userId),
      this.getEffectiveLimit(organizationId, userId),
    ]);

    if (!limit) return;

    const checks: Array<{ limitType: string; current: number; max: number }> = [];

    if (limit.maxTokensPerDay)
      checks.push({ limitType: "daily_tokens", current: usage.dailyTokens, max: limit.maxTokensPerDay });
    if (limit.maxTokensPerMonth)
      checks.push({ limitType: "monthly_tokens", current: usage.monthlyTokens, max: limit.maxTokensPerMonth });
    if (limit.maxRequestsPerDay)
      checks.push({ limitType: "daily_requests", current: usage.dailyRequests, max: limit.maxRequestsPerDay });
    if (limit.maxRequestsPerMonth)
      checks.push({ limitType: "monthly_requests", current: usage.monthlyRequests, max: limit.maxRequestsPerMonth });
    if (limit.maxStoriesPerMonth)
      checks.push({ limitType: "monthly_stories", current: usage.monthlyStories, max: limit.maxStoriesPerMonth });

    const warningPct = limit.warningThresholdPct;
    const thresholds = [warningPct, 90, 100].sort((a, b) => a - b);

    for (const check of checks) {
      const pct = Math.round((check.current / check.max) * 100);
      for (const threshold of thresholds) {
        if (pct >= threshold) {
          await this.createNotificationIfNew(
            organizationId, userId, check.limitType,
            threshold, check.current, check.max
          );
        }
      }
    }
  }

  async checkSpendAnomalies(
    organizationId: string,
    userId: string
  ): Promise<void> {
    const now = new Date();
    const startOfToday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

    const [todayOrgCostAgg, previousSevenDays, orgSettings, todayPlatformCostAgg] =
      await Promise.all([
        this.prisma.aIUsageRecord.aggregate({
          where: {
            organizationId,
            createdAt: { gte: startOfToday, lt: startOfTomorrow },
          },
          _sum: { costCents: true },
        }),
        this.prisma.aIUsageRecord.findMany({
          where: {
            organizationId,
            createdAt: {
              gte: new Date(startOfToday.getTime() - 7 * 24 * 60 * 60 * 1000),
              lt: startOfToday,
            },
          },
          select: { costCents: true, createdAt: true },
        }),
        this.prisma.orgSettings.findUnique({
          where: { organizationId },
          select: { dataGovernancePolicy: true },
        }),
        this.prisma.aIUsageRecord.aggregate({
          where: {
            createdAt: { gte: startOfToday, lt: startOfTomorrow },
          },
          _sum: { costCents: true },
        }),
      ]);

    const todayOrgCost = todayOrgCostAgg._sum.costCents ?? 0;
    const platformDailyThreshold = Number(
      process.env.AI_SPEND_ALERT_PLATFORM_DAILY_CENTS ?? "50000"
    );
    const normalizedPlatformThreshold = Number.isFinite(platformDailyThreshold)
      ? Math.max(1_000, Math.floor(platformDailyThreshold))
      : 50_000;

    const rawPolicy = orgSettings?.dataGovernancePolicy;
    const policy =
      rawPolicy && typeof rawPolicy === "object" && !Array.isArray(rawPolicy)
        ? (rawPolicy as Record<string, unknown>)
        : {};
    const orgThresholdRaw = policy.ai_spend_alert_daily_cents;
    const orgThreshold =
      typeof orgThresholdRaw === "number" && Number.isFinite(orgThresholdRaw)
        ? Math.max(500, Math.floor(orgThresholdRaw))
        : 10_000;

    if (todayOrgCost >= orgThreshold) {
      await this.createNotificationIfNew(
        organizationId,
        userId,
        "daily_spend_org",
        100,
        Math.round(todayOrgCost),
        orgThreshold
      );
    }

    if (previousSevenDays.length > 0) {
      const costsByDay = new Map<string, number>();
      for (const row of previousSevenDays) {
        const dayKey = row.createdAt.toISOString().slice(0, 10);
        costsByDay.set(dayKey, (costsByDay.get(dayKey) ?? 0) + row.costCents);
      }
      const totals = Array.from(costsByDay.values());
      const avgDaily =
        totals.length > 0
          ? totals.reduce((sum, value) => sum + value, 0) / totals.length
          : 0;
      if (avgDaily > 0 && todayOrgCost >= avgDaily * 3 && todayOrgCost >= 2_000) {
        await this.createNotificationIfNew(
          organizationId,
          userId,
          "daily_spend_anomaly",
          100,
          Math.round(todayOrgCost),
          Math.round(avgDaily)
        );
      }
    }

    const todayPlatformCost = todayPlatformCostAgg._sum.costCents ?? 0;
    if (todayPlatformCost >= normalizedPlatformThreshold) {
      logger.warn("Platform AI spend threshold exceeded", {
        todayPlatformCostCents: Math.round(todayPlatformCost),
        thresholdCents: normalizedPlatformThreshold,
      });
    }
  }

  // ─── Notifications ──────────────────────────────────────────────────

  async getPendingNotifications(organizationId: string, userId: string) {
    return this.prisma.aIUsageNotification.findMany({
      where: { organizationId, userId, acknowledged: false },
      orderBy: { createdAt: "desc" },
    });
  }

  async acknowledgeNotification(
    organizationId: string,
    userId: string,
    notificationId: string
  ): Promise<boolean> {
    const updated = await this.prisma.aIUsageNotification.updateMany({
      where: {
        id: notificationId,
        organizationId,
        userId,
        acknowledged: false,
      },
      data: { acknowledged: true },
    });
    return updated.count > 0;
  }

  async acknowledgeAllNotifications(
    organizationId: string,
    userId: string
  ): Promise<number> {
    const updated = await this.prisma.aIUsageNotification.updateMany({
      where: { organizationId, userId, acknowledged: false },
      data: { acknowledged: true },
    });
    return updated.count;
  }

  // ─── Limit Management ──────────────────────────────────────────────

  async setLimit(input: {
    organizationId: string;
    userId?: string;
    maxTokensPerDay?: number | null;
    maxTokensPerMonth?: number | null;
    maxRequestsPerDay?: number | null;
    maxRequestsPerMonth?: number | null;
    maxStoriesPerMonth?: number | null;
    warningThresholdPct?: number;
  }): Promise<void> {
    const compositeUserId = input.userId ?? "org_default";
    await this.prisma.aIUsageLimit.upsert({
      where: {
        organizationId_userId: {
          organizationId: input.organizationId,
          userId: compositeUserId,
        },
      },
      create: {
        organizationId: input.organizationId,
        userId: input.userId ?? undefined,
        maxTokensPerDay: input.maxTokensPerDay ?? undefined,
        maxTokensPerMonth: input.maxTokensPerMonth ?? undefined,
        maxRequestsPerDay: input.maxRequestsPerDay ?? undefined,
        maxRequestsPerMonth: input.maxRequestsPerMonth ?? undefined,
        maxStoriesPerMonth: input.maxStoriesPerMonth ?? undefined,
        warningThresholdPct: input.warningThresholdPct ?? 80,
      },
      update: {
        maxTokensPerDay: input.maxTokensPerDay,
        maxTokensPerMonth: input.maxTokensPerMonth,
        maxRequestsPerDay: input.maxRequestsPerDay,
        maxRequestsPerMonth: input.maxRequestsPerMonth,
        maxStoriesPerMonth: input.maxStoriesPerMonth,
        warningThresholdPct: input.warningThresholdPct,
      },
    });
  }

  async removeLimit(organizationId: string, userId?: string): Promise<void> {
    await this.prisma.aIUsageLimit.deleteMany({
      where: { organizationId, userId: userId ?? null },
    });
  }

  async listLimits(organizationId: string) {
    return this.prisma.aIUsageLimit.findMany({
      where: { organizationId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  // ─── Private ────────────────────────────────────────────────────────

  private async getEffectiveLimit(organizationId: string, userId: string) {
    // User-specific limit first
    const userLimit = await this.prisma.aIUsageLimit.findFirst({
      where: { organizationId, userId },
    });
    if (userLimit) return userLimit;

    // Org-wide default
    return this.prisma.aIUsageLimit.findFirst({
      where: { organizationId, userId: null },
    });
  }

  private async createNotificationIfNew(
    organizationId: string,
    userId: string,
    limitType: string,
    thresholdPct: number,
    currentUsage: number,
    limitValue: number
  ): Promise<void> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const existing = await this.prisma.aIUsageNotification.findFirst({
      where: {
        organizationId,
        userId,
        limitType,
        thresholdPct,
        createdAt: { gte: startOfDay },
      },
    });
    if (existing) return;

    const labels: Record<string, string> = {
      daily_tokens: "daily token",
      monthly_tokens: "monthly token",
      daily_requests: "daily request",
      monthly_requests: "monthly request",
      monthly_stories: "monthly case study",
      daily_spend_org: "daily AI spend",
      daily_spend_anomaly: "daily AI spend anomaly baseline",
    };

    const label = labels[limitType] ?? limitType;
    const message =
      thresholdPct >= 100
        ? `You have reached your ${label} limit (${currentUsage.toLocaleString()} / ${limitValue.toLocaleString()}). Further requests will be blocked until the limit resets.`
        : `You have used ${thresholdPct}% of your ${label} limit (${currentUsage.toLocaleString()} / ${limitValue.toLocaleString()}).`;

    await this.prisma.aIUsageNotification.create({
      data: {
        organizationId,
        userId,
        limitType,
        thresholdPct,
        currentUsage,
        limitValue,
        message,
      },
    });
  }

  private pruneUsageChargeKeys(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.usageChargeDedup.entries()) {
      if (expiresAt <= now) {
        this.usageChargeDedup.delete(key);
      }
    }
  }
}

// ─── Custom Errors ───────────────────────────────────────────────────────────

export class UsageLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageLimitExceededError";
  }
}

export class InsufficientBalanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientBalanceError";
  }
}
