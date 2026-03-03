import type { Request, Response, Router } from "express";
import type { PrismaClient, UserRole } from "@prisma/client";
import type Stripe from "stripe";
import { SetupWizardService } from "../../services/setup-wizard.js";
import { RoleProfileService } from "../../services/role-profiles.js";
import type { AIConfigService } from "../../services/ai-config.js";
import type { SyncEngine } from "../../integrations/sync-engine.js";
import { GongProvider } from "../../integrations/gong-provider.js";

export interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

export interface SetupRouteDeps {
  aiConfigService?: AIConfigService;
  syncEngine?: SyncEngine;
}

export interface SetupRouteContext {
  deps: SetupRouteDeps;
  gongProvider: GongProvider;
  prisma: PrismaClient;
  requireSetupAdmin: (req: AuthReq, res: Response) => boolean;
  roleProfiles: RoleProfileService;
  router: Router;
  stripe: Stripe;
  wizardService: SetupWizardService;
}
