import { type Response, type Router } from "express";
import { z } from "zod";
import type { PrismaClient, UserRole } from "@prisma/client";
import { STORY_LENGTHS, STORY_OUTLINES, STORY_TYPES } from "../../types/story-generation.js";
import { STORY_FORMATS } from "../../types/taxonomy.js";
import { requirePermission, type PermissionManager } from "../../middleware/permissions.js";
import type { AuditLogService } from "../../services/audit-log.js";
import { AdminSettingsService } from "../../services/admin-settings.js";
import { sendSuccess, sendNotFound, sendConflict } from "../_shared/responses.js";
import { parseRequestBody } from "../_shared/validators.js";
import type { AuthenticatedRequest } from "../../types/authenticated-request.js";
import { asyncHandler } from "../../lib/async-handler.js";

const UpdateOrgSettingsSchema = z.object({
  landing_pages_enabled: z.boolean().optional(),
  default_page_visibility: z.enum(["PRIVATE", "SHARED_WITH_LINK"]).optional(),
  approval_policy: z
    .enum(["ALL_REQUIRED", "ANON_NO_APPROVAL", "NAMED_NO_APPROVAL", "ALL_NO_APPROVAL"])
    .optional(),
  require_approval_to_publish: z.boolean().optional(),
  allowed_publishers: z.array(z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"])).optional(),
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
  published_branding: z
    .object({
      brand_name: z.string().max(120).optional(),
      logo_url: z.string().url().max(2000).optional().or(z.literal("")),
      primary_color: z
        .string()
        .regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/)
        .optional()
        .or(z.literal("")),
      accent_color: z
        .string()
        .regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/)
        .optional()
        .or(z.literal("")),
      surface_color: z
        .string()
        .regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/)
        .optional()
        .or(z.literal("")),
    })
    .optional(),
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
  rto_target_minutes: z
    .number()
    .int()
    .min(5)
    .max(60 * 24 * 14)
    .optional(),
  rpo_target_minutes: z
    .number()
    .int()
    .min(5)
    .max(60 * 24 * 14)
    .optional(),
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

type DeleteGovernedTarget = (
  organizationId: string,
  targetType: "CALL" | "STORY" | "LANDING_PAGE",
  targetId: string
) => Promise<boolean>;

interface RegisterAdminSettingsRoutesOptions {
  router: Router;
  prisma: PrismaClient;
  permManager: PermissionManager;
  auditLogs: AuditLogService;
  deleteGovernedTarget: DeleteGovernedTarget;
}

