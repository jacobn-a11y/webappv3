import type { PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";
import cron from "node-cron";
import type { ProcessCallJob } from "./transcript-processor.js";
import { AuditLogService } from "./audit-log.js";
import logger from "../lib/logger.js";

export type CallProcessingFailureClass =
  | "rate_limit"
  | "upstream_transient"
  | "network_or_redis"
  | "non_retryable";

export interface CallProcessingFailureClassification {
  className: CallProcessingFailureClass;
  retryable: boolean;
}

interface FailedProcessCallJob {
  id?: string;
  data: ProcessCallJob;
  failedReason?: string;
  attemptsMade?: number;
  failedOn?: number;
  timestamp?: number;
  retry(): Promise<void>;
}

export interface DeadLetterReplaySummary {
  trigger: "manual" | "scheduled";
  scanned: number;
  replayed: number;
  skipped: {
    missing_payload: number;
    different_organization: number;
    duplicate_call: number;
    non_retryable: number;
    outside_replay_window: number;
    replay_attempt_cap: number;
    replay_error: number;
  };
  replayed_calls: string[];
}

const DEFAULT_REPLAY_BATCH_SIZE = 50;
const MAX_REPLAY_BATCH_SIZE = 200;
const DEFAULT_MAX_FAILURE_AGE_MINUTES = 24 * 60;
const MAX_FAILURE_AGE_MINUTES_LIMIT = 14 * 24 * 60;
const DEFAULT_REPLAY_ATTEMPT_CAP = 8;
const MAX_REPLAY_ATTEMPT_CAP_LIMIT = 25;

const RETRYABLE_PATTERNS: Array<{ className: CallProcessingFailureClass; pattern: RegExp }> = [
  {
    className: "rate_limit",
    pattern: /\b(429|rate.?limit|too many requests|quota exceeded)\b/i,
  },
  {
    className: "upstream_transient",
    pattern: /\b(5\d{2}|gateway timeout|bad gateway|service unavailable|temporar(?:y|ily)|upstream)\b/i,
  },
  {
    className: "network_or_redis",
    pattern: /\b(redis|econnreset|etimedout|timeout|connection reset|network|socket hang up|connect)\b/i,
  },
];

function parseReplayBatchSize(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_REPLAY_BATCH_SIZE;
  }
  return Math.max(1, Math.min(MAX_REPLAY_BATCH_SIZE, Math.floor(parsed)));
}

function parseMaxFailureAgeMinutes(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_MAX_FAILURE_AGE_MINUTES;
  }
  return Math.max(
    5,
    Math.min(MAX_FAILURE_AGE_MINUTES_LIMIT, Math.floor(parsed))
  );
}

function parseReplayAttemptCap(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_REPLAY_ATTEMPT_CAP;
  }
  return Math.max(1, Math.min(MAX_REPLAY_ATTEMPT_CAP_LIMIT, Math.floor(parsed)));
}

export function classifyCallProcessingFailure(
  failedReason: string | null | undefined
): CallProcessingFailureClassification {
  const reason = (failedReason ?? "").trim();
  if (!reason) {
    return { className: "non_retryable", retryable: false };
  }

  for (const rule of RETRYABLE_PATTERNS) {
    if (rule.pattern.test(reason)) {
      return { className: rule.className, retryable: true };
    }
  }

  return { className: "non_retryable", retryable: false };
}

async function recordReplayAuditLog(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    actorUserId?: string | null;
    scanned: number;
    replayed: number;
    trigger: "manual" | "scheduled";
    replayedCalls: string[];
    skipped: DeadLetterReplaySummary["skipped"];
    replayWindowMinutes: number;
    replayAttemptCap: number;
  }
): Promise<void> {
  const auditLogs = new AuditLogService(prisma);
  await auditLogs.record({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId ?? null,
    category: "QUEUE",
    action:
      input.trigger === "scheduled"
        ? "CALL_PROCESSING_DEAD_LETTER_AUTO_REPLAY"
        : "CALL_PROCESSING_DEAD_LETTER_REPLAY_TRIGGERED",
    targetType: "queue",
    targetId: "call-processing",
    severity: "WARN",
    metadata: {
      scanned: input.scanned,
      replayed: input.replayed,
      replayed_calls: input.replayedCalls,
      trigger: input.trigger,
      skipped: input.skipped,
      replay_window_minutes: input.replayWindowMinutes,
      replay_attempt_cap: input.replayAttemptCap,
    },
  });
}

