/**
 * AI Taxonomy Tagger
 *
 * Uses an LLM to classify transcript chunks against the StoryEngine
 * B2B case-study taxonomy. Each chunk is tagged with a funnel stage
 * and one or more specific topics with confidence scores.
 */

import OpenAI from "openai";
import type { PrismaClient } from "@prisma/client";
import {
  FunnelStage,
  ALL_TOPICS,
  STAGE_TOPICS,
  TOPIC_LABELS,
  type TaxonomyTopic,
} from "../types/taxonomy.js";
import logger from "../lib/logger.js";
import { metrics } from "../lib/metrics.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TagResult {
  funnelStage: FunnelStage;
  topic: TaxonomyTopic;
  confidence: number;
}

interface ChunkTaggingResult {
  chunkId: string;
  tags: TagResult[];
}

// ─── System Prompt ───────────────────────────────────────────────────────────

const TAGGER_SYSTEM_PROMPT = `You are an expert B2B sales analyst. Your job is to classify transcript segments from sales and customer calls according to a sales-funnel taxonomy.

Given a transcript segment, identify ALL applicable tags. For each tag, provide:
- The funnel stage (TOFU, MOFU, BOFU, POST_SALE, INTERNAL, VERTICAL)
- The specific topic key
- A confidence score from 0.0 to 1.0

TAXONOMY REFERENCE:

**TOFU (Top of Funnel — Awareness & Education)**
- industry_trend_validation: Customer navigating macro industry shifts
- problem_challenge_identification: Day-in-the-life pain point before solution
- digital_transformation_modernization: Digital transformation journeys
- regulatory_compliance_challenges: Regulatory/compliance challenges addressed
- market_expansion: Expansion into new geographies or segments
- thought_leadership_cocreation: Joint research or insights with customer

**MOFU (Mid-Funnel — Consideration & Evaluation)**
- product_capability_deepdive: Specific feature or platform capability in action
- competitive_displacement: Migrating off a named competitor
- integration_interoperability: Integration with existing tech stacks
- implementation_onboarding: Implementation experience, time-to-value
- security_compliance_governance: Security, compliance, data governance in practice
- customization_configurability: Customization for unique workflows
- multi_product_cross_sell: Landing and expanding with multiple products
- partner_ecosystem_solution: SI, reseller, or ISV involvement
- total_cost_of_ownership: TCO and pricing model validation
- pilot_to_production: Pilot or POC to production journey

**BOFU (Bottom of Funnel — Decision & Purchase)**
- roi_financial_outcomes: ROI, cost savings, revenue generated, payback period
- quantified_operational_metrics: Efficiency gains, time saved, error reduction
- executive_strategic_impact: Board-level or C-suite strategic framing
- risk_mitigation_continuity: Risk mitigation and business continuity outcomes
- deployment_speed: Speed of deployment vs. expectations
- vendor_selection_criteria: Why they chose you over alternatives
- procurement_experience: Contract/procurement process experience

**POST_SALE (Retention, Expansion & Advocacy)**
- renewal_partnership_evolution: Renewal and long-term partnership
- upsell_cross_sell_expansion: Upsell and cross-sell over time
- customer_success_support: CS and support experience
- training_enablement_adoption: Training, enablement, adoption programs
- community_advisory_participation: Community or customer advisory board
- co_innovation_product_feedback: Customer-influenced roadmap
- change_management_champion_dev: Internal champion development
- scaling_across_org: Scaling across departments, BUs, geographies
- platform_governance_coe: Center-of-excellence buildout

**INTERNAL (Internal Audience)**
- sales_enablement: Objection handling, competitive intel, deal strategy
- lessons_learned_implementation: What went wrong and how it was fixed
- cross_functional_collaboration: Sales + CS + product + engineering stories
- voice_of_customer_product: Customer insights feeding product development
- pricing_packaging_validation: Pricing and packaging iteration
- churn_save_winback: Churn saves and win-back stories
- deal_anatomy: How the deal was sourced, structured, and closed
- customer_health_sentiment: Health and sentiment trajectory over time
- reference_ability_development: Turning customer into referenceable advocate
- internal_process_improvement: Process improvements from customer feedback

**VERTICAL (Segment Cuts)**
- industry_specific_usecase: Healthcare, finserv, manufacturing, etc.
- company_size_segment: SMB, mid-market, enterprise, strategic
- persona_specific_framing: Story framed for CTO vs CFO vs end user
- geographic_regional_variation: Geographic or regional variation
- regulated_vs_unregulated: Regulated vs. unregulated nuances
- public_sector_government: Government-specific procurement/compliance

RULES:
1. A segment can have MULTIPLE tags across different funnel stages.
2. Only tag what is clearly present — do not infer or speculate.
3. Confidence should reflect how strongly the segment evidences the topic.
4. Look especially for QUANTIFIED VALUE (numbers, percentages, dollar amounts) which signals BOFU topics.
5. Respond ONLY with valid JSON.`;

