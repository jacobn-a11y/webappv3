/**
 * Story Generation Prompts
 *
 * Master prompt templates for generating customer stories from Gong transcripts.
 * These encode the full B2B case study taxonomy and expert writing guidelines.
 *
 * When Claude invokes these prompts via MCP, it receives detailed instructions
 * for generating specific types of stories. Claude itself does the AI work —
 * no separate AI API is needed.
 */

// ─── Full Taxonomy ──────────────────────────────────────────────────────────

export const STORY_TAXONOMY = {
  top_of_funnel: {
    label: "Top of Funnel (Awareness & Education)",
    topics: {
      industry_trend_validation:
        "Industry trend validation — how a customer navigated a macro shift",
      problem_challenge_identification:
        "Problem/challenge identification — day-in-the-life of the pain point before the solution",
      digital_transformation_modernization:
        "Digital transformation or modernization journeys",
      regulatory_compliance_challenges:
        "Regulatory or compliance challenges and how they were addressed",
      market_expansion:
        "Market expansion into new geographies or segments",
      thought_leadership_cocreation:
        "Thought leadership co-creation — joint research or insights with the customer",
    },
  },
  mid_funnel: {
    label: "Mid-Funnel (Consideration & Evaluation)",
    topics: {
      product_capability_deepdive:
        "Product or platform capability deep-dives — specific feature in action",
      competitive_displacement:
        "Head-to-head competitive displacement — migrating off a named competitor",
      integration_interoperability:
        "Integration and interoperability with existing tech stacks",
      implementation_onboarding:
        "Implementation and onboarding experience — time-to-value",
      security_compliance_governance:
        "Security, compliance, and data governance in practice",
      customization_configurability:
        "Customization and configurability for unique workflows",
      multi_product_cross_sell:
        "Multi-product or cross-sell adoption stories — landing and expanding",
      partner_ecosystem_solution:
        "Partner or ecosystem-enabled solutions — SI, reseller, or ISV involvement",
      total_cost_of_ownership:
        "Total cost of ownership and pricing model validation",
      pilot_to_production:
        "Proof of concept or pilot-to-production journeys",
    },
  },
  bottom_of_funnel: {
    label: "Bottom of Funnel (Decision & Purchase)",
    topics: {
      roi_financial_outcomes:
        "ROI and hard financial outcomes — cost savings, revenue generated, payback period",
      quantified_operational_metrics:
        "Quantified operational metrics — efficiency gains, time saved, error reduction",
      executive_strategic_impact:
        "Executive-level strategic impact — board-level or C-suite framing",
      risk_mitigation_continuity:
        "Risk mitigation and business continuity outcomes",
      deployment_speed:
        "Speed of deployment vs. expectations",
      vendor_selection_criteria:
        "Vendor selection criteria and why they chose you",
      procurement_experience:
        "Contract or procurement process experience — relevant for enterprise deals",
    },
  },
  post_sale: {
    label: "Post-Sale (Retention, Expansion & Advocacy)",
    topics: {
      renewal_partnership_evolution:
        "Renewal and long-term partnership evolution",
      upsell_cross_sell_expansion:
        "Upsell and cross-sell expansion over time",
      customer_success_support:
        "Customer success and support experience",
      training_enablement_adoption:
        "Training, enablement, and adoption programs",
      community_advisory_participation:
        "Community involvement or customer advisory board participation",
      co_innovation_product_feedback:
        "Co-innovation and product feedback loops — customer-influenced roadmap",
      change_management_champion_dev:
        "Change management and internal champion development",
      scaling_across_org:
        "Scaling usage across departments, business units, or geographies",
      platform_governance_coe:
        "Platform governance and center-of-excellence buildout",
    },
  },
  internal: {
    label: "Internal Audience-Specific Topics",
    topics: {
      sales_enablement:
        "Sales enablement — objection handling, competitive intelligence, deal strategy",
      lessons_learned_implementation:
        "Lessons learned from implementation or delivery — what went wrong and how it was fixed",
      cross_functional_collaboration:
        "Cross-functional collaboration stories — sales + CS + product + engineering",
      voice_of_customer_product:
        "Voice of the customer insights feeding back into product development",
      pricing_packaging_validation:
        "Pricing and packaging validation or iteration",
      churn_save_winback:
        "Churn saves and win-back stories",
      deal_anatomy:
        "Deal anatomy — how the deal was sourced, structured, and closed",
      customer_health_sentiment:
        "Customer health and sentiment trajectory over time",
      reference_ability_development:
        "Reference-ability development — turning a customer into a referenceable advocate",
      internal_process_improvement:
        "Internal process improvements inspired by customer feedback",
    },
  },
  vertical_segment: {
    label: "Vertical / Segment Cuts",
    topics: {
      industry_specific_usecase:
        "Industry-specific use cases — healthcare, financial services, manufacturing, etc.",
      company_size_segment:
        "Company size or segment — SMB, mid-market, enterprise, strategic",
      persona_specific_framing:
        "Persona-specific framing — same story told for a CTO vs. a CFO vs. an end user",
      geographic_regional_variation:
        "Geographic or regional variation",
      regulated_vs_unregulated:
        "Regulated vs. unregulated industry nuances",
      public_sector_government:
        "Public sector and government-specific procurement and compliance",
    },
  },
} as const;

