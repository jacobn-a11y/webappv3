import type { Response } from "express";
import { sendUnauthorized, sendError } from "../_shared/responses.js";
import logger from "../../lib/logger.js";
import type { AuthReq, SetupRouteContext } from "./types.js";
import { asyncHandler } from "../../lib/async-handler.js";

export function registerSetupStatusRoutes({
  router,
  wizardService,
}: Pick<SetupRouteContext, "router" | "wizardService">): void {
  router.get("/status", asyncHandler(async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      sendUnauthorized(res);
      return;
    }

      const status = await wizardService.getStatus(req.organizationId);
      res.json(status);
    
  }));
}
