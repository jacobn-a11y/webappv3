/**
 * Connections Setup Wizard Routes
 *
 * Compatibility shim that preserves `createSetupRoutes()` while routing
 * implementation now lives under `src/api/setup/*`.
 */

import { Router, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import Stripe from "stripe";
import { SetupWizardService } from "../services/setup-wizard.js";
import { RoleProfileService } from "../services/role-profiles.js";
import { GongProvider } from "../integrations/gong-provider.js";
import { registerSetupStatusRoutes } from "./setup/status-routes.js";
import { registerSetupQuickstartRoutes } from "./setup/quickstart-routes.js";
import { registerSetupStepRoutes } from "./setup/steps-routes.js";
import { registerSetupFirstValueRoutes } from "./setup/first-value-routes.js";
import type { AuthReq, SetupRouteDeps } from "./setup/types.js";

export function createSetupRoutes(
  prisma: PrismaClient,
  stripe: Stripe,
  deps: SetupRouteDeps = {}
): Router {
  const router = Router();
  const wizardService = new SetupWizardService(prisma);
  const roleProfiles = new RoleProfileService(prisma);
  const gongProvider = new GongProvider();

  const requireSetupAdmin = (req: AuthReq, res: Response): boolean => {
    if (!req.userRole || (req.userRole !== "OWNER" && req.userRole !== "ADMIN")) {
      res.status(403).json({ error: "Admin access required" });
      return false;
    }
    return true;
  };

  registerSetupStatusRoutes({
    router,
    wizardService,
  });

  registerSetupQuickstartRoutes({
    router,
    prisma,
    deps,
    gongProvider,
    requireSetupAdmin,
  });

  registerSetupStepRoutes({
    router,
    prisma,
    stripe,
    wizardService,
    roleProfiles,
    requireSetupAdmin,
  });

  registerSetupFirstValueRoutes({
    router,
    prisma,
  });

  return router;
}
