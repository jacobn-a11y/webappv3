/**
 * Landing Page API Routes
 *
 * CRUD + publish/share for landing pages.
 * All routes behind auth + permissions middleware.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { PrismaClient, UserRole } from "@prisma/client";
import type { OrgRequest } from "../types/authenticated-request.js";
import type { Queue } from "bullmq";
import {
  ConcurrencyConflictError,
  LandingPageEditor,
  PublishValidationError,
  ScrubValidationError,
} from "../services/landing-page-editor.js";
import type { PostPublishValidationJobData } from "../services/post-publish-validation.js";
import type { ScheduledPagePublishJobData } from "../services/scheduled-page-publish.js";
import { AccountAccessService } from "../services/account-access.js";
import { RoleProfileService } from "../services/role-profiles.js";
import { AuditLogService } from "../services/audit-log.js";
import { isLegalHoldEnabled } from "../services/data-governance.js";
import { renderLandingPageHtml } from "./public-page-renderer.js";
import { dispatchOutboundWebhookEvent } from "../services/outbound-webhooks.js";
import {
  requireLandingPagesEnabled,
  requirePermission,
  requirePageOwnerOrPermission,
} from "../middleware/permissions.js";
import {
  canAccessNamedStories,
  canGenerateNamedStories,
  canUserApproveStep,
  getArtifactPublishGovernance,
  type PublishApprovalPayload,
} from "../services/landing-page-approval.js";
import logger from "../lib/logger.js";
import { asyncHandler } from "../lib/async-handler.js";
import { sendSuccess, sendCreated, sendNoContent, sendBadRequest, sendUnauthorized, sendForbidden, sendNotFound, sendConflict, sendError, sendServiceUnavailable } from "./_shared/responses.js";

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
  expected_updated_at: z.string().datetime().optional(),
});

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

// ─── Route Factory ───────────────────────────────────────────────────────────

interface LandingPageRouteDeps {
  postPublishValidationQueue?: Queue<PostPublishValidationJobData>;
  scheduledPublishQueue?: Queue<ScheduledPagePublishJobData>;
}

export function createLandingPageRoutes(
  prisma: PrismaClient,
  deps: LandingPageRouteDeps = {}
): Router {
  const router = Router();
  const editor = new LandingPageEditor(prisma);
  const accessService = new AccountAccessService(prisma);
  const roleProfiles = new RoleProfileService(prisma);
  const auditLogs = new AuditLogService(prisma);
  const postPublishValidationQueue = deps.postPublishValidationQueue;
  const scheduledPublishQueue = deps.scheduledPublishQueue;

  async function enqueuePostPublishValidation(input: PostPublishValidationJobData) {
    if (!postPublishValidationQueue) {
      return;
    }
    try {
      await postPublishValidationQueue.add(
        `validate-page-${input.pageId}`,
        input,
        {
          attempts: 2,
          backoff: { type: "exponential", delay: 30_000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        }
      );
    } catch (err) {
      logger.error("Failed to enqueue post-publish validation job", { error: err });
    }
  }

  const scheduledPublishJobId = (pageId: string): string =>
    `scheduled-publish:${pageId}`;

  async function clearScheduledPublish(pageId: string): Promise<void> {
    if (!scheduledPublishQueue) {
      return;
    }
    const job = await scheduledPublishQueue.getJob(scheduledPublishJobId(pageId));
    if (job) {
      await job.remove();
    }
  }

  const reqParams = (req: AuthReq) => ({
    organizationId: req.organizationId,
    userId: req.userId,
    userRole: req.userRole,
  });

  router.use(requireLandingPagesEnabled(prisma));

  // ── CREATE ──────────────────────────────────────────────────────────

  router.post(
    "/",
    requirePermission(prisma, "create"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      const parse = CreatePageSchema.safeParse(req.body);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }

      const { story_id, title, subtitle, hero_image_url, callout_boxes, include_company_name } = parse.data;
      if (!req.organizationId || !req.userId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const story = await prisma.story.findFirst({
        where: { id: story_id, organizationId: req.organizationId },
        select: { id: true, accountId: true },
      });
      if (!story) {
        sendNotFound(res, "Story not found");
        return;
      }

      const canAccess = await accessService.canAccessAccount(
        req.userId,
        req.organizationId,
        story.accountId,
        req.userRole as UserRole | undefined
      );
      if (!canAccess) {
        sendForbidden(res, "You do not have access to this account.");
        return;
      }

      let namedPageAllowed = false;
      if (include_company_name === true) {
        namedPageAllowed = await canGenerateNamedStories(prisma, roleProfiles, reqParams(req));
      }

        const pageId = await editor.create({
          storyId: story_id,
          organizationId: req.organizationId,
          createdById: req.userId,
          title,
          subtitle,
          heroImageUrl: hero_image_url,
          calloutBoxes: callout_boxes,
          includeCompanyName: namedPageAllowed,
        });

        const page = await editor.getForEditing(pageId);
        await auditLogs.record({
          organizationId: req.organizationId,
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
        sendCreated(res, {
          id: page.id,
          slug: page.slug,
          title: page.title,
          status: page.status,
          editable_body: page.editableBody,
          callout_boxes: page.calloutBoxes,
          total_call_hours: page.totalCallHours,
        });
      
    }
  ));

  // ── GET (for editing — returns unscrubbed content) ──────────────────

  router.get(
    "/:pageId",
    requirePageOwnerOrPermission(prisma),
    asyncHandler(async (req: AuthReq, res: Response) => {
      try {
        const page = await editor.getForEditing(req.params.pageId as string);
        if (page.includeCompanyName && !(await canAccessNamedStories(prisma, roleProfiles, reqParams(req)))) {
          sendForbidden(res, "Your role cannot access named stories.");
          return;
        }

        sendSuccess(res, {
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
        logger.error("Get landing page error", { error: err });
        sendNotFound(res, "Landing page not found");
      }
    }
  ));

  // ── EDIT DATA (JSON for React editor page) ──────────────────────────

  router.get(
    "/:pageId/edit-data",
    requirePageOwnerOrPermission(prisma),
    asyncHandler(async (req: AuthReq, res: Response) => {
      try {
        const page = await editor.getForEditing(req.params.pageId as string);
        if (page.includeCompanyName && !(await canAccessNamedStories(prisma, roleProfiles, reqParams(req)))) {
          sendForbidden(res, "Your role cannot access named stories.");
          return;
        }

        const canPublishNamed = await canGenerateNamedStories(prisma, roleProfiles, reqParams(req));

        sendSuccess(res, {
          pageId: page.id,
          title: page.title,
          subtitle: page.subtitle ?? "",
          editableBody: page.editableBody,
          status: page.status,
          visibility: page.visibility,
          includeCompanyName: page.includeCompanyName,
          canPublishNamed,
          updatedAt: page.updatedAt.toISOString(),
        });
      } catch (err) {
        logger.error("Get editor data error", { error: err });
        sendNotFound(res, "Landing page not found");
      }
    }
  ));

  // ── PREVIEW SCRUB (compare original vs scrubbed) ───────────────────

  router.post(
    "/:pageId/preview-scrub",
    requirePageOwnerOrPermission(prisma),
    asyncHandler(async (req: AuthReq, res: Response) => {

      const page = await editor.getForEditing(req.params.pageId as string);
      if (page.includeCompanyName && !(await canAccessNamedStories(prisma, roleProfiles, reqParams(req)))) {
      sendForbidden(res, "Your role cannot access named stories.");
      return;
      }
      const preview = await editor.getPreview(req.params.pageId as string);

      sendSuccess(res, {
      original: { body: page.editableBody },
      scrubbed: { body: preview.body },
      replacements_made: page.editableBody !== preview.body ? 1 : 0,
      });
      
    }
  ));

  // ── PREVIEW (render public page from current draft) ─────────────────

  router.get(
    "/:pageId/preview",
    requirePageOwnerOrPermission(prisma),
    asyncHandler(async (req: AuthReq, res: Response) => {
      try {
        const page = await editor.getForEditing(req.params.pageId as string);
        if (page.includeCompanyName && !(await canAccessNamedStories(prisma, roleProfiles, reqParams(req)))) {
          sendForbidden(res, "Your role cannot access named stories.");
          return;
        }
        const preview = await editor.getPreview(req.params.pageId as string);

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("X-Robots-Tag", "noindex, nofollow");
        res.setHeader("Cache-Control", "private, no-store");
        res.send(renderLandingPageHtml(preview));
      } catch (err) {
        logger.error("Preview landing page error", { error: err });
        sendNotFound(res, "Landing page not found");
      }
    }
  ));

  // ── UPDATE (save edits) ─────────────────────────────────────────────

  router.patch(
    "/:pageId",
    requirePageOwnerOrPermission(prisma),
    asyncHandler(async (req: AuthReq, res: Response) => {
      const parse = UpdatePageSchema.safeParse(req.body);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }

      try {
        const page = await editor.getForEditing(req.params.pageId as string);
        if (page.includeCompanyName && !(await canAccessNamedStories(prisma, roleProfiles, reqParams(req)))) {
          sendForbidden(res, "Your role cannot access named stories.");
          return;
        }

        const updated = await editor.update(req.params.pageId as string, req.userId, {
          title: parse.data.title,
          subtitle: parse.data.subtitle,
          editableBody: parse.data.editable_body,
          heroImageUrl: parse.data.hero_image_url ?? undefined,
          calloutBoxes: parse.data.callout_boxes,
          customCss: parse.data.custom_css,
          editSummary: parse.data.edit_summary,
          expectedUpdatedAt: parse.data.expected_updated_at
            ? new Date(parse.data.expected_updated_at)
            : undefined,
        });

        sendSuccess(res, {
          updated: true,
          updated_at: updated.updatedAt.toISOString(),
        });
      } catch (err) {
        if (err instanceof ConcurrencyConflictError) {
          res.status(409).json({
            error: "concurrency_conflict",
            message:
              "This page has newer changes from another editor. Refresh or resolve the conflict before saving.",
            expected_updated_at: err.expectedUpdatedAt.toISOString(),
            current_updated_at: err.currentUpdatedAt.toISOString(),
            latest_editable_body: err.currentEditableBody,
          });
          return;
        }
        logger.error("Update landing page error", { error: err });
        sendError(res, 500, "internal_error", "Failed to update landing page");
      }
    }
  ));

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
        const request = await prisma.approvalRequest.findFirst({
          where: {
            id: req.params.requestId as string,
            organizationId: req.organizationId,
            requestType: "LANDING_PAGE_PUBLISH",
          },
        });
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
          await prisma.approvalRequest.update({
            where: { id: request.id },
            data: {
              requestPayload: updatedPayload as unknown as object,
            },
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

  // ── DELETE ──────────────────────────────────────────────────────────

  router.delete(
    "/:pageId",
    requirePermission(prisma, "delete_any"),
    asyncHandler(async (req: AuthReq, res: Response) => {

      const page = await prisma.landingPage.findFirst({
      where: { id: req.params.pageId as string, organizationId: req.organizationId },
      });
      if (!page) {
      sendNotFound(res, "Landing page not found");
      return;
      }
      if (await isLegalHoldEnabled(prisma, req.organizationId)) {
      res.status(423).json({
        error: "legal_hold_active",
        message:
          "Deletion is blocked because legal hold is enabled in your data governance policy.",
      });
      return;
      }

      await clearScheduledPublish(page.id);
      await prisma.landingPage.delete({ where: { id: page.id } });
      await auditLogs.record({
      organizationId: req.organizationId,
      actorUserId: req.userId,
      category: "PUBLISH",
      action: "PAGE_DELETED",
      targetType: "landing_page",
      targetId: page.id,
      severity: "WARN",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      });
      sendSuccess(res, { deleted: true });
      
    }
  ));

  return router;
}
