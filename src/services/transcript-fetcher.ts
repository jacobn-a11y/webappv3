/**
 * Transcript Fetching Service
 *
 * Polls the Merge.dev API for transcripts that weren't included inline
 * in the initial webhook payload. Some providers (notably Gong) process
 * recordings asynchronously and can take several minutes before the
 * transcript is available via API.
 *
 * Flow:
 *   1. Webhook receives recording without transcript → queues fetch job
 *   2. Worker polls Merge.dev API after a provider-specific initial delay
 *   3. If transcript not yet available → BullMQ retries with exponential backoff
 *   4. Once transcript is fetched → store it and re-queue onto call-processing
 */

import type { PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";
import type { ProcessCallJob } from "./transcript-processor.js";
import { enqueueProcessCallJob } from "../lib/queue-policy.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TranscriptFetchJob {
  callId: string;
  organizationId: string;
  accountId: string | null;
  mergeRecordingId: string;
  linkedAccountId: string;
  provider: string;
}

interface MergeRecordingResponse {
  id: string;
  remote_id?: string;
  name?: string;
  transcript?: string;
}

// ─── Provider-Specific Polling Configuration ─────────────────────────────────

/**
 * Different providers deliver transcripts at different speeds.
 * Gong processes recordings asynchronously and can take several minutes.
 * Chorus has similar delays. Most other providers are faster.
 *
 * initialDelayMs: delay before the first poll attempt (added as job delay)
 * maxDelayMs:     cap on exponential backoff between retries
 * maxAttempts:    total number of polling attempts before giving up
 *
 * Example schedule for Gong (30s initial, 2x growth, 300s cap):
 *   Attempt 1 at ~30s, 2 at ~90s, 3 at ~210s, 4 at ~450s, 5 at ~750s ...
 */
interface PollingConfig {
  initialDelayMs: number;
  maxDelayMs: number;
  maxAttempts: number;
}

const PROVIDER_POLLING_CONFIG: Record<string, PollingConfig> = {
  GONG: { initialDelayMs: 30_000, maxDelayMs: 300_000, maxAttempts: 10 },
  CHORUS: { initialDelayMs: 20_000, maxDelayMs: 300_000, maxAttempts: 10 },
};

const DEFAULT_POLLING_CONFIG: PollingConfig = {
  initialDelayMs: 10_000,
  maxDelayMs: 300_000,
  maxAttempts: 8,
};

export function getProviderPollingConfig(provider: string): PollingConfig {
  return PROVIDER_POLLING_CONFIG[provider] ?? DEFAULT_POLLING_CONFIG;
}

/**
 * Custom backoff strategy for the BullMQ transcript-fetching worker.
 * Computes delay based on the provider stored in the job data, with
 * exponential growth capped at maxDelayMs.
 */
export function transcriptFetchBackoffStrategy(
  attemptsMade: number,
  _type: string,
  _err: Error,
  job: { data: TranscriptFetchJob }
): number {
  const config = getProviderPollingConfig(job.data.provider);
  const delay = Math.min(
    config.initialDelayMs * Math.pow(2, attemptsMade - 1),
    config.maxDelayMs
  );
  return delay;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class TranscriptFetchError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean = true
  ) {
    super(message);
    this.name = "TranscriptFetchError";
  }
}

// ─── Service ─────────────────────────────────────────────────────────────────

const MERGE_API_BASE = "https://api.merge.dev/api/filestorage/v1";

export class TranscriptFetcher {
  private prisma: PrismaClient;
  private processingQueue: Queue;
  private mergeApiKey: string;
  private mergeApiBase: string;

  constructor(deps: {
    prisma: PrismaClient;
    processingQueue: Queue;
    mergeApiKey: string;
    mergeApiBase?: string;
  }) {
    this.prisma = deps.prisma;
    this.processingQueue = deps.processingQueue;
    this.mergeApiKey = deps.mergeApiKey;
    this.mergeApiBase = deps.mergeApiBase ?? MERGE_API_BASE;
  }

  /**
   * Attempt to fetch the transcript for a call from Merge.dev.
   *
   * If the transcript is not yet available, throws TranscriptFetchError
   * (retryable), which causes BullMQ to retry with exponential backoff.
   *
   * If the transcript is found, stores it in the database and re-queues
   * the call onto the processing pipeline.
   */
  async fetchTranscript(job: TranscriptFetchJob): Promise<void> {
    const { callId, mergeRecordingId, linkedAccountId, provider } = job;

    // ── Idempotency: skip if transcript already exists ────────────────
    const existing = await this.prisma.transcript.findUnique({
      where: { callId },
    });

    if (existing) {
      console.log(
        `Transcript already exists for call ${callId}, re-queuing processing`
      );
      await this.enqueueProcessing(job);
      return;
    }

    // ── Poll Merge.dev API ───────────────────────────────────────────
    console.log(
      `Polling Merge.dev for transcript: recording=${mergeRecordingId} ` +
        `provider=${provider} call=${callId}`
    );

    const recording = await this.fetchRecordingFromMerge(
      mergeRecordingId,
      linkedAccountId
    );

    if (!recording.transcript) {
      throw new TranscriptFetchError(
        `Transcript not yet available for recording ${mergeRecordingId} ` +
          `(provider: ${provider}, call: ${callId})`
      );
    }

    // ── Store the transcript ─────────────────────────────────────────
    await this.prisma.transcript.create({
      data: {
        callId,
        fullText: recording.transcript,
        wordCount: recording.transcript.split(/\s+/).length,
      },
    });

    console.log(
      `Transcript fetched for call ${callId} from ${provider} ` +
        `(${recording.transcript.split(/\s+/).length} words)`
    );

    // ── Re-queue for the standard processing pipeline ────────────────
    await this.enqueueProcessing(job);
  }

  /**
   * Fetch recording details (including transcript) from Merge.dev.
   */
  private async fetchRecordingFromMerge(
    mergeRecordingId: string,
    linkedAccountId: string
  ): Promise<MergeRecordingResponse> {
    const url = `${this.mergeApiBase}/recordings/${mergeRecordingId}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.mergeApiKey}`,
        "X-Account-Token": linkedAccountId,
        "Content-Type": "application/json",
      },
    });

    if (response.status === 404) {
      throw new TranscriptFetchError(
        `Recording ${mergeRecordingId} not found in Merge.dev`,
        false // not retryable — recording doesn't exist
      );
    }

    if (response.status === 429) {
      throw new TranscriptFetchError(
        `Rate limited by Merge.dev API for recording ${mergeRecordingId}`,
        true
      );
    }

    if (!response.ok) {
      throw new TranscriptFetchError(
        `Merge.dev API error: ${response.status} ${response.statusText}`,
        response.status >= 500 // retry on server errors only
      );
    }

    return response.json() as Promise<MergeRecordingResponse>;
  }

  /**
   * Enqueue the call for the standard processing pipeline
   * (chunking → PII masking → tagging → embedding).
   */
  private async enqueueProcessing(job: TranscriptFetchJob): Promise<void> {
    const processingJob: ProcessCallJob = {
      callId: job.callId,
      organizationId: job.organizationId,
      accountId: job.accountId,
      hasTranscript: true,
    };

    await enqueueProcessCallJob({
      queue: this.processingQueue,
      payload: processingJob,
      source: "transcript-fetcher",
    });

    console.log(
      `Re-queued call ${job.callId} for processing after transcript fetch`
    );
  }
}
