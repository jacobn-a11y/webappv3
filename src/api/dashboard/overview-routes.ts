import { type Request, type Response, type Router } from "express";
import type { PrismaClient, UserRole } from "@prisma/client";
import type { LandingPageEditor } from "../../services/landing-page-editor.js";
import type { ResponseCache } from "../../lib/response-cache.js";
import logger from "../../lib/logger.js";
import { Sentry } from "../../lib/sentry.js";

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

interface RegisterDashboardOverviewRoutesOptions {
  router: Router;
  prisma: PrismaClient;
  editor: LandingPageEditor;
  homeCache: ResponseCache<Record<string, unknown>>;
}

export function registerDashboardOverviewRoutes({
  router,
  prisma,
  editor,
  homeCache,
}: RegisterDashboardOverviewRoutesOptions): void {
  const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, value));

  // ── Dashboard Overview ──────────────────────────────────────────────

  router.get("/home", async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const cacheKey = `${req.organizationId}:${req.userId}:${req.userRole ?? "MEMBER"}`;
      const payload = await homeCache.getOrSet(cacheKey, async () => {
        const [assignment, user, stories30d, pages30d, failedIntegrations, pendingApprovals] =
          await Promise.all([
            prisma.userRoleAssignment.findUnique({
              where: { userId: req.userId },
              include: { roleProfile: true },
            }),
            prisma.user.findUnique({
              where: { id: req.userId },
              select: { name: true, email: true, role: true },
            }),
            prisma.story.count({
              where: {
                organizationId: req.organizationId,
                generatedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
              },
            }),
            prisma.landingPage.count({
              where: {
                organizationId: req.organizationId,
                createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
              },
            }),
            prisma.integrationConfig.count({
              where: {
                organizationId: req.organizationId,
                status: "ERROR",
              },
            }),
            prisma.approvalRequest.count({
              where: {
                organizationId: req.organizationId,
                status: "PENDING",
              },
            }),
          ]);

        const roleKey = assignment?.roleProfile?.key ?? null;
        const baseRole = req.userRole ?? user?.role ?? "MEMBER";
        let persona: "REVOPS_ADMIN" | "MARKETING_ANALYST" | "SALES_MANAGER" | "CSM" | "EXEC" =
          "REVOPS_ADMIN";

        // Safe default based on base role (least-privilege)
        if (baseRole === "VIEWER") persona = "EXEC";
        else if (baseRole === "MEMBER") persona = "MARKETING_ANALYST";

        // Override with role profile if assigned
        if (roleKey === "EXEC") persona = "EXEC";
        else if (roleKey === "SALES") persona = "SALES_MANAGER";
        else if (roleKey === "CS") persona = "CSM";
        else if (roleKey === "REVOPS" || baseRole === "OWNER" || baseRole === "ADMIN") {
          persona = "REVOPS_ADMIN";
        } else if (assignment?.roleProfile?.permissions.includes("VIEW_ANALYTICS")) {
          persona = "MARKETING_ANALYST";
        }

        const [postSaleStories, mofuStories, bofuStories, pageViewsSum] = await Promise.all([
          prisma.story.count({
            where: {
              organizationId: req.organizationId,
              funnelStages: { has: "POST_SALE" },
              generatedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
            },
          }),
          prisma.story.count({
            where: {
              organizationId: req.organizationId,
              funnelStages: { has: "MOFU" },
              generatedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
            },
          }),
          prisma.story.count({
            where: {
              organizationId: req.organizationId,
              funnelStages: { has: "BOFU" },
              generatedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
            },
          }),
          prisma.landingPage.aggregate({
            where: { organizationId: req.organizationId },
            _sum: { viewCount: true },
          }),
        ]);

        return {
          user: {
            id: req.userId,
            name: user?.name ?? null,
            email: user?.email ?? null,
            base_role: baseRole,
            role_profile_key: roleKey,
            role_profile_name: assignment?.roleProfile?.name ?? null,
          },
          persona,
          summary: {
            stories_30d: stories30d,
            pages_30d: pages30d,
            failed_integrations: failedIntegrations,
            pending_approvals: pendingApprovals,
            post_sale_stories_30d: postSaleStories,
            mofu_stories_30d: mofuStories,
            bofu_stories_30d: bofuStories,
            total_page_views: pageViewsSum._sum.viewCount ?? 0,
          },
          recommended_actions:
            persona === "REVOPS_ADMIN"
              ? [
                  "Review pending approvals and governance queue.",
                  "Resolve failed integrations and stale syncs.",
                  "Confirm billing readiness and seat allocations.",
                ]
              : persona === "MARKETING_ANALYST"
                ? [
                    "Review MOFU and BOFU story trends for campaign planning.",
                    "Export approved assets for campaign channels.",
                    "Validate attribution links and conversion signals.",
                  ]
                : persona === "SALES_MANAGER"
                  ? [
                      "Generate BOFU ROI stories for active pipeline deals.",
                      "Publish customer proof pages for reps.",
                      "Review competitor and objection themes this week.",
                    ]
                  : persona === "CSM"
                    ? [
                        "Generate post-sale expansion and adoption stories.",
                        "Track renewals and customer health signals.",
                        "Publish anonymized customer success highlights.",
                      ]
                    : [
                        "Review executive KPI summary and growth trends.",
                        "Inspect strategic impact and risk signals.",
                        "Track ROI outcomes across published stories.",
                      ],
        };
      });

      res.json(payload);
    } catch (err) {
      logger.error("Get role-aware home error", { error: err });
      res.status(500).json({ error: "Failed to load role-aware home" });
    }
  });

  router.get("/customer-success/health", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    try {
      const orgId = req.organizationId;
      const now = Date.now();
      const days30 = new Date(now - 30 * 24 * 60 * 60 * 1000);

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
        prisma.user.count({ where: { organizationId: orgId } }),
        prisma.aIUsageRecord.findMany({
          where: {
            organizationId: orgId,
            createdAt: { gte: days30 },
          },
          distinct: ["userId"],
          select: { userId: true },
        }),
        prisma.story.count({
          where: { organizationId: orgId, generatedAt: { gte: days30 } },
        }),
        prisma.landingPage.count({
          where: { organizationId: orgId, createdAt: { gte: days30 } },
        }),
        prisma.integrationConfig.count({
          where: { organizationId: orgId, status: "ERROR" },
        }),
        prisma.approvalRequest.count({
          where: { organizationId: orgId, status: "PENDING" },
        }),
        prisma.setupWizard.findUnique({
          where: { organizationId: orgId },
        }),
        prisma.userRoleAssignment.findMany({
          where: { roleProfile: { organizationId: orgId } },
          include: { roleProfile: { select: { key: true } } },
        }),
        prisma.teamWorkspace.groupBy({
          by: ["team"],
          where: { organizationId: orgId },
          _count: true,
        }),
        prisma.sharedAsset.groupBy({
          by: ["visibility"],
          where: { organizationId: orgId },
          _count: true,
        }),
      ]);

      const activeUsers30d = activeUsers30dRows.length;
      const adoptionRatePct =
        totalUsers > 0 ? Math.round((activeUsers30d / totalUsers) * 100) : 0;

      const setupSteps = setup
        ? [
            !!setup.recordingProvider,
            !!setup.crmProvider,
            setup.syncedAccountCount > 0,
            !!setup.selectedPlan,
            !!setup.permissionsConfiguredAt,
          ]
        : [false, false, false, false, false];
      const onboardingProgressPct = Math.round(
        (setupSteps.filter(Boolean).length / setupSteps.length) * 100
      );

      const onboardingScore = onboardingProgressPct;
      const adoptionScore = clamp(
        Math.round(
          adoptionRatePct * 0.55 +
            Math.min(100, stories30d * 0.7) * 0.25 +
            Math.min(100, pages30d * 1.2) * 0.2
        ),
        0,
        100
      );
      const reliabilityScore = clamp(
        100 - failedIntegrations * 18 - pendingApprovals * 2,
        0,
        100
      );
      const overallScore = Math.round(
        onboardingScore * 0.3 + adoptionScore * 0.4 + reliabilityScore * 0.3
      );

      const teamMemberBuckets: Record<string, Set<string>> = {
        REVOPS: new Set<string>(),
        MARKETING: new Set<string>(),
        SALES: new Set<string>(),
        CS: new Set<string>(),
      };
      for (const assignment of assignments) {
        if (assignment.roleProfile?.key == null) continue;
        const key = assignment.roleProfile?.key ?? "REVOPS";
        const team =
          key === "SALES"
            ? "SALES"
            : key === "CS"
              ? "CS"
              : key.includes("MARKETING")
                ? "MARKETING"
                : "REVOPS";
        teamMemberBuckets[team].add(assignment.userId);
      }

      const workspaceCountMap = Object.fromEntries(
        teamWorkspaceCounts.map((r) => [r.team, r._count])
      ) as Record<string, number>;
      const totalSharedAssets = sharedAssetCounts.reduce(
        (sum, r) => sum + r._count,
        0
      );

      const teams = (["REVOPS", "MARKETING", "SALES", "CS"] as const).map((team) => {
        const members = teamMemberBuckets[team].size;
        const workspaceCount = workspaceCountMap[team] ?? 0;
        const score = clamp(
          Math.round(
            (members > 0 ? 35 : 0) +
              Math.min(30, workspaceCount * 15) +
              Math.min(35, totalSharedAssets * 2)
          ),
          0,
          100
        );
        return {
          team,
          members,
          workspace_count: workspaceCount,
          score,
          risk: score < 40 ? "HIGH" : score < 70 ? "MEDIUM" : "LOW",
        };
      });

      const riskIndicators: string[] = [];
      if (failedIntegrations > 0) {
        riskIndicators.push(`${failedIntegrations} integration(s) in ERROR state.`);
      }
      if (pendingApprovals > 10) {
        riskIndicators.push(`Approval backlog is high (${pendingApprovals} pending).`);
      }
      if (onboardingProgressPct < 100) {
        riskIndicators.push(
          `Onboarding incomplete (${onboardingProgressPct}% complete).`
        );
      }
      if (adoptionRatePct < 40) {
        riskIndicators.push(`Low active-user adoption (${adoptionRatePct}% in 30d).`);
      }

      res.json({
        overall_score: overallScore,
        onboarding_progress_pct: onboardingProgressPct,
        adoption_rate_pct: adoptionRatePct,
        reliability_score: reliabilityScore,
        teams,
        risk_indicators: riskIndicators,
      });
    } catch (err) {
      logger.error("Customer success health error", { error: err });
      res.status(500).json({ error: "Failed to load customer success health" });
    }
  });

  router.get(
    "/customer-success/renewal-value-report",
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      try {
        const orgId = req.organizationId;
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
          prisma.usageRecord.groupBy({
            by: ["metric"],
            where: {
              organizationId: orgId,
              periodStart: { gte: days90 },
            },
            _sum: { quantity: true },
          }),
          prisma.story.count({
            where: { organizationId: orgId, generatedAt: { gte: days90 } },
          }),
          prisma.landingPage.count({
            where: { organizationId: orgId, createdAt: { gte: days90 } },
          }),
          prisma.landingPage.count({
            where: {
              organizationId: orgId,
              status: "PUBLISHED",
              publishedAt: { gte: days90 },
            },
          }),
          prisma.aIUsageRecord.findMany({
            where: { organizationId: orgId, createdAt: { gte: days30 } },
            distinct: ["userId"],
            select: { userId: true },
          }),
          prisma.user.count({ where: { organizationId: orgId } }),
          prisma.subscription.findFirst({
            where: { organizationId: orgId },
            orderBy: { createdAt: "desc" },
          }),
          prisma.callTag.groupBy({
            by: ["topic"],
            where: {
              call: { organizationId: orgId },
            },
            _count: true,
            orderBy: { _count: { topic: "desc" } },
            take: 5,
          }),
        ]);

        const usage_by_metric = Object.fromEntries(
          usage90d.map((row) => [row.metric, row._sum.quantity ?? 0])
        );
        const activeUsers30d = activeUsers30dRows.length;
        const adoptionRatePct =
          totalUsers > 0 ? Math.round((activeUsers30d / totalUsers) * 100) : 0;

        const renewalHealth =
          adoptionRatePct >= 65 && publishedPages90d >= 5
            ? "STRONG"
            : adoptionRatePct >= 40
              ? "WATCH"
              : "AT_RISK";

        const headline =
          renewalHealth === "STRONG"
            ? "Adoption and output trends support a strong renewal narrative."
            : renewalHealth === "WATCH"
              ? "Renewal is viable, but adoption and output should improve before procurement review."
              : "Renewal risk is elevated due to low adoption and limited published outcomes.";

        const roiNarrative = [
          `In the last 90 days, your teams generated ${storyCount90d} stories and ${publishedPages90d} published pages.`,
          `30-day active-user adoption is ${adoptionRatePct}% (${activeUsers30d}/${totalUsers}).`,
          `Top recurring evidence themes: ${topTopics.map((t) => t.topic).join(", ") || "none yet"}.`,
          `Current renewal posture: ${renewalHealth}.`,
        ].join(" ");

        res.json({
          window_days: 90,
          renewal_health: renewalHealth,
          headline,
          usage_by_metric,
          outcomes: {
            stories_generated_90d: storyCount90d,
            pages_created_90d: pageCount90d,
            pages_published_90d: publishedPages90d,
            active_users_30d: activeUsers30d,
            total_users: totalUsers,
            adoption_rate_pct: adoptionRatePct,
            top_topics: topTopics.map((t) => ({
              topic: t.topic,
              count: t._count,
            })),
          },
          contract_context: {
            subscription_status: subscription?.status ?? null,
            billing_interval: subscription?.billingInterval ?? null,
            current_period_end: subscription?.currentPeriodEnd?.toISOString() ?? null,
            contract_value_cents: subscription?.contractValue ?? null,
          },
          roi_narrative: roiNarrative,
        });
      } catch (err) {
        logger.error("Customer success renewal value report error", { error: err });
        res.status(500).json({ error: "Failed to load renewal value report" });
      }
    }
  );

  /**
   * GET /api/dashboard/stats
   *
   * Returns aggregate stats for the landing pages dashboard.
   */
  router.get("/stats", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const stats = await editor.getDashboardStats(req.organizationId);
      res.json(stats);
    } catch (err) {
      logger.error("Dashboard stats error", { error: err });
      Sentry.captureException(err);
      res.status(500).json({ error: "Failed to load dashboard stats" });
    }
  });

  /**
   * GET /api/dashboard/pages
   *
   * Lists all landing pages for the org with optional filters.
   * Query params: status, created_by, search
   */
  router.get("/pages", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const pages = await editor.listForOrg(req.organizationId, {
        status: req.query.status as string | undefined as
          | "DRAFT"
          | "PUBLISHED"
          | "ARCHIVED"
          | undefined,
        createdById: req.query.created_by as string | undefined,
        search: req.query.search as string | undefined,
      });

      res.json({ pages });
    } catch (err) {
      logger.error("Dashboard pages error", { error: err });
      Sentry.captureException(err);
      res.status(500).json({ error: "Failed to load pages" });
    }
  });

  /**
   * GET /api/dashboard/pages/data
   *
   * Combined endpoint returning stats + pages + creators + isAdmin
   * for the React DashboardPagesPage component.
   */
  router.get("/pages/data", async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const isAdmin = req.userRole && ["OWNER", "ADMIN"].includes(req.userRole);
    const effectiveCreatorFilter = isAdmin
      ? (req.query.created_by as string | undefined)
      : req.userId;

    try {
      const [dashboardStats, pages] = await Promise.all([
        editor.getDashboardStats(req.organizationId),
        editor.listForOrg(req.organizationId, {
          status: req.query.status as "DRAFT" | "PUBLISHED" | "ARCHIVED" | undefined,
          createdById: effectiveCreatorFilter,
          search: (req.query.search as string) || undefined,
        }),
      ]);

      const creators = isAdmin
        ? dashboardStats.pagesByUser.map((u) => ({
            userId: u.userId,
            name: u.name,
            email: u.name ?? u.userId,
          }))
        : [];

      res.json({
        stats: {
          totalPages: dashboardStats.totalPages,
          publishedPages: dashboardStats.publishedPages,
          draftPages: dashboardStats.draftPages,
          totalViews: dashboardStats.totalViews,
        },
        pages,
        creators,
        isAdmin: !!isAdmin,
      });
    } catch (err) {
      logger.error("Dashboard pages data error", { error: err });
      Sentry.captureException(err);
      res.status(500).json({ error: "Failed to load dashboard data" });
    }
  });
}
