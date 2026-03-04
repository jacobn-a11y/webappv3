import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/authenticated-request.js";

/**
 * Middleware that narrows AuthenticatedRequest to OrgRequest by
 * verifying organizationId and userId are present. Must be placed
 * after requireAuth in the middleware chain.
 */
export function requireOrganization(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.organizationId || !req.userId) {
    res.status(401).json({
      error: "unauthorized",
      message: "Organization context required.",
    });
    return;
  }
  next();
}
