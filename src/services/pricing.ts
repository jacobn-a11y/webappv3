/**
 * Pricing Service — Metered, Seat-Based, Self-Pay & B2B Billing
 *
 * Supports four pricing combinations:
 *   1. Metered + Self-Serve (PLG): pay-per-transcript-minute, customer self-checkout
 *   2. Metered + Sales-Led (B2B): negotiated per-minute rate, invoiced
 *   3. Per-Seat + Self-Serve (PLG): flat per-user monthly fee, self-checkout
 *   4. Per-Seat + Sales-Led (B2B): negotiated seat pricing, invoiced
 *   5. Metered+Seat hybrid: base seat fee + metered overages
 *
 * All commercialization logic is gated behind Organization.billingEnabled.
 * When billingEnabled is false (the default), the app runs without any billing
 * enforcement — no trial gates, no seat limits, no usage tracking.
 */

import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";
import { buildPublicAppUrl } from "../lib/public-app-url.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PricingConfig {
  /** Stripe price ID for metered (usage-based) billing */
  meteredPriceId?: string;
  /** Stripe price ID for per-seat billing */
  seatPriceId?: string;
  /** Default seat limit for new orgs on seat-based plans */
  defaultSeatLimit?: number;
  /** Free trial duration in days */
  trialDays: number;
  /** Included transcript minutes per billing period (metered plans) */
  includedMinutes?: number;
}

export interface SeatStatus {
  current: number;
  limit: number | null;
  available: number | null;
}

export interface UsageSummary {
  metric: string;
  total: number;
  periodStart: Date;
  periodEnd: Date;
  reportedToStripe: boolean;
}

export interface BillingOverview {
  billingEnabled: boolean;
  plan: string;
  pricingModel: string;
  billingChannel: string;
  trialEndsAt: Date | null;
  contractEndsAt: Date | null;
  seats: SeatStatus | null;
  currentPeriodUsage: UsageSummary[];
  activeSubscription: {
    id: string;
    status: string;
    billingInterval: string;
    currentPeriodEnd: Date | null;
  } | null;
}

// ─── Pricing Service ─────────────────────────────────────────────────────────

export class PricingService {
  constructor(
    private prisma: PrismaClient,
    private stripe: Stripe,
    private config: PricingConfig
  ) {}

  // ── Commercialization Gate ───────────────────────────────────────────

