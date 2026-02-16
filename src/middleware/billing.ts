/**
 * Stripe Billing Middleware — Free Trial, Checkout, Portal & Webhooks
 *
 * Implements PLG (Product-Led Growth) billing logic:
 *  - 14-day free trial with no credit card required
 *  - Usage-based billing on transcript minutes processed
 *  - Trial expiration gate on protected routes
 *  - Plan-aware checkout session creation (Starter / Professional / Enterprise)
 *  - Customer portal for self-service subscription management
 *  - Stripe webhook handling for invoices and subscription lifecycle
 */

import type { Request, Response, NextFunction } from "express";
import Stripe from "stripe";
import type { PrismaClient, Plan } from "@prisma/client";
import { z } from "zod";
import {
  PLAN_CONFIGS,
  getStripePriceId,
  getPlanByPriceId,
} from "../config/stripe-plans.js";

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
        upgradeUrl: `/api/billing/checkout`,
      });
      return;
    }

    // Trial still active
    next();
  };
}

// ─── Checkout Session ────────────────────────────────────────────────────────

const checkoutSchema = z.object({
  plan: z.enum(["STARTER", "PROFESSIONAL", "ENTERPRISE"]),
});

/**
 * Creates a Stripe Checkout session for subscribing to a specific plan.
 * Enterprise plans with contactSales=true redirect to a sales contact page
 * unless an Enterprise price ID is configured (for custom-negotiated rates).
 */
export function createCheckoutHandler(prisma: PrismaClient, stripe: Stripe) {
  return async (req: AuthenticatedRequest, res: Response) => {
    const orgId = req.organizationId;
    if (!orgId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { plan } = parsed.data;
    const planConfig = PLAN_CONFIGS[plan];

    // Enterprise without a configured price → direct to sales
    if (planConfig.contactSales && !getStripePriceId(plan)) {
      res.json({
        contactSales: true,
        message: "Enterprise plans require a custom agreement. Our team will reach out.",
        calendlyUrl: `${process.env.APP_URL}/contact-sales`,
      });
      return;
    }

    const priceId = getStripePriceId(plan);
    if (!priceId) {
      res.status(500).json({ error: `Billing not configured for ${planConfig.name} plan` });
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

    // Create checkout session with usage-based (metered) pricing
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId }],
      success_url: `${process.env.APP_URL}/settings/billing?success=true&plan=${plan}`,
      cancel_url: `${process.env.APP_URL}/settings/billing?canceled=true`,
      subscription_data: {
        metadata: { organizationId: orgId, plan },
      },
    });

    res.json({ checkoutUrl: session.url });
  };
}

// ─── Customer Portal ─────────────────────────────────────────────────────────

/**
 * Creates a Stripe Customer Portal session so customers can manage their
 * subscription, update payment methods, view invoices, and cancel.
 */
export function createPortalHandler(prisma: PrismaClient, stripe: Stripe) {
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

    if (!org.stripeCustomerId) {
      res.status(400).json({
        error: "No billing account",
        message: "Your organization does not have an active billing account. Subscribe to a plan first.",
      });
      return;
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: `${process.env.APP_URL}/settings/billing`,
    });

    res.json({ portalUrl: portalSession.url });
  };
}

// ─── Usage Reporting ─────────────────────────────────────────────────────────

/**
 * Reports usage to Stripe for metered billing.
 * Called by the daily usage aggregation cron job.
 */
export async function reportUsageToStripe(
  stripe: Stripe,
  prisma: PrismaClient,
  organizationId: string,
  transcriptMinutes: number,
  timestamp: number
): Promise<string | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
  });

  if (!org?.stripeCustomerId || org.plan === "FREE_TRIAL") return null;

  // Find the active subscription
  const subscriptions = await stripe.subscriptions.list({
    customer: org.stripeCustomerId,
    status: "active",
    limit: 1,
  });

  const subscription = subscriptions.data[0];
  if (!subscription) return null;

  // Find the metered subscription item
  const meteredItem = subscription.items.data[0];
  if (!meteredItem) return null;

  // Report usage (in minutes, rounded up)
  const usageRecord = await stripe.subscriptionItems.createUsageRecord(
    meteredItem.id,
    {
      quantity: Math.ceil(transcriptMinutes),
      timestamp,
      action: "increment",
    }
  );

  return usageRecord.id;
}

// ─── Webhook Handler ─────────────────────────────────────────────────────────

