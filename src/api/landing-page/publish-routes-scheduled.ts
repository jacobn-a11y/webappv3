import type { Response } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { requirePermission, requirePageOwnerOrPermission } from "../../middleware/permissions.js";
import { canGenerateNamedStories } from "../../services/landing-page-approval.js";
import {
  sendBadRequest,
  sendConflict,
  sendForbidden,
  sendNoContent,
  sendServiceUnavailable,
  sendSuccess,
  sendUnauthorized,
} from "../_shared/responses.js";
import { SchedulePublishSchema, type AuthReq, type PublishRouteContext } from "./publish-route-context.js";

export function registerScheduledPublishRoutes(context: PublishRouteContext): void {
  const {
    router,
    prisma,
    editor,
    roleProfiles,
    approvalPolicy,
    scheduledPublishQueue,
    clearScheduledPublish,
    scheduledPublishJobId,
    auditLogs,
    reqParams,
  } = context;

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

      if (job.data.organizationId !== req.organizationId!) {
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
    })
  );

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

      if (!req.organizationId! || !req.userId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const page = await editor.getForEditing(req.params.pageId as string);
      if (page.includeCompanyName && !(await canGenerateNamedStories(prisma, roleProfiles, reqParams(req)))) {
        sendForbidden(res, "Your role cannot generate named stories.");
        return;
      }

      const publishPolicyDecision = await approvalPolicy.requiresApproval(
        req.organizationId!,
        page.includeCompanyName
      );
      if (publishPolicyDecision.required) {
        sendConflict(
          res,
          "Scheduled publish is unavailable when the current approval policy requires approval."
        );
        return;
      }

      const publishAt = new Date(parse.data.publish_at);
      const delayMs = publishAt.getTime() - Date.now();
      if (delayMs < 15_000) {
        sendBadRequest(res, "Choose a publish time at least 15 seconds in the future.");
        return;
      }

      await clearScheduledPublish(page.id);
      await scheduledPublishQueue.add(
        "scheduled-page-publish",
        {
          pageId: page.id,
          organizationId: req.organizationId!,
          userId: req.userId!,
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
        organizationId: req.organizationId!,
        actorUserId: req.userId!,
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
    })
  );

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
    })
  );
}
