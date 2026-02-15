/**
 * Story Builder API Routes
 *
 * Endpoints for generating and retrieving Markdown case studies.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { StoryBuilder } from "../services/story-builder.js";
import type { PrismaClient } from "@prisma/client";
import logger from "../lib/logger.js";
import { metrics } from "../lib/metrics.js";
import { Sentry } from "../lib/sentry.js";

// ─── Validation ──────────────────────────────────────────────────────────────

const BuildStorySchema = z.object({
  account_id: z.string().min(1),
  funnel_stages: z.array(z.string()).optional(),
  filter_topics: z.array(z.string()).optional(),
  title: z.string().optional(),
});

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createStoryRoutes(
  storyBuilder: StoryBuilder,
  prisma: PrismaClient
): Router {
  const router = Router();

  /**
   * POST /api/stories/build
   *
   * Generates a new Markdown story for an account.
   */
  router.post("/build", async (req: Request, res: Response) => {
    const parseResult = BuildStorySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: "validation_error",
        details: parseResult.error.issues,
      });
      return;
    }

    const organizationId = (req as Record<string, unknown>).organizationId as string;
    if (!organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const { account_id, funnel_stages, filter_topics, title } =
      parseResult.data;

    try {
      const result = await storyBuilder.buildStory({
        accountId: account_id,
        organizationId,
        funnelStages: funnel_stages as never[],
        filterTopics: filter_topics as never[],
        title,
      });

      metrics.incrementStoriesGenerated();

      res.json({
        title: result.title,
        markdown: result.markdownBody,
        quotes: result.quotes.map((q) => ({
          speaker: q.speaker,
          quote_text: q.quoteText,
          context: q.context,
          metric_type: q.metricType,
          metric_value: q.metricValue,
          call_id: q.callId,
        })),
      });
    } catch (err) {
      logger.error("Story build error", { error: err });
      Sentry.captureException(err);
      res.status(500).json({ error: "Failed to build story" });
    }
  });

  /**
   * GET /api/stories/:accountId
   *
   * Retrieves all previously generated stories for an account.
   */
  router.get("/:accountId", async (req: Request, res: Response) => {
    const organizationId = (req as Record<string, unknown>).organizationId as string;
    if (!organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const stories = await prisma.story.findMany({
        where: {
          accountId: req.params.accountId,
          organizationId,
        },
        include: {
          quotes: true,
        },
        orderBy: { generatedAt: "desc" },
      });

      res.json({
        stories: stories.map((s) => ({
          id: s.id,
          title: s.title,
          story_type: s.storyType,
          funnel_stages: s.funnelStages,
          filter_tags: s.filterTags,
          generated_at: s.generatedAt.toISOString(),
          markdown: s.markdownBody,
          quotes: s.quotes.map((q) => ({
            speaker: q.speaker,
            quote_text: q.quoteText,
            context: q.context,
            metric_type: q.metricType,
            metric_value: q.metricValue,
          })),
        })),
      });
    } catch (err) {
      logger.error("Story retrieval error", { error: err });
      Sentry.captureException(err);
      res.status(500).json({ error: "Failed to retrieve stories" });
    }
  });

  return router;
}
