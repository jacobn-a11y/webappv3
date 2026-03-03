import type { Response } from "express";
import { sendUnauthorized, sendError } from "../_shared/responses.js";
import logger from "../../lib/logger.js";
import type { AuthReq, SetupRouteContext } from "./types.js";

export function registerSetupStatusRoutes({
  router,
  wizardService,
}: Pick<SetupRouteContext, "router" | "wizardService">): void {
  router.get("/status", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      sendUnauthorized(res);
      return;
    }

    try {
      const status = await wizardService.getStatus(req.organizationId);
      res.json(status);
    } catch (err) {
      logger.error("Setup status error", { error: err });
      sendError(res, 500, "internal_error", "Failed to load setup status");
    }
  });
}
