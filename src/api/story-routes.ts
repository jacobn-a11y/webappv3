/**
 * Story Builder API Routes
 *
 * Endpoints for generating and retrieving Markdown case studies.
 * Story generation now supports provider/model selection and is
 * tracked via the AI usage system.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { PrismaClient, UserRole } from "@prisma/client";
import type { StoryBuilder } from "../services/story-builder.js";
import { AIConfigService, AIAccessDeniedError } from "../services/ai-config.js";
import {
  AIUsageTracker,
  TrackedAIClient,
  UsageLimitExceededError,
  InsufficientBalanceError,
} from "../services/ai-usage-tracker.js";
import type { AIProviderName } from "../services/ai-client.js";

// ─── Validation ──────────────────────────────────────────────────────────────

const BuildStorySchema = z.object({
  account_id: z.string().min(1),
  funnel_stages: z.array(z.string()).optional(),
  filter_topics: z.array(z.string()).optional(),
  title: z.string().optional(),
  provider: z.enum(["openai", "anthropic", "google"]).optional(),
  model: z.string().optional(),
});

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createStoryRoutes(
  prisma: PrismaClient,
  storyBuilder: StoryBuilder,
  configService: AIConfigService,
  usageTracker: AIUsageTracker
): Router {
  const router = Router();

  /**
   * POST /api/stories/build
   *
   * Generates a new Markdown story for an account.
   * Accepts optional provider/model selection.
   */
  router.post("/build", async (req: AuthReq, res: Response) => {
    const parseResult = BuildStorySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: "validation_error",
        details: parseResult.error.issues,
      });
      return;
    }

    const { organizationId, userId, userRole } = req;
    if (!organizationId || !userId || !userRole) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const { account_id, funnel_stages, filter_topics, title, provider, model } =
      parseResult.data;

    try {
      // Resolve AI client for this user (respects per-provider hybrid routing)
      const { client, isPlatformBilled } = await configService.resolveClient(
        organizationId,
        userId,
        userRole,
        { provider: provider as AIProviderName | undefined, model }
      );

      // Wrap with usage tracking and billing
      const trackedClient = new TrackedAIClient(
        client,
        usageTracker,
        { organizationId, userId, operation: "STORY_GENERATION" },
        isPlatformBilled
      );

      const result = await storyBuilder.buildStory(
        {
          accountId: account_id,
          organizationId,
          userId,
          funnelStages: funnel_stages as never[],
          filterTopics: filter_topics as never[],
          title,
        },
        trackedClient
      );

      res.json({
        title: result.title,
        markdown: result.markdownBody,
        ai_provider: client.providerName,
        ai_model: client.modelName,
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
      if (err instanceof AIAccessDeniedError) {
        res.status(403).json({ error: "ai_access_denied", message: err.message });
        return;
      }
      if (err instanceof UsageLimitExceededError) {
        res.status(429).json({ error: "usage_limit_exceeded", message: err.message });
        return;
      }
      if (err instanceof InsufficientBalanceError) {
        res.status(402).json({ error: "insufficient_balance", message: err.message });
        return;
      }
      console.error("Story build error:", err);
      res.status(500).json({ error: "Failed to build story" });
    }
  });

  /**
   * GET /api/stories/:accountId
   *
   * Retrieves all previously generated stories for an account.
   */
  router.get("/:accountId", async (req: AuthReq, res: Response) => {
    const organizationId = req.organizationId;
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
          ai_provider: s.aiProvider,
          ai_model: s.aiModel,
          generated_by: s.generatedById,
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

  return router;
}
