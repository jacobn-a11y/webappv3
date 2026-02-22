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
import logger from "../lib/logger.js";
import { Sentry } from "../lib/sentry.js";
import { RoleProfileService } from "../services/role-profiles.js";
import { AuditLogService } from "../services/audit-log.js";
import { FeatureFlagService } from "../services/feature-flags.js";
import { STORY_FORMATS } from "../types/taxonomy.js";
import {
  STORY_LENGTHS,
  STORY_OUTLINES,
  STORY_TYPES,
  type StoryContextSettings,
  type StoryPromptDefaults,
} from "../types/story-generation.js";

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

const StoryContextSchema = z.object({
  company_overview: z.string().max(5000).optional(),
  products: z.array(z.string().min(1).max(200)).optional(),
  target_personas: z.array(z.string().min(1).max(120)).optional(),
  target_industries: z.array(z.string().min(1).max(120)).optional(),
  differentiators: z.array(z.string().min(1).max(400)).optional(),
  proof_points: z.array(z.string().min(1).max(400)).optional(),
  banned_claims: z.array(z.string().min(1).max(300)).optional(),
  writing_style_guide: z.string().max(4000).optional(),
  approved_terminology: z.array(z.string().min(1).max(80)).optional(),
  default_story_length: z.enum(STORY_LENGTHS as unknown as [string, ...string[]]).optional(),
  default_story_outline: z.enum(STORY_OUTLINES as unknown as [string, ...string[]]).optional(),
  default_story_format: z.enum(STORY_FORMATS as unknown as [string, ...string[]]).optional(),
  default_story_type: z.enum(STORY_TYPES as unknown as [string, ...string[]]).optional(),
});

