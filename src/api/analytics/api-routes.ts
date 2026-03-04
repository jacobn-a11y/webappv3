/**
 * Analytics API Routes (JSON)
 *
 * GET /             — All analytics data as JSON
 * GET /revops-kpis  — RevOps KPI metrics (90-day window)
 */

import { type Response, type Router } from "express";
import type { PrismaClient } from "@prisma/client";
import type { AuthenticatedRequest } from "../../types/authenticated-request.js";
import { type AnalyticsService, type AnalyticsDashboardData, type RevOpsKpiData } from "../../services/analytics.js";
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
  revopsKpiCache: ResponseCache<RevOpsKpiData>;
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
    if (!req.organizationId!) {
      sendUnauthorized(res, "Authentication required");
      return;
    }

      const data = await analyticsCache.getOrSet(req.organizationId!, () =>
        analytics.getDashboardData(req.organizationId! as string)
      );
      sendSuccess(res, data);

  }));

  router.get(
    "/revops-kpis",
    requirePermission(prisma, "view_analytics"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const organizationId = req.organizationId!;
      const payload = await revopsKpiCache.getOrSet(
        `${organizationId}:revops-kpis`,
        () => analytics.getRevOpsKpis(organizationId)
      );
      sendSuccess(res, payload);
    })
  );
}