/**
 * Maps a Stripe subscription status string to our SubscriptionStatus enum.
 */
function mapStripeStatus(
  status: Stripe.Subscription.Status
): "ACTIVE" | "PAST_DUE" | "CANCELED" | "UNPAID" | "INCOMPLETE" | "TRIALING" {
  const statusMap: Record<string, "ACTIVE" | "PAST_DUE" | "CANCELED" | "UNPAID" | "INCOMPLETE" | "TRIALING"> = {
    active: "ACTIVE",
    past_due: "PAST_DUE",
    canceled: "CANCELED",
    unpaid: "UNPAID",
    incomplete: "INCOMPLETE",
    incomplete_expired: "INCOMPLETE",
    trialing: "TRIALING",
    paused: "CANCELED",
  };
  return statusMap[status] ?? "ACTIVE";
}

/**
 * Stripe webhook handler for the full subscription lifecycle:
 *  - checkout.session.completed  → activate subscription
 *  - invoice.paid               → confirm payment, update subscription period
 *  - invoice.payment_failed     → mark subscription past due
 *  - customer.subscription.updated → sync plan/status changes
 *  - customer.subscription.deleted → cancel and revert to free trial
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

    try {
      switch (event.type) {
        // ── Checkout completed ──────────────────────────────────────────
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          const orgId = session.subscription
            ? (session.metadata?.organizationId ??
               (await resolveOrgFromSubscription(
                 stripe,
                 prisma,
                 session.subscription as string
               )))
            : session.metadata?.organizationId;

          if (!orgId || !session.subscription) break;

          // Retrieve full subscription to get price and period details
          const stripeSubscription = await stripe.subscriptions.retrieve(
            session.subscription as string
          );

          const priceId = stripeSubscription.items.data[0]?.price.id;
          const plan: Plan = priceId
            ? (getPlanByPriceId(priceId) ?? "STARTER")
            : "STARTER";

          // Upsert local subscription record
          await prisma.subscription.upsert({
            where: { stripeSubscriptionId: stripeSubscription.id },
            create: {
              organizationId: orgId,
              stripeSubscriptionId: stripeSubscription.id,
              stripePriceId: priceId ?? "",
              plan,
              status: mapStripeStatus(stripeSubscription.status),
              currentPeriodStart: new Date(
                stripeSubscription.current_period_start * 1000
              ),
              currentPeriodEnd: new Date(
                stripeSubscription.current_period_end * 1000
              ),
            },
            update: {
              stripePriceId: priceId ?? "",
              plan,
              status: mapStripeStatus(stripeSubscription.status),
              currentPeriodStart: new Date(
                stripeSubscription.current_period_start * 1000
              ),
              currentPeriodEnd: new Date(
                stripeSubscription.current_period_end * 1000
              ),
            },
          });

          // Upgrade organization plan
          await prisma.organization.update({
            where: { id: orgId },
            data: { plan, trialEndsAt: null },
          });

          console.log(
            `Checkout completed: org=${orgId} plan=${plan} subscription=${stripeSubscription.id}`
          );
          break;
        }

        // ── Invoice paid ────────────────────────────────────────────────
        case "invoice.paid": {
          const invoice = event.data.object as Stripe.Invoice;
          if (!invoice.subscription) break;

          const subscriptionId =
            typeof invoice.subscription === "string"
              ? invoice.subscription
              : invoice.subscription.id;

          const localSub = await prisma.subscription.findUnique({
            where: { stripeSubscriptionId: subscriptionId },
          });

          if (localSub) {
            // Refresh period dates from Stripe
            const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);

            await prisma.subscription.update({
              where: { stripeSubscriptionId: subscriptionId },
              data: {
                status: "ACTIVE",
                currentPeriodStart: new Date(
                  stripeSub.current_period_start * 1000
                ),
                currentPeriodEnd: new Date(
                  stripeSub.current_period_end * 1000
                ),
              },
            });

            // Ensure the org plan stays active
            await prisma.organization.update({
              where: { id: localSub.organizationId },
              data: { plan: localSub.plan },
            });
          }

          console.log(
            `Invoice paid: subscription=${subscriptionId} amount=${invoice.amount_paid}`
          );
          break;
        }

        // ── Invoice payment failed ──────────────────────────────────────
        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice;
          if (!invoice.subscription) break;

          const subscriptionId =
            typeof invoice.subscription === "string"
              ? invoice.subscription
              : invoice.subscription.id;

          const localSub = await prisma.subscription.findUnique({
            where: { stripeSubscriptionId: subscriptionId },
          });

          if (localSub) {
            await prisma.subscription.update({
              where: { stripeSubscriptionId: subscriptionId },
              data: { status: "PAST_DUE" },
            });
          }

          console.log(
            `Invoice payment failed: subscription=${subscriptionId} attempt=${invoice.attempt_count}`
          );
          break;
        }

        // ── Subscription updated ────────────────────────────────────────
        case "customer.subscription.updated": {
          const stripeSubscription = event.data
            .object as Stripe.Subscription;
          const orgId =
            stripeSubscription.metadata.organizationId ??
            (await resolveOrgFromCustomer(
              prisma,
              stripeSubscription.customer as string
            ));

          if (!orgId) break;

          const priceId = stripeSubscription.items.data[0]?.price.id;
          const plan: Plan = priceId
            ? (getPlanByPriceId(priceId) ?? "STARTER")
            : "STARTER";
          const status = mapStripeStatus(stripeSubscription.status);

          await prisma.subscription.upsert({
            where: { stripeSubscriptionId: stripeSubscription.id },
            create: {
              organizationId: orgId,
              stripeSubscriptionId: stripeSubscription.id,
              stripePriceId: priceId ?? "",
              plan,
              status,
              currentPeriodStart: new Date(
                stripeSubscription.current_period_start * 1000
              ),
              currentPeriodEnd: new Date(
                stripeSubscription.current_period_end * 1000
              ),
              cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
              canceledAt: stripeSubscription.canceled_at
                ? new Date(stripeSubscription.canceled_at * 1000)
                : null,
            },
            update: {
              stripePriceId: priceId ?? "",
              plan,
              status,
              currentPeriodStart: new Date(
                stripeSubscription.current_period_start * 1000
              ),
              currentPeriodEnd: new Date(
                stripeSubscription.current_period_end * 1000
              ),
              cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
              canceledAt: stripeSubscription.canceled_at
                ? new Date(stripeSubscription.canceled_at * 1000)
                : null,
            },
          });

          // Update org plan if subscription is active
          if (status === "ACTIVE") {
            await prisma.organization.update({
              where: { id: orgId },
              data: { plan },
            });
          }

          console.log(
            `Subscription updated: org=${orgId} plan=${plan} status=${status}`
          );
          break;
        }

        // ── Subscription deleted/canceled ───────────────────────────────
        case "customer.subscription.deleted": {
          const stripeSubscription = event.data
            .object as Stripe.Subscription;
          const orgId =
            stripeSubscription.metadata.organizationId ??
            (await resolveOrgFromCustomer(
              prisma,
              stripeSubscription.customer as string
            ));

          if (!orgId) break;

          await prisma.subscription.update({
            where: { stripeSubscriptionId: stripeSubscription.id },
            data: {
              status: "CANCELED",
              canceledAt: new Date(),
            },
          });

          // Check if the org has any other active subscriptions
          const otherActive = await prisma.subscription.findFirst({
            where: {
              organizationId: orgId,
              status: "ACTIVE",
              stripeSubscriptionId: { not: stripeSubscription.id },
            },
          });

          if (!otherActive) {
            await prisma.organization.update({
              where: { id: orgId },
              data: { plan: "FREE_TRIAL" },
            });
          }

          console.log(
            `Subscription deleted: org=${orgId} subscription=${stripeSubscription.id}`
          );
          break;
        }
      }
    } catch (err) {
      console.error(`Webhook handler error for ${event.type}:`, err);
      // Return 200 to prevent Stripe from retrying on application errors
    }

    res.json({ received: true });
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolves the organization ID from a Stripe subscription's metadata,
 * falling back to looking up the customer in our database.
 */
async function resolveOrgFromSubscription(
  stripe: Stripe,
  prisma: PrismaClient,
  subscriptionId: string
): Promise<string | null> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  if (sub.metadata.organizationId) return sub.metadata.organizationId;
  return resolveOrgFromCustomer(
    prisma,
    typeof sub.customer === "string" ? sub.customer : sub.customer.id
  );
}

/**
 * Resolves the organization ID from a Stripe customer ID.
 */
async function resolveOrgFromCustomer(
  prisma: PrismaClient,
  stripeCustomerId: string
): Promise<string | null> {
  const org = await prisma.organization.findUnique({
    where: { stripeCustomerId },
  });
  return org?.id ?? null;
}
