/**
 * Platform (App Owner) Routes
 *
 * Endpoints for the application owner to manage:
 * - Platform-wide support account configuration
 * - Tenant overview and management
 * - Tenant deletion request approval workflow
 */

import { Router, type NextFunction, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import logger from "../lib/logger.js";

interface PlatformOwnerRequest extends Request {
  userId?: string;
  userEmail?: string;
  user?: { email?: string };
}

const pickFirstString = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
};

export function createPlatformRoutes(prisma: PrismaClient): Router {
  const router = Router();

  // Guard: only the platform owner (highest-level user) can access these routes.
  const requirePlatformOwner = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const platformOwnerEmail = process.env.PLATFORM_OWNER_EMAIL ?? "";
      if (!platformOwnerEmail) {
        res.status(500).json({ error: "PLATFORM_OWNER_EMAIL is not configured" });
        return;
      }

      const ownerReq = req as PlatformOwnerRequest;
      let email = pickFirstString(ownerReq.userEmail) ?? pickFirstString(ownerReq.user?.email);

      if (!email && ownerReq.userId) {
        const user = await prisma.user.findUnique({
          where: { id: ownerReq.userId },
          select: { email: true },
        });
        email = user?.email ?? null;
      }

      if (!email) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      if (email !== platformOwnerEmail) {
        res.status(403).json({ error: "Platform owner access required" });
        return;
      }

      next();
    } catch (err) {
      logger.error("Platform owner auth error", { error: err });
      res.status(500).json({ error: "Failed to validate platform owner access" });
    }
  };

  // ─── Platform Settings (Support Account) ──────────────────────────────────

  router.get("/settings", requirePlatformOwner, async (_req, res) => {
    try {
      const settings = await prisma.platformSettings.findFirst();
      res.json({
        support_account_email: settings?.supportAccountEmail ?? null,
        support_account_label: settings?.supportAccountLabel ?? "Platform Support",
      });
    } catch (err) {
      logger.error("Platform settings GET error", { error: err });
      res.status(500).json({ error: "Failed to load platform settings" });
    }
  });

  router.put("/settings", requirePlatformOwner, async (req, res) => {
    try {
      const schema = z.object({
        support_account_email: z.string().email().nullable().optional(),
        support_account_label: z.string().min(1).max(100).optional(),
      });
      const data = schema.parse(req.body);

      const existing = await prisma.platformSettings.findFirst();
      const settings = existing
        ? await prisma.platformSettings.update({
            where: { id: existing.id },
            data: {
              ...(data.support_account_email !== undefined && {
                supportAccountEmail: data.support_account_email,
              }),
              ...(data.support_account_label !== undefined && {
                supportAccountLabel: data.support_account_label,
              }),
            },
          })
        : await prisma.platformSettings.create({
            data: {
              supportAccountEmail: data.support_account_email ?? null,
              supportAccountLabel: data.support_account_label ?? "Platform Support",
            },
          });

      res.json({
        support_account_email: settings.supportAccountEmail,
        support_account_label: settings.supportAccountLabel,
      });
    } catch (err) {
      logger.error("Platform settings PUT error", { error: err });
      res.status(500).json({ error: "Failed to update platform settings" });
    }
  });

  // ─── Tenant Overview ──────────────────────────────────────────────────────

  router.get("/tenants", requirePlatformOwner, async (_req, res) => {
    try {
      const orgs = await prisma.organization.findMany({
        select: {
          id: true,
          name: true,
          plan: true,
          createdAt: true,
          _count: { select: { users: true } },
          supportOptOut: { select: { id: true } },
          deletionRequest: {
            select: {
              id: true,
              status: true,
              reason: true,
              requestedById: true,
              scheduledDeleteAt: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const tenants = await Promise.all(
        orgs.map(async (org) => {
          const [storyCount, pageCount] = await Promise.all([
            prisma.story.count({
              where: {
                organizationId: org.id,
                generatedAt: { gte: thirtyDaysAgo },
              },
            }),
            prisma.landingPage.count({
              where: {
                organizationId: org.id,
                createdAt: { gte: thirtyDaysAgo },
              },
            }),
          ]);

          const deletion = org.deletionRequest;
          let requestedByEmail: string | null = null;
          if (deletion?.requestedById) {
            const user = await prisma.user.findUnique({
              where: { id: deletion.requestedById },
              select: { email: true },
            });
            requestedByEmail = user?.email ?? null;
          }

          return {
            id: org.id,
            name: org.name,
            plan: org.plan,
            user_count: org._count.users,
            story_count_30d: storyCount,
            page_count_30d: pageCount,
            created_at: org.createdAt.toISOString(),
            support_opted_out: !!org.supportOptOut,
            deletion_request: deletion
              ? {
                  id: deletion.id,
                  status: deletion.status,
                  reason: deletion.reason,
                  requested_by_email: requestedByEmail,
                  scheduled_delete_at: deletion.scheduledDeleteAt?.toISOString() ?? null,
                  created_at: deletion.createdAt.toISOString(),
                }
              : null,
          };
        })
      );

      res.json({ tenants });
    } catch (err) {
      logger.error("Platform tenants error", { error: err });
      res.status(500).json({ error: "Failed to load tenants" });
    }
  });

  // ─── Deletion Approval ────────────────────────────────────────────────────

  router.post(
    "/tenants/:orgId/deletion/approve",
    requirePlatformOwner,
    async (req, res) => {
      try {
        const orgId = pickFirstString(req.params.orgId);
        if (!orgId) {
          return res.status(400).json({ error: "Invalid organization id" });
        }
        const existing = await prisma.tenantDeletionRequest.findUnique({
          where: { organizationId: orgId },
        });

        if (!existing || existing.status !== "PENDING_APPROVAL") {
          return res.status(404).json({ error: "No pending deletion request found" });
        }

        const scheduledDeleteAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        await prisma.tenantDeletionRequest.update({
          where: { id: existing.id },
          data: {
            status: "APPROVED",
            approvedAt: new Date(),
            approvedById: (req as any).userId ?? null,
            scheduledDeleteAt,
          },
        });

        res.json({ ok: true, scheduled_delete_at: scheduledDeleteAt.toISOString() });
      } catch (err) {
        logger.error("Deletion approval error", { error: err });
        res.status(500).json({ error: "Failed to approve deletion" });
      }
    }
  );

  router.post(
    "/tenants/:orgId/deletion/reject",
    requirePlatformOwner,
    async (req, res) => {
      try {
        const orgId = pickFirstString(req.params.orgId);
        if (!orgId) {
          return res.status(400).json({ error: "Invalid organization id" });
        }
        const existing = await prisma.tenantDeletionRequest.findUnique({
          where: { organizationId: orgId },
        });

        if (!existing || existing.status !== "PENDING_APPROVAL") {
          return res.status(404).json({ error: "No pending deletion request found" });
        }

        await prisma.tenantDeletionRequest.update({
          where: { id: existing.id },
          data: {
            status: "CANCELLED",
            cancelledAt: new Date(),
            cancelledById: (req as any).userId ?? null,
          },
        });

        res.json({ ok: true });
      } catch (err) {
        logger.error("Deletion rejection error", { error: err });
        res.status(500).json({ error: "Failed to reject deletion" });
      }
    }
  );

  return router;
}
