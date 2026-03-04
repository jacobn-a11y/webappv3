/**
 * Landing Page Publish Routes
 *
 * POST /:pageId/publish     — Publish a landing page
 * POST /:pageId/unpublish   — Unpublish a landing page
 * POST /:pageId/archive     — Archive a landing page
 * GET /:pageId/versions     — List artifact versions
 * POST /:pageId/versions/:versionId/rollback — Rollback to a version
 * GET /:pageId/scheduled-publish    — Get scheduled publish status
 * POST /:pageId/schedule-publish    — Schedule a publish
 * DELETE /:pageId/scheduled-publish — Cancel a scheduled publish
 * GET /approvals/publish            — List publish approval requests
 * POST /approvals/publish/:requestId/review — Review a publish approval
 */

import { type Response, type Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { OrgRequest } from "../../types/authenticated-request.js";
import type { Queue } from "bullmq";
import {
  type LandingPageEditor,
  PublishValidationError,
  ScrubValidationError,
} from "../../services/landing-page-editor.js";
import type { PostPublishValidationJobData } from "../../services/post-publish-validation.js";
import type { ScheduledPagePublishJobData } from "../../services/scheduled-page-publish.js";
import type { RoleProfileService } from "../../services/role-profiles.js";
import type { AuditLogService } from "../../services/audit-log.js";
import { dispatchOutboundWebhookEvent } from "../../services/outbound-webhooks.js";
import {
  requirePermission,
  requirePageOwnerOrPermission,
} from "../../middleware/permissions.js";
import {
  canAccessNamedStories,
  canGenerateNamedStories,
  canUserApproveStep,
  getArtifactPublishGovernance,
  type PublishApprovalPayload,
} from "../../services/landing-page-approval.js";
import logger from "../../lib/logger.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { sendSuccess, sendNoContent, sendBadRequest, sendUnauthorized, sendForbidden, sendNotFound, sendConflict, sendError, sendServiceUnavailable } from "../_shared/responses.js";

// ─── Validation ──────────────────────────────────────────────────────────────

const PublishSchema = z.object({
  visibility: z.enum(["PRIVATE", "SHARED_WITH_LINK"]),
  password: z.string().min(4).max(100).optional(),
  expires_at: z.string().datetime().optional(),
  release_notes: z.string().max(1000).optional(),
});

const SchedulePublishSchema = PublishSchema.extend({
  publish_at: z.string().datetime(),
});

const ReviewPublishApprovalSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  notes: z.string().max(1000).optional(),
});

type AuthReq = OrgRequest;

// ─── Route Registration ─────────────────────────────────────────────────────

interface RegisterPublishRoutesOptions {
  router: Router;
  prisma: PrismaClient;
  editor: LandingPageEditor;
  roleProfiles: RoleProfileService;
  auditLogs: AuditLogService;
  postPublishValidationQueue?: Queue<PostPublishValidationJobData>;
  scheduledPublishQueue?: Queue<ScheduledPagePublishJobData>;
  enqueuePostPublishValidation: (input: PostPublishValidationJobData) => Promise<void>;
  clearScheduledPublish: (pageId: string) => Promise<void>;
  scheduledPublishJobId: (pageId: string) => string;
  reqParams: (req: AuthReq) => {
    organizationId: string;
    userId: string;
    userRole: string;
  };
}

