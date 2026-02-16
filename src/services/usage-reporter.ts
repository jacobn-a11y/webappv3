/**
 * Usage Reporter — Daily Transcript Minutes Aggregation
 *
 * Cron job that runs daily to:
 *  1. Query all calls processed in the previous day
 *  2. Aggregate transcript duration (in minutes) per organization
 *  3. Upsert a UsageRecord for each org
 *  4. Report the aggregated usage to Stripe for metered billing
 *
 * Designed to be idempotent — re-running for the same date updates existing
 * records rather than creating duplicates, and skips orgs already reported.
 */

import cron from "node-cron";
import Stripe from "stripe";
import type { PrismaClient } from "@prisma/client";
import { reportUsageToStripe, isBillingEnabled } from "../middleware/billing.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DailyOrgUsage {
  organizationId: string;
  totalMinutes: number;
  callCount: number;
}

// ─── Aggregation Logic ──────────────────────────────────────────────────────

/**
 * Aggregates transcript minutes for all organizations for a given calendar day.
 * Uses call duration (stored in seconds) and falls back to word-count estimation
 * for calls without a duration field.
 */
async function aggregateDailyUsage(
  prisma: PrismaClient,
  date: Date
): Promise<DailyOrgUsage[]> {
  // Start and end of the target day (UTC)
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setUTCHours(23, 59, 59, 999);

  // Find all calls that have transcripts and were processed in the target day
  const calls = await prisma.call.findMany({
    where: {
      transcript: { isNot: null },
      createdAt: { gte: dayStart, lte: dayEnd },
    },
    select: {
      organizationId: true,
      duration: true,
      transcript: {
        select: { wordCount: true },
      },
    },
  });

  // Group by organization
  const orgMap = new Map<string, { totalSeconds: number; callCount: number }>();

  for (const call of calls) {
    const entry = orgMap.get(call.organizationId) ?? {
      totalSeconds: 0,
      callCount: 0,
    };

    // Use actual call duration if available, otherwise estimate from word count
    // Average speaking rate ~150 words/minute
    const durationSeconds = call.duration
      ? call.duration
      : call.transcript
        ? Math.ceil((call.transcript.wordCount / 150) * 60)
        : 0;

    entry.totalSeconds += durationSeconds;
    entry.callCount += 1;
    orgMap.set(call.organizationId, entry);
  }

  return Array.from(orgMap.entries()).map(([organizationId, data]) => ({
    organizationId,
    totalMinutes: Math.ceil(data.totalSeconds / 60),
    callCount: data.callCount,
  }));
}

// ─── Reporting Pipeline ─────────────────────────────────────────────────────

/**
 * Runs the full daily usage aggregation and Stripe reporting pipeline.
 * Can be called manually for backfills by passing a specific date.
 */
export async function runDailyUsageReport(
  prisma: PrismaClient,
  stripe: Stripe,
  targetDate?: Date
): Promise<{ processed: number; reported: number; errors: number }> {
  if (!isBillingEnabled()) {
    console.log("[usage-reporter] Billing disabled, skipping usage report");
    return { processed: 0, reported: 0, errors: 0 };
  }

  const date = targetDate ?? new Date(Date.now() - 24 * 60 * 60 * 1000); // yesterday
  const dateKey = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );

  console.log(`[usage-reporter] Aggregating usage for ${dateKey.toISOString().split("T")[0]}`);

  const orgUsages = await aggregateDailyUsage(prisma, date);
  let reported = 0;
  let errors = 0;

  for (const usage of orgUsages) {
    try {
      // Find or create the usage record (idempotent)
      const periodEnd = new Date(
        Date.UTC(dateKey.getUTCFullYear(), dateKey.getUTCMonth(), dateKey.getUTCDate(), 23, 59, 59, 999)
      );

      const existing = await prisma.usageRecord.findFirst({
        where: {
          organizationId: usage.organizationId,
          metric: "TRANSCRIPT_MINUTES",
          periodStart: dateKey,
        },
      });

      const record = existing
        ? await prisma.usageRecord.update({
            where: { id: existing.id },
            data: {
              quantity: usage.totalMinutes,
            },
          })
        : await prisma.usageRecord.create({
            data: {
              organizationId: usage.organizationId,
              metric: "TRANSCRIPT_MINUTES",
              quantity: usage.totalMinutes,
              periodStart: dateKey,
              periodEnd,
              reportedToStripe: false,
            },
          });

      // Skip if already reported to Stripe
      if (record.reportedToStripe) {
        console.log(
          `[usage-reporter] Skipping org=${usage.organizationId} (already reported)`
        );
        continue;
      }

      // Report to Stripe
      const timestamp = Math.floor(dateKey.getTime() / 1000);
      const stripeRecordId = await reportUsageToStripe(
        stripe,
        prisma,
        usage.organizationId,
        usage.totalMinutes,
        timestamp
      );

      if (stripeRecordId) {
        await prisma.usageRecord.update({
          where: { id: record.id },
          data: { reportedToStripe: true, stripeRecordId },
        });
        reported++;
        console.log(
          `[usage-reporter] Reported org=${usage.organizationId}: ${usage.totalMinutes} min, ${usage.callCount} calls`
        );
      }
    } catch (err) {
      errors++;
      console.error(
        `[usage-reporter] Error processing org=${usage.organizationId}:`,
        err
      );
    }
  }

  console.log(
    `[usage-reporter] Done: ${orgUsages.length} orgs processed, ${reported} reported to Stripe, ${errors} errors`
  );

  return { processed: orgUsages.length, reported, errors };
}

// ─── Cron Scheduler ─────────────────────────────────────────────────────────

/**
 * Starts the daily usage reporting cron job.
 * Runs at 02:00 UTC every day to aggregate the previous day's usage.
 */
export function startUsageReportingCron(
  prisma: PrismaClient,
  stripe: Stripe
): cron.ScheduledTask {
  const task = cron.schedule(
    "0 2 * * *", // 02:00 UTC daily
    async () => {
      try {
        await runDailyUsageReport(prisma, stripe);
      } catch (err) {
        console.error("[usage-reporter] Cron job failed:", err);
      }
    },
    { timezone: "UTC" }
  );

  console.log("[usage-reporter] Daily cron scheduled at 02:00 UTC");
  return task;
}
