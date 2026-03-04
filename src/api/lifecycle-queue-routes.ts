import { Router, type Response } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { LandingPageEditor } from "../services/landing-page-editor.js";
import { RoleProfileService } from "../services/role-profiles.js";
import { LifecycleStageService } from "../services/lifecycle-stage-service.js";
import { isPublishedWithinUtcWindow } from "../services/lifecycle-stage.js";
import { SlackApprovalNotifier } from "../services/slack-approval-notifier.js";
import { asyncHandler } from "../lib/async-handler.js";
import type { AuthenticatedRequest } from "../types/authenticated-request.js";
import {
  sendBadRequest,
  sendConflict,
  sendForbidden,
  sendNotFound,
  sendSuccess,
  sendUnauthorized,
} from "./_shared/responses.js";

const QueueQuerySchema = z.object({
  asset_type: z.enum(["story", "landing_page", "all"]).optional(),
  stage: z.enum(["DRAFT", "IN_REVIEW", "APPROVED", "PUBLISHED"]).optional(),
  account_id: z.string().optional(),
  creator_id: z.string().optional(),
  include_archived: z
    .union([z.literal("true"), z.literal("false")])
    .optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const ApprovalListQuerySchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "ALL"]).optional(),
});

const ReviewApprovalSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  notes: z.string().max(1000).optional(),
});

const MyRequestsQuerySchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "ALL"]).optional(),
  asset_type: z.enum(["story", "landing_page", "all"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const SlackSettingsSchema = z.object({
  enabled: z.boolean(),
  approver_webhook_url: z.string().url().nullable().optional(),
  creator_webhook_url: z.string().url().nullable().optional(),
});

function normalizeSearch(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
}

export function createLifecycleQueueRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const lifecycle = new LifecycleStageService(prisma);
  const editor = new LandingPageEditor(prisma);
  const roleProfiles = new RoleProfileService(prisma);
  const slackNotifier = new SlackApprovalNotifier(prisma);

  const canReviewPublishApprovals = async (
    req: AuthenticatedRequest
  ): Promise<boolean> => {
    if (!req.organizationId! || !req.userId!) {
      return false;
    }
    if (req.userRole && ["OWNER", "ADMIN"].includes(req.userRole)) {
      return true;
    }
    const rolePolicy = await roleProfiles.getEffectivePolicy(
      req.organizationId!,
      req.userId!,
      req.userRole
    );
    if (rolePolicy.permissions.includes("APPROVE_PUBLISH_REQUESTS")) {
      return true;
    }
    const granted = await prisma.userPermission.findUnique({
      where: {
        userId_permission: {
          userId: req.userId!,
          permission: "APPROVE_PUBLISH_REQUESTS",
        },
      },
    });
    return !!granted;
  };

  router.get(
    "/content-queue",
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const parse = QueueQuerySchema.safeParse(req.query);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }
      if (!req.organizationId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const page = parse.data.page ?? 1;
      const limit = parse.data.limit ?? 50;
      const includeArchived = parse.data.include_archived === "true";
      const stageFilter = parse.data.stage;
      const searchNeedle = normalizeSearch(parse.data.search);
      const assetType = parse.data.asset_type ?? "all";

      const [stories, pages] = await Promise.all([
        assetType === "landing_page"
          ? Promise.resolve([])
          : prisma.story.findMany({
              where: {
                organizationId: req.organizationId!,
                ...(parse.data.account_id
                  ? { accountId: parse.data.account_id }
                  : {}),
                ...(parse.data.creator_id
                  ? { generatedById: parse.data.creator_id }
                  : {}),
              },
              include: {
                account: { select: { id: true, name: true } },
                landingPages: {
                  select: { id: true, status: true, updatedAt: true },
                  orderBy: { createdAt: "desc" },
                },
              },
              orderBy: { updatedAt: "desc" },
            }),
        assetType === "story"
          ? Promise.resolve([])
          : prisma.landingPage.findMany({
              where: {
                organizationId: req.organizationId!,
                ...(parse.data.creator_id
                  ? { createdById: parse.data.creator_id }
                  : {}),
                ...(parse.data.account_id
                  ? { story: { accountId: parse.data.account_id } }
                  : {}),
              },
              include: {
                createdBy: { select: { id: true, name: true, email: true } },
                story: {
                  select: {
                    id: true,
                    account: { select: { id: true, name: true } },
                  },
                },
              },
              orderBy: { updatedAt: "desc" },
            }),
      ]);

      const [storyLifecycle, pageLifecycle] = await Promise.all([
        lifecycle.resolveStoryLifecycle(
          req.organizationId!,
          stories.map((story) => ({
            id: story.id,
            publishedAt: story.publishedAt,
            landingPages: story.landingPages.map((p) => ({ id: p.id })),
          }))
        ),
        lifecycle.resolveLandingPageLifecycle(
          req.organizationId!,
          pages.map((p) => ({
            id: p.id,
            publishedAt: p.publishedAt,
          }))
        ),
      ]);

      const generatedByIds = Array.from(
        new Set(stories.map((story) => story.generatedById).filter(Boolean))
      ) as string[];
      const storyCreators =
        generatedByIds.length > 0
          ? await prisma.user.findMany({
              where: {
                organizationId: req.organizationId!,
                id: { in: generatedByIds },
              },
              select: { id: true, name: true, email: true },
            })
          : [];
      const storyCreatorMap = new Map(storyCreators.map((u) => [u.id, u]));

      const storyRows = stories
        .map((story) => {
          const lifecycleState = storyLifecycle.get(story.id);
          const latestPage = story.landingPages[0];
          const isArchived = latestPage?.status === "ARCHIVED";
          return {
            asset_type: "story" as const,
            asset_id: story.id,
            title: story.title,
            account: story.account,
            creator:
              (story.generatedById && storyCreatorMap.get(story.generatedById)) || null,
            stage: lifecycleState?.stage ?? "DRAFT",
            updated_at: story.updatedAt.toISOString(),
            published_at: story.publishedAt?.toISOString() ?? null,
            latest_page_id: latestPage?.id ?? null,
            archived: isArchived,
          };
        })
        .filter((row) => includeArchived || !row.archived);

      const pageRows = pages
        .map((pageRow) => {
          const lifecycleState = pageLifecycle.get(pageRow.id);
          const isArchived = pageRow.status === "ARCHIVED";
          return {
            asset_type: "landing_page" as const,
            asset_id: pageRow.id,
            title: pageRow.title,
            account: pageRow.story.account,
            creator: pageRow.createdBy,
            stage: lifecycleState?.stage ?? "DRAFT",
            updated_at: pageRow.updatedAt.toISOString(),
            published_at: pageRow.publishedAt?.toISOString() ?? null,
            latest_page_id: pageRow.id,
            archived: isArchived,
          };
        })
        .filter((row) => includeArchived || !row.archived);

      const merged = [...storyRows, ...pageRows]
        .filter((row) => (stageFilter ? row.stage === stageFilter : true))
        .filter((row) =>
          searchNeedle
            ? `${row.title} ${row.account.name}`.toLowerCase().includes(searchNeedle)
            : true
        )
        .sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        );

      const totalCount = merged.length;
      const items = merged.slice((page - 1) * limit, page * limit);

      sendSuccess(res, {
        items,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages: Math.max(1, Math.ceil(totalCount / limit)),
        },
      });
    })
  );

  router.get(
    "/my-queue",
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId! || !req.userId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const nowUtc = new Date();
      const [stories, pages] = await Promise.all([
        prisma.story.findMany({
          where: {
            organizationId: req.organizationId!,
            generatedById: req.userId!,
          },
          include: {
            account: { select: { id: true, name: true } },
            landingPages: { select: { id: true, status: true }, orderBy: { createdAt: "desc" } },
          },
          orderBy: { updatedAt: "desc" },
        }),
        prisma.landingPage.findMany({
          where: {
            organizationId: req.organizationId!,
            createdById: req.userId!,
          },
          include: {
            story: {
              select: {
                account: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { updatedAt: "desc" },
        }),
      ]);

      const [storyLifecycle, pageLifecycle] = await Promise.all([
        lifecycle.resolveStoryLifecycle(
          req.organizationId!,
          stories.map((story) => ({
            id: story.id,
            publishedAt: story.publishedAt,
            landingPages: story.landingPages.map((p) => ({ id: p.id })),
          }))
        ),
        lifecycle.resolveLandingPageLifecycle(
          req.organizationId!,
          pages.map((p) => ({ id: p.id, publishedAt: p.publishedAt }))
        ),
      ]);

      const rows = [
        ...stories.map((story) => ({
          asset_type: "story" as const,
          asset_id: story.id,
          title: story.title,
          account: story.account,
          creator: null,
          stage: storyLifecycle.get(story.id)?.stage ?? "DRAFT",
          updated_at: story.updatedAt.toISOString(),
          published_at: story.publishedAt?.toISOString() ?? null,
          latest_page_id: story.landingPages[0]?.id ?? null,
          archived: story.landingPages[0]?.status === "ARCHIVED",
        })),
        ...pages.map((pageRow) => ({
          asset_type: "landing_page" as const,
          asset_id: pageRow.id,
          title: pageRow.title,
          account: pageRow.story.account,
          creator: null,
          stage: pageLifecycle.get(pageRow.id)?.stage ?? "DRAFT",
          updated_at: pageRow.updatedAt.toISOString(),
          published_at: pageRow.publishedAt?.toISOString() ?? null,
          latest_page_id: pageRow.id,
          archived: pageRow.status === "ARCHIVED",
        })),
      ];

      const draft = rows.filter((row) => row.stage === "DRAFT");
      const inReview = rows.filter((row) => row.stage === "IN_REVIEW");
      const approved = rows.filter((row) => row.stage === "APPROVED");
      const publishedRecent = rows.filter(
        (row) =>
          row.stage === "PUBLISHED" &&
          isPublishedWithinUtcWindow(
            row.published_at ? new Date(row.published_at) : null,
            nowUtc,
            30
          )
      );

      sendSuccess(res, {
        counts: {
          draft: draft.length,
          in_review: inReview.length,
          approved: approved.length,
          published_recent: publishedRecent.length,
        },
        buckets: {
          draft,
          in_review: inReview,
          approved,
          published_recent: publishedRecent,
        },
      });
    })
  );

  router.get(
    "/my-queue/requests",
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const parse = MyRequestsQuerySchema.safeParse(req.query);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }
      if (!req.organizationId! || !req.userId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const status = parse.data.status ?? "ALL";
      const assetType = parse.data.asset_type ?? "all";
      const limit = parse.data.limit ?? 200;

      const rows = await prisma.approvalRequest.findMany({
        where: {
          organizationId: req.organizationId!,
          requestedByUserId: req.userId!,
          requestType: { in: ["LANDING_PAGE_PUBLISH", "STORY_PUBLISH"] },
          ...(status === "ALL" ? {} : { status }),
          ...(assetType === "all"
            ? {}
            : { targetType: assetType }),
        },
        include: {
          requestedBy: { select: { id: true, name: true, email: true } },
          reviewer: { select: { id: true, name: true, email: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      });

      const pageIds = rows
        .filter((row) => row.targetType === "landing_page")
        .map((row) => row.targetId);
      const storyIds = rows
        .filter((row) => row.targetType === "story")
        .map((row) => row.targetId);

      const [pageMap, storyMap] = await Promise.all([
        pageIds.length > 0
          ? prisma.landingPage
              .findMany({
                where: { organizationId: req.organizationId!, id: { in: pageIds } },
                include: {
                  story: {
                    select: { account: { select: { id: true, name: true } } },
                  },
                },
              })
              .then((items) => new Map(items.map((item) => [item.id, item])))
          : Promise.resolve(new Map()),
        storyIds.length > 0
          ? prisma.story
              .findMany({
                where: { organizationId: req.organizationId!, id: { in: storyIds } },
                include: { account: { select: { id: true, name: true } } },
              })
              .then((items) => new Map(items.map((item) => [item.id, item])))
          : Promise.resolve(new Map()),
      ]);

      sendSuccess(res, {
        requests: rows.map((row) => {
          const pageRow =
            row.targetType === "landing_page" ? pageMap.get(row.targetId) : null;
          const storyRow =
            row.targetType === "story" ? storyMap.get(row.targetId) : null;
          return {
            id: row.id,
            status: row.status,
            asset_type: row.targetType,
            asset_id: row.targetId,
            title: pageRow?.title ?? storyRow?.title ?? row.targetId,
            account_name: pageRow?.story.account.name ?? storyRow?.account.name ?? null,
            request_type: row.requestType,
            created_at: row.createdAt.toISOString(),
            reviewed_at: row.reviewedAt?.toISOString() ?? null,
            review_notes: row.reviewNotes,
            requested_by: row.requestedBy,
            reviewer: row.reviewer,
          };
        }),
      });
    })
  );

  router.get(
    "/publish-approvals",
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const parse = ApprovalListQuerySchema.safeParse(req.query);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }
      if (!req.organizationId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }
      if (!(await canReviewPublishApprovals(req))) {
        sendForbidden(res, "permission_denied");
        return;
      }

      const status = parse.data.status ?? "PENDING";
      const approvals = await prisma.approvalRequest.findMany({
        where: {
          organizationId: req.organizationId!,
          requestType: { in: ["LANDING_PAGE_PUBLISH", "STORY_PUBLISH"] },
          ...(status === "ALL" ? {} : { status }),
        },
        include: {
          requestedBy: { select: { id: true, name: true, email: true } },
          reviewer: { select: { id: true, name: true, email: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 200,
      });

      const pageIds = approvals
        .filter((row) => row.targetType === "landing_page")
        .map((row) => row.targetId);
      const storyIds = approvals
        .filter((row) => row.targetType === "story")
        .map((row) => row.targetId);

      const [pageMap, storyMap] = await Promise.all([
        pageIds.length > 0
          ? prisma.landingPage
              .findMany({
                where: { organizationId: req.organizationId!, id: { in: pageIds } },
                include: {
                  story: {
                    select: { account: { select: { id: true, name: true } } },
                  },
                },
              })
              .then((rows) => new Map(rows.map((row) => [row.id, row])))
          : Promise.resolve(new Map()),
        storyIds.length > 0
          ? prisma.story
              .findMany({
                where: { organizationId: req.organizationId!, id: { in: storyIds } },
                include: { account: { select: { id: true, name: true } } },
              })
              .then((rows) => new Map(rows.map((row) => [row.id, row])))
          : Promise.resolve(new Map()),
      ]);

      sendSuccess(res, {
        approvals: approvals.map((row) => {
          const pageRow = row.targetType === "landing_page" ? pageMap.get(row.targetId) : null;
          const storyRow = row.targetType === "story" ? storyMap.get(row.targetId) : null;
          const title = pageRow?.title ?? storyRow?.title ?? row.targetId;
          const accountName = pageRow?.story.account.name ?? storyRow?.account.name ?? null;
          return {
            id: row.id,
            status: row.status,
            asset_type: row.targetType,
            asset_id: row.targetId,
            title,
            account_name: accountName,
            request_type: row.requestType,
            created_at: row.createdAt.toISOString(),
            reviewed_at: row.reviewedAt?.toISOString() ?? null,
            requested_by: row.requestedBy,
            reviewer: row.reviewer,
            payload: row.requestPayload,
            review_notes: row.reviewNotes,
          };
        }),
      });
    })
  );

  router.get(
    "/publish-approvals/slack-settings",
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId! || !req.userId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }
      if (req.userRole !== "OWNER" && req.userRole !== "ADMIN") {
        sendForbidden(res, "permission_denied");
        return;
      }

      const settings = await slackNotifier.getSettings(req.organizationId!);
      const mask = (value: string | null) => {
        if (!value) return null;
        const trimmed = value.trim();
        return trimmed.length <= 16
          ? "••••••••"
          : `${trimmed.slice(0, 12)}••••${trimmed.slice(-4)}`;
      };

      sendSuccess(res, {
        enabled: settings.enabled,
        approver_webhook_url_masked: mask(settings.approverWebhookUrl),
        creator_webhook_url_masked: mask(settings.creatorWebhookUrl),
      });
    })
  );

  router.put(
    "/publish-approvals/slack-settings",
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const parse = SlackSettingsSchema.safeParse(req.body);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }
      if (!req.organizationId! || !req.userId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }
      if (req.userRole !== "OWNER" && req.userRole !== "ADMIN") {
        sendForbidden(res, "permission_denied");
        return;
      }

      const settings = await slackNotifier.updateSettings(req.organizationId!, {
        enabled: parse.data.enabled,
        approverWebhookUrl: parse.data.approver_webhook_url ?? null,
        creatorWebhookUrl: parse.data.creator_webhook_url ?? null,
      });

      sendSuccess(res, {
        saved: true,
        enabled: settings.enabled,
      });
    })
  );

  router.post(
    "/publish-approvals/:id/review",
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const parse = ReviewApprovalSchema.safeParse(req.body);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }
      if (!req.organizationId! || !req.userId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }
      if (!(await canReviewPublishApprovals(req))) {
        sendForbidden(res, "permission_denied");
        return;
      }

      const approval = await prisma.approvalRequest.findFirst({
        where: {
          id: req.params.id as string,
          organizationId: req.organizationId!,
          requestType: { in: ["LANDING_PAGE_PUBLISH", "STORY_PUBLISH"] },
        },
        include: {
          requestedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });
      if (!approval) {
        sendNotFound(res, "Publish approval request not found");
        return;
      }
      if (approval.status !== "PENDING") {
        sendConflict(res, "Approval request is already finalized");
        return;
      }

      if (parse.data.decision === "REJECT") {
        await prisma.approvalRequest.update({
          where: { id: approval.id },
          data: {
            status: "REJECTED",
            reviewerUserId: req.userId!,
            reviewNotes: parse.data.notes ?? null,
            reviewedAt: new Date(),
          },
        });
        await slackNotifier.notifyApprovalDecision({
          organizationId: req.organizationId!,
          status: "REJECTED",
          title: approval.targetId,
          reviewerLabel: req.userId!,
          creatorLabel: approval.requestedBy.name || approval.requestedBy.email,
          publishUrl: `${process.env.APP_URL ?? process.env.FRONTEND_URL ?? ""}/admin/publish-approvals`,
        }).catch(() => {});
        sendSuccess(res, { status: "REJECTED" });
        return;
      }

      if (
        approval.requestType === "LANDING_PAGE_PUBLISH" &&
        approval.targetType === "landing_page"
      ) {
        const payload =
          approval.requestPayload && typeof approval.requestPayload === "object"
            ? (approval.requestPayload as {
                options?: {
                  visibility?: "PRIVATE" | "SHARED_WITH_LINK";
                  password?: string;
                  expires_at?: string;
                  release_notes?: string;
                };
              })
            : {};
        const options = payload.options ?? { visibility: "PRIVATE" as const };
        const publishResult = await editor.publish(approval.targetId, {
          visibility: options.visibility ?? "PRIVATE",
          password: options.password,
          expiresAt: options.expires_at ? new Date(options.expires_at) : undefined,
          publishedByUserId: req.userId!,
          approvalRequestId: approval.id,
          releaseNotes: options.release_notes,
          provenance: {
            publish_mode: "approval_review",
            approval_request_id: approval.id,
            finalized_by_user_id: req.userId!,
          },
        });

        await prisma.approvalRequest.update({
          where: { id: approval.id },
          data: {
            status: "APPROVED",
            reviewerUserId: req.userId!,
            reviewNotes: parse.data.notes ?? null,
            reviewedAt: new Date(),
          },
        });

        await slackNotifier.notifyApprovalDecision({
          organizationId: req.organizationId!,
          status: "APPROVED",
          title: publishResult.slug ?? approval.targetId,
          reviewerLabel: req.userId!,
          creatorLabel: approval.requestedBy.name || approval.requestedBy.email,
          publishUrl: `${process.env.APP_URL ?? process.env.FRONTEND_URL ?? ""}/pages/${approval.targetId}/edit`,
        }).catch(() => {});

        sendSuccess(res, {
          status: "APPROVED",
          published: true,
          slug: publishResult.slug,
          url: publishResult.url,
        });
        return;
      }

      await prisma.approvalRequest.update({
        where: { id: approval.id },
        data: {
          status: "APPROVED",
          reviewerUserId: req.userId!,
          reviewNotes: parse.data.notes ?? null,
          reviewedAt: new Date(),
        },
      });

      await slackNotifier.notifyApprovalDecision({
        organizationId: req.organizationId!,
        status: "APPROVED",
        title: approval.targetId,
        reviewerLabel: req.userId!,
        creatorLabel: approval.requestedBy.name || approval.requestedBy.email,
        publishUrl: `${process.env.APP_URL ?? process.env.FRONTEND_URL ?? ""}/admin/publish-approvals`,
      }).catch(() => {});

      sendSuccess(res, { status: "APPROVED", published: false });
    })
  );

  return router;
}
