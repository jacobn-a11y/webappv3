/**
 * Landing Page CRUD Routes
 *
 * POST /           — Create a new landing page
 * GET /:pageId     — Get landing page for editing
 * GET /:pageId/edit-data — JSON for React editor page
 * PATCH /:pageId   — Update/save edits
 * DELETE /:pageId  — Delete a landing page
 */

import { type Response, type Router } from "express";
import { z } from "zod";
import type { PrismaClient, UserRole } from "@prisma/client";
import type { AuthenticatedRequest } from "../../types/authenticated-request.js";
import {
  ConcurrencyConflictError,
  type LandingPageEditor,
} from "../../services/landing-page-editor.js";
import type { AccountAccessService } from "../../services/account-access.js";
import type { RoleProfileService } from "../../services/role-profiles.js";
import type { AuditLogService } from "../../services/audit-log.js";
import { isLegalHoldEnabled } from "../../services/data-governance.js";
import {
  requirePermission,
  requirePageOwnerOrPermission,
} from "../../middleware/permissions.js";
import {
  canAccessNamedStories,
  canGenerateNamedStories,
} from "../../services/landing-page-approval.js";
import logger from "../../lib/logger.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { sendSuccess, sendCreated, sendBadRequest, sendUnauthorized, sendForbidden, sendNotFound, sendError } from "../_shared/responses.js";

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

type AuthReq = AuthenticatedRequest;

// ─── Route Registration ─────────────────────────────────────────────────────

interface RegisterCrudRoutesOptions {
  router: Router;
  prisma: PrismaClient;
  editor: LandingPageEditor;
  accessService: AccountAccessService;
  roleProfiles: RoleProfileService;
  auditLogs: AuditLogService;
  clearScheduledPublish: (pageId: string) => Promise<void>;
  reqParams: (req: AuthReq) => {
    organizationId: string;
    userId: string;
    userRole: string;
  };
}

export function registerCrudRoutes({
  router,
  prisma,
  editor,
  accessService,
  roleProfiles,
  auditLogs,
  clearScheduledPublish,
  reqParams,
}: RegisterCrudRoutesOptions): void {
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
      if (!req.organizationId! || !req.userId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const story = await editor.findStoryForOrg(story_id, req.organizationId!);
      if (!story) {
        sendNotFound(res, "Story not found");
        return;
      }

      const canAccess = await accessService.canAccessAccount(
        req.userId!,
        req.organizationId!,
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
          actorUserId: req.userId!,
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

  // ── UPDATE (save edits) ─────────────────────────────────────────────

  router.patch(
    "/:pageId",
    requirePageOwnerOrPermission(prisma),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!req.organizationId! || !req.userId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }
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

        const updated = await editor.update(req.params.pageId as string, req.userId!, {
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

  // ── DELETE ──────────────────────────────────────────────────────────

  router.delete(
    "/:pageId",
    requirePermission(prisma, "delete_any"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!req.organizationId! || !req.userId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const page = await editor.findPageForOrg(req.params.pageId as string, req.organizationId!);
      if (!page) {
      sendNotFound(res, "Landing page not found");
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

      await clearScheduledPublish(page.id);
      await editor.deletePage(page.id);
      await auditLogs.record({
      organizationId: req.organizationId!,
      actorUserId: req.userId!,
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
}
