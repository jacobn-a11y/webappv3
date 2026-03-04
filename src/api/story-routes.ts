/**
 * Story Builder API Routes
 *
 * Endpoints for generating and retrieving Markdown case studies.
 */

import { Router, type Request, type Response } from "express";
import type { AuthenticatedRequest } from "../types/authenticated-request.js";
import logger from "../lib/logger.js";
import { z } from "zod";
import { markdownToPdfBuffer, markdownToDocxBuffer, sanitizeFileName } from "../services/story-exports.js";
import type { StoryBuilder, StoryBuilderOptions } from "../services/story-builder.js";
import type {
  PrismaClient,
  TranscriptTruncationMode,
  UserRole,
} from "@prisma/client";
import { TranscriptMerger } from "../services/transcript-merger.js";
import { AccountAccessService } from "../services/account-access.js";
import { RoleProfileService } from "../services/role-profiles.js";
import { AIConfigService } from "../services/ai-config.js";
import { AIUsageTracker, TrackedAIClient } from "../services/ai-usage-tracker.js";
import { FailoverAIClient } from "../services/ai-resilience.js";
import { STORY_FORMATS } from "../types/taxonomy.js";
import {
  STORY_LENGTHS,
  STORY_OUTLINES,
  STORY_TYPES,
  type StoryLength,
  type StoryOutline,
  type StoryTypeInput,
} from "../types/story-generation.js";
import { dispatchOutboundWebhookEvent } from "../services/outbound-webhooks.js";
import { mapStorySummary, mapGeneratedQuote } from "../services/story-mappers.js";
import { asyncHandler } from "../lib/async-handler.js";
import { sendSuccess, sendBadRequest, sendUnauthorized, sendForbidden, sendNotFound, sendConflict, sendError } from "./_shared/responses.js";

const BuildStorySchema = z.object({
  account_id: z.string().min(1),
  funnel_stages: z.array(z.string()).optional(),
  filter_topics: z.array(z.string()).optional(),
  title: z.string().optional(),
  format: z.enum(STORY_FORMATS as unknown as [string, ...string[]]).optional(),
  story_length: z.enum(STORY_LENGTHS as unknown as [string, ...string[]]).optional(),
  story_outline: z.enum(STORY_OUTLINES as unknown as [string, ...string[]]).optional(),
  story_type: z.enum(STORY_TYPES as unknown as [string, ...string[]]).optional(),
});

const MergeTranscriptsSchema = z.object({
  account_id: z.string().min(1),
  max_words: z.number().int().min(1000).optional(),
  truncation_mode: z.enum(["OLDEST_FIRST", "NEWEST_FIRST"]).optional(),
  after_date: z.string().datetime().optional(),
  before_date: z.string().datetime().optional(),
});

