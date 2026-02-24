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
    replay_error: number;
  };
  replayed_calls: string[];
}

const DEFAULT_REPLAY_BATCH_SIZE = 50;
const MAX_REPLAY_BATCH_SIZE = 200;

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
    replayed: number;
    trigger: "manual" | "scheduled";
    replayedCalls: string[];
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
      replayed: input.replayed,
      replayed_calls: input.replayedCalls,
      trigger: input.trigger,
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

  const summary: DeadLetterReplaySummary = {
    trigger: input.trigger,
    scanned: failedJobs.length,
    replayed: 0,
    skipped: {
      missing_payload: 0,
      different_organization: 0,
      duplicate_call: 0,
      non_retryable: 0,
      replay_error: 0,
    },
    replayed_calls: [],
  };

  const seenCallIds = new Set<string>();
  const replayedByOrganization = new Map<string, string[]>();

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

    if (seenCallIds.has(callId)) {
      summary.skipped.duplicate_call += 1;
      continue;
    }
    seenCallIds.add(callId);

    const failureClass = classifyCallProcessingFailure(job.failedReason);
    if (!failureClass.retryable) {
      summary.skipped.non_retryable += 1;
      continue;
    }

    try {
      await job.retry();
      summary.replayed += 1;
      summary.replayed_calls.push(callId);

      const orgCalls = replayedByOrganization.get(organizationId) ?? [];
      orgCalls.push(callId);
      replayedByOrganization.set(organizationId, orgCalls);
    } catch (error) {
      summary.skipped.replay_error += 1;
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
      Array.from(replayedByOrganization.entries()).map(
        async ([organizationId, replayedCalls]) => {
          await recordReplayAuditLog(input.prisma as PrismaClient, {
            organizationId,
            actorUserId: input.actorUserId ?? null,
            replayed: replayedCalls.length,
            trigger: input.trigger,
            replayedCalls,
          });
        }
      )
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

  const task = cron.schedule(
    schedule,
    async () => {
      try {
        const result = await replayRetryableDeadLetterJobs({
          processingQueue,
          limit: batchSize,
          trigger: "scheduled",
          prisma,
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
  });
  return task;
}
