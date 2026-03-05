import type { LimitStatus, UsageSummary } from "./ai-usage-types.js";

export interface AIUsageLimitLike {
  maxTokensPerWeek?: number | null;
  maxTokensPerDay?: number | null;
  maxTokensPerMonth?: number | null;
  maxRequestsPerWeek?: number | null;
  maxRequestsPerDay?: number | null;
  maxRequestsPerMonth?: number | null;
  maxStoriesPerWeek?: number | null;
  maxStoriesPerMonth?: number | null;
  warningThresholdPct?: number | null;
}

export interface UsageWindowBounds {
  startOfDay: Date;
  startOfWeek: Date;
  startOfMonth: Date;
  startOfTomorrow: Date;
}

export interface LimitThresholdCheck {
  limitType: string;
  current: number;
  max: number;
}

export function getUtcUsageWindow(now: Date = new Date()): UsageWindowBounds {
  const startOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const startOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
  const utcWeekday = now.getUTCDay();
  const daysSinceMonday = (utcWeekday + 6) % 7;
  const startOfWeek = new Date(startOfDay);
  startOfWeek.setUTCDate(startOfWeek.getUTCDate() - daysSinceMonday);
  const startOfTomorrow = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  return { startOfDay, startOfWeek, startOfMonth, startOfTomorrow };
}

export function buildUsageLimits(limit: AIUsageLimitLike | null | undefined) {
  return {
    maxTokensPerWeek: limit?.maxTokensPerWeek ?? null,
    maxTokensPerDay: limit?.maxTokensPerDay ?? null,
    maxTokensPerMonth: limit?.maxTokensPerMonth ?? null,
    maxRequestsPerWeek: limit?.maxRequestsPerWeek ?? null,
    maxRequestsPerDay: limit?.maxRequestsPerDay ?? null,
    maxRequestsPerMonth: limit?.maxRequestsPerMonth ?? null,
    maxStoriesPerWeek: limit?.maxStoriesPerWeek ?? null,
    maxStoriesPerMonth: limit?.maxStoriesPerMonth ?? null,
  };
}

export function evaluateLimitStatus(input: {
  usage: UsageSummary;
  limits: ReturnType<typeof buildUsageLimits>;
  balance?: { balanceCents: number; lifetimeSpentCents: number } | null;
}): LimitStatus {
  const { usage, limits, balance } = input;
  if (
    limits.maxTokensPerWeek !== null &&
    usage.weeklyTokens >= limits.maxTokensPerWeek
  ) {
    return {
      allowed: false,
      reason: `Weekly token limit reached (${usage.weeklyTokens.toLocaleString()} / ${limits.maxTokensPerWeek.toLocaleString()})`,
      usage,
      limits,
      balance,
    };
  }

  if (
    limits.maxTokensPerDay !== null &&
    usage.dailyTokens >= limits.maxTokensPerDay
  ) {
    return {
      allowed: false,
      reason: `Daily token limit reached (${usage.dailyTokens.toLocaleString()} / ${limits.maxTokensPerDay.toLocaleString()})`,
      usage,
      limits,
      balance,
    };
  }

  if (
    limits.maxTokensPerMonth !== null &&
    usage.monthlyTokens >= limits.maxTokensPerMonth
  ) {
    return {
      allowed: false,
      reason: `Monthly token limit reached (${usage.monthlyTokens.toLocaleString()} / ${limits.maxTokensPerMonth.toLocaleString()})`,
      usage,
      limits,
      balance,
    };
  }

  if (
    limits.maxRequestsPerWeek !== null &&
    usage.weeklyRequests >= limits.maxRequestsPerWeek
  ) {
    return {
      allowed: false,
      reason: `Weekly request limit reached (${usage.weeklyRequests} / ${limits.maxRequestsPerWeek})`,
      usage,
      limits,
      balance,
    };
  }

  if (
    limits.maxRequestsPerDay !== null &&
    usage.dailyRequests >= limits.maxRequestsPerDay
  ) {
    return {
      allowed: false,
      reason: `Daily request limit reached (${usage.dailyRequests} / ${limits.maxRequestsPerDay})`,
      usage,
      limits,
      balance,
    };
  }

  if (
    limits.maxRequestsPerMonth !== null &&
    usage.monthlyRequests >= limits.maxRequestsPerMonth
  ) {
    return {
      allowed: false,
      reason: `Monthly request limit reached (${usage.monthlyRequests} / ${limits.maxRequestsPerMonth})`,
      usage,
      limits,
      balance,
    };
  }

  if (
    limits.maxStoriesPerWeek !== null &&
    usage.weeklyStories >= limits.maxStoriesPerWeek
  ) {
    return {
      allowed: false,
      reason: `Weekly story limit reached (${usage.weeklyStories} / ${limits.maxStoriesPerWeek})`,
      usage,
      limits,
      balance,
    };
  }

  if (
    limits.maxStoriesPerMonth !== null &&
    usage.monthlyStories >= limits.maxStoriesPerMonth
  ) {
    return {
      allowed: false,
      reason: `Monthly case study limit reached (${usage.monthlyStories} / ${limits.maxStoriesPerMonth})`,
      usage,
      limits,
      balance,
    };
  }

  return { allowed: true, usage, limits, balance };
}