const StoryLibraryQuerySchema = z.object({
  search: z.string().max(200).optional(),
  story_type: z
    .enum([
      "FULL_JOURNEY",
      "ONBOARDING",
      "ROI_ANALYSIS",
      "COMPETITIVE_WIN",
      "EXPANSION",
      "CUSTOM",
    ])
    .optional(),
  status: z.enum(["DRAFT", "PAGE_CREATED", "PUBLISHED", "ARCHIVED"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const ExportQuerySchema = z.object({
  format: z.enum(["pdf", "docx"]).default("pdf"),
});

export function createStoryRoutes(
  storyBuilder: StoryBuilder,
  prisma: PrismaClient,
  aiConfigService: AIConfigService,
  aiUsageTracker: AIUsageTracker
): Router {
  const router = Router();
  const accessService = new AccountAccessService(prisma);
  const roleProfiles = new RoleProfileService(prisma);

  const normalizeRole = (role: unknown): UserRole => {
    if (
      role === "OWNER" ||
      role === "ADMIN" ||
      role === "MEMBER" ||
      role === "VIEWER"
    ) {
      return role;
    }
    return "MEMBER";
  };

  const resolveStoryAIClient = async (input: {
    organizationId: string;
    userId: string;
    userRole: UserRole;
  }) => {
    const resolved = await aiConfigService.resolveClientWithFailover(
      input.organizationId,
      input.userId,
      input.userRole,
      { operation: "STORY_GENERATION" }
    );

    const primaryTracked = new TrackedAIClient(
      resolved.primary.client,
      aiUsageTracker,
      {
        organizationId: input.organizationId,
        userId: input.userId,
        operation: "STORY_GENERATION",
      },
      resolved.primary.isPlatformBilled
    );

    const fallbackTracked = resolved.fallback
      ? new TrackedAIClient(
          resolved.fallback.client,
          aiUsageTracker,
          {
            organizationId: input.organizationId,
            userId: input.userId,
            operation: "STORY_GENERATION",
          },
          resolved.fallback.isPlatformBilled
        )
      : null;

    const client = new FailoverAIClient(primaryTracked, fallbackTracked, {
      failureThreshold: 3,
      cooldownMs: 60_000,
      maxAttempts: resolved.retryBudget,
      circuitKey: `story:${input.organizationId}:${resolved.primary.provider}`,
    });

    return { client, retryBudget: resolved.retryBudget };
  };

  const dispatchStoryEvent = async (
    input: {
      organizationId: string;
      eventType: "story_generated" | "story_generation_failed";
      payload: Record<string, unknown>;
    }
  ): Promise<void> => {
    await dispatchOutboundWebhookEvent(prisma, input).catch((err) => {
      logger.warn("Story outbound webhook dispatch failed", { error: err });
    });
  };

  router.post("/build", asyncHandler(async (req: Request, res: Response) => {
    const parseResult = BuildStorySchema.safeParse(req.body);
    if (!parseResult.success) {
      sendBadRequest(res, "validation_error", parseResult.error.issues);
      return;
    }

    const authReq = req as AuthenticatedRequest;
    const organizationId = authReq.organizationId;
    const userId = authReq.userId;
    const userRole = authReq.userRole;
    if (!organizationId) {
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
            userId: userId!,
            userRole: normalizeRole(userRole),
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
    const organizationId = authReq.organizationId;
    const userId = authReq.userId;
    const userRole = authReq.userRole;
    if (!organizationId) {
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
      res.setHeader("Cache-Control", "no-cache, no-transform");
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

  router.get("/library", asyncHandler(async (req: Request, res: Response) => {
    const parse = StoryLibraryQuerySchema.safeParse(req.query);
    if (!parse.success) {
      sendBadRequest(res, "validation_error", parse.error.issues);
      return;
    }

    const authReq = req as AuthenticatedRequest;
    const organizationId = authReq.organizationId;
    const userId = authReq.userId;
    const userRole = authReq.userRole;

    if (!organizationId) {
      sendUnauthorized(res, "Authentication required");
      return;
    }

      const policy = await roleProfiles.getEffectivePolicy(organizationId, userId, userRole);
      if (!policy.canAccessAnonymousStories) {
        sendForbidden(res, "Your role cannot access stories.");
        return;
      }

      const accessibleIds = await accessService.getAccessibleAccountIds(
        userId,
        organizationId,
        userRole
      );

      if (accessibleIds !== null && accessibleIds.length === 0) {
        sendSuccess(res, {
          stories: [],
          pagination: { page: 1, limit: 25, totalCount: 0, totalPages: 0 },
        });
        return;
      }

      const limit = parse.data.limit ?? 25;
      const page = parse.data.page ?? 1;
      const where: Record<string, unknown> = {
        organizationId,
      };

      if (accessibleIds !== null) {
        where.accountId = { in: accessibleIds };
      }

      if (parse.data.story_type) {
        where.storyType = parse.data.story_type;
      }

      if (parse.data.status) {
        if (parse.data.status === "DRAFT") {
          where.landingPages = { none: {} };
        }
        if (parse.data.status === "PAGE_CREATED") {
          where.landingPages = { some: { status: "DRAFT" } };
        }
        if (parse.data.status === "PUBLISHED") {
          where.landingPages = { some: { status: "PUBLISHED" } };
        }
        if (parse.data.status === "ARCHIVED") {
          where.landingPages = { some: { status: "ARCHIVED" } };
        }
      }

      if (parse.data.search && parse.data.search.trim().length > 0) {
        const needle = parse.data.search.trim();
        where.OR = [
          { title: { contains: needle, mode: "insensitive" } },
          { markdownBody: { contains: needle, mode: "insensitive" } },
          { account: { name: { contains: needle, mode: "insensitive" } } },
          { account: { domain: { contains: needle, mode: "insensitive" } } },
          {
            quotes: {
              some: {
                quoteText: { contains: needle, mode: "insensitive" },
              },
            },
          },
          {
            quotes: {
              some: {
                metricValue: { contains: needle, mode: "insensitive" },
              },
            },
          },
          {
            quotes: {
              some: {
                metricType: { contains: needle, mode: "insensitive" },
              },
            },
          },
        ];
      }

      const [totalCount, stories] = await Promise.all([
        prisma.story.count({ where }),
        prisma.story.findMany({
          where,
          include: {
            account: {
              select: {
                id: true,
                name: true,
                domain: true,
              },
            },
            quotes: true,
            landingPages: {
              select: {
                id: true,
                slug: true,
                status: true,
                publishedAt: true,
                createdAt: true,
              },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
          orderBy: { generatedAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);

      const totalPages = Math.ceil(totalCount / limit);

      sendSuccess(res, {
        stories: stories.map((s) => ({
          ...mapStorySummary(s),
          account: {
            id: s.account.id,
            name: s.account.name,
            domain: s.account.domain,
          },
        })),
        pagination: {
          page,
          limit,
          totalCount,
          totalPages,
        },
      });
    
  }));

  router.get("/:storyId/export", asyncHandler(async (req: Request, res: Response) => {
    const parse = ExportQuerySchema.safeParse(req.query);
    if (!parse.success) {
      sendBadRequest(res, "validation_error", parse.error.issues);
      return;
    }

    const authReq = req as AuthenticatedRequest;
    const organizationId = authReq.organizationId;
    const userId = authReq.userId;
    const userRole = authReq.userRole;

    if (!organizationId) {
      sendUnauthorized(res, "Authentication required");
      return;
    }

      const [policy, story] = await Promise.all([
        roleProfiles.getEffectivePolicy(organizationId, userId, userRole),
        prisma.story.findFirst({
          where: {
            id: req.params.storyId as string,
            organizationId,
          },
          select: {
            id: true,
            accountId: true,
            title: true,
            markdownBody: true,
          },
        }),
      ]);

      if (!policy.canAccessAnonymousStories) {
        sendForbidden(res, "Your role cannot access stories.");
        return;
      }

      if (!story) {
        sendNotFound(res, "Story not found");
        return;
      }

      const canAccessAccount = await accessService.canAccessAccount(
        userId,
        organizationId,
        story.accountId,
        userRole
      );

      if (!canAccessAccount) {
        sendForbidden(res, "You do not have access to this story.");
        return;
      }

      const format = parse.data.format;
      const filename = sanitizeFileName(story.title || `story-${story.id}`);

      if (format === "pdf") {
        const pdfBuffer = await markdownToPdfBuffer(story.title, story.markdownBody);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
        res.send(Buffer.from(pdfBuffer));
        return;
      }

      const docxBuffer = await markdownToDocxBuffer(story.title, story.markdownBody);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.docx"`);
      res.send(Buffer.from(docxBuffer));
    
  }));

  router.delete("/:storyId", asyncHandler(async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const organizationId = authReq.organizationId;
    const userId = authReq.userId;
    const userRole = authReq.userRole;

    if (!organizationId) {
      sendUnauthorized(res, "Authentication required");
      return;
    }

      const [policy, story] = await Promise.all([
        roleProfiles.getEffectivePolicy(organizationId, userId, userRole),
        prisma.story.findFirst({
          where: { id: req.params.storyId as string, organizationId },
          select: {
            id: true,
            accountId: true,
            _count: { select: { landingPages: true } },
          },
        }),
      ]);

      if (!policy.canGenerateAnonymousStories) {
        sendForbidden(res, "Your role cannot delete stories.");
        return;
      }

      if (!story) {
        sendNotFound(res, "Story not found");
        return;
      }

      const canAccessAccount = await accessService.canAccessAccount(
        userId,
        organizationId,
        story.accountId,
        userRole
      );

      if (!canAccessAccount) {
        sendForbidden(res, "You do not have access to this story.");
        return;
      }

      if (story._count.landingPages > 0) {
        sendConflict(res, "Cannot delete a story that already has landing pages.");
        return;
      }

      await prisma.story.delete({ where: { id: story.id } });
      sendSuccess(res, { deleted: true });
    
  }));

  router.get("/:accountId", asyncHandler(async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const organizationId = authReq.organizationId;
    const userId = authReq.userId;
    const userRole = authReq.userRole;
    if (!organizationId) {
      sendUnauthorized(res, "Authentication required");
      return;
    }

      const [policy, canAccessAccount] = await Promise.all([
        roleProfiles.getEffectivePolicy(organizationId, userId, userRole),
        accessService.canAccessAccount(
          userId,
          organizationId,
          req.params.accountId as string,
          userRole
        ),
      ]);

      if (!policy.canAccessAnonymousStories) {
        sendForbidden(res, "Your role cannot access stories.");
        return;
      }

      if (!canAccessAccount) {
        sendForbidden(res, "You do not have access to this account.");
        return;
      }

      const stories = await prisma.story.findMany({
        where: {
          accountId: req.params.accountId as string,
          organizationId,
        },
        include: {
          quotes: true,
          landingPages: {
            select: {
              id: true,
              slug: true,
              status: true,
              publishedAt: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
        orderBy: { generatedAt: "desc" },
      });

      sendSuccess(res, {
        stories: stories.map((s) => mapStorySummary(s)),
      });
    
  }));

  const merger = new TranscriptMerger(prisma);

  router.post("/merge-transcripts", asyncHandler(async (req: Request, res: Response) => {
    const parseResult = MergeTranscriptsSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendBadRequest(res, "validation_error", parseResult.error.issues);
      return;
    }

    const authReq = req as AuthenticatedRequest;
    const organizationId = authReq.organizationId;
    const userId = authReq.userId;
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

  return router;
}
