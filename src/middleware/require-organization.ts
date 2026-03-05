import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "./auth.js";
import { sendUnauthorized } from "../api/_shared/responses.js";

export function requireOrganization(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.organizationId) {
    sendUnauthorized(res, "Organization context required");
    return;
  }
  next();
}
