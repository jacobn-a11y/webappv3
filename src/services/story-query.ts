/**
 * Story Query Service
 *
 * Encapsulates all read / delete Prisma operations for stories,
 * story library queries, and story comment threads.
 *
 * Keeps route handlers free of direct `prisma.*` calls.
 */

import type { PrismaClient, Prisma } from "@prisma/client";

// ─── Library types ───────────────────────────────────────────────────────────

export interface StoryLibraryFilters {
  organizationId: string;
  /** When provided, restrict to these account IDs (RBAC scoping). */
  accessibleAccountIds?: string[] | null;
  storyType?: string;
  status?: "DRAFT" | "PAGE_CREATED" | "PUBLISHED" | "ARCHIVED";
  search?: string;
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
  constructor(private prisma: PrismaClient) {}

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

    if (filters.storyType) {
      where.storyType = filters.storyType;
    }

    if (filters.status) {
      if (filters.status === "DRAFT") {
        where.landingPages = { none: {} };
      } else if (filters.status === "PAGE_CREATED") {
        where.landingPages = { some: { status: "DRAFT" } };
      } else if (filters.status === "PUBLISHED") {
        where.landingPages = { some: { status: "PUBLISHED" } };
      } else if (filters.status === "ARCHIVED") {
        where.landingPages = { some: { status: "ARCHIVED" } };
      }
    }

    if (filters.search && filters.search.trim().length > 0) {
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

    const [totalCount, stories] = await Promise.all([
      this.prisma.story.count({ where: where as Prisma.StoryWhereInput }),
      this.prisma.story.findMany({
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
            take: 1,
          },
        },
        orderBy: { generatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { stories, totalCount, page, limit };
  }

  /**
   * List stories for a single account (no pagination, newest first).
   */
  async getStoriesByAccount(accountId: string, organizationId: string) {
    return this.prisma.story.findMany({
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
