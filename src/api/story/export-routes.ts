/**
 * Story Export Routes
 *
 * GET /:storyId/export  — Export a story as PDF or DOCX
 * DELETE /:storyId      — Delete a story
 */

import { type Request, type Response, type Router } from "express";
import type { AuthenticatedRequest } from "../../types/authenticated-request.js";
import { z } from "zod";
import { markdownToPdfBuffer, markdownToDocxBuffer, sanitizeFileName } from "../../services/story-exports.js";
import type { AccountAccessService } from "../../services/account-access.js";
import type { RoleProfileService } from "../../services/role-profiles.js";
import type { StoryQueryService } from "../../services/story-query.js";
import type { RAGEngine } from "../../services/rag-engine.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { sendSuccess, sendBadRequest, sendUnauthorized, sendForbidden, sendNotFound, sendConflict } from "../_shared/responses.js";

// ─── Validation ──────────────────────────────────────────────────────────────

const ExportQuerySchema = z.object({
  format: z.enum(["pdf", "docx"]).default("pdf"),
});

// ─── Route Registration ─────────────────────────────────────────────────────

interface RegisterExportRoutesOptions {
  router: Router;
  storyQuery: StoryQueryService;
  accessService: AccountAccessService;
  roleProfiles: RoleProfileService;
  ragEngine?: RAGEngine;
}

export function registerExportRoutes({
  router,
  storyQuery,
  accessService,
  roleProfiles,
  ragEngine,
}: RegisterExportRoutesOptions): void {
  router.get("/:storyId/export", asyncHandler(async (req: Request, res: Response) => {
    const parse = ExportQuerySchema.safeParse(req.query);
    if (!parse.success) {
      sendBadRequest(res, "validation_error", parse.error.issues);
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

      const [policy, story] = await Promise.all([
        roleProfiles.getEffectivePolicy(organizationId, userId, userRole),
        storyQuery.getStoryForExport(req.params.storyId as string, organizationId),
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
    const organizationId = authReq.organizationId!;
    const userId = authReq.userId!;
    const userRole = authReq.userRole;

    if (!organizationId) {
      sendUnauthorized(res, "Authentication required");
      return;
    }

      const [policy, story] = await Promise.all([
        roleProfiles.getEffectivePolicy(organizationId, userId, userRole),
        storyQuery.getStoryForDeletion(req.params.storyId as string, organizationId),
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

      if (ragEngine) {
        await ragEngine.pruneVectorsForStory({
          organizationId,
          storyId: story.id,
        });
      }
      await storyQuery.deleteStory(story.id);
      sendSuccess(res, { deleted: true });

  }));
}
