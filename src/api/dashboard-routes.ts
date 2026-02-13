/**
 * Landing Page Dashboard & Admin Routes
 *
 * Provides:
 *   - Dashboard overview (stats, page list with filters)
 *   - Admin permission management (grant/revoke, org settings)
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { PrismaClient, PermissionType, UserRole, AccountScopeType, CRMProvider } from "@prisma/client";
import { LandingPageEditor } from "../services/landing-page-editor.js";
import { AccountAccessService } from "../services/account-access.js";
import {
  PermissionManager,
  requirePermission,
} from "../middleware/permissions.js";

// ─── Validation ──────────────────────────────────────────────────────────────

const UpdateOrgSettingsSchema = z.object({
  landing_pages_enabled: z.boolean().optional(),
  default_page_visibility: z.enum(["PRIVATE", "SHARED_WITH_LINK"]).optional(),
  require_approval_to_publish: z.boolean().optional(),
  allowed_publishers: z
    .array(z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]))
    .optional(),
  max_pages_per_user: z.number().int().min(1).nullable().optional(),
  company_name_replacements: z.record(z.string(), z.string()).optional(),
});

const GrantPermissionSchema = z.object({
  user_id: z.string().min(1),
  permission: z.enum([
    "CREATE_LANDING_PAGE",
    "PUBLISH_LANDING_PAGE",
    "PUBLISH_NAMED_LANDING_PAGE",
    "EDIT_ANY_LANDING_PAGE",
    "DELETE_ANY_LANDING_PAGE",
    "MANAGE_PERMISSIONS",
    "VIEW_ANALYTICS",
  ]),
});

const GrantAccountAccessSchema = z.object({
  user_id: z.string().min(1),
  scope_type: z.enum(["ALL_ACCOUNTS", "SINGLE_ACCOUNT", "ACCOUNT_LIST", "CRM_REPORT"]),
  /** For SINGLE_ACCOUNT: the account ID */
  account_id: z.string().optional(),
  /** For ACCOUNT_LIST: array of account IDs */
  account_ids: z.array(z.string()).optional(),
  /** For CRM_REPORT: the report/list ID from Salesforce or HubSpot */
  crm_report_id: z.string().optional(),
  crm_provider: z.enum(["SALESFORCE", "HUBSPOT"]).optional(),
  crm_report_name: z.string().optional(),
});

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createDashboardRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const editor = new LandingPageEditor(prisma);
  const permManager = new PermissionManager(prisma);

  // ── Dashboard Overview ──────────────────────────────────────────────

  /**
   * GET /api/dashboard/stats
   *
   * Returns aggregate stats for the landing pages dashboard.
   */
  router.get("/stats", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const stats = await editor.getDashboardStats(req.organizationId);
      res.json(stats);
    } catch (err) {
      console.error("Dashboard stats error:", err);
      res.status(500).json({ error: "Failed to load dashboard stats" });
    }
  });

  /**
   * GET /api/dashboard/pages
   *
   * Lists all landing pages for the org with optional filters.
   * Query params: status, created_by, search
   */
  router.get("/pages", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const pages = await editor.listForOrg(req.organizationId, {
        status: req.query.status as string | undefined as
          | "DRAFT"
          | "PUBLISHED"
          | "ARCHIVED"
          | undefined,
        createdById: req.query.created_by as string | undefined,
        search: req.query.search as string | undefined,
      });

      res.json({ pages });
    } catch (err) {
      console.error("Dashboard pages error:", err);
      res.status(500).json({ error: "Failed to load pages" });
    }
  });

  // ── Admin: Org Settings ─────────────────────────────────────────────

  /**
   * GET /api/dashboard/settings
   *
   * Returns current org settings for landing pages.
   */
  router.get(
    "/settings",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const settings = await prisma.orgSettings.findUnique({
          where: { organizationId: req.organizationId! },
        });

        res.json({
          settings: settings ?? {
            landing_pages_enabled: true,
            default_page_visibility: "PRIVATE",
            require_approval_to_publish: false,
            allowed_publishers: ["OWNER", "ADMIN"],
            max_pages_per_user: null,
            company_name_replacements: {},
          },
        });
      } catch (err) {
        console.error("Get settings error:", err);
        res.status(500).json({ error: "Failed to load settings" });
      }
    }
  );

  /**
   * PATCH /api/dashboard/settings
   *
   * Updates org settings. Admin only.
   */
  router.patch(
    "/settings",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parse = UpdateOrgSettingsSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      try {
        await permManager.updateOrgSettings(req.organizationId!, {
          landingPagesEnabled: parse.data.landing_pages_enabled,
          defaultPageVisibility: parse.data.default_page_visibility,
          requireApprovalToPublish: parse.data.require_approval_to_publish,
          allowedPublishers: parse.data.allowed_publishers as UserRole[] | undefined,
          maxPagesPerUser: parse.data.max_pages_per_user,
          companyNameReplacements: parse.data.company_name_replacements,
        });

        res.json({ updated: true });
      } catch (err) {
        console.error("Update settings error:", err);
        res.status(500).json({ error: "Failed to update settings" });
      }
    }
  );

  // ── Admin: User Permissions ─────────────────────────────────────────

  /**
   * GET /api/dashboard/permissions
   *
   * Returns the full permission matrix for the org.
   */
  router.get(
    "/permissions",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const matrix = await permManager.getOrgPermissionMatrix(
          req.organizationId!
        );
        res.json({ users: matrix });
      } catch (err) {
        console.error("Get permissions error:", err);
        res.status(500).json({ error: "Failed to load permissions" });
      }
    }
  );

  /**
   * POST /api/dashboard/permissions/grant
   *
   * Grants a specific permission to a user.
   */
  router.post(
    "/permissions/grant",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parse = GrantPermissionSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      try {
        await permManager.grantPermission(
          parse.data.user_id,
          parse.data.permission as PermissionType,
          req.userId!
        );
        res.json({ granted: true });
      } catch (err) {
        console.error("Grant permission error:", err);
        res.status(500).json({ error: "Failed to grant permission" });
      }
    }
  );

  /**
   * POST /api/dashboard/permissions/revoke
   *
   * Revokes a specific permission from a user.
   */
  router.post(
    "/permissions/revoke",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parse = GrantPermissionSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      try {
        await permManager.revokePermission(
          parse.data.user_id,
          parse.data.permission as PermissionType
        );
        res.json({ revoked: true });
      } catch (err) {
        console.error("Revoke permission error:", err);
        res.status(500).json({ error: "Failed to revoke permission" });
      }
    }
  );

  // ── Admin: Account Access Control ──────────────────────────────────

  const accessService = new AccountAccessService(prisma);

  /**
   * GET /api/dashboard/access/:userId
   *
   * Lists all account access grants for a specific user.
   */
  router.get(
    "/access/:userId",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const grants = await accessService.listUserAccess(
          req.params.userId,
          req.organizationId!
        );
        res.json({
          grants: grants.map((g) => ({
            id: g.id,
            scope_type: g.scopeType,
            account: g.account
              ? { id: g.account.id, name: g.account.name, domain: g.account.domain }
              : null,
            cached_account_count: g.cachedAccountIds.length,
            crm_report_id: g.crmReportId,
            crm_provider: g.crmProvider,
            crm_report_name: g.crmReportName,
            last_synced_at: g.lastSyncedAt,
            created_at: g.createdAt,
          })),
        });
      } catch (err) {
        console.error("Get access error:", err);
        res.status(500).json({ error: "Failed to load access grants" });
      }
    }
  );

  /**
   * POST /api/dashboard/access/grant
   *
   * Grants account access to a user. Supports:
   *   - ALL_ACCOUNTS: unrestricted
   *   - SINGLE_ACCOUNT: one account by ID
   *   - ACCOUNT_LIST: a manually curated set of account IDs
   *   - CRM_REPORT: a Salesforce report or HubSpot list
   */
  router.post(
    "/access/grant",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parse = GrantAccountAccessSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      try {
        const grantId = await accessService.grantAccess({
          userId: parse.data.user_id,
          organizationId: req.organizationId!,
          scopeType: parse.data.scope_type as AccountScopeType,
          accountId: parse.data.account_id,
          accountIds: parse.data.account_ids,
          crmReportId: parse.data.crm_report_id,
          crmProvider: parse.data.crm_provider as CRMProvider | undefined,
          crmReportName: parse.data.crm_report_name,
          grantedById: req.userId!,
        });

        // If CRM_REPORT, trigger an initial sync
        if (parse.data.scope_type === "CRM_REPORT") {
          try {
            const syncResult = await accessService.syncCrmReportGrant(grantId);
            res.json({ granted: true, grant_id: grantId, synced_accounts: syncResult.accountCount });
            return;
          } catch {
            // Sync failed but grant was created — user can retry sync later
          }
        }

        res.json({ granted: true, grant_id: grantId });
      } catch (err) {
        console.error("Grant access error:", err);
        res.status(500).json({ error: "Failed to grant account access" });
      }
    }
  );

  /**
   * DELETE /api/dashboard/access/:grantId
   *
   * Revokes a specific account access grant.
   */
  router.delete(
    "/access/:grantId",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        await accessService.revokeAccess(req.params.grantId);
        res.json({ revoked: true });
      } catch (err) {
        console.error("Revoke access error:", err);
        res.status(500).json({ error: "Failed to revoke access" });
      }
    }
  );

  /**
   * POST /api/dashboard/access/:grantId/sync
   *
   * Manually triggers a CRM report sync for a grant.
   */
  router.post(
    "/access/:grantId/sync",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const result = await accessService.syncCrmReportGrant(req.params.grantId);
        res.json({ synced: true, account_count: result.accountCount });
      } catch (err) {
        console.error("Sync CRM report error:", err);
        res.status(500).json({ error: "Failed to sync CRM report" });
      }
    }
  );

  return router;
}
