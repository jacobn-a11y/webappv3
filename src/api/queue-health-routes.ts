import { Router, type Request, type Response } from "express";
import type { Queue } from "bullmq";
import type { PrismaClient } from "@prisma/client";
import { metrics } from "../lib/metrics.js";
import { getOrganizationIdOrThrow, TenantGuardError } from "../lib/tenant-guard.js";
import { parseBoundedLimit } from "../lib/pagination.js";
import {
  replayRetryableDeadLetterJobs,
} from "../services/call-processing-dead-letter-replay.js";
import logger from "../lib/logger.js";

interface QueueRegistry {
  processingQueue: Queue;
  transcriptFetchQueue: Queue;
  syncQueue: Queue;
  storyRegenQueue: Queue;
}

interface QueueHealthDeps {
  queues: QueueRegistry;
  prisma: PrismaClient;
}

export function createQueueHealthRoutes(deps: QueueHealthDeps): Router {
  const { queues, prisma } = deps;
  const router = Router();

  router.get("/", async (_req: Request, res: Response) => {
    const entries = Object.entries({
      call_processing: queues.processingQueue,
      transcript_fetching: queues.transcriptFetchQueue,
      integration_sync: queues.syncQueue,
      story_regeneration: queues.storyRegenQueue,
    }) as Array<[string, Queue]>;

    const queueMetrics = await Promise.all(
      entries.map(async ([name, queue]) => {
        const [counts, delayed] = await Promise.all([
          queue.getJobCounts(
            "active",
            "waiting",
            "delayed",
            "failed",
            "completed",
            "paused"
          ),
          queue.getDelayedCount(),
        ]);
        return {
          queue: name,
          counts,
          delayed_count: delayed,
        };
      })
    );

    res.json({
      timestamp: new Date().toISOString(),
      queues: queueMetrics,
      enqueue_diagnostics: metrics
        .getSnapshot()
        .queue_observability.process_call_enqueue,
    });
  });

  router.post(
    "/call-processing/dead-letter/replay",
    async (req: Request, res: Response) => {
      try {
        const organizationId = getOrganizationIdOrThrow(req);
        const requestedLimit =
          typeof req.body?.limit === "number"
            ? req.body.limit
            : req.query.limit;
        const limit = parseBoundedLimit(requestedLimit, {
          fallback: 50,
          max: 200,
        });
        const actorUserId =
          (req as { userId?: string }).userId ?? null;

        const replaySummary = await replayRetryableDeadLetterJobs({
          processingQueue: queues.processingQueue,
          organizationId,
          limit,
          trigger: "manual",
          prisma,
          actorUserId,
        });

        res.json({
          replayed: replaySummary.replayed,
          scanned: replaySummary.scanned,
          replayed_calls: replaySummary.replayed_calls,
          skipped: replaySummary.skipped,
        });
      } catch (error) {
        if (error instanceof TenantGuardError) {
          res.status(error.statusCode).json({ error: error.message });
          return;
        }
        logger.error("Failed to replay call-processing dead-letter jobs", {
          error,
        });
        res.status(500).json({
          error: "Failed to replay call-processing dead-letter jobs",
        });
      }
    }
  );

  return router;
}
