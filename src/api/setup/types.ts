import type { Response, Router } from "express";
import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";
import { SetupWizardService } from "../../services/setup-wizard.js";
import { RoleProfileService } from "../../services/role-profiles.js";
import type { AIConfigService } from "../../services/ai-config.js";
import type { SyncEngine } from "../../integrations/sync-engine.js";
import { GongProvider } from "../../integrations/gong-provider.js";
import type { AuthenticatedRequest } from "../../types/authenticated-request.js";

export type AuthReq = AuthenticatedRequest;

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
