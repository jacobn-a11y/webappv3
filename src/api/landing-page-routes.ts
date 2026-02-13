/**
 * Landing Page API Routes
 *
 * CRUD + publish/share for landing pages.
 * All routes behind auth + permissions middleware.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { LandingPageEditor } from "../services/landing-page-editor.js";
import {
  requireLandingPagesEnabled,
  requirePermission,
  requirePageOwnerOrPermission,
} from "../middleware/permissions.js";

// ─── Validation ──────────────────────────────────────────────────────────────

const CreatePageSchema = z.object({
  story_id: z.string().min(1),
  title: z.string().min(1).max(200),
  subtitle: z.string().max(500).optional(),
  hero_image_url: z.string().url().optional(),
  callout_boxes: z
    .array(
      z.object({
        title: z.string(),
        body: z.string(),
        icon: z
          .enum(["metric", "quote", "insight", "timeline", "warning", "success"])
          .optional(),
      })
    )
    .optional(),
  /** Admin-only: include real company name (no scrubbing). Set at creation, not changeable. */
  include_company_name: z.boolean().optional(),
});

const UpdatePageSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  subtitle: z.string().max(500).optional(),
  editable_body: z.string().optional(),
  hero_image_url: z.string().url().nullable().optional(),
  callout_boxes: z
    .array(
      z.object({
        title: z.string(),
        body: z.string(),
        icon: z
          .enum(["metric", "quote", "insight", "timeline", "warning", "success"])
          .optional(),
      })
    )
    .optional(),
  custom_css: z.string().max(10000).optional(),
  edit_summary: z.string().max(500).optional(),
});

const PublishSchema = z.object({
  visibility: z.enum(["PRIVATE", "SHARED_WITH_LINK"]),
  password: z.string().min(4).max(100).optional(),
  expires_at: z.string().datetime().optional(),
});

