/**
 * Accounts List Service
 *
 * Provides a searchable, filterable, paginated list of CRM accounts with
 * aggregated metrics (call counts, funnel stage distribution, story/page counts).
 *
 * Respects UserAccountAccess scoping — non-admin users only see accounts
 * they have been granted access to.
 */

import type { PrismaClient, FunnelStage, UserRole } from "@prisma/client";
import { AccountAccessService } from "./account-access.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AccountListFilters {
  search?: string;
  funnelStage?: FunnelStage;
  page?: number;
  limit?: number;
  sortBy?: AccountSortField;
  sortOrder?: "asc" | "desc";
}

export type AccountSortField =
  | "name"
  | "domain"
  | "totalCalls"
  | "lastCallDate"
  | "storyCount"
  | "landingPageCount"
  | "createdAt";

export interface FunnelStageCount {
  stage: FunnelStage;
  count: number;
}

export interface AccountListItem {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  totalCalls: number;
  lastCallDate: Date | null;
  storyCount: number;
  landingPageCount: number;
  funnelStageDistribution: FunnelStageCount[];
  createdAt: Date;
}

export interface AccountListResult {
  accounts: AccountListItem[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
  };
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class AccountsListService {
  private prisma: PrismaClient;
  private accessService: AccountAccessService;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.accessService = new AccountAccessService(prisma);
  }

