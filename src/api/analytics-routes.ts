/**
 * Analytics Dashboard Routes — Compatibility Shim
 *
 * Delegates to decomposed sub-modules:
 *   - analytics/api-routes.ts
 *   - analytics/dashboard-renderer.ts
 */

import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { AnalyticsService, type AnalyticsDashboardData, type RevOpsKpiData } from "../services/analytics.js";
import { ResponseCache } from "../lib/response-cache.js";
import { registerApiRoutes } from "./analytics/api-routes.js";
import { registerDashboardRenderer } from "./analytics/dashboard-renderer.js";

// ─── Route Factory ─────────────────────────────────────────────────────────

export function createAnalyticsRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const analytics = new AnalyticsService(prisma);
  const analyticsCache = new ResponseCache<AnalyticsDashboardData>(30_000);
  const revopsKpiCache = new ResponseCache<Record<string, unknown>>(30_000);

  registerApiRoutes({ router, prisma, analytics, analyticsCache, revopsKpiCache });
  registerDashboardRenderer({ router, analytics, analyticsCache });

  return router;
}