// ─── Authenticated request type ──────────────────────────────────────────────

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: string;
}

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createLandingPageRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const editor = new LandingPageEditor(prisma);

  // All landing page routes require the feature to be enabled
  router.use(requireLandingPagesEnabled(prisma));

  // ── CREATE ──────────────────────────────────────────────────────────

  router.post(
    "/",
    requirePermission(prisma, "create"),
    async (req: AuthReq, res: Response) => {
      const parse = CreatePageSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      const { story_id, title, subtitle, hero_image_url, callout_boxes, include_company_name } = parse.data;

      // Named landing pages require the PUBLISH_NAMED_LANDING_PAGE permission.
      // If the user doesn't have it, silently ignore the flag (don't expose the option).
      let namedPageAllowed = false;
      if (include_company_name) {
        const userRole = (req as AuthReq).userRole;
        const ADMIN_ROLES = ["OWNER", "ADMIN"];
        if (userRole && ADMIN_ROLES.includes(userRole)) {
          namedPageAllowed = true;
        } else {
          const namedPerm = await prisma.userPermission.findUnique({
            where: {
              userId_permission: {
                userId: req.userId!,
                permission: "PUBLISH_NAMED_LANDING_PAGE",
              },
            },
          });
          namedPageAllowed = !!namedPerm;
        }
      }

      try {
        const pageId = await editor.create({
          storyId: story_id,
          organizationId: req.organizationId!,
          createdById: req.userId!,
          title,
          subtitle,
          heroImageUrl: hero_image_url,
          calloutBoxes: callout_boxes,
          includeCompanyName: namedPageAllowed,
        });

        const page = await editor.getForEditing(pageId);
        res.status(201).json({
          id: page.id,
          slug: page.slug,
          title: page.title,
          status: page.status,
          editable_body: page.editableBody,
          callout_boxes: page.calloutBoxes,
          total_call_hours: page.totalCallHours,
        });
      } catch (err) {
        console.error("Create landing page error:", err);
        res.status(500).json({ error: "Failed to create landing page" });
      }
    }
  );

  // ── GET (for editing — returns unscrubbed content) ──────────────────

  router.get(
    "/:pageId",
    requirePageOwnerOrPermission(prisma),
    async (req: AuthReq, res: Response) => {
      try {
        const page = await editor.getForEditing(req.params.pageId);

        res.json({
          id: page.id,
          slug: page.slug,
          title: page.title,
          subtitle: page.subtitle,
          status: page.status,
          visibility: page.visibility,
          editable_body: page.editableBody,
          scrubbed_body: page.scrubbedBody || null,
          hero_image_url: page.heroImageUrl,
          callout_boxes: page.calloutBoxes,
          total_call_hours: page.totalCallHours,
          custom_css: page.customCss,
          view_count: page.viewCount,
          published_at: page.publishedAt,
          created_at: page.createdAt,
          account: page.story.account,
          quotes: page.story.quotes.map((q) => ({
            speaker: q.speaker,
            quote_text: q.quoteText,
            metric_type: q.metricType,
            metric_value: q.metricValue,
          })),
          edit_history: page.edits.map((e) => ({
            edited_by: e.editedBy.name ?? e.editedBy.email,
            summary: e.editSummary,
            created_at: e.createdAt,
          })),
        });
      } catch (err) {
        console.error("Get landing page error:", err);
        res.status(404).json({ error: "Landing page not found" });
      }
    }
  );

  // ── UPDATE (save edits) ─────────────────────────────────────────────

  router.patch(
    "/:pageId",
    requirePageOwnerOrPermission(prisma),
    async (req: AuthReq, res: Response) => {
      const parse = UpdatePageSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      try {
        await editor.update(req.params.pageId, req.userId!, {
          title: parse.data.title,
          subtitle: parse.data.subtitle,
          editableBody: parse.data.editable_body,
          heroImageUrl: parse.data.hero_image_url ?? undefined,
          calloutBoxes: parse.data.callout_boxes,
          customCss: parse.data.custom_css,
          editSummary: parse.data.edit_summary,
        });

        res.json({ updated: true });
      } catch (err) {
        console.error("Update landing page error:", err);
        res.status(500).json({ error: "Failed to update landing page" });
      }
    }
  );

  // ── PUBLISH ─────────────────────────────────────────────────────────

  router.post(
    "/:pageId/publish",
    requirePermission(prisma, "publish"),
    async (req: AuthReq, res: Response) => {
      const parse = PublishSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      try {
        const result = await editor.publish(req.params.pageId, {
          visibility: parse.data.visibility,
          password: parse.data.password,
          expiresAt: parse.data.expires_at
            ? new Date(parse.data.expires_at)
            : undefined,
        });

        res.json({
          published: true,
          slug: result.slug,
          url: result.url,
        });
      } catch (err) {
        console.error("Publish landing page error:", err);
        res.status(500).json({ error: "Failed to publish landing page" });
      }
    }
  );

  // ── UNPUBLISH ───────────────────────────────────────────────────────

  router.post(
    "/:pageId/unpublish",
    requirePageOwnerOrPermission(prisma),
    async (req: AuthReq, res: Response) => {
      try {
        await editor.unpublish(req.params.pageId);
        res.json({ unpublished: true });
      } catch (err) {
        console.error("Unpublish error:", err);
        res.status(500).json({ error: "Failed to unpublish" });
      }
    }
  );

  // ── ARCHIVE ─────────────────────────────────────────────────────────

  router.post(
    "/:pageId/archive",
    requirePageOwnerOrPermission(prisma),
    async (req: AuthReq, res: Response) => {
      try {
        await editor.archive(req.params.pageId);
        res.json({ archived: true });
      } catch (err) {
        console.error("Archive error:", err);
        res.status(500).json({ error: "Failed to archive" });
      }
    }
  );

  // ── DELETE ──────────────────────────────────────────────────────────

  router.delete(
    "/:pageId",
    requirePermission(prisma, "delete_any"),
    async (req: AuthReq, res: Response) => {
      try {
        await prisma.landingPage.delete({ where: { id: req.params.pageId } });
        res.json({ deleted: true });
      } catch (err) {
        console.error("Delete landing page error:", err);
        res.status(500).json({ error: "Failed to delete landing page" });
      }
    }
  );

  return router;
}