  /**
   * Lists accounts for an organization with search, funnel stage filtering,
   * pagination, and access scoping.
   *
   * Admin/Owner users see all accounts. Other users only see accounts
   * they've been granted access to via UserAccountAccess.
   */
  async listAccounts(
    organizationId: string,
    userId: string,
    userRole: UserRole | undefined,
    filters: AccountListFilters
  ): Promise<AccountListResult> {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 25));
    const sortOrder = filters.sortOrder ?? "asc";

    // ── Access scoping ──────────────────────────────────────────────
    const accessibleIds = await this.accessService.getAccessibleAccountIds(
      userId,
      organizationId,
      userRole
    );

    // If user has no access to any accounts, return empty
    if (accessibleIds !== null && accessibleIds.length === 0) {
      return {
        accounts: [],
        pagination: { page, limit, totalCount: 0, totalPages: 0 },
      };
    }

    // ── Base where clause ───────────────────────────────────────────
    const where: Record<string, unknown> = { organizationId };

    // Scope to accessible accounts for non-admin users
    if (accessibleIds !== null) {
      where.id = { in: accessibleIds };
    }

    // Search by name (case-insensitive)
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: "insensitive" } },
        { domain: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    // ── Funnel stage pre-filter ─────────────────────────────────────
    // If filtering by funnel stage, find account IDs that have calls
    // tagged with that stage, then intersect with the base query.
    if (filters.funnelStage) {
      const taggedAccountIds = await this.getAccountIdsWithFunnelStage(
        organizationId,
        filters.funnelStage,
        accessibleIds
      );

      if (taggedAccountIds.length === 0) {
        return {
          accounts: [],
          pagination: { page, limit, totalCount: 0, totalPages: 0 },
        };
      }

      // Intersect with existing ID filter
      if (where.id) {
        const existing = new Set((where.id as { in: string[] }).in);
        where.id = { in: taggedAccountIds.filter((id) => existing.has(id)) };
      } else {
        where.id = { in: taggedAccountIds };
      }
    }

    // ── Count total matching accounts ───────────────────────────────
    const totalCount = await this.prisma.account.count({ where });
    const totalPages = Math.ceil(totalCount / limit);

    if (totalCount === 0) {
      return {
        accounts: [],
        pagination: { page, limit, totalCount: 0, totalPages: 0 },
      };
    }

    // ── Determine sort strategy ─────────────────────────────────────
    // For columns that live directly on the Account model, use Prisma orderBy.
    // For computed columns, we fetch and sort in-memory.
    const directSortFields: Record<string, string> = {
      name: "name",
      domain: "domain",
      createdAt: "createdAt",
    };

    const sortBy = filters.sortBy ?? "name";
    const isDirectSort = sortBy in directSortFields;

    // ── Fetch accounts ──────────────────────────────────────────────
    const accounts = await this.prisma.account.findMany({
      where,
      select: {
        id: true,
        name: true,
        domain: true,
        industry: true,
        createdAt: true,
      },
      orderBy: isDirectSort
        ? { [directSortFields[sortBy]]: sortOrder }
        : { name: "asc" }, // default sort for computed-column cases
      // For direct sorts, use DB-level pagination
      ...(isDirectSort
        ? { skip: (page - 1) * limit, take: limit }
        : {}),
    });

    // ── Aggregate metrics in batch ──────────────────────────────────
    const accountIds = accounts.map((a) => a.id);

    const [callMetrics, storyCounts, landingPageCounts, funnelDistributions] =
      await Promise.all([
        this.getCallMetrics(accountIds),
        this.getStoryCounts(accountIds),
        this.getLandingPageCounts(accountIds),
        this.getFunnelStageDistributions(accountIds),
      ]);

    // ── Assemble results ────────────────────────────────────────────
    let results: AccountListItem[] = accounts.map((account) => ({
      id: account.id,
      name: account.name,
      domain: account.domain,
      industry: account.industry,
      totalCalls: callMetrics.get(account.id)?.totalCalls ?? 0,
      lastCallDate: callMetrics.get(account.id)?.lastCallDate ?? null,
      storyCount: storyCounts.get(account.id) ?? 0,
      landingPageCount: landingPageCounts.get(account.id) ?? 0,
      funnelStageDistribution: funnelDistributions.get(account.id) ?? [],
      createdAt: account.createdAt,
    }));

    // ── Sort by computed columns if needed ───────────────────────────
    if (!isDirectSort) {
      results.sort((a, b) => {
        let cmp = 0;
        switch (sortBy) {
          case "totalCalls":
            cmp = a.totalCalls - b.totalCalls;
            break;
          case "lastCallDate":
            cmp =
              (a.lastCallDate?.getTime() ?? 0) -
              (b.lastCallDate?.getTime() ?? 0);
            break;
          case "storyCount":
            cmp = a.storyCount - b.storyCount;
            break;
          case "landingPageCount":
            cmp = a.landingPageCount - b.landingPageCount;
            break;
        }
        return sortOrder === "desc" ? -cmp : cmp;
      });

      // Apply pagination in-memory for computed sorts
      results = results.slice((page - 1) * limit, page * limit);
    }

    return {
      accounts: results,
      pagination: { page, limit, totalCount, totalPages },
    };
  }

  // ─── Private: Batch Aggregation Helpers ──────────────────────────────────

  /**
   * Returns total call count and most recent call date per account.
   */
  private async getCallMetrics(
    accountIds: string[]
  ): Promise<Map<string, { totalCalls: number; lastCallDate: Date | null }>> {
    if (accountIds.length === 0) return new Map();

    const groups = await this.prisma.call.groupBy({
      by: ["accountId"],
      where: { accountId: { in: accountIds } },
      _count: true,
      _max: { occurredAt: true },
    });

    const map = new Map<
      string,
      { totalCalls: number; lastCallDate: Date | null }
    >();
    for (const g of groups) {
      if (g.accountId) {
        map.set(g.accountId, {
          totalCalls: g._count,
          lastCallDate: g._max.occurredAt,
        });
      }
    }
    return map;
  }

  /**
   * Returns story count per account.
   */
  private async getStoryCounts(
    accountIds: string[]
  ): Promise<Map<string, number>> {
    if (accountIds.length === 0) return new Map();

    const groups = await this.prisma.story.groupBy({
      by: ["accountId"],
      where: { accountId: { in: accountIds } },
      _count: true,
    });

    return new Map(groups.map((g) => [g.accountId, g._count]));
  }

  /**
   * Returns landing page count per account (via Story → LandingPage).
   */
  private async getLandingPageCounts(
    accountIds: string[]
  ): Promise<Map<string, number>> {
    if (accountIds.length === 0) return new Map();

    const stories = await this.prisma.story.findMany({
      where: { accountId: { in: accountIds } },
      select: {
        accountId: true,
        _count: { select: { landingPages: true } },
      },
    });

    const map = new Map<string, number>();
    for (const s of stories) {
      map.set(s.accountId, (map.get(s.accountId) ?? 0) + s._count.landingPages);
    }
    return map;
  }

  /**
   * Returns funnel stage tag distribution per account.
   * Counts distinct calls per funnel stage for each account.
   */
  private async getFunnelStageDistributions(
    accountIds: string[]
  ): Promise<Map<string, FunnelStageCount[]>> {
    if (accountIds.length === 0) return new Map();

    // Get call IDs grouped by account, then aggregate tags by funnel stage
    const calls = await this.prisma.call.findMany({
      where: { accountId: { in: accountIds } },
      select: {
        accountId: true,
        tags: { select: { funnelStage: true } },
      },
    });

    // Count unique funnel stages per account
    const accountStageMap = new Map<string, Map<FunnelStage, Set<string>>>();

    for (const call of calls) {
      if (!call.accountId) continue;

      if (!accountStageMap.has(call.accountId)) {
        accountStageMap.set(call.accountId, new Map());
      }
      const stageMap = accountStageMap.get(call.accountId)!;

      // Collect unique stages for this call
      const seenStages = new Set<FunnelStage>();
      for (const tag of call.tags) {
        seenStages.add(tag.funnelStage);
      }

      // Count each stage once per call (not per tag)
      for (const stage of seenStages) {
        if (!stageMap.has(stage)) {
          stageMap.set(stage, new Set());
        }
        // Use the call itself as the unit — one call can only contribute once per stage
        stageMap.get(stage)!.add(`${call.accountId}-${stage}`);
      }
    }

    // Convert to FunnelStageCount[]
    const result = new Map<string, FunnelStageCount[]>();
    for (const [accountId, stageMap] of accountStageMap) {
      const distribution: FunnelStageCount[] = [];
      for (const [stage, callSet] of stageMap) {
        distribution.push({ stage, count: callSet.size });
      }
      // Sort by stage order: TOFU → MOFU → BOFU → POST_SALE → INTERNAL → VERTICAL
      const stageOrder: FunnelStage[] = [
        "TOFU",
        "MOFU",
        "BOFU",
        "POST_SALE",
        "INTERNAL",
        "VERTICAL",
      ];
      distribution.sort(
        (a, b) => stageOrder.indexOf(a.stage) - stageOrder.indexOf(b.stage)
      );
      result.set(accountId, distribution);
    }

    return result;
  }

  /**
   * Finds account IDs that have at least one call tagged with the given funnel stage.
   */
  private async getAccountIdsWithFunnelStage(
    organizationId: string,
    funnelStage: FunnelStage,
    accessibleIds: string[] | null
  ): Promise<string[]> {
    const callWhere: Record<string, unknown> = {
      organizationId,
      accountId: { not: null },
      tags: { some: { funnelStage } },
    };

    if (accessibleIds !== null) {
      callWhere.accountId = { in: accessibleIds };
    }

    const calls = await this.prisma.call.findMany({
      where: callWhere,
      select: { accountId: true },
      distinct: ["accountId"],
    });

    return calls
      .map((c) => c.accountId)
      .filter((id): id is string => id !== null);
  }
}
