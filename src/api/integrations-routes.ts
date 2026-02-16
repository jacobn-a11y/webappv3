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
import type { PrismaClient, UserRole } from "@prisma/client";
import { requirePermission } from "../middleware/permissions.js";

// ─── Validation ──────────────────────────────────────────────────────────────

const ToggleCrmPollingSchema = z.object({
  enabled: z.boolean(),
});

const CompleteLinkSchema = z.object({
  public_token: z.string().min(1, "Public token is required"),
});

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createIntegrationsRoutes(prisma: PrismaClient): Router {
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
        const linkedAccounts = await prisma.mergeLinkedAccount.findMany({
          where: { organizationId: req.organizationId },
          orderBy: { createdAt: "asc" },
        });

        res.json({
          integrations: linkedAccounts.map((la) => ({
            id: la.id,
            merge_account_id: la.mergeAccountId,
            integration: la.integrationSlug,
            category: la.category,
            status: la.status,
            crm_polling_enabled: la.crmPollingEnabled,
            last_sync: {
              started_at: la.lastSyncStartedAt,
              completed_at: la.lastSyncCompletedAt,
              error: la.lastSyncError,
            },
            created_at: la.createdAt,
          })),
        });
      } catch (err) {
        console.error("List integrations error:", err);
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
      const mergeApiKey = process.env.MERGE_API_KEY;
      if (!mergeApiKey) {
        res.status(500).json({ error: "Merge.dev integration not configured" });
        return;
      }

      try {
        const response = await fetch("https://api.merge.dev/api/integrations/create-link-token", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${mergeApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            end_user_origin_id: req.organizationId,
            end_user_organization_name: "org",
            end_user_email_address: "admin@org.com",
            categories: ["crm", "ats"],
          }),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          console.error("Merge link token error:", errorBody);
          res.status(502).json({ error: "Failed to create link token" });
          return;
        }

        const data = await response.json() as { link_token: string };
        res.json({ link_token: data.link_token });
      } catch (err) {
        console.error("Create link token error:", err);
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
        // Exchange public token for account token
        const response = await fetch("https://api.merge.dev/api/integrations/create-account-token", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${mergeApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            public_token: parse.data.public_token,
          }),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          console.error("Merge token exchange error:", errorBody);
          res.status(502).json({ error: "Failed to exchange token" });
          return;
        }

        const data = await response.json() as {
          account_token: string;
          integration: {
            name: string;
            slug: string;
            categories: string[];
          };
        };

        // Store the linked account
        const linkedAccount = await prisma.mergeLinkedAccount.create({
          data: {
            organizationId: req.organizationId!,
            mergeAccountId: data.account_token,
            integrationSlug: data.integration.slug,
            category: data.integration.categories[0] ?? "crm",
            status: "CONNECTED",
          },
        });

        res.status(201).json({
          integration: {
            id: linkedAccount.id,
            integration: linkedAccount.integrationSlug,
            category: linkedAccount.category,
            status: linkedAccount.status,
          },
        });
      } catch (err) {
        console.error("Complete link error:", err);
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
        const linked = await prisma.mergeLinkedAccount.findFirst({
          where: {
            id: req.params.integrationId,
            organizationId: req.organizationId!,
          },
        });

        if (!linked) {
          res.status(404).json({ error: "Integration not found" });
          return;
        }

        await prisma.mergeLinkedAccount.update({
          where: { id: linked.id },
          data: { crmPollingEnabled: parse.data.enabled },
        });

        res.json({ updated: true, crm_polling_enabled: parse.data.enabled });
      } catch (err) {
        console.error("Toggle polling error:", err);
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
        const linked = await prisma.mergeLinkedAccount.findFirst({
          where: {
            id: req.params.integrationId,
            organizationId: req.organizationId!,
          },
        });

        if (!linked) {
          res.status(404).json({ error: "Integration not found" });
          return;
        }

        // Mark as syncing
        await prisma.mergeLinkedAccount.update({
          where: { id: linked.id },
          data: {
            status: "SYNCING",
            lastSyncStartedAt: new Date(),
            lastSyncError: null,
          },
        });

        // Trigger force sync via Merge.dev API
        const response = await fetch(
          `https://api.merge.dev/api/integrations/linked-accounts/${linked.mergeAccountId}/force-resync`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${mergeApiKey}`,
              "Content-Type": "application/json",
            },
          }
        );

        if (!response.ok) {
          await prisma.mergeLinkedAccount.update({
            where: { id: linked.id },
            data: {
              status: "ERROR",
              lastSyncError: `Sync request failed with status ${response.status}`,
            },
          });
          res.status(502).json({ error: "Failed to trigger sync" });
          return;
        }

        res.json({ syncing: true, integration_id: linked.id });
      } catch (err) {
        console.error("Trigger sync error:", err);
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
        const linked = await prisma.mergeLinkedAccount.findFirst({
          where: {
            id: req.params.integrationId,
            organizationId: req.organizationId!,
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
              `https://api.merge.dev/api/integrations/linked-accounts/${linked.mergeAccountId}`,
              {
                method: "DELETE",
                headers: { "Authorization": `Bearer ${mergeApiKey}` },
              }
            );
          } catch {
            // Best-effort — continue with local deletion even if Merge API fails
          }
        }

        await prisma.mergeLinkedAccount.delete({ where: { id: linked.id } });
        res.json({ disconnected: true });
      } catch (err) {
        console.error("Disconnect integration error:", err);
        res.status(500).json({ error: "Failed to disconnect integration" });
      }
    }
  );

  return router;
}
