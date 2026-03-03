import { type Router, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import logger from "../../lib/logger.js";
import type { AuthenticatedRequest } from "../../types/authenticated-request.js";
import { asyncHandler } from "../../lib/async-handler.js";

interface RegisterTenantSupportRoutesOptions {
  router: Router;
  prisma: PrismaClient;
}

export function registerTenantSupportRoutes({
  router,
  prisma,
}: RegisterTenantSupportRoutesOptions): void {
  // ─── Support Account Info (Tenant-Side) ──────────────────────────────────

  router.get("/support-account", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

    const platformSettings = await prisma.platformSettings.findFirst();
    const optOut = await prisma.tenantSupportOptOut.findUnique({
    where: { organizationId: req.organizationId },
    });
    res.json({
    email: platformSettings?.supportAccountEmail ?? null,
    label: platformSettings?.supportAccountLabel ?? "Platform Support",
    opted_out: !!optOut,
    });
    
  }));

  router.post("/support-account/opt-out", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

    if (req.userRole !== "OWNER" && req.userRole !== "ADMIN") {
    return res.status(403).json({ error: "Only account owner or admin can manage support access" });
    }
    await prisma.tenantSupportOptOut.upsert({
    where: { organizationId: req.organizationId },
    create: {
      organizationId: req.organizationId,
      optedOutById: req.userId,
    },
    update: {
      optedOutById: req.userId,
      optedOutAt: new Date(),
    },
    });
    res.json({ ok: true });
    
  }));

  router.post("/support-account/opt-in", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

    if (req.userRole !== "OWNER" && req.userRole !== "ADMIN") {
    return res.status(403).json({ error: "Only account owner or admin can manage support access" });
    }
    await prisma.tenantSupportOptOut.deleteMany({
    where: { organizationId: req.organizationId },
    });
    res.json({ ok: true });
    
  }));

  // ─── Account Deletion (Tenant-Side) ─────────────────────────────────────

  router.post("/account/request-deletion", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

    if (req.userRole !== "OWNER") {
    return res.status(403).json({ error: "Only the account owner can request account deletion" });
    }
    const existing = await prisma.tenantDeletionRequest.findUnique({
    where: { organizationId: req.organizationId },
    });
    if (existing && (existing.status === "PENDING_APPROVAL" || existing.status === "APPROVED")) {
    return res.status(409).json({ error: "A deletion request is already pending" });
    }
    // Delete any old cancelled request first
    if (existing) {
    await prisma.tenantDeletionRequest.delete({ where: { id: existing.id } });
    }
    const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 500) : null;
    // From the end-user perspective, the account starts a 30-day deletion countdown immediately.
    // In reality, it goes to the platform owner for approval first.
    const scheduledDeleteAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await prisma.tenantDeletionRequest.create({
    data: {
      organizationId: req.organizationId,
      requestedById: req.userId,
      reason,
      status: "PENDING_APPROVAL",
      scheduledDeleteAt,
    },
    });
    // Return the scheduled date — the user sees this as "will be deleted after 30 days"
    // They don't know about the approval step
    res.json({ ok: true, scheduled_delete_at: scheduledDeleteAt.toISOString() });
    
  }));

  router.post("/account/cancel-deletion", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

    if (req.userRole !== "OWNER") {
    return res.status(403).json({ error: "Only the account owner can cancel deletion" });
    }
    const existing = await prisma.tenantDeletionRequest.findUnique({
    where: { organizationId: req.organizationId },
    });
    if (!existing || (existing.status !== "PENDING_APPROVAL" && existing.status !== "APPROVED")) {
    return res.status(404).json({ error: "No active deletion request found" });
    }
    await prisma.tenantDeletionRequest.update({
    where: { id: existing.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelledById: req.userId,
    },
    });
    res.json({ ok: true });
    
  }));

  router.get("/account/deletion-status", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

    const existing = await prisma.tenantDeletionRequest.findUnique({
    where: { organizationId: req.organizationId },
    });
    if (!existing || existing.status === "CANCELLED" || existing.status === "COMPLETED") {
    return res.json({ has_request: false, status: null, scheduled_delete_at: null, created_at: null });
    }
    // For the end user, both PENDING_APPROVAL and APPROVED show as "scheduled"
    // This hides the approval step from the tenant
    res.json({
    has_request: true,
    status: "SCHEDULED",
    scheduled_delete_at: existing.scheduledDeleteAt?.toISOString() ?? null,
    created_at: existing.createdAt.toISOString(),
    });
    
  }));
}
