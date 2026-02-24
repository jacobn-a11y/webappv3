/**
 * Story Builder API Routes
 *
 * Endpoints for generating and retrieving Markdown case studies.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import type { StoryBuilder, StoryBuilderOptions } from "../services/story-builder.js";
import type {
  PrismaClient,
  TranscriptTruncationMode,
  HighValueQuote,
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
      input.userRole
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

  router.post("/build", async (req: Request, res: Response) => {
    const parseResult = BuildStorySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: "validation_error",
        details: parseResult.error.issues,
      });
      return;
    }

    const organizationId = (req as unknown as Record<string, unknown>).organizationId as string;
    const userId = (req as unknown as Record<string, unknown>).userId as string;
    const userRole = (req as unknown as Record<string, unknown>).userRole as
      | "OWNER"
      | "ADMIN"
      | "MEMBER"
      | "VIEWER"
      | undefined;
    if (!organizationId) {
      res.status(401).json({ error: "Authentication required" });
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
        res.status(403).json({
          error: "permission_denied",
          message: "Your role cannot generate stories.",
        });
        return;
      }

      if (!canAccessAccount) {
        res.status(403).json({
          error: "permission_denied",
          message: "You do not have access to this account.",
        });
        return;
      }

      const result = await storyBuilder.buildStory({
        aiClient: (
          await resolveStoryAIClient({
            organizationId,
            userId,
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

      res.json({
        story_id: result.storyId,
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

  router.post("/build/stream", async (req: Request, res: Response) => {
    const parseResult = BuildStorySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: "validation_error",
        details: parseResult.error.issues,
      });
      return;
    }

    const organizationId = (req as unknown as Record<string, unknown>).organizationId as string;
    const userId = (req as unknown as Record<string, unknown>).userId as string;
    const userRole = (req as unknown as Record<string, unknown>).userRole as
      | "OWNER"
      | "ADMIN"
      | "MEMBER"
      | "VIEWER"
      | undefined;
    if (!organizationId) {
      res.status(401).json({ error: "Authentication required" });
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
        res.status(403).json({
          error: "permission_denied",
          message: "Your role cannot generate stories.",
        });
        return;
      }

      if (!canAccessAccount) {
        res.status(403).json({
          error: "permission_denied",
          message: "You do not have access to this account.",
        });
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

      sendEvent("complete", {
        story_id: result.storyId,
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

      if (!closed) {
        res.end();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to stream story build";
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
      res.end();
    }
  });

  router.get("/library", async (req: Request, res: Response) => {
    const parse = StoryLibraryQuerySchema.safeParse(req.query);
    if (!parse.success) {
      res.status(400).json({ error: "validation_error", details: parse.error.issues });
      return;
    }

    const organizationId = (req as unknown as Record<string, unknown>).organizationId as string;
    const userId = (req as unknown as Record<string, unknown>).userId as string;
    const userRole = (req as unknown as Record<string, unknown>).userRole as
      | "OWNER"
      | "ADMIN"
      | "MEMBER"
      | "VIEWER"
      | undefined;

    if (!organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const policy = await roleProfiles.getEffectivePolicy(organizationId, userId, userRole);
      if (!policy.canAccessAnonymousStories) {
        res.status(403).json({
          error: "permission_denied",
          message: "Your role cannot access stories.",
        });
        return;
      }

      const accessibleIds = await accessService.getAccessibleAccountIds(
        userId,
        organizationId,
        userRole
      );

      if (accessibleIds !== null && accessibleIds.length === 0) {
        res.json({
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

      res.json({
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
    } catch (err) {
      console.error("Story library error:", err);
      res.status(500).json({ error: "Failed to load story library" });
    }
  });

  router.get("/:storyId/export", async (req: Request, res: Response) => {
    const parse = ExportQuerySchema.safeParse(req.query);
    if (!parse.success) {
      res.status(400).json({ error: "validation_error", details: parse.error.issues });
      return;
    }

    const organizationId = (req as unknown as Record<string, unknown>).organizationId as string;
    const userId = (req as unknown as Record<string, unknown>).userId as string;
    const userRole = (req as unknown as Record<string, unknown>).userRole as
      | "OWNER"
      | "ADMIN"
      | "MEMBER"
      | "VIEWER"
      | undefined;

    if (!organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
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
        res.status(403).json({
          error: "permission_denied",
          message: "Your role cannot access stories.",
        });
        return;
      }

      if (!story) {
        res.status(404).json({ error: "Story not found" });
        return;
      }

      const canAccessAccount = await accessService.canAccessAccount(
        userId,
        organizationId,
        story.accountId,
        userRole
      );

      if (!canAccessAccount) {
        res.status(403).json({
          error: "permission_denied",
          message: "You do not have access to this story.",
        });
        return;
      }

      const format = parse.data.format;
      const filename = sanitizeFileName(story.title || `story-${story.id}`);

      if (format === "pdf") {
        const pdfBuffer = await markdownToPdfBuffer(story.title, story.markdownBody);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=\"${filename}.pdf\"`);
        res.send(Buffer.from(pdfBuffer));
        return;
      }

      const docxBuffer = await markdownToDocxBuffer(story.title, story.markdownBody);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      res.setHeader("Content-Disposition", `attachment; filename=\"${filename}.docx\"`);
      res.send(Buffer.from(docxBuffer));
    } catch (err) {
      console.error("Story export error:", err);
      res.status(500).json({ error: "Failed to export story" });
    }
  });

  router.delete("/:storyId", async (req: Request, res: Response) => {
    const organizationId = (req as unknown as Record<string, unknown>).organizationId as string;
    const userId = (req as unknown as Record<string, unknown>).userId as string;
    const userRole = (req as unknown as Record<string, unknown>).userRole as
      | "OWNER"
      | "ADMIN"
      | "MEMBER"
      | "VIEWER"
      | undefined;

    if (!organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
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
        res.status(403).json({
          error: "permission_denied",
          message: "Your role cannot delete stories.",
        });
        return;
      }

      if (!story) {
        res.status(404).json({ error: "Story not found" });
        return;
      }

      const canAccessAccount = await accessService.canAccessAccount(
        userId,
        organizationId,
        story.accountId,
        userRole
      );

      if (!canAccessAccount) {
        res.status(403).json({
          error: "permission_denied",
          message: "You do not have access to this story.",
        });
        return;
      }

      if (story._count.landingPages > 0) {
        res.status(409).json({
          error: "story_has_pages",
          message: "Cannot delete a story that already has landing pages.",
        });
        return;
      }

      await prisma.story.delete({ where: { id: story.id } });
      res.json({ deleted: true });
    } catch (err) {
      console.error("Story delete error:", err);
      res.status(500).json({ error: "Failed to delete story" });
    }
  });

  router.get("/:accountId", async (req: Request, res: Response) => {
    const organizationId = (req as unknown as Record<string, unknown>).organizationId as string;
    const userId = (req as unknown as Record<string, unknown>).userId as string;
    const userRole = (req as unknown as Record<string, unknown>).userRole as
      | "OWNER"
      | "ADMIN"
      | "MEMBER"
      | "VIEWER"
      | undefined;
    if (!organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
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
        res.status(403).json({
          error: "permission_denied",
          message: "Your role cannot access stories.",
        });
        return;
      }

      if (!canAccessAccount) {
        res.status(403).json({
          error: "permission_denied",
          message: "You do not have access to this account.",
        });
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

      res.json({
        stories: stories.map((s) => mapStorySummary(s)),
      });
    } catch (err) {
      console.error("Story retrieval error:", err);
      res.status(500).json({ error: "Failed to retrieve stories" });
    }
  });

  const merger = new TranscriptMerger(prisma);

  router.post("/merge-transcripts", async (req: Request, res: Response) => {
    const parseResult = MergeTranscriptsSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: "validation_error",
        details: parseResult.error.issues,
      });
      return;
    }

    const organizationId = (req as unknown as Record<string, unknown>).organizationId as string;
    const userId = (req as unknown as Record<string, unknown>).userId as string;
    const userRole = (req as unknown as Record<string, unknown>).userRole as
      | "OWNER"
      | "ADMIN"
      | "MEMBER"
      | "VIEWER"
      | undefined;
    if (!organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const { account_id, max_words, truncation_mode, after_date, before_date } =
      parseResult.data;

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
        res.status(403).json({
          error: "permission_denied",
          message: "Your role cannot generate stories.",
        });
        return;
      }

      if (!canAccessAccount) {
        res.status(403).json({
          error: "permission_denied",
          message: "You do not have access to this account.",
        });
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

function mapStorySummary(s: {
  id: string;
  title: string;
  storyType: string;
  funnelStages: string[];
  filterTags: string[];
  generatedAt: Date;
  markdownBody: string;
  quotes: HighValueQuote[];
  landingPages: Array<{ id: string; status: string; publishedAt: Date | null }>;
}) {
  return {
    story_status:
      s.landingPages.length === 0
        ? "DRAFT"
        : s.landingPages[0]?.status === "PUBLISHED"
          ? "PUBLISHED"
          : s.landingPages[0]?.status === "ARCHIVED"
            ? "ARCHIVED"
            : "PAGE_CREATED",
    id: s.id,
    title: s.title,
    story_type: s.storyType,
    funnel_stages: s.funnelStages,
    filter_tags: s.filterTags,
    generated_at: s.generatedAt.toISOString(),
    markdown: s.markdownBody,
    landing_page:
      s.landingPages[0] == null
        ? null
        : {
            id: s.landingPages[0].id,
            status: s.landingPages[0].status,
            published_at: s.landingPages[0].publishedAt?.toISOString() ?? null,
          },
    quotes: s.quotes.map((q) => ({
      speaker: q.speaker,
      quote_text: q.quoteText,
      context: q.context,
      metric_type: q.metricType,
      metric_value: q.metricValue,
      call_id: q.callId ?? undefined,
    })),
  };
}

function sanitizeFileName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function markdownToPlainLines(markdown: string): Array<{ text: string; level: 0 | 1 | 2 | 3 }> {
  return markdown
    .split(/\r?\n/)
    .map((raw) => {
      if (raw.trim().length === 0) {
        return { text: "", level: 0 as const };
      }
      if (raw.startsWith("### ")) {
        return { text: raw.slice(4).trim(), level: 3 as const };
      }
      if (raw.startsWith("## ")) {
        return { text: raw.slice(3).trim(), level: 2 as const };
      }
      if (raw.startsWith("# ")) {
        return { text: raw.slice(2).trim(), level: 1 as const };
      }
      return {
        text: raw
          .replace(/\*\*(.*?)\*\*/g, "$1")
          .replace(/\*(.*?)\*/g, "$1")
          .replace(/`(.*?)`/g, "$1")
          .replace(/^[-*+]\s+/, "- ")
          .replace(/^>\s+/, "")
          .replace(/\[(.*?)\]\((.*?)\)/g, "$1"),
        level: 0 as const,
      };
    });
}

