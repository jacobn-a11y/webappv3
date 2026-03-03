import { Router, type Response } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { AuthenticatedRequest } from "../types/authenticated-request.js";

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
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const parse = ListCommentsQuerySchema.safeParse(req.query);
    if (!parse.success) {
      res.status(400).json({ error: "validation_error", details: parse.error.issues });
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

      res.json({
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
      res.status(400).json({ error: message });
    }
  });

  router.post("/:storyId/comments", async (req: AuthenticatedRequest, res: Response) => {
    if (!req.organizationId || !req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const parse = CreateCommentSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "validation_error", details: parse.error.issues });
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

      res.status(201).json({
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
      res.status(400).json({ error: message });
    }
  });

  return router;
}
