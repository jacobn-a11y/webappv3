import type { PrismaClient, UserRole } from "@prisma/client";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OrgAISettingsPayload {
  default_provider: string;
  default_model: string;
  per_seat_token_budget_per_month?: number | null;
  per_seat_stories_per_month?: number | null;
  max_stories_per_month?: number | null;
}

export interface RoleDefaultPayload {
  role: UserRole;
  allowed_providers?: string[];
  allowed_models?: string[];
  max_tokens_per_day?: number | null;
  max_tokens_per_month?: number | null;
  max_stories_per_month?: number | null;
  max_requests_per_day?: number | null;
}

export interface UserAccessPayload {
  user_id: string;
  allowed_providers?: string[];
  allowed_models?: string[];
  denied_providers?: string[];
  denied_models?: string[];
}

export interface UsageSummaryBucket {
  userId: string;
  userName: string | null;
  userEmail: string;
  totalTokens: number;
  totalCostCents: number;
  totalRequests: number;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class AISettingsService {
  constructor(private prisma: PrismaClient) {}

  // ─── Org AI Settings ─────────────────────────────────────────────────

  async getOrgSettings(organizationId: string) {
    return this.prisma.orgAISettings.findUnique({
      where: { organizationId },
    });
  }

  async upsertOrgSettings(
    organizationId: string,
    payload: OrgAISettingsPayload
  ): Promise<void> {
    await this.prisma.orgAISettings.upsert({
      where: { organizationId },
      create: {
        organizationId,
        defaultProvider: payload.default_provider,
        defaultModel: payload.default_model,
        perSeatTokenBudgetPerMonth: payload.per_seat_token_budget_per_month,
        perSeatStoriesPerMonth: payload.per_seat_stories_per_month,
        maxStoriesPerMonth: payload.max_stories_per_month,
      },
      update: {
        defaultProvider: payload.default_provider,
        defaultModel: payload.default_model,
        perSeatTokenBudgetPerMonth: payload.per_seat_token_budget_per_month,
        perSeatStoriesPerMonth: payload.per_seat_stories_per_month,
        maxStoriesPerMonth: payload.max_stories_per_month,
      },
    });
  }

  // ─── Role Defaults ───────────────────────────────────────────────────

  async listRoleDefaults(organizationId: string) {
    return this.prisma.orgAIRoleDefault.findMany({
      where: { organizationId },
      orderBy: { role: "asc" },
    });
  }

  async upsertRoleDefault(
    organizationId: string,
    payload: RoleDefaultPayload
  ): Promise<void> {
    await this.prisma.orgAIRoleDefault.upsert({
      where: {
        organizationId_role: {
          organizationId,
          role: payload.role,
        },
      },
      create: {
        organizationId,
        role: payload.role,
        allowedProviders: payload.allowed_providers ?? [],
        allowedModels: payload.allowed_models ?? [],
        maxTokensPerDay: payload.max_tokens_per_day,
        maxTokensPerMonth: payload.max_tokens_per_month,
        maxStoriesPerMonth: payload.max_stories_per_month,
        maxRequestsPerDay: payload.max_requests_per_day,
      },
      update: {
        allowedProviders: payload.allowed_providers,
        allowedModels: payload.allowed_models,
        maxTokensPerDay: payload.max_tokens_per_day,
        maxTokensPerMonth: payload.max_tokens_per_month,
        maxStoriesPerMonth: payload.max_stories_per_month,
        maxRequestsPerDay: payload.max_requests_per_day,
      },
    });
  }

  async deleteRoleDefault(
    organizationId: string,
    role: UserRole
  ): Promise<void> {
    await this.prisma.orgAIRoleDefault.deleteMany({
      where: { organizationId, role },
    });
  }

  // ─── User Access ─────────────────────────────────────────────────────

  async listUserAccess(organizationId: string) {
    return this.prisma.userAIAccess.findMany({
      where: { organizationId },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
    });
  }

  async upsertUserAccess(
    organizationId: string,
    grantedById: string,
    payload: UserAccessPayload
  ): Promise<void> {
    await this.prisma.userAIAccess.upsert({
      where: {
        organizationId_userId: {
          organizationId,
          userId: payload.user_id,
        },
      },
      create: {
        organizationId,
        userId: payload.user_id,
        allowedProviders: payload.allowed_providers ?? [],
        allowedModels: payload.allowed_models ?? [],
        deniedProviders: payload.denied_providers ?? [],
        deniedModels: payload.denied_models ?? [],
        grantedById,
      },
      update: {
        allowedProviders: payload.allowed_providers,
        allowedModels: payload.allowed_models,
        deniedProviders: payload.denied_providers,
        deniedModels: payload.denied_models,
        grantedById,
      },
    });
  }

  async deleteUserAccess(
    organizationId: string,
    userId: string
  ): Promise<void> {
    await this.prisma.userAIAccess.deleteMany({
      where: { organizationId, userId },
    });
  }

  // ─── Usage Summary ───────────────────────────────────────────────────

  async getUsageSummary(
    organizationId: string,
    periodStart: Date
  ): Promise<UsageSummaryBucket[]> {
    const byUser = await this.prisma.aIUsageRecord.groupBy({
      by: ["userId"],
      where: {
        organizationId,
        createdAt: { gte: periodStart },
      },
      _sum: { totalTokens: true, costCents: true },
      _count: true,
    });

    const userIds = byUser.map((bucket) => bucket.userId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map((user) => [user.id, user]));

    return byUser.map((bucket) => {
      const user = userMap.get(bucket.userId);
      return {
        userId: bucket.userId,
        userName: user?.name ?? null,
        userEmail: user?.email ?? "unknown",
        totalTokens: bucket._sum.totalTokens ?? 0,
        totalCostCents: bucket._sum.costCents ?? 0,
        totalRequests: bucket._count,
      };
    });
  }
}
