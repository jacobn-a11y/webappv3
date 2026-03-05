import type { PrismaClient } from "@prisma/client";
import logger from "../lib/logger.js";
import { decodeDataGovernancePolicy } from "../types/json-boundaries.js";
import { getUtcUsageWindow } from "./ai-usage-logic.js";

interface NotificationWriter {
  createNotificationIfNew(
    organizationId: string,
    userId: string,
    limitType: string,
    thresholdPct: number,
    currentUsage: number,
    limitValue: number
  ): Promise<void>;
  createNotificationIfNewSince(
    organizationId: string,
    userId: string,
    limitType: string,
    thresholdPct: number,
    currentUsage: number,
    limitValue: number,
    since: Date
  ): Promise<void>;
}

export async function checkSpendAnomalies(input: {
  prisma: PrismaClient;
  organizationId: string;
  userId: string;
  notificationWriter: NotificationWriter;
}): Promise<void> {
  const { prisma, organizationId, userId, notificationWriter } = input;
  const { startOfDay, startOfTomorrow } = getUtcUsageWindow();

  const [todayOrgCostAgg, previousSevenDays, orgSettings, todayPlatformCostAgg] =
    await Promise.all([
      prisma.aIUsageRecord.aggregate({
        where: {
          organizationId,
          createdAt: { gte: startOfDay, lt: startOfTomorrow },
        },
        _sum: { costCents: true },
      }),
      prisma.aIUsageRecord.findMany({
        where: {
          organizationId,
          createdAt: {
            gte: new Date(startOfDay.getTime() - 7 * 24 * 60 * 60 * 1000),
            lt: startOfDay,
          },
        },
        select: { costCents: true, createdAt: true },
      }),
      prisma.orgSettings.findUnique({
        where: { organizationId },
        select: { dataGovernancePolicy: true },
      }),
      prisma.aIUsageRecord.aggregate({
        where: {
          createdAt: { gte: startOfDay, lt: startOfTomorrow },
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

  const policy = decodeDataGovernancePolicy(orgSettings?.dataGovernancePolicy);
  const orgThresholdRaw = policy.ai_spend_alert_daily_cents;
  const orgThreshold =
    typeof orgThresholdRaw === "number" && Number.isFinite(orgThresholdRaw)
      ? Math.max(500, Math.floor(orgThresholdRaw))
      : 10_000;

  if (todayOrgCost >= orgThreshold) {
    await notificationWriter.createNotificationIfNew(
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
      await notificationWriter.createNotificationIfNew(
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

export async function checkOrgBudgetAlerts(input: {
  prisma: PrismaClient;
  organizationId: string;
  notificationWriter: NotificationWriter;
}): Promise<void> {
  const { prisma, organizationId, notificationWriter } = input;
  const orgSettings = await prisma.orgSettings.findUnique({
    where: { organizationId },
    select: { dataGovernancePolicy: true },
  });
  const policy = decodeDataGovernancePolicy(orgSettings?.dataGovernancePolicy);
  const mode =
    policy.ai_budget_mode === "TOKENS" || policy.ai_budget_mode === "COST_CENTS"
      ? policy.ai_budget_mode
      : "COST_CENTS";
  const budget =
    mode === "TOKENS"
      ? policy.ai_budget_monthly_tokens ?? null
      : policy.ai_budget_monthly_cents ?? null;
  if (!budget || budget <= 0) {
    return;
  }

  const thresholds = Array.from(
    new Set((policy.ai_budget_thresholds ?? [80, 90, 100]).filter((n) => n >= 1 && n <= 100))
  ).sort((a, b) => a - b);
  if (thresholds.length === 0) {
    return;
  }

  const { startOfMonth } = getUtcUsageWindow();

  const usageAgg =
    mode === "TOKENS"
      ? await prisma.aIUsageRecord.aggregate({
          where: { organizationId, createdAt: { gte: startOfMonth } },
          _sum: { totalTokens: true },
        })
      : await prisma.aIUsageRecord.aggregate({
          where: { organizationId, createdAt: { gte: startOfMonth } },
          _sum: { costCents: true },
        });

  const currentUsage =
    mode === "TOKENS"
      ? Math.round((usageAgg as { _sum: { totalTokens?: number | null } })._sum.totalTokens ?? 0)
      : Math.round((usageAgg as { _sum: { costCents?: number | null } })._sum.costCents ?? 0);
  const pct = budget > 0 ? Math.floor((currentUsage / budget) * 100) : 0;
  if (pct < thresholds[0]) {
    return;
  }

  const recipients = await prisma.user.findMany({
    where: {
      organizationId,
      role: { in: ["OWNER", "ADMIN"] },
    },
    select: { id: true },
  });
  if (recipients.length === 0) {
    return;
  }

  const limitType = mode === "TOKENS" ? "monthly_budget_tokens" : "monthly_budget_cost";
  for (const threshold of thresholds) {
    if (pct < threshold) continue;
    for (const recipient of recipients) {
      await notificationWriter.createNotificationIfNewSince(
        organizationId,
        recipient.id,
        limitType,
        threshold,
        currentUsage,
        budget,
        startOfMonth
      );
    }
  }
}
