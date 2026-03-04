/**
 * Admin Account Access Page
 *
 * Server-rendered HTML page that shows all users with their current account
 * access scope and provides actions to grant/revoke access.
 */

import { Router, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { requirePermission } from "../middleware/permissions.js";
import { renderAccountAccessPage } from "./templates/admin-account-access-template.js";
import type { AuthenticatedRequest } from "../types/authenticated-request.js";

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createAdminAccountAccessPage(prisma: PrismaClient): Router {
  const router = Router();

  /**
   * GET /admin/account-access
   *
   * Serves the admin account access management page.
   */
  router.get(
    "/",
    requirePermission(prisma, "manage_permissions"),
    async (_req: AuthenticatedRequest, res: Response) => {
      res.setHeader("Cache-Control", "private, no-cache");
      res.send(renderAccountAccessPage());
    }
  );

  return router;
}
