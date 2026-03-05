import type { Response } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import logger from "../../lib/logger.js";
import { canGenerateNamedStories, canUserApproveStep, getArtifactPublishGovernance, type PublishApprovalPayload } from "../../services/landing-page-approval.js";
import { dispatchOutboundWebhookEvent } from "../../services/outbound-webhooks.js";
import {
  sendBadRequest,
  sendConflict,
  sendError,
  sendForbidden,
  sendNotFound,
  sendSuccess,
  sendUnauthorized,
} from "../_shared/responses.js";
import {
  ReviewPublishApprovalSchema,
  type AuthReq,
  type PublishRouteContext,
  sendPublishError,
} from "./publish-route-context.js";

export function registerPublishApprovalRoutes(context: PublishRouteContext): void {
  const {
    router,
    prisma,
    editor,
    roleProfiles,
    auditLogs,
    clearScheduledPublish,
    enqueuePostPublishValidation,
    reqParams,
    canReviewPublishApprovals,
  } = context;

  router.get(
    "/approvals/publish",
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!req.organizationId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }
      if (!(await canReviewPublishApprovals(req))) {
        sendForbidden(res, "permission_denied");
        return;
      }

      const status = typeof req.query.status === "string" ? req.query.status : "PENDING";
      const rows = await editor.listPublishApprovalRequests(req.organizationId!, status);

      sendSuccess(res, {
        approvals: rows.map((row) => ({
          id: row.id,
          status: row.status,
          target_id: row.targetId,
          created_at: row.createdAt.toISOString(),
          reviewed_at: row.reviewedAt?.toISOString() ?? null,
          requested_by: row.requestedBy,
          reviewer: row.reviewer,
          payload: row.requestPayload,
        })),
      });
    })
  );

  router.post(
    "/approvals/publish/:requestId/review",
    asyncHandler(async (req: AuthReq, res: Response) => {
      const parse = ReviewPublishApprovalSchema.safeParse(req.body);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }
      if (!req.organizationId! || !req.userId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }
      if (!(await canReviewPublishApprovals(req))) {
        sendForbidden(res, "permission_denied");
        return;
      }

      try {
        const request = await editor.findPublishApprovalRequest(
          req.params.requestId as string,
          req.organizationId!
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
        const currentStepOrder = payload.current_step_order ?? steps[0]?.step_order ?? 1;
        const currentStep = steps.find((step) => step.step_order === currentStepOrder);

        if (
          currentStep &&
          !(await canUserApproveStep(
            prisma,
            reqParams(req),
            currentStep,
            request.requestedByUserId
          ))
        ) {
          sendForbidden(res, "You are not eligible to approve this workflow step.");
          return;
        }

        if (parse.data.decision === "REJECT") {
          await editor.updateApprovalRequest(request.id, {
            status: "REJECTED",
            reviewerUserId: req.userId!,
            reviewNotes: parse.data.notes ?? null,
            reviewedAt: new Date(),
          });
          await auditLogs.record({
            organizationId: req.organizationId!,
            actorUserId: req.userId!,
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
          (approval) =>
            approval.step_order === currentStepOrder && approval.reviewer_user_id === req.userId!
        );
        if (alreadyReviewedThisStep) {
          sendConflict(res, "You already approved this workflow step.");
          return;
        }

        approvals.push({
          step_order: currentStepOrder,
          reviewer_user_id: req.userId!,
          reviewer_name: null,
          reviewer_email: null,
          decided_at: new Date().toISOString(),
          notes: parse.data.notes ?? null,
        });

        const approvalsForStep = approvals.filter((approval) => approval.step_order === currentStepOrder);
        const minApprovalsForStep = currentStep?.min_approvals ?? 1;
        const stepCompleted = approvalsForStep.length >= minApprovalsForStep;

        let nextStepOrder = currentStepOrder;
        if (stepCompleted) {
          const next = steps.find((step) => step.step_order > currentStepOrder);
          nextStepOrder = next?.step_order ?? currentStepOrder;
        }

        const readyToPublish = stepCompleted && !steps.find((step) => step.step_order > currentStepOrder);
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
        const governance = await getArtifactPublishGovernance(prisma, req.organizationId!);
        if (publishOptions.expires_at && governance.maxExpirationDays) {
          const expiresAt = new Date(publishOptions.expires_at);
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
        if (
          page.includeCompanyName &&
          !(await canGenerateNamedStories(prisma, roleProfiles, reqParams(req)))
        ) {
          sendForbidden(res, "Your role cannot generate named stories.");
          return;
        }

        const result = await editor.publish(request.targetId, {
          visibility: publishOptions.visibility,
          password: publishOptions.password,
          expiresAt: publishOptions.expires_at ? new Date(publishOptions.expires_at) : undefined,
          publishedByUserId: req.userId!,
          approvalRequestId: request.id,
          releaseNotes: publishOptions.release_notes,
          provenance: {
            publish_mode: "approval_chain",
            approval_request_id: request.id,
            approvals,
            finalized_by_user_id: req.userId!,
            finalized_at: new Date().toISOString(),
          },
        });
        await clearScheduledPublish(request.targetId);

        await editor.updateApprovalRequest(request.id, {
          status: "APPROVED",
          reviewerUserId: req.userId!,
          reviewNotes: parse.data.notes ?? null,
          reviewedAt: new Date(),
          requestPayload: {
            ...(payload as unknown as Record<string, unknown>),
            approvals,
            current_step_order: currentStepOrder,
          },
        });

        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId!,
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
          organizationId: req.organizationId!,
          pageId: request.targetId,
          publishedByUserId: req.userId!,
        });

        await dispatchOutboundWebhookEvent(prisma, {
          organizationId: req.organizationId!,
          eventType: "landing_page_published",
          payload: {
            page_id: request.targetId,
            slug: result.slug,
            url: result.url,
            published_by_user_id: req.userId!,
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
        if (sendPublishError(err, res)) {
          return;
        }
        logger.error("Review publish approval error", { error: err });
        sendError(res, 500, "internal_error", "Failed to review publish approval");
      }
    })
  );
}
