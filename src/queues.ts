/**
 * BullMQ Queues & Workers
 *
 * Sets up all job queues (call processing, transcript fetching, integration
 * sync, story regeneration), their workers, and the Stripe usage reporting cron.
 */

import { Queue, Worker, UnrecoverableError } from "bullmq";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";

import {
  type ProcessCallJob,
} from "./services/transcript-processor.js";
import {
  TranscriptFetchError,
  transcriptFetchBackoffStrategy,
  type TranscriptFetchJob,
} from "./services/transcript-fetcher.js";
import {
  type WeeklyRegenJobData,
} from "./services/weekly-story-regeneration.js";
import { startUsageReportingCron } from "./services/usage-reporter.js";
import { startAuditRetentionCron } from "./services/audit-retention.js";
import { startDataRetentionCron } from "./services/data-retention.js";
import { startCallProcessingDeadLetterReplayCron } from "./services/call-processing-dead-letter-replay.js";
import logger, { jobStore } from "./lib/logger.js";
import { Sentry } from "./lib/sentry.js";
import { PROCESS_CALL_JOB_DEFAULT_OPTIONS } from "./lib/queue-policy.js";
import type { Services } from "./services.js";

export interface Queues {
  processingQueue: Queue;
  transcriptFetchQueue: Queue;
  syncQueue: Queue;
  storyRegenQueue: Queue;
}

export interface Workers {
  callWorker: Worker<ProcessCallJob>;
  transcriptFetchWorker: Worker<TranscriptFetchJob>;
  syncWorker: Worker;
  storyRegenWorker: Worker<WeeklyRegenJobData>;
  usageCron: ReturnType<typeof startUsageReportingCron>;
  auditRetentionCron: ReturnType<typeof startAuditRetentionCron>;
  dataRetentionCron: ReturnType<typeof startDataRetentionCron>;
  callProcessingDeadLetterReplayCron: ReturnType<
    typeof startCallProcessingDeadLetterReplayCron
  >;
}

/**
 * Create all BullMQ queues. Queues are created first because some services
 * (MergeApiClient, SyncEngine, TranscriptFetcher) need the processingQueue.
 */
export function createQueues(redisUrl: string): Queues {
  const processingQueue = new Queue("call-processing", {
    connection: { url: redisUrl },
    defaultJobOptions: PROCESS_CALL_JOB_DEFAULT_OPTIONS,
  });

  const transcriptFetchQueue = new Queue("transcript-fetching", {
    connection: { url: redisUrl },
  });

  const syncQueue = new Queue("integration-sync", {
    connection: { url: redisUrl },
  });

  const SYNC_INTERVAL_MS =
    parseInt(process.env.SYNC_INTERVAL_MINUTES ?? "15", 10) * 60 * 1000;

  syncQueue.upsertJobScheduler(
    "periodic-sync",
    { every: SYNC_INTERVAL_MS },
    { name: "sync-all-integrations" }
  );

  const storyRegenQueue = new Queue<WeeklyRegenJobData>("story-regeneration", {
    connection: { url: redisUrl },
  });

  storyRegenQueue.upsertJobScheduler(
    "weekly-story-regen",
    { pattern: "0 2 * * 0" }, // every Sunday at 02:00 UTC
    {
      name: "weekly-story-regen",
      data: {},
      opts: {
        attempts: 2,
        backoff: { type: "exponential", delay: 60_000 },
      },
    }
  );

  return { processingQueue, transcriptFetchQueue, syncQueue, storyRegenQueue };
}

/**
 * Create all BullMQ workers and the Stripe usage-reporting cron.
 * Workers are created after services so they can call into service methods.
 */
export function createWorkers(
  redisUrl: string,
  queues: Queues,
  services: Services,
  prisma: PrismaClient,
  stripe: Stripe
): Workers {
  const {
    transcriptProcessor,
    transcriptFetcher,
    syncEngine,
    weeklyStoryRegen,
    notificationService,
    ragEngine,
  } = services;

  // Call processing worker
  const callWorker = new Worker<ProcessCallJob>(
    "call-processing",
    async (job) => {
      const ctx = {
        jobId: job.id ?? "unknown",
        callId: job.data.callId,
        organizationId: job.data.organizationId,
        accountId: job.data.accountId,
      };

      await jobStore.run(ctx, async () => {
        logger.info("Job started", {
          hasTranscript: job.data.hasTranscript,
          attempt: job.attemptsMade + 1,
        });
        await transcriptProcessor.processCall(job.data);
      });
    },
    {
      connection: { url: redisUrl },
      concurrency: 3,
    }
  );

  callWorker.on("completed", async (job) => {
    logger.info("Job completed", {
      jobId: job.id,
      callId: job.data.callId,
    });
    if (notificationService && job.data.organizationId) {
      await notificationService
        .notifyCallProcessed(job.data.organizationId, job.data.callId)
        .catch((err: Error) =>
          logger.error("Notification error:", { error: err.message })
        );
    }
  });

  callWorker.on("failed", async (job, err) => {
    logger.error("Job failed", {
      jobId: job?.id,
      callId: job?.data.callId,
      error: err.message,
      stack: err.stack,
    });
    Sentry.captureException(err, {
      tags: { jobId: job?.id, callId: job?.data.callId },
    });
    if (notificationService && job?.data?.organizationId) {
      notificationService
        .notifyCallProcessingFailed(
          job.data.organizationId,
          job.data.callId,
          err.message
        )
        .catch((notifErr: Error) =>
          logger.error("Notification error:", { error: notifErr.message })
        );
    }
  });

  // Transcript fetch worker
  const transcriptFetchWorker = new Worker<TranscriptFetchJob>(
    "transcript-fetching",
    async (job) => {
      try {
        await transcriptFetcher.fetchTranscript(job.data);
      } catch (err) {
        if (err instanceof TranscriptFetchError && !err.retryable) {
          throw new UnrecoverableError(err.message);
        }
        throw err;
      }
    },
    {
      connection: { url: redisUrl },
      concurrency: 2,
      settings: {
        backoffStrategy: transcriptFetchBackoffStrategy as (
          ...args: any[]
        ) => number,
      },
    }
  );

  // Integration sync worker
  const syncWorker = new Worker(
    "integration-sync",
    async () => {
      await syncEngine.syncAll();
    },
    {
      connection: { url: redisUrl },
      concurrency: 1,
    }
  );

  // Story regeneration worker
  const storyRegenWorker = new Worker<WeeklyRegenJobData>(
    "story-regeneration",
    async (job) => {
      logger.info(`Starting weekly story regeneration job ${job.id}`);
      const result = await weeklyStoryRegen.run(job.data);
      logger.info(
        `Story regen job ${job.id} done: ${result.accountsProcessed} accounts, ${result.orgsNotified} orgs, ${result.errors.length} errors`
      );
      return result;
    },
    {
      connection: { url: redisUrl },
      concurrency: 1,
    }
  );

  // Usage reporting cron
  const usageCron = startUsageReportingCron(prisma, stripe);
  const auditRetentionCron = startAuditRetentionCron(prisma);
  const dataRetentionCron = startDataRetentionCron(prisma, ragEngine);
  const callProcessingDeadLetterReplayCron =
    startCallProcessingDeadLetterReplayCron(prisma, queues.processingQueue);

  return {
    callWorker,
    transcriptFetchWorker,
    syncWorker,
    storyRegenWorker,
    usageCron,
    auditRetentionCron,
    dataRetentionCron,
    callProcessingDeadLetterReplayCron,
  };
}
