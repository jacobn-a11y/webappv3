/**
 * Analytics Service
 *
 * Provides org-wide metrics for the Analytics Dashboard:
 *   - Calls per week (last 12 weeks)
 *   - Funnel stage distribution
 *   - Top 10 accounts by call volume
 *   - Entity resolution success rate over time
 *   - Most common taxonomy topics
 *   - High-value quote leaderboard (accounts by quantified-value quotes)
 *   - Landing page performance (views over time, top pages by views)
 */

import type { PrismaClient } from "@prisma/client";

// ─── Response Types ────────────────────────────────────────────────────────

export interface CallsPerWeek {
  weekStart: string; // ISO date string (Monday)
  count: number;
}

export interface FunnelDistribution {
  stage: string;
  count: number;
}

export interface TopAccount {
  accountId: string;
  accountName: string;
  callCount: number;
}

export interface EntityResolutionRate {
  weekStart: string;
  totalCalls: number;
  resolvedCalls: number;
  rate: number; // 0.0–1.0
}

export interface TopicCount {
  topic: string;
  label: string;
  funnelStage: string;
  count: number;
}

export interface QuoteLeaderboardEntry {
  accountId: string;
  accountName: string;
  quoteCount: number;
}

export interface PagePerformance {
  pageId: string;
  title: string;
  slug: string;
  viewCount: number;
  publishedAt: string | null;
}

export interface ViewsOverTime {
  weekStart: string;
  totalViews: number;
  pagesPublished: number;
}

export interface AnalyticsDashboardData {
  callsPerWeek: CallsPerWeek[];
  funnelDistribution: FunnelDistribution[];
  topAccounts: TopAccount[];
  entityResolutionOverTime: EntityResolutionRate[];
  topTopics: TopicCount[];
  quoteLeaderboard: QuoteLeaderboardEntry[];
  topPagesByViews: PagePerformance[];
  viewsOverTime: ViewsOverTime[];
  summary: {
    totalCalls: number;
    totalAccounts: number;
    totalTranscriptHours: number;
    overallResolutionRate: number;
    totalQuotes: number;
    totalPageViews: number;
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Returns the Monday of the given date's week as an ISO date string. */
function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday = 1
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().split("T")[0];
}

/** Generates an array of week-start dates for the last N weeks. */
function getLastNWeeks(n: number): string[] {
  const weeks: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i * 7);
    weeks.push(getWeekStart(d));
  }
  // Deduplicate (in case rounding produces duplicate weeks)
  return [...new Set(weeks)];
}

// ─── Topic labels (inline to avoid circular deps) ─────────────────────────

const TOPIC_LABELS: Record<string, string> = {
  industry_trend_validation: "Industry Trend Validation",
  problem_challenge_identification: "Problem/Challenge Identification",
  digital_transformation_modernization: "Digital Transformation",
  regulatory_compliance_challenges: "Regulatory & Compliance",
  market_expansion: "Market Expansion",
  thought_leadership_cocreation: "Thought Leadership Co-creation",
  product_capability_deepdive: "Product Capability Deep-dive",
  competitive_displacement: "Competitive Displacement",
  integration_interoperability: "Integration & Interoperability",
  implementation_onboarding: "Implementation & Onboarding",
  security_compliance_governance: "Security & Data Governance",
  customization_configurability: "Customization & Configurability",
  multi_product_cross_sell: "Multi-product / Cross-sell",
  partner_ecosystem_solution: "Partner / Ecosystem Solutions",
  total_cost_of_ownership: "Total Cost of Ownership",
  pilot_to_production: "Pilot to Production",
  roi_financial_outcomes: "ROI & Financial Outcomes",
  quantified_operational_metrics: "Quantified Operational Metrics",
  executive_strategic_impact: "Executive Strategic Impact",
  risk_mitigation_continuity: "Risk Mitigation & Continuity",
  deployment_speed: "Deployment Speed",
  vendor_selection_criteria: "Vendor Selection Criteria",
  procurement_experience: "Procurement Experience",
  renewal_partnership_evolution: "Renewal & Partnership Evolution",
  upsell_cross_sell_expansion: "Upsell / Cross-sell Expansion",
  customer_success_support: "Customer Success & Support",
  training_enablement_adoption: "Training & Enablement",
  community_advisory_participation: "Community & Advisory Board",
  co_innovation_product_feedback: "Co-innovation & Product Feedback",
  change_management_champion_dev: "Change Management & Champions",
  scaling_across_org: "Scaling Across the Organization",
  platform_governance_coe: "Platform Governance & CoE",
  sales_enablement: "Sales Enablement",
  lessons_learned_implementation: "Lessons Learned",
  cross_functional_collaboration: "Cross-functional Collaboration",
  voice_of_customer_product: "Voice of Customer",
  pricing_packaging_validation: "Pricing & Packaging Validation",
  churn_save_winback: "Churn Saves & Win-backs",
  deal_anatomy: "Deal Anatomy",
  customer_health_sentiment: "Customer Health & Sentiment",
  reference_ability_development: "Reference-ability Development",
  internal_process_improvement: "Internal Process Improvements",
  industry_specific_usecase: "Industry-specific Use Case",
  company_size_segment: "Company Size / Segment",
  persona_specific_framing: "Persona-specific Framing",
  geographic_regional_variation: "Geographic / Regional",
  regulated_vs_unregulated: "Regulated vs. Unregulated",
  public_sector_government: "Public Sector & Government",
};

