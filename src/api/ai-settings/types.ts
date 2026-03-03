import type { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { AIConfigService } from "../../services/ai-config.js";
import { AIUsageTracker } from "../../services/ai-usage-tracker.js";
import type { AuthenticatedRequest } from "../../types/authenticated-request.js";

export type AuthReq = AuthenticatedRequest;

export interface AISettingsRouteContext {
  configService: AIConfigService;
  prisma: PrismaClient;
  router: Router;
  usageTracker: AIUsageTracker;
}
