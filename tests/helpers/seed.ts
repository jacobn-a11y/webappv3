/**
 * Test Seed Data
 *
 * Realistic B2B account with 5 calls, transcripts, and tagged chunks
 * representing a full customer journey through the sales funnel.
 */

// ─── Organization fixtures ──────────────────────────────────────────────────

export const ACTIVE_ORG = {
  id: "org-test-active",
  name: "TechCorp Inc",
  workosOrgId: "wos_org_active",
  stripeCustomerId: null,
  plan: "FREE_TRIAL" as const,
  trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

export const EXPIRED_ORG = {
  id: "org-test-expired",
  name: "ExpiredCorp",
  workosOrgId: "wos_org_expired",
  stripeCustomerId: null,
  plan: "FREE_TRIAL" as const,
  trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

export const PAID_ORG = {
  id: "org-test-paid",
  name: "PaidCorp",
  workosOrgId: "wos_org_paid",
  stripeCustomerId: "cus_stripe_001",
  plan: "STARTER" as const,
  trialEndsAt: null,
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

// ─── Account fixture ────────────────────────────────────────────────────────

export const TEST_ACCOUNT = {
  id: "acct-test-001",
  organizationId: ACTIVE_ORG.id,
  name: "Acme Solutions",
  normalizedName: "acme solutions",
  domain: "acmesolutions.com",
  industry: "Enterprise Software",
  employeeCount: 500,
  annualRevenue: 50_000_000,
};

// ─── Call fixtures (5 calls across the funnel) ──────────────────────────────

export const TEST_CALLS = [
  {
    id: "call-001",
    organizationId: ACTIVE_ORG.id,
    accountId: TEST_ACCOUNT.id,
    title: "Discovery Call — Pain Points & Market Landscape",
    provider: "GONG",
    occurredAt: new Date("2024-01-15T14:00:00Z"),
    duration: 2700,
  },
  {
    id: "call-002",
    organizationId: ACTIVE_ORG.id,
    accountId: TEST_ACCOUNT.id,
    title: "Technical Deep Dive — Integration Architecture",
    provider: "GONG",
    occurredAt: new Date("2024-02-01T10:00:00Z"),
    duration: 3600,
  },
  {
    id: "call-003",
    organizationId: ACTIVE_ORG.id,
    accountId: TEST_ACCOUNT.id,
    title: "POC Review — Pilot Results & Next Steps",
    provider: "ZOOM",
    occurredAt: new Date("2024-03-10T15:00:00Z"),
    duration: 1800,
  },
  {
    id: "call-004",
    organizationId: ACTIVE_ORG.id,
    accountId: TEST_ACCOUNT.id,
    title: "Business Review — ROI Analysis & Executive Alignment",
    provider: "GONG",
    occurredAt: new Date("2024-04-20T11:00:00Z"),
    duration: 2400,
  },
  {
    id: "call-005",
    organizationId: ACTIVE_ORG.id,
    accountId: TEST_ACCOUNT.id,
    title: "Post-Sale Check-in — Expansion & Renewal Planning",
    provider: "ZOOM",
    occurredAt: new Date("2024-06-01T09:00:00Z"),
    duration: 1500,
  },
] as const;

// ─── Transcript chunks with tags (2 chunks per call) ───────────────────────

export const TEST_CHUNKS = [
  // Call 1 — Discovery (TOFU)
  {
    id: "chunk-001a",
    callId: "call-001",
    chunkIndex: 0,
    text: "We've been struggling with fragmented call data across three different tools. Our reps spend about 30% of their time just reconciling notes between Gong, Salesforce, and our internal wiki.",
    speaker: "Sarah Chen, VP of Sales",
    tags: [
      { funnelStage: "TOFU", topic: "problem_challenge_identification", confidence: 0.94 },
    ],
  },
  {
    id: "chunk-001b",
    callId: "call-001",
    chunkIndex: 1,
    text: "The bigger issue is that our customer success stories are locked inside individual recordings. We have no way to surface the narrative arc across multiple touchpoints for the same account.",
    speaker: "Sarah Chen, VP of Sales",
    tags: [
      { funnelStage: "TOFU", topic: "problem_challenge_identification", confidence: 0.91 },
    ],
  },
  // Call 2 — Technical Deep Dive (MOFU)
  {
    id: "chunk-002a",
    callId: "call-002",
    chunkIndex: 0,
    text: "Our API can integrate directly with your Gong and Chorus instances via Merge.dev unified API. The onboarding typically takes about 2 weeks from API key to first transcript ingestion.",
    speaker: "Mike Rodriguez, Solutions Engineer",
    tags: [
      { funnelStage: "MOFU", topic: "integration_interoperability", confidence: 0.96 },
      { funnelStage: "MOFU", topic: "implementation_onboarding", confidence: 0.88 },
    ],
  },
  {
    id: "chunk-002b",
    callId: "call-002",
    chunkIndex: 1,
    text: "The entity resolution engine uses email domain matching as a primary signal and fuzzy name matching as a fallback. In our benchmarks, we achieve 95% automatic account matching accuracy.",
    speaker: "Mike Rodriguez, Solutions Engineer",
    tags: [
      { funnelStage: "MOFU", topic: "product_capability_deepdive", confidence: 0.92 },
    ],
  },
  // Call 3 — POC Review (MOFU)
  {
    id: "chunk-003a",
    callId: "call-003",
    chunkIndex: 0,
    text: "During the pilot, we processed 150 calls across 12 accounts in just under 3 days. The AI tagger correctly categorized 89% of transcript chunks on the first pass.",
    speaker: "Mike Rodriguez, Solutions Engineer",
    tags: [
      { funnelStage: "MOFU", topic: "pilot_to_production", confidence: 0.95 },
    ],
  },
  {
    id: "chunk-003b",
    callId: "call-003",
    chunkIndex: 1,
    text: "What really impressed us was the story builder output. It synthesized six months of calls into a coherent narrative that our marketing team could actually use for a case study draft.",
    speaker: "Sarah Chen, VP of Sales",
    tags: [
      { funnelStage: "MOFU", topic: "product_capability_deepdive", confidence: 0.90 },
    ],
  },
  // Call 4 — Business Review / ROI (BOFU)
  {
    id: "chunk-004a",
    callId: "call-004",
    chunkIndex: 0,
    text: "Based on our analysis, StoryEngine reduced our case study production time from 6 weeks to 3 days — a 93% reduction. That translates to roughly $240,000 in annual content production savings.",
    speaker: "Sarah Chen, VP of Sales",
    tags: [
      { funnelStage: "BOFU", topic: "roi_financial_outcomes", confidence: 0.98 },
      { funnelStage: "BOFU", topic: "quantified_operational_metrics", confidence: 0.95 },
    ],
  },
  {
    id: "chunk-004b",
    callId: "call-004",
    chunkIndex: 1,
    text: "The executive team sees this as strategic. We're now able to produce customer evidence at the speed of our sales cycle, which has directly contributed to a 15% improvement in close rates.",
    speaker: "David Park, CRO",
    tags: [
      { funnelStage: "BOFU", topic: "executive_strategic_impact", confidence: 0.93 },
      { funnelStage: "BOFU", topic: "roi_financial_outcomes", confidence: 0.89 },
    ],
  },
  // Call 5 — Post-Sale (POST_SALE)
  {
    id: "chunk-005a",
    callId: "call-005",
    chunkIndex: 0,
    text: "We're planning to roll this out to our EMEA and APAC teams next quarter. The localization of the AI tagger for non-English transcripts is the main thing we need to validate.",
    speaker: "Sarah Chen, VP of Sales",
    tags: [
      { funnelStage: "POST_SALE", topic: "scaling_across_org", confidence: 0.92 },
      { funnelStage: "POST_SALE", topic: "upsell_cross_sell_expansion", confidence: 0.87 },
    ],
  },
  {
    id: "chunk-005b",
    callId: "call-005",
    chunkIndex: 1,
    text: "For the renewal, we'd like to move to the Professional tier. The landing page feature has been a game-changer for our field marketing team — they published 8 customer pages in the first month.",
    speaker: "Sarah Chen, VP of Sales",
    tags: [
      { funnelStage: "POST_SALE", topic: "renewal_partnership_evolution", confidence: 0.94 },
    ],
  },
] as const;

// ─── Pre-built mock responses ───────────────────────────────────────────────

/** Realistic RAG engine response with source citations */
export function buildMockRAGResponse() {
  return {
    answer:
      'Based on the call transcripts, Acme Solutions experienced significant ROI after adopting StoryEngine. ' +
      "Their case study production time decreased from 6 weeks to 3 days — a **93% reduction** [Source 1]. " +
      "This translated to approximately **$240,000 in annual savings** on content production [Source 1]. " +
      "Additionally, the ability to produce customer evidence faster contributed to a **15% improvement in close rates** [Source 2]. " +
      'The executive team views the platform as strategically important for scaling their go-to-market motion [Source 2].',
    sources: [
      {
        chunkId: "chunk-004a",
        callId: "call-004",
        callTitle: "Business Review — ROI Analysis & Executive Alignment",
        callDate: "2024-04-20",
        text: TEST_CHUNKS[6].text,
        speaker: "Sarah Chen, VP of Sales",
        relevanceScore: 0.96,
      },
      {
        chunkId: "chunk-004b",
        callId: "call-004",
        callTitle: "Business Review — ROI Analysis & Executive Alignment",
        callDate: "2024-04-20",
        text: TEST_CHUNKS[7].text,
        speaker: "David Park, CRO",
        relevanceScore: 0.91,
      },
      {
        chunkId: "chunk-003a",
        callId: "call-003",
        callTitle: "POC Review — Pilot Results & Next Steps",
        callDate: "2024-03-10",
        text: TEST_CHUNKS[4].text,
        speaker: "Mike Rodriguez, Solutions Engineer",
        relevanceScore: 0.85,
      },
    ],
    tokensUsed: 1847,
  };
}

/** Realistic story builder response with Markdown and quotes */
export function buildMockStoryResponse() {
  return {
    title: "Acme Solutions: ROI & Financial Outcomes Story",
    markdownBody: `# Acme Solutions: From Fragmented Call Data to Strategic Customer Evidence

## Executive Summary

Acme Solutions, a 500-person enterprise software company, transformed their customer story production pipeline using StoryEngine. By consolidating call recordings from multiple providers and leveraging AI-powered story extraction, they reduced case study production time by 93% and unlocked $240,000 in annual content production savings.

## Timeline

| Date | Milestone |
|------|-----------|
| Jan 2024 | Discovery — identified fragmented call data problem |
| Feb 2024 | Technical deep dive — validated integration architecture |
| Mar 2024 | POC — processed 150 calls across 12 accounts in 3 days |
| Apr 2024 | Business review — quantified ROI at $240K annual savings |
| Jun 2024 | Post-sale — planning EMEA/APAC expansion |

## The Journey

### Phase 1: Identifying the Pain

Acme's sales team was spending approximately **30% of their time** reconciling notes between Gong, Salesforce, and their internal wiki. Customer success stories were locked inside individual recordings with no way to surface the narrative arc across multiple touchpoints.

### Phase 2: Evaluating the Solution

The technical evaluation confirmed that StoryEngine's Merge.dev integration could connect directly with Acme's existing Gong and Chorus instances. The entity resolution engine demonstrated **95% automatic account matching accuracy** in benchmarks.

### Phase 3: Proving Value

During a 3-day pilot, StoryEngine processed **150 calls across 12 accounts** with **89% first-pass tagging accuracy**. The story builder synthesized six months of calls into coherent narratives ready for marketing use.

### Phase 4: Quantifying Impact

The business review revealed transformative results:
- Case study production time: **6 weeks → 3 days (93% reduction)**
- Annual content production savings: **$240,000**
- Sales close rate improvement: **15%**

## Key Outcomes

- **93% reduction** in case study production time
- **$240,000** in annual content production savings
- **15% improvement** in sales close rates
- **8 customer landing pages** published in the first month

## Notable Quotes

> "StoryEngine reduced our case study production time from 6 weeks to 3 days — a 93% reduction." — Sarah Chen, VP of Sales

> "We're now able to produce customer evidence at the speed of our sales cycle." — David Park, CRO
`,
    quotes: [
      {
        speaker: "Sarah Chen, VP of Sales",
        quoteText:
          "StoryEngine reduced our case study production time from 6 weeks to 3 days — a 93% reduction. That translates to roughly $240,000 in annual content production savings.",
        context: "During Q1 business review discussing platform ROI",
        metricType: "cost_savings",
        metricValue: "$240,000",
        callId: "call-004",
      },
      {
        speaker: "David Park, CRO",
        quoteText:
          "We're now able to produce customer evidence at the speed of our sales cycle, which has directly contributed to a 15% improvement in close rates.",
        context: "Executive alignment discussion on strategic value",
        metricType: "efficiency",
        metricValue: "15%",
        callId: "call-004",
      },
    ],
  };
}
