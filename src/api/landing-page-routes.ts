/**
 * Landing Page API Routes
 *
 * CRUD + publish/share for landing pages.
 * All routes behind auth + permissions middleware.
 *
 * This file is a compatibility shim that delegates to decomposed sub-modules:
 *   - landing-page/crud-routes.ts
 *   - landing-page/publish-routes.ts
 *   - landing-page/preview-routes.ts
 */

import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import type { AuthenticatedRequest } from "../types/authenticated-request.js";
import type { Queue } from "bullmq";
import { LandingPageEditor } from "../services/landing-page-editor.js";
import type { PostPublishValidationJobData } from "../services/post-publish-validation.js";
import type { ScheduledPagePublishJobData } from "../services/scheduled-page-publish.js";
import { AccountAccessService } from "../services/account-access.js";
import { RoleProfileService } from "../services/role-profiles.js";
import { AuditLogService } from "../services/audit-log.js";
import { requireLandingPagesEnabled } from "../middleware/permissions.js";
import logger from "../lib/logger.js";
import { registerCrudRoutes } from "./landing-page/crud-routes.js";
import { registerPublishRoutes } from "./landing-page/publish-routes.js";
import { registerPreviewRoutes } from "./landing-page/preview-routes.js";

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

  const reqParams = (req: AuthenticatedRequest) => ({
    organizationId: req.organizationId! ?? "",
    userId: req.userId! ?? "",
    userRole: req.userRole ?? "MEMBER",
  });

  router.use(requireLandingPagesEnabled(prisma));

  const sharedDeps = {
    router,
    prisma,
    editor,
    roleProfiles,
    auditLogs,
    reqParams,
    clearScheduledPublish,
  };

  registerCrudRoutes({
    ...sharedDeps,
    accessService,
  });

  registerPublishRoutes({
    ...sharedDeps,
    postPublishValidationQueue,
    scheduledPublishQueue,
    enqueuePostPublishValidation,
    scheduledPublishJobId,
  });

  registerPreviewRoutes(sharedDeps);

  return router;
}
