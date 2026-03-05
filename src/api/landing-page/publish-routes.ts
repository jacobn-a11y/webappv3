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

import { type Response } from "express";
import { dispatchOutboundWebhookEvent } from "../../services/outbound-webhooks.js";
import { PublishApprovalPolicyService } from "../../services/publish-approval-policy.js";
import { requirePermission, requirePageOwnerOrPermission } from "../../middleware/permissions.js";
import {
  canAccessNamedStories,
  getArtifactPublishGovernance,
  type PublishApprovalPayload,
} from "../../services/landing-page-approval.js";
import { SlackApprovalNotifier } from "../../services/slack-approval-notifier.js";
import logger from "../../lib/logger.js";
import { asyncHandler } from "../../lib/async-handler.js";
import {
  sendSuccess,
  sendBadRequest,
  sendUnauthorized,
  sendForbidden,
  sendError,
} from "../_shared/responses.js";
import {
  PublishSchema,
  type RegisterPublishRoutesOptions,
  type AuthReq,
  sendPublishError,
} from "./publish-route-context.js";
import { registerScheduledPublishRoutes } from "./publish-routes-scheduled.js";
import { registerPublishApprovalRoutes } from "./publish-routes-approvals.js";

export function registerPublishRoutes(options: RegisterPublishRoutesOptions): void {
  const {
    router,
    prisma,
    editor,
    roleProfiles,
    auditLogs,
    clearScheduledPublish,
    enqueuePostPublishValidation,
    reqParams,
  } = options;

  const approvalPolicy = new PublishApprovalPolicyService(prisma);
  const slackNotifier = new SlackApprovalNotifier(prisma);

  const canReviewPublishApprovals = async (req: AuthReq): Promise<boolean> => {
    if (!req.organizationId! || !req.userId!) {
      return false;
    }
    if (req.userRole && ["OWNER", "ADMIN"].includes(req.userRole)) {
      return true;
    }

    const rolePolicy = await roleProfiles.getEffectivePolicy(req.organizationId!, req.userId!, req.userRole);
    if (rolePolicy.permissions.includes("APPROVE_PUBLISH_REQUESTS")) {
      return true;
    }

    const granted = await prisma.userPermission.findUnique({
      where: {
        userId_permission: {
          userId: req.userId!,
          permission: "APPROVE_PUBLISH_REQUESTS",
        },
      },
    });
    return !!granted;
  };

  const context = {
    ...options,
    approvalPolicy,
    slackNotifier,
    canReviewPublishApprovals,
  };

  registerScheduledPublishRoutes(context);

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
        if (!req.organizationId! || !req.userId!) {
          sendUnauthorized(res, "Authentication required");
          return;
        }

        const page = await editor.getForEditing(req.params.pageId as string);
        const rolePolicy = await roleProfiles.getEffectivePolicy(req.organizationId!, req.userId!, req.userRole);
        const canGenerateForMode = page.includeCompanyName
          ? rolePolicy.canGenerateNamedStories
          : rolePolicy.canGenerateAnonymousStories;
        if (!canGenerateForMode) {
          sendForbidden(
            res,
            page.includeCompanyName
              ? "Your role cannot generate named stories."
              : "Your role cannot generate anonymous stories."
          );
          return;
        }

        const governance = await getArtifactPublishGovernance(prisma, req.organizationId!);
        if (parse.data.expires_at && governance.maxExpirationDays) {
          const expiresAt = new Date(parse.data.expires_at);
          const maxDate = new Date();
          maxDate.setDate(maxDate.getDate() + governance.maxExpirationDays);
          if (expiresAt > maxDate) {
            sendBadRequest(
              res,
              `Max expiration is ${governance.maxExpirationDays} days from publish date.`
            );
            return;
          }
        }

        const publishPolicyDecision = await approvalPolicy.requiresApproval(
          req.organizationId!,
          page.includeCompanyName
        );

        if (publishPolicyDecision.required) {
          const pending = await editor.findPendingPublishApproval(req.organizationId!, page.id);
          if (pending) {
            res.status(409).json({
              error: "approval_already_pending",
              request_id: pending.id,
            });
            return;
          }

          const requestPayload: PublishApprovalPayload & {
            asset_type: "landing_page";
            approval_policy: string;
          } = {
            asset_type: "landing_page",
            page_id: page.id,
            options: {
              visibility: parse.data.visibility,
              password: parse.data.password,
              expires_at: parse.data.expires_at,
              release_notes: parse.data.release_notes,
            },
            steps: [],
            approvals: [],
            current_step_order: 1,
            approval_policy: publishPolicyDecision.approvalPolicy,
          };

          const approval = await editor.createPublishApprovalRequest({
            organizationId: req.organizationId!,
            targetId: page.id,
            requestedByUserId: req.userId!,
            targetType: "landing_page",
            requestType: "LANDING_PAGE_PUBLISH",
            requestPayload: requestPayload as unknown as Record<string, unknown>,
          });

          await slackNotifier
            .notifyApprovalRequested({
              organizationId: req.organizationId!,
              requestId: approval.id,
              title: page.title,
              accountName: page.story.account.name,
              requestedByLabel: req.userId!,
              reviewUrl: `${process.env.APP_URL ?? process.env.FRONTEND_URL ?? ""}/admin/publish-approvals`,
              assetType: "landing_page",
            })
            .catch(() => {});

          await auditLogs.record({
            organizationId: req.organizationId!,
            actorUserId: req.userId!,
            category: "PUBLISH",
            action: "PAGE_PUBLISH_APPROVAL_REQUESTED",
            targetType: "landing_page",
            targetId: page.id,
            severity: "INFO",
            metadata: {
              approval_request_id: approval.id,
              approval_steps: 1,
              approval_policy: publishPolicyDecision.approvalPolicy,
              release_notes_present: !!parse.data.release_notes,
            },
            ipAddress: req.ip,
            userAgent: req.get("user-agent"),
          });

          res.status(202).json({
            queued_for_approval: true,
            request_id: approval.id,
            current_step_order: 1,
            approval_policy: publishPolicyDecision.approvalPolicy,
          });
          return;
        }

        const result = await editor.publish(req.params.pageId as string, {
          visibility: parse.data.visibility,
          password: parse.data.password,
          expiresAt: parse.data.expires_at ? new Date(parse.data.expires_at) : undefined,
          publishedByUserId: req.userId!,
          releaseNotes: parse.data.release_notes,
          provenance: {
            publish_mode: "direct",
            actor_user_id: req.userId!,
            actor_user_role: req.userRole ?? null,
            approval_policy: publishPolicyDecision.approvalPolicy,
            governance_required_provenance: governance.requireProvenance,
            request_ip: req.ip ?? null,
          },
        });

        await clearScheduledPublish(req.params.pageId as string);
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId!,
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
          organizationId: req.organizationId!,
          pageId: req.params.pageId as string,
          publishedByUserId: req.userId!,
        });

        await dispatchOutboundWebhookEvent(prisma, {
          organizationId: req.organizationId!,
          eventType: "landing_page_published",
          payload: {
            page_id: req.params.pageId as string,
            slug: result.slug,
            url: result.url,
            published_by_user_id: req.userId!,
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
        if (sendPublishError(err, res)) {
          return;
        }
        logger.error("Publish landing page error", { error: err });
        sendError(res, 500, "internal_error", "Failed to publish landing page");
      }
    })
  );

  // ── ARTIFACT VERSION HISTORY ──────────────────────────────────────

  router.get(
    "/:pageId/versions",
    requirePageOwnerOrPermission(prisma),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!req.organizationId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const versions = await editor.listArtifactVersions(req.params.pageId as string, req.organizationId!);
      sendSuccess(res, {
        versions: versions.map((version) => ({
          id: version.id,
          version_number: version.versionNumber,
          status: version.status,
          release_notes: version.releaseNotes,
          visibility: version.visibility,
          expires_at: version.expiresAt?.toISOString() ?? null,
          published_at: version.publishedAt?.toISOString() ?? null,
          created_at: version.createdAt.toISOString(),
          created_by: version.createdBy,
          provenance: version.provenance,
        })),
      });
    })
  );

  router.post(
    "/:pageId/versions/:versionId/rollback",
    requirePermission(prisma, "publish"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!req.organizationId! || !req.userId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      await editor.rollbackToVersion(req.params.pageId as string, req.params.versionId as string, req.userId!);
      await auditLogs.record({
        organizationId: req.organizationId!,
        actorUserId: req.userId!,
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
    })
  );

  // ── UNPUBLISH ───────────────────────────────────────────────────────

  router.post(
    "/:pageId/unpublish",
    requirePageOwnerOrPermission(prisma),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!req.organizationId! || !req.userId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const page = await editor.getForEditing(req.params.pageId as string);
      if (page.includeCompanyName && !(await canAccessNamedStories(prisma, roleProfiles, reqParams(req)))) {
        sendForbidden(res, "Your role cannot access named stories.");
        return;
      }

      await editor.unpublish(req.params.pageId as string);
      await clearScheduledPublish(req.params.pageId as string);
      await auditLogs.record({
        organizationId: req.organizationId!,
        actorUserId: req.userId!,
        category: "PUBLISH",
        action: "PAGE_UNPUBLISHED",
        targetType: "landing_page",
        targetId: req.params.pageId as string,
        severity: "INFO",
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
      sendSuccess(res, { unpublished: true });
    })
  );

  // ── ARCHIVE ─────────────────────────────────────────────────────────

  router.post(
    "/:pageId/archive",
    requirePageOwnerOrPermission(prisma),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!req.organizationId! || !req.userId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const page = await editor.getForEditing(req.params.pageId as string);
      if (page.includeCompanyName && !(await canAccessNamedStories(prisma, roleProfiles, reqParams(req)))) {
        sendForbidden(res, "Your role cannot access named stories.");
        return;
      }

      await editor.archive(req.params.pageId as string);
      await clearScheduledPublish(req.params.pageId as string);
      await auditLogs.record({
        organizationId: req.organizationId!,
        actorUserId: req.userId!,
        category: "PUBLISH",
        action: "PAGE_ARCHIVED",
        targetType: "landing_page",
        targetId: req.params.pageId as string,
        severity: "INFO",
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
      sendSuccess(res, { archived: true });
    })
  );

  registerPublishApprovalRoutes(context);
}
