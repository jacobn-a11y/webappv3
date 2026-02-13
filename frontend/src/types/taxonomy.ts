/**
 * Frontend mirror of the backend taxonomy types.
 * Kept in sync with src/types/taxonomy.ts on the server.
 */

export type FunnelStage =
  | "TOFU"
  | "MOFU"
  | "BOFU"
  | "POST_SALE"
  | "INTERNAL"
  | "VERTICAL";

export const FUNNEL_STAGE_LABELS: Record<FunnelStage, string> = {
  TOFU: "Top of Funnel",
  MOFU: "Mid-Funnel",
  BOFU: "Bottom of Funnel",
  POST_SALE: "Post-Sale",
  INTERNAL: "Internal",
  VERTICAL: "Vertical / Segment",
};

export const STAGE_TOPICS: Record<FunnelStage, readonly TaxonomyTopic[]> = {
  TOFU: [
    "industry_trend_validation",
    "problem_challenge_identification",
    "digital_transformation_modernization",
    "regulatory_compliance_challenges",
    "market_expansion",
    "thought_leadership_cocreation",
  ],
  MOFU: [
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
  ],
  BOFU: [
    "roi_financial_outcomes",
    "quantified_operational_metrics",
    "executive_strategic_impact",
    "risk_mitigation_continuity",
    "deployment_speed",
    "vendor_selection_criteria",
    "procurement_experience",
  ],
  POST_SALE: [
    "renewal_partnership_evolution",
    "upsell_cross_sell_expansion",
    "customer_success_support",
    "training_enablement_adoption",
    "community_advisory_participation",
    "co_innovation_product_feedback",
    "change_management_champion_dev",
    "scaling_across_org",
    "platform_governance_coe",
  ],
  INTERNAL: [
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
  ],
  VERTICAL: [
    "industry_specific_usecase",
    "company_size_segment",
    "persona_specific_framing",
    "geographic_regional_variation",
    "regulated_vs_unregulated",
    "public_sector_government",
  ],
};

export type TaxonomyTopic =
  // TOFU
  | "industry_trend_validation"
  | "problem_challenge_identification"
  | "digital_transformation_modernization"
  | "regulatory_compliance_challenges"
  | "market_expansion"
  | "thought_leadership_cocreation"
  // MOFU
  | "product_capability_deepdive"
  | "competitive_displacement"
  | "integration_interoperability"
  | "implementation_onboarding"
  | "security_compliance_governance"
  | "customization_configurability"
  | "multi_product_cross_sell"
  | "partner_ecosystem_solution"
  | "total_cost_of_ownership"
  | "pilot_to_production"
  // BOFU
  | "roi_financial_outcomes"
  | "quantified_operational_metrics"
  | "executive_strategic_impact"
  | "risk_mitigation_continuity"
  | "deployment_speed"
  | "vendor_selection_criteria"
  | "procurement_experience"
  // POST_SALE
  | "renewal_partnership_evolution"
  | "upsell_cross_sell_expansion"
  | "customer_success_support"
  | "training_enablement_adoption"
  | "community_advisory_participation"
  | "co_innovation_product_feedback"
  | "change_management_champion_dev"
  | "scaling_across_org"
  | "platform_governance_coe"
  // INTERNAL
  | "sales_enablement"
  | "lessons_learned_implementation"
  | "cross_functional_collaboration"
  | "voice_of_customer_product"
  | "pricing_packaging_validation"
  | "churn_save_winback"
  | "deal_anatomy"
  | "customer_health_sentiment"
  | "reference_ability_development"
  | "internal_process_improvement"
  // VERTICAL
  | "industry_specific_usecase"
  | "company_size_segment"
  | "persona_specific_framing"
  | "geographic_regional_variation"
  | "regulated_vs_unregulated"
  | "public_sector_government";

export const TOPIC_LABELS: Record<TaxonomyTopic, string> = {
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
  voice_of_customer_product: "Voice of Customer → Product",
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

export type StoryFormat =
  | "before_after_transformation"
  | "day_in_the_life"
  | "by_the_numbers_snapshot"
  | "video_testimonial_soundbite"
  | "joint_webinar_presentation"
  | "peer_reference_call_guide"
  | "analyst_validated_study";

export const STORY_FORMAT_LABELS: Record<StoryFormat, string> = {
  before_after_transformation: "Before/After Transformation",
  day_in_the_life: "Day-in-the-Life Workflow",
  by_the_numbers_snapshot: "By the Numbers Snapshot",
  video_testimonial_soundbite: "Video Testimonial / Soundbite",
  joint_webinar_presentation: "Joint Webinar / Presentation",
  peer_reference_call_guide: "Peer Reference Call Guide",
  analyst_validated_study: "Analyst-Validated Study",
};

export const STORY_TYPE_LABELS: Record<string, string> = {
  FULL_JOURNEY: "Full Journey",
  ONBOARDING: "Onboarding",
  ROI_ANALYSIS: "ROI Analysis",
  COMPETITIVE_WIN: "Competitive Win",
  EXPANSION: "Expansion",
  CUSTOM: "Custom",
};
