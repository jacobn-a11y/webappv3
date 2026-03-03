import type { Request, Router } from "express";
import type { PrismaClient, UserRole } from "@prisma/client";
import { AIConfigService } from "../../services/ai-config.js";
import { AIUsageTracker } from "../../services/ai-usage-tracker.js";

export interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

export interface AISettingsRouteContext {
  configService: AIConfigService;
  prisma: PrismaClient;
  router: Router;
  usageTracker: AIUsageTracker;
}