const DataGovernanceSchema = z.object({
  retention_days: z.number().int().min(30).max(3650).optional(),
  legal_hold_enabled: z.boolean().optional(),
  pii_export_enabled: z.boolean().optional(),
  deletion_requires_approval: z.boolean().optional(),
  allow_named_story_exports: z.boolean().optional(),
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

const RolePermissionEnum = z.enum([
  "CREATE_LANDING_PAGE",
  "PUBLISH_LANDING_PAGE",
  "PUBLISH_NAMED_LANDING_PAGE",
  "EDIT_ANY_LANDING_PAGE",
  "DELETE_ANY_LANDING_PAGE",
  "MANAGE_PERMISSIONS",
  "VIEW_ANALYTICS",
  "MANAGE_ENTITY_RESOLUTION",
  "MANAGE_AI_SETTINGS",
]);

const UpsertRoleProfileSchema = z.object({
  key: z.string().min(2).max(64).regex(/^[A-Z0-9_]+$/),
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  permissions: z.array(RolePermissionEnum),
  can_access_anonymous_stories: z.boolean(),
  can_generate_anonymous_stories: z.boolean(),
  can_access_named_stories: z.boolean(),
  can_generate_named_stories: z.boolean(),
  default_account_scope_type: z.enum(["ALL_ACCOUNTS", "SINGLE_ACCOUNT", "ACCOUNT_LIST", "CRM_REPORT"]),
  default_account_ids: z.array(z.string()).optional(),
  max_tokens_per_day: z.number().int().min(0).nullable().optional(),
  max_tokens_per_month: z.number().int().min(0).nullable().optional(),
  max_requests_per_day: z.number().int().min(0).nullable().optional(),
  max_requests_per_month: z.number().int().min(0).nullable().optional(),
  max_stories_per_month: z.number().int().min(0).nullable().optional(),
});

const AssignRoleSchema = z.object({
  user_id: z.string().min(1),
  role_profile_id: z.string().min(1),
});

const UpsertFeatureFlagSchema = z.object({
  key: z.string().min(2).max(120).regex(/^[a-z0-9_]+$/),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
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
  const roleProfiles = new RoleProfileService(prisma);
  const auditLogs = new AuditLogService(prisma);
  const featureFlags = new FeatureFlagService(prisma);

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
      logger.error("Dashboard stats error", { error: err });
      Sentry.captureException(err);
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
      logger.error("Dashboard pages error", { error: err });
      Sentry.captureException(err);
      res.status(500).json({ error: "Failed to load pages" });
    }
  });

  /**
   * GET /api/dashboard/pages/data
   *
   * Combined endpoint returning stats + pages + creators + isAdmin
   * for the React DashboardPagesPage component.
   */
  router.get("/pages/data", async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const isAdmin = req.userRole && ["OWNER", "ADMIN"].includes(req.userRole);
    const effectiveCreatorFilter = isAdmin
      ? (req.query.created_by as string | undefined)
      : req.userId;

    try {
      const [dashboardStats, pages] = await Promise.all([
        editor.getDashboardStats(req.organizationId),
        editor.listForOrg(req.organizationId, {
          status: req.query.status as "DRAFT" | "PUBLISHED" | "ARCHIVED" | undefined,
          createdById: effectiveCreatorFilter,
          search: (req.query.search as string) || undefined,
        }),
      ]);

      const creators = isAdmin
        ? dashboardStats.pagesByUser.map((u) => ({
            userId: u.userId,
            name: u.name,
            email: u.name ?? u.userId,
          }))
        : [];

      res.json({
        stats: {
          totalPages: dashboardStats.totalPages,
          publishedPages: dashboardStats.publishedPages,
          draftPages: dashboardStats.draftPages,
          totalViews: dashboardStats.totalViews,
        },
        pages,
        creators,
        isAdmin: !!isAdmin,
      });
    } catch (err) {
      logger.error("Dashboard pages data error", { error: err });
      Sentry.captureException(err);
      res.status(500).json({ error: "Failed to load dashboard data" });
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
        logger.error("Get settings error", { error: err });
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
        logger.error("Update settings error", { error: err });
        res.status(500).json({ error: "Failed to update settings" });
      }
    }
  );

  // ── Admin: Story Context & Prompt Defaults ────────────────────────

  router.get(
    "/story-context",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const settings = await prisma.orgSettings.findUnique({
          where: { organizationId: req.organizationId! },
          select: { storyContext: true, storyPromptDefaults: true },
        });

        const context = (settings?.storyContext ?? {}) as StoryContextSettings;
        const defaults = (settings?.storyPromptDefaults ?? {}) as StoryPromptDefaults;

        res.json({
          company_overview: context.companyOverview ?? "",
          products: context.products ?? [],
          target_personas: context.targetPersonas ?? [],
          target_industries: context.targetIndustries ?? [],
          differentiators: context.differentiators ?? [],
          proof_points: context.proofPoints ?? [],
          banned_claims: context.bannedClaims ?? [],
          writing_style_guide: context.writingStyleGuide ?? "",
          approved_terminology: context.approvedTerminology ?? [],
          default_story_length: defaults.storyLength ?? "MEDIUM",
          default_story_outline: defaults.storyOutline ?? "CHRONOLOGICAL_JOURNEY",
          default_story_format: defaults.storyFormat ?? null,
          default_story_type: defaults.storyType ?? "FULL_ACCOUNT_JOURNEY",
        });
      } catch (err) {
        logger.error("Get story context error", { error: err });
        res.status(500).json({ error: "Failed to load story context" });
      }
    }
  );

  router.patch(
    "/story-context",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parse = StoryContextSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      const d = parse.data;
      try {
        await prisma.orgSettings.upsert({
          where: { organizationId: req.organizationId! },
          create: {
            organizationId: req.organizationId!,
            storyContext: {
              companyOverview: d.company_overview ?? "",
              products: d.products ?? [],
              targetPersonas: d.target_personas ?? [],
              targetIndustries: d.target_industries ?? [],
              differentiators: d.differentiators ?? [],
              proofPoints: d.proof_points ?? [],
              bannedClaims: d.banned_claims ?? [],
              writingStyleGuide: d.writing_style_guide ?? "",
              approvedTerminology: d.approved_terminology ?? [],
            },
            storyPromptDefaults: {
              storyLength: d.default_story_length ?? "MEDIUM",
              storyOutline: d.default_story_outline ?? "CHRONOLOGICAL_JOURNEY",
              storyFormat: d.default_story_format ?? null,
              storyType: d.default_story_type ?? "FULL_ACCOUNT_JOURNEY",
            },
          },
          update: {
            storyContext: {
              companyOverview: d.company_overview ?? "",
              products: d.products ?? [],
              targetPersonas: d.target_personas ?? [],
              targetIndustries: d.target_industries ?? [],
              differentiators: d.differentiators ?? [],
              proofPoints: d.proof_points ?? [],
              bannedClaims: d.banned_claims ?? [],
              writingStyleGuide: d.writing_style_guide ?? "",
              approvedTerminology: d.approved_terminology ?? [],
            },
            storyPromptDefaults: {
              storyLength: d.default_story_length ?? "MEDIUM",
              storyOutline: d.default_story_outline ?? "CHRONOLOGICAL_JOURNEY",
              storyFormat: d.default_story_format ?? null,
              storyType: d.default_story_type ?? "FULL_ACCOUNT_JOURNEY",
            },
          },
        });
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "POLICY",
          action: "STORY_CONTEXT_UPDATED",
          targetType: "org_settings",
          targetId: req.organizationId!,
          severity: "WARN",
          metadata: { updated_fields: Object.keys(d) },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({ updated: true });
      } catch (err) {
        logger.error("Update story context error", { error: err });
        res.status(500).json({ error: "Failed to update story context" });
      }
    }
  );

  // ── Admin: Data Governance Policy ────────────────────────────────

  router.get(
    "/data-governance",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const settings = await prisma.orgSettings.findUnique({
          where: { organizationId: req.organizationId! },
          select: { dataGovernancePolicy: true } as unknown as Record<string, boolean>,
        });
        const settingsRecord = settings as unknown as { dataGovernancePolicy?: unknown } | null;
        const policy = (settingsRecord?.dataGovernancePolicy ??
          {}) as Record<string, unknown>;
        res.json({
          retention_days: (policy.retention_days as number | undefined) ?? 365,
          legal_hold_enabled:
            (policy.legal_hold_enabled as boolean | undefined) ?? false,
          pii_export_enabled:
            (policy.pii_export_enabled as boolean | undefined) ?? true,
          deletion_requires_approval:
            (policy.deletion_requires_approval as boolean | undefined) ?? true,
          allow_named_story_exports:
            (policy.allow_named_story_exports as boolean | undefined) ?? false,
        });
      } catch (err) {
        logger.error("Get data governance policy error", { error: err });
        res.status(500).json({ error: "Failed to load data governance policy" });
      }
    }
  );

  router.patch(
    "/data-governance",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parse = DataGovernanceSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      const d = parse.data;
      try {
        await (prisma as unknown as {
          orgSettings: {
            upsert: (args: unknown) => Promise<unknown>;
          };
        }).orgSettings.upsert({
          where: { organizationId: req.organizationId! },
          create: {
            organizationId: req.organizationId!,
            dataGovernancePolicy: {
              retention_days: d.retention_days ?? 365,
              legal_hold_enabled: d.legal_hold_enabled ?? false,
              pii_export_enabled: d.pii_export_enabled ?? true,
              deletion_requires_approval:
                d.deletion_requires_approval ?? true,
              allow_named_story_exports: d.allow_named_story_exports ?? false,
            },
          },
          update: {
            dataGovernancePolicy: {
              retention_days: d.retention_days ?? 365,
              legal_hold_enabled: d.legal_hold_enabled ?? false,
              pii_export_enabled: d.pii_export_enabled ?? true,
              deletion_requires_approval:
                d.deletion_requires_approval ?? true,
              allow_named_story_exports: d.allow_named_story_exports ?? false,
            },
          },
        });
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "POLICY",
          action: "DATA_GOVERNANCE_POLICY_UPDATED",
          targetType: "org_settings",
          targetId: req.organizationId!,
          severity: "WARN",
          metadata: { updated_fields: Object.keys(d) },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({ updated: true });
      } catch (err) {
        logger.error("Update data governance policy error", { error: err });
        res.status(500).json({ error: "Failed to update data governance policy" });
      }
    }
  );

  // ── Admin: Feature Flags ───────────────────────────────────────────

  router.get(
    "/feature-flags",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const flags = await featureFlags.list(req.organizationId!);
        res.json({
          flags: flags.map((f: { id: string; key: string; enabled: boolean; config: unknown; createdAt: Date; updatedAt: Date }) => ({
            id: f.id,
            key: f.key,
            enabled: f.enabled,
            config: f.config,
            created_at: f.createdAt.toISOString(),
            updated_at: f.updatedAt.toISOString(),
          })),
        });
      } catch (err) {
        logger.error("Get feature flags error", { error: err });
        res.status(500).json({ error: "Failed to load feature flags" });
      }
    }
  );

  router.patch(
    "/feature-flags",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parse = UpsertFeatureFlagSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      try {
        const flag = await featureFlags.upsert({
          organizationId: req.organizationId!,
          key: parse.data.key,
          enabled: parse.data.enabled,
          config: parse.data.config,
        });
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "POLICY",
          action: "FEATURE_FLAG_UPDATED",
          targetType: "feature_flag",
          targetId: flag.id,
          severity: "WARN",
          metadata: {
            key: flag.key,
            enabled: flag.enabled,
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({
          flag: {
            id: flag.id,
            key: flag.key,
            enabled: flag.enabled,
            config: flag.config,
          },
        });
      } catch (err) {
        logger.error("Update feature flag error", { error: err });
        res.status(500).json({ error: "Failed to update feature flag" });
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
        logger.error("Get permissions error", { error: err });
        res.status(500).json({ error: "Failed to load permissions" });
      }
    }
  );

  // ── Admin: Team/Role Profiles ────────────────────────────────────────

  router.get(
    "/roles",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        await roleProfiles.ensurePresetRoles(req.organizationId!);

        const [roles, users] = await Promise.all([
          prisma.roleProfile.findMany({
            where: { organizationId: req.organizationId! },
            orderBy: [{ isPreset: "desc" }, { name: "asc" }],
            include: {
              assignments: {
                select: { userId: true, user: { select: { name: true, email: true } } },
              },
            },
          }),
          prisma.user.findMany({
            where: { organizationId: req.organizationId! },
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              roleAssignment: { select: { roleProfileId: true } },
            },
            orderBy: { email: "asc" },
          }),
        ]);

        res.json({
          roles,
          users: users.map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            base_role: u.role,
            role_profile_id: u.roleAssignment?.roleProfileId ?? null,
          })),
        });
      } catch (err) {
        logger.error("Get role profiles error", { error: err });
        res.status(500).json({ error: "Failed to load role profiles" });
      }
    }
  );

  router.post(
    "/roles",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parse = UpsertRoleProfileSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      try {
        const d = parse.data;
        const role = await prisma.roleProfile.create({
          data: {
            organizationId: req.organizationId!,
            key: d.key,
            name: d.name,
            description: d.description,
            isPreset: false,
            permissions: d.permissions as PermissionType[],
            canAccessAnonymousStories: d.can_access_anonymous_stories,
            canGenerateAnonymousStories: d.can_generate_anonymous_stories,
            canAccessNamedStories: d.can_access_named_stories,
            canGenerateNamedStories: d.can_generate_named_stories,
            defaultAccountScopeType: d.default_account_scope_type as AccountScopeType,
            defaultAccountIds: d.default_account_ids ?? [],
            maxTokensPerDay: d.max_tokens_per_day ?? null,
            maxTokensPerMonth: d.max_tokens_per_month ?? null,
            maxRequestsPerDay: d.max_requests_per_day ?? null,
            maxRequestsPerMonth: d.max_requests_per_month ?? null,
            maxStoriesPerMonth: d.max_stories_per_month ?? null,
          },
        });
        res.status(201).json({ role });
      } catch (err) {
        logger.error("Create role profile error", { error: err });
        res.status(500).json({ error: "Failed to create role profile" });
      }
    }
  );

  router.patch(
    "/roles/:roleId",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parse = UpsertRoleProfileSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      try {
        const existing = await prisma.roleProfile.findFirst({
          where: { id: req.params.roleId as string, organizationId: req.organizationId! },
        });
        if (!existing) {
          res.status(404).json({ error: "Role profile not found" });
          return;
        }

        if (existing.isPreset && existing.key !== parse.data.key) {
          res.status(400).json({ error: "Preset role keys cannot be changed" });
          return;
        }

        const d = parse.data;
        const role = await prisma.roleProfile.update({
          where: { id: existing.id },
          data: {
            key: d.key,
            name: d.name,
            description: d.description,
            permissions: d.permissions as PermissionType[],
            canAccessAnonymousStories: d.can_access_anonymous_stories,
            canGenerateAnonymousStories: d.can_generate_anonymous_stories,
            canAccessNamedStories: d.can_access_named_stories,
            canGenerateNamedStories: d.can_generate_named_stories,
            defaultAccountScopeType: d.default_account_scope_type as AccountScopeType,
            defaultAccountIds: d.default_account_ids ?? [],
            maxTokensPerDay: d.max_tokens_per_day ?? null,
            maxTokensPerMonth: d.max_tokens_per_month ?? null,
            maxRequestsPerDay: d.max_requests_per_day ?? null,
            maxRequestsPerMonth: d.max_requests_per_month ?? null,
            maxStoriesPerMonth: d.max_stories_per_month ?? null,
          },
        });
        res.json({ role });
      } catch (err) {
        logger.error("Update role profile error", { error: err });
        res.status(500).json({ error: "Failed to update role profile" });
      }
    }
  );

  router.delete(
    "/roles/:roleId",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const role = await prisma.roleProfile.findFirst({
          where: { id: req.params.roleId as string, organizationId: req.organizationId! },
        });
        if (!role) {
          res.status(404).json({ error: "Role profile not found" });
          return;
        }
        if (role.isPreset) {
          res.status(400).json({ error: "Preset roles cannot be deleted" });
          return;
        }

        await prisma.userRoleAssignment.deleteMany({
          where: { roleProfileId: role.id },
        });
        await prisma.roleProfile.delete({ where: { id: role.id } });
        res.json({ deleted: true });
      } catch (err) {
        logger.error("Delete role profile error", { error: err });
        res.status(500).json({ error: "Failed to delete role profile" });
      }
    }
  );

  router.post(
    "/roles/assign",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parse = AssignRoleSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      try {
        await roleProfiles.assignRoleToUser(
          req.organizationId!,
          parse.data.user_id,
          parse.data.role_profile_id,
          req.userId
        );
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "PERMISSION",
          action: "ROLE_PROFILE_ASSIGNED",
          targetType: "user",
          targetId: parse.data.user_id,
          severity: "WARN",
          metadata: { role_profile_id: parse.data.role_profile_id },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({ assigned: true });
      } catch (err) {
        logger.error("Assign role profile error", { error: err });
        res.status(400).json({ error: err instanceof Error ? err.message : "Failed to assign role profile" });
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
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "PERMISSION",
          action: "USER_PERMISSION_GRANTED",
          targetType: "user",
          targetId: parse.data.user_id,
          severity: "WARN",
          metadata: { permission: parse.data.permission },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({ granted: true });
      } catch (err) {
        logger.error("Grant permission error", { error: err });
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
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "PERMISSION",
          action: "USER_PERMISSION_REVOKED",
          targetType: "user",
          targetId: parse.data.user_id,
          severity: "WARN",
          metadata: { permission: parse.data.permission },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({ revoked: true });
      } catch (err) {
        logger.error("Revoke permission error", { error: err });
        res.status(500).json({ error: "Failed to revoke permission" });
      }
    }
  );

  // ── Admin: Account Access Control ──────────────────────────────────

  const accessService = new AccountAccessService(prisma);

  /**
   * GET /api/dashboard/access
   *
   * Lists all org users with their account access grants.
   */
  router.get(
    "/access",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const orgUsers = await prisma.user.findMany({
          where: { organizationId: req.organizationId! },
          select: { id: true, name: true, email: true, role: true },
        });

        const users = await Promise.all(
          orgUsers.map(async (m: { id: string; name: string | null; email: string; role: string }) => {
            const grants = await accessService.listUserAccess(
              m.id,
              req.organizationId!
            );
            return {
              user_id: m.id,
              user_name: m.name,
              user_email: m.email,
              role: m.role,
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
              })),
            };
          })
        );

        res.json({ users });
      } catch (err) {
        logger.error("Get all access error", { error: err });
        res.status(500).json({ error: "Failed to load access grants" });
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
          req.params.userId as string,
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
        logger.error("Get access error", { error: err });
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

        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "ACCESS_CONTROL",
          action: "ACCOUNT_ACCESS_GRANTED",
          targetType: "user",
          targetId: parse.data.user_id,
          severity: "WARN",
          metadata: {
            grant_id: grantId,
            scope_type: parse.data.scope_type,
            account_id: parse.data.account_id,
            account_ids_count: parse.data.account_ids?.length ?? 0,
            crm_report_id: parse.data.crm_report_id,
            crm_provider: parse.data.crm_provider,
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
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
        logger.error("Grant access error", { error: err });
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
        const grant = await prisma.userAccountAccess.findFirst({
          where: {
            id: req.params.grantId as string,
            organizationId: req.organizationId!,
          },
          select: { id: true, userId: true, scopeType: true },
        });
        if (!grant) {
          res.status(404).json({ error: "Access grant not found" });
          return;
        }

        await accessService.revokeAccess(req.params.grantId as string);
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "ACCESS_CONTROL",
          action: "ACCOUNT_ACCESS_REVOKED",
          targetType: "access_grant",
          targetId: grant.id,
          severity: "WARN",
          metadata: { target_user_id: grant.userId, scope_type: grant.scopeType },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({ revoked: true });
      } catch (err) {
        logger.error("Revoke access error", { error: err });
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
        const result = await accessService.syncCrmReportGrant(req.params.grantId as string);
        res.json({ synced: true, account_count: result.accountCount });
      } catch (err) {
        logger.error("Sync CRM report error", { error: err });
        res.status(500).json({ error: "Failed to sync CRM report" });
      }
    }
  );

  router.get(
    "/audit-logs",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const limitRaw = Number(req.query.limit ?? 200);
        const limit = Number.isFinite(limitRaw)
          ? Math.max(1, Math.min(500, Math.floor(limitRaw)))
          : 200;
        const category = (req.query.category as string | undefined)?.trim();
        const actorUserId = (req.query.actor_user_id as string | undefined)?.trim();

        const logs = await prisma.auditLog.findMany({
          where: {
            organizationId: req.organizationId!,
            ...(category ? { category } : {}),
            ...(actorUserId ? { actorUserId } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: limit,
        });

        res.json({
          logs: logs.map((l) => ({
            id: l.id,
            created_at: l.createdAt.toISOString(),
            actor_user_id: l.actorUserId,
            category: l.category,
            action: l.action,
            target_type: l.targetType,
            target_id: l.targetId,
            severity: l.severity,
            metadata: l.metadata,
            ip_address: l.ipAddress,
            user_agent: l.userAgent,
          })),
        });
      } catch (err) {
        logger.error("Get audit logs error", { error: err });
        res.status(500).json({ error: "Failed to load audit logs" });
      }
    }
  );

  // ── Account Search ─────────────────────────────────────────────────

  /**
   * GET /api/dashboard/accounts/search?q=...
   *
   * Searches accounts by name or domain within the org.
   */
  router.get(
    "/accounts/search",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const q = (req.query.q as string || "").trim();
      try {
        const accounts = await prisma.account.findMany({
          where: {
            organizationId: req.organizationId!,
            ...(q
              ? {
                  OR: [
                    { name: { contains: q, mode: "insensitive" as const } },
                    { domain: { contains: q, mode: "insensitive" as const } },
                  ],
                }
              : {}),
          },
          select: { id: true, name: true, domain: true, industry: true },
          orderBy: { name: "asc" },
          take: 50,
        });
        res.json({ accounts });
      } catch (err) {
        logger.error("Account search error", { error: err });
        res.status(500).json({ error: "Failed to search accounts" });
      }
    }
  );

  // ── CRM Reports ──────────────────────────────────────────────────

  /**
   * GET /api/dashboard/crm-reports?provider=SALESFORCE|HUBSPOT
   *
   * Lists available CRM reports/lists for the given provider.
   */
  router.get(
    "/crm-reports",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const provider = (req.query.provider as string || "").toUpperCase();
      if (!["SALESFORCE", "HUBSPOT"].includes(provider)) {
        res.status(400).json({ error: "Invalid provider. Use SALESFORCE or HUBSPOT." });
        return;
      }

      try {
        const accessRecords = await prisma.userAccountAccess.findMany({
          where: {
            organizationId: req.organizationId!,
            scopeType: "CRM_REPORT",
            crmProvider: provider as CRMProvider,
            crmReportId: { not: null },
          },
          select: { crmReportId: true, crmReportName: true, crmProvider: true },
          distinct: ["crmReportId"],
          orderBy: { crmReportName: "asc" },
        });
        res.json({
          reports: accessRecords.map((r: { crmReportId: string | null; crmReportName: string | null; crmProvider: string | null }) => ({
            id: r.crmReportId,
            name: r.crmReportName,
            provider: r.crmProvider,
          })),
        });
      } catch (err) {
        logger.error("CRM reports error", { error: err });
        res.status(500).json({ error: "Failed to load CRM reports" });
      }
    }
  );

  return router;
}