function wrapText(text: string, maxWidth: number, font: any, size: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = words[0] ?? "";

  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    const width = font.widthOfTextAtSize(candidate, size);
    if (width <= maxWidth) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }

  lines.push(current);
  return lines;
}

async function markdownToPdfBuffer(title: string, markdown: string): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 50;
  const width = 612;
  const height = 792;
  let page = pdfDoc.addPage([width, height]);
  let y = height - margin;

  const drawLine = (text: string, opts?: { level?: 0 | 1 | 2 | 3 }) => {
    const level = opts?.level ?? 0;
    const size = level === 1 ? 20 : level === 2 ? 16 : level === 3 ? 13 : 11;
    const activeFont = level > 0 ? boldFont : font;
    const lineHeight = size * 1.35;
    const maxWidth = width - margin * 2;

    const wrapped = wrapText(text, maxWidth, activeFont, size);
    for (const line of wrapped) {
      if (y < margin + lineHeight) {
        page = pdfDoc.addPage([width, height]);
        y = height - margin;
      }
      page.drawText(line, {
        x: margin,
        y,
        size,
        font: activeFont,
        color: rgb(0.08, 0.1, 0.16),
      });
      y -= lineHeight;
    }

    y -= level > 0 ? 6 : 2;
  };

  drawLine(title, { level: 1 });
  for (const line of markdownToPlainLines(markdown)) {
    if (line.text.length === 0) {
      y -= 8;
      continue;
    }
    drawLine(line.text, { level: line.level });
  }

  return pdfDoc.save();
}

async function markdownToDocxBuffer(title: string, markdown: string): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun(title)],
    }),
  ];

  for (const line of markdownToPlainLines(markdown)) {
    if (line.text.length === 0) {
      children.push(new Paragraph({ children: [new TextRun("")] }));
      continue;
    }

    if (line.level === 1) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun(line.text)],
        })
      );
      continue;
    }

    if (line.level === 2) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun(line.text)],
        })
      );
      continue;
    }

    if (line.level === 3) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: [new TextRun(line.text)],
        })
      );
      continue;
    }

    children.push(
      new Paragraph({
        children: [new TextRun(line.text)],
      })
    );
  }

  const doc = new Document({
    sections: [
      {
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
