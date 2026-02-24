/**
 * AI Taxonomy Tagger
 *
 * Uses an LLM to classify transcript chunks against the StoryEngine
 * B2B case-study taxonomy. Each chunk is tagged with a funnel stage
 * and one or more specific topics with confidence scores.
 *
 * Enhancements:
 *   - Batch processing with configurable concurrency
 *   - Token-bucket rate limiter respecting OpenAI TPM/RPM limits
 *   - Local SHA-256 cache to skip redundant LLM calls
 *   - Confidence calibration via isotonic regression against a validation set
 */

import OpenAI from "openai";
import type { PrismaClient } from "@prisma/client";
import type { AIClient } from "./ai-client.js";
import {
  FunnelStage,
  ALL_TOPICS,
  STAGE_TOPICS as _STAGE_TOPICS,
  TOPIC_LABELS as _TOPIC_LABELS,
  type TaxonomyTopic,
} from "../types/taxonomy.js";
import { RateLimiter } from "./rate-limiter.js";
import { TagCache, type CachedTag } from "./tag-cache.js";
import { ConfidenceCalibrator } from "./confidence-calibrator.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TagResult {
  funnelStage: FunnelStage;
  topic: TaxonomyTopic;
  confidence: number;
}

export interface ChunkTaggingResult {
  chunkId: string;
  tags: TagResult[];
  cached: boolean;
}

interface TagCallOptions {
  aiClient?: AIClient;
  idempotencyKeyPrefix?: string;
}

export interface AITaggerOptions {
  /** OpenAI model name (default: "gpt-4o") */
  model?: string;
  /** Max concurrent LLM requests within a single tagCallTranscript / tagBatch call */
  concurrency?: number;
  /** Rate limiter — if not provided, a default one is created */
  rateLimiter?: RateLimiter;
  /** Tag cache — if not provided, a default one is created */
  cache?: TagCache;
  /** Confidence calibrator — if not provided, raw scores are used */
  calibrator?: ConfidenceCalibrator;
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
  private concurrency: number;
  private rateLimiter: RateLimiter;
  private cache: TagCache;
  private calibrator: ConfidenceCalibrator | null;

  constructor(prisma: PrismaClient, openaiApiKey: string, options: AITaggerOptions = {}) {
    this.openai = new OpenAI({ apiKey: openaiApiKey });
    this.prisma = prisma;
    this.model = options.model ?? "gpt-4o";
    this.concurrency = options.concurrency ?? 5;

    this.rateLimiter =
      options.rateLimiter ??
      new RateLimiter({ maxRPM: 500, maxTPM: 30_000 });

    this.cache =
      options.cache ??
      new TagCache({ maxSize: 10_000, ttlMs: 60 * 60 * 1000 });

    this.calibrator = options.calibrator ?? null;
  }

  // ─── Public API ─────────────────────────────────────────────────────

  /**
   * Tags a single transcript chunk against the taxonomy.
   * Checks the local cache first; on miss, calls the LLM with rate limiting.
   * Applies confidence calibration if a calibrator is present.
   */
  async tagChunk(
    chunkText: string,
    options?: { aiClient?: AIClient; idempotencyKey?: string }
  ): Promise<{ tags: TagResult[]; cached: boolean }> {
    // ── Cache lookup ───────────────────────────────────────────────
    const cached = this.cache.get(chunkText);
    if (cached) {
      return { tags: this.fromCachedTags(cached), cached: true };
    }

    // ── Rate-limited LLM call ─────────────────────────────────────
    const estimatedTokens = RateLimiter.estimateTokens(
      TAGGER_SYSTEM_PROMPT + chunkText
    ) + 500; // +500 for expected completion

    await this.rateLimiter.acquire(estimatedTokens);

    const messages = [
      { role: "system" as const, content: TAGGER_SYSTEM_PROMPT },
      {
        role: "user" as const,
        content: `Classify this transcript segment. Return JSON with a "tags" array where each element has "funnel_stage", "topic", and "confidence".

TRANSCRIPT SEGMENT:
"""
${chunkText}
"""`,
      },
    ];

    let content: string | null | undefined = null;
    if (options?.aiClient) {
      const completion = await options.aiClient.chatCompletion({
        messages,
        temperature: 0.1,
        jsonMode: true,
        idempotencyKey: options.idempotencyKey,
      });
      this.rateLimiter.reportUsage(completion.totalTokens, estimatedTokens);
      content = completion.content;
    } else {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages,
      });

