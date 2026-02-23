/**
 * Permissions Middleware
 *
 * Controls who can create, edit, publish, and delete landing pages.
 * Admins configure permissions at the org level (OrgSettings) and
 * optionally grant granular per-user permissions (UserPermission).
 *
 * Permission resolution order:
 *   1. OWNER/ADMIN roles bypass all checks (always allowed)
 *   2. OrgSettings.allowedPublishers controls which roles can publish
 *   3. UserPermission grants specific capabilities to individual users
 *   4. OrgSettings.landingPagesEnabled is a kill switch for the entire feature
 */

import type { Request, Response, NextFunction } from "express";
import type { PrismaClient, PermissionType, UserRole, TranscriptTruncationMode } from "@prisma/client";
import { RoleProfileService } from "../services/role-profiles.js";
import { PolicyService, legacyPermissionActionToPolicyAction } from "../services/policy-engine.js";
import logger from "../lib/logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AuthenticatedRequest extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

// ─── Role Hierarchy ──────────────────────────────────────────────────────────

const ADMIN_ROLES: UserRole[] = ["OWNER", "ADMIN"];

// ─── Middleware Factories ────────────────────────────────────────────────────

/**
 * Checks that the landing pages feature is enabled for this org.
 * Returns 403 if the admin has disabled it.
 */
export function requireLandingPagesEnabled(prisma: PrismaClient) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const orgId = req.organizationId;
      if (!orgId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const settings = await prisma.orgSettings.findUnique({
        where: { organizationId: orgId },
      });

      // Default to enabled if no settings exist yet
      if (settings && !settings.landingPagesEnabled) {
        res.status(403).json({
          error: "feature_disabled",
          message:
            "Landing pages have been disabled by your organization admin.",
        });
        return;
      }

      next();
    } catch (err) {
      logger.error("Landing pages feature gate error", { error: err });
      res.status(500).json({ error: "permission_check_failed" });
    }
  };
}

/**
 * Checks if the current user has permission to perform a specific action.
 * Admins always pass. For other roles, checks UserPermission table.
 */
export function requirePermission(prisma: PrismaClient, action: string) {
  const policyService = new PolicyService(prisma);
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { userId, userRole, organizationId } = req;

      if (!userId || !organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      // Admins/Owners always pass
      if (userRole && ADMIN_ROLES.includes(userRole)) {
        next();
        return;
      }

      const policyAction = legacyPermissionActionToPolicyAction(action);
      if (!policyAction) {
        res.status(500).json({ error: `Unknown permission action: ${action}` });
        return;
      }

      const settings = await prisma.orgSettings.findUnique({
        where: { organizationId },
        select: { dataGovernancePolicy: true, allowedPublishers: true },
      });

      const decision = await policyService.evaluate({
        action: policyAction,
        organizationId,
        userId,
        userRole,
        orgDataGovernancePolicy:
          (settings?.dataGovernancePolicy as Record<string, unknown> | null) ?? null,
      });
      if (decision.allowed) {
        next();
        return;
      }

      // For publish action, also check org-level allowedPublishers
      if (action === "publish" && userRole) {
        if (settings?.allowedPublishers?.includes(userRole)) {
          next();
          return;
        }
      }

      policyService.emitDenyTelemetry(
        {
          action: policyAction,
          organizationId,
          userId,
          userRole,
        },
        decision
      );

      res.status(403).json({
        error: "permission_denied",
        message: `You don't have permission to ${action.replace("_", " ")} landing pages. Contact your admin.`,
        required_permission: decision.requiredPermission,
        deny_reason: decision.reason,
      });
    } catch (err) {
      logger.error("Permission middleware error", { error: err });
      res.status(500).json({ error: "permission_check_failed" });
    }
  };
}

/**
 * Checks that the user either owns the landing page or has edit_any permission.
 */
export function requirePageOwnerOrPermission(prisma: PrismaClient) {
  const roleProfiles = new RoleProfileService(prisma);
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { userId, userRole, organizationId } = req;
      const pageId = (req.params.pageId ?? req.params.id) as string;

      if (!userId || !organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      // Admins pass
      if (userRole && ADMIN_ROLES.includes(userRole)) {
        next();
        return;
      }

      // Check if user owns this page
      const page = await prisma.landingPage.findFirst({
        where: { id: pageId, organizationId },
        select: { createdById: true },
      });

      if (!page) {
        res.status(404).json({ error: "Landing page not found" });
        return;
      }

      if (page.createdById === userId) {
        next();
        return;
      }

      const policy = await roleProfiles.getEffectivePolicy(
        organizationId,
        userId,
        userRole
      );
      if (policy.permissions.includes("EDIT_ANY_LANDING_PAGE")) {
        next();
        return;
      }

      // Check edit_any permission
      const editAny = await prisma.userPermission.findUnique({
        where: {
          userId_permission: {
            userId,
            permission: "EDIT_ANY_LANDING_PAGE",
          },
        },
      });

      if (editAny) {
        next();
        return;
      }

      res.status(403).json({
        error: "permission_denied",
        message: "You can only edit landing pages you created, or need EDIT_ANY permission.",
      });
    } catch (err) {
      logger.error("Page permission middleware error", { error: err });
      res.status(500).json({ error: "permission_check_failed" });
    }
  };
}

// ─── Admin Permission Management ─────────────────────────────────────────────

/**
 * Service for admins to manage user permissions and org settings.
 */
export class PermissionManager {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /** Grant a permission to a user. */
  async grantPermission(
    userId: string,
    permission: PermissionType,
    grantedById: string
  ): Promise<void> {
    await this.prisma.userPermission.upsert({
      where: { userId_permission: { userId, permission } },
      create: { userId, permission, grantedById },
      update: { grantedById },
    });
  }

  /** Revoke a permission from a user. */
  async revokePermission(
    userId: string,
    permission: PermissionType
  ): Promise<void> {
    await this.prisma.userPermission.deleteMany({
      where: { userId, permission },
    });
  }

  /** List all permissions for a user. */
  async getUserPermissions(userId: string): Promise<PermissionType[]> {
    const perms = await this.prisma.userPermission.findMany({
      where: { userId },
      select: { permission: true },
    });
    return perms.map((p) => p.permission);
  }

  /** List all users with their permissions for an org. */
  async getOrgPermissionMatrix(
    organizationId: string
  ): Promise<
    Array<{
      userId: string;
      userName: string | null;
      userEmail: string;
      role: UserRole;
      permissions: PermissionType[];
    }>
  > {
    const users = await this.prisma.user.findMany({
      where: { organizationId },
      include: { permissions: true },
    });

    return users.map((u) => ({
      userId: u.id,
      userName: u.name,
      userEmail: u.email,
      role: u.role,
      permissions: u.permissions.map((p) => p.permission),
    }));
  }

  /** Update org-level landing page settings. */
  async updateOrgSettings(
    organizationId: string,
    updates: {
      landingPagesEnabled?: boolean;
      defaultPageVisibility?: "PRIVATE" | "SHARED_WITH_LINK";
      requireApprovalToPublish?: boolean;
      allowedPublishers?: UserRole[];
      maxPagesPerUser?: number | null;
      companyNameReplacements?: Record<string, string>;
      transcriptMergeMaxWords?: number;
      transcriptTruncationMode?: TranscriptTruncationMode;
    }
  ): Promise<void> {
    // Filter out undefined values to avoid overwriting with undefined
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );

    await this.prisma.orgSettings.upsert({
      where: { organizationId },
      create: {
        organizationId,
        ...cleanUpdates,
      },
      update: cleanUpdates,
    });
  }
}
