/**
 * Story Query Service
 *
 * Encapsulates all read / delete Prisma operations for stories,
 * story library queries, and story comment threads.
 *
 * Keeps route handlers free of direct `prisma.*` calls.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import { LifecycleStageService } from "./lifecycle-stage-service.js";
import type { LifecycleStage } from "./lifecycle-stage.js";
import type { RAGEngine } from "./rag-engine.js";

// ─── Library types ───────────────────────────────────────────────────────────

export interface StoryLibraryFilters {
  organizationId: string;
  /** When provided, restrict to these account IDs (RBAC scoping). */
  accessibleAccountIds?: string[] | null;
  storyType?: string;
  status?: LifecycleStage;
  topics?: string[];
  funnelStages?: string[];
  includeArchived?: boolean;
  search?: string;
  searchMode?: "keyword" | "semantic";
  semanticAccountIds?: string[];
  page?: number;
  limit?: number;
}

export interface StoryLibraryResult {
  stories: StoryWithRelations[];
  totalCount: number;
}

export interface StoryWithRelations {
  id: string;
  [key: string]: unknown;
}

// ─── Comment types ───────────────────────────────────────────────────────────

export interface CommentTarget {
  targetType: "STORY" | "PAGE";
  targetId: string;
}

export interface CreateCommentInput {
  organizationId: string;
  storyId: string;
  userId: string;
  targetType: "STORY" | "PAGE";
  targetId: string;
  message: string;
  parentId?: string | null;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class StoryQueryService {
  private lifecycle: LifecycleStageService;

  constructor(private prisma: PrismaClient) {
    this.lifecycle = new LifecycleStageService(prisma);
  }

  // ── Library ──────────────────────────────────────────────────────────────

  /**
   * Paginated story library listing with search, type & status filters.
   */
  async getLibrary(filters: StoryLibraryFilters) {
    const limit = filters.limit ?? 25;
    const page = filters.page ?? 1;

    const where: Record<string, unknown> = {
      organizationId: filters.organizationId,
    };

    if (filters.accessibleAccountIds !== undefined && filters.accessibleAccountIds !== null) {
      where.accountId = { in: filters.accessibleAccountIds };
    }
    if (filters.semanticAccountIds && filters.semanticAccountIds.length > 0) {
      const scopedIds =
        filters.accessibleAccountIds && filters.accessibleAccountIds.length > 0
          ? filters.semanticAccountIds.filter((id) =>
              filters.accessibleAccountIds?.includes(id)
            )
          : filters.semanticAccountIds;
      where.accountId = { in: scopedIds };
    }

    if (filters.storyType) {
      where.storyType = filters.storyType;
    }

    if (filters.topics && filters.topics.length > 0) {
      where.filterTags = { hasSome: filters.topics };
    }

    if (filters.funnelStages && filters.funnelStages.length > 0) {
      where.funnelStages = { hasSome: filters.funnelStages as never[] };
    }

    if (
      (filters.searchMode ?? "keyword") === "keyword" &&
      filters.search &&
      filters.search.trim().length > 0
    ) {
      const needle = filters.search.trim();
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

    const stories = await this.prisma.story.findMany({
      where: where as Prisma.StoryWhereInput,
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
        },
      },
      orderBy: { generatedAt: "desc" },
    });

    const lifecycle = await this.lifecycle.resolveStoryLifecycle(
      filters.organizationId,
      stories.map((story) => ({
        id: story.id,
        publishedAt: story.publishedAt,
        landingPages: story.landingPages.map((pageRow) => ({ id: pageRow.id })),
      }))
    );

    const filteredStories = stories
      .filter((story) => {
        if (filters.includeArchived) {
          return true;
        }
        const latestPage = story.landingPages[0];
        return latestPage?.status !== "ARCHIVED";
      })
      .filter((story) => {
        if (!filters.status) {
          return true;
        }
        return lifecycle.get(story.id)?.stage === filters.status;
      })
      .sort((a, b) => {
        if (
          (filters.searchMode ?? "keyword") !== "semantic" ||
          !filters.semanticAccountIds ||
          filters.semanticAccountIds.length === 0
        ) {
          return 0;
        }
        const rankA = filters.semanticAccountIds.indexOf(a.accountId);
        const rankB = filters.semanticAccountIds.indexOf(b.accountId);
        const normalizedA = rankA === -1 ? Number.MAX_SAFE_INTEGER : rankA;
        const normalizedB = rankB === -1 ? Number.MAX_SAFE_INTEGER : rankB;
        return normalizedA - normalizedB;
      })
      .map((story) => {
        const stage = lifecycle.get(story.id)?.stage ?? "DRAFT";
        return {
          ...story,
          lifecycleStage: stage,
          landingPages: story.landingPages.slice(0, 1),
        };
      });

    const totalCount = filteredStories.length;
    const pagedStories = filteredStories.slice((page - 1) * limit, page * limit);

    return { stories: pagedStories, totalCount, page, limit };
  }

  async rankSemanticSearchAccounts(input: {
    ragEngine: RAGEngine;
    organizationId: string;
    query: string;
    accessibleAccountIds?: string[] | null;
    funnelStages?: string[];
  }): Promise<string[]> {
    const response = await input.ragEngine.chat({
      query: input.query,
      organizationId: input.organizationId,
      accountId: null,
      history: [],
      topK: 20,
      funnelStages: input.funnelStages,
    });
    const callIds = Array.from(
      new Set(response.sources.map((source) => source.callId).filter(Boolean))
    );
    if (callIds.length === 0) {
      return [];
    }

    const calls = await this.prisma.call.findMany({
      where: {
        organizationId: input.organizationId,
        id: { in: callIds },
      },
      select: {
        id: true,
        accountId: true,
      },
    });

    const callToAccountId = new Map(
      calls
        .filter((callRow): callRow is { id: string; accountId: string } => !!callRow.accountId)
        .map((callRow) => [callRow.id, callRow.accountId])
    );

    const scores = new Map<string, number>();
    for (const source of response.sources) {
      const accountId = callToAccountId.get(source.callId);
      if (!accountId) continue;
      const nextScore = (scores.get(accountId) ?? 0) + source.relevanceScore;
      scores.set(accountId, nextScore);
    }

    const ranked = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([accountId]) => accountId);

