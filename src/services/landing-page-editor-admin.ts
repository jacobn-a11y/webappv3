import { Prisma, type PrismaClient } from "@prisma/client";
import { decodeProvenance } from "../types/json-boundaries.js";
import { LifecycleStageService } from "./lifecycle-stage-service.js";
import { syncStoryPublishedAtFromLandingPages } from "./landing-page-editor-helpers.js";
import type {
  ArtifactVersionSummary,
  LandingPageSummary,
} from "./landing-page-editor-types.js";

interface ListForOrgFilters {
  status?: "DRAFT" | "IN_REVIEW" | "APPROVED" | "PUBLISHED";
  includeArchived?: boolean;
  createdById?: string;
  search?: string;
}

export async function listLandingPagesForOrg(
  prisma: PrismaClient,
  organizationId: string,
  filters?: ListForOrgFilters
): Promise<LandingPageSummary[]> {
  const where: Record<string, unknown> = { organizationId };
  if (filters?.createdById) where.createdById = filters.createdById;
  if (filters?.search) {
    where.title = { contains: filters.search, mode: "insensitive" };
  }

  const pages = await prisma.landingPage.findMany({
    where,
    include: {
      createdBy: { select: { name: true, email: true } },
      story: {
        include: { account: { select: { name: true } } },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const lifecycle = await new LifecycleStageService(prisma).resolveLandingPageLifecycle(
    organizationId,
    pages.map((page) => ({ id: page.id, publishedAt: page.publishedAt }))
  );

  return pages
    .map((page) => ({
      id: page.id,
      slug: page.slug,
      title: page.title,
      subtitle: page.subtitle,
      status: page.status,
      lifecycleStage: lifecycle.get(page.id)?.stage ?? "DRAFT",
      visibility: page.visibility,
      viewCount: page.viewCount,
      createdByName: page.createdBy.name,
      createdByEmail: page.createdBy.email,
      accountName: page.story.account.name,
      publishedAt: page.publishedAt,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
    }))
    .filter((page) => (filters?.includeArchived ? true : page.status !== "ARCHIVED"))
    .filter((page) => (filters?.status ? page.lifecycleStage === filters.status : true));
}

export async function getLandingPageDashboardStats(
  prisma: PrismaClient,
  organizationId: string
): Promise<{
  totalPages: number;
  publishedPages: number;
  draftPages: number;
  totalViews: number;
  pagesByUser: Array<{ userId: string; name: string | null; count: number }>;
}> {
  const [total, published, drafts, viewsAgg, byUser] = await Promise.all([
    prisma.landingPage.count({ where: { organizationId } }),
    prisma.landingPage.count({
      where: { organizationId, status: "PUBLISHED" },
    }),
    prisma.landingPage.count({
      where: { organizationId, status: "DRAFT" },
    }),
    prisma.landingPage.aggregate({
      where: { organizationId },
      _sum: { viewCount: true },
    }),
    prisma.landingPage.groupBy({
      by: ["createdById"],
      where: { organizationId },
      _count: true,
    }),
  ]);

  const userIds = byUser.map((row) => row.createdById);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true },
  });
  const userMap = new Map(users.map((user) => [user.id, user.name]));

  return {
    totalPages: total,
    publishedPages: published,
    draftPages: drafts,
    totalViews: viewsAgg._sum.viewCount ?? 0,
    pagesByUser: byUser.map((row) => ({
      userId: row.createdById,
      name: userMap.get(row.createdById) ?? null,
      count: row._count,
    })),
  };
}

export async function listLandingPageArtifactVersions(
  prisma: PrismaClient,
  pageId: string,
  organizationId: string
): Promise<ArtifactVersionSummary[]> {
  const versions = await prisma.publishedArtifactVersion.findMany({
    where: {
      landingPageId: pageId,
      organizationId,
    },
    orderBy: { versionNumber: "desc" },
    include: {
      publishedBy: { select: { id: true, name: true, email: true } },
    },
  });

  return versions.map((version) => ({
    id: version.id,
    versionNumber: version.versionNumber,
    status: version.status,
    releaseNotes: version.releaseNotes,
    visibility: version.visibilitySnapshot,
    expiresAt: version.expiresAtSnapshot,
    publishedAt: version.publishedAtSnapshot,
    createdAt: version.createdAt,
    createdBy: version.publishedBy
      ? {
          id: version.publishedBy.id,
          name: version.publishedBy.name,
          email: version.publishedBy.email,
        }
      : null,
    provenance: version.provenance ? decodeProvenance(version.provenance) : null,
  }));
}

export async function rollbackLandingPageToVersion(
  prisma: PrismaClient,
  pageId: string,
  versionId: string,
  actorUserId: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const page = await tx.landingPage.findUniqueOrThrow({
      where: { id: pageId },
    });

    const version = await tx.publishedArtifactVersion.findFirst({
      where: {
        id: versionId,
        landingPageId: pageId,
        organizationId: page.organizationId,
      },
    });
    if (!version) {
      throw new Error("Version not found for this landing page");
    }

    await tx.landingPage.update({
      where: { id: pageId },
      data: {
        title: version.titleSnapshot,
        subtitle: version.subtitleSnapshot,
        editableBody: version.bodySnapshot,
        calloutBoxes: version.calloutBoxesSnapshot as Prisma.InputJsonValue,
        visibility: version.visibilitySnapshot,
        expiresAt: version.expiresAtSnapshot,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });

    await tx.publishedArtifactVersion.updateMany({
      where: {
        landingPageId: pageId,
        organizationId: page.organizationId,
        status: "ACTIVE",
      },
      data: { status: "ROLLED_BACK" },
    });

    const maxVersion = await tx.publishedArtifactVersion.aggregate({
      where: {
        landingPageId: pageId,
        organizationId: page.organizationId,
      },
      _max: { versionNumber: true },
    });

    await tx.publishedArtifactVersion.create({
      data: {
        organizationId: page.organizationId,
        landingPageId: pageId,
        artifactType: "LANDING_PAGE",
        versionNumber: (maxVersion._max.versionNumber ?? 0) + 1,
        status: "ACTIVE",
        releaseNotes: `Rollback to version ${version.versionNumber}`,
        titleSnapshot: version.titleSnapshot,
        subtitleSnapshot: version.subtitleSnapshot,
        bodySnapshot: version.bodySnapshot,
        calloutBoxesSnapshot: version.calloutBoxesSnapshot ?? Prisma.JsonNull,
        visibilitySnapshot: version.visibilitySnapshot,
        expiresAtSnapshot: version.expiresAtSnapshot,
        publishedAtSnapshot: new Date(),
        sourceEditId: version.sourceEditId,
        publishedByUserId: actorUserId,
        rolledBackFromVersionId: version.id,
        provenance: {
          action: "rollback",
          source_version_id: version.id,
          source_version_number: version.versionNumber,
          rolled_back_at: new Date().toISOString(),
          rolled_back_by_user_id: actorUserId,
        },
      },
    });
  });
}

