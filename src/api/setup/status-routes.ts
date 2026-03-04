import type { Response } from "express";
import { sendUnauthorized, sendError } from "../_shared/responses.js";
import logger from "../../lib/logger.js";
import type { AuthReq, SetupRouteContext } from "./types.js";
import { asyncHandler } from "../../lib/async-handler.js";

export function registerSetupStatusRoutes({
  router,
  wizardService,
  requireSetupAdmin,
}: Pick<SetupRouteContext, "router" | "wizardService" | "requireSetupAdmin">): void {
  router.get("/status", asyncHandler(async (req: AuthReq, res: Response) => {
    if (!req.organizationId!) {
      sendUnauthorized(res);
      return;
    }

    const status = await wizardService.getStatus(req.organizationId!);
    // Post-setup guard: once wizard is complete, only admins can access setup routes
    if (status.completedAt && !requireSetupAdmin(req, res)) {
      return;
    }

    res.json(status);
  }));
}