const FUNNEL_STAGE_LABELS: Record<string, string> = {
  TOFU: "Top of Funnel",
  MOFU: "Mid-Funnel",
  BOFU: "Bottom of Funnel",
  POST_SALE: "Post-Sale",
  INTERNAL: "Internal",
  VERTICAL: "Vertical",
};

// ─── Service ───────────────────────────────────────────────────────────────

export class AnalyticsService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async getDashboardData(organizationId: string): Promise<AnalyticsDashboardData> {
    const weeks12Ago = new Date();
    weeks12Ago.setUTCDate(weeks12Ago.getUTCDate() - 84); // 12 weeks

    const [
      callsPerWeek,
      funnelDistribution,
      topAccounts,
      entityResolutionOverTime,
      topTopics,
      quoteLeaderboard,
      topPagesByViews,
      viewsOverTime,
      summary,
    ] = await Promise.all([
      this.getCallsPerWeek(organizationId, weeks12Ago),
      this.getFunnelDistribution(organizationId),
      this.getTopAccounts(organizationId),
      this.getEntityResolutionOverTime(organizationId, weeks12Ago),
      this.getTopTopics(organizationId),
      this.getQuoteLeaderboard(organizationId),
      this.getTopPagesByViews(organizationId),
      this.getViewsOverTime(organizationId),
      this.getSummary(organizationId),
    ]);

