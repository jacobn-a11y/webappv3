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
import { MODEL_CONTEXT_LIMITS } from "../types/model-context-limits.js";

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
  transcript_merge_max_words: z.number().int().min(1000).max(2_000_000).optional(),
  transcript_truncation_mode: z.enum(["OLDEST_FIRST", "NEWEST_FIRST"]).optional(),
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
   * Non-admin users get stats scoped to their own pages only.
   */
  router.get("/stats", async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const isAdmin = req.userRole && ["OWNER", "ADMIN"].includes(req.userRole);

    try {
      if (isAdmin) {
        const stats = await editor.getDashboardStats(req.organizationId);
        res.json(stats);
      } else {
        const stats = await editor.getDashboardStatsForUser(
          req.organizationId,
          req.userId
        );
        res.json(stats);
      }
    } catch (err) {
      console.error("Dashboard stats error:", err);
      res.status(500).json({ error: "Failed to load dashboard stats" });
    }
  });

  /**
   * GET /api/dashboard/pages
   *
   * Lists all landing pages for the org with optional filters.
   * Query params: status, visibility, created_by, search, sort_by, sort_dir
   *
   * Non-admin users only see their own pages (created_by is forced to their userId).
   * Admin/Owner users see all pages unless they explicitly filter by created_by.
   */
  router.get("/pages", async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const isAdmin = req.userRole && ["OWNER", "ADMIN"].includes(req.userRole);

    // Non-admin users can only see their own pages
    let createdByFilter = req.query.created_by as string | undefined;
    if (!isAdmin) {
      createdByFilter = req.userId;
    }

    try {
      const pages = await editor.listForOrg(req.organizationId, {
        status: req.query.status as
          | "DRAFT"
          | "PUBLISHED"
          | "ARCHIVED"
          | undefined,
        visibility: req.query.visibility as
          | "PRIVATE"
          | "SHARED_WITH_LINK"
          | undefined,
        createdById: createdByFilter,
        search: req.query.search as string | undefined,
        sortBy: req.query.sort_by as string | undefined,
        sortDir: req.query.sort_dir as "asc" | "desc" | undefined,
      });

      res.json({ pages });
    } catch (err) {
      console.error("Dashboard pages error:", err);
      res.status(500).json({ error: "Failed to load pages" });
    }
  });

  /**
   * GET /api/dashboard/creators
   *
   * Returns the list of distinct page creators for the org (for filter dropdowns).
   */
  router.get("/creators", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const creators = await editor.getCreatorsForOrg(req.organizationId);
      res.json({ creators });
    } catch (err) {
      console.error("Dashboard creators error:", err);
      res.status(500).json({ error: "Failed to load creators" });
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
          settings: settings
            ? {
                landing_pages_enabled: settings.landingPagesEnabled,
                default_page_visibility: settings.defaultPageVisibility,
                require_approval_to_publish: settings.requireApprovalToPublish,
                allowed_publishers: settings.allowedPublishers,
                max_pages_per_user: settings.maxPagesPerUser,
                company_name_replacements: settings.companyNameReplacements,
                transcript_merge_max_words: settings.transcriptMergeMaxWords,
                transcript_truncation_mode: settings.transcriptTruncationMode,
              }
            : {
                landing_pages_enabled: true,
                default_page_visibility: "PRIVATE",
                require_approval_to_publish: false,
                allowed_publishers: ["OWNER", "ADMIN"],
                max_pages_per_user: null,
                company_name_replacements: {},
                transcript_merge_max_words: 600_000,
                transcript_truncation_mode: "OLDEST_FIRST",
              },
          model_context_recommendations: MODEL_CONTEXT_LIMITS.map((m) => ({
            provider: m.provider,
            model: m.model,
            context_tokens: m.contextTokens,
            recommended_max_words: m.recommendedWords,
          })),
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
          transcriptMergeMaxWords: parse.data.transcript_merge_max_words,
          transcriptTruncationMode: parse.data.transcript_truncation_mode,
        });

        res.json({ updated: true });
      } catch (err) {
        console.error("Update settings error:", err);
        res.status(500).json({ error: "Failed to update settings" });
      }
    }
  );

  /**
   * GET /api/dashboard/settings/model-context-limits
   *
   * Returns recommended transcript word count limits based on 80% of
   * the token context window for the 10 most popular AI models from
   * Anthropic, Google, and OpenAI. Used to render the recommendation
   * info box in the admin dashboard transcript settings UI.
   */
  router.get(
    "/settings/model-context-limits",
    requirePermission(prisma, "manage_permissions"),
    async (_req: AuthReq, res: Response) => {
      res.json({
        description:
          "Recommended markdown word count limits based on 80% of the token context window for popular AI models (as of February 2026). " +
          "These limits leave 20% headroom for system prompts, instructions, and model output.",
        models: MODEL_CONTEXT_LIMITS.map((m) => ({
          provider: m.provider,
          model: m.model,
          context_tokens: m.contextTokens,
          recommended_tokens_80_pct: m.recommendedTokens,
          recommended_max_words: m.recommendedWords,
        })),
      });
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
   * GET /api/dashboard/access
   *
   * Returns all users in the org with their account access grants.
   * Used by the Admin Account Access page.
   */
  router.get(
    "/access",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const users = await accessService.listAllUserAccess(req.organizationId!);

        const result = users.map((u: typeof users[number]) => ({
          user_id: u.id,
          user_name: u.name,
          user_email: u.email,
          role: u.role,
          grants: u.accountAccess.map((g: typeof u.accountAccess[number]) => ({
            id: g.id,
            scope_type: g.scopeType,
            account: g.account
              ? { id: g.account.id, name: g.account.name, domain: g.account.domain }
              : null,
            cached_account_ids: g.cachedAccountIds,
            cached_account_count: g.cachedAccountIds.length,
            crm_report_id: g.crmReportId,
            crm_provider: g.crmProvider,
            crm_report_name: g.crmReportName,
            last_synced_at: g.lastSyncedAt,
            created_at: g.createdAt,
          })),
        }));

        res.json({ users: result });
      } catch (err) {
        console.error("Get all access error:", err);
        res.status(500).json({ error: "Failed to load account access overview" });
      }
    }
  );

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
          grants: grants.map((g: typeof grants[number]) => ({
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

  // ── Admin: Account Search & CRM Reports ────────────────────────────

  /**
   * GET /api/dashboard/accounts/search?q=term
   *
   * Searches accounts by name or domain for the account picker.
   */
  router.get(
    "/accounts/search",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const query = (req.query.q as string) ?? "";
      if (query.length < 1) {
        res.json({ accounts: [] });
        return;
      }

      try {
        const accounts = await accessService.searchAccounts(
          req.organizationId!,
          query
        );
        res.json({ accounts });
      } catch (err) {
        console.error("Account search error:", err);
        res.status(500).json({ error: "Failed to search accounts" });
      }
    }
  );

  /**
   * GET /api/dashboard/crm-reports?provider=SALESFORCE
   *
   * Fetches available Salesforce reports or HubSpot lists via Merge.dev passthrough.
   */
  router.get(
    "/crm-reports",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const provider = req.query.provider as string;
      if (provider !== "SALESFORCE" && provider !== "HUBSPOT") {
        res.status(400).json({ error: "provider must be SALESFORCE or HUBSPOT" });
        return;
      }

      try {
        const reports = await accessService.fetchAvailableCrmReports(
          req.organizationId!,
          provider as CRMProvider
        );
        res.json({ reports });
      } catch (err) {
        console.error("CRM reports error:", err);
        res.status(500).json({ error: "Failed to fetch CRM reports" });
      }
    }
  );

  return router;
}
