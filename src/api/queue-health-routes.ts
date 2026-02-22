import { Router, type Request, type Response } from "express";
import type { Queue } from "bullmq";

interface QueueRegistry {
  processingQueue: Queue;
  transcriptFetchQueue: Queue;
  syncQueue: Queue;
  storyRegenQueue: Queue;
}

export function createQueueHealthRoutes(queues: QueueRegistry): Router {
  const router = Router();

  router.get("/", async (_req: Request, res: Response) => {
    const entries = Object.entries({
      call_processing: queues.processingQueue,
      transcript_fetching: queues.transcriptFetchQueue,
      integration_sync: queues.syncQueue,
      story_regeneration: queues.storyRegenQueue,
    }) as Array<[string, Queue]>;

    const metrics = await Promise.all(
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
      queues: metrics,
    });
  });

  return router;
}