export function registerPublishRoutes({
  router,
  prisma,
  editor,
  roleProfiles,
  auditLogs,
  scheduledPublishQueue,
  enqueuePostPublishValidation,
  clearScheduledPublish,
  scheduledPublishJobId,
  reqParams,
}: RegisterPublishRoutesOptions): void {
  // ── SCHEDULED PUBLISH CONTROLS ─────────────────────────────────────

  router.get(
    "/:pageId/scheduled-publish",
    requirePermission(prisma, "publish"),
    requirePageOwnerOrPermission(prisma),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!scheduledPublishQueue) {
        sendSuccess(res, { enabled: false, scheduled: false });
        return;
      }

      const pageId = String(req.params.pageId);
      const job = await scheduledPublishQueue.getJob(scheduledPublishJobId(pageId));
      if (!job) {
      sendSuccess(res, { enabled: true, scheduled: false });
      return;
      }
      const state = await job.getState();
      if (state === "completed" || state === "failed") {
      await job.remove();
      sendSuccess(res, { enabled: true, scheduled: false });
      return;
      }
      if (job.data.organizationId !== req.organizationId) {
      sendForbidden(res, "permission_denied");
      return;
      }
      sendSuccess(res, {
      enabled: true,
      scheduled: true,
      job_id: job.id,
      state,
      publish_at: job.data.publishAt,
      visibility: job.data.visibility,
      expires_at: job.data.expiresAt ?? null,
      });

    }
  ));

  router.post(
    "/:pageId/schedule-publish",
    requirePermission(prisma, "publish"),
    requirePageOwnerOrPermission(prisma),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!scheduledPublishQueue) {
        sendServiceUnavailable(res, "scheduling_unavailable");
        return;
      }
      const parse = SchedulePublishSchema.safeParse(req.body);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }

      if (!req.organizationId || !req.userId) {
      sendUnauthorized(res, "Authentication required");
      return;
      }
      const page = await editor.getForEditing(req.params.pageId as string);
      if (page.includeCompanyName && !(await canGenerateNamedStories(prisma, roleProfiles, reqParams(req)))) {
      sendForbidden(res, "Your role cannot generate named stories.");
      return;
      }
      const governance = await getArtifactPublishGovernance(prisma, req.organizationId);
      if (governance.approvalChainEnabled && governance.steps.length > 0) {
      sendConflict(res, "Scheduled publish requires direct publish mode. Disable approval chain or publish through approvals.");
      return;
      }
      const publishAt = new Date(parse.data.publish_at);
      const now = Date.now();
      const delayMs = publishAt.getTime() - now;
      if (delayMs < 15_000) {
      sendBadRequest(res, "Choose a publish time at least 15 seconds in the future.");
      return;
      }
      await clearScheduledPublish(page.id);
      await scheduledPublishQueue.add(
      "scheduled-page-publish",
      {
        pageId: page.id,
        organizationId: req.organizationId,
        userId: req.userId,
        publishAt: publishAt.toISOString(),
        visibility: parse.data.visibility,
        password: parse.data.password,
        expiresAt: parse.data.expires_at,
        releaseNotes: parse.data.release_notes,
      },
      {
        jobId: scheduledPublishJobId(page.id),
        delay: delayMs,
        attempts: 2,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      }
      );
      await auditLogs.record({
      organizationId: req.organizationId,
      actorUserId: req.userId,
      category: "PUBLISH",
      action: "PAGE_PUBLISH_SCHEDULED",
      targetType: "landing_page",
      targetId: page.id,
      severity: "INFO",
      metadata: {
        publish_at: publishAt.toISOString(),
        visibility: parse.data.visibility,
      },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      });
      res.status(202).json({
      scheduled: true,
      publish_at: publishAt.toISOString(),
      });

    }
  ));

  router.delete(
    "/:pageId/scheduled-publish",
    requirePermission(prisma, "publish"),
    requirePageOwnerOrPermission(prisma),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!scheduledPublishQueue) {
        sendNoContent(res);
        return;
      }

      const pageId = String(req.params.pageId);
      await clearScheduledPublish(pageId);
      sendNoContent(res);

    }
  ));

  // ── PUBLISH ─────────────────────────────────────────────────────────

  router.post(
    "/:pageId/publish",
    requirePermission(prisma, "publish"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      const parse = PublishSchema.safeParse(req.body);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }

      try {
        if (!req.organizationId || !req.userId) {
          sendUnauthorized(res, "Authentication required");
          return;
        }
        const page = await editor.getForEditing(req.params.pageId as string);
        if (page.includeCompanyName && !(await canGenerateNamedStories(prisma, roleProfiles, reqParams(req)))) {
          sendForbidden(res, "Your role cannot generate named stories.");
          return;
        }

        const governance = await getArtifactPublishGovernance(prisma, req.organizationId);
        if (parse.data.expires_at && governance.maxExpirationDays) {
          const expiresAt = new Date(parse.data.expires_at);
          const maxDate = new Date();
          maxDate.setDate(maxDate.getDate() + governance.maxExpirationDays);
          if (expiresAt > maxDate) {
            sendBadRequest(res, `Max expiration is ${governance.maxExpirationDays} days from publish date.`);
            return;
          }
        }

        if (governance.approvalChainEnabled && governance.steps.length > 0) {
          const pending = await editor.findPendingPublishApproval(req.organizationId, page.id);
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

          const approval = await editor.createPublishApprovalRequest({
            organizationId: req.organizationId,
            targetId: page.id,
            requestedByUserId: req.userId,
            requestPayload: requestPayload as unknown as Record<string, unknown>,
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
        await clearScheduledPublish(req.params.pageId as string);
        await auditLogs.record({
          organizationId: req.organizationId,
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
        await enqueuePostPublishValidation({
          organizationId: req.organizationId,
          pageId: req.params.pageId as string,
          publishedByUserId: req.userId,
        });
        await dispatchOutboundWebhookEvent(prisma, {
          organizationId: req.organizationId,
          eventType: "landing_page_published",
          payload: {
            page_id: req.params.pageId as string,
            slug: result.slug,
            url: result.url,
            published_by_user_id: req.userId,
          },
        }).catch((err) => {
          logger.error("Outbound webhook dispatch failed", { error: err });
        });

        sendSuccess(res, {
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
        logger.error("Publish landing page error", { error: err });
        sendError(res, 500, "internal_error", "Failed to publish landing page");
      }
    }
  ));

  // ── ARTIFACT VERSION HISTORY ──────────────────────────────────────

  router.get(
    "/:pageId/versions",
    requirePageOwnerOrPermission(prisma),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const versions = await editor.listArtifactVersions(
      req.params.pageId as string,
      req.organizationId
      );
      sendSuccess(res, {
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

    }
  ));

  router.post(
    "/:pageId/versions/:versionId/rollback",
    requirePermission(prisma, "publish"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!req.organizationId || !req.userId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

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
      sendSuccess(res, { rolled_back: true });

    }
  ));

  // ── UNPUBLISH ───────────────────────────────────────────────────────

  router.post(
    "/:pageId/unpublish",
    requirePageOwnerOrPermission(prisma),
    asyncHandler(async (req: AuthReq, res: Response) => {

      const page = await editor.getForEditing(req.params.pageId as string);
      if (page.includeCompanyName && !(await canAccessNamedStories(prisma, roleProfiles, reqParams(req)))) {
      sendForbidden(res, "Your role cannot access named stories.");
      return;
      }

      await editor.unpublish(req.params.pageId as string);
      await clearScheduledPublish(req.params.pageId as string);
      await auditLogs.record({
      organizationId: req.organizationId,
      actorUserId: req.userId,
      category: "PUBLISH",
      action: "PAGE_UNPUBLISHED",
      targetType: "landing_page",
      targetId: req.params.pageId as string,
      severity: "INFO",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      });
      sendSuccess(res, { unpublished: true });

    }
  ));

  // ── ARCHIVE ─────────────────────────────────────────────────────────

  router.post(
    "/:pageId/archive",
    requirePageOwnerOrPermission(prisma),
    asyncHandler(async (req: AuthReq, res: Response) => {

      const page = await editor.getForEditing(req.params.pageId as string);
      if (page.includeCompanyName && !(await canAccessNamedStories(prisma, roleProfiles, reqParams(req)))) {
      sendForbidden(res, "Your role cannot access named stories.");
      return;
      }

      await editor.archive(req.params.pageId as string);
      await clearScheduledPublish(req.params.pageId as string);
      await auditLogs.record({
      organizationId: req.organizationId,
      actorUserId: req.userId,
      category: "PUBLISH",
      action: "PAGE_ARCHIVED",
      targetType: "landing_page",
      targetId: req.params.pageId as string,
      severity: "INFO",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      });
      sendSuccess(res, { archived: true });

    }
  ));

  // ── PUBLISH APPROVAL WORKFLOW ─────────────────────────────────────

  router.get(
    "/approvals/publish",
    requirePermission(prisma, "publish"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const status = typeof req.query.status === "string" ? req.query.status : "PENDING";

      const rows = await editor.listPublishApprovalRequests(req.organizationId, status);

      sendSuccess(res, {
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

    }
  ));

  router.post(
    "/approvals/publish/:requestId/review",
    requirePermission(prisma, "publish"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      const parse = ReviewPublishApprovalSchema.safeParse(req.body);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }
      if (!req.organizationId || !req.userId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      try {
        const request = await editor.findPublishApprovalRequest(
          req.params.requestId as string,
          req.organizationId
        );
        if (!request) {
          sendNotFound(res, "Publish approval request not found");
          return;
        }
        if (request.status !== "PENDING") {
          sendConflict(res, "Approval request is already finalized");
          return;
        }

        const payload = (request.requestPayload ?? {}) as unknown as PublishApprovalPayload;
        const steps = Array.isArray(payload.steps) ? payload.steps : [];
        const currentStepOrder =
          payload.current_step_order ?? steps[0]?.step_order ?? 1;
        const currentStep = steps.find((s) => s.step_order === currentStepOrder);

        if (
          currentStep &&
          !(await canUserApproveStep(prisma, reqParams(req), currentStep, request.requestedByUserId))
        ) {
          sendForbidden(res, "You are not eligible to approve this workflow step.");
          return;
        }

        if (parse.data.decision === "REJECT") {
          await editor.updateApprovalRequest(request.id, {
            status: "REJECTED",
            reviewerUserId: req.userId,
            reviewNotes: parse.data.notes ?? null,
            reviewedAt: new Date(),
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
          sendSuccess(res, { status: "REJECTED" });
          return;
        }

        const approvals = Array.isArray(payload.approvals) ? payload.approvals : [];
        const alreadyReviewedThisStep = approvals.some(
          (a) => a.step_order === currentStepOrder && a.reviewer_user_id === req.userId
        );
        if (alreadyReviewedThisStep) {
          sendConflict(res, "You already approved this workflow step.");
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
          await editor.updateApprovalRequest(request.id, {
            requestPayload: updatedPayload as unknown as Record<string, unknown>,
          });
          sendSuccess(res, {
            status: "PENDING",
            current_step_order: nextStepOrder,
          });
          return;
        }

        const publishOptions = payload.options ?? {
          visibility: "PRIVATE" as const,
        };

        const page = await editor.getForEditing(request.targetId);
        const governance = await getArtifactPublishGovernance(prisma, req.organizationId);
        if (publishOptions.expires_at && governance.maxExpirationDays) {
          const expiresAt = new Date(publishOptions.expires_at);
          const maxDate = new Date();
          maxDate.setDate(maxDate.getDate() + governance.maxExpirationDays);
          if (expiresAt > maxDate) {
            sendBadRequest(res, `Max expiration is ${governance.maxExpirationDays} days from publish date.`);
            return;
          }
        }
        if (page.includeCompanyName && !(await canGenerateNamedStories(prisma, roleProfiles, reqParams(req)))) {
          sendForbidden(res, "Your role cannot generate named stories.");
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
        await clearScheduledPublish(request.targetId);

        await editor.updateApprovalRequest(request.id, {
          status: "APPROVED",
          reviewerUserId: req.userId,
          reviewNotes: parse.data.notes ?? null,
          reviewedAt: new Date(),
          requestPayload: {
            ...(payload as unknown as Record<string, unknown>),
            approvals,
            current_step_order: currentStepOrder,
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
        await enqueuePostPublishValidation({
          organizationId: req.organizationId,
          pageId: request.targetId,
          publishedByUserId: req.userId,
        });
        await dispatchOutboundWebhookEvent(prisma, {
          organizationId: req.organizationId,
          eventType: "landing_page_published",
          payload: {
            page_id: request.targetId,
            slug: result.slug,
            url: result.url,
            published_by_user_id: req.userId,
            approval_request_id: request.id,
          },
        }).catch((err) => {
          logger.error("Outbound webhook dispatch failed", { error: err });
        });

        sendSuccess(res, {
          status: "APPROVED",
          published: true,
          url: result.url,
          slug: result.slug,
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
        logger.error("Review publish approval error", { error: err });
        sendError(res, 500, "internal_error", "Failed to review publish approval");
      }
    }
  ));
}
