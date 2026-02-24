/**
 * Shared queue policy helpers for call-processing jobs.
 *
 * Centralizes retry/backoff options and protects enqueue operations with a
 * lightweight retry loop so transient Redis/network issues don't silently
 * drop processing work.
 */

import type { JobsOptions } from "bullmq";
import type { ProcessCallJob } from "../services/transcript-processor.js";
import logger from "./logger.js";
import { Sentry } from "./sentry.js";
import { metrics } from "./metrics.js";

export const PROCESS_CALL_JOB_DEFAULT_OPTIONS: Readonly<JobsOptions> = Object.freeze({
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
});

interface ProcessCallQueue {
  add(
    name: string,
    data: ProcessCallJob,
    opts?: JobsOptions
  ): Promise<unknown>;
}

interface BuildProcessCallJobOptionsInput {
  jobId?: string | null;
}

export function buildProcessCallJobOptions(
  input?: BuildProcessCallJobOptionsInput
): JobsOptions {
  const explicitJobId = (input?.jobId ?? "").trim();
  return {
    ...PROCESS_CALL_JOB_DEFAULT_OPTIONS,
    ...(explicitJobId ? { jobId: explicitJobId } : {}),
  };
}

interface EnqueueProcessCallJobInput {
  queue: ProcessCallQueue;
  payload: ProcessCallJob;
  source: string;
  options?: BuildProcessCallJobOptionsInput;
  enqueueAttempts?: number;
  enqueueBaseDelayMs?: number;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function enqueueProcessCallJob(
  input: EnqueueProcessCallJobInput
): Promise<void> {
  const attempts = Math.max(1, input.enqueueAttempts ?? 3);
  const baseDelayMs = Math.max(50, input.enqueueBaseDelayMs ?? 250);
  const jobOptions = buildProcessCallJobOptions({
    jobId: input.options?.jobId,
  });

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await input.queue.add("process-call", input.payload, jobOptions);
      if (attempt > 1) {
        metrics.recordProcessCallEnqueueRecovered();
        logger.warn("Recovered enqueue after retry", {
          source: input.source,
          callId: input.payload.callId,
          attempt,
        });
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      const jitter = Math.floor(Math.random() * 60);
      const delay = baseDelayMs * attempt + jitter;
      logger.warn("Enqueue retry scheduled", {
        source: input.source,
        callId: input.payload.callId,
        attempt,
        delayMs: delay,
        error: error instanceof Error ? error.message : String(error),
      });
      metrics.recordProcessCallEnqueueRetry();
      await wait(delay);
    }
  }

  const errorMessage =
    lastError instanceof Error ? lastError.message : String(lastError);
  metrics.recordProcessCallEnqueueFailure({
    source: input.source,
    callId: input.payload.callId,
    attempts,
    error: errorMessage,
  });

  logger.error("Failed to enqueue process-call job", {
    source: input.source,
    callId: input.payload.callId,
    attempts,
    error: errorMessage,
  });
  Sentry.captureException(
    lastError instanceof Error
      ? lastError
      : new Error(String(lastError ?? "Unknown enqueue error")),
    {
      tags: {
        source: input.source,
        queue: "call-processing",
        callId: input.payload.callId,
      },
    }
  );
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? "Failed to enqueue process-call job"));
}
