import type { Response } from "express";
import { respondAuthRequired, respondServerError } from "../_shared/errors.js";
import type { AuthReq, SetupRouteContext } from "./types.js";

export function registerSetupStatusRoutes({
  router,
  wizardService,
}: Pick<SetupRouteContext, "router" | "wizardService">): void {
  router.get("/status", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      respondAuthRequired(res);
      return;
    }

    try {
      const status = await wizardService.getStatus(req.organizationId);
      res.json(status);
    } catch (err) {
      respondServerError(res, "Setup status error:", "Failed to load setup status", err);
    }
  });
}
