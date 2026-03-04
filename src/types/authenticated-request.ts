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
    sessionId: string;
    actorUserId: string;
    actorOrganizationId?: string;
    targetUserId: string;
    scope: string[];
    reason: string;
    expiresAt: string;
  };
}

/**
 * Narrowed request type for routes behind requireAuth + requireOrganization.
 * organizationId is guaranteed to be present.
 */
export interface OrgRequest extends AuthenticatedRequest {
  organizationId: string;
  userId: string;
}
