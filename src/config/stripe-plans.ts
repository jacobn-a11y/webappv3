/**
 * Stripe Subscription Plans Configuration
 *
 * Defines the three billing tiers for StoryEngine:
 *  - Starter:      Usage-based at $0.05 per transcript minute
 *  - Professional: Usage-based at $0.03 per transcript minute (volume discount)
 *  - Enterprise:   Custom pricing, requires sales contact
 *
 * Each plan maps to a Stripe Price ID set via environment variables.
 * All paid plans use metered (usage-based) billing reported daily.
 */

import type { Plan } from "@prisma/client";

export interface PlanConfig {
  plan: Plan;
  name: string;
  stripePriceEnvVar: string;
  pricePerMinute: number | null; // null = custom pricing
  description: string;
  metered: boolean;
  contactSales: boolean;
}

export const PLAN_CONFIGS: Record<Exclude<Plan, "FREE_TRIAL">, PlanConfig> = {
  STARTER: {
    plan: "STARTER",
    name: "Starter",
    stripePriceEnvVar: "STRIPE_STARTER_PRICE_ID",
    pricePerMinute: 0.05,
    description: "Usage-based billing at $0.05 per transcript minute",
    metered: true,
    contactSales: false,
  },
  PROFESSIONAL: {
    plan: "PROFESSIONAL",
    name: "Professional",
    stripePriceEnvVar: "STRIPE_PROFESSIONAL_PRICE_ID",
    pricePerMinute: 0.03,
    description: "Usage-based billing at $0.03 per transcript minute",
    metered: true,
    contactSales: false,
  },
  ENTERPRISE: {
    plan: "ENTERPRISE",
    name: "Enterprise",
    stripePriceEnvVar: "STRIPE_ENTERPRISE_PRICE_ID",
    pricePerMinute: null,
    description: "Custom pricing with dedicated support",
    metered: true,
    contactSales: true,
  },
};

/**
 * Resolves the Stripe Price ID for a given plan from environment variables.
 * Returns null if the env var is not set.
 */
export function getStripePriceId(plan: Exclude<Plan, "FREE_TRIAL">): string | null {
  const config = PLAN_CONFIGS[plan];
  return process.env[config.stripePriceEnvVar] ?? null;
}

/**
 * Looks up which plan a Stripe Price ID corresponds to.
 * Returns null if the price ID doesn't match any configured plan.
 */
export function getPlanByPriceId(priceId: string): Exclude<Plan, "FREE_TRIAL"> | null {
  for (const [plan, config] of Object.entries(PLAN_CONFIGS)) {
    const envPriceId = process.env[config.stripePriceEnvVar];
    if (envPriceId && envPriceId === priceId) {
      return plan as Exclude<Plan, "FREE_TRIAL">;
    }
  }
  return null;
}