export function findStoryForOrg(
  prisma: PrismaClient,
  storyId: string,
  organizationId: string
): Promise<{ id: string; accountId: string } | null> {
  return prisma.story.findFirst({
    where: { id: storyId, organizationId },
    select: { id: true, accountId: true },
  });
}

export function findPageForOrg(
  prisma: PrismaClient,
  pageId: string,
  organizationId: string
): Promise<{ id: string } | null> {
  return prisma.landingPage.findFirst({
    where: { id: pageId, organizationId },
  });
}

export async function deleteLandingPage(
  prisma: PrismaClient,
  pageId: string
): Promise<void> {
  const page = await prisma.landingPage.delete({
    where: { id: pageId },
    select: { storyId: true },
  });
  try {
    await syncStoryPublishedAtFromLandingPages(prisma, page.storyId);
  } catch {
    // Non-critical: story publishedAt sync failure should not block deletion
  }
}

export function findPendingPublishApproval(
  prisma: PrismaClient,
  organizationId: string,
  pageId: string
): Promise<{ id: string } | null> {
  return prisma.approvalRequest.findFirst({
    where: {
      organizationId,
      requestType: "LANDING_PAGE_PUBLISH",
      targetType: "landing_page",
      targetId: pageId,
      status: "PENDING",
    },
  });
}

export function createPublishApprovalRequest(
  prisma: PrismaClient,
  data: {
    organizationId: string;
    targetId: string;
    requestedByUserId: string;
    targetType?: string;
    requestType?: string;
    requestPayload: Record<string, unknown>;
  }
): Promise<{ id: string }> {
  return prisma.approvalRequest.create({
    data: {
      organizationId: data.organizationId,
      requestType: data.requestType ?? "LANDING_PAGE_PUBLISH",
      targetType: data.targetType ?? "landing_page",
      targetId: data.targetId,
      requestedByUserId: data.requestedByUserId,
      status: "PENDING",
      requestPayload: data.requestPayload as object,
    },
  });
}

export function listPublishApprovalRequests(
  prisma: PrismaClient,
  organizationId: string,
  status: string,
  options?: {
    requestTypes?: string[];
    targetTypes?: string[];
  }
) {
  return prisma.approvalRequest.findMany({
    where: {
      organizationId,
      requestType:
        options?.requestTypes && options.requestTypes.length > 0
          ? { in: options.requestTypes }
          : "LANDING_PAGE_PUBLISH",
      targetType:
        options?.targetTypes && options.targetTypes.length > 0
          ? { in: options.targetTypes }
          : undefined,
      status,
    },
    include: {
      requestedBy: { select: { id: true, name: true, email: true } },
      reviewer: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export function findPublishApprovalRequest(
  prisma: PrismaClient,
  requestId: string,
  organizationId: string,
  options?: {
    requestTypes?: string[];
  }
) {
  return prisma.approvalRequest.findFirst({
    where: {
      id: requestId,
      organizationId,
      requestType:
        options?.requestTypes && options.requestTypes.length > 0
          ? { in: options.requestTypes }
          : "LANDING_PAGE_PUBLISH",
    },
  });
}

export function updatePublishApprovalRequest(
  prisma: PrismaClient,
  requestId: string,
  data: {
    status?: string;
    reviewerUserId?: string;
    reviewNotes?: string | null;
    reviewedAt?: Date;
    requestPayload?: Record<string, unknown>;
  }
) {
  return prisma.approvalRequest.update({
    where: { id: requestId },
    data: {
      status: data.status,
      reviewerUserId: data.reviewerUserId,
      reviewNotes: data.reviewNotes,
      reviewedAt: data.reviewedAt,
      requestPayload: data.requestPayload as object | undefined,
    },
  });
}