    if (input.accessibleAccountIds === null || input.accessibleAccountIds === undefined) {
      return ranked;
    }
    if (input.accessibleAccountIds.length === 0) {
      return [];
    }
    const allowed = new Set(input.accessibleAccountIds);
    return ranked.filter((accountId) => allowed.has(accountId));
  }

  /**
   * Aggregates story counts by funnel stage and taxonomy topic.
   */
  async getLibraryTaxonomyCounts(input: {
    organizationId: string;
    accessibleAccountIds?: string[] | null;
  }): Promise<{
    funnelStageCounts: Record<string, number>;
    topicCounts: Record<string, number>;
  }> {
    const where: Prisma.StoryWhereInput = {
      organizationId: input.organizationId,
    };

    if (
      input.accessibleAccountIds !== undefined &&
      input.accessibleAccountIds !== null
    ) {
      where.accountId = { in: input.accessibleAccountIds };
    }

    const stories = await this.prisma.story.findMany({
      where,
      select: {
        funnelStages: true,
        filterTags: true,
      },
    });

    const funnelStageCounts: Record<string, number> = {};
    const topicCounts: Record<string, number> = {};

    for (const story of stories) {
      for (const stage of story.funnelStages) {
        funnelStageCounts[stage] = (funnelStageCounts[stage] ?? 0) + 1;
      }
      for (const tag of story.filterTags) {
        if (!tag || tag.includes(":")) continue;
        topicCounts[tag] = (topicCounts[tag] ?? 0) + 1;
      }
    }

    return { funnelStageCounts, topicCounts };
  }

  /**
   * List stories for a single account (no pagination, newest first).
   */
  async getStoriesByAccount(accountId: string, organizationId: string) {
    const stories = await this.prisma.story.findMany({
      where: { accountId, organizationId },
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

    const lifecycle = await this.lifecycle.resolveStoryLifecycle(
      organizationId,
      stories.map((story) => ({
        id: story.id,
        publishedAt: story.publishedAt,
        landingPages: story.landingPages.map((pageRow) => ({ id: pageRow.id })),
      }))
    );

    return stories.map((story) => ({
      ...story,
      lifecycleStage: lifecycle.get(story.id)?.stage ?? "DRAFT",
    }));
  }

  // ── Export / single-story lookups ────────────────────────────────────────

  /**
   * Retrieve the minimal fields needed to export a story.
   */
  async getStoryForExport(storyId: string, organizationId: string) {
    return this.prisma.story.findFirst({
      where: { id: storyId, organizationId },
      select: {
        id: true,
        accountId: true,
        title: true,
        markdownBody: true,
      },
    });
  }

  /**
   * Retrieve a story with its landing-page count (used by the delete guard).
   */
  async getStoryForDeletion(storyId: string, organizationId: string) {
    return this.prisma.story.findFirst({
      where: { id: storyId, organizationId },
      select: {
        id: true,
        accountId: true,
        _count: { select: { landingPages: true } },
      },
    });
  }

  /**
   * Hard-delete a story by ID.
   */
  async deleteStory(storyId: string) {
    await this.prisma.story.delete({ where: { id: storyId } });
  }

  // ── Comments ─────────────────────────────────────────────────────────────

  /**
   * Resolve whether a comment thread targets the story or a specific landing page.
   * Throws if the page does not belong to the story.
   */
  async resolveCommentTarget(input: {
    organizationId: string;
    storyId: string;
    target: "story" | "page";
    pageId?: string;
  }): Promise<CommentTarget> {
    if (input.target === "story") {
      return { targetType: "STORY", targetId: input.storyId };
    }

    if (!input.pageId) {
      throw new Error("Page ID is required for page comment threads.");
    }

    const page = await this.prisma.landingPage.findFirst({
      where: {
        id: input.pageId,
        storyId: input.storyId,
        organizationId: input.organizationId,
      },
      select: { id: true },
    });

    if (!page) {
      throw new Error("Requested page thread does not belong to this story.");
    }

    return { targetType: "PAGE", targetId: input.pageId };
  }

  /**
   * List comments for a story (or page) thread, chronologically.
   */
  async listComments(input: {
    organizationId: string;
    storyId: string;
    targetType: "STORY" | "PAGE";
    targetId: string;
  }) {
    return this.prisma.storyQualityFeedback.findMany({
      where: {
        organizationId: input.organizationId,
        storyId: input.storyId,
        feedbackType: "COMMENT_THREAD",
        targetType: input.targetType,
        targetId: input.targetId,
      },
      orderBy: { createdAt: "asc" },
      include: {
        submittedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }

  /**
   * Create a new comment in a story/page thread.
   */
  async createComment(input: CreateCommentInput) {
    return this.prisma.storyQualityFeedback.create({
      data: {
        organizationId: input.organizationId,
        storyId: input.storyId,
        submittedByUserId: input.userId,
        feedbackType: "COMMENT_THREAD",
        targetType: input.targetType,
        targetId: input.targetId,
        notes: input.message,
        originalValue: input.parentId ?? null,
        status: "APPLIED",
        applyToPromptTuning: false,
      },
      include: {
        submittedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }
}
