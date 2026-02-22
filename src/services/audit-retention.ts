import cron from "node-cron";
import type { PrismaClient } from "@prisma/client";
import logger from "../lib/logger.js";
import { AuditLogService } from "./audit-log.js";

export async function runAuditRetentionSweep(
  prisma: PrismaClient
): Promise<number> {
  const auditLogs = new AuditLogService(prisma);
  const deleted = await auditLogs.purgeExpired();
  logger.info("Audit retention sweep completed", { deleted });
  return deleted;
}

export function startAuditRetentionCron(prisma: PrismaClient): cron.ScheduledTask {
  const task = cron.schedule(
    "15 2 * * *",
    async () => {
      try {
        await runAuditRetentionSweep(prisma);
      } catch (error) {
        logger.error("Audit retention cron failed", { error });
      }
    },
    { timezone: "UTC" }
  );

  logger.info("Audit retention cron scheduled at 02:15 UTC");
  return task;
}

