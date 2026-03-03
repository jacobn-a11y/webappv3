/**
 * AI Settings & Usage Management Routes
 *
 * Compatibility shim that preserves `createAISettingsRoutes()` while route
 * implementations now live under `src/api/ai-settings/*`.
 */

import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { AIConfigService } from "../services/ai-config.js";
import { AIUsageTracker } from "../services/ai-usage-tracker.js";
import { registerAISettingsUserRoutes } from "./ai-settings/user-routes.js";
import { registerAISettingsAdminRoutes } from "./ai-settings/admin-routes.js";
import { registerAISettingsBillingRoutes } from "./ai-settings/billing-routes.js";

export function createAISettingsRoutes(
  prisma: PrismaClient,
  configService: AIConfigService,
  usageTracker: AIUsageTracker
): Router {
  const router = Router();

  registerAISettingsUserRoutes({
    router,
    configService,
    usageTracker,
  });

  registerAISettingsAdminRoutes({
    router,
    prisma,
    configService,
    usageTracker,
  });

  registerAISettingsBillingRoutes({
    router,
    prisma,
    usageTracker,
  });

  return router;
}
