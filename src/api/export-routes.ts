/**
 * Landing Page Export Routes
 *
 * Endpoints for exporting landing pages:
 *   POST /api/pages/:pageId/export/pdf         — Download as branded PDF
 *   POST /api/pages/:pageId/export/google-doc   — Create a Google Doc
 *   POST /api/pages/:pageId/export/slack        — Send to Slack channel
 *
 * All routes require authentication + page owner or edit_any permission.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { LandingPageExporter } from "../services/landing-page-exports.js";
import { requirePageOwnerOrPermission } from "../middleware/permissions.js";

// ─── Validation ──────────────────────────────────────────────────────────────

const GoogleDocExportSchema = z.object({
  access_token: z.string().min(1, "Google OAuth access token is required"),
});

const SlackExportSchema = z.object({
  webhook_url: z.string().url().optional(),
});

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createExportRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const exporter = new LandingPageExporter(prisma);
  
  const enforceExportPolicy = async (req: Request, res: Response): Promise<boolean> => {
    const organizationId = (req as unknown as { organizationId?: string }).organizationId;
    if (!organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return false;
    }

    const settings = await prisma.orgSettings.findUnique({
      where: { organizationId },
      select: { dataGovernancePolicy: true } as unknown as Record<string, boolean>,
    });
    const settingsRecord = settings as unknown as { dataGovernancePolicy?: unknown } | null;
    const policy = (settingsRecord?.dataGovernancePolicy ?? {}) as Record<string, unknown>;
    if (policy.pii_export_enabled === false) {
      res.status(403).json({
        error: "policy_denied",
        message: "Exports are disabled by your organization's data governance policy.",
      });
      return false;
    }
    return true;
  };

  // All export routes require page owner or edit_any permission
  router.use("/:pageId/export", requirePageOwnerOrPermission(prisma));

  // ── PDF Export ──────────────────────────────────────────────────────

  /**
   * POST /api/pages/:pageId/export/pdf
   *
   * Renders the landing page as a branded PDF using Puppeteer.
   * Returns the PDF as a binary download.
   */
  router.post("/:pageId/export/pdf", async (req: Request, res: Response) => {
    try {
      if (!(await enforceExportPolicy(req, res))) return;
      const { buffer, filename } = await exporter.exportPdf(req.params.pageId as string);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", buffer.length.toString());
      res.send(buffer);
    } catch (err) {
      console.error("PDF export error:", err);
      const message =
        err instanceof Error ? err.message : "Failed to export PDF";
      res.status(500).json({ error: "pdf_export_failed", message });
    }
  });

  // ── Google Doc Export ───────────────────────────────────────────────

  /**
   * POST /api/pages/:pageId/export/google-doc
   *
   * Creates a Google Doc from the landing page content.
   * Requires a valid Google OAuth2 access token with
   * https://www.googleapis.com/auth/documents and
   * https://www.googleapis.com/auth/drive scopes.
   *
   * Request body:
   *   { "access_token": "ya29...." }
   *
   * Response:
   *   { "document_id": "...", "document_url": "https://docs.google.com/..." }
   */
  router.post(
    "/:pageId/export/google-doc",
    async (req: Request, res: Response) => {
      const parse = GoogleDocExportSchema.safeParse(req.body);
      if (!parse.success) {
        res
          .status(400)
          .json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      try {
        if (!(await enforceExportPolicy(req, res))) return;
        const result = await exporter.exportGoogleDoc(
          req.params.pageId as string,
          parse.data.access_token
        );

        res.json({
          document_id: result.documentId,
          document_url: result.documentUrl,
        });
      } catch (err) {
        console.error("Google Doc export error:", err);
        const message =
          err instanceof Error ? err.message : "Failed to create Google Doc";
        res
          .status(500)
          .json({ error: "google_doc_export_failed", message });
      }
    }
  );

  // ── Slack Export ────────────────────────────────────────────────────

  /**
   * POST /api/pages/:pageId/export/slack
   *
   * Posts the story summary + top 3 callout boxes to Slack
   * via an incoming webhook.
   *
   * Request body (optional):
   *   { "webhook_url": "https://hooks.slack.com/services/..." }
   *
   * If webhook_url is not provided, falls back to the
   * SLACK_WEBHOOK_URL environment variable.
   */
  router.post(
    "/:pageId/export/slack",
    async (req: Request, res: Response) => {
      const parse = SlackExportSchema.safeParse(req.body);
      if (!parse.success) {
        res
          .status(400)
          .json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      try {
        if (!(await enforceExportPolicy(req, res))) return;
        const result = await exporter.exportSlack(
          req.params.pageId as string,
          parse.data.webhook_url
        );

        res.json({ sent: result.ok });
      } catch (err) {
        console.error("Slack export error:", err);
        const message =
          err instanceof Error ? err.message : "Failed to send to Slack";
        res.status(500).json({ error: "slack_export_failed", message });
      }
    }
  );

  return router;
}
