/**
 * Stripe Billing Middleware — Free Trial & Usage Gate
 *
 * Implements PLG (Product-Led Growth) billing logic:
 *  - 14-day free trial with no credit card required
 *  - Usage-based billing on transcript minutes processed
 *  - Trial expiration gate on protected routes
 *  - Stripe webhook handling for subscription lifecycle
 */

import type { Request, Response, NextFunction } from "express";
import Stripe from "stripe";
import type { PrismaClient } from "@prisma/client";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AuthenticatedRequest extends Request {
  organizationId?: string;
}

// ─── Free Trial Middleware ────────────────────────────────────────────────────

/**
 * Middleware that checks if the org has an active subscription or is within
 * their free trial period. Blocks access if the trial has expired and no
 * active subscription exists.
 */
export function createTrialGate(prisma: PrismaClient, stripe: Stripe) {
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

    // Active paid plan — allow through
    if (org.plan !== "FREE_TRIAL") {
      next();
      return;
    }

    // Check trial expiration
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
 * Creates a Stripe Checkout session for upgrading from free trial.
 */
export function createCheckoutHandler(prisma: PrismaClient, stripe: Stripe) {
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

    // Create or retrieve Stripe customer
    let customerId = org.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { organizationId: orgId, organizationName: org.name },
      });
      customerId = customer.id;
      await prisma.organization.update({
        where: { id: orgId },
        data: { stripeCustomerId: customerId },
      });
    }

    const priceId = process.env.STRIPE_FREE_TRIAL_PRICE_ID;
    if (!priceId) {
      res.status(500).json({ error: "Billing not configured" });
      return;
    }

    // Create checkout session with usage-based pricing
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId }],
      success_url: `${process.env.APP_URL}/settings/billing?success=true`,
      cancel_url: `${process.env.APP_URL}/settings/billing?canceled=true`,
      subscription_data: {
        metadata: { organizationId: orgId },
      },
    });

    res.json({ checkoutUrl: session.url });
  };
}

/**
 * Reports usage to Stripe for metered billing.
 * Called after each transcript is processed.
 */
export async function reportTranscriptUsage(
  stripe: Stripe,
  prisma: PrismaClient,
  organizationId: string,
  transcriptMinutes: number
): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
  });

  if (!org?.stripeCustomerId) return;

  // Find the active subscription
  const subscriptions = await stripe.subscriptions.list({
    customer: org.stripeCustomerId,
    status: "active",
    limit: 1,
  });

  const subscription = subscriptions.data[0];
  if (!subscription) return;

  // Find the metered subscription item
  const meteredItem = subscription.items.data[0];
  if (!meteredItem) return;

  // Report usage (in minutes)
  await stripe.subscriptionItems.createUsageRecord(meteredItem.id, {
    quantity: Math.ceil(transcriptMinutes),
    action: "increment",
  });
}

/**
 * Stripe webhook handler for subscription lifecycle events.
 */
export function createStripeWebhookHandler(
  prisma: PrismaClient,
  stripe: Stripe
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

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orgId = session.metadata?.organizationId;
        if (orgId) {
          await prisma.organization.update({
            where: { id: orgId },
            data: { plan: "STARTER", trialEndsAt: null },
          });
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const orgId = subscription.metadata.organizationId;
        if (orgId && subscription.status === "active") {
          await prisma.organization.update({
            where: { id: orgId },
            data: { plan: "STARTER" },
          });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const orgId = subscription.metadata.organizationId;
        if (orgId) {
          await prisma.organization.update({
            where: { id: orgId },
            data: { plan: "FREE_TRIAL" },
          });
        }
        break;
      }
    }

    res.json({ received: true });
  };
}