export const STORY_FORMATS = {
  before_after_transformation: "Before/after transformation narratives",
  day_in_the_life: "Day-in-the-life or workflow-level stories",
  by_the_numbers_snapshot: '"By the numbers" data-driven snapshots',
  video_testimonial_soundbite: "Video testimonials and executive soundbites",
  joint_webinar_presentation:
    "Joint webinars, conference presentations, or co-authored content",
  peer_reference_call_guide:
    "Peer-to-peer reference calls (structured conversation guides)",
  analyst_validated_study:
    "Analyst or third-party validated case studies",
} as const;

export const STORY_LENGTHS = {
  SHORT: "500-800 words — Quick snapshot or executive brief",
  MEDIUM: "900-1400 words — Standard case study depth",
  LONG: "1500-2400 words — Comprehensive deep-dive with multiple sections",
  EXECUTIVE: "350-600 words — Board-ready executive brief",
} as const;

export const STORY_OUTLINES = {
  CHRONOLOGICAL_JOURNEY:
    "Executive Summary → Timeline → Journey Phases → Key Outcomes → Notable Quotes",
  PROBLEM_SOLUTION_IMPACT:
    "Context → Problem → Why Previous Approach Failed → Solution Implementation → Impact → Lessons Learned",
  BY_THE_NUMBERS:
    "Lead with quantified outcomes; metric table, benchmark comparisons, key quote callouts",
  EXECUTIVE_BRIEF:
    "Business Context → Strategic Decision → Financial/Operational Impact → Risks → Next Steps",
  IMPLEMENTATION_PLAYBOOK:
    "Initial State → Rollout Plan → Stakeholders → Integrations → Risks/Mitigations → Time-to-Value",
  DEAL_ANATOMY:
    "Opportunity Origin → Evaluation Criteria → Stakeholders → Competitive Landscape → Commercial Terms → Why Won",
} as const;

// ─── Master System Prompt ────────────────────────────────────────────────────

export const MASTER_STORY_SYSTEM_PROMPT = `You are an expert B2B content strategist generating evidence-based customer stories from Gong call transcripts.

CORE RULES:
1. Use ONLY facts directly stated in the provided transcripts. NEVER invent or extrapolate claims.
2. Every claim must be traceable to a specific call and timestamp.
3. Prioritize quantified outcomes, timeline accuracy, and decision rationale.
4. Write in third person with a business-professional tone.
5. Use markdown headings, tables, bullet lists, and blockquotes for readability.
6. Clearly distinguish factual evidence from inferred interpretation.
7. Include exact quotes with attribution: speaker name, timestamp, call date, and call title.

QUOTE FORMAT — always use this exact format for inline quotes:
> "Exact quote text here."
> — **Speaker Name**, [MM:SS], *Call Title*, YYYY-MM-DD

STORY STRUCTURE GUIDELINES:
- Open with a compelling hook drawn from an actual quote
- Establish context: who the customer is, their industry, and their challenge
- Walk through the journey chronologically or thematically
- Highlight 3-5 key moments with exact quotes
- Close with measurable outcomes and forward-looking implications

OUTPUT QUALITY CHECKS:
- Every quote must appear verbatim in the source transcripts
- All metrics must be explicitly stated by a speaker (never extrapolated)
- Speaker attributions must match the transcript data
- Timestamps must match the source
- If insufficient evidence exists for a section, explicitly note the gap rather than filling with generic language

${buildTaxonomyReference()}`;

// ─── Prompt Builders ─────────────────────────────────────────────────────────

export function buildStoryPromptMessages(args: {
  accountName: string;
  storyType?: string;
  storyLength?: string;
  storyOutline?: string;
  storyFormat?: string;
  transcriptMarkdown: string;
}): Array<{ role: "user" | "assistant"; content: string }> {
  const typeInstruction = args.storyType
    ? getStoryTypeInstruction(args.storyType)
    : "Generate a comprehensive Full Account Journey covering the entire customer relationship arc.";

  const lengthInstruction = args.storyLength
    ? `Target length: ${STORY_LENGTHS[args.storyLength as keyof typeof STORY_LENGTHS] ?? args.storyLength}`
    : "Target length: MEDIUM (900-1400 words)";

  const outlineInstruction = args.storyOutline
    ? `Outline template: ${STORY_OUTLINES[args.storyOutline as keyof typeof STORY_OUTLINES] ?? args.storyOutline}`
    : "Outline template: CHRONOLOGICAL_JOURNEY";

  const formatInstruction = args.storyFormat
    ? `Narrative format: ${STORY_FORMATS[args.storyFormat as keyof typeof STORY_FORMATS] ?? args.storyFormat}`
    : "";

  return [
    {
      role: "user",
      content: `Generate a customer story for **${args.accountName}** using the call transcripts below.

**Story Configuration:**
- Story Type Focus: ${typeInstruction}
- ${lengthInstruction}
- ${outlineInstruction}${formatInstruction ? `\n- ${formatInstruction}` : ""}

**Requirements:**
1. Use only evidence from these transcripts
2. Include 3-5 exact quotes with full attribution (speaker, timestamp, call date, call title)
3. Surface any quantified metrics in a dedicated "Key Outcomes" section
4. Note any evidence gaps rather than filling with generic text

**CALL TRANSCRIPTS:**

${args.transcriptMarkdown}`,
    },
  ];
}

