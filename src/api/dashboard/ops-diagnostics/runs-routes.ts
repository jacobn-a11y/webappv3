/**
 * Ops Diagnostics — Integration Runs Routes
 *
 * GET /ops/pipeline-status      — Pipeline execution status
 * GET /ops/replay-observability — Run replay observability and dead-letter queue
 */

import { type Response, type Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { requirePermission } from "../../../middleware/permissions.js";
import type { AuthenticatedRequest } from "../../../types/authenticated-request.js";
import { asyncHandler } from "../../../lib/async-handler.js";
import { sendSuccess } from "../../_shared/responses.js";

// ─── Route Registration ─────────────────────────────────────────────────────

interface RegisterRunsRoutesOptions {
  router: Router;
  prisma: PrismaClient;
}

export function registerRunsRoutes({
  router,
  prisma,
}: RegisterRunsRoutesOptions): void {
  router.get(
    "/ops/pipeline-status",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const organizationId = req.organizationId;
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const [runs, failedRuns] = await Promise.all([
      prisma.integrationRun.findMany({
        where: { organizationId },
        orderBy: { startedAt: "desc" },
        take: 50,
        select: {
          id: true,
          provider: true,
          runType: true,
          status: true,
          processedCount: true,
          successCount: true,
          failureCount: true,
          startedAt: true,
          finishedAt: true,
          errorMessage: true,
          parentRunId: true,
          retryAttempt: true,
          metadata: true,
        },
      }),
      prisma.integrationRun.findMany({
        where: {
          organizationId,
          status: "FAILED",
          startedAt: { gte: since },
        },
        orderBy: { startedAt: "desc" },
        take: 25,
        select: {
          id: true,
          provider: true,
          runType: true,
          errorMessage: true,
          startedAt: true,
          retryAttempt: true,
          parentRunId: true,
        },
      }),
      ]);

      const retryChains: Map<string, string[]> = new Map();
      for (const run of runs) {
      if (run.parentRunId) {
        const chain = retryChains.get(run.parentRunId) ?? [];
        chain.push(run.id);
        retryChains.set(run.parentRunId, chain);
      }
      }

      const runMapped = runs.map((r) => ({
      id: r.id,
      provider: r.provider,
      run_type: r.runType,
      status: r.status,
      processed: r.processedCount,
      success: r.successCount,
      failure: r.failureCount,
      started_at: r.startedAt.toISOString(),
      finished_at: r.finishedAt?.toISOString() ?? null,
      duration_ms:
        r.finishedAt && r.startedAt
          ? r.finishedAt.getTime() - r.startedAt.getTime()
          : null,
      error_message: r.errorMessage,
      parent_run_id: r.parentRunId,
      retry_attempt: r.retryAttempt,
      retry_children: retryChains.get(r.id) ?? [],
      metadata: r.metadata ?? {},
      }));

      sendSuccess(res, {
      runs: runMapped,
      failed_runs_24h: failedRuns.map((f) => ({
        id: f.id,
        provider: f.provider,
        run_type: f.runType,
        error: f.errorMessage,
        started_at: f.startedAt.toISOString(),
        retry_attempt: f.retryAttempt,
        parent_run_id: f.parentRunId,
      })),
      });

    }
  ));

  router.get(
    "/ops/replay-observability",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const organizationId = req.organizationId;
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [replays, deadLetterCandidates] = await Promise.all([
      prisma.integrationRun.findMany({
        where: {
          organizationId,
          runType: "REPLAY",
          startedAt: { gte: since },
        },
        orderBy: { startedAt: "desc" },
        take: 50,
        select: {
          id: true,
          provider: true,
          status: true,
          processedCount: true,
          successCount: true,
          failureCount: true,
          startedAt: true,
          finishedAt: true,
          parentRunId: true,
          retryAttempt: true,
          metadata: true,
        },
      }),
      prisma.integrationRun.findMany({
        where: {
          organizationId,
          status: "FAILED",
          retryAttempt: { gte: 3 },
        },
        orderBy: { startedAt: "desc" },
        take: 25,
        select: {
          id: true,
          provider: true,
          runType: true,
          errorMessage: true,
          startedAt: true,
          retryAttempt: true,
          parentRunId: true,
          metadata: true,
        },
      }),
      ]);

      const deadLetterEntries = deadLetterCandidates.map((d) => ({
      run_id: d.id,
      provider: d.provider,
      run_type: d.runType,
      error: d.errorMessage,
      started_at: d.startedAt.toISOString(),
      retry_attempt: d.retryAttempt,
      parent_run_id: d.parentRunId,
      metadata: d.metadata ?? {},
      }));

      sendSuccess(res, {
      replays: replays.map((r) => ({
        id: r.id,
        provider: r.provider,
        status: r.status,
        processed: r.processedCount,
        success: r.successCount,
        failure: r.failureCount,
        started_at: r.startedAt.toISOString(),
        finished_at: r.finishedAt?.toISOString() ?? null,
        parent_run_id: r.parentRunId,
        retry_attempt: r.retryAttempt,
        metadata: r.metadata ?? {},
      })),
      dead_letter_queue: deadLetterEntries,
      dead_letter_count: deadLetterEntries.length,
      });

    }
  ));
}