export async function replayRetryableDeadLetterJobs(input: {
  processingQueue: Queue<ProcessCallJob>;
  organizationId?: string;
  limit?: number;
  trigger: "manual" | "scheduled";
  prisma?: PrismaClient;
  actorUserId?: string | null;
  maxFailureAgeMinutes?: number;
  replayAttemptCap?: number;
}): Promise<DeadLetterReplaySummary> {
  const limit = Math.max(
    1,
    Math.min(
      MAX_REPLAY_BATCH_SIZE,
      Math.floor(input.limit ?? DEFAULT_REPLAY_BATCH_SIZE)
    )
  );

  const failedJobs = (await input.processingQueue.getJobs(
    ["failed"],
    0,
    limit - 1
  )) as FailedProcessCallJob[];
  const replayWindowMinutes = Math.max(
    5,
    Math.floor(
      input.maxFailureAgeMinutes ??
        parseMaxFailureAgeMinutes(
          process.env.CALL_PROCESSING_DEAD_LETTER_REPLAY_MAX_AGE_MINUTES
        )
    )
  );
  const replayAttemptCap = Math.max(
    1,
    Math.floor(
      input.replayAttemptCap ??
        parseReplayAttemptCap(
          process.env.CALL_PROCESSING_DEAD_LETTER_REPLAY_ATTEMPT_CAP
        )
    )
  );
  const replayWindowMs = replayWindowMinutes * 60 * 1000;
  const nowMs = Date.now();

  const summary: DeadLetterReplaySummary = {
    trigger: input.trigger,
    scanned: failedJobs.length,
    replayed: 0,
    skipped: {
      missing_payload: 0,
      different_organization: 0,
      duplicate_call: 0,
      non_retryable: 0,
      outside_replay_window: 0,
      replay_attempt_cap: 0,
      replay_error: 0,
    },
    replayed_calls: [],
  };

  const seenCallIds = new Set<string>();
  const orgSummaries = new Map<
    string,
    { scanned: number; replayedCalls: string[]; skipped: DeadLetterReplaySummary["skipped"] }
  >();

  const getOrgSummary = (organizationId: string) => {
    let existing = orgSummaries.get(organizationId);
    if (existing) return existing;
    existing = {
      scanned: 0,
      replayedCalls: [],
      skipped: {
        missing_payload: 0,
        different_organization: 0,
        duplicate_call: 0,
        non_retryable: 0,
        outside_replay_window: 0,
        replay_attempt_cap: 0,
        replay_error: 0,
      },
    };
    orgSummaries.set(organizationId, existing);
    return existing;
  };

  for (const job of failedJobs) {
    const payload = job.data;
    const callId = typeof payload?.callId === "string" ? payload.callId : null;
    const organizationId =
      typeof payload?.organizationId === "string"
        ? payload.organizationId
        : null;

    if (!callId || !organizationId) {
      summary.skipped.missing_payload += 1;
      continue;
    }

    if (input.organizationId && organizationId !== input.organizationId) {
      summary.skipped.different_organization += 1;
      continue;
    }
    const orgSummary = getOrgSummary(organizationId);
    orgSummary.scanned += 1;

    if (seenCallIds.has(callId)) {
      summary.skipped.duplicate_call += 1;
      orgSummary.skipped.duplicate_call += 1;
      continue;
    }
    seenCallIds.add(callId);

    const failureTimestampMs =
      typeof job.failedOn === "number"
        ? job.failedOn
        : typeof job.timestamp === "number"
          ? job.timestamp
          : null;
    if (
      failureTimestampMs !== null &&
      nowMs - failureTimestampMs > replayWindowMs
    ) {
      summary.skipped.outside_replay_window += 1;
      orgSummary.skipped.outside_replay_window += 1;
      continue;
    }

    const attemptsMade = Math.max(0, Math.floor(job.attemptsMade ?? 0));
    if (attemptsMade >= replayAttemptCap) {
      summary.skipped.replay_attempt_cap += 1;
      orgSummary.skipped.replay_attempt_cap += 1;
      continue;
    }

    const failureClass = classifyCallProcessingFailure(job.failedReason);
    if (!failureClass.retryable) {
      summary.skipped.non_retryable += 1;
      orgSummary.skipped.non_retryable += 1;
      continue;
    }

    try {
      await job.retry();
      summary.replayed += 1;
      summary.replayed_calls.push(callId);
      orgSummary.replayedCalls.push(callId);
    } catch (error) {
      summary.skipped.replay_error += 1;
      orgSummary.skipped.replay_error += 1;
      logger.warn("Dead-letter replay failed for call-processing job", {
        callId,
        organizationId,
        jobId: job.id,
        trigger: input.trigger,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (input.prisma) {
    await Promise.all(
      Array.from(orgSummaries.entries()).map(async ([organizationId, orgSummary]) => {
        if (orgSummary.scanned <= 0) return;
        await recordReplayAuditLog(input.prisma as PrismaClient, {
          organizationId,
          actorUserId: input.actorUserId ?? null,
          scanned: orgSummary.scanned,
          replayed: orgSummary.replayedCalls.length,
          trigger: input.trigger,
          replayedCalls: orgSummary.replayedCalls,
          skipped: orgSummary.skipped,
          replayWindowMinutes,
          replayAttemptCap,
        });
      })
    );
  }

  return summary;
}

export function startCallProcessingDeadLetterReplayCron(
  prisma: PrismaClient,
  processingQueue: Queue<ProcessCallJob>
): cron.ScheduledTask | null {
  const enabled =
    (process.env.CALL_PROCESSING_DEAD_LETTER_AUTO_REPLAY_ENABLED ?? "true")
      .toLowerCase() !== "false";
  if (!enabled) {
    logger.info("Call-processing dead-letter auto replay is disabled");
    return null;
  }

  const schedule =
    process.env.CALL_PROCESSING_DEAD_LETTER_AUTO_REPLAY_CRON ??
    "*/10 * * * *";
  const batchSize = parseReplayBatchSize(
    process.env.CALL_PROCESSING_DEAD_LETTER_REPLAY_BATCH_SIZE
  );
  const replayWindowMinutes = parseMaxFailureAgeMinutes(
    process.env.CALL_PROCESSING_DEAD_LETTER_REPLAY_MAX_AGE_MINUTES
  );
  const replayAttemptCap = parseReplayAttemptCap(
    process.env.CALL_PROCESSING_DEAD_LETTER_REPLAY_ATTEMPT_CAP
  );

  const task = cron.schedule(
    schedule,
    async () => {
      try {
        const result = await replayRetryableDeadLetterJobs({
          processingQueue,
          limit: batchSize,
          trigger: "scheduled",
          prisma,
          maxFailureAgeMinutes: replayWindowMinutes,
          replayAttemptCap,
        });
        if (result.replayed > 0 || result.skipped.replay_error > 0) {
          logger.warn("Call-processing dead-letter auto replay run", result);
        } else {
          logger.info("Call-processing dead-letter auto replay run", result);
        }
      } catch (error) {
        logger.error("Call-processing dead-letter auto replay cron failed", {
          error,
        });
      }
    },
    { timezone: "UTC" }
  );

  logger.info("Call-processing dead-letter auto replay cron scheduled", {
    schedule,
    batchSize,
    replayWindowMinutes,
    replayAttemptCap,
  });
  return task;
}
