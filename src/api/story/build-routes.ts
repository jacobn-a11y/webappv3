/**
 * Story Build Routes
 *
 * POST /build              — Build a story (synchronous)
 * POST /build/stream       — Build a story (SSE streaming)
 * POST /merge-transcripts  — Merge transcripts for an account
 */

import { Router, type Request, type Response } from "express";
import type { AuthenticatedRequest } from "../../types/authenticated-request.js";
import logger from "../../lib/logger.js";
import { z } from "zod";
import type { StoryBuilder, StoryBuilderOptions } from "../../services/story-builder.js";
import type { PrismaClient, TranscriptTruncationMode } from "@prisma/client";
import { TranscriptMerger } from "../../services/transcript-merger.js";
import type { AIClient } from "../../services/ai-client.js";
import type { AccountAccessService } from "../../services/account-access.js";
import type { RoleProfileService } from "../../services/role-profiles.js";
import { STORY_FORMATS } from "../../types/taxonomy.js";
import {
  STORY_LENGTHS,
  STORY_OUTLINES,
  STORY_TYPES,
  type StoryLength,
  type StoryOutline,
  type StoryTypeInput,
} from "../../types/story-generation.js";
import { mapGeneratedQuote } from "../../services/story-mappers.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { sendSuccess, sendBadRequest, sendUnauthorized, sendForbidden, sendError } from "../_shared/responses.js";

// ─── Validation ──────────────────────────────────────────────────────────────

const BuildStorySchema = z.object({
  account_id: z.string().min(1),
  funnel_stages: z.array(z.string()).optional(),
  filter_topics: z.array(z.string()).optional(),
  title: z.string().optional(),
  format: z.enum(STORY_FORMATS as unknown as [string, ...string[]]).optional(),
  story_length: z.enum(STORY_LENGTHS as unknown as [string, ...string[]]).optional(),
  story_outline: z.enum(STORY_OUTLINES as unknown as [string, ...string[]]).optional(),
  story_type: z.enum(STORY_TYPES as unknown as [string, ...string[]]).optional(),
  ai_provider: z.enum(["openai", "anthropic", "google"]).optional(),
  ai_model: z.string().min(1).max(120).optional(),
});

const MergeTranscriptsSchema = z.object({
  account_id: z.string().min(1),
  max_words: z.number().int().min(1000).optional(),
  truncation_mode: z.enum(["OLDEST_FIRST", "NEWEST_FIRST"]).optional(),
  after_date: z.string().datetime().optional(),
  before_date: z.string().datetime().optional(),
});

// ─── Route Registration ─────────────────────────────────────────────────────

interface RegisterBuildRoutesOptions {
  router: Router;
  prisma: PrismaClient;
  storyBuilder: StoryBuilder;
  accessService: AccountAccessService;
  roleProfiles: RoleProfileService;
  normalizeRole: (role: unknown) => "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  resolveStoryAIClient: (input: {
    organizationId: string;
    userId: string;
    userRole: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
    provider?: "openai" | "anthropic" | "google";
    model?: string;
  }) => Promise<{ client: AIClient; retryBudget: number }>;
  dispatchStoryEvent: (input: {
    organizationId: string;
    eventType: "story_generated" | "story_generation_failed";
    payload: Record<string, unknown>;
  }) => Promise<void>;
}

