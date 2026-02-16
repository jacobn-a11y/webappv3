/**
 * Authentication Middleware
 *
 * Ensures that all protected routes have valid authentication context.
 * In production, this is populated by WorkOS middleware. This middleware
 * acts as a safety net that fails closed — if auth context is missing,
 * the request is rejected.
 *
 * SECURITY PRINCIPLE: Fail closed. If WorkOS middleware hasn't run or
 * hasn't set the auth context, deny access rather than allowing through.
 */

import type { Request, Response, NextFunction } from "express";
import type { UserRole } from "@prisma/client";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AuthenticatedRequest extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

// ─── Middleware ──────────────────────────────────────────────────────────────

/**
 * Requires that the request has valid authentication context.
 * Should be applied to all routes that need org/user context.
 *
 * This does NOT perform authentication itself (that's WorkOS's job),
 * but ensures the auth middleware has run and set the required fields.
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authReq = req as AuthenticatedRequest;

  if (!authReq.organizationId || !authReq.userId) {
    res.status(401).json({
      error: "authentication_required",
      message: "Valid authentication is required to access this resource.",
    });
    return;
  }

  next();
}
