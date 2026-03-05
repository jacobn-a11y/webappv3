import { z } from "zod";
import type { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";
import type { AuthenticatedRequest } from "../../types/authenticated-request.js";
import {
  type LandingPageEditor,
  PublishValidationError,
  ScrubValidationError,
} from "../../services/landing-page-editor.js";
import type { PostPublishValidationJobData } from "../../services/post-publish-validation.js";
import type { ScheduledPagePublishJobData } from "../../services/scheduled-page-publish.js";
import type { RoleProfileService } from "../../services/role-profiles.js";
import type { AuditLogService } from "../../services/audit-log.js";
import { PublishApprovalPolicyService } from "../../services/publish-approval-policy.js";
import { SlackApprovalNotifier } from "../../services/slack-approval-notifier.js";
import type { Response } from "express";

export const PublishSchema = z.object({
  visibility: z.enum(["PRIVATE", "SHARED_WITH_LINK"]),
  password: z.string().min(4).max(100).optional(),
  expires_at: z.string().datetime().optional(),
  release_notes: z.string().max(1000).optional(),
});

export const SchedulePublishSchema = PublishSchema.extend({
  publish_at: z.string().datetime(),
});

export const ReviewPublishApprovalSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  notes: z.string().max(1000).optional(),
});

export type AuthReq = AuthenticatedRequest;

export interface RegisterPublishRoutesOptions {
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

export interface PublishRouteContext extends RegisterPublishRoutesOptions {
  approvalPolicy: PublishApprovalPolicyService;
  slackNotifier: SlackApprovalNotifier;
  canReviewPublishApprovals: (req: AuthReq) => Promise<boolean>;
}

export function sendPublishError(err: unknown, res: Response): boolean {
  if (err instanceof PublishValidationError) {
    res.status(400).json({
      error: "publish_validation_failed",
      message:
        "Publishing blocked because required content is incomplete. Fix the highlighted fields and retry.",
      issues: err.issues,
    });
    return true;
  }

  if (err instanceof ScrubValidationError) {
    res.status(400).json({
      error: "scrub_validation_failed",
      message:
        "Publishing blocked because anonymization is incomplete. Remove or redact leaked identifiers and retry.",
      leaked_terms: err.leakedTerms,
    });
    return true;
  }

  return false;
}
