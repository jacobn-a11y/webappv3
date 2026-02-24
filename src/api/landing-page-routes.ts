/**
 * Landing Page API Routes
 *
 * CRUD + publish/share for landing pages.
 * All routes behind auth + permissions middleware.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { PrismaClient, UserRole } from "@prisma/client";
import {
  LandingPageEditor,
  PublishValidationError,
  ScrubValidationError,
} from "../services/landing-page-editor.js";
import { AccountAccessService } from "../services/account-access.js";
import { RoleProfileService } from "../services/role-profiles.js";
import { AuditLogService } from "../services/audit-log.js";
import { isLegalHoldEnabled } from "../services/data-governance.js";
import { renderLandingPageHtml } from "./public-page-renderer.js";
import {
  requireLandingPagesEnabled,
  requirePermission,
  requirePageOwnerOrPermission,
} from "../middleware/permissions.js";

// ─── Validation ──────────────────────────────────────────────────────────────

const CreatePageSchema = z.object({
  story_id: z.string().min(1),
  title: z.string().min(1).max(200),
  subtitle: z.string().max(500).optional(),
  hero_image_url: z.string().url().optional(),
  callout_boxes: z
    .array(
      z.object({
        title: z.string(),
        body: z.string(),
        icon: z
          .enum(["metric", "quote", "insight", "timeline", "warning", "success"])
          .optional(),
      })
    )
    .optional(),
  /** Admin-only: include real company name (no scrubbing). Set at creation, not changeable. */
  include_company_name: z.boolean().optional(),
});

const UpdatePageSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  subtitle: z.string().max(500).optional(),
  editable_body: z.string().optional(),
  hero_image_url: z.string().url().nullable().optional(),
  callout_boxes: z
    .array(
      z.object({
        title: z.string(),
        body: z.string(),
        icon: z
          .enum(["metric", "quote", "insight", "timeline", "warning", "success"])
          .optional(),
      })
    )
    .optional(),
  custom_css: z.string().max(10000).optional(),
  edit_summary: z.string().max(500).optional(),
});

const PublishSchema = z.object({
  visibility: z.enum(["PRIVATE", "SHARED_WITH_LINK"]),
  password: z.string().min(4).max(100).optional(),
  expires_at: z.string().datetime().optional(),
  release_notes: z.string().max(1000).optional(),
});

const ReviewPublishApprovalSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  notes: z.string().max(1000).optional(),
});

interface PublishApprovalStep {
  step_order: number;
  min_approvals: number;
  required_role_profile_key: string | null;
  required_user_role: string | null;
  approver_scope_type: "ROLE_PROFILE" | "TEAM" | "USER" | "GROUP" | "SELF";
  approver_scope_value: string | null;
  allow_self_approval: boolean;
}

interface PublishApprovalPayload {
  page_id: string;
  options: {
    visibility: "PRIVATE" | "SHARED_WITH_LINK";
    password?: string;
    expires_at?: string;
    release_notes?: string;
  };
  steps: PublishApprovalStep[];
  approvals?: Array<{
    step_order: number;
    reviewer_user_id: string;
    reviewer_name: string | null;
    reviewer_email: string | null;
    decided_at: string;
    notes: string | null;
  }>;
  current_step_order?: number;
}