      // Report actual token usage back to the rate limiter
      const usage = response.usage;
      if (usage) {
        this.rateLimiter.reportUsage(usage.total_tokens, estimatedTokens);
      }
      content = response.choices[0]?.message?.content;
    }

    if (!content) {
      return { tags: [], cached: false };
    }

    let tags = this.parseTagResponse(content);

    // ── Confidence calibration ────────────────────────────────────
    if (this.calibrator?.calibrated) {
      tags = tags.map((t) => ({
        ...t,
        confidence: this.calibrator!.adjustConfidence(t.confidence),
      }));
    }

    // ── Cache store ───────────────────────────────────────────────
    this.cache.set(chunkText, this.toCachedTags(tags));

    return { tags, cached: false };
  }

  /**
   * Tags all chunks for an entire call transcript with concurrency-limited
   * batch processing. Persists tags to the database.
   */
  async tagCallTranscript(
    callId: string,
    options?: TagCallOptions
  ): Promise<ChunkTaggingResult[]> {
    const transcript = await this.prisma.transcript.findUnique({
      where: { callId },
      include: { chunks: { orderBy: { chunkIndex: "asc" } } },
    });

    if (!transcript) {
      throw new Error(`No transcript found for call ${callId}`);
    }

    // Process chunks in concurrency-limited batches
    const results = await this.processChunksWithConcurrency(
      transcript.chunks.map((c: { id: string; text: string }) => ({
        id: c.id,
        text: c.text,
      })),
      options
    );

    // Persist chunk-level tags (concurrent DB writes are fine)
    await Promise.all(
      results.map((result) =>
        Promise.all(
          result.tags.map((tag) =>
            this.prisma.chunkTag.upsert({
              where: {
                chunkId_funnelStage_topic: {
                  chunkId: result.chunkId,
                  funnelStage: tag.funnelStage,
                  topic: tag.topic,
                },
              },
              create: {
                chunkId: result.chunkId,
                funnelStage: tag.funnelStage,
                topic: tag.topic,
                confidence: tag.confidence,
              },
              update: {
                confidence: tag.confidence,
              },
            })
          )
        )
      )
    );

    // Aggregate chunk tags to call-level tags (highest confidence per topic)
    await this.aggregateCallTags(callId, results);

    return results;
  }

  /**
   * Batch-tags multiple calls with rate limiting. Processes calls sequentially
   * but chunks within each call use the concurrency pool.
   */
  async tagBatch(
    callIds: string[],
    onProgress?: (callId: string, index: number, total: number) => void
  ): Promise<Map<string, ChunkTaggingResult[]>> {
    const resultMap = new Map<string, ChunkTaggingResult[]>();

    for (let i = 0; i < callIds.length; i++) {
      const callId = callIds[i];
      const results = await this.tagCallTranscript(callId);
      resultMap.set(callId, results);
      onProgress?.(callId, i + 1, callIds.length);
    }

    return resultMap;
  }

  /**
   * Run confidence calibration against the validation set.
   * Requires a calibrator to be attached.
   *
   * Loads all validation samples from the DB, runs each through the tagger
   * (respecting cache + rate limits), and builds a calibration curve.
   */
  async runCalibration(): Promise<{
    report: import("./confidence-calibrator.js").CalibrationReport;
    cacheStats: { size: number; hits: number; misses: number; hitRate: number };
  } | null> {
    if (!this.calibrator) return null;

    const samples = await this.calibrator.loadValidationSamples();
    if (samples.length === 0) {
      return {
        report: this.calibrator.buildCalibration([]),
        cacheStats: this.cache.stats,
      };
    }

    // Tag each validation sample and compare against ground truth
    const observations: Array<{ rawConfidence: number; isCorrect: boolean }> = [];

    // Temporarily disable calibration so we get raw scores
    const _wasCalibrated = this.calibrator.calibrated;
    const savedCalibrator = this.calibrator;
    this.calibrator = null;

    try {
      const chunks = samples.map((s) => ({ id: s.id, text: s.chunkText }));
      const results = await this.processChunksWithConcurrency(chunks);

      for (let i = 0; i < samples.length; i++) {
        const sample = samples[i];
        const result = results[i];

        for (const tag of result.tags) {
          const isCorrect =
            tag.funnelStage === sample.expectedFunnelStage &&
            tag.topic === sample.expectedTopic;
          observations.push({ rawConfidence: tag.confidence, isCorrect });
        }

        // If the expected tag wasn't predicted at all, record a miss at confidence 0
        const expectedFound = result.tags.some(
          (t) =>
            t.funnelStage === sample.expectedFunnelStage &&
            t.topic === sample.expectedTopic
        );
        if (!expectedFound) {
          observations.push({ rawConfidence: 0, isCorrect: false });
        }
      }
    } finally {
      this.calibrator = savedCalibrator;
    }

    const report = this.calibrator.buildCalibration(observations);

    return { report, cacheStats: this.cache.stats };
  }

  /**
   * Get current cache statistics.
   */
  get cacheStats() {
    return this.cache.stats;
  }

  // ─── Private ──────────────────────────────────────────────────────

  /**
   * Process an array of chunks with bounded concurrency.
   * Each chunk goes through cache check → rate limiter → LLM call.
   */
  private async processChunksWithConcurrency(
    chunks: Array<{ id: string; text: string }>,
    options?: TagCallOptions
  ): Promise<ChunkTaggingResult[]> {
    const results: ChunkTaggingResult[] = new Array(chunks.length);

    // Semaphore-style concurrency control
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      while (nextIndex < chunks.length) {
        const idx = nextIndex++;
        const chunk = chunks[idx];
        const idempotencyKey = options?.idempotencyKeyPrefix
          ? `${options.idempotencyKeyPrefix}:${chunk.id}`
          : undefined;
        const { tags, cached } = await this.tagChunk(chunk.text, {
          aiClient: options?.aiClient,
          idempotencyKey,
        });
        results[idx] = { chunkId: chunk.id, tags, cached };
      }
    };

    // Launch `concurrency` workers
    const workers = Array.from(
      { length: Math.min(this.concurrency, chunks.length) },
      () => worker()
    );

    await Promise.all(workers);
    return results;
  }

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
          const validStage = Object.values(FunnelStage).includes(
            t.funnel_stage as FunnelStage
          );
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

  // ─── Cache helpers ──────────────────────────────────────────────

  private toCachedTags(tags: TagResult[]): CachedTag[] {
    return tags.map((t) => ({
      funnelStage: t.funnelStage,
      topic: t.topic,
      confidence: t.confidence,
    }));
  }

  private fromCachedTags(cached: CachedTag[]): TagResult[] {
    return cached
      .filter((t) => {
        const validStage = Object.values(FunnelStage).includes(
          t.funnelStage as FunnelStage
        );
        const validTopic = (ALL_TOPICS as readonly string[]).includes(t.topic);
        return validStage && validTopic;
      })
      .map((t) => ({
        funnelStage: t.funnelStage as FunnelStage,
        topic: t.topic as TaxonomyTopic,
        confidence: t.confidence,
      }));
  }
}
