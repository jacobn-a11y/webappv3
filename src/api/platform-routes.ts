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
import { asyncHandler } from "../lib/async-handler.js";
import { sendSuccess, sendError, sendUnauthorized, sendForbidden, sendBadRequest, sendNotFound } from "./_shared/responses.js";

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

    const platformOwnerEmail = process.env.PLATFORM_OWNER_EMAIL ?? "";
    if (!platformOwnerEmail) {
    sendError(res, 500, "internal_error", "PLATFORM_OWNER_EMAIL is not configured");
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
    sendUnauthorized(res, "Authentication required");
    return;
    }

    if (email !== platformOwnerEmail) {
    sendForbidden(res, "Platform owner access required");
    return;
    }

    next();
    
  };

  // ─── Platform Settings (Support Account) ──────────────────────────────────

  router.get("/settings", requirePlatformOwner, asyncHandler(async (_req, res) => {

    const settings = await prisma.platformSettings.findFirst();
    sendSuccess(res, {
    support_account_email: settings?.supportAccountEmail ?? null,
    support_account_label: settings?.supportAccountLabel ?? "Platform Support",
    });
    
  }));

  router.put("/settings", requirePlatformOwner, asyncHandler(async (req, res) => {

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

    sendSuccess(res, {
    support_account_email: settings.supportAccountEmail,
    support_account_label: settings.supportAccountLabel,
    });
    
  }));

  // ─── Tenant Overview ──────────────────────────────────────────────────────

  router.get("/tenants", requirePlatformOwner, asyncHandler(async (_req, res) => {

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

    sendSuccess(res, { tenants });
    
  }));

  // ─── Deletion Approval ────────────────────────────────────────────────────

  router.post(
    "/tenants/:orgId/deletion/approve",
    requirePlatformOwner,
    asyncHandler(async (req, res) => {

      const orgId = pickFirstString(req.params.orgId);
      if (!orgId) {
      return sendBadRequest(res, "Invalid organization id");
      }
      const existing = await prisma.tenantDeletionRequest.findUnique({
      where: { organizationId: orgId },
      });

      if (!existing || existing.status !== "PENDING_APPROVAL") {
      return sendNotFound(res, "No pending deletion request found");
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

      sendSuccess(res, { ok: true, scheduled_delete_at: scheduledDeleteAt.toISOString() });
      
    }
  ));

  router.post(
    "/tenants/:orgId/deletion/reject",
    requirePlatformOwner,
    asyncHandler(async (req, res) => {

      const orgId = pickFirstString(req.params.orgId);
      if (!orgId) {
      return sendBadRequest(res, "Invalid organization id");
      }
      const existing = await prisma.tenantDeletionRequest.findUnique({
      where: { organizationId: orgId },
      });

      if (!existing || existing.status !== "PENDING_APPROVAL") {
      return sendNotFound(res, "No pending deletion request found");
      }

      await prisma.tenantDeletionRequest.update({
      where: { id: existing.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledById: (req as any).userId ?? null,
      },
      });

      sendSuccess(res, { ok: true });
      
    }
  ));

  return router;
}
