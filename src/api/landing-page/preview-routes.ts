/**
 * Landing Page Preview Routes
 *
 * GET /:pageId/preview        — Render public page from current draft
 * POST /:pageId/preview-scrub — Compare original vs scrubbed content
 */

import { type Response, type Router } from "express";
import type { PrismaClient } from "@prisma/client";
import type { OrgRequest } from "../../types/authenticated-request.js";
import type { LandingPageEditor } from "../../services/landing-page-editor.js";
import type { RoleProfileService } from "../../services/role-profiles.js";
import { renderLandingPageHtml } from "../public-page-renderer.js";
import { requirePageOwnerOrPermission } from "../../middleware/permissions.js";
import { canAccessNamedStories } from "../../services/landing-page-approval.js";
import logger from "../../lib/logger.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { sendSuccess, sendForbidden, sendNotFound } from "../_shared/responses.js";

type AuthReq = OrgRequest;

// ─── Route Registration ─────────────────────────────────────────────────────

interface RegisterPreviewRoutesOptions {
  router: Router;
  prisma: PrismaClient;
  editor: LandingPageEditor;
  roleProfiles: RoleProfileService;
  reqParams: (req: AuthReq) => {
    organizationId: string;
    userId: string;
    userRole: string;
  };
}

export function registerPreviewRoutes({
  router,
  prisma,
  editor,
  roleProfiles,
  reqParams,
}: RegisterPreviewRoutesOptions): void {
  // ── PREVIEW SCRUB (compare original vs scrubbed) ───────────────────

  router.post(
    "/:pageId/preview-scrub",
    requirePageOwnerOrPermission(prisma),
    asyncHandler(async (req: AuthReq, res: Response) => {

      const page = await editor.getForEditing(req.params.pageId as string);
      if (page.includeCompanyName && !(await canAccessNamedStories(prisma, roleProfiles, reqParams(req)))) {
      sendForbidden(res, "Your role cannot access named stories.");
      return;
      }
      const preview = await editor.getPreview(req.params.pageId as string);

      sendSuccess(res, {
      original: { body: page.editableBody },
      scrubbed: { body: preview.body },
      replacements_made: page.editableBody !== preview.body ? 1 : 0,
      });

    }
  ));

  // ── PREVIEW (render public page from current draft) ─────────────────

  router.get(
    "/:pageId/preview",
    requirePageOwnerOrPermission(prisma),
    asyncHandler(async (req: AuthReq, res: Response) => {
      try {
        const page = await editor.getForEditing(req.params.pageId as string);
        if (page.includeCompanyName && !(await canAccessNamedStories(prisma, roleProfiles, reqParams(req)))) {
          sendForbidden(res, "Your role cannot access named stories.");
          return;
        }
        const preview = await editor.getPreview(req.params.pageId as string);

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("X-Robots-Tag", "noindex, nofollow");
        res.setHeader("Cache-Control", "private, no-store");
        res.send(renderLandingPageHtml(preview));
      } catch (err) {
        logger.error("Preview landing page error", { error: err });
        sendNotFound(res, "Landing page not found");
      }
    }
  ));
}
