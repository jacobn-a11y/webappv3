/**
 * Landing Page API Routes
 *
 * CRUD + publish/share for landing pages.
 * All routes behind auth + permissions middleware.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { PrismaClient, UserRole } from "@prisma/client";
import { LandingPageEditor } from "../services/landing-page-editor.js";
import { AccountAccessService } from "../services/account-access.js";
import { RoleProfileService } from "../services/role-profiles.js";
import { AuditLogService } from "../services/audit-log.js";
import { renderLandingPageHtml } from "./public-page-renderer.js";
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
  const accessService = new AccountAccessService(prisma);
  const roleProfiles = new RoleProfileService(prisma);
  const auditLogs = new AuditLogService(prisma);

  const isAdminRole = (userRole?: string): boolean =>
    !!userRole && ["OWNER", "ADMIN"].includes(userRole);

  async function canAccessNamedStories(req: AuthReq): Promise<boolean> {
    if (isAdminRole(req.userRole)) {
      return true;
    }
    if (!req.organizationId || !req.userId) {
      return false;
    }
    const policy = await roleProfiles.getEffectivePolicy(
      req.organizationId,
      req.userId,
      req.userRole as UserRole | undefined
    );
    return (
      policy.canAccessNamedStories ||
      policy.permissions.includes("PUBLISH_NAMED_LANDING_PAGE")
    );
  }

  async function canGenerateNamedStories(req: AuthReq): Promise<boolean> {
    if (isAdminRole(req.userRole)) {
      return true;
    }
    if (!req.organizationId || !req.userId) {
      return false;
    }
    const policy = await roleProfiles.getEffectivePolicy(
      req.organizationId,
      req.userId,
      req.userRole as UserRole | undefined
    );
    return (
      policy.canGenerateNamedStories ||
      policy.permissions.includes("PUBLISH_NAMED_LANDING_PAGE")
    );
  }

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
      if (!req.organizationId || !req.userId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const story = await prisma.story.findFirst({
        where: { id: story_id, organizationId: req.organizationId },
        select: { id: true, accountId: true },
      });
      if (!story) {
        res.status(404).json({ error: "Story not found" });
        return;
      }

      const canAccessAccount = await accessService.canAccessAccount(
        req.userId,
        req.organizationId,
        story.accountId,
        req.userRole as UserRole | undefined
      );
      if (!canAccessAccount) {
        res.status(403).json({
          error: "permission_denied",
          message: "You do not have access to this account.",
        });
        return;
      }

      let namedPageAllowed = false;
      if (include_company_name === true) {
        namedPageAllowed = await canGenerateNamedStories(req);
        if (!namedPageAllowed) {
          res.status(403).json({
            error: "permission_denied",
            message: "Your role cannot generate named stories.",
          });
          return;
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
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "PUBLISH",
          action: "PAGE_CREATED",
          targetType: "landing_page",
          targetId: page.id,
          severity: "INFO",
          metadata: {
            story_id,
            include_company_name: namedPageAllowed,
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
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
        const page = await editor.getForEditing(req.params.pageId as string);
        if (page.includeCompanyName && !(await canAccessNamedStories(req))) {
          res.status(403).json({
            error: "permission_denied",
            message: "Your role cannot access named stories.",
          });
          return;
        }

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

  // ── EDIT DATA (JSON for React editor page) ──────────────────────────

  router.get(
    "/:pageId/edit-data",
    requirePageOwnerOrPermission(prisma),
    async (req: AuthReq, res: Response) => {
      try {
        const page = await editor.getForEditing(req.params.pageId as string);
        if (page.includeCompanyName && !(await canAccessNamedStories(req))) {
          res.status(403).json({
            error: "permission_denied",
            message: "Your role cannot access named stories.",
          });
          return;
        }

        const canPublishNamed = await canGenerateNamedStories(req);

        res.json({
          pageId: page.id,
          title: page.title,
          subtitle: page.subtitle ?? "",
          editableBody: page.editableBody,
          status: page.status,
          visibility: page.visibility,
          includeCompanyName: page.includeCompanyName,
          canPublishNamed,
        });
      } catch (err) {
        console.error("Get editor data error:", err);
        res.status(404).json({ error: "Landing page not found" });
      }
    }
  );

  // ── PREVIEW SCRUB (compare original vs scrubbed) ───────────────────

  router.post(
    "/:pageId/preview-scrub",
    requirePageOwnerOrPermission(prisma),
    async (req: AuthReq, res: Response) => {
      try {
        const page = await editor.getForEditing(req.params.pageId as string);
        if (page.includeCompanyName && !(await canAccessNamedStories(req))) {
          res.status(403).json({
            error: "permission_denied",
            message: "Your role cannot access named stories.",
          });
          return;
        }
        const preview = await editor.getPreview(req.params.pageId as string);

        res.json({
          original: { body: page.editableBody },
          scrubbed: { body: preview.body },
          replacements_made: page.editableBody !== preview.body ? 1 : 0,
        });
      } catch (err) {
        console.error("Preview scrub error:", err);
        res.status(500).json({ error: "Failed to generate scrub preview" });
      }
    }
  );

  // ── PREVIEW (render public page from current draft) ─────────────────

  router.get(
    "/:pageId/preview",
    requirePageOwnerOrPermission(prisma),
    async (req: AuthReq, res: Response) => {
      try {
        const page = await editor.getForEditing(req.params.pageId as string);
        if (page.includeCompanyName && !(await canAccessNamedStories(req))) {
          res.status(403).json({
            error: "permission_denied",
            message: "Your role cannot access named stories.",
          });
          return;
        }
        const preview = await editor.getPreview(req.params.pageId as string);

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("X-Robots-Tag", "noindex, nofollow");
        res.setHeader("Cache-Control", "private, no-store");
        res.send(renderLandingPageHtml(preview));
      } catch (err) {
        console.error("Preview landing page error:", err);
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
        const page = await editor.getForEditing(req.params.pageId as string);
        if (page.includeCompanyName && !(await canAccessNamedStories(req))) {
          res.status(403).json({
            error: "permission_denied",
            message: "Your role cannot access named stories.",
          });
          return;
        }

        await editor.update(req.params.pageId as string, req.userId!, {
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
        const page = await editor.getForEditing(req.params.pageId as string);
        if (page.includeCompanyName && !(await canGenerateNamedStories(req))) {
          res.status(403).json({
            error: "permission_denied",
            message: "Your role cannot generate named stories.",
          });
          return;
        }

        const result = await editor.publish(req.params.pageId as string, {
          visibility: parse.data.visibility,
          password: parse.data.password,
          expiresAt: parse.data.expires_at
            ? new Date(parse.data.expires_at)
            : undefined,
        });
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "PUBLISH",
          action: "PAGE_PUBLISHED",
          targetType: "landing_page",
          targetId: req.params.pageId as string,
          severity: "INFO",
          metadata: {
            visibility: parse.data.visibility,
            has_password: !!parse.data.password,
            expires_at: parse.data.expires_at ?? null,
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
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
        const page = await editor.getForEditing(req.params.pageId as string);
        if (page.includeCompanyName && !(await canAccessNamedStories(req))) {
          res.status(403).json({
            error: "permission_denied",
            message: "Your role cannot access named stories.",
          });
          return;
        }

        await editor.unpublish(req.params.pageId as string);
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "PUBLISH",
          action: "PAGE_UNPUBLISHED",
          targetType: "landing_page",
          targetId: req.params.pageId as string,
          severity: "INFO",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
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
        const page = await editor.getForEditing(req.params.pageId as string);
        if (page.includeCompanyName && !(await canAccessNamedStories(req))) {
          res.status(403).json({
            error: "permission_denied",
            message: "Your role cannot access named stories.",
          });
          return;
        }

        await editor.archive(req.params.pageId as string);
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "PUBLISH",
          action: "PAGE_ARCHIVED",
          targetType: "landing_page",
          targetId: req.params.pageId as string,
          severity: "INFO",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
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
        // SECURITY: Ensure the page belongs to the authenticated user's org
        // to prevent cross-organization deletion
        const page = await prisma.landingPage.findFirst({
          where: { id: req.params.pageId as string, organizationId: req.organizationId! },
        });
        if (!page) {
          res.status(404).json({ error: "Landing page not found" });
          return;
        }

        await prisma.landingPage.delete({ where: { id: page.id } });
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId,
          category: "PUBLISH",
          action: "PAGE_DELETED",
          targetType: "landing_page",
          targetId: page.id,
          severity: "WARN",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({ deleted: true });
      } catch (err) {
        console.error("Delete landing page error:", err);
        res.status(500).json({ error: "Failed to delete landing page" });
      }
    }
  );

  return router;
}