    return {
      callsPerWeek,
      funnelDistribution,
      topAccounts,
      entityResolutionOverTime,
      topTopics,
      quoteLeaderboard,
      topPagesByViews,
      viewsOverTime,
      summary,
    };
  }

  // ── Calls Per Week ──────────────────────────────────────────────────

  private async getCallsPerWeek(
    organizationId: string,
    since: Date
  ): Promise<CallsPerWeek[]> {
    const calls = await this.prisma.call.findMany({
      where: { organizationId, occurredAt: { gte: since } },
      select: { occurredAt: true },
    });

    const weekMap = new Map<string, number>();
    for (const week of getLastNWeeks(12)) {
      weekMap.set(week, 0);
    }
    for (const call of calls) {
      const week = getWeekStart(call.occurredAt);
      weekMap.set(week, (weekMap.get(week) ?? 0) + 1);
    }

    return Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, count]) => ({ weekStart, count }));
  }

  // ── Funnel Stage Distribution ───────────────────────────────────────

  private async getFunnelDistribution(
    organizationId: string
  ): Promise<FunnelDistribution[]> {
    const tags = await this.prisma.callTag.groupBy({
      by: ["funnelStage"],
      where: { call: { organizationId } },
      _count: true,
    });

    return tags.map((t) => ({
      stage: FUNNEL_STAGE_LABELS[t.funnelStage] ?? t.funnelStage,
      count: t._count,
    }));
  }

  // ── Top 10 Accounts by Call Volume ──────────────────────────────────

  private async getTopAccounts(
    organizationId: string
  ): Promise<TopAccount[]> {
    const grouped = await this.prisma.call.groupBy({
      by: ["accountId"],
      where: { organizationId, accountId: { not: null } },
      _count: true,
      orderBy: { _count: { accountId: "desc" } },
      take: 10,
    });

    const accountIds = grouped
      .map((g) => g.accountId)
      .filter((id): id is string => id !== null);

    const accounts = await this.prisma.account.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, name: true },
    });
    const nameMap = new Map(accounts.map((a) => [a.id, a.name]));

    return grouped
      .filter((g) => g.accountId !== null)
      .map((g) => ({
        accountId: g.accountId!,
        accountName: nameMap.get(g.accountId!) ?? "Unknown",
        callCount: g._count,
      }));
  }

  // ── Entity Resolution Success Rate Over Time ────────────────────────

  private async getEntityResolutionOverTime(
    organizationId: string,
    since: Date
  ): Promise<EntityResolutionRate[]> {
    const calls = await this.prisma.call.findMany({
      where: { organizationId, occurredAt: { gte: since } },
      select: { occurredAt: true, accountId: true },
    });

    const weekMap = new Map<string, { total: number; resolved: number }>();
    for (const week of getLastNWeeks(12)) {
      weekMap.set(week, { total: 0, resolved: 0 });
    }
    for (const call of calls) {
      const week = getWeekStart(call.occurredAt);
      const entry = weekMap.get(week) ?? { total: 0, resolved: 0 };
      entry.total++;
      if (call.accountId) entry.resolved++;
      weekMap.set(week, entry);
    }

    return Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, { total, resolved }]) => ({
        weekStart,
        totalCalls: total,
        resolvedCalls: resolved,
        rate: total > 0 ? Math.round((resolved / total) * 1000) / 1000 : 0,
      }));
  }

  // ── Most Common Taxonomy Topics ─────────────────────────────────────

  private async getTopTopics(
    organizationId: string
  ): Promise<TopicCount[]> {
    const tags = await this.prisma.callTag.groupBy({
      by: ["topic", "funnelStage"],
      where: { call: { organizationId } },
      _count: true,
      orderBy: { _count: { topic: "desc" } },
      take: 25,
    });

    return tags.map((t) => ({
      topic: t.topic,
      label: TOPIC_LABELS[t.topic] ?? t.topic,
      funnelStage: t.funnelStage,
      count: t._count,
    }));
  }

  // ── High-Value Quote Leaderboard ────────────────────────────────────

  private async getQuoteLeaderboard(
    organizationId: string
  ): Promise<QuoteLeaderboardEntry[]> {
    // Get quotes with metric values (quantified-value quotes)
    const quotes = await this.prisma.highValueQuote.findMany({
      where: {
        metricValue: { not: null },
        story: { organizationId },
      },
      select: {
        story: {
          select: {
            accountId: true,
            account: { select: { name: true } },
          },
        },
      },
    });

    // Count per account
    const countMap = new Map<string, { name: string; count: number }>();
    for (const q of quotes) {
      const accountId = q.story.accountId;
      const entry = countMap.get(accountId) ?? {
        name: q.story.account.name,
        count: 0,
      };
      entry.count++;
      countMap.set(accountId, entry);
    }

    return Array.from(countMap.entries())
      .map(([accountId, { name, count }]) => ({
        accountId,
        accountName: name,
        quoteCount: count,
      }))
      .sort((a, b) => b.quoteCount - a.quoteCount)
      .slice(0, 15);
  }

  // ── Landing Page Performance ────────────────────────────────────────

  private async getTopPagesByViews(
    organizationId: string
  ): Promise<PagePerformance[]> {
    const pages = await this.prisma.landingPage.findMany({
      where: { organizationId, status: "PUBLISHED" },
      select: {
        id: true,
        title: true,
        slug: true,
        viewCount: true,
        publishedAt: true,
      },
      orderBy: { viewCount: "desc" },
      take: 10,
    });

    return pages.map((p) => ({
      pageId: p.id,
      title: p.title,
      slug: p.slug,
      viewCount: p.viewCount,
      publishedAt: p.publishedAt?.toISOString() ?? null,
    }));
  }

  private async getViewsOverTime(
    organizationId: string
  ): Promise<ViewsOverTime[]> {
    const pages = await this.prisma.landingPage.findMany({
      where: { organizationId, publishedAt: { not: null } },
      select: { publishedAt: true, viewCount: true },
    });

    const weekMap = new Map<string, { views: number; published: number }>();
    for (const page of pages) {
      if (!page.publishedAt) continue;
      const week = getWeekStart(page.publishedAt);
      const entry = weekMap.get(week) ?? { views: 0, published: 0 };
      entry.views += page.viewCount;
      entry.published++;
      weekMap.set(week, entry);
    }

    return Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, { views, published }]) => ({
        weekStart,
        totalViews: views,
        pagesPublished: published,
      }));
  }

  // ── Summary Stats ───────────────────────────────────────────────────

  private async getSummary(organizationId: string): Promise<AnalyticsDashboardData["summary"]> {
    const [
      totalCalls,
      totalAccounts,
      durationAgg,
      resolvedCalls,
      totalQuotes,
      viewsAgg,
    ] = await Promise.all([
      this.prisma.call.count({ where: { organizationId } }),
      this.prisma.account.count({ where: { organizationId } }),
      this.prisma.call.aggregate({
        where: { organizationId },
        _sum: { duration: true },
      }),
      this.prisma.call.count({
        where: { organizationId, accountId: { not: null } },
      }),
      this.prisma.highValueQuote.count({
        where: { metricValue: { not: null }, story: { organizationId } },
      }),
      this.prisma.landingPage.aggregate({
        where: { organizationId },
        _sum: { viewCount: true },
      }),
    ]);

    const totalSeconds = durationAgg._sum.duration ?? 0;
    const totalTranscriptHours = Math.round((totalSeconds / 3600) * 10) / 10;

    return {
      totalCalls,
      totalAccounts,
      totalTranscriptHours,
      overallResolutionRate:
        totalCalls > 0
          ? Math.round((resolvedCalls / totalCalls) * 1000) / 1000
          : 0,
      totalQuotes,
      totalPageViews: viewsAgg._sum.viewCount ?? 0,
    };
  }
}
