/**
 * Billing Middleware — Commercialization Gate & Pricing Enforcement
 *
 * All billing enforcement is gated behind Organization.billingEnabled.
 * When billingEnabled is false (default for internal use), every gate
 * is a no-op and the app functions without any commercial restrictions.
 *
 * When billingEnabled is true, enforces:
 *   - Trial expiration (14-day free trial)
 *   - Seat limits (PER_SEAT / METERED_PLUS_SEAT plans)
 *   - Usage-based metering (METERED / METERED_PLUS_SEAT plans)
 *   - Stripe webhook lifecycle for self-serve customers
 *   - B2B/sales-led subscription management
 */

import type { Request, Response, NextFunction } from "express";
import type Stripe from "stripe";
import type { PrismaClient } from "@prisma/client";
import { PricingService } from "../services/pricing.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AuthenticatedRequest extends Request {
  organizationId?: string;
}

// ─── Commercialization Gate Middleware ────────────────────────────────────────

/**
 * Middleware that checks if the org has an active subscription or is within
 * their free trial period. When billing is disabled for the org, this is
 * a passthrough — all requests are allowed.
 */
export function createTrialGate(prisma: PrismaClient) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    const orgId = req.organizationId;
    if (!orgId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
    });

    if (!org) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }

    // ── Commercialization gate: if billing is off, always allow ────────
    if (!org.billingEnabled) {
      next();
      return;
    }

    // ── Active paid plan — allow through ──────────────────────────────
    if (org.plan !== "FREE_TRIAL") {
      next();
      return;
    }

    // ── Check trial expiration ────────────────────────────────────────
    if (org.trialEndsAt && new Date() > org.trialEndsAt) {
      res.status(402).json({
        error: "trial_expired",
        message: "Your free trial has expired. Please upgrade to continue.",
        upgradeUrl: `/api/billing/checkout?org=${orgId}`,
      });
      return;
    }

    // Trial still active
    next();
  };
}

/**
 * Middleware that enforces seat limits. When billing is disabled or the
 * plan is metered-only, this is a passthrough.
 */
export function createSeatGate(prisma: PrismaClient) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    const orgId = req.organizationId;
    if (!orgId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { billingEnabled: true, pricingModel: true, seatLimit: true },
    });

    if (!org) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }

    // No enforcement if billing is off or plan is metered-only
    if (!org.billingEnabled || org.pricingModel === "METERED") {
      next();
      return;
    }

    // Check seat count vs limit
    if (org.seatLimit !== null) {
      const currentSeats = await prisma.user.count({
        where: { organizationId: orgId },
      });
      if (currentSeats >= org.seatLimit) {
        res.status(403).json({
          error: "seat_limit_reached",
          message: `Your plan allows ${org.seatLimit} seats. Please upgrade to add more users.`,
          currentSeats,
          seatLimit: org.seatLimit,
        });
        return;
      }
    }

    next();
  };
}

// ─── Checkout Handler ────────────────────────────────────────────────────────

/**
 * Creates a Stripe Checkout session. Supports metered, per-seat, and
 * hybrid pricing based on the org's configured pricing model.
 */
export function createCheckoutHandler(
  prisma: PrismaClient,
  pricingService: PricingService
) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const orgId = req.organizationId;
    if (!orgId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }

    // If billing is not enabled, return informational response
    if (!org.billingEnabled) {
      res.status(400).json({
        error: "billing_not_enabled",
        message: "Billing is not enabled for this organization.",
      });
      return;
    }

    // B2B orgs don't self-checkout
    if (org.billingChannel === "SALES_LED") {
      res.status(400).json({
        error: "sales_led_billing",
        message:
          "Your organization uses invoice-based billing. Contact your account manager to modify your subscription.",
      });
      return;
    }

    try {
      const seatCount = req.body?.seat_count
        ? parseInt(req.body.seat_count, 10)
        : undefined;

      const checkoutUrl = await pricingService.createCheckoutSession(
        orgId,
        { seatCount }
      );

      if (!checkoutUrl) {
        res.status(500).json({ error: "Billing not configured — no price IDs set." });
        return;
      }

      res.json({ checkoutUrl });
    } catch (err) {
      console.error("Checkout error:", err);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  };
}

// ─── Stripe Webhook Handler ──────────────────────────────────────────────────

/**
 * Stripe webhook handler for subscription lifecycle events.
 * Delegates to PricingService for processing.
 */
export function createStripeWebhookHandler(
  stripe: Stripe,
  pricingService: PricingService
) {
  return async (req: Request, res: Response) => {
    const sig = req.headers["stripe-signature"] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      res.status(500).json({ error: "Webhook secret not configured" });
      return;
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      res.status(400).json({ error: "Invalid webhook signature" });
      return;
    }

    try {
      await pricingService.handleSubscriptionEvent(event);
    } catch (err) {
      console.error("Stripe webhook processing error:", err);
    }

    res.json({ received: true });
  };
}

// ─── Usage Reporting Helper ──────────────────────────────────────────────────

/**
 * Reports transcript usage through the pricing service.
 * Records locally always; only reports to Stripe when billing is enabled
 * and the plan is metered.
 */
export async function reportTranscriptUsage(
  pricingService: PricingService,
  organizationId: string,
  transcriptMinutes: number,
  callId?: string
): Promise<void> {
  await pricingService.recordUsage(
    organizationId,
    "TRANSCRIPT_MINUTES",
    transcriptMinutes,
    callId ? { callId } : undefined
  );
}