// ─── Core Tagger ─────────────────────────────────────────────────────────────

export class AITagger {
  private openai: OpenAI;
  private prisma: PrismaClient;
  private model: string;

  constructor(prisma: PrismaClient, openaiApiKey: string, model = "gpt-4o") {
    this.openai = new OpenAI({ apiKey: openaiApiKey });
    this.prisma = prisma;
    this.model = model;
  }

  /**
   * Tags a single transcript chunk against the taxonomy.
   */
  async tagChunk(chunkText: string): Promise<TagResult[]> {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      temperature: 0.1, // near-deterministic for classification
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: TAGGER_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Classify this transcript segment. Return JSON with a "tags" array where each element has "funnel_stage", "topic", and "confidence".

TRANSCRIPT SEGMENT:
"""
${chunkText}
"""`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return [];

    return this.parseTagResponse(content);
  }

  /**
   * Tags all chunks for an entire call transcript. Persists tags to the database.
   */
  async tagCallTranscript(callId: string): Promise<ChunkTaggingResult[]> {
    const transcript = await this.prisma.transcript.findUnique({
      where: { callId },
      include: { chunks: { orderBy: { chunkIndex: "asc" } } },
    });

    if (!transcript) {
      throw new Error(`No transcript found for call ${callId}`);
    }

    const results: ChunkTaggingResult[] = [];

    for (const chunk of transcript.chunks) {
      const tags = await this.tagChunk(chunk.text);

      // Persist chunk-level tags
      for (const tag of tags) {
        await this.prisma.chunkTag.upsert({
          where: {
            chunkId_funnelStage_topic: {
              chunkId: chunk.id,
              funnelStage: tag.funnelStage,
              topic: tag.topic,
            },
          },
          create: {
            chunkId: chunk.id,
            funnelStage: tag.funnelStage,
            topic: tag.topic,
            confidence: tag.confidence,
          },
          update: {
            confidence: tag.confidence,
          },
        });

        // Record tagging confidence for metrics
        metrics.recordTaggingConfidence(tag.funnelStage, tag.confidence);
      }

      results.push({ chunkId: chunk.id, tags });
    }

    // Aggregate chunk tags to call-level tags (highest confidence per topic)
    await this.aggregateCallTags(callId, results);

    logger.info("Tagged call transcript", {
      callId,
      chunksTagged: results.length,
      totalTags: results.reduce((sum, r) => sum + r.tags.length, 0),
    });

    return results;
  }

  /**
   * Batch-tags multiple calls. Useful for backfill processing.
   */
  async tagBatch(callIds: string[]): Promise<Map<string, ChunkTaggingResult[]>> {
    const resultMap = new Map<string, ChunkTaggingResult[]>();
    for (const callId of callIds) {
      const results = await this.tagCallTranscript(callId);
      resultMap.set(callId, results);
    }
    return resultMap;
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private parseTagResponse(content: string): TagResult[] {
    try {
      const parsed = JSON.parse(content);
      const rawTags: Array<{
        funnel_stage: string;
        topic: string;
        confidence: number;
      }> = parsed.tags ?? [];

      return rawTags
        .filter((t) => {
          // Validate funnel_stage is a real FunnelStage
          const validStage = Object.values(FunnelStage).includes(
            t.funnel_stage as FunnelStage
          );
          // Validate topic is a real taxonomy topic
          const validTopic = (ALL_TOPICS as readonly string[]).includes(
            t.topic
          );
          return validStage && validTopic;
        })
        .map((t) => ({
          funnelStage: t.funnel_stage as FunnelStage,
          topic: t.topic as TaxonomyTopic,
          confidence: Math.max(0, Math.min(1, t.confidence)),
        }));
    } catch {
      return [];
    }
  }

  private async aggregateCallTags(
    callId: string,
    chunkResults: ChunkTaggingResult[]
  ): Promise<void> {
    // Build a map of (stage, topic) -> max confidence
    const tagMap = new Map<string, { stage: FunnelStage; topic: string; confidence: number }>();

    for (const result of chunkResults) {
      for (const tag of result.tags) {
        const key = `${tag.funnelStage}:${tag.topic}`;
        const existing = tagMap.get(key);
        if (!existing || tag.confidence > existing.confidence) {
          tagMap.set(key, {
            stage: tag.funnelStage,
            topic: tag.topic,
            confidence: tag.confidence,
          });
        }
      }
    }

    // Upsert call-level tags
    for (const { stage, topic, confidence } of tagMap.values()) {
      await this.prisma.callTag.upsert({
        where: {
          callId_funnelStage_topic: {
            callId,
            funnelStage: stage,
            topic,
          },
        },
        create: { callId, funnelStage: stage, topic, confidence },
        update: { confidence },
      });
    }
  }
}
