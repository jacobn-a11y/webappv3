import type { Request } from "express";
import type { UserRole } from "@prisma/client";

/**
 * Canonical authenticated request type used across all route handlers.
 * Populated by session-auth and dev-auth middleware.
 */
export interface AuthenticatedRequest extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
  sessionId?: string;
  mfaVerified?: boolean;
  authContext?: { amr?: string[] };
  apiKeyId?: string;
  apiKeyScopes?: string[];
  impersonation?: {
    actorUserId: string;
    actorOrganizationId: string;
  };
}
