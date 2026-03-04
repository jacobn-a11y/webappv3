/**
 * Integrations Routes — Merge.dev Linked Accounts
 *
 * Provides admin endpoints for managing CRM/video conferencing integrations:
 *   - List connected integrations with sync status
 *   - Initiate Merge.dev Link Token flow (OAuth)
 *   - Disconnect an integration
 *   - Toggle CRM polling per provider
 *   - Trigger manual sync
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { PrismaClient, UserRole, LinkedAccount } from "@prisma/client";
import { requirePermission } from "../middleware/permissions.js";
import logger from "../lib/logger.js";
import type { MergeApiClient } from "../services/merge-api-client.js";

// ─── Validation ──────────────────────────────────────────────────────────────

const ToggleCrmPollingSchema = z.object({
  enabled: z.boolean(),
});

const LinkTokenSchema = z.object({
  category: z.enum(["crm", "filestorage"]),
});

const CompleteLinkSchema = z.object({
  public_token: z.string().min(1, "Public token is required"),
  category: z.enum(["crm", "filestorage"]).optional(),
});

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createIntegrationsRoutes(
  prisma: PrismaClient,
  mergeClient: Pick<MergeApiClient, "exchangeLinkToken">
): Router {
  const router = Router();

  // ── List Connected Integrations ──────────────────────────────────────

  /**
   * GET /api/settings/integrations
   *
   * Returns all Merge.dev linked accounts for the organization,
   * including sync status and polling configuration.
   */
  router.get(
    "/",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        const linkedAccounts = await prisma.linkedAccount.findMany({
          where: { organizationId: req.organizationId },
          orderBy: { createdAt: "asc" },
        });

        res.json({
          merge_configured: Boolean(process.env.MERGE_API_KEY),
          integrations: linkedAccounts.map((la: LinkedAccount) => ({
            id: la.id,
            merge_account_id: la.mergeLinkedAccountId,
            integration: la.integrationSlug,
            category: la.category,
            status: la.status,
            last_synced_at: la.lastSyncedAt,
            initial_sync_done: la.initialSyncDone,
            created_at: la.createdAt,
          })),
        });
      } catch (err) {
        logger.error("List integrations error", { error: err });
        res.status(500).json({ error: "Failed to load integrations" });
      }
    }
  );

  // ── Create Merge.dev Link Token ──────────────────────────────────────

  /**
   * POST /api/settings/integrations/link-token
   *
   * Generates a Merge.dev Link Token for the frontend to open the
   * Merge Link component (OAuth flow). The frontend uses this token
   * to let the user authenticate with their CRM/call recording provider.
   */
  router.post(
    "/link-token",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const parsed = LinkTokenSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "validation_error", details: parsed.error.issues });
        return;
      }

      const mergeApiKey = process.env.MERGE_API_KEY;
      if (!mergeApiKey) {
        res.status(500).json({ error: "Merge.dev integration not configured" });
        return;
      }

      try {
        const [org, user] = await Promise.all([
          prisma.organization.findUnique({
            where: { id: req.organizationId },
            select: { id: true, name: true },
          }),
          req.userId
            ? prisma.user.findUnique({
              where: { id: req.userId },
              select: { email: true },
            })
            : Promise.resolve(null),
        ]);

        const response = await fetch("https://api.merge.dev/api/integrations/create-link-token", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${mergeApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            end_user_origin_id: req.organizationId,
            end_user_organization_name: org?.name ?? "StoryEngine Organization",
            end_user_email_address: user?.email ?? "admin@storyengine.local",
            categories: [parsed.data.category],
          }),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          logger.error("Merge link token error", { error: errorBody });
          res.status(502).json({ error: "Failed to create link token" });
          return;
        }

        const data = await response.json() as { link_token: string };
        res.json({
          link_token: data.link_token,
          category: parsed.data.category,
        });
      } catch (err) {
        logger.error("Create link token error", { error: err });
        res.status(500).json({ error: "Failed to create link token" });
      }
    }
  );

  // ── Complete Merge.dev Link (exchange public token) ──────────────────

  /**
   * POST /api/settings/integrations/complete-link
   *
   * Called by the frontend after a user completes the Merge Link flow.
   * Exchanges the public token for an account token and stores the
   * linked account.
   */
  router.post(
    "/complete-link",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parse = CompleteLinkSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      const mergeApiKey = process.env.MERGE_API_KEY;
      if (!mergeApiKey) {
        res.status(500).json({ error: "Merge.dev integration not configured" });
        return;
      }

      try {
        if (!req.organizationId) {
          res.status(401).json({ error: "Authentication required" });
          return;
        }

        const linkedAccount = await mergeClient.exchangeLinkToken(
          req.organizationId,
          parse.data.public_token
        );

        res.status(201).json({
          integration: {
            id: linkedAccount.id,
            merge_account_id: linkedAccount.mergeLinkedAccountId,
            integration: linkedAccount.integrationSlug,
            category: linkedAccount.category,
            status: linkedAccount.status,
          },
        });
      } catch (err) {
        logger.error("Complete link error", { error: err });
        res.status(500).json({ error: "Failed to complete integration link" });
      }
    }
  );

  // ── Toggle CRM Polling ───────────────────────────────────────────────

  /**
   * PATCH /api/settings/integrations/:integrationId/polling
   *
   * Enables or disables automatic CRM polling for an integration.
   */
  router.patch(
    "/:integrationId/polling",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const parse = ToggleCrmPollingSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      try {
        const linked = await prisma.linkedAccount.findFirst({
          where: {
            id: req.params.integrationId as string,
            organizationId: req.organizationId,
          },
        });

        if (!linked) {
          res.status(404).json({ error: "Integration not found" });
          return;
        }

        // Toggle status between ACTIVE and PAUSED to control polling
        const newStatus = parse.data.enabled ? "ACTIVE" : "PAUSED";
        await prisma.linkedAccount.update({
          where: { id: linked.id },
          data: { status: newStatus },
        });

        res.json({ updated: true, polling_enabled: parse.data.enabled });
      } catch (err) {
        logger.error("Toggle polling error", { error: err });
        res.status(500).json({ error: "Failed to toggle CRM polling" });
      }
    }
  );

  // ── Trigger Manual Sync ──────────────────────────────────────────────

  /**
   * POST /api/settings/integrations/:integrationId/sync
   *
   * Triggers a manual data sync for a Merge.dev linked account.
   * Sets status to SYNCING while the Merge.dev force-sync runs.
   */
  router.post(
    "/:integrationId/sync",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const mergeApiKey = process.env.MERGE_API_KEY;
      if (!mergeApiKey) {
        res.status(500).json({ error: "Merge.dev integration not configured" });
        return;
      }

      try {
        const linked = await prisma.linkedAccount.findFirst({
          where: {
            id: req.params.integrationId as string,
            organizationId: req.organizationId,
          },
        });

        if (!linked) {
          res.status(404).json({ error: "Integration not found" });
          return;
        }

        // Trigger force sync via Merge.dev API
        const response = await fetch(
          `https://api.merge.dev/api/integrations/linked-accounts/${linked.mergeLinkedAccountId}/force-resync`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${mergeApiKey}`,
              "Content-Type": "application/json",
            },
          }
        );

        if (!response.ok) {
          await prisma.linkedAccount.update({
            where: { id: linked.id },
            data: { status: "ERROR" },
          });
          res.status(502).json({ error: "Failed to trigger sync" });
          return;
        }

        res.json({ syncing: true, integration_id: linked.id });
      } catch (err) {
        logger.error("Trigger sync error", { error: err });
        res.status(500).json({ error: "Failed to trigger sync" });
      }
    }
  );

  // ── Disconnect Integration ───────────────────────────────────────────

  /**
   * DELETE /api/settings/integrations/:integrationId
   *
   * Disconnects a Merge.dev linked account.
   */
  router.delete(
    "/:integrationId",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const linked = await prisma.linkedAccount.findFirst({
          where: {
            id: req.params.integrationId as string,
            organizationId: req.organizationId,
          },
        });

        if (!linked) {
          res.status(404).json({ error: "Integration not found" });
          return;
        }

        // Optionally notify Merge.dev to revoke the link
        const mergeApiKey = process.env.MERGE_API_KEY;
        if (mergeApiKey) {
          try {
            await fetch(
              `https://api.merge.dev/api/integrations/linked-accounts/${linked.mergeLinkedAccountId}`,
              {
                method: "DELETE",
                headers: { "Authorization": `Bearer ${mergeApiKey}` },
              }
            );
          } catch {
            // Best-effort — continue with local deletion even if Merge API fails
          }
        }

        await prisma.linkedAccount.delete({ where: { id: linked.id } });
        res.json({ disconnected: true });
      } catch (err) {
        logger.error("Disconnect integration error", { error: err });
        res.status(500).json({ error: "Failed to disconnect integration" });
      }
    }
  );

  return router;
}
