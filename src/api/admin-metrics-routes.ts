/**
 * Admin Metrics API Route
 *
 * Exposes operational metrics at /api/admin/metrics for monitoring dashboards.
 * Combines in-process counters (since last restart) with database-sourced
 * totals for a complete picture.
 *
 * Metrics exposed:
 *   - Total calls ingested (DB)
 *   - Transcripts processed (DB)
 *   - Stories generated (DB)
 *   - Landing pages published (DB)
 *   - RAG queries served (in-process counter)
 *   - Entity resolution hit rates by method (in-process)
 *   - Average tagging confidence by funnel stage (DB)
 */

import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { metrics } from "../lib/metrics.js";
import logger from "../lib/logger.js";
import { getOrganizationIdOrThrow, TenantGuardError } from "../lib/tenant-guard.js";

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createAdminMetricsRoutes(prisma: PrismaClient): Router {
  const router = Router();

  /**
   * GET /api/admin/metrics
   *
   * Returns a combined view of database totals and in-process runtime metrics.
   */
  router.get("/", async (req: Request, res: Response) => {
    try {
      const organizationId = getOrganizationIdOrThrow(req);

      // Query database totals in parallel
      const [
        totalCalls,
        totalTranscripts,
        totalStories,
        publishedPages,
        tagConfidenceByStage,
      ] = await Promise.all([
        prisma.call.count({ where: { organizationId } }),
        prisma.transcript.count({
          where: { call: { organizationId } },
        }),
        prisma.story.count({ where: { organizationId } }),
        prisma.landingPage.count({
          where: { organizationId, status: "PUBLISHED" },
        }),
        prisma.callTag.groupBy({
          by: ["funnelStage"],
          where: { call: { organizationId } },
          _avg: { confidence: true },
          _count: true,
        }),
      ]);

      // Get in-process runtime metrics
      const runtimeMetrics = metrics.getSnapshot();

      // Build tagging confidence from DB (authoritative, includes all-time data)
      const dbTaggingConfidence: Record<
        string,
        { count: number; average_confidence: number }
      > = {};
      for (const row of tagConfidenceByStage) {
        dbTaggingConfidence[row.funnelStage] = {
          count: row._count,
          average_confidence:
            Math.round((row._avg.confidence ?? 0) * 1000) / 1000,
        };
      }

      res.json({
        timestamp: new Date().toISOString(),
        uptime_seconds: runtimeMetrics.uptime_seconds,
        database_totals: {
          calls_ingested: totalCalls,
          transcripts_processed: totalTranscripts,
          stories_generated: totalStories,
          landing_pages_published: publishedPages,
        },
        runtime_counters: {
          rag_queries_served: runtimeMetrics.counters.rag_queries_served,
          calls_ingested_since_restart:
            runtimeMetrics.counters.calls_ingested,
          transcripts_processed_since_restart:
            runtimeMetrics.counters.transcripts_processed,
          stories_generated_since_restart:
            runtimeMetrics.counters.stories_generated,
          landing_pages_published_since_restart:
            runtimeMetrics.counters.landing_pages_published,
        },
        entity_resolution: runtimeMetrics.entity_resolution,
        tagging_confidence: {
          all_time: dbTaggingConfidence,
          since_restart: runtimeMetrics.tagging_confidence,
        },
        queue_observability: runtimeMetrics.queue_observability,
      });
    } catch (err) {
      if (err instanceof TenantGuardError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      logger.error("Failed to collect admin metrics", { error: err });
      res.status(500).json({ error: "Failed to collect metrics" });
    }
  });

  return router;
}