export function buildLimitThresholdChecks(
  usage: UsageSummary,
  limit: AIUsageLimitLike
): LimitThresholdCheck[] {
  const checks: LimitThresholdCheck[] = [];

  if (limit.maxTokensPerDay) {
    checks.push({
      limitType: "daily_tokens",
      current: usage.dailyTokens,
      max: limit.maxTokensPerDay,
    });
  }
  if (limit.maxTokensPerWeek) {
    checks.push({
      limitType: "weekly_tokens",
      current: usage.weeklyTokens,
      max: limit.maxTokensPerWeek,
    });
  }
  if (limit.maxTokensPerMonth) {
    checks.push({
      limitType: "monthly_tokens",
      current: usage.monthlyTokens,
      max: limit.maxTokensPerMonth,
    });
  }
  if (limit.maxRequestsPerDay) {
    checks.push({
      limitType: "daily_requests",
      current: usage.dailyRequests,
      max: limit.maxRequestsPerDay,
    });
  }
  if (limit.maxRequestsPerWeek) {
    checks.push({
      limitType: "weekly_requests",
      current: usage.weeklyRequests,
      max: limit.maxRequestsPerWeek,
    });
  }
  if (limit.maxRequestsPerMonth) {
    checks.push({
      limitType: "monthly_requests",
      current: usage.monthlyRequests,
      max: limit.maxRequestsPerMonth,
    });
  }
  if (limit.maxStoriesPerWeek) {
    checks.push({
      limitType: "weekly_stories",
      current: usage.weeklyStories,
      max: limit.maxStoriesPerWeek,
    });
  }
  if (limit.maxStoriesPerMonth) {
    checks.push({
      limitType: "monthly_stories",
      current: usage.monthlyStories,
      max: limit.maxStoriesPerMonth,
    });
  }

  return checks;
}

export function buildUsageNotificationMessage(
  limitType: string,
  thresholdPct: number,
  currentUsage: number,
  limitValue: number
): string {
  const label = usageNotificationLabel(limitType);
  if (thresholdPct >= 100) {
    return `You have reached your ${label} limit (${currentUsage.toLocaleString()} / ${limitValue.toLocaleString()}). Further requests will be blocked until the limit resets.`;
  }
  return `You have used ${thresholdPct}% of your ${label} limit (${currentUsage.toLocaleString()} / ${limitValue.toLocaleString()}).`;
}

function usageNotificationLabel(limitType: string): string {
  const labels: Record<string, string> = {
    daily_tokens: "daily token",
    weekly_tokens: "weekly token",
    monthly_tokens: "monthly token",
    daily_requests: "daily request",
    weekly_requests: "weekly request",
    monthly_requests: "monthly request",
    weekly_stories: "weekly story",
    monthly_stories: "monthly case study",
    monthly_budget_tokens: "monthly AI token budget",
    monthly_budget_cost: "monthly AI spend budget",
    daily_spend_org: "daily AI spend",
    daily_spend_anomaly: "daily AI spend anomaly baseline",
  };
  return labels[limitType] ?? limitType;
}
