/**
 * Merge.dev Integration Routes
 *
 * Handles the Merge Link OAuth flow:
 *   POST /api/merge/link    — Exchange a public_token for an account_token
 *   GET  /api/merge/linked  — List all linked accounts for the org
 *   POST /api/merge/sync    — Trigger a manual sync for a linked account
 */

import { Router, type Request, type Response } from "express";
import type { MergeApiClient } from "../services/merge-api-client.js";
import type { PrismaClient } from "@prisma/client";

export function createMergeRoutes(
  mergeClient: MergeApiClient,
  prisma: PrismaClient
): Router {
  const router = Router();

  /**
   * POST /api/merge/link
   *
   * Called by the frontend after the user completes the Merge Link flow.
   * The frontend receives a public_token from the Merge Link component
   * and sends it here to exchange for a permanent account_token.
   *
   * Body: { publicToken: string }
   */
  router.post("/link", async (req: Request, res: Response) => {
    const organizationId = (req as Record<string, unknown>).organizationId as string;

    if (!organizationId) {
      res.status(401).json({ error: "Missing organization context" });
      return;
    }

    const { publicToken } = req.body as { publicToken?: string };

    if (!publicToken) {
      res.status(400).json({ error: "publicToken is required" });
      return;
    }

    try {
      const linkedAccount = await mergeClient.exchangeLinkToken(
        organizationId,
        publicToken
      );

      res.json({
        id: linkedAccount.id,
        integrationSlug: linkedAccount.integrationSlug,
        category: linkedAccount.category,
        status: linkedAccount.status,
        createdAt: linkedAccount.createdAt,
      });
    } catch (err) {
      console.error("Merge Link token exchange failed:", err);
      res.status(502).json({ error: "Failed to link integration" });
    }
  });

  /**
   * GET /api/merge/linked
   *
   * Returns all linked accounts for the current organization.
   */
  router.get("/linked", async (req: Request, res: Response) => {
    const organizationId = (req as Record<string, unknown>).organizationId as string;

    if (!organizationId) {
      res.status(401).json({ error: "Missing organization context" });
      return;
    }

    const accounts = await prisma.linkedAccount.findMany({
      where: { organizationId },
      select: {
        id: true,
        integrationSlug: true,
        category: true,
        status: true,
        lastSyncedAt: true,
        initialSyncDone: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ linkedAccounts: accounts });
  });

  /**
   * POST /api/merge/sync/:linkedAccountId
   *
   * Manually trigger a sync cycle for a specific linked account.
   * Useful when an admin wants to force a re-sync outside the 15-min interval.
   */
  router.post("/sync/:linkedAccountId", async (req: Request, res: Response) => {
    const organizationId = (req as Record<string, unknown>).organizationId as string;

    if (!organizationId) {
      res.status(401).json({ error: "Missing organization context" });
      return;
    }

    const { linkedAccountId } = req.params;

    const linkedAccount = await prisma.linkedAccount.findFirst({
      where: { id: linkedAccountId, organizationId },
    });

    if (!linkedAccount) {
      res.status(404).json({ error: "Linked account not found" });
      return;
    }

    try {
      if (!linkedAccount.initialSyncDone) {
        // Run initial sync if it hasn't completed yet
        await mergeClient.runInitialSync(linkedAccount);
      } else if (linkedAccount.category === "CRM") {
        // Run incremental CRM sync
        await mergeClient.pollAllLinkedAccounts();
      }

      res.json({ success: true, message: "Sync triggered" });
    } catch (err) {
      console.error(`Manual sync failed for ${linkedAccountId}:`, err);
      res.status(502).json({ error: "Sync failed" });
    }
  });

  return router;
}