export function registerAdminSettingsRoutes({
  router,
  prisma,
  permManager,
  auditLogs,
  deleteGovernedTarget,
}: RegisterAdminSettingsRoutesOptions): void {
  const settingsService = new AdminSettingsService(prisma);

  // ── Admin: Org Settings ─────────────────────────────────────────────

  /**
   * GET /api/dashboard/settings
   *
   * Returns current org settings for landing pages.
   */
  router.get(
    "/settings",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const settings = await settingsService.getOrgSettings(req.organizationId!);

      sendSuccess(res, {
        settings: settings ?? {
          landing_pages_enabled: true,
          default_page_visibility: "PRIVATE",
          require_approval_to_publish: false,
          allowed_publishers: ["OWNER", "ADMIN"],
          max_pages_per_user: null,
          company_name_replacements: {},
        },
      });
    })
  );

  /**
   * PATCH /api/dashboard/settings
   *
   * Updates org settings. Admin only.
   */
  router.patch(
    "/settings",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const payload = parseRequestBody(UpdateOrgSettingsSchema, req.body, res);
      if (!payload) {
        return;
      }

      await permManager.updateOrgSettings(req.organizationId!, {
        landingPagesEnabled: payload.landing_pages_enabled,
        defaultPageVisibility: payload.default_page_visibility,
        approvalPolicy: payload.approval_policy,
        requireApprovalToPublish: payload.require_approval_to_publish,
        allowedPublishers: payload.allowed_publishers as UserRole[] | undefined,
        maxPagesPerUser: payload.max_pages_per_user,
        companyNameReplacements: payload.company_name_replacements,
      });

      sendSuccess(res, { updated: true });
    })
  );

  // ── Admin: Story Context & Prompt Defaults ────────────────────────

  router.get(
    "/story-context",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const { context, defaults } = await settingsService.getStoryContext(req.organizationId!);
      const branding = context.publishedBranding ?? {};

      sendSuccess(res, {
        company_overview: context.companyOverview ?? "",
        products: context.products ?? [],
        target_personas: context.targetPersonas ?? [],
        target_industries: context.targetIndustries ?? [],
        differentiators: context.differentiators ?? [],
        proof_points: context.proofPoints ?? [],
        banned_claims: context.bannedClaims ?? [],
        writing_style_guide: context.writingStyleGuide ?? "",
        approved_terminology: context.approvedTerminology ?? [],
        published_branding: {
          brand_name: branding.brandName ?? "",
          logo_url: branding.logoUrl ?? "",
          primary_color: branding.primaryColor ?? "",
          accent_color: branding.accentColor ?? "",
          surface_color: branding.surfaceColor ?? "",
        },
        default_story_length: defaults.storyLength ?? "MEDIUM",
        default_story_outline: defaults.storyOutline ?? "CHRONOLOGICAL_JOURNEY",
        default_story_format: defaults.storyFormat ?? null,
        default_story_type: defaults.storyType ?? "FULL_ACCOUNT_JOURNEY",
      });
    })
  );

  router.patch(
    "/story-context",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const payload = parseRequestBody(StoryContextSchema, req.body, res);
      if (!payload) {
        return;
      }

      const d = payload;

      await settingsService.upsertStoryContext(req.organizationId!, d);
      await auditLogs.record({
        organizationId: req.organizationId!,
        actorUserId: req.userId!,
        category: "POLICY",
        action: "STORY_CONTEXT_UPDATED",
        targetType: "org_settings",
        targetId: req.organizationId!,
        severity: "WARN",
        metadata: { updated_fields: Object.keys(d) },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
      sendSuccess(res, { updated: true });
    })
  );

  // ── Admin: Data Governance Policy ────────────────────────────────

  router.get(
    "/data-governance",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const policy = await settingsService.getDataGovernancePolicy(req.organizationId!);
      sendSuccess(res, {
        retention_days: policy.retention_days ?? 365,
        audit_log_retention_days: policy.audit_log_retention_days ?? 365,
        legal_hold_enabled: policy.legal_hold_enabled ?? false,
        pii_export_enabled: policy.pii_export_enabled ?? true,
        deletion_requires_approval: policy.deletion_requires_approval ?? true,
        allow_named_story_exports: policy.allow_named_story_exports ?? false,
        rto_target_minutes: policy.rto_target_minutes ?? 240,
        rpo_target_minutes: policy.rpo_target_minutes ?? 60,
      });
    })
  );

  router.patch(
    "/data-governance",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const payload = parseRequestBody(DataGovernanceSchema, req.body, res);
      if (!payload) {
        return;
      }

      const d = payload;

      await settingsService.upsertDataGovernancePolicy(req.organizationId!, d);
      await auditLogs.record({
        organizationId: req.organizationId!,
        actorUserId: req.userId!,
        category: "POLICY",
        action: "DATA_GOVERNANCE_POLICY_UPDATED",
        targetType: "org_settings",
        targetId: req.organizationId!,
        severity: "WARN",
        metadata: { updated_fields: Object.keys(d) },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
      sendSuccess(res, { updated: true });
    })
  );

  router.get(
    "/data-governance/overview",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const policy = await settingsService.getDataGovernancePolicy(req.organizationId!);
      const retentionDays = policy.retention_days ?? 365;
      const retentionCutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

      const [
        pendingApprovalsCount,
        pendingDeletionCount,
        eligibleCallDeletions,
        recentAuditEvents,
      ] = await Promise.all([
        prisma.approvalRequest.count({
          where: {
            organizationId: req.organizationId!,
            status: "PENDING",
            requestType: { not: "DATA_DELETION" },
          },
        }),
        prisma.approvalRequest.count({
          where: {
            organizationId: req.organizationId!,
            status: "PENDING",
            requestType: "DATA_DELETION",
          },
        }),
        prisma.call.count({
          where: {
            organizationId: req.organizationId!,
            occurredAt: { lt: retentionCutoff },
          },
        }),
        prisma.auditLog.findMany({
          where: { organizationId: req.organizationId! },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true,
            category: true,
            action: true,
            severity: true,
            createdAt: true,
            actorUserId: true,
          },
        }),
      ]);

      sendSuccess(res, {
        pending_approvals_count: pendingApprovalsCount,
        pending_deletion_requests_count: pendingDeletionCount,
        retention_days: retentionDays,
        eligible_call_deletions: eligibleCallDeletions,
        legal_hold_enabled: policy.legal_hold_enabled ?? false,
        pii_export_enabled: policy.pii_export_enabled ?? true,
        allow_named_story_exports: policy.allow_named_story_exports ?? false,
        recent_audit_events: recentAuditEvents.map((event) => ({
          id: event.id,
          category: event.category,
          action: event.action,
          severity: event.severity,
          actor_user_id: event.actorUserId,
          created_at: event.createdAt.toISOString(),
        })),
      });
    })
  );

  router.get(
    "/data-governance/deletion-requests",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const status = (req.query.status as string | undefined)?.trim().toUpperCase();

      const requests = await settingsService.listDeletionRequests(req.organizationId!, status);
      sendSuccess(res, {
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
    })
  );

  router.post(
    "/data-governance/deletion-requests",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const payload = parseRequestBody(CreateDeletionRequestSchema, req.body, res);
      if (!payload) {
        return;
      }

      const orgId = req.organizationId!;
      const policy = await settingsService.getDataGovernancePolicy(orgId);

      if (policy.legal_hold_enabled) {
        res.status(423).json({
          error: "legal_hold_active",
          message: "Deletion is blocked because legal hold is enabled.",
        });
        return;
      }

      if (policy.deletion_requires_approval !== false) {
        const request = await settingsService.createDeletionRequest(
          orgId,
          payload.target_type,
          payload.target_id,
          req.userId!,
          payload.reason ?? null
        );

        await auditLogs.record({
          organizationId: orgId,
          actorUserId: req.userId!,
          category: "GOVERNANCE",
          action: "DATA_DELETION_REQUESTED",
          targetType: payload.target_type.toLowerCase(),
          targetId: payload.target_id,
          severity: "WARN",
          metadata: { approval_request_id: request.id, reason: payload.reason ?? null },
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

      const deleted = await deleteGovernedTarget(orgId, payload.target_type, payload.target_id);
      await auditLogs.record({
        organizationId: orgId,
        actorUserId: req.userId!,
        category: "GOVERNANCE",
        action: "DATA_DELETION_EXECUTED",
        targetType: payload.target_type.toLowerCase(),
        targetId: payload.target_id,
        severity: "WARN",
        metadata: {
          reason: payload.reason ?? null,
          deleted,
          approval_required: false,
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
      sendSuccess(res, { deleted });
    })
  );

  router.post(
    "/data-governance/deletion-requests/:requestId/review",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const payload = parseRequestBody(ReviewDeletionRequestSchema, req.body, res);
      if (!payload) {
        return;
      }

      const requestId = String(req.params.requestId);
      const request = await settingsService.findDeletionRequest(requestId, req.organizationId!);
      if (!request) {
        sendNotFound(res, "Deletion request not found");
        return;
      }
      if (request.status !== "PENDING") {
        sendConflict(res, "Request is no longer pending");
        return;
      }

      if (payload.decision === "REJECT") {
        const updated = await settingsService.rejectDeletionRequest(
          request.id,
          req.userId!,
          payload.review_notes ?? null
        );
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId!,
          category: "GOVERNANCE",
          action: "DATA_DELETION_REJECTED",
          targetType: updated.targetType.toLowerCase(),
          targetId: updated.targetId,
          severity: "INFO",
          metadata: { approval_request_id: updated.id },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        sendSuccess(res, { status: "REJECTED" });
        return;
      }

      const targetType = request.targetType as "CALL" | "STORY" | "LANDING_PAGE";
      const deleted = await deleteGovernedTarget(req.organizationId!, targetType, request.targetId);
      const updated = await settingsService.completeDeletionRequest(
        request.id,
        req.userId!,
        payload.review_notes ?? null
      );
      await auditLogs.record({
        organizationId: req.organizationId!,
        actorUserId: req.userId!,
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
      sendSuccess(res, { status: "COMPLETED", deleted });
    })
  );
}
