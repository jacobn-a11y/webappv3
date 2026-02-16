/**
 * Billing Routes — Plan, Usage & Stripe Customer Portal
 *
 * Provides endpoints for:
 *   - Current plan and trial status
 *   - Usage meter (transcript minutes consumed this billing period)
 *   - Upgrade/downgrade via Stripe Customer Portal session
 */

import { Router, type Request, type Response } from "express";
import Stripe from "stripe";
import type { PrismaClient, UserRole } from "@prisma/client";
import { requirePermission } from "../middleware/permissions.js";
import { isBillingEnabled } from "../middleware/billing.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createBillingRoutes(
  prisma: PrismaClient,
  stripe: Stripe
): Router {
  const router = Router();

  // ── Current Plan & Status ────────────────────────────────────────────

  /**
   * GET /api/settings/billing
   *
   * Returns the org's current plan, trial status, and Stripe subscription info.
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
        const org = await prisma.organization.findUnique({
          where: { id: req.organizationId },
        });

        if (!org) {
          res.status(404).json({ error: "Organization not found" });
          return;
        }

        // Build base billing info
        const billing: Record<string, unknown> = {
          plan: org.plan,
          billing_enabled: isBillingEnabled(),
          trial_ends_at: org.trialEndsAt,
          trial_active:
            org.plan === "FREE_TRIAL" &&
            (!org.trialEndsAt || new Date() < org.trialEndsAt),
        };

        // If they have a Stripe customer, fetch subscription details
        if (org.stripeCustomerId) {
          const subscriptions = await stripe.subscriptions.list({
            customer: org.stripeCustomerId,
            status: "active",
            limit: 1,
          });

          const subscription = subscriptions.data[0];
          if (subscription) {
            billing.subscription = {
              id: subscription.id,
              status: subscription.status,
              current_period_start: new Date(
                subscription.current_period_start * 1000
              ).toISOString(),
              current_period_end: new Date(
                subscription.current_period_end * 1000
              ).toISOString(),
              cancel_at_period_end: subscription.cancel_at_period_end,
            };
          }
        }

        res.json({ billing });
      } catch (err) {
        console.error("Get billing error:", err);
        res.status(500).json({ error: "Failed to load billing info" });
      }
    }
  );

  // ── Usage Meter ──────────────────────────────────────────────────────

  /**
   * GET /api/settings/billing/usage
   *
   * Returns transcript minutes consumed in the current billing period.
   * Aggregates call durations from the current subscription period.
   */
  router.get(
    "/usage",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const org = await prisma.organization.findUnique({
          where: { id: req.organizationId! },
        });

        if (!org) {
          res.status(404).json({ error: "Organization not found" });
          return;
        }

        // Determine the billing period start
        let periodStart = new Date();
        periodStart.setDate(1); // Default: start of current month
        periodStart.setHours(0, 0, 0, 0);

        if (org.stripeCustomerId) {
          const subscriptions = await stripe.subscriptions.list({
            customer: org.stripeCustomerId,
            status: "active",
            limit: 1,
          });

          const subscription = subscriptions.data[0];
          if (subscription) {
            periodStart = new Date(
              subscription.current_period_start * 1000
            );
          }
        }

        // Sum call durations (seconds) from the current period
        const result = await prisma.call.aggregate({
          where: {
            organizationId: req.organizationId!,
            occurredAt: { gte: periodStart },
            duration: { not: null },
          },
          _sum: { duration: true },
          _count: { id: true },
        });

        const totalSeconds = result._sum.duration ?? 0;
        const totalMinutes = Math.ceil(totalSeconds / 60);

        res.json({
          usage: {
            period_start: periodStart.toISOString(),
            transcript_minutes: totalMinutes,
            total_calls: result._count.id,
          },
        });
      } catch (err) {
        console.error("Get usage error:", err);
        res.status(500).json({ error: "Failed to load usage data" });
      }
    }
  );

  // ── Stripe Customer Portal ───────────────────────────────────────────

  /**
   * POST /api/settings/billing/portal
   *
   * Creates a Stripe Customer Portal session for the org. The portal
   * allows customers to upgrade, downgrade, update payment methods,
   * view invoices, and cancel subscriptions.
   */
  router.post(
    "/portal",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const org = await prisma.organization.findUnique({
          where: { id: req.organizationId! },
        });

        if (!org) {
          res.status(404).json({ error: "Organization not found" });
          return;
        }

        // Ensure Stripe customer exists
        let customerId = org.stripeCustomerId;
        if (!customerId) {
          const customer = await stripe.customers.create({
            metadata: {
              organizationId: org.id,
              organizationName: org.name,
            },
          });
          customerId = customer.id;
          await prisma.organization.update({
            where: { id: org.id },
            data: { stripeCustomerId: customerId },
          });
        }

        const session = await stripe.billingPortal.sessions.create({
          customer: customerId,
          return_url: `${process.env.APP_URL}/settings/billing`,
        });

        res.json({ portal_url: session.url });
      } catch (err) {
        console.error("Create portal session error:", err);
        res.status(500).json({ error: "Failed to create billing portal session" });
      }
    }
  );

  return router;
}
