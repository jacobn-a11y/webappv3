import { type Response, type Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { requirePermission } from "../../middleware/permissions.js";
import type { AuditLogService } from "../../services/audit-log.js";
import logger from "../../lib/logger.js";
import { parseRequestBody } from "../_shared/validators.js";
import type { AuthenticatedRequest } from "../../types/authenticated-request.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { sendSuccess, sendNotFound, sendCreated } from "../_shared/responses.js";

const CreateQualityFeedbackSchema = z.object({
  story_id: z.string().min(1),
  feedback_type: z.enum(["CORRECTION", "DISPUTE", "MISSING_EVIDENCE", "LINEAGE_FIX"]),
  target_type: z.enum(["STORY", "QUOTE", "CLAIM"]),
  target_id: z.string().optional(),
  original_value: z.string().max(5000).optional(),
  corrected_value: z.string().max(5000).optional(),
  notes: z.string().max(2000).optional(),
  apply_to_prompt_tuning: z.boolean().optional(),
});

const ReviewQualityFeedbackSchema = z.object({
  status: z.enum(["OPEN", "ACCEPTED", "REJECTED", "APPLIED"]),
  notes: z.string().max(2000).optional(),
});

interface RegisterDataQualityRoutesOptions {
  router: Router;
  prisma: PrismaClient;
  auditLogs: AuditLogService;
}

export function registerDataQualityRoutes({
  router,
  prisma,
  auditLogs,
}: RegisterDataQualityRoutesOptions): void {
  // ── Data Quality & Trust ───────────────────────────────────────────

  router.get(
    "/data-quality/overview",
    requirePermission(prisma, "view_analytics"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const orgId = req.organizationId!;
      const now = new Date();
      const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const prev30 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

      const [
      storyCounts,
      storyConfidenceCurrent,
      storyConfidencePrev,
      lineageCountCurrent,
      feedbackOpen,
      feedbackApplied,
      integrationFailuresCurrent,
      integrationFailuresPrev,
      ] = await Promise.all([
      prisma.story.count({ where: { organizationId: orgId } }),
      prisma.story.aggregate({
        where: { organizationId: orgId, generatedAt: { gte: last30 } },
        _avg: { confidenceScore: true },
      }),
      prisma.story.aggregate({
        where: {
          organizationId: orgId,
          generatedAt: { gte: prev30, lt: last30 },
        },
        _avg: { confidenceScore: true },
      }),
      prisma.storyClaimLineage.count({
        where: { organizationId: orgId, createdAt: { gte: last30 } },
      }),
      prisma.storyQualityFeedback.count({
        where: { organizationId: orgId, status: "OPEN" },
      }),
      prisma.storyQualityFeedback.count({
        where: { organizationId: orgId, status: "APPLIED" },
      }),
      prisma.integrationRun.count({
        where: {
          organizationId: orgId,
          startedAt: { gte: last30 },
          status: { in: ["FAILED", "ERROR"] },
        },
      }),
      prisma.integrationRun.count({
        where: {
          organizationId: orgId,
          startedAt: { gte: prev30, lt: last30 },
          status: { in: ["FAILED", "ERROR"] },
        },
      }),
      ]);

      const avgCurrent = storyConfidenceCurrent._avg.confidenceScore ?? 0;
      const avgPrev = storyConfidencePrev._avg.confidenceScore ?? 0;
      const driftDelta = avgCurrent - avgPrev;
      const driftStatus =
      Math.abs(driftDelta) >= 0.1 ? "ALERT" : Math.abs(driftDelta) >= 0.05 ? "WARN" : "STABLE";

      const failureDelta = integrationFailuresCurrent - integrationFailuresPrev;

      sendSuccess(res, {
      stories_total: storyCounts,
      confidence: {
        avg_30d: Math.round(avgCurrent * 1000) / 1000,
        avg_prev_30d: Math.round(avgPrev * 1000) / 1000,
        drift_delta: Math.round(driftDelta * 1000) / 1000,
        drift_status: driftStatus,
      },
      lineage: {
        claims_30d: lineageCountCurrent,
        coverage_ratio:
          storyCounts > 0 ? Math.round((lineageCountCurrent / storyCounts) * 1000) / 1000 : 0,
      },
      freshness: {
        last_story_at:
          (
            await prisma.story.findFirst({
              where: { organizationId: orgId },
              orderBy: { generatedAt: "desc" },
              select: { generatedAt: true },
            })
          )?.generatedAt?.toISOString() ?? null,
      },
      sync_errors: {
        failures_30d: integrationFailuresCurrent,
        failures_prev_30d: integrationFailuresPrev,
        delta: failureDelta,
      },
      human_feedback: {
        open: feedbackOpen,
        applied: feedbackApplied,
      },
      });
      
    }
  ));

  router.get(
    "/data-quality/stories/:storyId/lineage",
    requirePermission(prisma, "view_analytics"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const story = await prisma.story.findFirst({
      where: { id: req.params.storyId as string, organizationId: req.organizationId! },
      select: { id: true, title: true, confidenceScore: true, lineageSummary: true },
      });
      if (!story) {
      sendNotFound(res, "Story not found");
      return;
      }
      const claims = await prisma.storyClaimLineage.findMany({
      where: {
        organizationId: req.organizationId!,
        storyId: story.id,
      },
      orderBy: { createdAt: "desc" },
      take: 500,
      });
      sendSuccess(res, {
      story: {
        id: story.id,
        title: story.title,
        confidence_score: story.confidenceScore,
        lineage_summary: story.lineageSummary,
      },
      claims: claims.map((c) => ({
        id: c.id,
        claim_type: c.claimType,
        claim_text: c.claimText,
        source_call_id: c.sourceCallId,
        source_chunk_id: c.sourceChunkId,
        source_timestamp_ms: c.sourceTimestampMs,
        confidence_score: c.confidenceScore,
        metadata: c.metadata,
        created_at: c.createdAt.toISOString(),
      })),
      });
      
    }
  ));

  router.post(
    "/data-quality/feedback",
    requirePermission(prisma, "view_analytics"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const payload = parseRequestBody(CreateQualityFeedbackSchema, req.body, res);
      if (!payload) {
        return;
      }

      const story = await prisma.story.findFirst({
      where: {
        id: payload.story_id,
        organizationId: req.organizationId!,
      },
      select: { id: true },
      });
      if (!story) {
      sendNotFound(res, "Story not found");
      return;
      }

      const feedback = await prisma.storyQualityFeedback.create({
      data: {
        organizationId: req.organizationId!,
        storyId: story.id,
        submittedByUserId: req.userId! ?? null,
        feedbackType: payload.feedback_type,
        targetType: payload.target_type,
        targetId: payload.target_id ?? null,
        originalValue: payload.original_value ?? null,
        correctedValue: payload.corrected_value ?? null,
        notes: payload.notes ?? null,
        applyToPromptTuning: payload.apply_to_prompt_tuning ?? false,
      },
      });

      await auditLogs.record({
      organizationId: req.organizationId!,
      actorUserId: req.userId!,
      category: "GOVERNANCE",
      action: "STORY_QUALITY_FEEDBACK_SUBMITTED",
      targetType: "story",
      targetId: story.id,
      severity: "INFO",
      metadata: {
        feedback_id: feedback.id,
        feedback_type: feedback.feedbackType,
        apply_to_prompt_tuning: feedback.applyToPromptTuning,
      },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      });

      sendCreated(res, {
      id: feedback.id,
      status: feedback.status,
      created_at: feedback.createdAt.toISOString(),
      });
      
    }
  ));

  router.get(
    "/data-quality/feedback",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;

      const rows = await prisma.storyQualityFeedback.findMany({
      where: {
        organizationId: req.organizationId!,
        ...(status ? { status } : {}),
      },
      include: {
        story: { select: { id: true, title: true } },
        submittedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
      });
      sendSuccess(res, {
      feedback: rows.map((row) => ({
        id: row.id,
        status: row.status,
        feedback_type: row.feedbackType,
        target_type: row.targetType,
        target_id: row.targetId,
        original_value: row.originalValue,
        corrected_value: row.correctedValue,
        notes: row.notes,
        apply_to_prompt_tuning: row.applyToPromptTuning,
        story: row.story,
        submitted_by: row.submittedBy,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
      })),
      });
      
    }
  ));

  router.post(
    "/data-quality/feedback/:feedbackId/review",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const payload = parseRequestBody(ReviewQualityFeedbackSchema, req.body, res);
      if (!payload) {
        return;
      }

      const feedback = await prisma.storyQualityFeedback.findFirst({
      where: {
        id: req.params.feedbackId as string,
        organizationId: req.organizationId!,
      },
      });
      if (!feedback) {
      sendNotFound(res, "Feedback not found");
      return;
      }
      const updated = await prisma.storyQualityFeedback.update({
      where: { id: feedback.id },
      data: {
        status: payload.status,
        notes: payload.notes ?? feedback.notes ?? null,
      },
      });
      await auditLogs.record({
      organizationId: req.organizationId!,
      actorUserId: req.userId!,
      category: "POLICY",
      action: "STORY_QUALITY_FEEDBACK_REVIEWED",
      targetType: "story_quality_feedback",
      targetId: updated.id,
      severity: "INFO",
      metadata: { status: updated.status },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      });
      sendSuccess(res, { status: updated.status, updated_at: updated.updatedAt.toISOString() });
      
    }
  ));
}