export function buildQuoteExtractionMessages(args: {
  accountName: string;
  transcriptMarkdown: string;
  focusArea?: string;
}): Array<{ role: "user" | "assistant"; content: string }> {
  const focus = args.focusArea
    ? `Focus especially on quotes related to: ${args.focusArea}`
    : "Extract all high-value quotes across the full conversation history.";

  return [
    {
      role: "user",
      content: `Extract every notable, quotable statement from the call transcripts for **${args.accountName}**.

${focus}

For each quote, provide:
1. **Exact quote text** (verbatim from the transcript)
2. **Speaker name** (as identified in the transcript)
3. **Timestamp** (MM:SS format from the transcript)
4. **Call date** (YYYY-MM-DD)
5. **Call title**
6. **Category** — classify each quote:
   - Pain point / challenge
   - Decision rationale / vendor selection
   - Implementation experience
   - Quantified outcome (ROI, time saved, efficiency gain, cost reduction)
   - Product feedback / feature value
   - Strategic impact / executive perspective
   - Competitive insight
   - Expansion / growth indicator
   - Risk / concern
   - Advocacy / recommendation

Format the output as a markdown table:

| Quote | Speaker | Timestamp | Date | Call | Category |
|-------|---------|-----------|------|------|----------|
| ... | ... | ... | ... | ... | ... |

Then follow with a summary of the strongest quotes organized by category.

**CALL TRANSCRIPTS:**

${args.transcriptMarkdown}`,
    },
  ];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getStoryTypeInstruction(storyType: string): string {
  // Check each category for the topic
  for (const [, stage] of Object.entries(STORY_TAXONOMY)) {
    const topics = stage.topics as Record<string, string>;
    if (storyType in topics) {
      return `Focus on: ${topics[storyType]}. Frame the narrative around this specific angle while drawing on all relevant transcript evidence.`;
    }
  }

  // Check formats
  if (storyType in STORY_FORMATS) {
    return `Use the "${STORY_FORMATS[storyType as keyof typeof STORY_FORMATS]}" narrative format to shape the story.`;
  }

  if (storyType === "FULL_ACCOUNT_JOURNEY") {
    return "Generate a comprehensive Full Account Journey covering the entire customer relationship arc — from initial discovery through current state.";
  }

  return `Focus on: ${storyType}`;
}

function buildTaxonomyReference(): string {
  const lines: string[] = [
    "\n---\nAVAILABLE STORY TYPES (full taxonomy):\n",
  ];

  for (const [, stage] of Object.entries(STORY_TAXONOMY)) {
    lines.push(`### ${stage.label}`);
    for (const [key, desc] of Object.entries(stage.topics)) {
      lines.push(`- \`${key}\`: ${desc}`);
    }
    lines.push("");
  }

  lines.push("### Format & Angle Variations");
  for (const [key, desc] of Object.entries(STORY_FORMATS)) {
    lines.push(`- \`${key}\`: ${desc}`);
  }
  lines.push("");

  lines.push("### Story Lengths");
  for (const [key, desc] of Object.entries(STORY_LENGTHS)) {
    lines.push(`- \`${key}\`: ${desc}`);
  }
  lines.push("");

  lines.push("### Outline Templates");
  for (const [key, desc] of Object.entries(STORY_OUTLINES)) {
    lines.push(`- \`${key}\`: ${desc}`);
  }

  return lines.join("\n");
}

/**
 * Returns the full taxonomy as a readable reference string.
 * Used by the list_story_types prompt.
 */
export function getFullTaxonomyReference(): string {
  return buildTaxonomyReference();
}

/**
 * Returns all valid story type keys for input validation.
 */
export function getAllStoryTypeKeys(): string[] {
  const keys: string[] = ["FULL_ACCOUNT_JOURNEY"];
  for (const [, stage] of Object.entries(STORY_TAXONOMY)) {
    keys.push(...Object.keys(stage.topics));
  }
  return keys;
}

/**
 * Returns all valid format keys.
 */
export function getAllFormatKeys(): string[] {
  return Object.keys(STORY_FORMATS);
}

/**
 * Returns all valid length keys.
 */
export function getAllLengthKeys(): string[] {
  return Object.keys(STORY_LENGTHS);
}

/**
 * Returns all valid outline keys.
 */
export function getAllOutlineKeys(): string[] {
  return Object.keys(STORY_OUTLINES);
}
