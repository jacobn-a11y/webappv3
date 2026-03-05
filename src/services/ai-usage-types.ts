import type { AIOperation } from "@prisma/client";

export interface UsageContext {
  organizationId: string;
  userId: string;
  operation: AIOperation;
}

export interface UsageSummary {
  dailyTokens: number;
  weeklyTokens: number;
  monthlyTokens: number;
  dailyRequests: number;
  weeklyRequests: number;
  monthlyRequests: number;
  weeklyStories: number;
  monthlyStories: number;
}

export interface LimitStatus {
  allowed: boolean;
  reason?: string;
  usage: UsageSummary;
  limits: {
    maxTokensPerWeek: number | null;
    maxTokensPerDay: number | null;
    maxTokensPerMonth: number | null;
    maxRequestsPerWeek: number | null;
    maxRequestsPerDay: number | null;
    maxRequestsPerMonth: number | null;
    maxStoriesPerWeek: number | null;
    maxStoriesPerMonth: number | null;
  };
  balance?: { balanceCents: number; lifetimeSpentCents: number } | null;
}

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