  /**
   * Returns true if billing enforcement is active for the org.
   * When false, all pricing/billing checks should be skipped.
   */
  async isBillingEnabled(organizationId: string): Promise<boolean> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { billingEnabled: true },
    });
    return org?.billingEnabled ?? false;
  }

  // ── Billing Overview ─────────────────────────────────────────────────

  /**
   * Returns a full billing summary for the org, used by the dashboard.
   */
  async getBillingOverview(organizationId: string): Promise<BillingOverview> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!org) throw new Error("Organization not found");

    const seats = await this.getSeatStatus(organizationId);

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const usageRecords = await this.prisma.usageRecord.groupBy({
      by: ["metric"],
      where: {
        organizationId,
        periodStart: { gte: periodStart },
        periodEnd: { lte: periodEnd },
      },
      _sum: { quantity: true },
    });

    const currentPeriodUsage: UsageSummary[] = usageRecords.map((r) => ({
      metric: r.metric,
      total: r._sum.quantity ?? 0,
      periodStart,
      periodEnd,
      reportedToStripe: false,
    }));

    const activeSubscription = await this.prisma.subscription.findFirst({
      where: { organizationId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    });

    return {
      billingEnabled: org.billingEnabled,
      plan: org.plan,
      pricingModel: org.pricingModel,
      billingChannel: org.billingChannel,
      trialEndsAt: org.trialEndsAt,
      contractEndsAt: org.contractEndsAt,
      seats:
        org.pricingModel === "METERED"
          ? null
          : seats,
      currentPeriodUsage,
      activeSubscription: activeSubscription
        ? {
            id: activeSubscription.id,
            status: activeSubscription.status,
            billingInterval: activeSubscription.billingInterval,
            currentPeriodEnd: activeSubscription.currentPeriodEnd,
          }
        : null,
    };
  }

  // ── Seat Management ──────────────────────────────────────────────────

  /**
   * Returns current seat usage vs. limit for the org.
   */
  async getSeatStatus(organizationId: string): Promise<SeatStatus> {
    const [org, userCount] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { seatLimit: true },
      }),
      this.prisma.user.count({ where: { organizationId } }),
    ]);

    const limit = org?.seatLimit ?? null;
    return {
      current: userCount,
      limit,
      available: limit !== null ? Math.max(0, limit - userCount) : null,
    };
  }

  /**
   * Checks whether a new seat can be added. Returns true if billing is
   * disabled (no enforcement) or if within seat limits.
   */
  async canAddSeat(organizationId: string): Promise<boolean> {
    const billingEnabled = await this.isBillingEnabled(organizationId);
    if (!billingEnabled) return true;

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { pricingModel: true, seatLimit: true },
    });

    // Metered-only plans have no seat limit
    if (org?.pricingModel === "METERED") return true;

    const status = await this.getSeatStatus(organizationId);
    if (status.limit === null) return true;
    return status.current < status.limit;
  }

  /**
   * For self-serve seat plans: adds seats via Stripe subscription update.
   * For sales-led: just updates the local seat limit (billing handled offline).
   */
  async updateSeatCount(
    organizationId: string,
    newSeatCount: number
  ): Promise<void> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new Error("Organization not found");

    if (org.billingChannel === "SELF_SERVE" && org.stripeCustomerId) {
      // Update Stripe subscription quantity
      const subscription = await this.prisma.subscription.findFirst({
        where: { organizationId, status: "ACTIVE" },
      });

      if (subscription?.stripeSubscriptionId) {
        const stripeSub = await this.stripe.subscriptions.retrieve(
          subscription.stripeSubscriptionId
        );
        const seatItem = stripeSub.items.data[0];
        if (seatItem) {
          await this.stripe.subscriptionItems.update(seatItem.id, {
            quantity: newSeatCount,
          });
        }
      }

      await this.prisma.subscription.updateMany({
        where: { organizationId, status: "ACTIVE" },
        data: { seatCount: newSeatCount },
      });
    }

    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { seatLimit: newSeatCount },
    });
  }

  // ── Usage Tracking ───────────────────────────────────────────────────

  /**
   * Records a usage event. When billing is disabled, still records for
   * future activation but does not report to Stripe.
   */
  async recordUsage(
    organizationId: string,
    metric: "TRANSCRIPT_MINUTES" | "STORIES_GENERATED" | "PAGES_PUBLISHED" | "CALLS_PROCESSED",
    quantity: number,
    _metadata?: Record<string, unknown>
  ): Promise<void> {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    await this.prisma.usageRecord.create({
      data: {
        organizationId,
        metric,
        quantity,
        periodStart,
        periodEnd,
      },
    });

    // Only report to Stripe if billing is enabled and it's a metered plan
    const billingEnabled = await this.isBillingEnabled(organizationId);
    if (!billingEnabled) return;

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { pricingModel: true, billingChannel: true, stripeCustomerId: true },
    });

    if (!org) return;

    const isMetered =
      org.pricingModel === "METERED" || org.pricingModel === "METERED_PLUS_SEAT";
    const isSelfServe = org.billingChannel === "SELF_SERVE";

    if (isMetered && isSelfServe && metric === "TRANSCRIPT_MINUTES") {
      await this.reportUsageToStripe(organizationId, quantity);
    }
  }

  /**
   * Reports metered usage to Stripe for the active subscription.
   */
  private async reportUsageToStripe(
    organizationId: string,
    quantity: number
  ): Promise<void> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { stripeCustomerId: true },
    });

    if (!org?.stripeCustomerId) return;

    const subscriptions = await this.stripe.subscriptions.list({
      customer: org.stripeCustomerId,
      status: "active",
      limit: 1,
    });

    const subscription = subscriptions.data[0];
    if (!subscription) return;

    const meteredItem = subscription.items.data.find(
      (item) => item.price.recurring?.usage_type === "metered"
    );
    if (!meteredItem) return;

    await this.stripe.subscriptionItems.createUsageRecord(meteredItem.id, {
      quantity: Math.ceil(quantity),
      action: "increment",
    });
  }

  // ── Checkout (Self-Serve) ────────────────────────────────────────────

  /**
   * Creates a Stripe Checkout session for self-serve plans.
   * Supports both metered and per-seat pricing.
   */
  async createCheckoutSession(
    organizationId: string,
    options?: { seatCount?: number }
  ): Promise<string | null> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new Error("Organization not found");

    // Create or retrieve Stripe customer
    let customerId = org.stripeCustomerId;
    if (!customerId) {
      const customer = await this.stripe.customers.create({
        metadata: { organizationId, organizationName: org.name },
      });
      customerId = customer.id;
      await this.prisma.organization.update({
        where: { id: organizationId },
        data: { stripeCustomerId: customerId },
      });
    }

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

    // Build line items based on pricing model
    if (
      org.pricingModel === "METERED" ||
      org.pricingModel === "METERED_PLUS_SEAT"
    ) {
      if (this.config.meteredPriceId) {
        lineItems.push({ price: this.config.meteredPriceId });
      }
    }

    if (
      org.pricingModel === "PER_SEAT" ||
      org.pricingModel === "METERED_PLUS_SEAT"
    ) {
      if (this.config.seatPriceId) {
        const seatCount =
          options?.seatCount ??
          this.config.defaultSeatLimit ??
          (await this.prisma.user.count({ where: { organizationId } }));
        lineItems.push({
          price: this.config.seatPriceId,
          quantity: seatCount,
        });
      }
    }

    if (lineItems.length === 0) {
      return null; // no prices configured
    }

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: lineItems,
      success_url: buildPublicAppUrl("/admin/billing?success=true"),
      cancel_url: buildPublicAppUrl("/admin/billing?canceled=true"),
      subscription_data: {
        metadata: { organizationId },
        trial_period_days:
          org.plan === "FREE_TRIAL" ? undefined : undefined,
      },
    });

    return session.url;
  }

  // ── B2B / Sales-Led Subscription ─────────────────────────────────────

  /**
   * Creates a subscription record for a sales-led (B2B) deal.
   * No Stripe checkout — billing is handled via invoicing/contracts.
   */
  async createSalesLedSubscription(
    organizationId: string,
    params: {
      plan: "STARTER" | "PROFESSIONAL" | "ENTERPRISE";
      pricingModel: "METERED" | "PER_SEAT" | "METERED_PLUS_SEAT";
      billingInterval: "MONTHLY" | "QUARTERLY" | "ANNUAL";
      seatCount?: number;
      seatUnitPrice?: number;
      meteredUnitPrice?: number;
      includedUnits?: number;
      contractValue?: number;
      contractEndDate?: Date;
    }
  ): Promise<string> {
    const now = new Date();
    let periodEnd: Date;
    switch (params.billingInterval) {
      case "ANNUAL":
        periodEnd = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
        break;
      case "QUARTERLY":
        periodEnd = new Date(now.getFullYear(), now.getMonth() + 3, now.getDate());
        break;
      default:
        periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
    }

    const subscription = await this.prisma.subscription.create({
      data: {
        organizationId,
        pricingModel: params.pricingModel,
        billingChannel: "SALES_LED",
        status: "ACTIVE",
        seatCount: params.seatCount,
        seatUnitPrice: params.seatUnitPrice,
        meteredUnitPrice: params.meteredUnitPrice,
        includedUnits: params.includedUnits,
        contractValue: params.contractValue,
        billingInterval: params.billingInterval,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      },
    });

    await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        plan: params.plan,
        pricingModel: params.pricingModel,
        billingChannel: "SALES_LED",
        billingEnabled: true,
        seatLimit: params.seatCount,
        contractEndsAt: params.contractEndDate,
        trialEndsAt: null,
      },
    });

    return subscription.id;
  }

  // ── Stripe Webhook Processing ────────────────────────────────────────

  /**
   * Handles Stripe subscription lifecycle events, updating local records.
   */
  async handleSubscriptionEvent(
    event: Stripe.Event
  ): Promise<void> {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orgId = session.metadata?.organizationId;
        if (!orgId) return;

        const org = await this.prisma.organization.findUnique({
          where: { id: orgId },
        });
        if (!org) return;

        const targetPlan = org.pricingModel === "METERED" ? "STARTER" : "STARTER";

        // Retrieve the Stripe subscription for details
        const stripeSubId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;

        let seatCount: number | undefined;
        if (stripeSubId) {
          const stripeSub =
            await this.stripe.subscriptions.retrieve(stripeSubId);
          const seatItem = stripeSub.items.data.find(
            (item) => item.price.recurring?.usage_type !== "metered"
          );
          seatCount = seatItem?.quantity ?? undefined;
        }

        await this.prisma.organization.update({
          where: { id: orgId },
          data: {
            plan: targetPlan,
            billingEnabled: true,
            trialEndsAt: null,
            seatLimit: seatCount,
          },
        });

        // Create local subscription record
        await this.prisma.subscription.create({
          data: {
            organizationId: orgId,
            stripeSubscriptionId: stripeSubId ?? undefined,
            pricingModel: org.pricingModel,
            billingChannel: "SELF_SERVE",
            status: "ACTIVE",
            seatCount,
            currentPeriodStart: new Date(),
          },
        });
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const orgId = subscription.metadata.organizationId;
        if (!orgId) return;

        const status =
          subscription.status === "active"
            ? "ACTIVE"
            : subscription.status === "past_due"
              ? "PAST_DUE"
              : "CANCELED";

        await this.prisma.subscription.updateMany({
          where: {
            stripeSubscriptionId: subscription.id,
          },
          data: {
            status,
            currentPeriodStart: new Date(
              subscription.current_period_start * 1000
            ),
            currentPeriodEnd: new Date(
              subscription.current_period_end * 1000
            ),
          },
        });

        if (subscription.status === "active") {
          await this.prisma.organization.update({
            where: { id: orgId },
            data: { plan: "STARTER" },
          });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const orgId = subscription.metadata.organizationId;
        if (!orgId) return;

        await this.prisma.subscription.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data: { status: "CANCELED", canceledAt: new Date() },
        });

        await this.prisma.organization.update({
          where: { id: orgId },
          data: { plan: "FREE_TRIAL" },
        });
        break;
      }
    }
  }
}