// ─── Authenticated request type ──────────────────────────────────────────────

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: string;
}

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createLandingPageRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const editor = new LandingPageEditor(prisma);
  const accessService = new AccountAccessService(prisma);
  const roleProfiles = new RoleProfileService(prisma);
  const auditLogs = new AuditLogService(prisma);

  const isAdminRole = (userRole?: string): boolean =>
    !!userRole && ["OWNER", "ADMIN"].includes(userRole);

  async function canAccessNamedStories(req: AuthReq): Promise<boolean> {
    if (isAdminRole(req.userRole)) {
      return true;
    }
    if (!req.organizationId || !req.userId) {
      return false;
    }
    const policy = await roleProfiles.getEffectivePolicy(
      req.organizationId,
      req.userId,
      req.userRole as UserRole | undefined
    );
    if (
      policy.canAccessNamedStories ||
      policy.permissions.includes("PUBLISH_NAMED_LANDING_PAGE")
    ) {
      return true;
    }
    const userPerm = await prisma.userPermission.findUnique({
      where: {
        userId_permission: {
          userId: req.userId,
          permission: "PUBLISH_NAMED_LANDING_PAGE",
        },
      },
    });
    return !!userPerm;
  }

  async function canGenerateNamedStories(req: AuthReq): Promise<boolean> {
    if (isAdminRole(req.userRole)) {
      return true;
    }
    if (!req.organizationId || !req.userId) {
      return false;
    }
    const policy = await roleProfiles.getEffectivePolicy(
      req.organizationId,
      req.userId,
      req.userRole as UserRole | undefined
    );
    if (
      policy.canGenerateNamedStories ||
      policy.permissions.includes("PUBLISH_NAMED_LANDING_PAGE")
    ) {
      return true;
    }
    const userPerm = await prisma.userPermission.findUnique({
      where: {
        userId_permission: {
          userId: req.userId,
          permission: "PUBLISH_NAMED_LANDING_PAGE",
        },
      },
    });
    return !!userPerm;
  }

  async function getArtifactPublishGovernance(organizationId: string): Promise<{
    approvalChainEnabled: boolean;
    maxExpirationDays: number | null;
    requireProvenance: boolean;
    steps: PublishApprovalStep[];
  }> {
    const policy = await prisma.artifactGovernancePolicy.findUnique({
      where: { organizationId },
      include: {
        approvalSteps: {
          where: { enabled: true },
          orderBy: { stepOrder: "asc" },
        },
      },
    });

    if (!policy) {
      return {
        approvalChainEnabled: false,
        maxExpirationDays: null,
        requireProvenance: true,
        steps: [],
      };
    }

    return {
      approvalChainEnabled: policy.approvalChainEnabled,
      maxExpirationDays: policy.maxExpirationDays ?? null,
      requireProvenance: policy.requireProvenance,
      steps: policy.approvalSteps.map((s) => ({
        step_order: s.stepOrder,
        min_approvals: s.minApprovals,
        required_role_profile_key: s.requiredRoleProfileKey ?? null,
        required_user_role: s.requiredUserRole ?? null,
        approver_scope_type:
          (s.approverScopeType as "ROLE_PROFILE" | "TEAM" | "USER" | "GROUP" | "SELF") ??
          "ROLE_PROFILE",
        approver_scope_value: s.approverScopeValue ?? null,
        allow_self_approval: s.allowSelfApproval,
      })),
    };
  }

  async function canUserApproveStep(
    req: AuthReq,
    step: PublishApprovalStep,
    requestedByUserId?: string
  ): Promise<boolean> {
    if (!req.organizationId || !req.userId) {
      return false;
    }

    if (step.required_user_role && req.userRole !== step.required_user_role) {
      return false;
    }

    const assignment = await prisma.userRoleAssignment.findUnique({
      where: { userId: req.userId },
      include: { roleProfile: { select: { key: true, organizationId: true } } },
    });
    const roleProfileKey =
      assignment && assignment.roleProfile.organizationId === req.organizationId
        ? assignment.roleProfile.key
        : null;

    // Billing/approval admins can approve org-wide.
    if (roleProfileKey === "BILLING_ADMIN" || roleProfileKey === "APPROVAL_ADMIN") {
      return true;
    }

    if (step.required_role_profile_key && roleProfileKey !== step.required_role_profile_key) {
      return false;
    }

    if (
      !step.allow_self_approval &&
      requestedByUserId &&
      requestedByUserId === req.userId
    ) {
      return false;
    }

    const scopeType = step.approver_scope_type ?? "ROLE_PROFILE";
    const scopeValue = step.approver_scope_value ?? null;

    if (scopeType === "SELF") {
      return requestedByUserId === req.userId;
    }
    if (scopeType === "USER") {
      return !!scopeValue && req.userId === scopeValue;
    }
    if (scopeType === "GROUP") {
      if (!scopeValue) return false;
      const member = await prisma.approvalGroupMember.findFirst({
        where: {
          organizationId: req.organizationId,
          groupId: scopeValue,
          userId: req.userId,
        },
      });
      return !!member;
    }
    if (scopeType === "TEAM") {
      if (!scopeValue) return false;
      if (roleProfileKey === "TEAM_APPROVAL_ADMIN") {
        const scope = await prisma.teamApprovalAdminScope.findFirst({
          where: {
            organizationId: req.organizationId,
            userId: req.userId,
            teamKey: scopeValue,
          },
        });
        return !!scope;
      }
      return roleProfileKey === scopeValue;
    }

    // ROLE_PROFILE (default)
    if (!scopeValue) {
      return !!roleProfileKey;
    }
    return roleProfileKey === scopeValue;
  }

  // All landing page routes require the feature to be enabled
  router.use(requireLandingPagesEnabled(prisma));

  // ── CREATE ──────────────────────────────────────────────────────────

  router.post(
    "/",
    requirePermission(prisma, "create"),
    async (req: AuthReq, res: Response) => {
      const parse = CreatePageSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      const { story_id, title, subtitle, hero_image_url, callout_boxes, include_company_name } = parse.data;
      if (!req.organizationId || !req.userId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const story = await prisma.story.findFirst({
        where: { id: story_id, organizationId: req.organizationId },
        select: { id: true, accountId: true },
      });
      if (!story) {
        res.status(404).json({ error: "Story not found" });
        return;
      }

      const canAccessAccount = await accessService.canAccessAccount(
        req.userId,
        req.organizationId,
        story.accountId,
        req.userRole as UserRole | undefined
      );
      if (!canAccessAccount) {
        res.status(403).json({
          error: "permission_denied",
          message: "You do not have access to this account.",
        });
        return;
      }

      let namedPageAllowed = false;
      if (include_company_name === true) {
        namedPageAllowed = await canGenerateNamedStories(req);
      }

      try {
        const pageId = await editor.create({
          storyId: story_id,
          organizationId: req.organizationId!,
          createdById: req.userId!,
          title,
          subtitle,
          heroImageUrl: hero_image_url,
          calloutBoxes: callout_boxes,
          includeCompanyName: namedPageAllowed,
        });

        const page = await editor.getForEditing(pageId);
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "PUBLISH",
          action: "PAGE_CREATED",
          targetType: "landing_page",
          targetId: page.id,
          severity: "INFO",
          metadata: {
            story_id,
            include_company_name: namedPageAllowed,
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.status(201).json({
          id: page.id,
          slug: page.slug,
          title: page.title,
          status: page.status,
          editable_body: page.editableBody,
          callout_boxes: page.calloutBoxes,
          total_call_hours: page.totalCallHours,
        });
      } catch (err) {
        console.error("Create landing page error:", err);
        res.status(500).json({ error: "Failed to create landing page" });
      }
    }
  );

  // ── GET (for editing — returns unscrubbed content) ──────────────────

  router.get(
    "/:pageId",
    requirePageOwnerOrPermission(prisma),
    async (req: AuthReq, res: Response) => {
      try {
        const page = await editor.getForEditing(req.params.pageId as string);
        if (page.includeCompanyName && !(await canAccessNamedStories(req))) {
          res.status(403).json({
            error: "permission_denied",
            message: "Your role cannot access named stories.",
          });
          return;
        }

        res.json({
          id: page.id,
          slug: page.slug,
          title: page.title,
          subtitle: page.subtitle,
          status: page.status,
          visibility: page.visibility,
          editable_body: page.editableBody,
          scrubbed_body: page.scrubbedBody || null,
          hero_image_url: page.heroImageUrl,
          callout_boxes: page.calloutBoxes,
          total_call_hours: page.totalCallHours,
          custom_css: page.customCss,
          view_count: page.viewCount,
          published_at: page.publishedAt,
          created_at: page.createdAt,
          account: page.story.account,
          quotes: page.story.quotes.map((q) => ({
            speaker: q.speaker,
            quote_text: q.quoteText,
            metric_type: q.metricType,
            metric_value: q.metricValue,
          })),
          edit_history: page.edits.map((e) => ({
            edited_by: e.editedBy.name ?? e.editedBy.email,
            summary: e.editSummary,
            created_at: e.createdAt,
          })),
        });
      } catch (err) {
        console.error("Get landing page error:", err);
        res.status(404).json({ error: "Landing page not found" });
      }
    }
  );

  // ── EDIT DATA (JSON for React editor page) ──────────────────────────

  router.get(
    "/:pageId/edit-data",
    requirePageOwnerOrPermission(prisma),
    async (req: AuthReq, res: Response) => {
      try {
        const page = await editor.getForEditing(req.params.pageId as string);
        if (page.includeCompanyName && !(await canAccessNamedStories(req))) {
          res.status(403).json({
            error: "permission_denied",
            message: "Your role cannot access named stories.",
          });
          return;
        }

        const canPublishNamed = await canGenerateNamedStories(req);

        res.json({
          pageId: page.id,
          title: page.title,
          subtitle: page.subtitle ?? "",
          editableBody: page.editableBody,
          status: page.status,
          visibility: page.visibility,
          includeCompanyName: page.includeCompanyName,
          canPublishNamed,
        });
      } catch (err) {
        console.error("Get editor data error:", err);
        res.status(404).json({ error: "Landing page not found" });
      }
    }
  );

  // ── PREVIEW SCRUB (compare original vs scrubbed) ───────────────────

  router.post(
    "/:pageId/preview-scrub",
    requirePageOwnerOrPermission(prisma),
    async (req: AuthReq, res: Response) => {
      try {
        const page = await editor.getForEditing(req.params.pageId as string);
        if (page.includeCompanyName && !(await canAccessNamedStories(req))) {
          res.status(403).json({
            error: "permission_denied",
            message: "Your role cannot access named stories.",
          });
          return;
        }
        const preview = await editor.getPreview(req.params.pageId as string);

        res.json({
          original: { body: page.editableBody },
          scrubbed: { body: preview.body },
          replacements_made: page.editableBody !== preview.body ? 1 : 0,
        });
      } catch (err) {
        console.error("Preview scrub error:", err);
        res.status(500).json({ error: "Failed to generate scrub preview" });
      }
    }
  );

  // ── PREVIEW (render public page from current draft) ─────────────────

  router.get(
    "/:pageId/preview",
    requirePageOwnerOrPermission(prisma),
    async (req: AuthReq, res: Response) => {
      try {
        const page = await editor.getForEditing(req.params.pageId as string);
        if (page.includeCompanyName && !(await canAccessNamedStories(req))) {
          res.status(403).json({
            error: "permission_denied",
            message: "Your role cannot access named stories.",
          });
          return;
        }
        const preview = await editor.getPreview(req.params.pageId as string);

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("X-Robots-Tag", "noindex, nofollow");
        res.setHeader("Cache-Control", "private, no-store");
        res.send(renderLandingPageHtml(preview));
      } catch (err) {
        console.error("Preview landing page error:", err);
        res.status(404).json({ error: "Landing page not found" });
      }
    }
  );

  // ── UPDATE (save edits) ─────────────────────────────────────────────

  router.patch(
    "/:pageId",
    requirePageOwnerOrPermission(prisma),
    async (req: AuthReq, res: Response) => {
      const parse = UpdatePageSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      try {
        const page = await editor.getForEditing(req.params.pageId as string);
        if (page.includeCompanyName && !(await canAccessNamedStories(req))) {
          res.status(403).json({
            error: "permission_denied",
            message: "Your role cannot access named stories.",
          });
          return;
        }

        await editor.update(req.params.pageId as string, req.userId!, {
          title: parse.data.title,
          subtitle: parse.data.subtitle,
          editableBody: parse.data.editable_body,
          heroImageUrl: parse.data.hero_image_url ?? undefined,
          calloutBoxes: parse.data.callout_boxes,
          customCss: parse.data.custom_css,
          editSummary: parse.data.edit_summary,
        });

        res.json({ updated: true });
      } catch (err) {
        console.error("Update landing page error:", err);
        res.status(500).json({ error: "Failed to update landing page" });
      }
    }
  );

  // ── PUBLISH ─────────────────────────────────────────────────────────

  router.post(
    "/:pageId/publish",
    requirePermission(prisma, "publish"),
    async (req: AuthReq, res: Response) => {
      const parse = PublishSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      try {
        if (!req.organizationId || !req.userId) {
          res.status(401).json({ error: "Authentication required" });
          return;
        }
        const page = await editor.getForEditing(req.params.pageId as string);
        if (page.includeCompanyName && !(await canGenerateNamedStories(req))) {
          res.status(403).json({
            error: "permission_denied",
            message: "Your role cannot generate named stories.",
          });
          return;
        }

        const governance = await getArtifactPublishGovernance(req.organizationId);
        if (parse.data.expires_at && governance.maxExpirationDays) {
          const expiresAt = new Date(parse.data.expires_at);
          const maxDate = new Date();
          maxDate.setDate(maxDate.getDate() + governance.maxExpirationDays);
          if (expiresAt > maxDate) {
            res.status(400).json({
              error: "expiration_limit_exceeded",
              message: `Max expiration is ${governance.maxExpirationDays} days from publish date.`,
            });
            return;
          }
        }

        if (governance.approvalChainEnabled && governance.steps.length > 0) {
          const pending = await prisma.approvalRequest.findFirst({
            where: {
              organizationId: req.organizationId,
              requestType: "LANDING_PAGE_PUBLISH",
              targetType: "landing_page",
              targetId: page.id,
              status: "PENDING",
            },
          });
          if (pending) {
            res.status(409).json({
              error: "approval_already_pending",
              request_id: pending.id,
            });
            return;
          }

          const requestPayload: PublishApprovalPayload = {
            page_id: page.id,
            options: {
              visibility: parse.data.visibility,
              password: parse.data.password,
              expires_at: parse.data.expires_at,
              release_notes: parse.data.release_notes,
            },
            steps: governance.steps,
            approvals: [],
            current_step_order: governance.steps[0]?.step_order ?? 1,
          };

          const approval = await prisma.approvalRequest.create({
            data: {
              organizationId: req.organizationId,
              requestType: "LANDING_PAGE_PUBLISH",
              targetType: "landing_page",
              targetId: page.id,
              requestedByUserId: req.userId,
              status: "PENDING",
              requestPayload: requestPayload as unknown as object,
            },
          });

          await auditLogs.record({
            organizationId: req.organizationId,
            actorUserId: req.userId,
            category: "PUBLISH",
            action: "PAGE_PUBLISH_APPROVAL_REQUESTED",
            targetType: "landing_page",
            targetId: page.id,
            severity: "INFO",
            metadata: {
              approval_request_id: approval.id,
              approval_steps: governance.steps.length,
              release_notes_present: !!parse.data.release_notes,
            },
            ipAddress: req.ip,
            userAgent: req.get("user-agent"),
          });

          res.status(202).json({
            queued_for_approval: true,
            request_id: approval.id,
            current_step_order: requestPayload.current_step_order,
          });
          return;
        }

        const result = await editor.publish(req.params.pageId as string, {
          visibility: parse.data.visibility,
          password: parse.data.password,
          expiresAt: parse.data.expires_at
            ? new Date(parse.data.expires_at)
            : undefined,
          publishedByUserId: req.userId,
          releaseNotes: parse.data.release_notes,
          provenance: {
            publish_mode: "direct",
            actor_user_id: req.userId,
            actor_user_role: req.userRole ?? null,
            governance_required_provenance: governance.requireProvenance,
            request_ip: req.ip ?? null,
          },
        });
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "PUBLISH",
          action: "PAGE_PUBLISHED",
          targetType: "landing_page",
          targetId: req.params.pageId as string,
          severity: "INFO",
          metadata: {
            visibility: parse.data.visibility,
            has_password: !!parse.data.password,
            expires_at: parse.data.expires_at ?? null,
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });

        res.json({
          published: true,
          slug: result.slug,
          url: result.url,
        });
      } catch (err) {
        if (err instanceof PublishValidationError) {
          res.status(400).json({
            error: "publish_validation_failed",
            message:
              "Publishing blocked because required content is incomplete. Fix the highlighted fields and retry.",
            issues: err.issues,
          });
          return;
        }
        if (err instanceof ScrubValidationError) {
          res.status(400).json({
            error: "scrub_validation_failed",
            message:
              "Publishing blocked because anonymization is incomplete. Remove or redact leaked identifiers and retry.",
            leaked_terms: err.leakedTerms,
          });
          return;
        }
        console.error("Publish landing page error:", err);
        res.status(500).json({ error: "Failed to publish landing page" });
      }
    }
  );

  // ── ARTIFACT VERSION HISTORY ──────────────────────────────────────

  router.get(
    "/:pageId/versions",
    requirePageOwnerOrPermission(prisma),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      try {
        const versions = await editor.listArtifactVersions(
          req.params.pageId as string,
          req.organizationId
        );
        res.json({
          versions: versions.map((v) => ({
            id: v.id,
            version_number: v.versionNumber,
            status: v.status,
            release_notes: v.releaseNotes,
            visibility: v.visibility,
            expires_at: v.expiresAt?.toISOString() ?? null,
            published_at: v.publishedAt?.toISOString() ?? null,
            created_at: v.createdAt.toISOString(),
            created_by: v.createdBy,
            provenance: v.provenance,
          })),
        });
      } catch (err) {
        console.error("List artifact versions error:", err);
        res.status(500).json({ error: "Failed to list artifact versions" });
      }
    }
  );

  router.post(
    "/:pageId/versions/:versionId/rollback",
    requirePermission(prisma, "publish"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId || !req.userId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      try {
        await editor.rollbackToVersion(
          req.params.pageId as string,
          req.params.versionId as string,
          req.userId
        );
        await auditLogs.record({
          organizationId: req.organizationId,
          actorUserId: req.userId,
          category: "PUBLISH",
          action: "PAGE_VERSION_ROLLBACK",
          targetType: "landing_page",
          targetId: req.params.pageId as string,
          severity: "WARN",
          metadata: { version_id: req.params.versionId as string },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({ rolled_back: true });
      } catch (err) {
        console.error("Rollback artifact version error:", err);
        res.status(500).json({ error: "Failed to rollback artifact version" });
      }
    }
  );

  // ── PUBLISH APPROVAL WORKFLOW ─────────────────────────────────────

  router.get(
    "/approvals/publish",
    requirePermission(prisma, "publish"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const status = typeof req.query.status === "string" ? req.query.status : "PENDING";
      try {
        const rows = await prisma.approvalRequest.findMany({
          where: {
            organizationId: req.organizationId,
            requestType: "LANDING_PAGE_PUBLISH",
            status,
          },
          include: {
            requestedBy: { select: { id: true, name: true, email: true } },
            reviewer: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 100,
        });

        res.json({
          approvals: rows.map((r) => ({
            id: r.id,
            status: r.status,
            target_id: r.targetId,
            created_at: r.createdAt.toISOString(),
            reviewed_at: r.reviewedAt?.toISOString() ?? null,
            requested_by: r.requestedBy,
            reviewer: r.reviewer,
            payload: r.requestPayload,
          })),
        });
      } catch (err) {
        console.error("List publish approvals error:", err);
        res.status(500).json({ error: "Failed to list publish approvals" });
      }
    }
  );

  router.post(
    "/approvals/publish/:requestId/review",
    requirePermission(prisma, "publish"),
    async (req: AuthReq, res: Response) => {
      const parse = ReviewPublishApprovalSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }
      if (!req.organizationId || !req.userId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        const request = await prisma.approvalRequest.findFirst({
          where: {
            id: req.params.requestId as string,
            organizationId: req.organizationId,
            requestType: "LANDING_PAGE_PUBLISH",
          },
        });
        if (!request) {
          res.status(404).json({ error: "Publish approval request not found" });
          return;
        }
        if (request.status !== "PENDING") {
          res.status(409).json({ error: "Approval request is already finalized" });
          return;
        }

        const payload = (request.requestPayload ?? {}) as unknown as PublishApprovalPayload;
        const steps = Array.isArray(payload.steps) ? payload.steps : [];
        const currentStepOrder =
          payload.current_step_order ?? steps[0]?.step_order ?? 1;
        const currentStep = steps.find((s) => s.step_order === currentStepOrder);

        if (
          currentStep &&
          !(await canUserApproveStep(req, currentStep, request.requestedByUserId))
        ) {
          res.status(403).json({
            error: "permission_denied",
            message: "You are not eligible to approve this workflow step.",
          });
          return;
        }

        if (parse.data.decision === "REJECT") {
          await prisma.approvalRequest.update({
            where: { id: request.id },
            data: {
              status: "REJECTED",
              reviewerUserId: req.userId,
              reviewNotes: parse.data.notes ?? null,
              reviewedAt: new Date(),
            },
          });
          await auditLogs.record({
            organizationId: req.organizationId,
            actorUserId: req.userId,
            category: "PUBLISH",
            action: "PAGE_PUBLISH_APPROVAL_REJECTED",
            targetType: "landing_page",
            targetId: request.targetId,
            severity: "WARN",
            metadata: { request_id: request.id },
            ipAddress: req.ip,
            userAgent: req.get("user-agent"),
          });
          res.json({ status: "REJECTED" });
          return;
        }

        const approvals = Array.isArray(payload.approvals) ? payload.approvals : [];
        const alreadyReviewedThisStep = approvals.some(
          (a) => a.step_order === currentStepOrder && a.reviewer_user_id === req.userId
        );
        if (alreadyReviewedThisStep) {
          res.status(409).json({ error: "You already approved this workflow step." });
          return;
        }

        approvals.push({
          step_order: currentStepOrder,
          reviewer_user_id: req.userId,
          reviewer_name: null,
          reviewer_email: null,
          decided_at: new Date().toISOString(),
          notes: parse.data.notes ?? null,
        });

        const approvalsForStep = approvals.filter((a) => a.step_order === currentStepOrder);
        const minApprovalsForStep = currentStep?.min_approvals ?? 1;
        const stepCompleted = approvalsForStep.length >= minApprovalsForStep;

        let nextStepOrder = currentStepOrder;
        if (stepCompleted) {
          const next = steps.find((s) => s.step_order > currentStepOrder);
          nextStepOrder = next?.step_order ?? currentStepOrder;
        }

        const readyToPublish = stepCompleted && !steps.find((s) => s.step_order > currentStepOrder);

        if (!readyToPublish) {
          const updatedPayload: PublishApprovalPayload = {
            ...payload,
            approvals,
            current_step_order: nextStepOrder,
          };
          await prisma.approvalRequest.update({
            where: { id: request.id },
            data: {
              requestPayload: updatedPayload as unknown as object,
            },
          });
          res.json({
            status: "PENDING",
            current_step_order: nextStepOrder,
          });
          return;
        }

        const publishOptions = payload.options ?? {
          visibility: "PRIVATE" as const,
        };

        const page = await editor.getForEditing(request.targetId);
        const governance = await getArtifactPublishGovernance(req.organizationId);
        if (publishOptions.expires_at && governance.maxExpirationDays) {
          const expiresAt = new Date(publishOptions.expires_at);
          const maxDate = new Date();
          maxDate.setDate(maxDate.getDate() + governance.maxExpirationDays);
          if (expiresAt > maxDate) {
            res.status(400).json({
              error: "expiration_limit_exceeded",
              message: `Max expiration is ${governance.maxExpirationDays} days from publish date.`,
            });
            return;
          }
        }
        if (page.includeCompanyName && !(await canGenerateNamedStories(req))) {
          res.status(403).json({
            error: "permission_denied",
            message: "Your role cannot generate named stories.",
          });
          return;
        }

        const result = await editor.publish(request.targetId, {
          visibility: publishOptions.visibility,
          password: publishOptions.password,
          expiresAt: publishOptions.expires_at
            ? new Date(publishOptions.expires_at)
            : undefined,
          publishedByUserId: req.userId,
          approvalRequestId: request.id,
          releaseNotes: publishOptions.release_notes,
          provenance: {
            publish_mode: "approval_chain",
            approval_request_id: request.id,
            approvals,
            finalized_by_user_id: req.userId,
            finalized_at: new Date().toISOString(),
          },
        });

        await prisma.approvalRequest.update({
          where: { id: request.id },
          data: {
            status: "APPROVED",
            reviewerUserId: req.userId,
            reviewNotes: parse.data.notes ?? null,
            reviewedAt: new Date(),
            requestPayload: {
              ...(payload as unknown as Record<string, unknown>),
              approvals,
              current_step_order: currentStepOrder,
            },
          },
        });

        await auditLogs.record({
          organizationId: req.organizationId,
          actorUserId: req.userId,
          category: "PUBLISH",
          action: "PAGE_PUBLISH_APPROVAL_APPROVED",
          targetType: "landing_page",
          targetId: request.targetId,
          severity: "INFO",
          metadata: {
            request_id: request.id,
            approval_count: approvals.length,
            published_url: result.url,
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });

        res.json({
          status: "APPROVED",
          published: true,
          url: result.url,
          slug: result.slug,
        });
      } catch (err) {
        if (err instanceof ScrubValidationError) {
          res.status(400).json({
            error: "scrub_validation_failed",
            message:
              "Publishing blocked because anonymization is incomplete. Remove or redact leaked identifiers and retry.",
            leaked_terms: err.leakedTerms,
          });
          return;
        }
        console.error("Review publish approval error:", err);
        res.status(500).json({ error: "Failed to review publish approval" });
      }
    }
  );

  // ── UNPUBLISH ───────────────────────────────────────────────────────

  router.post(
    "/:pageId/unpublish",
    requirePageOwnerOrPermission(prisma),
    async (req: AuthReq, res: Response) => {
      try {
        const page = await editor.getForEditing(req.params.pageId as string);
        if (page.includeCompanyName && !(await canAccessNamedStories(req))) {
          res.status(403).json({
            error: "permission_denied",
            message: "Your role cannot access named stories.",
          });
          return;
        }

        await editor.unpublish(req.params.pageId as string);
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "PUBLISH",
          action: "PAGE_UNPUBLISHED",
          targetType: "landing_page",
          targetId: req.params.pageId as string,
          severity: "INFO",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({ unpublished: true });
      } catch (err) {
        console.error("Unpublish error:", err);
        res.status(500).json({ error: "Failed to unpublish" });
      }
    }
  );

  // ── ARCHIVE ─────────────────────────────────────────────────────────

  router.post(
    "/:pageId/archive",
    requirePageOwnerOrPermission(prisma),
    async (req: AuthReq, res: Response) => {
      try {
        const page = await editor.getForEditing(req.params.pageId as string);
        if (page.includeCompanyName && !(await canAccessNamedStories(req))) {
          res.status(403).json({
            error: "permission_denied",
            message: "Your role cannot access named stories.",
          });
          return;
        }

        await editor.archive(req.params.pageId as string);
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "PUBLISH",
          action: "PAGE_ARCHIVED",
          targetType: "landing_page",
          targetId: req.params.pageId as string,
          severity: "INFO",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({ archived: true });
      } catch (err) {
        console.error("Archive error:", err);
        res.status(500).json({ error: "Failed to archive" });
      }
    }
  );

  // ── DELETE ──────────────────────────────────────────────────────────

  router.delete(
    "/:pageId",
    requirePermission(prisma, "delete_any"),
    async (req: AuthReq, res: Response) => {
      try {
        // SECURITY: Ensure the page belongs to the authenticated user's org
        // to prevent cross-organization deletion
        const page = await prisma.landingPage.findFirst({
          where: { id: req.params.pageId as string, organizationId: req.organizationId! },
        });
        if (!page) {
          res.status(404).json({ error: "Landing page not found" });
          return;
        }
        if (await isLegalHoldEnabled(prisma, req.organizationId!)) {
          res.status(423).json({
            error: "legal_hold_active",
            message:
              "Deletion is blocked because legal hold is enabled in your data governance policy.",
          });
          return;
        }

        await prisma.landingPage.delete({ where: { id: page.id } });
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "PUBLISH",
          action: "PAGE_DELETED",
          targetType: "landing_page",
          targetId: page.id,
          severity: "WARN",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({ deleted: true });
      } catch (err) {
        console.error("Delete landing page error:", err);
        res.status(500).json({ error: "Failed to delete landing page" });
      }
    }
  );

  return router;
}
