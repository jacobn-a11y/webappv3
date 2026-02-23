/**
 * Landing Page Dashboard & Admin Routes
 *
 * Provides:
 *   - Dashboard overview (stats, page list with filters)
 *   - Admin permission management (grant/revoke, org settings)
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { PrismaClient, PermissionType, UserRole, AccountScopeType, CRMProvider } from "@prisma/client";
import crypto from "crypto";
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
import { getResolvedEntitlementOverride } from "../services/entitlements.js";
import { parseBoundedLimit, PAGINATION_LIMITS } from "../lib/pagination.js";
import { ResponseCache } from "../lib/response-cache.js";
import { STORY_FORMATS } from "../types/taxonomy.js";
import {
  applySupportImpersonation,
  requireImpersonationWriteScope,
} from "../middleware/support-impersonation.js";
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
  default_story_length: z.enum(STORY_LENGTHS).optional(),
  default_story_outline: z.enum(STORY_OUTLINES).optional(),
  default_story_format: z.enum(STORY_FORMATS).optional(),
  default_story_type: z.enum(STORY_TYPES).optional(),
});

const DataGovernanceSchema = z.object({
  retention_days: z.number().int().min(30).max(3650).optional(),
  audit_log_retention_days: z.number().int().min(30).max(3650).optional(),
  legal_hold_enabled: z.boolean().optional(),
  pii_export_enabled: z.boolean().optional(),
  deletion_requires_approval: z.boolean().optional(),
  allow_named_story_exports: z.boolean().optional(),
  rto_target_minutes: z.number().int().min(5).max(60 * 24 * 14).optional(),
  rpo_target_minutes: z.number().int().min(5).max(60 * 24 * 14).optional(),
});

const CreateDeletionRequestSchema = z.object({
  target_type: z.enum(["CALL", "STORY", "LANDING_PAGE"]),
  target_id: z.string().min(1),
  reason: z.string().min(3).max(1000).optional(),
});

const ReviewDeletionRequestSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  review_notes: z.string().max(1000).optional(),
});

const SecurityPolicySchema = z.object({
  enforce_mfa_for_admin_actions: z.boolean().optional(),
  sso_enforced: z.boolean().optional(),
  allowed_sso_domains: z.array(z.string().min(1).max(200)).optional(),
  session_controls_enabled: z.boolean().optional(),
  max_session_age_hours: z.number().int().min(1).max(24 * 90).optional(),
  reauth_interval_minutes: z.number().int().min(5).max(24 * 60).optional(),
  ip_allowlist_enabled: z.boolean().optional(),
  ip_allowlist: z.array(z.string().min(1).max(80)).optional(),
});

const UpsertIpAllowlistEntrySchema = z.object({
  cidr: z.string().min(1).max(120),
  label: z.string().max(120).optional(),
  enabled: z.boolean().optional(),
});

const UpdateIpAllowlistEntrySchema = z.object({
  cidr: z.string().min(1).max(120).optional(),
  label: z.string().max(120).nullable().optional(),
  enabled: z.boolean().optional(),
});

const ScimProvisioningSchema = z.object({
  enabled: z.boolean(),
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

const UpdateSeatLimitSchema = z.object({
  seat_limit: z.number().int().min(1).max(50000),
});

const WorkspaceTeamSchema = z.enum(["REVOPS", "MARKETING", "SALES", "CS"]);
const WorkspaceVisibilitySchema = z.enum(["PRIVATE", "TEAM", "ORG"]);

const UpsertWorkspaceSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  team: WorkspaceTeamSchema,
  visibility: WorkspaceVisibilitySchema,
  allowed_role_profile_keys: z.array(z.string().min(1).max(64)).optional(),
  saved_view_config: z.record(z.string(), z.unknown()).optional(),
});

const UpsertSharedAssetSchema = z.object({
  workspace_id: z.string().optional(),
  asset_type: z.enum(["STORY", "PAGE", "REPORT", "PLAYBOOK", "TEMPLATE"]),
  title: z.string().min(2).max(160),
  description: z.string().max(500).optional(),
  source_story_id: z.string().optional(),
  source_page_id: z.string().optional(),
  source_account_id: z.string().optional(),
  visibility: WorkspaceVisibilitySchema,
  allowed_role_profile_keys: z.array(z.string().min(1).max(64)).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const CreateWritebackSchema = z.object({
  provider: z.enum(["SALESFORCE", "HUBSPOT"]).default("SALESFORCE"),
  action_type: z.enum(["TASK", "NOTE", "FIELD_UPDATE", "TIMELINE_EVENT"]),
  account_id: z.string().min(1),
  opportunity_id: z.string().optional(),
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(5000).optional(),
  field_name: z.string().max(120).optional(),
  field_value: z.string().max(2000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const ReviewWritebackSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  notes: z.string().max(1000).optional(),
});

const UpsertAutomationRuleSchema = z.object({
  name: z.string().min(2).max(140),
  description: z.string().max(500).optional(),
  enabled: z.boolean().default(true),
  trigger_type: z.enum(["THRESHOLD", "SCHEDULE", "EVENT"]),
  metric: z.string().max(120).optional(),
  operator: z.enum([">", ">=", "<", "<=", "=="]).optional(),
  threshold: z.number().optional(),
  schedule_cron: z.string().max(120).optional(),
  event_type: z.string().max(120).optional(),
  delivery_type: z.enum(["SLACK", "EMAIL", "WEBHOOK"]),
  delivery_target: z.string().min(3).max(2000),
  payload_template: z.record(z.string(), z.unknown()).optional(),
});

const ArtifactGovernancePolicySchema = z.object({
  approval_chain_enabled: z.boolean().optional(),
  max_expiration_days: z.number().int().min(1).max(3650).nullable().optional(),
  require_provenance: z.boolean().optional(),
});

const ArtifactApprovalStepSchema = z.object({
  step_order: z.number().int().min(1).max(50),
  min_approvals: z.number().int().min(1).max(20).default(1),
  required_role_profile_key: z.string().min(1).max(64).optional(),
  required_user_role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]).optional(),
  approver_scope_type: z
    .enum(["ROLE_PROFILE", "TEAM", "USER", "GROUP", "SELF"])
    .default("ROLE_PROFILE"),
  approver_scope_value: z.string().min(1).max(128).optional(),
  allow_self_approval: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

const UpsertArtifactApprovalStepsSchema = z.object({
  steps: z.array(ArtifactApprovalStepSchema).max(50),
});

const CreateApprovalGroupSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
});

const AddApprovalGroupMemberSchema = z.object({
  user_id: z.string().min(1),
});

const ReplaceTeamApprovalScopesSchema = z.object({
  team_keys: z.array(z.string().min(1).max(64)).max(50),
});

const CreateQualityFeedbackSchema = z.object({
  story_id: z.string().min(1),
  feedback_type: z.enum(["CORRECTION", "DISPUTE", "MISSING_EVIDENCE", "LINEAGE_FIX"]),
  target_type: z.enum(["STORY", "QUOTE", "CLAIM"]),
  target_id: z.string().optional(),
  original_value: z.string().max(5000).optional(),
  corrected_value: z.string().max(5000).optional(),
  notes: z.string().max(2000).optional(),
  apply_to_prompt_tuning: z.boolean().optional(),
});

const ReviewQualityFeedbackSchema = z.object({
  status: z.enum(["OPEN", "ACCEPTED", "REJECTED", "APPLIED"]),
  notes: z.string().max(2000).optional(),
});

const StartSupportImpersonationSchema = z.object({
  target_user_id: z.string().min(1),
  reason: z.string().min(8).max(1000),
  ttl_minutes: z.number().int().min(5).max(240).optional(),
  scope: z.array(z.enum(["READ_ONLY", "WRITE"])).max(5).optional(),
});

const CreateIncidentSchema = z.object({
  title: z.string().min(3).max(200),
  summary: z.string().min(5).max(5000),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  started_at: z.string().datetime().optional(),
});

const AddIncidentUpdateSchema = z.object({
  message: z.string().min(3).max(5000),
  status: z.enum(["OPEN", "MONITORING", "RESOLVED"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
  impersonation?: {
    sessionId: string;
    actorUserId: string;
    targetUserId: string;
    scope: string[];
    reason: string;
    expiresAt: string;
  };
}

interface DataGovernancePolicy {
  retention_days?: number;
  audit_log_retention_days?: number;
  legal_hold_enabled?: boolean;
  pii_export_enabled?: boolean;
  deletion_requires_approval?: boolean;
  allow_named_story_exports?: boolean;
  rto_target_minutes?: number;
  rpo_target_minutes?: number;
}

interface SecurityPolicy {
  enforce_mfa_for_admin_actions?: boolean;
  sso_enforced?: boolean;
  allowed_sso_domains?: string[];
  session_controls_enabled?: boolean;
  max_session_age_hours?: number;
  reauth_interval_minutes?: number;
  ip_allowlist_enabled?: boolean;
  ip_allowlist?: string[];
}

function hashScimToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function canManageSupportImpersonation(
  prisma: PrismaClient,
  req: AuthReq
): Promise<boolean> {
  if (!req.userId) return false;
  if (req.userRole === "OWNER" || req.userRole === "ADMIN") return true;
  const grant = await prisma.userPermission.findUnique({
    where: {
      userId_permission: {
        userId: req.userId,
        permission: "MANAGE_PERMISSIONS",
      },
    },
    select: { id: true },
  });
  return !!grant;
}

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createDashboardRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const editor = new LandingPageEditor(prisma);
  const permManager = new PermissionManager(prisma);
  const roleProfiles = new RoleProfileService(prisma);
  const auditLogs = new AuditLogService(prisma);
  const featureFlags = new FeatureFlagService(prisma);
  const homeCache = new ResponseCache<Record<string, unknown>>(30_000);

  // Support impersonation can apply target-user context with audited guardrails.
  router.use(applySupportImpersonation(prisma));
  router.use(requireImpersonationWriteScope);

  const deleteGovernedTarget = async (
    organizationId: string,
    targetType: "CALL" | "STORY" | "LANDING_PAGE",
    targetId: string
  ): Promise<boolean> => {
    if (targetType === "CALL") {
      const result = await prisma.call.deleteMany({
        where: { id: targetId, organizationId },
      });
      return result.count > 0;
    }
    if (targetType === "STORY") {
      const result = await prisma.story.deleteMany({
        where: {
          id: targetId,
          organizationId,
          landingPages: { none: {} },
        },
      });
      return result.count > 0;
    }
    const result = await prisma.landingPage.deleteMany({
      where: { id: targetId, organizationId },
    });
    return result.count > 0;
  };

  const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, value));

  // ── Dashboard Overview ──────────────────────────────────────────────

  router.get("/home", async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const cacheKey = `${req.organizationId}:${req.userId}:${req.userRole ?? "MEMBER"}`;
      const payload = await homeCache.getOrSet(cacheKey, async () => {
        const [assignment, user, stories30d, pages30d, failedIntegrations, pendingApprovals] =
          await Promise.all([
            prisma.userRoleAssignment.findUnique({
              where: { userId: req.userId },
              include: { roleProfile: true },
            }),
            prisma.user.findUnique({
              where: { id: req.userId },
              select: { name: true, email: true, role: true },
            }),
            prisma.story.count({
              where: {
                organizationId: req.organizationId,
                generatedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
              },
            }),
            prisma.landingPage.count({
              where: {
                organizationId: req.organizationId,
                createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
              },
            }),
            prisma.integrationConfig.count({
              where: {
                organizationId: req.organizationId,
                status: "ERROR",
              },
            }),
            prisma.approvalRequest.count({
              where: {
                organizationId: req.organizationId,
                status: "PENDING",
              },
            }),
          ]);

        const roleKey = assignment?.roleProfile?.key ?? null;
        const baseRole = req.userRole ?? user?.role ?? "MEMBER";
        let persona: "REVOPS_ADMIN" | "MARKETING_ANALYST" | "SALES_MANAGER" | "CSM" | "EXEC" =
          "REVOPS_ADMIN";

        // Safe default based on base role (least-privilege)
        if (baseRole === "VIEWER") persona = "EXEC";
        else if (baseRole === "MEMBER") persona = "MARKETING_ANALYST";

        // Override with role profile if assigned
        if (roleKey === "EXEC") persona = "EXEC";
        else if (roleKey === "SALES") persona = "SALES_MANAGER";
        else if (roleKey === "CS") persona = "CSM";
        else if (roleKey === "REVOPS" || baseRole === "OWNER" || baseRole === "ADMIN") {
          persona = "REVOPS_ADMIN";
        } else if (assignment?.roleProfile?.permissions.includes("VIEW_ANALYTICS")) {
          persona = "MARKETING_ANALYST";
        }

        const [postSaleStories, mofuStories, bofuStories, pageViewsSum] = await Promise.all([
          prisma.story.count({
            where: {
              organizationId: req.organizationId,
              funnelStages: { has: "POST_SALE" },
              generatedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
            },
          }),
          prisma.story.count({
            where: {
              organizationId: req.organizationId,
              funnelStages: { has: "MOFU" },
              generatedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
            },
          }),
          prisma.story.count({
            where: {
              organizationId: req.organizationId,
              funnelStages: { has: "BOFU" },
              generatedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
            },
          }),
          prisma.landingPage.aggregate({
            where: { organizationId: req.organizationId },
            _sum: { viewCount: true },
          }),
        ]);

        return {
          user: {
            id: req.userId,
            name: user?.name ?? null,
            email: user?.email ?? null,
            base_role: baseRole,
            role_profile_key: roleKey,
            role_profile_name: assignment?.roleProfile?.name ?? null,
          },
          persona,
          summary: {
            stories_30d: stories30d,
            pages_30d: pages30d,
            failed_integrations: failedIntegrations,
            pending_approvals: pendingApprovals,
            post_sale_stories_30d: postSaleStories,
            mofu_stories_30d: mofuStories,
            bofu_stories_30d: bofuStories,
            total_page_views: pageViewsSum._sum.viewCount ?? 0,
          },
          recommended_actions:
            persona === "REVOPS_ADMIN"
              ? [
                  "Review pending approvals and governance queue.",
                  "Resolve failed integrations and stale syncs.",
                  "Confirm billing readiness and seat allocations.",
                ]
              : persona === "MARKETING_ANALYST"
                ? [
                    "Review MOFU and BOFU story trends for campaign planning.",
                    "Export approved assets for campaign channels.",
                    "Validate attribution links and conversion signals.",
                  ]
                : persona === "SALES_MANAGER"
                  ? [
                      "Generate BOFU ROI stories for active pipeline deals.",
                      "Publish customer proof pages for reps.",
                      "Review competitor and objection themes this week.",
                    ]
                  : persona === "CSM"
                    ? [
                        "Generate post-sale expansion and adoption stories.",
                        "Track renewals and customer health signals.",
                        "Publish anonymized customer success highlights.",
                      ]
                    : [
                        "Review executive KPI summary and growth trends.",
                        "Inspect strategic impact and risk signals.",
                        "Track ROI outcomes across published stories.",
                      ],
        };
      });

      res.json(payload);
    } catch (err) {
      logger.error("Get role-aware home error", { error: err });
      res.status(500).json({ error: "Failed to load role-aware home" });
    }
  });

  router.get("/customer-success/health", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    try {
      const orgId = req.organizationId;
      const now = Date.now();
      const days30 = new Date(now - 30 * 24 * 60 * 60 * 1000);

      const [
        totalUsers,
        activeUsers30dRows,
        stories30d,
        pages30d,
        failedIntegrations,
        pendingApprovals,
        setup,
        assignments,
        teamWorkspaceCounts,
        sharedAssetCounts,
      ] = await Promise.all([
        prisma.user.count({ where: { organizationId: orgId } }),
        prisma.aIUsageRecord.findMany({
          where: {
            organizationId: orgId,
            createdAt: { gte: days30 },
          },
          distinct: ["userId"],
          select: { userId: true },
        }),
        prisma.story.count({
          where: { organizationId: orgId, generatedAt: { gte: days30 } },
        }),
        prisma.landingPage.count({
          where: { organizationId: orgId, createdAt: { gte: days30 } },
        }),
        prisma.integrationConfig.count({
          where: { organizationId: orgId, status: "ERROR" },
        }),
        prisma.approvalRequest.count({
          where: { organizationId: orgId, status: "PENDING" },
        }),
        prisma.setupWizard.findUnique({
          where: { organizationId: orgId },
        }),
        prisma.userRoleAssignment.findMany({
          where: { roleProfile: { organizationId: orgId } },
          include: { roleProfile: { select: { key: true } } },
        }),
        prisma.teamWorkspace.groupBy({
          by: ["team"],
          where: { organizationId: orgId },
          _count: true,
        }),
        prisma.sharedAsset.groupBy({
          by: ["visibility"],
          where: { organizationId: orgId },
          _count: true,
        }),
      ]);

      const activeUsers30d = activeUsers30dRows.length;
      const adoptionRatePct =
        totalUsers > 0 ? Math.round((activeUsers30d / totalUsers) * 100) : 0;

      const setupSteps = setup
        ? [
            !!setup.recordingProvider,
            !!setup.crmProvider,
            setup.syncedAccountCount > 0,
            !!setup.selectedPlan,
            !!setup.permissionsConfiguredAt,
          ]
        : [false, false, false, false, false];
      const onboardingProgressPct = Math.round(
        (setupSteps.filter(Boolean).length / setupSteps.length) * 100
      );

      const onboardingScore = onboardingProgressPct;
      const adoptionScore = clamp(
        Math.round(
          adoptionRatePct * 0.55 +
            Math.min(100, stories30d * 0.7) * 0.25 +
            Math.min(100, pages30d * 1.2) * 0.2
        ),
        0,
        100
      );
      const reliabilityScore = clamp(
        100 - failedIntegrations * 18 - pendingApprovals * 2,
        0,
        100
      );
      const overallScore = Math.round(
        onboardingScore * 0.3 + adoptionScore * 0.4 + reliabilityScore * 0.3
      );

      const teamMemberBuckets: Record<string, Set<string>> = {
        REVOPS: new Set<string>(),
        MARKETING: new Set<string>(),
        SALES: new Set<string>(),
        CS: new Set<string>(),
      };
      for (const assignment of assignments) {
        if (assignment.roleProfile?.key == null) continue;
        const key = assignment.roleProfile?.key ?? "REVOPS";
        const team =
          key === "SALES"
            ? "SALES"
            : key === "CS"
              ? "CS"
              : key.includes("MARKETING")
                ? "MARKETING"
                : "REVOPS";
        teamMemberBuckets[team].add(assignment.userId);
      }

      const workspaceCountMap = Object.fromEntries(
        teamWorkspaceCounts.map((r) => [r.team, r._count])
      ) as Record<string, number>;
      const totalSharedAssets = sharedAssetCounts.reduce(
        (sum, r) => sum + r._count,
        0
      );

      const teams = (["REVOPS", "MARKETING", "SALES", "CS"] as const).map((team) => {
        const members = teamMemberBuckets[team].size;
        const workspaceCount = workspaceCountMap[team] ?? 0;
        const score = clamp(
          Math.round(
            (members > 0 ? 35 : 0) +
              Math.min(30, workspaceCount * 15) +
              Math.min(35, totalSharedAssets * 2)
          ),
          0,
          100
        );
        return {
          team,
          members,
          workspace_count: workspaceCount,
          score,
          risk: score < 40 ? "HIGH" : score < 70 ? "MEDIUM" : "LOW",
        };
      });

      const riskIndicators: string[] = [];
      if (failedIntegrations > 0) {
        riskIndicators.push(`${failedIntegrations} integration(s) in ERROR state.`);
      }
      if (pendingApprovals > 10) {
        riskIndicators.push(`Approval backlog is high (${pendingApprovals} pending).`);
      }
      if (onboardingProgressPct < 100) {
        riskIndicators.push(
          `Onboarding incomplete (${onboardingProgressPct}% complete).`
        );
      }
      if (adoptionRatePct < 40) {
        riskIndicators.push(`Low active-user adoption (${adoptionRatePct}% in 30d).`);
      }

      res.json({
        overall_score: overallScore,
        onboarding_progress_pct: onboardingProgressPct,
        adoption_rate_pct: adoptionRatePct,
        reliability_score: reliabilityScore,
        teams,
        risk_indicators: riskIndicators,
      });
    } catch (err) {
      logger.error("Customer success health error", { error: err });
      res.status(500).json({ error: "Failed to load customer success health" });
    }
  });

  router.get(
    "/customer-success/renewal-value-report",
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      try {
        const orgId = req.organizationId;
        const now = Date.now();
        const days90 = new Date(now - 90 * 24 * 60 * 60 * 1000);
        const days30 = new Date(now - 30 * 24 * 60 * 60 * 1000);

        const [
          usage90d,
          storyCount90d,
          pageCount90d,
          publishedPages90d,
          activeUsers30dRows,
          totalUsers,
          subscription,
          topTopics,
        ] = await Promise.all([
          prisma.usageRecord.groupBy({
            by: ["metric"],
            where: {
              organizationId: orgId,
              periodStart: { gte: days90 },
            },
            _sum: { quantity: true },
          }),
          prisma.story.count({
            where: { organizationId: orgId, generatedAt: { gte: days90 } },
          }),
          prisma.landingPage.count({
            where: { organizationId: orgId, createdAt: { gte: days90 } },
          }),
          prisma.landingPage.count({
            where: {
              organizationId: orgId,
              status: "PUBLISHED",
              publishedAt: { gte: days90 },
            },
          }),
          prisma.aIUsageRecord.findMany({
            where: { organizationId: orgId, createdAt: { gte: days30 } },
            distinct: ["userId"],
            select: { userId: true },
          }),
          prisma.user.count({ where: { organizationId: orgId } }),
          prisma.subscription.findFirst({
            where: { organizationId: orgId },
            orderBy: { createdAt: "desc" },
          }),
          prisma.callTag.groupBy({
            by: ["topic"],
            where: {
              call: { organizationId: orgId },
            },
            _count: true,
            orderBy: { _count: { topic: "desc" } },
            take: 5,
          }),
        ]);

        const usage_by_metric = Object.fromEntries(
          usage90d.map((row) => [row.metric, row._sum.quantity ?? 0])
        );
        const activeUsers30d = activeUsers30dRows.length;
        const adoptionRatePct =
          totalUsers > 0 ? Math.round((activeUsers30d / totalUsers) * 100) : 0;

        const renewalHealth =
          adoptionRatePct >= 65 && publishedPages90d >= 5
            ? "STRONG"
            : adoptionRatePct >= 40
              ? "WATCH"
              : "AT_RISK";

        const headline =
          renewalHealth === "STRONG"
            ? "Adoption and output trends support a strong renewal narrative."
            : renewalHealth === "WATCH"
              ? "Renewal is viable, but adoption and output should improve before procurement review."
              : "Renewal risk is elevated due to low adoption and limited published outcomes.";

        const roiNarrative = [
          `In the last 90 days, your teams generated ${storyCount90d} stories and ${publishedPages90d} published pages.`,
          `30-day active-user adoption is ${adoptionRatePct}% (${activeUsers30d}/${totalUsers}).`,
          `Top recurring evidence themes: ${topTopics.map((t) => t.topic).join(", ") || "none yet"}.`,
          `Current renewal posture: ${renewalHealth}.`,
        ].join(" ");

        res.json({
          window_days: 90,
          renewal_health: renewalHealth,
          headline,
          usage_by_metric,
          outcomes: {
            stories_generated_90d: storyCount90d,
            pages_created_90d: pageCount90d,
            pages_published_90d: publishedPages90d,
            active_users_30d: activeUsers30d,
            total_users: totalUsers,
            adoption_rate_pct: adoptionRatePct,
            top_topics: topTopics.map((t) => ({
              topic: t.topic,
              count: t._count,
            })),
          },
          contract_context: {
            subscription_status: subscription?.status ?? null,
            billing_interval: subscription?.billingInterval ?? null,
            current_period_end: subscription?.currentPeriodEnd?.toISOString() ?? null,
            contract_value_cents: subscription?.contractValue ?? null,
          },
          roi_narrative: roiNarrative,
        });
      } catch (err) {
        logger.error("Customer success renewal value report error", { error: err });
        res.status(500).json({ error: "Failed to load renewal value report" });
      }
    }
  );

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
          select: { dataGovernancePolicy: true },
        });
        const rawPolicy = settings?.dataGovernancePolicy;
        const policy =
          rawPolicy && typeof rawPolicy === "object" && !Array.isArray(rawPolicy)
            ? (rawPolicy as DataGovernancePolicy)
            : {};
        res.json({
          retention_days: policy.retention_days ?? 365,
          audit_log_retention_days: policy.audit_log_retention_days ?? 365,
          legal_hold_enabled: policy.legal_hold_enabled ?? false,
          pii_export_enabled: policy.pii_export_enabled ?? true,
          deletion_requires_approval: policy.deletion_requires_approval ?? true,
          allow_named_story_exports: policy.allow_named_story_exports ?? false,
          rto_target_minutes: policy.rto_target_minutes ?? 240,
          rpo_target_minutes: policy.rpo_target_minutes ?? 60,
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
        await prisma.orgSettings.upsert({
          where: { organizationId: req.organizationId! },
          create: {
            organizationId: req.organizationId!,
            dataGovernancePolicy: {
              retention_days: d.retention_days ?? 365,
              audit_log_retention_days: d.audit_log_retention_days ?? 365,
              legal_hold_enabled: d.legal_hold_enabled ?? false,
              pii_export_enabled: d.pii_export_enabled ?? true,
              deletion_requires_approval:
                d.deletion_requires_approval ?? true,
              allow_named_story_exports: d.allow_named_story_exports ?? false,
              rto_target_minutes: d.rto_target_minutes ?? 240,
              rpo_target_minutes: d.rpo_target_minutes ?? 60,
            },
          },
          update: {
            dataGovernancePolicy: {
              retention_days: d.retention_days ?? 365,
              audit_log_retention_days: d.audit_log_retention_days ?? 365,
              legal_hold_enabled: d.legal_hold_enabled ?? false,
              pii_export_enabled: d.pii_export_enabled ?? true,
              deletion_requires_approval:
                d.deletion_requires_approval ?? true,
              allow_named_story_exports: d.allow_named_story_exports ?? false,
              rto_target_minutes: d.rto_target_minutes ?? 240,
              rpo_target_minutes: d.rpo_target_minutes ?? 60,
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

  router.get(
    "/data-governance/deletion-requests",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const status = (req.query.status as string | undefined)?.trim().toUpperCase();
      const isKnownStatus =
        status === "PENDING" ||
        status === "APPROVED" ||
        status === "REJECTED" ||
        status === "COMPLETED";

      try {
        const requests = await prisma.approvalRequest.findMany({
          where: isKnownStatus
            ? {
                organizationId: req.organizationId!,
                requestType: "DATA_DELETION",
                status,
              }
            : {
                organizationId: req.organizationId!,
                requestType: "DATA_DELETION",
              },
          orderBy: { createdAt: "desc" },
          take: 200,
          select: {
            id: true,
            status: true,
            targetType: true,
            targetId: true,
            requestPayload: true,
            requestedByUserId: true,
            reviewerUserId: true,
            reviewNotes: true,
            reviewedAt: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        res.json({
          requests: requests.map((r) => ({
            id: r.id,
            status: r.status,
            target_type: r.targetType,
            target_id: r.targetId,
            request_payload: r.requestPayload,
            requested_by_user_id: r.requestedByUserId,
            reviewer_user_id: r.reviewerUserId,
            review_notes: r.reviewNotes,
            reviewed_at: r.reviewedAt?.toISOString() ?? null,
            created_at: r.createdAt.toISOString(),
            updated_at: r.updatedAt.toISOString(),
          })),
        });
      } catch (err) {
        logger.error("List deletion requests error", { error: err });
        res.status(500).json({ error: "Failed to load deletion requests" });
      }
    }
  );

  router.post(
    "/data-governance/deletion-requests",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parsed = CreateDeletionRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "validation_error", details: parsed.error.issues });
        return;
      }

      try {
        const orgId = req.organizationId!;
        const settings = await prisma.orgSettings.findUnique({
          where: { organizationId: orgId },
          select: { dataGovernancePolicy: true },
        });
        const policy =
          settings?.dataGovernancePolicy &&
          typeof settings.dataGovernancePolicy === "object" &&
          !Array.isArray(settings.dataGovernancePolicy)
            ? (settings.dataGovernancePolicy as DataGovernancePolicy)
            : {};

        if (policy.legal_hold_enabled) {
          res.status(423).json({
            error: "legal_hold_active",
            message: "Deletion is blocked because legal hold is enabled.",
          });
          return;
        }

        const requestPayload = {
          reason: parsed.data.reason ?? null,
        };
        if (policy.deletion_requires_approval !== false) {
          const request = await prisma.approvalRequest.create({
            data: {
              organizationId: orgId,
              requestType: "DATA_DELETION",
              targetType: parsed.data.target_type,
              targetId: parsed.data.target_id,
              requestedByUserId: req.userId!,
              status: "PENDING",
              requestPayload,
            },
          });

          await auditLogs.record({
            organizationId: orgId,
            actorUserId: req.userId,
            category: "GOVERNANCE",
            action: "DATA_DELETION_REQUESTED",
            targetType: parsed.data.target_type.toLowerCase(),
            targetId: parsed.data.target_id,
            severity: "WARN",
            metadata: { approval_request_id: request.id, reason: parsed.data.reason ?? null },
            ipAddress: req.ip,
            userAgent: req.get("user-agent"),
          });

          res.status(202).json({
            request_id: request.id,
            status: request.status,
            queued_for_approval: true,
          });
          return;
        }

        const deleted = await deleteGovernedTarget(
          orgId,
          parsed.data.target_type,
          parsed.data.target_id
        );
        await auditLogs.record({
          organizationId: orgId,
          actorUserId: req.userId,
          category: "GOVERNANCE",
          action: "DATA_DELETION_EXECUTED",
          targetType: parsed.data.target_type.toLowerCase(),
          targetId: parsed.data.target_id,
          severity: "WARN",
          metadata: {
            reason: parsed.data.reason ?? null,
            deleted,
            approval_required: false,
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({ deleted });
      } catch (err) {
        logger.error("Create deletion request error", { error: err });
        res.status(500).json({ error: "Failed to create deletion request" });
      }
    }
  );

  router.post(
    "/data-governance/deletion-requests/:requestId/review",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parsed = ReviewDeletionRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "validation_error", details: parsed.error.issues });
        return;
      }
      try {
        const requestId = String(req.params.requestId);
        const request = await prisma.approvalRequest.findFirst({
          where: {
            id: requestId,
            organizationId: req.organizationId!,
            requestType: "DATA_DELETION",
          },
        });
        if (!request) {
          res.status(404).json({ error: "Deletion request not found" });
          return;
        }
        if (request.status !== "PENDING") {
          res.status(409).json({ error: "Request is no longer pending" });
          return;
        }

        if (parsed.data.decision === "REJECT") {
          const updated = await prisma.approvalRequest.update({
            where: { id: request.id },
            data: {
              status: "REJECTED",
              reviewerUserId: req.userId!,
              reviewNotes: parsed.data.review_notes ?? null,
              reviewedAt: new Date(),
            },
          });
          await auditLogs.record({
            organizationId: req.organizationId!,
            actorUserId: req.userId,
            category: "GOVERNANCE",
            action: "DATA_DELETION_REJECTED",
            targetType: updated.targetType.toLowerCase(),
            targetId: updated.targetId,
            severity: "INFO",
            metadata: { approval_request_id: updated.id },
            ipAddress: req.ip,
            userAgent: req.get("user-agent"),
          });
          res.json({ status: "REJECTED" });
          return;
        }

        const targetType = request.targetType as "CALL" | "STORY" | "LANDING_PAGE";
        const deleted = await deleteGovernedTarget(
          req.organizationId!,
          targetType,
          request.targetId
        );
        const updated = await prisma.approvalRequest.update({
          where: { id: request.id },
          data: {
            status: "COMPLETED",
            reviewerUserId: req.userId!,
            reviewNotes: parsed.data.review_notes ?? null,
            reviewedAt: new Date(),
          },
        });
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "GOVERNANCE",
          action: "DATA_DELETION_APPROVED_AND_EXECUTED",
          targetType: updated.targetType.toLowerCase(),
          targetId: updated.targetId,
          severity: "WARN",
          metadata: {
            approval_request_id: updated.id,
            deleted,
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({ status: "COMPLETED", deleted });
      } catch (err) {
        logger.error("Review deletion request error", { error: err });
        res.status(500).json({ error: "Failed to review deletion request" });
      }
    }
  );

  // ── Admin: Artifact Governance (Publish Lifecycle) ────────────────

  router.get(
    "/artifact-governance",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const policy = await prisma.artifactGovernancePolicy.findUnique({
          where: { organizationId: req.organizationId! },
          include: {
            approvalSteps: {
              orderBy: { stepOrder: "asc" },
            },
          },
        });

        if (!policy) {
          res.json({
            approval_chain_enabled: false,
            max_expiration_days: null,
            require_provenance: true,
            steps: [],
          });
          return;
        }

        res.json({
          approval_chain_enabled: policy.approvalChainEnabled,
          max_expiration_days: policy.maxExpirationDays,
          require_provenance: policy.requireProvenance,
          steps: policy.approvalSteps.map((s) => ({
            id: s.id,
            step_order: s.stepOrder,
            min_approvals: s.minApprovals,
            required_role_profile_key: s.requiredRoleProfileKey,
            required_user_role: s.requiredUserRole,
            approver_scope_type: s.approverScopeType,
            approver_scope_value: s.approverScopeValue,
            allow_self_approval: s.allowSelfApproval,
            enabled: s.enabled,
          })),
        });
      } catch (err) {
        logger.error("Get artifact governance policy error", { error: err });
        res.status(500).json({ error: "Failed to load artifact governance policy" });
      }
    }
  );

  router.patch(
    "/artifact-governance",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parse = ArtifactGovernancePolicySchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      try {
        const d = parse.data;
        const policy = await prisma.artifactGovernancePolicy.upsert({
          where: { organizationId: req.organizationId! },
          create: {
            organizationId: req.organizationId!,
            artifactType: "LANDING_PAGE",
            approvalChainEnabled: d.approval_chain_enabled ?? false,
            maxExpirationDays: d.max_expiration_days ?? null,
            requireProvenance: d.require_provenance ?? true,
          },
          update: {
            approvalChainEnabled: d.approval_chain_enabled,
            maxExpirationDays: d.max_expiration_days,
            requireProvenance: d.require_provenance,
          },
        });

        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "POLICY",
          action: "ARTIFACT_GOVERNANCE_POLICY_UPDATED",
          targetType: "artifact_governance_policy",
          targetId: policy.id,
          severity: "WARN",
          metadata: {
            approval_chain_enabled: policy.approvalChainEnabled,
            max_expiration_days: policy.maxExpirationDays,
            require_provenance: policy.requireProvenance,
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });

        res.json({ updated: true });
      } catch (err) {
        logger.error("Update artifact governance policy error", { error: err });
        res.status(500).json({ error: "Failed to update artifact governance policy" });
      }
    }
  );

  router.put(
    "/artifact-governance/steps",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parse = UpsertArtifactApprovalStepsSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      const orgId = req.organizationId!;

      try {
        const duplicateOrders = new Set<number>();
        const seenOrders = new Set<number>();
        for (const step of parse.data.steps) {
          if (seenOrders.has(step.step_order)) {
            duplicateOrders.add(step.step_order);
          }
          seenOrders.add(step.step_order);
        }
        if (duplicateOrders.size > 0) {
          res.status(400).json({
            error: "validation_error",
            message: "Each approval step_order must be unique.",
          });
          return;
        }

        const policy = await prisma.artifactGovernancePolicy.upsert({
          where: { organizationId: orgId },
          create: {
            organizationId: orgId,
            artifactType: "LANDING_PAGE",
            approvalChainEnabled: true,
            requireProvenance: true,
          },
          update: {},
        });

        await prisma.$transaction(async (tx) => {
          await tx.artifactApprovalStep.deleteMany({
            where: { governancePolicyId: policy.id },
          });

          if (parse.data.steps.length > 0) {
            await tx.artifactApprovalStep.createMany({
              data: parse.data.steps.map((step) => ({
                governancePolicyId: policy.id,
                organizationId: orgId,
                stepOrder: step.step_order,
                minApprovals: step.min_approvals,
                requiredRoleProfileKey: step.required_role_profile_key ?? null,
                requiredUserRole: step.required_user_role ?? null,
                approverScopeType: step.approver_scope_type,
                approverScopeValue: step.approver_scope_value ?? null,
                allowSelfApproval: step.allow_self_approval,
                enabled: step.enabled,
              })),
            });
          }
        });

        await auditLogs.record({
          organizationId: orgId,
          actorUserId: req.userId,
          category: "POLICY",
          action: "ARTIFACT_APPROVAL_STEPS_UPDATED",
          targetType: "artifact_governance_policy",
          targetId: policy.id,
          severity: "WARN",
          metadata: { step_count: parse.data.steps.length },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });

        res.json({ updated: true, steps_count: parse.data.steps.length });
      } catch (err) {
        logger.error("Upsert artifact approval steps error", { error: err });
        res.status(500).json({ error: "Failed to update artifact approval steps" });
      }
    }
  );

  router.get(
    "/approval-groups",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const groups = await prisma.approvalGroup.findMany({
          where: { organizationId: req.organizationId! },
          include: {
            members: {
              include: {
                user: { select: { id: true, name: true, email: true, role: true } },
              },
            },
            owner: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: "desc" },
        });

        res.json({
          groups: groups.map((g) => ({
            id: g.id,
            name: g.name,
            description: g.description,
            owner: g.owner,
            members: g.members.map((m) => ({
              id: m.user.id,
              name: m.user.name,
              email: m.user.email,
              role: m.user.role,
            })),
            created_at: g.createdAt.toISOString(),
            updated_at: g.updatedAt.toISOString(),
          })),
        });
      } catch (err) {
        logger.error("List approval groups error", { error: err });
        res.status(500).json({ error: "Failed to load approval groups" });
      }
    }
  );

  router.post(
    "/approval-groups",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parse = CreateApprovalGroupSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }
      try {
        const group = await prisma.approvalGroup.create({
          data: {
            organizationId: req.organizationId!,
            name: parse.data.name.trim(),
            description: parse.data.description?.trim() || null,
            ownerUserId: req.userId ?? null,
          },
        });
        res.status(201).json({
          id: group.id,
          name: group.name,
          description: group.description,
        });
      } catch (err) {
        logger.error("Create approval group error", { error: err });
        res.status(500).json({ error: "Failed to create approval group" });
      }
    }
  );

  router.post(
    "/approval-groups/:groupId/members",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parse = AddApprovalGroupMemberSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }
      try {
        const group = await prisma.approvalGroup.findFirst({
          where: { id: req.params.groupId as string, organizationId: req.organizationId! },
        });
        if (!group) {
          res.status(404).json({ error: "Approval group not found" });
          return;
        }
        const user = await prisma.user.findFirst({
          where: { id: parse.data.user_id, organizationId: req.organizationId! },
        });
        if (!user) {
          res.status(404).json({ error: "User not found" });
          return;
        }

        await prisma.approvalGroupMember.upsert({
          where: {
            groupId_userId: {
              groupId: group.id,
              userId: user.id,
            },
          },
          create: {
            organizationId: req.organizationId!,
            groupId: group.id,
            userId: user.id,
          },
          update: {},
        });

        res.json({ added: true });
      } catch (err) {
        logger.error("Add approval group member error", { error: err });
        res.status(500).json({ error: "Failed to add group member" });
      }
    }
  );

  router.delete(
    "/approval-groups/:groupId/members/:userId",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const deleted = await prisma.approvalGroupMember.deleteMany({
          where: {
            organizationId: req.organizationId!,
            groupId: req.params.groupId as string,
            userId: req.params.userId as string,
          },
        });
        res.json({ removed: deleted.count > 0 });
      } catch (err) {
        logger.error("Remove approval group member error", { error: err });
        res.status(500).json({ error: "Failed to remove group member" });
      }
    }
  );

  router.get(
    "/approval-admin-scopes",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const rows = await prisma.teamApprovalAdminScope.findMany({
          where: { organizationId: req.organizationId! },
          include: { user: { select: { id: true, name: true, email: true } } },
          orderBy: [{ userId: "asc" }, { teamKey: "asc" }],
        });
        const grouped = new Map<
          string,
          { user: { id: string; name: string | null; email: string }; team_keys: string[] }
        >();
        for (const row of rows) {
          const existing = grouped.get(row.userId);
          if (existing) {
            existing.team_keys.push(row.teamKey);
          } else {
            grouped.set(row.userId, {
              user: row.user,
              team_keys: [row.teamKey],
            });
          }
        }
        res.json({ scopes: Array.from(grouped.values()) });
      } catch (err) {
        logger.error("List team approval admin scopes error", { error: err });
        res.status(500).json({ error: "Failed to load team approval admin scopes" });
      }
    }
  );

  router.put(
    "/approval-admin-scopes/:userId",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parse = ReplaceTeamApprovalScopesSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }
      try {
        const userId = req.params.userId as string;
        const user = await prisma.user.findFirst({
          where: { id: userId, organizationId: req.organizationId! },
        });
        if (!user) {
          res.status(404).json({ error: "User not found" });
          return;
        }
        await prisma.$transaction(async (tx) => {
          await tx.teamApprovalAdminScope.deleteMany({
            where: { organizationId: req.organizationId!, userId },
          });
          if (parse.data.team_keys.length > 0) {
            await tx.teamApprovalAdminScope.createMany({
              data: parse.data.team_keys.map((teamKey) => ({
                organizationId: req.organizationId!,
                userId,
                teamKey,
              })),
            });
          }
        });
        res.json({ updated: true, team_keys: parse.data.team_keys });
      } catch (err) {
        logger.error("Replace team approval admin scopes error", { error: err });
        res.status(500).json({ error: "Failed to update team approval admin scopes" });
      }
    }
  );

  // ── Data Quality & Trust ───────────────────────────────────────────

  router.get(
    "/data-quality/overview",
    requirePermission(prisma, "view_analytics"),
    async (req: AuthReq, res: Response) => {
      try {
        const orgId = req.organizationId!;
        const now = new Date();
        const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const prev30 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

        const [
          storyCounts,
          storyConfidenceCurrent,
          storyConfidencePrev,
          lineageCountCurrent,
          feedbackOpen,
          feedbackApplied,
          integrationFailuresCurrent,
          integrationFailuresPrev,
        ] = await Promise.all([
          prisma.story.count({ where: { organizationId: orgId } }),
          prisma.story.aggregate({
            where: { organizationId: orgId, generatedAt: { gte: last30 } },
            _avg: { confidenceScore: true },
          }),
          prisma.story.aggregate({
            where: {
              organizationId: orgId,
              generatedAt: { gte: prev30, lt: last30 },
            },
            _avg: { confidenceScore: true },
          }),
          prisma.storyClaimLineage.count({
            where: { organizationId: orgId, createdAt: { gte: last30 } },
          }),
          prisma.storyQualityFeedback.count({
            where: { organizationId: orgId, status: "OPEN" },
          }),
          prisma.storyQualityFeedback.count({
            where: { organizationId: orgId, status: "APPLIED" },
          }),
          prisma.integrationRun.count({
            where: {
              organizationId: orgId,
              startedAt: { gte: last30 },
              status: { in: ["FAILED", "ERROR"] },
            },
          }),
          prisma.integrationRun.count({
            where: {
              organizationId: orgId,
              startedAt: { gte: prev30, lt: last30 },
              status: { in: ["FAILED", "ERROR"] },
            },
          }),
        ]);

        const avgCurrent = storyConfidenceCurrent._avg.confidenceScore ?? 0;
        const avgPrev = storyConfidencePrev._avg.confidenceScore ?? 0;
        const driftDelta = avgCurrent - avgPrev;
        const driftStatus =
          Math.abs(driftDelta) >= 0.1 ? "ALERT" : Math.abs(driftDelta) >= 0.05 ? "WARN" : "STABLE";

        const failureDelta = integrationFailuresCurrent - integrationFailuresPrev;

        res.json({
          stories_total: storyCounts,
          confidence: {
            avg_30d: Math.round(avgCurrent * 1000) / 1000,
            avg_prev_30d: Math.round(avgPrev * 1000) / 1000,
            drift_delta: Math.round(driftDelta * 1000) / 1000,
            drift_status: driftStatus,
          },
          lineage: {
            claims_30d: lineageCountCurrent,
            coverage_ratio: storyCounts > 0 ? Math.round((lineageCountCurrent / storyCounts) * 1000) / 1000 : 0,
          },
          freshness: {
            last_story_at:
              (
                await prisma.story.findFirst({
                  where: { organizationId: orgId },
                  orderBy: { generatedAt: "desc" },
                  select: { generatedAt: true },
                })
              )?.generatedAt?.toISOString() ?? null,
          },
          sync_errors: {
            failures_30d: integrationFailuresCurrent,
            failures_prev_30d: integrationFailuresPrev,
            delta: failureDelta,
          },
          human_feedback: {
            open: feedbackOpen,
            applied: feedbackApplied,
          },
        });
      } catch (err) {
        logger.error("Data quality overview error", { error: err });
        res.status(500).json({ error: "Failed to load data quality overview" });
      }
    }
  );

  router.get(
    "/data-quality/stories/:storyId/lineage",
    requirePermission(prisma, "view_analytics"),
    async (req: AuthReq, res: Response) => {
      try {
        const story = await prisma.story.findFirst({
          where: { id: req.params.storyId as string, organizationId: req.organizationId! },
          select: { id: true, title: true, confidenceScore: true, lineageSummary: true },
        });
        if (!story) {
          res.status(404).json({ error: "Story not found" });
          return;
        }
        const claims = await prisma.storyClaimLineage.findMany({
          where: {
            organizationId: req.organizationId!,
            storyId: story.id,
          },
          orderBy: { createdAt: "desc" },
          take: 500,
        });
        res.json({
          story: {
            id: story.id,
            title: story.title,
            confidence_score: story.confidenceScore,
            lineage_summary: story.lineageSummary,
          },
          claims: claims.map((c) => ({
            id: c.id,
            claim_type: c.claimType,
            claim_text: c.claimText,
            source_call_id: c.sourceCallId,
            source_chunk_id: c.sourceChunkId,
            source_timestamp_ms: c.sourceTimestampMs,
            confidence_score: c.confidenceScore,
            metadata: c.metadata,
            created_at: c.createdAt.toISOString(),
          })),
        });
      } catch (err) {
        logger.error("Story lineage lookup error", { error: err });
        res.status(500).json({ error: "Failed to load story lineage" });
      }
    }
  );

  router.post(
    "/data-quality/feedback",
    requirePermission(prisma, "view_analytics"),
    async (req: AuthReq, res: Response) => {
      const parsed = CreateQualityFeedbackSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "validation_error", details: parsed.error.issues });
        return;
      }
      try {
        const story = await prisma.story.findFirst({
          where: {
            id: parsed.data.story_id,
            organizationId: req.organizationId!,
          },
          select: { id: true },
        });
        if (!story) {
          res.status(404).json({ error: "Story not found" });
          return;
        }

        const feedback = await prisma.storyQualityFeedback.create({
          data: {
            organizationId: req.organizationId!,
            storyId: story.id,
            submittedByUserId: req.userId ?? null,
            feedbackType: parsed.data.feedback_type,
            targetType: parsed.data.target_type,
            targetId: parsed.data.target_id ?? null,
            originalValue: parsed.data.original_value ?? null,
            correctedValue: parsed.data.corrected_value ?? null,
            notes: parsed.data.notes ?? null,
            applyToPromptTuning: parsed.data.apply_to_prompt_tuning ?? false,
          },
        });

        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "GOVERNANCE",
          action: "STORY_QUALITY_FEEDBACK_SUBMITTED",
          targetType: "story",
          targetId: story.id,
          severity: "INFO",
          metadata: {
            feedback_id: feedback.id,
            feedback_type: feedback.feedbackType,
            apply_to_prompt_tuning: feedback.applyToPromptTuning,
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });

        res.status(201).json({
          id: feedback.id,
          status: feedback.status,
          created_at: feedback.createdAt.toISOString(),
        });
      } catch (err) {
        logger.error("Create quality feedback error", { error: err });
        res.status(500).json({ error: "Failed to submit quality feedback" });
      }
    }
  );

  router.get(
    "/data-quality/feedback",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      try {
        const rows = await prisma.storyQualityFeedback.findMany({
          where: {
            organizationId: req.organizationId!,
            ...(status ? { status } : {}),
          },
          include: {
            story: { select: { id: true, title: true } },
            submittedBy: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 500,
        });
        res.json({
          feedback: rows.map((row) => ({
            id: row.id,
            status: row.status,
            feedback_type: row.feedbackType,
            target_type: row.targetType,
            target_id: row.targetId,
            original_value: row.originalValue,
            corrected_value: row.correctedValue,
            notes: row.notes,
            apply_to_prompt_tuning: row.applyToPromptTuning,
            story: row.story,
            submitted_by: row.submittedBy,
            created_at: row.createdAt.toISOString(),
            updated_at: row.updatedAt.toISOString(),
          })),
        });
      } catch (err) {
        logger.error("List quality feedback error", { error: err });
        res.status(500).json({ error: "Failed to list quality feedback" });
      }
    }
  );

  router.post(
    "/data-quality/feedback/:feedbackId/review",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parsed = ReviewQualityFeedbackSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "validation_error", details: parsed.error.issues });
        return;
      }
      try {
        const feedback = await prisma.storyQualityFeedback.findFirst({
          where: {
            id: req.params.feedbackId as string,
            organizationId: req.organizationId!,
          },
        });
        if (!feedback) {
          res.status(404).json({ error: "Feedback not found" });
          return;
        }
        const updated = await prisma.storyQualityFeedback.update({
          where: { id: feedback.id },
          data: {
            status: parsed.data.status,
            notes:
              parsed.data.notes ??
              feedback.notes ??
              null,
          },
        });
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "POLICY",
          action: "STORY_QUALITY_FEEDBACK_REVIEWED",
          targetType: "story_quality_feedback",
          targetId: updated.id,
          severity: "INFO",
          metadata: { status: updated.status },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({ status: updated.status, updated_at: updated.updatedAt.toISOString() });
      } catch (err) {
        logger.error("Review quality feedback error", { error: err });
        res.status(500).json({ error: "Failed to review quality feedback" });
      }
    }
  );

  // ── Admin: Security Policy ─────────────────────────────────────────

  router.get(
    "/security-policy",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const settings = await prisma.orgSettings.findUnique({
          where: { organizationId: req.organizationId! },
          select: { securityPolicy: true },
        });
        const rawPolicy = settings?.securityPolicy;
        const policy =
          rawPolicy && typeof rawPolicy === "object" && !Array.isArray(rawPolicy)
            ? (rawPolicy as SecurityPolicy)
            : {};

        res.json({
          enforce_mfa_for_admin_actions:
            policy.enforce_mfa_for_admin_actions ?? false,
          sso_enforced: policy.sso_enforced ?? false,
          allowed_sso_domains: policy.allowed_sso_domains ?? [],
          session_controls_enabled: policy.session_controls_enabled ?? false,
          max_session_age_hours: policy.max_session_age_hours ?? 720,
          reauth_interval_minutes: policy.reauth_interval_minutes ?? 60,
          ip_allowlist_enabled: policy.ip_allowlist_enabled ?? false,
          ip_allowlist: policy.ip_allowlist ?? [],
        });
      } catch (err) {
        logger.error("Get security policy error", { error: err });
        res.status(500).json({ error: "Failed to load security policy" });
      }
    }
  );

  router.patch(
    "/security-policy",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parse = SecurityPolicySchema.safeParse(req.body);
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
            securityPolicy: {
              enforce_mfa_for_admin_actions:
                d.enforce_mfa_for_admin_actions ?? false,
              sso_enforced: d.sso_enforced ?? false,
              allowed_sso_domains:
                (d.allowed_sso_domains ?? [])
                  .map((v) => v.trim().toLowerCase())
                  .filter(Boolean),
              session_controls_enabled: d.session_controls_enabled ?? false,
              max_session_age_hours: d.max_session_age_hours ?? 720,
              reauth_interval_minutes: d.reauth_interval_minutes ?? 60,
              ip_allowlist_enabled: d.ip_allowlist_enabled ?? false,
              ip_allowlist: d.ip_allowlist ?? [],
            },
          },
          update: {
            securityPolicy: {
              enforce_mfa_for_admin_actions:
                d.enforce_mfa_for_admin_actions ?? false,
              sso_enforced: d.sso_enforced ?? false,
              allowed_sso_domains:
                (d.allowed_sso_domains ?? [])
                  .map((v) => v.trim().toLowerCase())
                  .filter(Boolean),
              session_controls_enabled: d.session_controls_enabled ?? false,
              max_session_age_hours: d.max_session_age_hours ?? 720,
              reauth_interval_minutes: d.reauth_interval_minutes ?? 60,
              ip_allowlist_enabled: d.ip_allowlist_enabled ?? false,
              ip_allowlist: d.ip_allowlist ?? [],
            },
          },
        });
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "POLICY",
          action: "SECURITY_POLICY_UPDATED",
          targetType: "org_settings",
          targetId: req.organizationId!,
          severity: "CRITICAL",
          metadata: {
            enforce_mfa_for_admin_actions:
              d.enforce_mfa_for_admin_actions ?? false,
            sso_enforced: d.sso_enforced ?? false,
            allowed_sso_domains_count:
              (d.allowed_sso_domains ?? [])
                .map((v) => v.trim().toLowerCase())
                .filter(Boolean).length,
            session_controls_enabled: d.session_controls_enabled ?? false,
            max_session_age_hours: d.max_session_age_hours ?? 720,
            reauth_interval_minutes: d.reauth_interval_minutes ?? 60,
            ip_allowlist_enabled: d.ip_allowlist_enabled ?? false,
            ip_allowlist_count: d.ip_allowlist?.length ?? 0,
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({ updated: true });
      } catch (err) {
        logger.error("Update security policy error", { error: err });
        res.status(500).json({ error: "Failed to update security policy" });
      }
    }
  );

  // ── Admin: IP Allowlist Entries ───────────────────────────────────

  router.get(
    "/security/ip-allowlist",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const entries = await prisma.orgIpAllowlistEntry.findMany({
          where: { organizationId: req.organizationId! },
          orderBy: [{ enabled: "desc" }, { createdAt: "desc" }],
        });
        res.json({
          entries: entries.map((e) => ({
            id: e.id,
            cidr: e.cidr,
            label: e.label,
            enabled: e.enabled,
            created_at: e.createdAt.toISOString(),
            updated_at: e.updatedAt.toISOString(),
          })),
        });
      } catch (err) {
        logger.error("Get IP allowlist entries error", { error: err });
        res.status(500).json({ error: "Failed to load IP allowlist entries" });
      }
    }
  );

  router.post(
    "/security/ip-allowlist",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parse = UpsertIpAllowlistEntrySchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }
      try {
        const entry = await prisma.orgIpAllowlistEntry.create({
          data: {
            organizationId: req.organizationId!,
            cidr: parse.data.cidr.trim(),
            label: parse.data.label?.trim() || null,
            enabled: parse.data.enabled ?? true,
          },
        });
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "POLICY",
          action: "IP_ALLOWLIST_ENTRY_CREATED",
          targetType: "org_ip_allowlist_entry",
          targetId: entry.id,
          severity: "CRITICAL",
          metadata: { cidr: entry.cidr, enabled: entry.enabled },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.status(201).json({
          id: entry.id,
          cidr: entry.cidr,
          label: entry.label,
          enabled: entry.enabled,
        });
      } catch (err) {
        logger.error("Create IP allowlist entry error", { error: err });
        res.status(500).json({ error: "Failed to create IP allowlist entry" });
      }
    }
  );

  router.patch(
    "/security/ip-allowlist/:entryId",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parse = UpdateIpAllowlistEntrySchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }
      try {
        const entryId = Array.isArray(req.params.entryId)
          ? (req.params.entryId[0] ?? "")
          : (req.params.entryId ?? "");
        const updated = await prisma.orgIpAllowlistEntry.updateMany({
          where: {
            id: entryId,
            organizationId: req.organizationId!,
          },
          data: {
            ...(parse.data.cidr !== undefined ? { cidr: parse.data.cidr.trim() } : {}),
            ...(parse.data.label !== undefined
              ? { label: parse.data.label ? parse.data.label.trim() : null }
              : {}),
            ...(parse.data.enabled !== undefined ? { enabled: parse.data.enabled } : {}),
          },
        });
        if (updated.count === 0) {
          res.status(404).json({ error: "allowlist_entry_not_found" });
          return;
        }
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "POLICY",
          action: "IP_ALLOWLIST_ENTRY_UPDATED",
          targetType: "org_ip_allowlist_entry",
          targetId: entryId,
          severity: "CRITICAL",
          metadata: parse.data as Record<string, unknown>,
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({ updated: true });
      } catch (err) {
        logger.error("Update IP allowlist entry error", { error: err });
        res.status(500).json({ error: "Failed to update IP allowlist entry" });
      }
    }
  );

  router.delete(
    "/security/ip-allowlist/:entryId",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const entryId = Array.isArray(req.params.entryId)
          ? (req.params.entryId[0] ?? "")
          : (req.params.entryId ?? "");
        const deleted = await prisma.orgIpAllowlistEntry.deleteMany({
          where: {
            id: entryId,
            organizationId: req.organizationId!,
          },
        });
        if (deleted.count === 0) {
          res.status(404).json({ error: "allowlist_entry_not_found" });
          return;
        }
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "POLICY",
          action: "IP_ALLOWLIST_ENTRY_DELETED",
          targetType: "org_ip_allowlist_entry",
          targetId: entryId,
          severity: "CRITICAL",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({ deleted: true });
      } catch (err) {
        logger.error("Delete IP allowlist entry error", { error: err });
        res.status(500).json({ error: "Failed to delete IP allowlist entry" });
      }
    }
  );

  // ── Admin: Support Impersonation ────────────────────────────────────

  router.get(
    "/support/impersonation/sessions",
    async (req: AuthReq, res: Response) => {
      try {
        if (!req.organizationId || !req.userId) {
          res.status(401).json({ error: "authentication_required" });
          return;
        }
        const allowed = await canManageSupportImpersonation(prisma, req);
        if (!allowed) {
          res.status(403).json({ error: "permission_denied" });
          return;
        }

        const sessions = await prisma.supportImpersonationSession.findMany({
          where: { organizationId: req.organizationId },
          include: {
            actorUser: { select: { id: true, email: true, name: true, role: true } },
            targetUser: { select: { id: true, email: true, name: true, role: true } },
            revokedByUser: { select: { id: true, email: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 100,
        });

        res.json({
          sessions: sessions.map((s) => ({
            id: s.id,
            actor_user_id: s.actorUserId,
            target_user_id: s.targetUserId,
            actor_user_email: s.actorUser.email,
            target_user_email: s.targetUser.email,
            actor_user_name: s.actorUser.name,
            target_user_name: s.targetUser.name,
            actor_user_role: s.actorUser.role,
            target_user_role: s.targetUser.role,
            reason: s.reason,
            scope: Array.isArray(s.scope) ? s.scope : ["READ_ONLY"],
            started_at: s.startedAt.toISOString(),
            last_used_at: s.lastUsedAt?.toISOString() ?? null,
            expires_at: s.expiresAt.toISOString(),
            revoked_at: s.revokedAt?.toISOString() ?? null,
            revoked_by_user_id: s.revokedByUserId,
            revoked_by_user_email: s.revokedByUser?.email ?? null,
          })),
        });
      } catch (err) {
        logger.error("Support impersonation session list error", { error: err });
        res.status(500).json({ error: "Failed to load support impersonation sessions" });
      }
    }
  );

  router.post(
    "/support/impersonation/start",
    async (req: AuthReq, res: Response) => {
      const parse = StartSupportImpersonationSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }
      try {
        if (!req.organizationId || !req.userId) {
          res.status(401).json({ error: "authentication_required" });
          return;
        }
        if (req.impersonation) {
          res.status(400).json({
            error: "impersonation_chain_not_allowed",
            message: "End the current support impersonation session before starting a new one.",
          });
          return;
        }
        const allowed = await canManageSupportImpersonation(prisma, req);
        if (!allowed) {
          res.status(403).json({ error: "permission_denied" });
          return;
        }

        const target = await prisma.user.findFirst({
          where: {
            id: parse.data.target_user_id,
            organizationId: req.organizationId,
          },
          select: { id: true, role: true, email: true },
        });
        if (!target) {
          res.status(404).json({ error: "target_user_not_found" });
          return;
        }

        if (
          req.userRole !== "OWNER" &&
          target.role === "OWNER"
        ) {
          res.status(403).json({
            error: "owner_impersonation_restricted",
            message: "Only organization owners can impersonate owner accounts.",
          });
          return;
        }

        const ttlMinutes = parse.data.ttl_minutes ?? 30;
        const scope = parse.data.scope && parse.data.scope.length > 0
          ? Array.from(new Set(parse.data.scope))
          : (["READ_ONLY"] as string[]);
        const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
        const rawToken = crypto.randomBytes(32).toString("hex");
        const sessionTokenHash = hashScimToken(rawToken);

        const session = await prisma.supportImpersonationSession.create({
          data: {
            organizationId: req.organizationId,
            actorUserId: req.userId,
            targetUserId: target.id,
            reason: parse.data.reason.trim(),
            scope,
            sessionTokenHash,
            expiresAt,
          },
        });

        await auditLogs.record({
          organizationId: req.organizationId,
          actorUserId: req.userId,
          category: "SUPPORT",
          action: "SUPPORT_IMPERSONATION_STARTED",
          targetType: "user",
          targetId: target.id,
          severity: "CRITICAL",
          metadata: {
            session_id: session.id,
            scope,
            ttl_minutes: ttlMinutes,
            reason: parse.data.reason.trim(),
            target_user_email: target.email,
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });

        res.status(201).json({
          id: session.id,
          support_impersonation_token: rawToken,
          actor_user_id: session.actorUserId,
          target_user_id: session.targetUserId,
          scope,
          expires_at: session.expiresAt.toISOString(),
          reason: session.reason,
        });
      } catch (err) {
        logger.error("Start support impersonation error", { error: err });
        res.status(500).json({ error: "Failed to start support impersonation" });
      }
    }
  );

  router.post(
    "/support/impersonation/:sessionId/revoke",
    async (req: AuthReq, res: Response) => {
      try {
        if (!req.organizationId || !req.userId) {
          res.status(401).json({ error: "authentication_required" });
          return;
        }
        const allowed = await canManageSupportImpersonation(prisma, req);
        if (!allowed) {
          res.status(403).json({ error: "permission_denied" });
          return;
        }
        const sessionId = Array.isArray(req.params.sessionId)
          ? (req.params.sessionId[0] ?? "")
          : (req.params.sessionId ?? "");
        const existing = await prisma.supportImpersonationSession.findFirst({
          where: {
            id: sessionId,
            organizationId: req.organizationId,
          },
          select: {
            id: true,
            targetUserId: true,
            revokedAt: true,
          },
        });
        if (!existing) {
          res.status(404).json({ error: "session_not_found" });
          return;
        }
        if (existing.revokedAt) {
          res.status(400).json({ error: "session_already_revoked" });
          return;
        }

        const revokedAt = new Date();
        await prisma.supportImpersonationSession.update({
          where: { id: sessionId },
          data: {
            revokedAt,
            revokedByUserId: req.userId,
          },
        });

        await auditLogs.record({
          organizationId: req.organizationId,
          actorUserId: req.userId,
          category: "SUPPORT",
          action: "SUPPORT_IMPERSONATION_REVOKED",
          targetType: "user",
          targetId: existing.targetUserId,
          severity: "CRITICAL",
          metadata: { session_id: sessionId },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });

        res.json({ revoked: true, revoked_at: revokedAt.toISOString() });
      } catch (err) {
        logger.error("Revoke support impersonation error", { error: err });
        res.status(500).json({ error: "Failed to revoke support impersonation session" });
      }
    }
  );

  // ── Admin: Incident Management / Status Process ─────────────────────

  router.get(
    "/ops/incidents",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const incidents = await prisma.incident.findMany({
          where: { organizationId: req.organizationId! },
          include: {
            updates: {
              orderBy: { createdAt: "desc" },
              take: 5,
            },
          },
          orderBy: { startedAt: "desc" },
          take: 100,
        });
        res.json({
          incidents: incidents.map((i) => ({
            id: i.id,
            title: i.title,
            summary: i.summary,
            severity: i.severity,
            status: i.status,
            started_at: i.startedAt.toISOString(),
            resolved_at: i.resolvedAt?.toISOString() ?? null,
            created_by_user_id: i.createdByUserId,
            created_at: i.createdAt.toISOString(),
            updated_at: i.updatedAt.toISOString(),
            updates: i.updates.map((u) => ({
              id: u.id,
              message: u.message,
              status: u.status,
              metadata: u.metadata ?? null,
              created_by_user_id: u.createdByUserId,
              created_at: u.createdAt.toISOString(),
            })),
          })),
        });
      } catch (err) {
        logger.error("List incidents error", { error: err });
        res.status(500).json({ error: "Failed to list incidents" });
      }
    }
  );

  router.post(
    "/ops/incidents",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parse = CreateIncidentSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }
      try {
        const incident = await prisma.incident.create({
          data: {
            organizationId: req.organizationId!,
            title: parse.data.title,
            summary: parse.data.summary,
            severity: parse.data.severity ?? "MEDIUM",
            status: "OPEN",
            startedAt: parse.data.started_at
              ? new Date(parse.data.started_at)
              : new Date(),
            createdByUserId: req.userId ?? null,
            updates: {
              create: {
                organizationId: req.organizationId!,
                message: "Incident opened.",
                status: "OPEN",
                createdByUserId: req.userId ?? null,
              },
            },
          },
        });
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "OPS",
          action: "INCIDENT_CREATED",
          targetType: "incident",
          targetId: incident.id,
          severity: "CRITICAL",
          metadata: {
            title: incident.title,
            severity: incident.severity,
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.status(201).json({
          id: incident.id,
          status: incident.status,
          created_at: incident.createdAt.toISOString(),
        });
      } catch (err) {
        logger.error("Create incident error", { error: err });
        res.status(500).json({ error: "Failed to create incident" });
      }
    }
  );

  router.post(
    "/ops/incidents/:incidentId/updates",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parse = AddIncidentUpdateSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }
      try {
        const incidentId = Array.isArray(req.params.incidentId)
          ? (req.params.incidentId[0] ?? "")
          : (req.params.incidentId ?? "");
        const existing = await prisma.incident.findFirst({
          where: {
            id: incidentId,
            organizationId: req.organizationId!,
          },
          select: { id: true, status: true },
        });
        if (!existing) {
          res.status(404).json({ error: "incident_not_found" });
          return;
        }

        const status = parse.data.status;
        const [update] = await prisma.$transaction([
          prisma.incidentUpdate.create({
            data: {
              incidentId,
              organizationId: req.organizationId!,
              message: parse.data.message,
              status: status ?? null,
              metadata: (parse.data.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
              createdByUserId: req.userId ?? null,
            },
          }),
          prisma.incident.update({
            where: { id: incidentId },
            data: {
              status: status ?? undefined,
              resolvedAt:
                status === "RESOLVED"
                  ? new Date()
                  : status === "OPEN" || status === "MONITORING"
                    ? null
                    : undefined,
            },
          }),
        ]);

        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "OPS",
          action: "INCIDENT_UPDATED",
          targetType: "incident",
          targetId: incidentId,
          severity: "WARN",
          metadata: {
            status: status ?? existing.status,
            update_message: parse.data.message,
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.status(201).json({
          id: update.id,
          status: status ?? existing.status,
          created_at: update.createdAt.toISOString(),
        });
      } catch (err) {
        logger.error("Add incident update error", { error: err });
        res.status(500).json({ error: "Failed to add incident update" });
      }
    }
  );

  // ── Admin: Session Inventory ───────────────────────────────────────

  router.get(
    "/security/sessions",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const sessions = await prisma.userSession.findMany({
          where: { organizationId: req.organizationId! },
          include: {
            user: {
              select: { id: true, email: true, name: true, role: true },
            },
          },
          orderBy: { lastSeenAt: "desc" },
          take: 200,
        });
        res.json({
          sessions: sessions.map((s) => ({
            id: s.id,
            user_id: s.userId,
            user_email: s.user.email,
            user_name: s.user.name,
            user_role: s.user.role,
            device_label: s.deviceLabel,
            ip_address: s.ipAddress,
            user_agent: s.userAgent,
            last_seen_at: s.lastSeenAt.toISOString(),
            created_at: s.createdAt.toISOString(),
            expires_at: s.expiresAt.toISOString(),
            revoked_at: s.revokedAt?.toISOString() ?? null,
          })),
        });
      } catch (err) {
        logger.error("Get session inventory error", { error: err });
        res.status(500).json({ error: "Failed to load sessions" });
      }
    }
  );

  router.post(
    "/security/sessions/:sessionId/revoke",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const sessionId = Array.isArray(req.params.sessionId)
          ? (req.params.sessionId[0] ?? "")
          : (req.params.sessionId ?? "");
        const result = await prisma.userSession.updateMany({
          where: {
            id: sessionId,
            organizationId: req.organizationId!,
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });
        if (result.count === 0) {
          res.status(404).json({ error: "session_not_found_or_already_revoked" });
          return;
        }
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "SECURITY",
          action: "SESSION_REVOKED",
          targetType: "user_session",
          targetId: sessionId,
          severity: "CRITICAL",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({ revoked: true });
      } catch (err) {
        logger.error("Revoke session error", { error: err });
        res.status(500).json({ error: "Failed to revoke session" });
      }
    }
  );

  // ── Admin: SCIM Provisioning ───────────────────────────────────────

  router.get(
    "/scim-provisioning",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const config = await prisma.scimProvisioning.findUnique({
          where: { organizationId: req.organizationId! },
        });
        const count = await prisma.scimIdentity.count({
          where: { organizationId: req.organizationId! },
        });
        res.json({
          enabled: config?.enabled ?? false,
          endpoint_secret_hint: config?.endpointSecretHint ?? null,
          last_sync_at: config?.lastSyncAt?.toISOString() ?? null,
          identities_count: count,
        });
      } catch (err) {
        logger.error("Get SCIM provisioning error", { error: err });
        res.status(500).json({ error: "Failed to load SCIM provisioning" });
      }
    }
  );

  router.patch(
    "/scim-provisioning",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parse = ScimProvisioningSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }
      try {
        const cfg = await prisma.scimProvisioning.upsert({
          where: { organizationId: req.organizationId! },
          create: {
            organizationId: req.organizationId!,
            enabled: parse.data.enabled,
          },
          update: { enabled: parse.data.enabled },
        });
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "SECURITY",
          action: "SCIM_PROVISIONING_UPDATED",
          targetType: "scim_provisioning",
          targetId: cfg.id,
          severity: "CRITICAL",
          metadata: { enabled: cfg.enabled },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({ enabled: cfg.enabled, endpoint_secret_hint: cfg.endpointSecretHint ?? null });
      } catch (err) {
        logger.error("Update SCIM provisioning error", { error: err });
        res.status(500).json({ error: "Failed to update SCIM provisioning" });
      }
    }
  );

  router.post(
    "/scim-provisioning/rotate-token",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const raw = crypto.randomBytes(24).toString("hex");
        const hashed = hashScimToken(raw);
        const hint = `${raw.slice(0, 4)}...${raw.slice(-4)}`;
        const cfg = await prisma.scimProvisioning.upsert({
          where: { organizationId: req.organizationId! },
          create: {
            organizationId: req.organizationId!,
            enabled: true,
            tokenHash: hashed,
            endpointSecretHint: hint,
          },
          update: {
            enabled: true,
            tokenHash: hashed,
            endpointSecretHint: hint,
          },
        });
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "SECURITY",
          action: "SCIM_TOKEN_ROTATED",
          targetType: "scim_provisioning",
          targetId: cfg.id,
          severity: "CRITICAL",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({
          token: raw,
          endpoint_secret_hint: hint,
          message:
            "Store this SCIM token securely now. It will not be shown again.",
        });
      } catch (err) {
        logger.error("Rotate SCIM token error", { error: err });
        res.status(500).json({ error: "Failed to rotate SCIM token" });
      }
    }
  );

  // ── Admin: Feature Flags ───────────────────────────────────────────

  router.get(
    "/feature-flags",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const flags = await featureFlags.listResolved(req.organizationId!);
        res.json({
          flags: flags.map((f: { id: string; key: string; enabled: boolean; resolvedEnabled: boolean; overrideSource: string | null; config: unknown; createdAt: Date; updatedAt: Date }) => ({
            id: f.id,
            key: f.key,
            enabled: f.enabled,
            resolved_enabled: f.resolvedEnabled,
            override_source: f.overrideSource,
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

  router.get(
    "/feature-flags/resolved",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const enabledKeys = await featureFlags.getResolvedEnabledKeys(req.organizationId!);
        res.json({
          environment: process.env.DEPLOY_ENV || process.env.NODE_ENV || "development",
          enabled_feature_flags: enabledKeys,
        });
      } catch (err) {
        logger.error("Get resolved feature flags error", { error: err });
        res.status(500).json({ error: "Failed to load resolved feature flags" });
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

  // ── Team Workspaces ────────────────────────────────────────────────

  router.get("/workspaces", async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    try {
      const [assignment, user] = await Promise.all([
        prisma.userRoleAssignment.findUnique({
          where: { userId: req.userId },
          include: { roleProfile: true },
        }),
        prisma.user.findUnique({
          where: { id: req.userId },
          select: { role: true },
        }),
      ]);
      const roleKey = assignment?.roleProfile?.key ?? null;
      const team =
        roleKey === "SALES"
          ? "SALES"
          : roleKey === "CS"
            ? "CS"
            : roleKey === "EXEC"
              ? "REVOPS"
              : user?.role === "OWNER" || user?.role === "ADMIN"
                ? "REVOPS"
                : "MARKETING";

      const workspaces = await prisma.teamWorkspace.findMany({
        where: {
          organizationId: req.organizationId,
          OR: [
            { ownerUserId: req.userId },
            { visibility: "ORG" },
            { visibility: "TEAM", team: team as "REVOPS" | "MARKETING" | "SALES" | "CS" },
            ...(roleKey ? [{ allowedRoleProfileKeys: { has: roleKey } }] : []),
          ],
        },
        orderBy: { updatedAt: "desc" },
      });
      res.json({
        workspaces: workspaces.map((w) => ({
          id: w.id,
          name: w.name,
          description: w.description,
          team: w.team,
          visibility: w.visibility,
          owner_user_id: w.ownerUserId,
          saved_view_config: w.savedViewConfig,
          allowed_role_profile_keys: w.allowedRoleProfileKeys,
          created_at: w.createdAt.toISOString(),
          updated_at: w.updatedAt.toISOString(),
        })),
      });
    } catch (err) {
      logger.error("List workspaces error", { error: err });
      res.status(500).json({ error: "Failed to load workspaces" });
    }
  });

  router.post("/workspaces", async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const parse = UpsertWorkspaceSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "validation_error", details: parse.error.issues });
      return;
    }
    try {
      const d = parse.data;
      const workspace = await prisma.teamWorkspace.create({
        data: {
          organizationId: req.organizationId,
          ownerUserId: req.userId,
          name: d.name,
          description: d.description,
          team: d.team,
          visibility: d.visibility,
          allowedRoleProfileKeys: d.allowed_role_profile_keys ?? [],
          savedViewConfig: (d.saved_view_config ?? undefined) as
            | Prisma.InputJsonValue
            | undefined,
        },
      });
      await auditLogs.record({
        organizationId: req.organizationId,
        actorUserId: req.userId,
        category: "WORKSPACE",
        action: "WORKSPACE_CREATED",
        targetType: "workspace",
        targetId: workspace.id,
        severity: "INFO",
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
      res.status(201).json({ id: workspace.id });
    } catch (err) {
      logger.error("Create workspace error", { error: err });
      res.status(500).json({ error: "Failed to create workspace" });
    }
  });

  router.patch("/workspaces/:workspaceId", async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const parse = UpsertWorkspaceSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "validation_error", details: parse.error.issues });
      return;
    }
    try {
      const workspaceId = String(req.params.workspaceId);
      const existing = await prisma.teamWorkspace.findFirst({
        where: { id: workspaceId, organizationId: req.organizationId },
      });
      if (!existing) {
        res.status(404).json({ error: "Workspace not found" });
        return;
      }
      const isOwner = existing.ownerUserId === req.userId;
      const isAdmin = req.userRole === "OWNER" || req.userRole === "ADMIN";
      if (!isOwner && !isAdmin) {
        res.status(403).json({ error: "permission_denied" });
        return;
      }

      const d = parse.data;
      await prisma.teamWorkspace.update({
        where: { id: existing.id },
        data: {
          name: d.name,
          description: d.description,
          team: d.team,
          visibility: d.visibility,
          allowedRoleProfileKeys: d.allowed_role_profile_keys ?? [],
          savedViewConfig: (d.saved_view_config ?? undefined) as
            | Prisma.InputJsonValue
            | undefined,
        },
      });
      await auditLogs.record({
        organizationId: req.organizationId,
        actorUserId: req.userId,
        category: "WORKSPACE",
        action: "WORKSPACE_UPDATED",
        targetType: "workspace",
        targetId: existing.id,
        severity: "WARN",
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
      res.json({ updated: true });
    } catch (err) {
      logger.error("Update workspace error", { error: err });
      res.status(500).json({ error: "Failed to update workspace" });
    }
  });

  router.delete("/workspaces/:workspaceId", async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    try {
      const workspaceId = String(req.params.workspaceId);
      const existing = await prisma.teamWorkspace.findFirst({
        where: { id: workspaceId, organizationId: req.organizationId },
      });
      if (!existing) {
        res.status(404).json({ error: "Workspace not found" });
        return;
      }
      const isOwner = existing.ownerUserId === req.userId;
      const isAdmin = req.userRole === "OWNER" || req.userRole === "ADMIN";
      if (!isOwner && !isAdmin) {
        res.status(403).json({ error: "permission_denied" });
        return;
      }
      await prisma.teamWorkspace.delete({ where: { id: existing.id } });
      await auditLogs.record({
        organizationId: req.organizationId,
        actorUserId: req.userId,
        category: "WORKSPACE",
        action: "WORKSPACE_DELETED",
        targetType: "workspace",
        targetId: existing.id,
        severity: "WARN",
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
      res.json({ deleted: true });
    } catch (err) {
      logger.error("Delete workspace error", { error: err });
      res.status(500).json({ error: "Failed to delete workspace" });
    }
  });

  // ── Shared Asset Library ───────────────────────────────────────────

  router.get("/assets", async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    try {
      const workspaceId = (req.query.workspace_id as string | undefined)?.trim();
      const assignment = await prisma.userRoleAssignment.findUnique({
        where: { userId: req.userId },
        include: { roleProfile: true },
      });
      const roleKey = assignment?.roleProfile?.key ?? null;

      const assets = await prisma.sharedAsset.findMany({
        where: {
          organizationId: req.organizationId,
          ...(workspaceId ? { workspaceId } : {}),
          OR: [
            { ownerUserId: req.userId },
            { visibility: "ORG" },
            ...(roleKey ? [{ allowedRoleProfileKeys: { has: roleKey } }] : []),
          ],
        },
        orderBy: { updatedAt: "desc" },
      });
      res.json({
        assets: assets.map((a) => ({
          id: a.id,
          workspace_id: a.workspaceId,
          asset_type: a.assetType,
          title: a.title,
          description: a.description,
          source_story_id: a.sourceStoryId,
          source_page_id: a.sourcePageId,
          source_account_id: a.sourceAccountId,
          visibility: a.visibility,
          owner_user_id: a.ownerUserId,
          allowed_role_profile_keys: a.allowedRoleProfileKeys,
          metadata: a.metadata,
          created_at: a.createdAt.toISOString(),
          updated_at: a.updatedAt.toISOString(),
        })),
      });
    } catch (err) {
      logger.error("List shared assets error", { error: err });
      res.status(500).json({ error: "Failed to load shared assets" });
    }
  });

  router.post("/assets", async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const parse = UpsertSharedAssetSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "validation_error", details: parse.error.issues });
      return;
    }
    try {
      const d = parse.data;
      if (d.workspace_id) {
        const workspace = await prisma.teamWorkspace.findFirst({
          where: { id: d.workspace_id, organizationId: req.organizationId },
        });
        if (!workspace) {
          res.status(400).json({ error: "workspace_not_found" });
          return;
        }
      }
      const asset = await prisma.sharedAsset.create({
        data: {
          organizationId: req.organizationId,
          workspaceId: d.workspace_id ?? null,
          ownerUserId: req.userId,
          assetType: d.asset_type,
          title: d.title,
          description: d.description,
          sourceStoryId: d.source_story_id,
          sourcePageId: d.source_page_id,
          sourceAccountId: d.source_account_id,
          visibility: d.visibility,
          allowedRoleProfileKeys: d.allowed_role_profile_keys ?? [],
          metadata: (d.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      await auditLogs.record({
        organizationId: req.organizationId,
        actorUserId: req.userId,
        category: "WORKSPACE",
        action: "SHARED_ASSET_CREATED",
        targetType: "shared_asset",
        targetId: asset.id,
        severity: "INFO",
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
      res.status(201).json({ id: asset.id });
    } catch (err) {
      logger.error("Create shared asset error", { error: err });
      res.status(500).json({ error: "Failed to create shared asset" });
    }
  });

  router.patch("/assets/:assetId", async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const parse = UpsertSharedAssetSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "validation_error", details: parse.error.issues });
      return;
    }
    try {
      const assetId = String(req.params.assetId);
      const existing = await prisma.sharedAsset.findFirst({
        where: { id: assetId, organizationId: req.organizationId },
      });
      if (!existing) {
        res.status(404).json({ error: "Asset not found" });
        return;
      }
      const isOwner = existing.ownerUserId === req.userId;
      const isAdmin = req.userRole === "OWNER" || req.userRole === "ADMIN";
      if (!isOwner && !isAdmin) {
        res.status(403).json({ error: "permission_denied" });
        return;
      }
      const d = parse.data;
      await prisma.sharedAsset.update({
        where: { id: existing.id },
        data: {
          workspaceId: d.workspace_id ?? null,
          assetType: d.asset_type,
          title: d.title,
          description: d.description,
          sourceStoryId: d.source_story_id,
          sourcePageId: d.source_page_id,
          sourceAccountId: d.source_account_id,
          visibility: d.visibility,
          allowedRoleProfileKeys: d.allowed_role_profile_keys ?? [],
          metadata: (d.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      res.json({ updated: true });
    } catch (err) {
      logger.error("Update shared asset error", { error: err });
      res.status(500).json({ error: "Failed to update shared asset" });
    }
  });

  router.delete("/assets/:assetId", async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    try {
      const assetId = String(req.params.assetId);
      const existing = await prisma.sharedAsset.findFirst({
        where: { id: assetId, organizationId: req.organizationId },
      });
      if (!existing) {
        res.status(404).json({ error: "Asset not found" });
        return;
      }
      const isOwner = existing.ownerUserId === req.userId;
      const isAdmin = req.userRole === "OWNER" || req.userRole === "ADMIN";
      if (!isOwner && !isAdmin) {
        res.status(403).json({ error: "permission_denied" });
        return;
      }
      await prisma.sharedAsset.delete({ where: { id: existing.id } });
      res.json({ deleted: true });
    } catch (err) {
      logger.error("Delete shared asset error", { error: err });
      res.status(500).json({ error: "Failed to delete shared asset" });
    }
  });

  // ── CRM Writeback + Approvals ─────────────────────────────────────

  router.get(
    "/writebacks",
    requirePermission(prisma, "view_analytics"),
    async (req: AuthReq, res: Response) => {
      try {
        const requests = await prisma.approvalRequest.findMany({
          where: {
            organizationId: req.organizationId!,
            requestType: "CRM_WRITEBACK",
          },
          orderBy: { createdAt: "desc" },
          take: 200,
        });
        res.json({
          writebacks: requests.map((r) => ({
            id: r.id,
            status: r.status,
            target_type: r.targetType,
            target_id: r.targetId,
            request_payload: r.requestPayload,
            requested_by_user_id: r.requestedByUserId,
            reviewer_user_id: r.reviewerUserId,
            review_notes: r.reviewNotes,
            created_at: r.createdAt.toISOString(),
            reviewed_at: r.reviewedAt?.toISOString() ?? null,
          })),
        });
      } catch (err) {
        logger.error("List writebacks error", { error: err });
        res.status(500).json({ error: "Failed to load writebacks" });
      }
    }
  );

  router.post(
    "/writebacks",
    requirePermission(prisma, "view_analytics"),
    async (req: AuthReq, res: Response) => {
      const parsed = CreateWritebackSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "validation_error", details: parsed.error.issues });
        return;
      }
      try {
        const account = await prisma.account.findFirst({
          where: { id: parsed.data.account_id, organizationId: req.organizationId! },
          select: { id: true },
        });
        if (!account) {
          res.status(404).json({ error: "account_not_found" });
          return;
        }
        const request = await prisma.approvalRequest.create({
          data: {
            organizationId: req.organizationId!,
            requestType: "CRM_WRITEBACK",
            targetType: "account",
            targetId: parsed.data.account_id,
            requestedByUserId: req.userId!,
            status: "PENDING",
            requestPayload: {
              provider: parsed.data.provider,
              action_type: parsed.data.action_type,
              opportunity_id: parsed.data.opportunity_id ?? null,
              title: parsed.data.title ?? null,
              body: parsed.data.body ?? null,
              field_name: parsed.data.field_name ?? null,
              field_value: parsed.data.field_value ?? null,
              metadata: parsed.data.metadata ?? {},
            } as Prisma.InputJsonValue,
          },
        });
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "WRITEBACK",
          action: "CRM_WRITEBACK_REQUESTED",
          targetType: "approval_request",
          targetId: request.id,
          severity: "WARN",
          metadata: { action_type: parsed.data.action_type, provider: parsed.data.provider },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.status(202).json({ request_id: request.id, status: request.status });
      } catch (err) {
        logger.error("Create writeback request error", { error: err });
        res.status(500).json({ error: "Failed to create writeback request" });
      }
    }
  );

  router.post(
    "/writebacks/:requestId/review",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parsed = ReviewWritebackSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "validation_error", details: parsed.error.issues });
        return;
      }
      try {
        const request = await prisma.approvalRequest.findFirst({
          where: {
            id: String(req.params.requestId),
            organizationId: req.organizationId!,
            requestType: "CRM_WRITEBACK",
          },
        });
        if (!request) {
          res.status(404).json({ error: "writeback_request_not_found" });
          return;
        }
        if (request.status !== "PENDING") {
          res.status(409).json({ error: "request_not_pending" });
          return;
        }

        if (parsed.data.decision === "REJECT") {
          await prisma.approvalRequest.update({
            where: { id: request.id },
            data: {
              status: "REJECTED",
              reviewerUserId: req.userId!,
              reviewNotes: parsed.data.notes ?? null,
              reviewedAt: new Date(),
            },
          });
          await auditLogs.record({
            organizationId: req.organizationId!,
            actorUserId: req.userId,
            category: "WRITEBACK",
            action: "CRM_WRITEBACK_REJECTED",
            targetType: "approval_request",
            targetId: request.id,
            severity: "INFO",
            ipAddress: req.ip,
            userAgent: req.get("user-agent"),
          });
          res.json({ status: "REJECTED" });
          return;
        }

        const payload =
          request.requestPayload &&
          typeof request.requestPayload === "object" &&
          !Array.isArray(request.requestPayload)
            ? (request.requestPayload as Record<string, unknown>)
            : {};
        const actionType = String(payload.action_type ?? "TASK");

        // Simulated CRM writeback execution by recording corresponding CRM events.
        const eventType =
          actionType === "NOTE"
            ? "NOTE_ADDED"
            : actionType === "TASK"
              ? "TASK_COMPLETED"
              : "OPPORTUNITY_STAGE_CHANGE";
        await prisma.salesforceEvent.create({
          data: {
            accountId: request.targetId,
            eventType:
              eventType as "NOTE_ADDED" | "TASK_COMPLETED" | "OPPORTUNITY_STAGE_CHANGE",
            stageName:
              actionType === "FIELD_UPDATE"
                ? String(payload.field_value ?? "UPDATED")
                : null,
            opportunityId:
              typeof payload.opportunity_id === "string" ? payload.opportunity_id : null,
            description:
              typeof payload.body === "string" && payload.body.length > 0
                ? payload.body
                : typeof payload.title === "string"
                  ? payload.title
                  : "Writeback action",
            rawPayload: payload as Prisma.InputJsonValue,
          },
        });

        await prisma.approvalRequest.update({
          where: { id: request.id },
          data: {
            status: "COMPLETED",
            reviewerUserId: req.userId!,
            reviewNotes: parsed.data.notes ?? null,
            reviewedAt: new Date(),
          },
        });
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "WRITEBACK",
          action: "CRM_WRITEBACK_APPROVED_EXECUTED",
          targetType: "approval_request",
          targetId: request.id,
          severity: "WARN",
          metadata: { action_type: actionType },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({ status: "COMPLETED" });
      } catch (err) {
        logger.error("Review writeback request error", { error: err });
        res.status(500).json({ error: "Failed to review writeback request" });
      }
    }
  );

  router.post(
    "/writebacks/:requestId/rollback",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const request = await prisma.approvalRequest.findFirst({
          where: {
            id: String(req.params.requestId),
            organizationId: req.organizationId!,
            requestType: "CRM_WRITEBACK",
            status: "COMPLETED",
          },
        });
        if (!request) {
          res.status(404).json({ error: "completed_writeback_not_found" });
          return;
        }
        const payload =
          request.requestPayload &&
          typeof request.requestPayload === "object" &&
          !Array.isArray(request.requestPayload)
            ? (request.requestPayload as Record<string, unknown>)
            : {};
        await prisma.salesforceEvent.create({
          data: {
            accountId: request.targetId,
            eventType: "NOTE_ADDED",
            description: `Rollback executed for writeback ${request.id}`,
            rawPayload: payload as Prisma.InputJsonValue,
          },
        });
        await prisma.approvalRequest.update({
          where: { id: request.id },
          data: {
            status: "ROLLED_BACK",
            reviewerUserId: req.userId!,
            reviewNotes: "Rolled back by admin",
            reviewedAt: new Date(),
          },
        });
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "WRITEBACK",
          action: "CRM_WRITEBACK_ROLLED_BACK",
          targetType: "approval_request",
          targetId: request.id,
          severity: "CRITICAL",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({ status: "ROLLED_BACK" });
      } catch (err) {
        logger.error("Rollback writeback error", { error: err });
        res.status(500).json({ error: "Failed to rollback writeback" });
      }
    }
  );

  // ── Workflow Automation Rules ─────────────────────────────────────

  router.get(
    "/automations",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const rules = await prisma.automationRule.findMany({
          where: { organizationId: req.organizationId! },
          orderBy: { updatedAt: "desc" },
        });
        res.json({
          rules: rules.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            enabled: r.enabled,
            trigger_type: r.triggerType,
            metric: r.metric,
            operator: r.operator,
            threshold: r.threshold,
            schedule_cron: r.scheduleCron,
            event_type: r.eventType,
            delivery_type: r.deliveryType,
            delivery_target: r.deliveryTarget,
            payload_template: r.payloadTemplate,
            last_run_at: r.lastRunAt?.toISOString() ?? null,
            last_run_status: r.lastRunStatus ?? null,
            last_run_error: r.lastRunError ?? null,
            created_at: r.createdAt.toISOString(),
            updated_at: r.updatedAt.toISOString(),
          })),
        });
      } catch (err) {
        logger.error("List automation rules error", { error: err });
        res.status(500).json({ error: "Failed to load automation rules" });
      }
    }
  );

  router.post(
    "/automations",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parsed = UpsertAutomationRuleSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "validation_error", details: parsed.error.issues });
        return;
      }
      try {
        const d = parsed.data;
        const rule = await prisma.automationRule.create({
          data: {
            organizationId: req.organizationId!,
            name: d.name,
            description: d.description,
            enabled: d.enabled,
            triggerType: d.trigger_type,
            metric: d.metric,
            operator: d.operator,
            threshold: d.threshold,
            scheduleCron: d.schedule_cron,
            eventType: d.event_type,
            deliveryType: d.delivery_type,
            deliveryTarget: d.delivery_target,
            payloadTemplate: (d.payload_template ?? undefined) as
              | Prisma.InputJsonValue
              | undefined,
          },
        });
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "AUTOMATION",
          action: "AUTOMATION_RULE_CREATED",
          targetType: "automation_rule",
          targetId: rule.id,
          severity: "INFO",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.status(201).json({ id: rule.id });
      } catch (err) {
        logger.error("Create automation rule error", { error: err });
        res.status(500).json({ error: "Failed to create automation rule" });
      }
    }
  );

  router.patch(
    "/automations/:ruleId",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parsed = UpsertAutomationRuleSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "validation_error", details: parsed.error.issues });
        return;
      }
      try {
        const ruleId = String(req.params.ruleId);
        const existing = await prisma.automationRule.findFirst({
          where: { id: ruleId, organizationId: req.organizationId! },
        });
        if (!existing) {
          res.status(404).json({ error: "automation_rule_not_found" });
          return;
        }
        const d = parsed.data;
        await prisma.automationRule.update({
          where: { id: existing.id },
          data: {
            name: d.name,
            description: d.description,
            enabled: d.enabled,
            triggerType: d.trigger_type,
            metric: d.metric,
            operator: d.operator,
            threshold: d.threshold,
            scheduleCron: d.schedule_cron,
            eventType: d.event_type,
            deliveryType: d.delivery_type,
            deliveryTarget: d.delivery_target,
            payloadTemplate: (d.payload_template ?? undefined) as
              | Prisma.InputJsonValue
              | undefined,
          },
        });
        res.json({ updated: true });
      } catch (err) {
        logger.error("Update automation rule error", { error: err });
        res.status(500).json({ error: "Failed to update automation rule" });
      }
    }
  );

  router.delete(
    "/automations/:ruleId",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const ruleId = String(req.params.ruleId);
        const existing = await prisma.automationRule.findFirst({
          where: { id: ruleId, organizationId: req.organizationId! },
        });
        if (!existing) {
          res.status(404).json({ error: "automation_rule_not_found" });
          return;
        }
        await prisma.automationRule.delete({ where: { id: existing.id } });
        res.json({ deleted: true });
      } catch (err) {
        logger.error("Delete automation rule error", { error: err });
        res.status(500).json({ error: "Failed to delete automation rule" });
      }
    }
  );

  router.post(
    "/automations/:ruleId/run",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const ruleId = String(req.params.ruleId);
        const rule = await prisma.automationRule.findFirst({
          where: { id: ruleId, organizationId: req.organizationId! },
        });
        if (!rule) {
          res.status(404).json({ error: "automation_rule_not_found" });
          return;
        }

        // Simulated delivery execution path for local self-serve testing.
        let status = "SUCCESS";
        let error: string | null = null;
        try {
          await prisma.notification.create({
            data: {
              organizationId: req.organizationId!,
              userId: req.userId!,
              type: "SYSTEM_ALERT",
              title: `Automation fired: ${rule.name}`,
              body: `Delivery ${rule.deliveryType} → ${rule.deliveryTarget}`,
              read: false,
              metadata: {
                rule_id: rule.id,
                trigger_type: rule.triggerType,
              } as Prisma.InputJsonValue,
            },
          });
        } catch (err) {
          status = "FAILED";
          error = err instanceof Error ? err.message : "Delivery failed";
        }

        await prisma.automationRule.update({
          where: { id: rule.id },
          data: {
            lastRunAt: new Date(),
            lastRunStatus: status,
            lastRunError: error,
          },
        });
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "AUTOMATION",
          action:
            status === "SUCCESS"
              ? "AUTOMATION_RULE_RUN_SUCCESS"
              : "AUTOMATION_RULE_RUN_FAILED",
          targetType: "automation_rule",
          targetId: rule.id,
          severity: status === "SUCCESS" ? "INFO" : "WARN",
          metadata: { status, error },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({ status, error });
      } catch (err) {
        logger.error("Run automation rule error", { error: err });
        res.status(500).json({ error: "Failed to run automation rule" });
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
        const limit = parseBoundedLimit(req.query.limit, {
          fallback: PAGINATION_LIMITS.LIST_DEFAULT,
          max: PAGINATION_LIMITS.LIST_MAX,
        });
        const category = (req.query.category as string | undefined)?.trim();
        const actorUserId = (req.query.actor_user_id as string | undefined)?.trim();
        const action = (req.query.action as string | undefined)?.trim();
        const severity = (req.query.severity as string | undefined)?.trim();
        const targetType = (req.query.target_type as string | undefined)?.trim();
        const targetId = (req.query.target_id as string | undefined)?.trim();
        const before = (req.query.before as string | undefined)?.trim();
        const cursorCreatedAt = before ? new Date(before) : null;
        const hasCursor = !!cursorCreatedAt && !Number.isNaN(cursorCreatedAt.getTime());

        const logs = await prisma.auditLog.findMany({
          where: {
            organizationId: req.organizationId!,
            ...(category ? { category } : {}),
            ...(actorUserId ? { actorUserId } : {}),
            ...(action ? { action } : {}),
            ...(severity ? { severity } : {}),
            ...(targetType ? { targetType } : {}),
            ...(targetId ? { targetId } : {}),
            ...(hasCursor ? { createdAt: { lt: cursorCreatedAt! } } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: limit + 1,
        });

        const hasMore = logs.length > limit;
        const page = hasMore ? logs.slice(0, limit) : logs;
        const nextCursor = hasMore
          ? page[page.length - 1]?.createdAt.toISOString() ?? null
          : null;

        res.json({
          logs: page.map((l) => ({
            id: l.id,
            created_at: l.createdAt.toISOString(),
            actor_user_id: l.actorUserId,
            category: l.category,
            action: l.action,
            schema_version: l.schemaVersion,
            target_type: l.targetType,
            target_id: l.targetId,
            severity: l.severity,
            metadata: l.metadata,
            ip_address: l.ipAddress,
            user_agent: l.userAgent,
            expires_at: l.expiresAt?.toISOString() ?? null,
          })),
          page: {
            has_more: hasMore,
            next_cursor: nextCursor,
          },
        });
      } catch (err) {
        logger.error("Get audit logs error", { error: err });
        res.status(500).json({ error: "Failed to load audit logs" });
      }
    }
  );

  router.get(
    "/audit-logs/export",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const settings = await prisma.orgSettings.findUnique({
          where: { organizationId: req.organizationId! },
          select: { dataGovernancePolicy: true },
        });
        const policy =
          settings?.dataGovernancePolicy &&
          typeof settings.dataGovernancePolicy === "object" &&
          !Array.isArray(settings.dataGovernancePolicy)
            ? (settings.dataGovernancePolicy as DataGovernancePolicy)
            : {};
        if (policy.pii_export_enabled === false) {
          res.status(403).json({
            error: "policy_denied",
            message: "Exports are disabled by your organization's data governance policy.",
          });
          return;
        }

        const format = ((req.query.format as string | undefined) ?? "csv").toLowerCase();
        const limit = parseBoundedLimit(req.query.limit, {
          fallback: PAGINATION_LIMITS.EXPORT_DEFAULT,
          max: PAGINATION_LIMITS.EXPORT_MAX,
        });
        const category = (req.query.category as string | undefined)?.trim();
        const actorUserId = (req.query.actor_user_id as string | undefined)?.trim();
        const action = (req.query.action as string | undefined)?.trim();
        const severity = (req.query.severity as string | undefined)?.trim();
        const targetType = (req.query.target_type as string | undefined)?.trim();
        const targetId = (req.query.target_id as string | undefined)?.trim();

        const logs = await prisma.auditLog.findMany({
          where: {
            organizationId: req.organizationId!,
            ...(category ? { category } : {}),
            ...(actorUserId ? { actorUserId } : {}),
            ...(action ? { action } : {}),
            ...(severity ? { severity } : {}),
            ...(targetType ? { targetType } : {}),
            ...(targetId ? { targetId } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: limit,
        });

        if (format === "json") {
          res.setHeader("Content-Type", "application/json");
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="audit-logs-${new Date().toISOString().slice(0, 10)}.json"`
          );
          res.send(
            JSON.stringify(
              logs.map((l) => ({
                id: l.id,
                created_at: l.createdAt.toISOString(),
                actor_user_id: l.actorUserId,
                category: l.category,
                action: l.action,
                schema_version: l.schemaVersion,
                target_type: l.targetType,
                target_id: l.targetId,
                severity: l.severity,
                metadata: l.metadata,
                ip_address: l.ipAddress,
                user_agent: l.userAgent,
                expires_at: l.expiresAt?.toISOString() ?? null,
              })),
              null,
              2
            )
          );
          return;
        }

        const csvEscape = (value: unknown): string => {
          const raw = value == null ? "" : String(value);
          const escaped = raw.replace(/"/g, "\"\"");
          return `"${escaped}"`;
        };
        const header = [
          "id",
          "created_at",
          "actor_user_id",
          "category",
          "action",
          "schema_version",
          "target_type",
          "target_id",
          "severity",
          "metadata",
          "ip_address",
          "user_agent",
          "expires_at",
        ];
        const rows = logs.map((l) =>
          [
            l.id,
            l.createdAt.toISOString(),
            l.actorUserId,
            l.category,
            l.action,
            l.schemaVersion,
            l.targetType,
            l.targetId,
            l.severity,
            JSON.stringify(l.metadata ?? {}),
            l.ipAddress,
            l.userAgent,
            l.expiresAt?.toISOString() ?? "",
          ]
            .map(csvEscape)
            .join(",")
        );

        const csv = [header.join(","), ...rows].join("\n");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="audit-logs-${new Date().toISOString().slice(0, 10)}.csv"`
        );
        res.send(csv);
      } catch (err) {
        logger.error("Export audit logs error", { error: err });
        res.status(500).json({ error: "Failed to export audit logs" });
      }
    }
  );

  router.get(
    "/audit-logs/actor/:actorUserId",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const organizationId = req.organizationId!;
        const rawActorUserId = req.params.actorUserId;
        const actorUserId = (
          Array.isArray(rawActorUserId)
            ? (rawActorUserId[0] ?? "")
            : (rawActorUserId ?? "")
        ).trim();
        if (!actorUserId) {
          res.status(400).json({ error: "actor_user_id_required" });
          return;
        }

        const [actor, totalEvents, recentEvents] = await Promise.all([
          prisma.user.findFirst({
            where: { id: actorUserId, organizationId },
            select: { id: true, name: true, email: true, role: true },
          }),
          prisma.auditLog.count({
            where: { organizationId, actorUserId },
          }),
          prisma.auditLog.findMany({
            where: { organizationId, actorUserId },
            select: {
              id: true,
              createdAt: true,
              category: true,
              action: true,
              targetType: true,
              targetId: true,
              severity: true,
            },
            orderBy: { createdAt: "desc" },
            take: 20,
          }),
        ]);

        res.json({
          actor: actor
            ? {
                id: actor.id,
                name: actor.name,
                email: actor.email,
                role: actor.role,
              }
            : { id: actorUserId, name: null, email: null, role: null },
          total_events: totalEvents,
          recent_events: recentEvents.map((e) => ({
            id: e.id,
            created_at: e.createdAt.toISOString(),
            category: e.category,
            action: e.action,
            target_type: e.targetType,
            target_id: e.targetId,
            severity: e.severity,
          })),
        });
      } catch (err) {
        logger.error("Get audit actor drilldown error", { error: err });
        res.status(500).json({ error: "Failed to load actor drilldown" });
      }
    }
  );

  router.get(
    "/audit-logs/resource",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const organizationId = req.organizationId!;
        const targetType = (req.query.target_type as string | undefined)?.trim();
        const targetId = (req.query.target_id as string | undefined)?.trim();
        if (!targetType || !targetId) {
          res.status(400).json({ error: "target_type_and_target_id_required" });
          return;
        }

        const [totalEvents, recentEvents] = await Promise.all([
          prisma.auditLog.count({
            where: { organizationId, targetType, targetId },
          }),
          prisma.auditLog.findMany({
            where: { organizationId, targetType, targetId },
            select: {
              id: true,
              createdAt: true,
              actorUserId: true,
              category: true,
              action: true,
              severity: true,
            },
            orderBy: { createdAt: "desc" },
            take: 20,
          }),
        ]);

        res.json({
          resource: {
            target_type: targetType,
            target_id: targetId,
          },
          total_events: totalEvents,
          recent_events: recentEvents.map((e) => ({
            id: e.id,
            created_at: e.createdAt.toISOString(),
            actor_user_id: e.actorUserId,
            category: e.category,
            action: e.action,
            severity: e.severity,
          })),
        });
      } catch (err) {
        logger.error("Get audit resource drilldown error", { error: err });
        res.status(500).json({ error: "Failed to load resource drilldown" });
      }
    }
  );

  // ── Admin: Ops Diagnostics ─────────────────────────────────────────

  router.get(
    "/integrations/health",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const organizationId = req.organizationId!;
        const configs = await prisma.integrationConfig.findMany({
          where: { organizationId },
          select: {
            id: true,
            provider: true,
            enabled: true,
            status: true,
            lastSyncAt: true,
            lastError: true,
            updatedAt: true,
          },
          orderBy: { provider: "asc" },
        });

        const runAgg = await Promise.all(
          configs.map(async (c) => {
            const [lastSuccess, lastFailure, recentRuns] = await Promise.all([
              prisma.integrationRun.findFirst({
                where: {
                  organizationId,
                  integrationConfigId: c.id,
                  status: "COMPLETED",
                },
                orderBy: { startedAt: "desc" },
                select: { startedAt: true, finishedAt: true },
              }),
              prisma.integrationRun.findFirst({
                where: {
                  organizationId,
                  integrationConfigId: c.id,
                  status: "FAILED",
                },
                orderBy: { startedAt: "desc" },
                select: { startedAt: true, errorMessage: true },
              }),
              prisma.integrationRun.findMany({
                where: { organizationId, integrationConfigId: c.id },
                orderBy: { startedAt: "desc" },
                take: 20,
                select: { processedCount: true, successCount: true, failureCount: true },
              }),
            ]);
            const throughput = recentRuns.reduce(
              (acc, r) => acc + r.successCount,
              0
            );
            const failures = recentRuns.reduce(
              (acc, r) => acc + r.failureCount,
              0
            );
            return {
              id: c.id,
              provider: c.provider,
              enabled: c.enabled,
              status: c.status,
              lag_minutes: c.lastSyncAt
                ? Math.max(
                    0,
                    Math.floor((Date.now() - c.lastSyncAt.getTime()) / 60000)
                  )
                : null,
              last_success_at: lastSuccess?.startedAt.toISOString() ?? null,
              last_failure_at: lastFailure?.startedAt.toISOString() ?? null,
              last_failure_error: lastFailure?.errorMessage ?? c.lastError ?? null,
              throughput_recent: throughput,
              failures_recent: failures,
            };
          })
        );

        res.json({ integrations: runAgg });
      } catch (err) {
        logger.error("Get integration health error", { error: err });
        res.status(500).json({ error: "Failed to load integration health" });
      }
    }
  );

  router.get(
    "/ops/diagnostics",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const organizationId = req.organizationId!;

        const [
          integrationConfigs,
          recentAuditLogs,
          unresolvedNotifications,
          recentUsageRecords,
          storyCount,
          pageCount,
          accountCount,
          callCount,
        ] = await Promise.all([
          prisma.integrationConfig.findMany({
            where: { organizationId },
            select: {
              id: true,
              provider: true,
              enabled: true,
              status: true,
              lastSyncAt: true,
              lastError: true,
              updatedAt: true,
            },
            orderBy: { provider: "asc" },
          }),
          prisma.auditLog.findMany({
            where: { organizationId },
            select: {
              id: true,
              createdAt: true,
              category: true,
              action: true,
              severity: true,
            },
            orderBy: { createdAt: "desc" },
            take: 25,
          }),
          prisma.notification.findMany({
            where: { organizationId, read: false },
            select: {
              id: true,
              type: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 25,
          }),
          prisma.usageRecord.findMany({
            where: { organizationId },
            select: {
              id: true,
              metric: true,
              quantity: true,
              periodStart: true,
            },
            orderBy: { periodStart: "desc" },
            take: 50,
          }),
          prisma.story.count({ where: { organizationId } }),
          prisma.landingPage.count({ where: { organizationId } }),
          prisma.account.count({ where: { organizationId } }),
          prisma.call.count({ where: { organizationId } }),
        ]);

        const failedIntegrations = integrationConfigs.filter(
          (i) => i.status === "ERROR" || !!i.lastError
        );

        res.json({
          timestamp: new Date().toISOString(),
          tenant: {
            organization_id: organizationId,
            totals: {
              accounts: accountCount,
              calls: callCount,
              stories: storyCount,
              landing_pages: pageCount,
            },
          },
          integrations: {
            total: integrationConfigs.length,
            enabled: integrationConfigs.filter((i) => i.enabled).length,
            failed: failedIntegrations.length,
            providers: integrationConfigs.map((i) => ({
              id: i.id,
              provider: i.provider,
              enabled: i.enabled,
              status: i.status,
              last_sync_at: i.lastSyncAt,
              last_error: i.lastError,
              updated_at: i.updatedAt,
            })),
          },
          alerts: {
            unresolved_notifications: unresolvedNotifications.map((n) => ({
              id: n.id,
              type: n.type,
              severity: "INFO",
              created_at: n.createdAt,
            })),
          },
          recent_audit_events: recentAuditLogs.map((a) => ({
            id: a.id,
            created_at: a.createdAt,
            category: a.category,
            action: a.action,
            severity: a.severity,
          })),
          recent_usage: recentUsageRecords.map((u) => ({
            id: u.id,
            metric: u.metric,
            quantity: u.quantity,
            occurred_at: u.periodStart,
          })),
        });
      } catch (err) {
        logger.error("Ops diagnostics error", { error: err });
        res.status(500).json({ error: "Failed to load diagnostics" });
      }
    }
  );

  router.get(
    "/ops/queue-slo",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const organizationId = req.organizationId!;
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const [runs24h, failedByProvider, configs] = await Promise.all([
          prisma.integrationRun.findMany({
            where: { organizationId, startedAt: { gte: since } },
            select: { status: true, provider: true, failureCount: true, successCount: true },
          }),
          prisma.integrationRun.groupBy({
            by: ["provider"],
            where: {
              organizationId,
              startedAt: { gte: since },
              status: "FAILED",
            },
            _count: { _all: true },
            _sum: { failureCount: true },
          }),
          prisma.integrationConfig.findMany({
            where: { organizationId, enabled: true },
            select: { provider: true, lastSyncAt: true, status: true },
          }),
        ]);

        const totalRuns = runs24h.length;
        const failedRuns = runs24h.filter((r) => r.status === "FAILED").length;
        const failureRate = totalRuns === 0 ? 0 : failedRuns / totalRuns;
        const staleIntegrations = configs.filter((c) => {
          if (!c.lastSyncAt) return true;
          const lagMinutes = Math.floor((Date.now() - c.lastSyncAt.getTime()) / 60000);
          return lagMinutes > 90;
        }).length;

        const alerts: Array<{ severity: "WARN" | "CRITICAL"; code: string; message: string }> =
          [];
        if (failureRate >= 0.2) {
          alerts.push({
            severity: "CRITICAL",
            code: "INTEGRATION_FAILURE_RATE",
            message: `Integration run failure rate in last 24h is ${(failureRate * 100).toFixed(1)}%.`,
          });
        } else if (failureRate >= 0.1) {
          alerts.push({
            severity: "WARN",
            code: "INTEGRATION_FAILURE_RATE",
            message: `Integration run failure rate in last 24h is ${(failureRate * 100).toFixed(1)}%.`,
          });
        }
        if (staleIntegrations > 0) {
          alerts.push({
            severity: staleIntegrations >= 3 ? "CRITICAL" : "WARN",
            code: "INTEGRATION_STALENESS",
            message: `${staleIntegrations} enabled integration(s) are stale (>90 min since sync).`,
          });
        }

        res.json({
          window_hours: 24,
          total_runs: totalRuns,
          failed_runs: failedRuns,
          failure_rate: Number((failureRate * 100).toFixed(2)),
          stale_integrations: staleIntegrations,
          failed_runs_by_provider: failedByProvider.map((p) => ({
            provider: p.provider,
            failed_runs: p._count._all,
            failure_events: p._sum.failureCount ?? 0,
          })),
          alerts,
        });
      } catch (err) {
        logger.error("Get queue SLO metrics error", { error: err });
        res.status(500).json({ error: "Failed to load queue SLO metrics" });
      }
    }
  );

  router.get(
    "/ops/synthetic-health",
    requirePermission(prisma, "manage_permissions"),
    async (_req: AuthReq, res: Response) => {
      const timeoutFetch = async (url: string, timeoutMs: number): Promise<boolean> => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const resp = await fetch(url, { method: "HEAD", signal: controller.signal });
          return resp.ok || (resp.status >= 200 && resp.status < 500);
        } catch {
          return false;
        } finally {
          clearTimeout(timeout);
        }
      };

      try {
        const dbCheck = await prisma.$queryRaw`SELECT 1`;
        void dbCheck;
        const [openaiReachable, stripeReachable] = await Promise.all([
          timeoutFetch("https://api.openai.com/v1/models", 2500),
          timeoutFetch("https://api.stripe.com/v1/charges", 2500),
        ]);

        const checks = [
          { dependency: "database", healthy: true, detail: "Prisma query succeeded" },
          {
            dependency: "openai_api",
            healthy: openaiReachable && Boolean(process.env.OPENAI_API_KEY),
            detail: openaiReachable
              ? "OpenAI endpoint reachable"
              : "OpenAI endpoint not reachable",
          },
          {
            dependency: "stripe_api",
            healthy: stripeReachable && Boolean(process.env.STRIPE_SECRET_KEY),
            detail: stripeReachable
              ? "Stripe endpoint reachable"
              : "Stripe endpoint not reachable",
          },
          {
            dependency: "redis_url",
            healthy: Boolean(process.env.REDIS_URL),
            detail: process.env.REDIS_URL ? "Redis URL configured" : "Missing REDIS_URL",
          },
        ];

        const degraded = checks.filter((c) => !c.healthy).length;
        res.json({
          status: degraded === 0 ? "HEALTHY" : degraded >= 2 ? "CRITICAL" : "DEGRADED",
          checked_at: new Date().toISOString(),
          checks,
        });
      } catch (err) {
        logger.error("Synthetic health checks failed", { error: err });
        res.status(500).json({
          status: "CRITICAL",
          checked_at: new Date().toISOString(),
          checks: [
            {
              dependency: "database",
              healthy: false,
              detail: err instanceof Error ? err.message : "Database check failed",
            },
          ],
        });
      }
    }
  );

  router.get(
    "/ops/pipeline-status",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const organizationId = req.organizationId!;
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const [runs, pendingApprovals, failedBackfills] = await Promise.all([
          prisma.integrationRun.findMany({
            where: { organizationId, startedAt: { gte: since } },
            select: {
              runType: true,
              status: true,
              provider: true,
              startedAt: true,
              finishedAt: true,
              processedCount: true,
              successCount: true,
              failureCount: true,
            },
            orderBy: { startedAt: "desc" },
            take: 300,
          }),
          prisma.approvalRequest.count({
            where: {
              organizationId,
              status: "PENDING",
            },
          }),
          prisma.integrationRun.count({
            where: {
              organizationId,
              runType: "BACKFILL",
              status: "FAILED",
              startedAt: { gte: since },
            },
          }),
        ]);

        const stages = {
          sync: runs.filter((r) => r.runType === "SYNC"),
          backfill: runs.filter((r) => r.runType === "BACKFILL"),
          replay: runs.filter((r) => r.runType === "REPLAY"),
        };
        const summarize = (items: typeof runs) => ({
          total: items.length,
          completed: items.filter((i) => i.status === "COMPLETED").length,
          failed: items.filter((i) => i.status === "FAILED").length,
          running: items.filter((i) => i.status === "RUNNING").length,
          processed: items.reduce((acc, i) => acc + i.processedCount, 0),
          successes: items.reduce((acc, i) => acc + i.successCount, 0),
          failures: items.reduce((acc, i) => acc + i.failureCount, 0),
        });

        res.json({
          window_hours: 24,
          sync: summarize(stages.sync),
          backfill: summarize(stages.backfill),
          replay: summarize(stages.replay),
          pending_approvals: pendingApprovals,
          failed_backfills: failedBackfills,
          latest_runs: runs.slice(0, 25).map((r) => ({
            run_type: r.runType,
            status: r.status,
            provider: r.provider,
            started_at: r.startedAt.toISOString(),
            finished_at: r.finishedAt?.toISOString() ?? null,
            processed_count: r.processedCount,
            success_count: r.successCount,
            failure_count: r.failureCount,
          })),
        });
      } catch (err) {
        logger.error("Get pipeline status error", { error: err });
        res.status(500).json({ error: "Failed to load pipeline status" });
      }
    }
  );

  router.get(
    "/ops/dr-readiness",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const organizationId = req.organizationId!;
        const settings = await prisma.orgSettings.findUnique({
          where: { organizationId },
          select: { dataGovernancePolicy: true },
        });
        const policy =
          settings?.dataGovernancePolicy &&
          typeof settings.dataGovernancePolicy === "object" &&
          !Array.isArray(settings.dataGovernancePolicy)
            ? (settings.dataGovernancePolicy as DataGovernancePolicy)
            : {};

        const [lastBackup, lastRestoreValidation, criticalCounts] = await Promise.all([
          prisma.auditLog.findFirst({
            where: {
              organizationId,
              category: "DR",
              action: "DR_BACKUP_VERIFIED",
            },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true, metadata: true },
          }),
          prisma.auditLog.findFirst({
            where: {
              organizationId,
              category: "DR",
              action: "DR_RESTORE_VALIDATED",
            },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true, metadata: true },
          }),
          Promise.all([
            prisma.account.count({ where: { organizationId } }),
            prisma.call.count({ where: { organizationId } }),
            prisma.story.count({ where: { organizationId } }),
            prisma.landingPage.count({ where: { organizationId } }),
          ]),
        ]);

        const [accountCount, callCount, storyCount, pageCount] = criticalCounts;
        const rtoTargetMinutes = policy.rto_target_minutes ?? 240;
        const rpoTargetMinutes = policy.rpo_target_minutes ?? 60;
        const backupAgeMinutes = lastBackup
          ? Math.floor((Date.now() - lastBackup.createdAt.getTime()) / 60000)
          : null;
        const restoreValidationAgeMinutes = lastRestoreValidation
          ? Math.floor((Date.now() - lastRestoreValidation.createdAt.getTime()) / 60000)
          : null;

        const status =
          backupAgeMinutes !== null &&
          restoreValidationAgeMinutes !== null &&
          backupAgeMinutes <= rpoTargetMinutes &&
          restoreValidationAgeMinutes <= rtoTargetMinutes
            ? "READY"
            : "AT_RISK";

        res.json({
          status,
          targets: {
            rto_minutes: rtoTargetMinutes,
            rpo_minutes: rpoTargetMinutes,
          },
          last_backup_verified_at: lastBackup?.createdAt.toISOString() ?? null,
          last_restore_validated_at:
            lastRestoreValidation?.createdAt.toISOString() ?? null,
          backup_age_minutes: backupAgeMinutes,
          restore_validation_age_minutes: restoreValidationAgeMinutes,
          critical_entity_counts: {
            accounts: accountCount,
            calls: callCount,
            stories: storyCount,
            landing_pages: pageCount,
          },
        });
      } catch (err) {
        logger.error("Get DR readiness error", { error: err });
        res.status(500).json({ error: "Failed to load DR readiness" });
      }
    }
  );

  router.post(
    "/ops/dr-readiness/backup-verify",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const organizationId = req.organizationId!;
        const [accountCount, callCount, storyCount, pageCount] = await Promise.all([
          prisma.account.count({ where: { organizationId } }),
          prisma.call.count({ where: { organizationId } }),
          prisma.story.count({ where: { organizationId } }),
          prisma.landingPage.count({ where: { organizationId } }),
        ]);
        await auditLogs.record({
          organizationId,
          actorUserId: req.userId,
          category: "DR",
          action: "DR_BACKUP_VERIFIED",
          targetType: "organization",
          targetId: organizationId,
          severity: "WARN",
          metadata: {
            entities: {
              accounts: accountCount,
              calls: callCount,
              stories: storyCount,
              landing_pages: pageCount,
            },
            verification: "metadata_snapshot",
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({ verified: true });
      } catch (err) {
        logger.error("Backup verification error", { error: err });
        res.status(500).json({ error: "Failed to verify backup status" });
      }
    }
  );

  router.post(
    "/ops/dr-readiness/restore-validate",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const organizationId = req.organizationId!;
        const [accountCount, callCount, storyCount] = await Promise.all([
          prisma.account.count({ where: { organizationId } }),
          prisma.call.count({ where: { organizationId } }),
          prisma.story.count({ where: { organizationId } }),
        ]);
        const passed = accountCount >= 0 && callCount >= 0 && storyCount >= 0;
        await auditLogs.record({
          organizationId,
          actorUserId: req.userId,
          category: "DR",
          action: passed ? "DR_RESTORE_VALIDATED" : "DR_RESTORE_VALIDATION_FAILED",
          targetType: "organization",
          targetId: organizationId,
          severity: passed ? "INFO" : "CRITICAL",
          metadata: {
            checks: {
              accounts: accountCount,
              calls: callCount,
              stories: storyCount,
            },
            result: passed ? "pass" : "fail",
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({ validated: passed });
      } catch (err) {
        logger.error("Restore validation error", { error: err });
        res.status(500).json({ error: "Failed to validate restoration hooks" });
      }
    }
  );

  // ── Admin: Billing Readiness ──────────────────────────────────────

  router.get(
    "/billing/readiness",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const organizationId = req.organizationId!;
        const [org, users, subscription, usageLast30] =
          await Promise.all([
            prisma.organization.findUnique({
              where: { id: organizationId },
              select: {
                id: true,
                plan: true,
                pricingModel: true,
                billingChannel: true,
                seatLimit: true,
              },
            }),
            prisma.user.findMany({
              where: { organizationId },
              select: { role: true },
            }),
            prisma.subscription.findFirst({
              where: { organizationId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
              orderBy: { createdAt: "desc" },
            }),
            prisma.usageRecord.findMany({
              where: {
                organizationId,
                periodStart: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
              },
              select: { metric: true, quantity: true, periodStart: true, periodEnd: true },
              orderBy: { periodStart: "desc" },
            }),
          ]);

        if (!org) {
          res.status(404).json({ error: "Organization not found" });
          return;
        }

        const seatsUsed = users.length;
        const roleCounts = users.reduce<Record<string, number>>((acc, u) => {
          acc[u.role] = (acc[u.role] ?? 0) + 1;
          return acc;
        }, {});
        const overSeat = org.seatLimit !== null && seatsUsed > org.seatLimit;
        const usageByMetric = usageLast30.reduce<Record<string, number>>((acc, u) => {
          acc[u.metric] = (acc[u.metric] ?? 0) + u.quantity;
          return acc;
        }, {});
        const transcriptMinutes = usageByMetric.TRANSCRIPT_MINUTES ?? 0;
        const includedUnits = subscription?.includedUnits ?? null;
        const overageUnits =
          includedUnits !== null ? Math.max(0, transcriptMinutes - includedUnits) : 0;
        const projectedOverageCost =
          includedUnits !== null && subscription?.meteredUnitPrice
            ? overageUnits * subscription.meteredUnitPrice
            : null;
        const enabledFeatureFlags = await featureFlags.getResolvedEnabledKeys(organizationId);
        const entitlementOverride = getResolvedEntitlementOverride(organizationId);
        const effectiveSeatLimit =
          entitlementOverride.seat_limit !== undefined
            ? entitlementOverride.seat_limit
            : org.seatLimit;

        res.json({
          organization: {
            plan: org.plan,
            pricing_model: org.pricingModel,
            billing_channel: org.billingChannel,
          },
          seats: {
            limit: effectiveSeatLimit,
            used: seatsUsed,
            over_limit:
              effectiveSeatLimit !== null && effectiveSeatLimit !== undefined
                ? seatsUsed > effectiveSeatLimit
                : overSeat,
            by_role: roleCounts,
          },
          subscription: subscription
            ? {
                id: subscription.id,
                status: subscription.status,
                seat_count: subscription.seatCount,
                included_units: subscription.includedUnits,
                metered_unit_price: subscription.meteredUnitPrice,
                current_period_start:
                  subscription.currentPeriodStart?.toISOString() ?? null,
                current_period_end:
                  subscription.currentPeriodEnd?.toISOString() ?? null,
              }
            : null,
          usage_30d: usageByMetric,
          overage: {
            metric: "TRANSCRIPT_MINUTES",
            included_units: includedUnits,
            used_units: transcriptMinutes,
            overage_units: overageUnits,
            projected_cost: projectedOverageCost,
          },
          entitlements: {
            feature_flags: Array.from(
              new Set([...(enabledFeatureFlags ?? []), ...(entitlementOverride.feature_flags ?? [])])
            ),
            usage_caps: entitlementOverride.usage_caps ?? {},
            environment:
              process.env.DEPLOY_ENV || process.env.NODE_ENV || "development",
          },
        });
      } catch (err) {
        logger.error("Get billing readiness error", { error: err });
        res.status(500).json({ error: "Failed to load billing readiness" });
      }
    }
  );

  router.patch(
    "/billing/seats",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parsed = UpdateSeatLimitSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "validation_error", details: parsed.error.issues });
        return;
      }
      try {
        const organizationId = req.organizationId!;
        await prisma.organization.update({
          where: { id: organizationId },
          data: { seatLimit: parsed.data.seat_limit },
        });
        await prisma.subscription.updateMany({
          where: { organizationId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
          data: { seatCount: parsed.data.seat_limit },
        });
        await auditLogs.record({
          organizationId,
          actorUserId: req.userId,
          category: "BILLING",
          action: "SEAT_LIMIT_UPDATED",
          targetType: "organization",
          targetId: organizationId,
          severity: "WARN",
          metadata: { seat_limit: parsed.data.seat_limit },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({ updated: true });
      } catch (err) {
        logger.error("Update seat limit error", { error: err });
        res.status(500).json({ error: "Failed to update seat limit" });
      }
    }
  );

  router.get(
    "/billing/reconciliation",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const organizationId = req.organizationId!;
        const [usageRecords, calls] = await Promise.all([
          prisma.usageRecord.findMany({
            where: {
              organizationId,
              metric: "TRANSCRIPT_MINUTES",
              periodStart: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
            },
            select: { quantity: true, periodStart: true, periodEnd: true, reportedToStripe: true },
          }),
          prisma.call.findMany({
            where: {
              organizationId,
              occurredAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
              duration: { not: null },
            },
            select: { duration: true, occurredAt: true },
          }),
        ]);

        const meteredMinutes = usageRecords.reduce((acc, r) => acc + r.quantity, 0);
        const computedMinutes = Math.ceil(
          calls.reduce((acc, c) => acc + (c.duration ?? 0), 0) / 60
        );
        const delta = Math.abs(meteredMinutes - computedMinutes);
        const mismatchPct =
          computedMinutes === 0 ? 0 : Number(((delta / computedMinutes) * 100).toFixed(2));
        const status =
          mismatchPct <= 1 ? "OK" : mismatchPct <= 5 ? "WARN" : "CRITICAL";

        res.json({
          window_days: 30,
          metered_minutes: meteredMinutes,
          computed_minutes: computedMinutes,
          delta_minutes: delta,
          mismatch_percent: mismatchPct,
          status,
          stripe_report_coverage_percent:
            usageRecords.length === 0
              ? 0
              : Number(
                  (
                    (usageRecords.filter((r) => r.reportedToStripe).length /
                      usageRecords.length) *
                    100
                  ).toFixed(2)
                ),
        });
      } catch (err) {
        logger.error("Billing reconciliation error", { error: err });
        res.status(500).json({ error: "Failed to load billing reconciliation" });
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

  // ─── Support Account Info (Tenant-Side) ──────────────────────────────────

  router.get("/support-account", async (req: any, res) => {
    try {
      const platformSettings = await prisma.platformSettings.findFirst();
      const optOut = await prisma.tenantSupportOptOut.findUnique({
        where: { organizationId: req.organizationId },
      });
      res.json({
        email: platformSettings?.supportAccountEmail ?? null,
        label: platformSettings?.supportAccountLabel ?? "Platform Support",
        opted_out: !!optOut,
      });
    } catch (err) {
      logger.error("Support account info error", { error: err });
      res.status(500).json({ error: "Failed to load support account info" });
    }
  });

  router.post("/support-account/opt-out", async (req: any, res) => {
    try {
      if (req.userRole !== "OWNER" && req.userRole !== "ADMIN") {
        return res.status(403).json({ error: "Only account owner or admin can manage support access" });
      }
      await prisma.tenantSupportOptOut.upsert({
        where: { organizationId: req.organizationId },
        create: {
          organizationId: req.organizationId,
          optedOutById: req.userId,
        },
        update: {
          optedOutById: req.userId,
          optedOutAt: new Date(),
        },
      });
      res.json({ ok: true });
    } catch (err) {
      logger.error("Support opt-out error", { error: err });
      res.status(500).json({ error: "Failed to opt out of support access" });
    }
  });

  router.post("/support-account/opt-in", async (req: any, res) => {
    try {
      if (req.userRole !== "OWNER" && req.userRole !== "ADMIN") {
        return res.status(403).json({ error: "Only account owner or admin can manage support access" });
      }
      await prisma.tenantSupportOptOut.deleteMany({
        where: { organizationId: req.organizationId },
      });
      res.json({ ok: true });
    } catch (err) {
      logger.error("Support opt-in error", { error: err });
      res.status(500).json({ error: "Failed to opt in to support access" });
    }
  });

  // ─── Account Deletion (Tenant-Side) ─────────────────────────────────────

  router.post("/account/request-deletion", async (req: any, res) => {
    try {
      if (req.userRole !== "OWNER") {
        return res.status(403).json({ error: "Only the account owner can request account deletion" });
      }
      const existing = await prisma.tenantDeletionRequest.findUnique({
        where: { organizationId: req.organizationId },
      });
      if (existing && (existing.status === "PENDING_APPROVAL" || existing.status === "APPROVED")) {
        return res.status(409).json({ error: "A deletion request is already pending" });
      }
      // Delete any old cancelled request first
      if (existing) {
        await prisma.tenantDeletionRequest.delete({ where: { id: existing.id } });
      }
      const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 500) : null;
      // From the end-user perspective, the account starts a 30-day deletion countdown immediately.
      // In reality, it goes to the platform owner for approval first.
      const scheduledDeleteAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await prisma.tenantDeletionRequest.create({
        data: {
          organizationId: req.organizationId,
          requestedById: req.userId,
          reason,
          status: "PENDING_APPROVAL",
          scheduledDeleteAt,
        },
      });
      // Return the scheduled date — the user sees this as "will be deleted after 30 days"
      // They don't know about the approval step
      res.json({ ok: true, scheduled_delete_at: scheduledDeleteAt.toISOString() });
    } catch (err) {
      logger.error("Account deletion request error", { error: err });
      res.status(500).json({ error: "Failed to request account deletion" });
    }
  });

  router.post("/account/cancel-deletion", async (req: any, res) => {
    try {
      if (req.userRole !== "OWNER") {
        return res.status(403).json({ error: "Only the account owner can cancel deletion" });
      }
      const existing = await prisma.tenantDeletionRequest.findUnique({
        where: { organizationId: req.organizationId },
      });
      if (!existing || (existing.status !== "PENDING_APPROVAL" && existing.status !== "APPROVED")) {
        return res.status(404).json({ error: "No active deletion request found" });
      }
      await prisma.tenantDeletionRequest.update({
        where: { id: existing.id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelledById: req.userId,
        },
      });
      res.json({ ok: true });
    } catch (err) {
      logger.error("Account deletion cancel error", { error: err });
      res.status(500).json({ error: "Failed to cancel account deletion" });
    }
  });

  router.get("/account/deletion-status", async (req: any, res) => {
    try {
      const existing = await prisma.tenantDeletionRequest.findUnique({
        where: { organizationId: req.organizationId },
      });
      if (!existing || existing.status === "CANCELLED" || existing.status === "COMPLETED") {
        return res.json({ has_request: false, status: null, scheduled_delete_at: null, created_at: null });
      }
      // For the end user, both PENDING_APPROVAL and APPROVED show as "scheduled"
      // This hides the approval step from the tenant
      res.json({
        has_request: true,
        status: "SCHEDULED",
        scheduled_delete_at: existing.scheduledDeleteAt?.toISOString() ?? null,
        created_at: existing.createdAt.toISOString(),
      });
    } catch (err) {
      logger.error("Account deletion status error", { error: err });
      res.status(500).json({ error: "Failed to get deletion status" });
    }
  });

  return router;
}
