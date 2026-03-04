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

export interface RevOpsKpiData {
  window_days: number;
  pipeline_influence: {
    influenced_accounts: number;
    accounts_with_pipeline_events: number;
    influence_rate_percent: number;
  };
  conversion_by_stage: { stage_name: string | null; count: number }[];
  win_loss: {
    closed_won: number;
    closed_lost: number;
    win_rate_percent: number;
  };
  persona_objections: {
    transcript_level_objection_mentions: number;
    top_objection_topics: { topic: string; count: number }[];
  };
  competitor_mentions: {
    transcript_level_competitor_mentions: number;
  };
  attribution_links: {
    linked_calls: number;
    linked_stories: number;
    linked_opportunity_events: number;
    linked_campaigns: number;
    note: string;
  };
  executive_summary: string[];
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

  // ── RevOps KPIs (90-day window) ────────────────────────────────────

  async getRevOpsKpis(organizationId: string): Promise<RevOpsKpiData> {
    const windowStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const [
      accountsWithCalls,
      accountsWithOppEvents,
      stageEvents,
      closedWon,
      closedLost,
      recentCalls,
      objectionTags,
      stories90d,
    ] = await Promise.all([
      this.prisma.call.groupBy({
        by: ["accountId"],
        where: { organizationId, accountId: { not: null }, occurredAt: { gte: windowStart } },
        _count: { _all: true },
      }),
      this.prisma.salesforceEvent.groupBy({
        by: ["accountId"],
        where: {
          account: { organizationId },
          createdAt: { gte: windowStart },
          eventType: {
            in: ["OPPORTUNITY_CREATED", "OPPORTUNITY_STAGE_CHANGE", "CLOSED_WON", "CLOSED_LOST"],
          },
        },
        _count: { _all: true },
      }),
      this.prisma.salesforceEvent.groupBy({
        by: ["stageName"],
        where: {
          account: { organizationId },
          createdAt: { gte: windowStart },
          stageName: { not: null },
        },
        _count: { _all: true },
      }),
      this.prisma.salesforceEvent.count({
        where: {
          account: { organizationId },
          createdAt: { gte: windowStart },
          eventType: "CLOSED_WON",
        },
      }),
      this.prisma.salesforceEvent.count({
        where: {
          account: { organizationId },
          createdAt: { gte: windowStart },
          eventType: "CLOSED_LOST",
        },
      }),
      this.prisma.call.findMany({
        where: { organizationId, occurredAt: { gte: windowStart } },
        select: { id: true, transcript: { select: { fullText: true } } },
        take: 500,
      }),
      this.prisma.callTag.groupBy({
        by: ["topic"],
        where: {
          call: { organizationId, occurredAt: { gte: windowStart } },
          funnelStage: { in: ["MOFU", "BOFU", "INTERNAL"] },
        },
        _count: { _all: true },
        orderBy: { _count: { topic: "desc" } },
        take: 10,
      }),
      this.prisma.story.findMany({
        where: { organizationId, generatedAt: { gte: windowStart } },
        select: { id: true, accountId: true, title: true, markdownBody: true, generatedAt: true },
        take: 500,
      }),
    ]);

    const callsByAccount = new Set(accountsWithCalls.map((r) => r.accountId).filter(Boolean));
    const oppByAccount = new Set(accountsWithOppEvents.map((r) => r.accountId));
    const influencedAccounts = Array.from(callsByAccount).filter((id) =>
      oppByAccount.has(id as string)
    ).length;
    const pipelineInfluenceRate =
      oppByAccount.size === 0 ? 0 : Number(((influencedAccounts / oppByAccount.size) * 100).toFixed(2));

    const competitorRegex = /\b(competitor|alternative|displace|replacement|vs\.?|versus)\b/i;
    const objectionRegex = /\b(objection|concern|risk|blocked|pushback)\b/i;
    let competitorMentions = 0;
    let objectionMentions = 0;
    for (const c of recentCalls) {
      const text = c.transcript?.fullText ?? "";
      if (competitorRegex.test(text)) competitorMentions += 1;
      if (objectionRegex.test(text)) objectionMentions += 1;
    }

    const attributionLinkedStories = stories90d.filter((s) => s.accountId !== null).length;
    const attributionLinkedCalls = accountsWithCalls.reduce((acc, r) => acc + r._count._all, 0);
    const attributionLinkedOppEvents = accountsWithOppEvents.reduce(
      (acc, r) => acc + r._count._all,
      0
    );

    const winRate =
      closedWon + closedLost === 0
        ? 0
        : Number(((closedWon / (closedWon + closedLost)) * 100).toFixed(2));

    return {
      window_days: 90,
      pipeline_influence: {
        influenced_accounts: influencedAccounts,
        accounts_with_pipeline_events: oppByAccount.size,
        influence_rate_percent: pipelineInfluenceRate,
      },
      conversion_by_stage: stageEvents.map((s) => ({
        stage_name: s.stageName,
        count: s._count._all,
      })),
      win_loss: {
        closed_won: closedWon,
        closed_lost: closedLost,
        win_rate_percent: winRate,
      },
      persona_objections: {
        transcript_level_objection_mentions: objectionMentions,
        top_objection_topics: objectionTags.map((o) => ({
          topic: o.topic,
          count: o._count._all,
        })),
      },
      competitor_mentions: {
        transcript_level_competitor_mentions: competitorMentions,
      },
      attribution_links: {
        linked_calls: attributionLinkedCalls,
        linked_stories: attributionLinkedStories,
        linked_opportunity_events: attributionLinkedOppEvents,
        linked_campaigns: 0,
        note: "Campaign attribution requires campaign object integration; currently not available in this schema.",
      },
      executive_summary: [
        `Pipeline influence rate is ${pipelineInfluenceRate}% across ${oppByAccount.size} active pipeline accounts.`,
        `Win rate is ${winRate}% from ${closedWon + closedLost} closed opportunities in the last 90 days.`,
        `Detected ${competitorMentions} competitor-mention calls and ${objectionMentions} objection-mention calls.`,
      ],
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
