/**
 * Story Builder API Routes
 *
 * Endpoints for generating and retrieving Markdown case studies.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { StoryBuilder } from "../services/story-builder.js";
import type { PrismaClient, TranscriptTruncationMode } from "@prisma/client";
import { TranscriptMerger } from "../services/transcript-merger.js";

// ─── Validation ──────────────────────────────────────────────────────────────

const BuildStorySchema = z.object({
  account_id: z.string().min(1),
  funnel_stages: z.array(z.string()).optional(),
  filter_topics: z.array(z.string()).optional(),
  title: z.string().optional(),
});

const MergeTranscriptsSchema = z.object({
  account_id: z.string().min(1),
  max_words: z.number().int().min(1000).optional(),
  truncation_mode: z.enum(["OLDEST_FIRST", "NEWEST_FIRST"]).optional(),
  after_date: z.string().datetime().optional(),
  before_date: z.string().datetime().optional(),
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
      console.error("Story build error:", err);
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
      console.error("Story retrieval error:", err);
      res.status(500).json({ error: "Failed to retrieve stories" });
    }
  });

  // ── Transcript Merging ───────────────────────────────────────────────

  const merger = new TranscriptMerger(prisma);

  /**
   * POST /api/stories/merge-transcripts
   *
   * Merges all transcripts for an account into a single Markdown document.
   * Respects org-level word count limits and truncation settings.
   * Returns the merged markdown plus metadata about truncation.
   */
  router.post("/merge-transcripts", async (req: Request, res: Response) => {
    const parseResult = MergeTranscriptsSchema.safeParse(req.body);
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

    const { account_id, max_words, truncation_mode, after_date, before_date } =
      parseResult.data;

    try {
      const result = await merger.mergeTranscripts({
        accountId: account_id,
        organizationId,
        maxWords: max_words,
        truncationMode: truncation_mode as TranscriptTruncationMode | undefined,
        afterDate: after_date ? new Date(after_date) : undefined,
        beforeDate: before_date ? new Date(before_date) : undefined,
      });

      res.json({
        markdown: result.markdown,
        word_count: result.wordCount,
        total_calls: result.totalCalls,
        included_calls: result.includedCalls,
        truncated: result.truncated,
        truncation_boundary: result.truncationBoundary?.toISOString() ?? null,
        truncation_mode: result.truncationMode,
      });
    } catch (err) {
      console.error("Transcript merge error:", err);
      res.status(500).json({ error: "Failed to merge transcripts" });
    }
  });

  return router;
}
