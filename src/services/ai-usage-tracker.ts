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
import type { AIProviderName } from "./ai-client.js";
import type { AIConfigService } from "./ai-config.js";
import logger from "../lib/logger.js";
import {
  buildLimitThresholdChecks,
  buildUsageLimits,
  buildUsageNotificationMessage,
  evaluateLimitStatus,
  getUtcUsageWindow,
} from "./ai-usage-logic.js";
import {
  checkOrgBudgetAlerts as checkOrgBudgetAlertsCore,
  checkSpendAnomalies as checkSpendAnomaliesCore,
} from "./ai-usage-alerts.js";
import {
  InsufficientBalanceError,
  type LimitStatus,
  type UsageSummary,
  UsageLimitExceededError,
} from "./ai-usage-types.js";
export type { LimitStatus, UsageContext, UsageSummary } from "./ai-usage-types.js";
export { InsufficientBalanceError, UsageLimitExceededError } from "./ai-usage-types.js";
export { TrackedAIClient } from "./tracked-ai-client.js";

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
    await this.checkOrgBudgetAlerts(record.organizationId).catch((err) => {
      logger.error("Org budget alert check failed", { error: err });
    });
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

    return evaluateLimitStatus({
      usage,
      limits: buildUsageLimits(limit),
      balance,
    });
  }

  /**
   * Returns current usage for a user.
   */
  async getCurrentUsage(
    organizationId: string,
    userId: string
  ): Promise<UsageSummary> {
    const { startOfDay, startOfWeek, startOfMonth } = getUtcUsageWindow();

    const [
      dailyAgg,
      weeklyAgg,
      monthlyAgg,
      dailyCount,
      weeklyCount,
      monthlyCount,
      weeklyStories,
      monthlyStories,
    ] =
      await Promise.all([
        this.prisma.aIUsageRecord.aggregate({
          where: { organizationId, userId, createdAt: { gte: startOfDay } },
          _sum: { totalTokens: true },
        }),
        this.prisma.aIUsageRecord.aggregate({
          where: { organizationId, userId, createdAt: { gte: startOfWeek } },
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
          where: { organizationId, userId, createdAt: { gte: startOfWeek } },
        }),
        this.prisma.aIUsageRecord.count({
          where: { organizationId, userId, createdAt: { gte: startOfMonth } },
        }),
        this.prisma.aIUsageRecord.count({
          where: {
            organizationId,
            userId,
            operation: "STORY_GENERATION",
            createdAt: { gte: startOfWeek },
          },
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
      weeklyTokens: weeklyAgg._sum.totalTokens ?? 0,
      monthlyTokens: monthlyAgg._sum.totalTokens ?? 0,
      dailyRequests: dailyCount,
      weeklyRequests: weeklyCount,
      monthlyRequests: monthlyCount,
      weeklyStories,
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

    const checks = buildLimitThresholdChecks(usage, limit);

    const warningPct = limit.warningThresholdPct ?? 80;
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
    await checkSpendAnomaliesCore({
      prisma: this.prisma,
      organizationId,
      userId,
      notificationWriter: {
        createNotificationIfNew: this.createNotificationIfNew.bind(this),
        createNotificationIfNewSince: this.createNotificationIfNewSince.bind(this),
      },
    });
  }

  private async checkOrgBudgetAlerts(organizationId: string): Promise<void> {
    await checkOrgBudgetAlertsCore({
      prisma: this.prisma,
      organizationId,
      notificationWriter: {
        createNotificationIfNew: this.createNotificationIfNew.bind(this),
        createNotificationIfNewSince: this.createNotificationIfNewSince.bind(this),
      },
    });
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
    maxTokensPerWeek?: number | null;
    maxTokensPerDay?: number | null;
    maxTokensPerMonth?: number | null;
    maxRequestsPerWeek?: number | null;
    maxRequestsPerDay?: number | null;
    maxRequestsPerMonth?: number | null;
    maxStoriesPerWeek?: number | null;
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
        maxTokensPerWeek: input.maxTokensPerWeek ?? undefined,
        maxTokensPerDay: input.maxTokensPerDay ?? undefined,
        maxTokensPerMonth: input.maxTokensPerMonth ?? undefined,
        maxRequestsPerWeek: input.maxRequestsPerWeek ?? undefined,
        maxRequestsPerDay: input.maxRequestsPerDay ?? undefined,
        maxRequestsPerMonth: input.maxRequestsPerMonth ?? undefined,
        maxStoriesPerWeek: input.maxStoriesPerWeek ?? undefined,
        maxStoriesPerMonth: input.maxStoriesPerMonth ?? undefined,
        warningThresholdPct: input.warningThresholdPct ?? 80,
      },
      update: {
        maxTokensPerWeek: input.maxTokensPerWeek,
        maxTokensPerDay: input.maxTokensPerDay,
        maxTokensPerMonth: input.maxTokensPerMonth,
        maxRequestsPerWeek: input.maxRequestsPerWeek,
        maxRequestsPerDay: input.maxRequestsPerDay,
        maxRequestsPerMonth: input.maxRequestsPerMonth,
        maxStoriesPerWeek: input.maxStoriesPerWeek,
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
    const { startOfDay } = getUtcUsageWindow();
    await this.createNotificationIfNewSince(
      organizationId,
      userId,
      limitType,
      thresholdPct,
      currentUsage,
      limitValue,
      startOfDay
    );
  }

  private async createNotificationIfNewSince(
    organizationId: string,
    userId: string,
    limitType: string,
    thresholdPct: number,
    currentUsage: number,
    limitValue: number,
    since: Date
  ): Promise<void> {
    const existing = await this.prisma.aIUsageNotification.findFirst({
      where: {
        organizationId,
        userId,
        limitType,
        thresholdPct,
        createdAt: { gte: since },
      },
    });
    if (existing) return;

    await this.prisma.aIUsageNotification.create({
      data: {
        organizationId,
        userId,
        limitType,
        thresholdPct,
        currentUsage,
        limitValue,
        message: buildUsageNotificationMessage(
          limitType,
          thresholdPct,
          currentUsage,
          limitValue
        ),
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
