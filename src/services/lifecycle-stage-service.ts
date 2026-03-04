import type { PrismaClient } from "@prisma/client";
import {
  compareApprovalRecency,
  pickLatestApproval,
  resolveLifecycleStage,
  type LifecycleStage,
} from "./lifecycle-stage.js";

interface StoryLifecycleInput {
  id: string;
  publishedAt: Date | null;
  landingPages: Array<{ id: string }>;
}

interface PageLifecycleInput {
  id: string;
  publishedAt: Date | null;
}

export interface LifecycleResolution {
  stage: LifecycleStage;
  latestApprovalStatus: string | null;
  latestApprovalRequestId: string | null;
  latestApprovalCreatedAt: Date | null;
}

export class LifecycleStageService {
  constructor(private prisma: PrismaClient) {}

  async resolveStoryLifecycle(
    organizationId: string,
    stories: StoryLifecycleInput[]
  ): Promise<Map<string, LifecycleResolution>> {
    if (stories.length === 0) {
      return new Map();
    }

    const storyIds = stories.map((story) => story.id);
    const pageToStory = new Map<string, string>();
    const allPageIds: string[] = [];
    for (const story of stories) {
      for (const page of story.landingPages) {
        allPageIds.push(page.id);
        pageToStory.set(page.id, story.id);
      }
    }

    const approvalWhere: Record<string, unknown> = {
      organizationId,
      OR: [
        {
          targetType: "story",
          targetId: { in: storyIds },
        },
      ],
    };
    if (allPageIds.length > 0) {
      (approvalWhere.OR as Array<Record<string, unknown>>).push({
        targetType: "landing_page",
        targetId: { in: allPageIds },
      });
    }

    const approvals = await this.prisma.approvalRequest.findMany({
      where: approvalWhere as any,
      select: {
        id: true,
        status: true,
        targetType: true,
        targetId: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    const latestByStory = new Map<
      string,
      { id: string; status: string; createdAt: Date }
    >();
    for (const approval of approvals) {
      const storyId =
        approval.targetType === "story"
          ? approval.targetId
          : pageToStory.get(approval.targetId);
      if (!storyId) {
        continue;
      }
      const existing = latestByStory.get(storyId);
      if (
        !existing ||
        compareApprovalRecency(approval, existing) < 0
      ) {
        latestByStory.set(storyId, {
          id: approval.id,
          status: approval.status,
          createdAt: approval.createdAt,
        });
      }
    }

    const result = new Map<string, LifecycleResolution>();
    for (const story of stories) {
      const latest = latestByStory.get(story.id) ?? null;
      result.set(story.id, {
        stage: resolveLifecycleStage({
          publishedAt: story.publishedAt,
          latestApprovalStatus: latest?.status ?? null,
        }),
        latestApprovalStatus: latest?.status ?? null,
        latestApprovalRequestId: latest?.id ?? null,
        latestApprovalCreatedAt: latest?.createdAt ?? null,
      });
    }
    return result;
  }

  async resolveLandingPageLifecycle(
    organizationId: string,
    pages: PageLifecycleInput[]
  ): Promise<Map<string, LifecycleResolution>> {
    if (pages.length === 0) {
      return new Map();
    }
    const pageIds = pages.map((page) => page.id);
    const approvals = await this.prisma.approvalRequest.findMany({
      where: {
        organizationId,
        targetType: "landing_page",
        targetId: { in: pageIds },
      },
      select: {
        id: true,
        status: true,
        targetId: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    const grouped = new Map<
      string,
      Array<{ id: string; status: string; createdAt: Date }>
    >();
    for (const approval of approvals) {
      const arr = grouped.get(approval.targetId) ?? [];
      arr.push({
        id: approval.id,
        status: approval.status,
        createdAt: approval.createdAt,
      });
      grouped.set(approval.targetId, arr);
    }

    const result = new Map<string, LifecycleResolution>();
    for (const page of pages) {
      const latest = pickLatestApproval(grouped.get(page.id) ?? []);
      result.set(page.id, {
        stage: resolveLifecycleStage({
          publishedAt: page.publishedAt,
          latestApprovalStatus: latest?.status ?? null,
        }),
        latestApprovalStatus: latest?.status ?? null,
        latestApprovalRequestId: latest?.id ?? null,
        latestApprovalCreatedAt: latest?.createdAt ?? null,
      });
    }
    return result;
  }
}
