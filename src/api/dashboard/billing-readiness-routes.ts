import { type Response, type Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { requirePermission } from "../../middleware/permissions.js";
import type { AuditLogService } from "../../services/audit-log.js";
import type { FeatureFlagService } from "../../services/feature-flags.js";
import { getResolvedEntitlementOverride } from "../../services/entitlements.js";
import logger from "../../lib/logger.js";
import { parseRequestBody } from "../_shared/validators.js";
import type { AuthenticatedRequest } from "../../types/authenticated-request.js";
import { asyncHandler } from "../../lib/async-handler.js";

const UpdateSeatLimitSchema = z.object({
  seat_limit: z.number().int().min(1).max(50000),
});

interface RegisterBillingReadinessRoutesOptions {
  router: Router;
  prisma: PrismaClient;
  auditLogs: AuditLogService;
  featureFlags: FeatureFlagService;
}

export function registerBillingReadinessRoutes({
  router,
  prisma,
  auditLogs,
  featureFlags,
}: RegisterBillingReadinessRoutesOptions): void {
  // ── Admin: Billing Readiness ──────────────────────────────────────

  router.get(
    "/billing/readiness",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const organizationId = req.organizationId;
      const [org, users, subscription, usageLast30] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          id: true,
          plan: true,
          pricingModel: true,
          billingChannel: true,
          seatLimit: true,
        },
      }),
      prisma.user.findMany({
        where: { organizationId },
        select: { role: true },
      }),
      prisma.subscription.findFirst({
        where: { organizationId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.usageRecord.findMany({
        where: {
          organizationId,
          periodStart: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
        select: { metric: true, quantity: true, periodStart: true, periodEnd: true },
        orderBy: { periodStart: "desc" },
      }),
      ]);

      if (!org) {
      res.status(404).json({ error: "Organization not found" });
      return;
      }

      const seatsUsed = users.length;
      const roleCounts = users.reduce<Record<string, number>>((acc, u) => {
      acc[u.role] = (acc[u.role] ?? 0) + 1;
      return acc;
      }, {});
      const overSeat = org.seatLimit !== null && seatsUsed > org.seatLimit;
      const usageByMetric = usageLast30.reduce<Record<string, number>>((acc, u) => {
      acc[u.metric] = (acc[u.metric] ?? 0) + u.quantity;
      return acc;
      }, {});
      const transcriptMinutes = usageByMetric.TRANSCRIPT_MINUTES ?? 0;
      const includedUnits = subscription?.includedUnits ?? null;
      const overageUnits =
      includedUnits !== null ? Math.max(0, transcriptMinutes - includedUnits) : 0;
      const projectedOverageCost =
      includedUnits !== null && subscription?.meteredUnitPrice
        ? overageUnits * subscription.meteredUnitPrice
        : null;
      const enabledFeatureFlags = await featureFlags.getResolvedEnabledKeys(organizationId);
      const entitlementOverride = getResolvedEntitlementOverride(organizationId);
      const effectiveSeatLimit =
      entitlementOverride.seat_limit !== undefined
        ? entitlementOverride.seat_limit
        : org.seatLimit;

      res.json({
      organization: {
        plan: org.plan,
        pricing_model: org.pricingModel,
        billing_channel: org.billingChannel,
      },
      seats: {
        limit: effectiveSeatLimit,
        used: seatsUsed,
        over_limit:
          effectiveSeatLimit !== null && effectiveSeatLimit !== undefined
            ? seatsUsed > effectiveSeatLimit
            : overSeat,
        by_role: roleCounts,
      },
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            seat_count: subscription.seatCount,
            included_units: subscription.includedUnits,
            metered_unit_price: subscription.meteredUnitPrice,
            current_period_start: subscription.currentPeriodStart?.toISOString() ?? null,
            current_period_end: subscription.currentPeriodEnd?.toISOString() ?? null,
          }
        : null,
      usage_30d: usageByMetric,
      overage: {
        metric: "TRANSCRIPT_MINUTES",
        included_units: includedUnits,
        used_units: transcriptMinutes,
        overage_units: overageUnits,
        projected_cost: projectedOverageCost,
      },
      entitlements: {
        feature_flags: Array.from(
          new Set([...(enabledFeatureFlags ?? []), ...(entitlementOverride.feature_flags ?? [])])
        ),
        usage_caps: entitlementOverride.usage_caps ?? {},
        environment: process.env.DEPLOY_ENV || process.env.NODE_ENV || "development",
      },
      });
      
    }
  ));

  router.patch(
    "/billing/seats",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const payload = parseRequestBody(UpdateSeatLimitSchema, req.body, res);
      if (!payload) {
        return;
      }

      const organizationId = req.organizationId;
      await prisma.organization.update({
      where: { id: organizationId },
      data: { seatLimit: payload.seat_limit },
      });
      await prisma.subscription.updateMany({
      where: { organizationId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
      data: { seatCount: payload.seat_limit },
      });
      await auditLogs.record({
      organizationId,
      actorUserId: req.userId,
      category: "BILLING",
      action: "SEAT_LIMIT_UPDATED",
      targetType: "organization",
      targetId: organizationId,
      severity: "WARN",
      metadata: { seat_limit: payload.seat_limit },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      });
      res.json({ updated: true });
      
    }
  ));

  router.get(
    "/billing/reconciliation",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const organizationId = req.organizationId;
      const [usageRecords, calls] = await Promise.all([
      prisma.usageRecord.findMany({
        where: {
          organizationId,
          metric: "TRANSCRIPT_MINUTES",
          periodStart: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
        select: { quantity: true, periodStart: true, periodEnd: true, reportedToStripe: true },
      }),
      prisma.call.findMany({
        where: {
          organizationId,
          occurredAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          duration: { not: null },
        },
        select: { duration: true, occurredAt: true },
      }),
      ]);

      const meteredMinutes = usageRecords.reduce((acc, r) => acc + r.quantity, 0);
      const computedMinutes = Math.ceil(calls.reduce((acc, c) => acc + (c.duration ?? 0), 0) / 60);
      const delta = Math.abs(meteredMinutes - computedMinutes);
      const mismatchPct =
      computedMinutes === 0 ? 0 : Number(((delta / computedMinutes) * 100).toFixed(2));
      const status = mismatchPct <= 1 ? "OK" : mismatchPct <= 5 ? "WARN" : "CRITICAL";

      res.json({
      window_days: 30,
      metered_minutes: meteredMinutes,
      computed_minutes: computedMinutes,
      delta_minutes: delta,
      mismatch_percent: mismatchPct,
      status,
      stripe_report_coverage_percent:
        usageRecords.length === 0
          ? 0
          : Number(
              (
                (usageRecords.filter((r) => r.reportedToStripe).length / usageRecords.length) *
                100
              ).toFixed(2)
            ),
      });
      
    }
  ));
}
