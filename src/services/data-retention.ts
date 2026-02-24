import cron from "node-cron";
import type { PrismaClient } from "@prisma/client";
import logger from "../lib/logger.js";
import { AuditLogService } from "./audit-log.js";
import { getDataGovernancePolicy } from "./data-governance.js";
import type { RAGEngine } from "./rag-engine.js";

const DEFAULT_RETENTION_DAYS = 365;
const MIN_RETENTION_DAYS = 30;
const MAX_RETENTION_DAYS = 3650;

function normalizeRetentionDays(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_RETENTION_DAYS;
  }
  const rounded = Math.floor(raw);
  return Math.max(MIN_RETENTION_DAYS, Math.min(MAX_RETENTION_DAYS, rounded));
}

export interface DataRetentionSweepResult {
  organizationsProcessed: number;
  organizationsSkippedByLegalHold: number;
  deletedCalls: number;
  deletedStories: number;
  deletedLandingPages: number;
  deletedIntegrationRuns: number;
  deletedAuditLogs: number;
  prunedVectors: number;
}

export async function runDataRetentionSweep(
  prisma: PrismaClient,
  ragEngine?: RAGEngine
): Promise<DataRetentionSweepResult> {
  const settings = await prisma.orgSettings.findMany({
    select: { organizationId: true },
  });

  const auditLogs = new AuditLogService(prisma);
  const result: DataRetentionSweepResult = {
    organizationsProcessed: 0,
    organizationsSkippedByLegalHold: 0,
    deletedCalls: 0,
    deletedStories: 0,
    deletedLandingPages: 0,
    deletedIntegrationRuns: 0,
    deletedAuditLogs: 0,
    prunedVectors: 0,
  };

  for (const setting of settings) {
    result.organizationsProcessed += 1;
    const policy = await getDataGovernancePolicy(prisma, setting.organizationId);
    if (policy.legal_hold_enabled) {
      result.organizationsSkippedByLegalHold += 1;
      continue;
    }

    const retentionDays = normalizeRetentionDays(policy.retention_days);
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const organizationId = setting.organizationId;
    if (ragEngine) {
      const pruned = await ragEngine.pruneVectors({
        organizationId,
        olderThan: cutoff,
      });
      result.prunedVectors += pruned;
    }

    const [landingPagesDeleted, storiesDeleted, callsDeleted, runsDeleted] =
      await prisma.$transaction([
        prisma.landingPage.deleteMany({
          where: {
            organizationId,
            createdAt: { lt: cutoff },
            status: { in: ["DRAFT", "ARCHIVED"] },
          },
        }),
        prisma.story.deleteMany({
          where: {
            organizationId,
            generatedAt: { lt: cutoff },
            landingPages: { none: {} },
          },
        }),
        prisma.call.deleteMany({
          where: {
            organizationId,
            occurredAt: { lt: cutoff },
          },
        }),
        prisma.integrationRun.deleteMany({
          where: {
            organizationId,
            startedAt: { lt: cutoff },
          },
        }),
      ]);

    result.deletedLandingPages += landingPagesDeleted.count;
    result.deletedStories += storiesDeleted.count;
    result.deletedCalls += callsDeleted.count;
    result.deletedIntegrationRuns += runsDeleted.count;

    result.deletedAuditLogs += await auditLogs.purgeExpired({ organizationId });
  }

  logger.info("Data retention sweep completed", result);
  return result;
}

export function startDataRetentionCron(
  prisma: PrismaClient,
  ragEngine?: RAGEngine
): cron.ScheduledTask {
  const task = cron.schedule(
    "15 3 * * *",
    async () => {
      try {
        await runDataRetentionSweep(prisma, ragEngine);
      } catch (error) {
        logger.error("Data retention cron failed", { error });
      }
    },
    { timezone: "UTC" }
  );

  logger.info("Data retention cron scheduled at 03:15 UTC");
  return task;
}
