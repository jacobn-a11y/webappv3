/**
 * Analytics API Routes (JSON)
 *
 * GET /             — All analytics data as JSON
 * GET /revops-kpis  — RevOps KPI metrics (90-day window)
 */

import { type Response, type Router } from "express";
import type { PrismaClient } from "@prisma/client";
import type { AuthenticatedRequest } from "../../types/authenticated-request.js";
import { type AnalyticsService, type AnalyticsDashboardData } from "../../services/analytics.js";
import { requirePermission } from "../../middleware/permissions.js";
import type { ResponseCache } from "../../lib/response-cache.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { sendUnauthorized, sendSuccess } from "../_shared/responses.js";

// ─── Route Registration ─────────────────────────────────────────────────────

interface RegisterApiRoutesOptions {
  router: Router;
  prisma: PrismaClient;
  analytics: AnalyticsService;
  analyticsCache: ResponseCache<AnalyticsDashboardData>;
  revopsKpiCache: ResponseCache<Record<string, unknown>>;
}

export function registerApiRoutes({
  router,
  prisma,
  analytics,
  analyticsCache,
  revopsKpiCache,
}: RegisterApiRoutesOptions): void {
  /**
   * GET /api/analytics
   *
   * Returns all analytics data as JSON.
   */
  router.get("/", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.organizationId) {
      sendUnauthorized(res, "Authentication required");
      return;
    }

      const data = await analyticsCache.getOrSet(req.organizationId, () =>
        analytics.getDashboardData(req.organizationId as string)
      );
      sendSuccess(res, data);

  }));

  router.get(
    "/revops-kpis",
    requirePermission(prisma, "view_analytics"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const organizationId = req.organizationId;
      const payload = await revopsKpiCache.getOrSet(
      `${organizationId}:revops-kpis`,
      async () => {
        const windowStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

      const [
      accountsWithCalls,
      accountsWithOppEvents,
      stageEvents,
      closedWon,
      closedLost,
      recentCalls,
      objectionTags,
      stories90d,
      ] = await Promise.all([
      prisma.call.groupBy({
        by: ["accountId"],
        where: { organizationId, accountId: { not: null }, occurredAt: { gte: windowStart } },
        _count: { _all: true },
      }),
      prisma.salesforceEvent.groupBy({
        by: ["accountId"],
        where: {
          account: { organizationId },
          createdAt: { gte: windowStart },
          eventType: {
            in: ["OPPORTUNITY_CREATED", "OPPORTUNITY_STAGE_CHANGE", "CLOSED_WON", "CLOSED_LOST"],
          },
        },
        _count: { _all: true },
      }),
      prisma.salesforceEvent.groupBy({
        by: ["stageName"],
        where: {
          account: { organizationId },
          createdAt: { gte: windowStart },
          stageName: { not: null },
        },
        _count: { _all: true },
      }),
      prisma.salesforceEvent.count({
        where: {
          account: { organizationId },
          createdAt: { gte: windowStart },
          eventType: "CLOSED_WON",
        },
      }),
      prisma.salesforceEvent.count({
        where: {
          account: { organizationId },
          createdAt: { gte: windowStart },
          eventType: "CLOSED_LOST",
        },
      }),
      prisma.call.findMany({
        where: { organizationId, occurredAt: { gte: windowStart } },
        select: { id: true, transcript: { select: { fullText: true } } },
        take: 500,
      }),
      prisma.callTag.groupBy({
        by: ["topic"],
        where: {
          call: { organizationId, occurredAt: { gte: windowStart } },
          funnelStage: { in: ["MOFU", "BOFU", "INTERNAL"] },
        },
        _count: { _all: true },
        orderBy: { _count: { topic: "desc" } },
        take: 10,
      }),
      prisma.story.findMany({
        where: { organizationId, generatedAt: { gte: windowStart } },
        select: { id: true, accountId: true, title: true, markdownBody: true, generatedAt: true },
        take: 500,
      }),
      ]);

      const callsByAccount = new Set(accountsWithCalls.map((r) => r.accountId).filter(Boolean));
      const oppByAccount = new Set(accountsWithOppEvents.map((r) => r.accountId));
      const influencedAccounts = Array.from(callsByAccount).filter((id) =>
      oppByAccount.has(id as string)
      ).length;
      const pipelineInfluenceRate =
      oppByAccount.size === 0 ? 0 : Number(((influencedAccounts / oppByAccount.size) * 100).toFixed(2));

      const competitorRegex = /\b(competitor|alternative|displace|replacement|vs\.?|versus)\b/i;
      const objectionRegex = /\b(objection|concern|risk|blocked|pushback)\b/i;
      let competitorMentions = 0;
      let objectionMentions = 0;
      for (const c of recentCalls) {
      const text = c.transcript?.fullText ?? "";
      if (competitorRegex.test(text)) competitorMentions += 1;
      if (objectionRegex.test(text)) objectionMentions += 1;
      }

      const attributionLinkedStories = stories90d.filter((s) => s.accountId !== null).length;
      const attributionLinkedCalls = accountsWithCalls.reduce((acc, r) => acc + r._count._all, 0);
      const attributionLinkedOppEvents = accountsWithOppEvents.reduce(
      (acc, r) => acc + r._count._all,
      0
      );

      const winRate =
      closedWon + closedLost === 0
        ? 0
        : Number(((closedWon / (closedWon + closedLost)) * 100).toFixed(2));

        return {
          window_days: 90,
          pipeline_influence: {
            influenced_accounts: influencedAccounts,
            accounts_with_pipeline_events: oppByAccount.size,
            influence_rate_percent: pipelineInfluenceRate,
          },
          conversion_by_stage: stageEvents.map((s) => ({
            stage_name: s.stageName,
            count: s._count._all,
          })),
          win_loss: {
            closed_won: closedWon,
            closed_lost: closedLost,
            win_rate_percent: winRate,
          },
          persona_objections: {
            transcript_level_objection_mentions: objectionMentions,
            top_objection_topics: objectionTags.map((o) => ({
              topic: o.topic,
              count: o._count._all,
            })),
          },
          competitor_mentions: {
            transcript_level_competitor_mentions: competitorMentions,
          },
          attribution_links: {
            linked_calls: attributionLinkedCalls,
            linked_stories: attributionLinkedStories,
            linked_opportunity_events: attributionLinkedOppEvents,
            linked_campaigns: 0,
            note: "Campaign attribution requires campaign object integration; currently not available in this schema.",
          },
          executive_summary: [
            `Pipeline influence rate is ${pipelineInfluenceRate}% across ${oppByAccount.size} active pipeline accounts.`,
            `Win rate is ${winRate}% from ${closedWon + closedLost} closed opportunities in the last 90 days.`,
            `Detected ${competitorMentions} competitor-mention calls and ${objectionMentions} objection-mention calls.`,
          ],
        };
      }
      );
      sendSuccess(res, payload);

    }
  ));
}
