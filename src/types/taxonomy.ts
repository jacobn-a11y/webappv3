/**
 * StoryEngine — B2B Case Study Taxonomy
 *
 * Comprehensive breakdown of B2B case study topics across the full sales funnel,
 * for both internal and external use. Each call/transcript chunk is tagged
 * with one or more of these topics by the AI Tagger.
 */

export enum FunnelStage {
  TOFU = "TOFU",
  MOFU = "MOFU",
  BOFU = "BOFU",
  POST_SALE = "POST_SALE",
  INTERNAL = "INTERNAL",
  VERTICAL = "VERTICAL",
}

// ─── Top of Funnel (Awareness & Education) ──────────────────────────────────

export const TOFU_TOPICS = [
  "industry_trend_validation",
  "problem_challenge_identification",
  "digital_transformation_modernization",
  "regulatory_compliance_challenges",
  "market_expansion",
  "thought_leadership_cocreation",
] as const;

// ─── Mid-Funnel (Consideration & Evaluation) ────────────────────────────────

export const MOFU_TOPICS = [
  "product_capability_deepdive",
  "competitive_displacement",
  "integration_interoperability",
  "implementation_onboarding",
  "security_compliance_governance",
  "customization_configurability",
  "multi_product_cross_sell",
  "partner_ecosystem_solution",
  "total_cost_of_ownership",
  "pilot_to_production",
] as const;

// ─── Bottom of Funnel (Decision & Purchase) ──────────────────────────────────

export const BOFU_TOPICS = [
  "roi_financial_outcomes",
  "quantified_operational_metrics",
  "executive_strategic_impact",
  "risk_mitigation_continuity",
  "deployment_speed",
  "vendor_selection_criteria",
  "procurement_experience",
] as const;

// ─── Post-Sale (Retention, Expansion & Advocacy) ────────────────────────────

export const POST_SALE_TOPICS = [
  "renewal_partnership_evolution",
  "upsell_cross_sell_expansion",
  "customer_success_support",
  "training_enablement_adoption",
  "community_advisory_participation",
  "co_innovation_product_feedback",
  "change_management_champion_dev",
  "scaling_across_org",
  "platform_governance_coe",
] as const;

// ─── Internal Audience–Specific Topics ──────────────────────────────────────

export const INTERNAL_TOPICS = [
  "sales_enablement",
  "lessons_learned_implementation",
  "cross_functional_collaboration",
  "voice_of_customer_product",
  "pricing_packaging_validation",
  "churn_save_winback",
  "deal_anatomy",
  "customer_health_sentiment",
  "reference_ability_development",
  "internal_process_improvement",
] as const;

// ─── Vertical / Segment Cuts ────────────────────────────────────────────────

export const VERTICAL_TOPICS = [
  "industry_specific_usecase",
  "company_size_segment",
  "persona_specific_framing",
  "geographic_regional_variation",
  "regulated_vs_unregulated",
  "public_sector_government",
] as const;

// ─── Valid Funnel Stages (for input validation) ────────────────────────────

export const VALID_FUNNEL_STAGES = [
  "TOFU",
  "MOFU",
  "BOFU",
  "POST_SALE",
  "INTERNAL",
  "VERTICAL",
] as const;

// ─── Combined Types ─────────────────────────────────────────────────────────

export type TofuTopic = (typeof TOFU_TOPICS)[number];
export type MofuTopic = (typeof MOFU_TOPICS)[number];
export type BofuTopic = (typeof BOFU_TOPICS)[number];
export type PostSaleTopic = (typeof POST_SALE_TOPICS)[number];
export type InternalTopic = (typeof INTERNAL_TOPICS)[number];
export type VerticalTopic = (typeof VERTICAL_TOPICS)[number];

export type TaxonomyTopic =
  | TofuTopic
  | MofuTopic
  | BofuTopic
  | PostSaleTopic
  | InternalTopic
  | VerticalTopic;