export function registerBuildRoutes({
  router,
  prisma,
  storyBuilder,
  accessService,
  roleProfiles,
  normalizeRole,
  resolveStoryAIClient,
  dispatchStoryEvent,
}: RegisterBuildRoutesOptions): void {
  router.post("/build", asyncHandler(async (req: Request, res: Response) => {
    const parseResult = BuildStorySchema.safeParse(req.body);
    if (!parseResult.success) {
      sendBadRequest(res, "validation_error", parseResult.error.issues);
      return;
    }

    const authReq = req as AuthenticatedRequest;
    const organizationId = authReq.organizationId!;
    const userId = authReq.userId!;
    const userRole = authReq.userRole;
    if (!organizationId || !userId) {
      sendUnauthorized(res, "Authentication required");
      return;
    }

    const {
      account_id,
      funnel_stages,
      filter_topics,
      title,
      format,
      story_length,
      story_outline,
      story_type,
      ai_provider,
      ai_model,
    } = parseResult.data;

    try {
      const [policy, canAccessAccount] = await Promise.all([
        roleProfiles.getEffectivePolicy(organizationId, userId, userRole),
        accessService.canAccessAccount(
          userId,
          organizationId,
          account_id,
          userRole
        ),
      ]);

      if (!policy.canGenerateAnonymousStories) {
        sendForbidden(res, "Your role cannot generate stories.");
        return;
      }

      if (!canAccessAccount) {
        sendForbidden(res, "You do not have access to this account.");
        return;
      }

      const result = await storyBuilder.buildStory({
        aiClient: (
          await resolveStoryAIClient({
            organizationId,
            userId,
            userRole: normalizeRole(userRole),
            provider: ai_provider,
            model: ai_model,
          })
        ).client,
        aiIdempotencyKey: `story-build:${organizationId}:${account_id}:${Date.now()}`,
        accountId: account_id,
        organizationId,
        funnelStages: funnel_stages as never[],
        filterTopics: filter_topics as never[],
        title,
        format: format as StoryBuilderOptions["format"] | undefined,
        storyLength: story_length as StoryLength | undefined,
        storyOutline: story_outline as StoryOutline | undefined,
        storyType: story_type as StoryTypeInput | undefined,
      });

      await dispatchStoryEvent({
        organizationId,
        eventType: "story_generated",
        payload: {
          story_id: result.storyId,
          story_title: result.title,
          account_id,
          mode: "build",
        },
      });

      sendSuccess(res, {
        story_id: result.storyId,
        title: result.title,
        markdown: result.markdownBody,
        quotes: result.quotes.map((q) => mapGeneratedQuote(q)),
      });
    } catch (err) {
      logger.error("Story build error", { error: err });
      const errorMessage = err instanceof Error ? err.message : "Failed to build story";
      await dispatchStoryEvent({
        organizationId,
        eventType: "story_generation_failed",
        payload: {
          account_id,
          mode: "build",
          error: errorMessage,
        },
      });
      sendError(res, 500, "internal_error", "Failed to build story");
    }
  }));

  router.post("/build/stream", asyncHandler(async (req: Request, res: Response) => {
    const parseResult = BuildStorySchema.safeParse(req.body);
    if (!parseResult.success) {
      sendBadRequest(res, "validation_error", parseResult.error.issues);
      return;
    }

    const authReq = req as AuthenticatedRequest;
    const organizationId = authReq.organizationId!;
    const userId = authReq.userId!;
    const userRole = authReq.userRole;
    if (!organizationId || !userId) {
      sendUnauthorized(res, "Authentication required");
      return;
    }

    const {
      account_id,
      funnel_stages,
      filter_topics,
      title,
      format,
      story_length,
      story_outline,
      story_type,
      ai_provider,
      ai_model,
    } = parseResult.data;

    try {
      const [policy, canAccessAccount] = await Promise.all([
        roleProfiles.getEffectivePolicy(organizationId, userId, userRole),
        accessService.canAccessAccount(userId, organizationId, account_id, userRole),
      ]);

      if (!policy.canGenerateAnonymousStories) {
        sendForbidden(res, "Your role cannot generate stories.");
        return;
      }

      if (!canAccessAccount) {
        sendForbidden(res, "You do not have access to this account.");
        return;
      }

      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
      }

      let closed = false;
      req.on("close", () => {
        closed = true;
      });

      const sendEvent = (event: string, payload: unknown) => {
        if (closed) return;
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      sendEvent("progress", { step: "STARTED" });

      const result = await storyBuilder.buildStory({
        aiClient: (
          await resolveStoryAIClient({
            organizationId,
            userId,
            userRole: normalizeRole(userRole),
            provider: ai_provider,
            model: ai_model,
          })
        ).client,
        aiIdempotencyKey: `story-build-stream:${organizationId}:${account_id}:${Date.now()}`,
        accountId: account_id,
        organizationId,
        funnelStages: funnel_stages as never[],
        filterTopics: filter_topics as never[],
        title,
        format: format as StoryBuilderOptions["format"] | undefined,
        storyLength: story_length as StoryLength | undefined,
        storyOutline: story_outline as StoryOutline | undefined,
        storyType: story_type as StoryTypeInput | undefined,
        onProgress: (step) => sendEvent("progress", { step }),
        onNarrativeToken: (token) => sendEvent("token", { token }),
      });

      await dispatchStoryEvent({
        organizationId,
        eventType: "story_generated",
        payload: {
          story_id: result.storyId,
          story_title: result.title,
          account_id,
          mode: "build_stream",
        },
      });

      sendEvent("complete", {
        story_id: result.storyId,
        title: result.title,
        markdown: result.markdownBody,
        quotes: result.quotes.map((q) => mapGeneratedQuote(q)),
      });

      if (!closed) {
        res.end();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to stream story build";
      await dispatchStoryEvent({
        organizationId,
        eventType: "story_generation_failed",
        payload: {
          account_id,
          mode: "build_stream",
          error: message,
        },
      });
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
      res.end();
    }
  }));

  const merger = new TranscriptMerger(prisma);

  router.post("/merge-transcripts", asyncHandler(async (req: Request, res: Response) => {
    const parseResult = MergeTranscriptsSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendBadRequest(res, "validation_error", parseResult.error.issues);
      return;
    }

    const authReq = req as AuthenticatedRequest;
    const organizationId = authReq.organizationId!;
    const userId = authReq.userId!;
    const userRole = authReq.userRole;
    if (!organizationId) {
      sendUnauthorized(res, "Authentication required");
      return;
    }

    const { account_id, max_words, truncation_mode, after_date, before_date } =
      parseResult.data;

      const [policy, canAccessAccount] = await Promise.all([
        roleProfiles.getEffectivePolicy(organizationId, userId, userRole),
        accessService.canAccessAccount(
          userId,
          organizationId,
          account_id,
          userRole
        ),
      ]);

      if (!policy.canGenerateAnonymousStories) {
        sendForbidden(res, "Your role cannot generate stories.");
        return;
      }

      if (!canAccessAccount) {
        sendForbidden(res, "You do not have access to this account.");
        return;
      }

      const result = await merger.mergeTranscripts({
        accountId: account_id,
        organizationId,
        maxWords: max_words,
        truncationMode: truncation_mode as TranscriptTruncationMode | undefined,
        afterDate: after_date ? new Date(after_date) : undefined,
        beforeDate: before_date ? new Date(before_date) : undefined,
      });

      sendSuccess(res, {
        markdown: result.markdown,
        word_count: result.wordCount,
        total_calls: result.totalCalls,
        included_calls: result.includedCalls,
        truncated: result.truncated,
        truncation_boundary: result.truncationBoundary?.toISOString() ?? null,
        truncation_mode: result.truncationMode,
      });

  }));
}
