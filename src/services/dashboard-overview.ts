import type { PrismaClient } from "@prisma/client";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HomePageData {
  assignment: {
    roleProfile: { key: string; name: string; permissions: string[] } | null;
  } | null;
  user: { name: string | null; email: string; role: string } | null;
  stories30d: number;
  pages30d: number;
  failedIntegrations: number;
  pendingApprovals: number;
}

export interface FunnelCounts {
  postSaleStories: number;
  mofuStories: number;
  bofuStories: number;
  totalPageViews: number;
}

export interface CustomerSuccessRawData {
  totalUsers: number;
  activeUsers30dCount: number;
  stories30d: number;
  pages30d: number;
  failedIntegrations: number;
  pendingApprovals: number;
  setup: {
    recordingProvider: string | null;
    crmProvider: string | null;
    syncedAccountCount: number;
    selectedPlan: string | null;
    permissionsConfiguredAt: Date | null;
  } | null;
  assignments: Array<{
    userId: string;
    roleProfile: { key: string } | null;
  }>;
  teamWorkspaceCounts: Array<{ team: string; _count: number }>;
  sharedAssetCounts: Array<{ visibility: string; _count: number }>;
}

export interface RenewalValueRawData {
  usage90d: Array<{ metric: string; _sum: { quantity: number | null } }>;
  storyCount90d: number;
  pageCount90d: number;
  publishedPages90d: number;
  activeUsers30dCount: number;
  totalUsers: number;
  subscription: {
    status: string;
    billingInterval: string | null;
    currentPeriodEnd: Date | null;
    contractValue: number | null;
  } | null;
  topTopics: Array<{ topic: string; _count: number }>;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class DashboardOverviewService {
  constructor(private prisma: PrismaClient) {}

  async getHomePageData(
    organizationId: string,
    userId: string
  ): Promise<HomePageData> {
    const [assignment, user, stories30d, pages30d, failedIntegrations, pendingApprovals] =
      await Promise.all([
        this.prisma.userRoleAssignment.findUnique({
          where: { userId },
          include: { roleProfile: true },
        }),
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { name: true, email: true, role: true },
        }),
        this.prisma.story.count({
          where: {
            organizationId,
            generatedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          },
        }),
        this.prisma.landingPage.count({
          where: {
            organizationId,
            createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          },
        }),
        this.prisma.integrationConfig.count({
          where: {
            organizationId,
            status: "ERROR",
          },
        }),
        this.prisma.approvalRequest.count({
          where: {
            organizationId,
            status: "PENDING",
          },
        }),
      ]);

    return { assignment, user, stories30d, pages30d, failedIntegrations, pendingApprovals };
  }

  async getFunnelCounts(organizationId: string): Promise<FunnelCounts> {
    const days30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [postSaleStories, mofuStories, bofuStories, pageViewsSum] = await Promise.all([
      this.prisma.story.count({
        where: {
          organizationId,
          funnelStages: { has: "POST_SALE" },
          generatedAt: { gte: days30 },
        },
      }),
      this.prisma.story.count({
        where: {
          organizationId,
          funnelStages: { has: "MOFU" },
          generatedAt: { gte: days30 },
        },
      }),
      this.prisma.story.count({
        where: {
          organizationId,
          funnelStages: { has: "BOFU" },
          generatedAt: { gte: days30 },
        },
      }),
      this.prisma.landingPage.aggregate({
        where: { organizationId },
        _sum: { viewCount: true },
      }),
    ]);

    return {
      postSaleStories,
      mofuStories,
      bofuStories,
      totalPageViews: pageViewsSum._sum.viewCount ?? 0,
    };
  }

  async getCustomerSuccessRawData(organizationId: string): Promise<CustomerSuccessRawData> {
    const days30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      activeUsers30dRows,
      stories30d,
      pages30d,
      failedIntegrations,
      pendingApprovals,
      setup,
      assignments,
      teamWorkspaceCounts,
      sharedAssetCounts,
    ] = await Promise.all([
      this.prisma.user.count({ where: { organizationId } }),
      this.prisma.aIUsageRecord.findMany({
        where: {
          organizationId,
          createdAt: { gte: days30 },
        },
        distinct: ["userId"],
        select: { userId: true },
      }),
      this.prisma.story.count({
        where: { organizationId, generatedAt: { gte: days30 } },
      }),
      this.prisma.landingPage.count({
        where: { organizationId, createdAt: { gte: days30 } },
      }),
      this.prisma.integrationConfig.count({
        where: { organizationId, status: "ERROR" },
      }),
      this.prisma.approvalRequest.count({
        where: { organizationId, status: "PENDING" },
      }),
      this.prisma.setupWizard.findUnique({
        where: { organizationId },
      }),
      this.prisma.userRoleAssignment.findMany({
        where: { roleProfile: { organizationId } },
        include: { roleProfile: { select: { key: true } } },
      }),
      this.prisma.teamWorkspace.groupBy({
        by: ["team"],
        where: { organizationId },
        _count: true,
      }),
      this.prisma.sharedAsset.groupBy({
        by: ["visibility"],
        where: { organizationId },
        _count: true,
      }),
    ]);

    return {
      totalUsers,
      activeUsers30dCount: activeUsers30dRows.length,
      stories30d,
      pages30d,
      failedIntegrations,
      pendingApprovals,
      setup,
      assignments,
      teamWorkspaceCounts,
      sharedAssetCounts,
    };
  }

  async getRenewalValueRawData(organizationId: string): Promise<RenewalValueRawData> {
    const now = Date.now();
    const days90 = new Date(now - 90 * 24 * 60 * 60 * 1000);
    const days30 = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const [
      usage90d,
      storyCount90d,
      pageCount90d,
      publishedPages90d,
      activeUsers30dRows,
      totalUsers,
      subscription,
      topTopics,
    ] = await Promise.all([
      this.prisma.usageRecord.groupBy({
        by: ["metric"],
        where: {
          organizationId,
          periodStart: { gte: days90 },
        },
        _sum: { quantity: true },
      }),
      this.prisma.story.count({
        where: { organizationId, generatedAt: { gte: days90 } },
      }),
      this.prisma.landingPage.count({
        where: { organizationId, createdAt: { gte: days90 } },
      }),
      this.prisma.landingPage.count({
        where: {
          organizationId,
          status: "PUBLISHED",
          publishedAt: { gte: days90 },
        },
      }),
      this.prisma.aIUsageRecord.findMany({
        where: { organizationId, createdAt: { gte: days30 } },
        distinct: ["userId"],
        select: { userId: true },
      }),
      this.prisma.user.count({ where: { organizationId } }),
      this.prisma.subscription.findFirst({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.callTag.groupBy({
        by: ["topic"],
        where: {
          call: { organizationId },
        },
        _count: true,
        orderBy: { _count: { topic: "desc" } },
        take: 5,
      }),
    ]);

    return {
      usage90d,
      storyCount90d,
      pageCount90d,
      publishedPages90d,
      activeUsers30dCount: activeUsers30dRows.length,
      totalUsers,
      subscription,
      topTopics,
    };
  }
}