export const ALL_TOPICS: readonly TaxonomyTopic[] = [
  ...TOFU_TOPICS,
  ...MOFU_TOPICS,
  ...BOFU_TOPICS,
  ...POST_SALE_TOPICS,
  ...INTERNAL_TOPICS,
  ...VERTICAL_TOPICS,
];

export const STAGE_TOPICS: Record<FunnelStage, readonly TaxonomyTopic[]> = {
  [FunnelStage.TOFU]: TOFU_TOPICS,
  [FunnelStage.MOFU]: MOFU_TOPICS,
  [FunnelStage.BOFU]: BOFU_TOPICS,
  [FunnelStage.POST_SALE]: POST_SALE_TOPICS,
  [FunnelStage.INTERNAL]: INTERNAL_TOPICS,
  [FunnelStage.VERTICAL]: VERTICAL_TOPICS,
};

/**
 * Human-readable labels for each topic, used in the UI and generated stories.
 */
export const TOPIC_LABELS: Record<TaxonomyTopic, string> = {
  // ToFu
  industry_trend_validation: "Industry Trend Validation",
  problem_challenge_identification: "Problem/Challenge Identification",
  digital_transformation_modernization: "Digital Transformation",
  regulatory_compliance_challenges: "Regulatory & Compliance",
  market_expansion: "Market Expansion",
  thought_leadership_cocreation: "Thought Leadership Co-creation",
  // MoFu
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
  // BoFu
  roi_financial_outcomes: "ROI & Financial Outcomes",
  quantified_operational_metrics: "Quantified Operational Metrics",
  executive_strategic_impact: "Executive Strategic Impact",
  risk_mitigation_continuity: "Risk Mitigation & Continuity",
  deployment_speed: "Deployment Speed",
  vendor_selection_criteria: "Vendor Selection Criteria",
  procurement_experience: "Procurement Experience",
  // Post-Sale
  renewal_partnership_evolution: "Renewal & Partnership Evolution",
  upsell_cross_sell_expansion: "Upsell / Cross-sell Expansion",
  customer_success_support: "Customer Success & Support",
  training_enablement_adoption: "Training & Enablement",
  community_advisory_participation: "Community & Advisory Board",
  co_innovation_product_feedback: "Co-innovation & Product Feedback",
  change_management_champion_dev: "Change Management & Champions",
  scaling_across_org: "Scaling Across the Organization",
  platform_governance_coe: "Platform Governance & CoE",
  // Internal
  sales_enablement: "Sales Enablement",
  lessons_learned_implementation: "Lessons Learned",
  cross_functional_collaboration: "Cross-functional Collaboration",
  voice_of_customer_product: "Voice of Customer → Product",
  pricing_packaging_validation: "Pricing & Packaging Validation",
  churn_save_winback: "Churn Saves & Win-backs",
  deal_anatomy: "Deal Anatomy",
  customer_health_sentiment: "Customer Health & Sentiment",
  reference_ability_development: "Reference-ability Development",
  internal_process_improvement: "Internal Process Improvements",
  // Vertical
  industry_specific_usecase: "Industry-specific Use Case",
  company_size_segment: "Company Size / Segment",
  persona_specific_framing: "Persona-specific Framing",
  geographic_regional_variation: "Geographic / Regional",
  regulated_vs_unregulated: "Regulated vs. Unregulated",
  public_sector_government: "Public Sector & Government",
};

/**
 * Format & Angle variations — these are not taxonomy tags but inform
 * how the Story Builder should shape the output.
 */
export const STORY_FORMATS = [
  "before_after_transformation",
  "day_in_the_life",
  "by_the_numbers_snapshot",
  "video_testimonial_soundbite",
  "joint_webinar_presentation",
  "peer_reference_call_guide",
  "analyst_validated_study",
] as const;

export type StoryFormat = (typeof STORY_FORMATS)[number];
