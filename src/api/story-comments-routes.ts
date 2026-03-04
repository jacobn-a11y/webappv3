import { Router, type Response } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { AuthenticatedRequest } from "../types/authenticated-request.js";
import { sendSuccess, sendCreated, sendUnauthorized, sendBadRequest } from "./_shared/responses.js";

const ListCommentsQuerySchema = z.object({
  target: z.enum(["story", "page"]).default("story"),
  page_id: z.string().optional(),
});

const CreateCommentSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  parent_id: z.string().optional(),
  target: z.enum(["story", "page"]).default("story"),
  page_id: z.string().optional(),
});

async function resolveCommentTarget(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    storyId: string;
    target: "story" | "page";
    pageId?: string;
  }
): Promise<{ targetType: "STORY" | "PAGE"; targetId: string }> {
  if (input.target === "story") {
    return { targetType: "STORY", targetId: input.storyId };
  }

  if (!input.pageId) {
    throw new Error("Page ID is required for page comment threads.");
  }

  const page = await prisma.landingPage.findFirst({
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

export function createStoryCommentRoutes(prisma: PrismaClient): Router {
  const router = Router();

  router.get("/:storyId/comments", async (req: AuthenticatedRequest, res: Response) => {
    if (!req.organizationId) {
      sendUnauthorized(res, "Authentication required");
      return;
    }

    const parse = ListCommentsQuerySchema.safeParse(req.query);
    if (!parse.success) {
      sendBadRequest(res, "validation_error", parse.error.issues);
      return;
    }

    try {
      const target = await resolveCommentTarget(prisma, {
        organizationId: req.organizationId,
        storyId: req.params.storyId as string,
        target: parse.data.target,
        pageId: parse.data.page_id,
      });

      const comments = await prisma.storyQualityFeedback.findMany({
        where: {
          organizationId: req.organizationId,
          storyId: req.params.storyId as string,
          feedbackType: "COMMENT_THREAD",
          targetType: target.targetType,
          targetId: target.targetId,
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

      sendSuccess(res, {
        comments: comments.map((comment) => ({
          id: comment.id,
          message: comment.notes ?? "",
          parent_id: comment.originalValue ?? null,
          target_type: comment.targetType,
          target_id: comment.targetId,
          created_at: comment.createdAt.toISOString(),
          author: comment.submittedBy
            ? {
                id: comment.submittedBy.id,
                name: comment.submittedBy.name,
                email: comment.submittedBy.email,
              }
            : null,
        })),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load comment thread";
      sendBadRequest(res, message);
    }
  });

  router.post("/:storyId/comments", async (req: AuthenticatedRequest, res: Response) => {
    if (!req.organizationId || !req.userId) {
      sendUnauthorized(res, "Authentication required");
      return;
    }

    const parse = CreateCommentSchema.safeParse(req.body);
    if (!parse.success) {
      sendBadRequest(res, "validation_error", parse.error.issues);
      return;
    }

    try {
      const target = await resolveCommentTarget(prisma, {
        organizationId: req.organizationId,
        storyId: req.params.storyId as string,
        target: parse.data.target,
        pageId: parse.data.page_id,
      });

      const comment = await prisma.storyQualityFeedback.create({
        data: {
          organizationId: req.organizationId,
          storyId: req.params.storyId as string,
          submittedByUserId: req.userId,
          feedbackType: "COMMENT_THREAD",
          targetType: target.targetType,
          targetId: target.targetId,
          notes: parse.data.message,
          originalValue: parse.data.parent_id ?? null,
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

      sendCreated(res, {
        id: comment.id,
        message: comment.notes ?? "",
        parent_id: comment.originalValue ?? null,
        target_type: comment.targetType,
        target_id: comment.targetId,
        created_at: comment.createdAt.toISOString(),
        author: comment.submittedBy
          ? {
              id: comment.submittedBy.id,
              name: comment.submittedBy.name,
              email: comment.submittedBy.email,
            }
          : null,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to post comment";
      sendBadRequest(res, message);
    }
  });

  return router;
}
