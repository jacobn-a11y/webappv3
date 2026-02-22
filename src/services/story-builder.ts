/**
 * Markdown Story Builder
 *
 * Prompt-chaining function that:
 *  1. Takes all transcripts associated with an Account_ID
 *  2. Filters by specific taxonomy tags (e.g., "Onboarding," "ROI")
 *  3. Summarizes the journey into a structured Markdown document
 *  4. Extracts "High-Value Quotes" (specifically looking for quantified value)
 */

import OpenAI from "openai";
import type { PrismaClient, FunnelStage } from "@prisma/client";
import { TOPIC_LABELS, type TaxonomyTopic } from "../types/taxonomy.js";
import { TranscriptMerger } from "./transcript-merger.js";
import {
  storyLengthWordTarget,
  storyOutlineGuide,
  storyTypeLabel,
  type StoryContextSettings,
  type StoryLength,
  type StoryOutline,
  type StoryPromptDefaults,
  type StoryTypeInput,
} from "../types/story-generation.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StoryBuilderOptions {
  accountId: string;
  organizationId: string;
  /** Filter to specific funnel stages. If empty, includes all. */
  funnelStages?: FunnelStage[];
  /** Filter to specific taxonomy topics. If empty, includes all. */
  filterTopics?: TaxonomyTopic[];
  /** Custom title override. Auto-generated if omitted. */
  title?: string;
  /** Narrative format variation. */
  format?:
    | "before_after_transformation"
    | "day_in_the_life"
    | "by_the_numbers_snapshot"
    | "video_testimonial_soundbite"
    | "joint_webinar_presentation"
    | "peer_reference_call_guide"
    | "analyst_validated_study";
  /** Target length band. */
  storyLength?: StoryLength;
  /** Target outline template. */
  storyOutline?: StoryOutline;
  /** Explicit story type selector (full journey or topic-driven type). */
  storyType?: StoryTypeInput;
}

interface TranscriptSegment {
  callId: string;
  chunkId: string;
  callTitle: string | null;
  occurredAt: Date;
  startMs: number | null;
  chunkText: string;
  speaker: string | null;
  tags: Array<{ funnelStage: FunnelStage; topic: string; confidence: number }>;
}

interface ExtractedQuote {
  speaker: string | null;
  quoteText: string;
  context: string | null;
  metricType: string | null;
  metricValue: string | null;
  callId: string;
}

interface StoryResult {
  title: string;
  markdownBody: string;
  quotes: ExtractedQuote[];
}

interface EffectiveStoryGenerationSettings {
  storyLength: StoryLength;
  storyOutline: StoryOutline;
  storyType: StoryTypeInput;
  storyFormat?: StoryBuilderOptions["format"];
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

const JOURNEY_SUMMARY_PROMPT = `You are an expert B2B content strategist writing evidence-based customer stories for SaaS buyers.

Rules:
1. Use only facts from provided transcripts/context. Never invent.
2. Prioritize quantified outcomes, timeline accuracy, and decision rationale.
3. Keep writing in third person and business-professional tone.
4. Use markdown headings/tables/lists for readability.
5. Clearly separate factual evidence from inferred interpretation.
6. Make the output useful for RevOps, Marketing, and Sales stakeholders.`;

const QUOTE_EXTRACTION_PROMPT = `You are a precision extraction engine. Given transcript segments, extract ONLY direct quotes that contain quantified value — specific numbers, percentages, dollar amounts, time savings, or measurable outcomes.

For each quote found, return JSON with:
- "speaker": who said it (or null if unknown)
- "quote_text": the exact quote
- "context": 1-sentence description of when/why this was said
- "metric_type": one of "cost_savings", "revenue", "time_saved", "efficiency", "error_reduction", "adoption", "scale", "roi", "other"
- "metric_value": the specific number/percentage/amount mentioned

RULES:
1. Only extract REAL quotes from the text — never fabricate.
2. The quote MUST contain a quantified value. Skip purely qualitative statements.
3. Include enough of the quote for context but trim filler words.
4. Respond with JSON: { "quotes": [...] }`;

// ─── Story Builder ───────────────────────────────────────────────────────────

export class StoryBuilder {
  private openai: OpenAI;
  private prisma: PrismaClient;
  private model: string;
  private merger: TranscriptMerger;

  constructor(prisma: PrismaClient, openaiApiKey: string, model = "gpt-4o") {
    this.openai = new OpenAI({ apiKey: openaiApiKey });
    this.prisma = prisma;
    this.model = model;
    this.merger = new TranscriptMerger(prisma);
  }

  /**
   * Main entry point: builds a complete Markdown story for an account.
   * Uses a 3-step prompt chain:
   *   1. Gather & filter transcript segments
   *   2. Generate the journey narrative (Markdown)
   *   3. Extract high-value quotes
   */
  async buildStory(options: StoryBuilderOptions): Promise<StoryResult> {
    const [account, orgSettings] = await Promise.all([
      this.prisma.account.findUniqueOrThrow({
        where: { id: options.accountId },
      }),
      this.prisma.orgSettings.findUnique({
        where: { organizationId: options.organizationId },
        select: { storyContext: true, storyPromptDefaults: true },
      }),
    ]);

    const savedContext = (orgSettings?.storyContext ?? {}) as StoryContextSettings;
    const savedDefaults = (orgSettings?.storyPromptDefaults ?? {}) as StoryPromptDefaults;
    const effectiveSettings: EffectiveStoryGenerationSettings = {
      storyLength: options.storyLength ?? savedDefaults.storyLength ?? "MEDIUM",
      storyOutline: options.storyOutline ?? savedDefaults.storyOutline ?? "CHRONOLOGICAL_JOURNEY",
      storyType: options.storyType ?? savedDefaults.storyType ?? "FULL_ACCOUNT_JOURNEY",
      storyFormat: options.format ?? savedDefaults.storyFormat,
    };

    // ── Step 1: Merge all transcripts into a single markdown ─────────
    const mergeResult = await this.merger.mergeTranscripts({
      accountId: options.accountId,
      organizationId: options.organizationId,
    });

    if (mergeResult.includedCalls === 0) {
      return {
        title: options.title ?? "No Data Available",
        markdownBody:
          "No transcripts found for this account.",
        quotes: [],
      };
    }

    // ── Step 2: Also gather tagged segments for filtering & quotes ───
    const segments = await this.gatherSegments(options);

    // ── Step 3: Generate journey narrative from merged transcript ─────
    const markdown = await this.generateNarrativeFromMerged(
      account.name,
      mergeResult.markdown,
      mergeResult.includedCalls,
      mergeResult.truncated,
      segments,
      savedContext,
      effectiveSettings
    );

    // ── Step 4: Extract high-value quotes ────────────────────────────
    const quotes = await this.extractQuotes(segments);

    // ── Persist the story ────────────────────────────────────────────
    const title =
      options.title ?? this.generateTitle(account.name, options.filterTopics);

    const story = await this.prisma.story.create({
      data: {
        organizationId: options.organizationId,
        accountId: options.accountId,
        title,
        markdownBody: markdown,
        storyType: this.inferStoryType(options),
        confidenceScore: this.computeStoryConfidence(segments, quotes),
        lineageSummary: {
          calls_considered: new Set(segments.map((s) => s.callId)).size,
          segments_considered: segments.length,
          quote_count: quotes.length,
          model: this.model,
          generated_at: new Date().toISOString(),
        },
        funnelStages: options.funnelStages ?? [],
        filterTags: [
          ...(options.filterTopics ?? []),
          `story_type:${effectiveSettings.storyType}`,
          `story_length:${effectiveSettings.storyLength}`,
          `story_outline:${effectiveSettings.storyOutline}`,
          ...(effectiveSettings.storyFormat ? [`story_format:${effectiveSettings.storyFormat}`] : []),
        ],
      },
    });

    // Persist quotes
    for (const q of quotes) {
      const sourceSegment = segments.find((s) =>
        s.chunkText.toLowerCase().includes(q.quoteText.slice(0, 24).toLowerCase())
      );
      const quoteConfidence = this.computeQuoteConfidence(sourceSegment);
      await this.prisma.highValueQuote.create({
        data: {
          storyId: story.id,
          speaker: q.speaker,
          quoteText: q.quoteText,
          context: q.context,
          metricType: q.metricType,
          metricValue: q.metricValue,
          callId: q.callId,
          confidenceScore: quoteConfidence,
          lineageMetadata: sourceSegment
            ? {
                source_call_id: sourceSegment.callId,
                source_chunk_id: sourceSegment.chunkId,
                source_start_ms: sourceSegment.startMs,
                topics: sourceSegment.tags.map((t) => t.topic),
              }
            : undefined,
        },
      });

      await this.prisma.storyClaimLineage.create({
        data: {
          organizationId: options.organizationId,
          storyId: story.id,
          claimType: "QUOTE",
          claimText: q.quoteText,
          sourceCallId: sourceSegment?.callId ?? q.callId,
          sourceChunkId: sourceSegment?.chunkId ?? null,
          sourceTimestampMs: sourceSegment?.startMs ?? null,
          confidenceScore: quoteConfidence,
          metadata: {
            speaker: q.speaker,
            context: q.context,
            metric_type: q.metricType,
            metric_value: q.metricValue,
          },
        },
      });
    }

    return { title, markdownBody: markdown, quotes };
  }

  // ─── Step 1: Gather Segments ──────────────────────────────────────

  private async gatherSegments(
    options: StoryBuilderOptions
  ): Promise<TranscriptSegment[]> {
    // Build the where clause for chunk tags
    const tagFilter: Record<string, unknown> = {};
    if (options.funnelStages && options.funnelStages.length > 0) {
      tagFilter.funnelStage = { in: options.funnelStages };
    }
    if (options.filterTopics && options.filterTopics.length > 0) {
      tagFilter.topic = { in: options.filterTopics };
    }

    const hasTagFilter = Object.keys(tagFilter).length > 0;

    const calls = await this.prisma.call.findMany({
      where: {
        accountId: options.accountId,
        organizationId: options.organizationId,
      },
      include: {
        transcript: {
          include: {
            chunks: {
              include: {
                tags: hasTagFilter ? { where: tagFilter } : true,
              },
              orderBy: { chunkIndex: "asc" },
            },
          },
        },
      },
      orderBy: { occurredAt: "asc" },
    });

    const segments: TranscriptSegment[] = [];

    for (const call of calls) {
      if (!call.transcript) continue;

      for (const chunk of call.transcript.chunks) {
        // If filtering by tags, only include chunks that have matching tags
        if (hasTagFilter && chunk.tags.length === 0) continue;

        segments.push({
          callId: call.id,
          chunkId: chunk.id,
          callTitle: call.title,
          occurredAt: call.occurredAt,
          startMs: chunk.startMs,
          chunkText: chunk.text,
          speaker: chunk.speaker,
          tags: chunk.tags.map((t) => ({
            funnelStage: t.funnelStage,
            topic: t.topic,
            confidence: t.confidence,
          })),
        });
      }
    }

    return segments;
  }

  // ─── Step 2: Generate Narrative (from merged transcript) ──────────

  /**
   * Generates the journey narrative using the full merged transcript markdown.
   * This provides the LLM with complete, chronologically-ordered context
   * instead of fragmented chunk segments.
   */
  private async generateNarrativeFromMerged(
    accountName: string,
    mergedMarkdown: string,
    callCount: number,
    wasTruncated: boolean,
    segments: TranscriptSegment[],
    context: StoryContextSettings,
    settings: EffectiveStoryGenerationSettings
  ): Promise<string> {
    // Build topic summary from tagged segments for additional context
    const topicSummary = this.buildTopicSummary(segments);

    const truncationNote = wasTruncated
      ? "\n\nNOTE: Some calls were excluded to fit within context limits. The included calls represent the most relevant portion of the account journey."
      : "";

    const response = await this.openai.chat.completions.create({
      model: this.model,
      temperature: 0.3,
      max_tokens: 4000,
      messages: [
        {
          role: "system",
          content: this.buildStorySystemPrompt(context, settings),
        },
        {
          role: "user",
          content: this.buildStoryUserPrompt({
            accountName,
            callCount,
            topicSummary,
            truncationNote,
            mergedMarkdown,
            settings,
          }),
        },
      ],
    });

    return response.choices[0]?.message?.content ?? "# Story generation failed";
  }

  /**
   * Legacy method: generates narrative from chunked segments.
   * Kept for backward compatibility with direct segment-based workflows.
   */
  private async generateNarrative(
    accountName: string,
    segments: TranscriptSegment[]
  ): Promise<string> {
    const transcriptContext = segments
      .map((s) => {
        const date = s.occurredAt.toISOString().split("T")[0];
        const speaker = s.speaker ? `[${s.speaker}]` : "";
        const tags = s.tags.map((t) => TOPIC_LABELS[t.topic as TaxonomyTopic] ?? t.topic).join(", ");
        return `--- Call: "${s.callTitle ?? "Untitled"}" (${date}) ${speaker} [Tags: ${tags}] ---\n${s.chunkText}`;
      })
      .join("\n\n");

    const response = await this.openai.chat.completions.create({
      model: this.model,
      temperature: 0.3,
      max_tokens: 4000,
      messages: [
        { role: "system", content: JOURNEY_SUMMARY_PROMPT },
        {
          role: "user",
          content: `Account Name: ${accountName}
Number of calls: ${new Set(segments.map((s) => s.callId)).size}
Date range: ${segments[0].occurredAt.toISOString().split("T")[0]} to ${segments[segments.length - 1].occurredAt.toISOString().split("T")[0]}

TRANSCRIPT SEGMENTS:
${transcriptContext}`,
        },
      ],
    });

    return response.choices[0]?.message?.content ?? "# Story generation failed";
  }

  /**
   * Builds a comma-separated summary of the most common topics found
   * across all tagged segments.
   */
  private buildTopicSummary(segments: TranscriptSegment[]): string {
    const topicCounts = new Map<string, number>();
    for (const s of segments) {
      for (const t of s.tags) {
        const label = TOPIC_LABELS[t.topic as TaxonomyTopic] ?? t.topic;
        topicCounts.set(label, (topicCounts.get(label) ?? 0) + 1);
      }
    }
    return [...topicCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([label]) => label)
      .join(", ");
  }

  private buildStorySystemPrompt(
    context: StoryContextSettings,
    settings: EffectiveStoryGenerationSettings
  ): string {
    const contextLines = [
      context.companyOverview
        ? `Company Context: ${context.companyOverview}`
        : null,
      context.products?.length
        ? `Products: ${context.products.join(", ")}`
        : null,
      context.targetPersonas?.length
        ? `Target Personas: ${context.targetPersonas.join(", ")}`
        : null,
      context.targetIndustries?.length
        ? `Target Industries: ${context.targetIndustries.join(", ")}`
        : null,
      context.differentiators?.length
        ? `Differentiators: ${context.differentiators.join(" | ")}`
        : null,
      context.proofPoints?.length
        ? `Approved Proof Points: ${context.proofPoints.join(" | ")}`
        : null,
      context.bannedClaims?.length
        ? `Never claim these unless explicit in transcript: ${context.bannedClaims.join(" | ")}`
        : null,
      context.approvedTerminology?.length
        ? `Preferred Terminology: ${context.approvedTerminology.join(", ")}`
        : null,
      context.writingStyleGuide
        ? `Writing Style Guide: ${context.writingStyleGuide}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    return `${JOURNEY_SUMMARY_PROMPT}

Output controls:
- Story Type Focus: ${storyTypeLabel(settings.storyType)}
- Target Length: ${settings.storyLength} (${storyLengthWordTarget(settings.storyLength)})
- Outline Template: ${settings.storyOutline} (${storyOutlineGuide(settings.storyOutline)})
- Format Angle: ${settings.storyFormat ?? "auto"}

${contextLines ? `Organization Instructions:\n${contextLines}` : "No additional organization instructions provided."}
`;
  }

  private buildStoryUserPrompt(input: {
    accountName: string;
    callCount: number;
    topicSummary: string;
    truncationNote: string;
    mergedMarkdown: string;
    settings: EffectiveStoryGenerationSettings;
  }): string {
    return `Account Name: ${input.accountName}
Number of calls: ${input.callCount}
Requested Story Type: ${storyTypeLabel(input.settings.storyType)}
Requested Length: ${input.settings.storyLength}
Requested Outline: ${input.settings.storyOutline}
Requested Format: ${input.settings.storyFormat ?? "auto"}
${input.topicSummary ? `\nKey Topics Identified: ${input.topicSummary}\n` : ""}${input.truncationNote}

Instructions:
- Center the narrative around the requested story type.
- Use only transcript evidence for claims.
- Surface explicit metrics in a dedicated outcomes section.
- Include practical implications for RevOps, Marketing, and Sales.

FULL MERGED TRANSCRIPT:
${input.mergedMarkdown}`;
  }

  // ─── Step 3: Extract Quotes ───────────────────────────────────────

  private async extractQuotes(
    segments: TranscriptSegment[]
  ): Promise<ExtractedQuote[]> {
    // Only send segments likely to contain quantified value (BoFu + Post-Sale)
    const valuableSegments = segments.filter((s) =>
      s.tags.some(
        (t) =>
          t.funnelStage === "BOFU" ||
          t.funnelStage === "POST_SALE" ||
          t.topic === "roi_financial_outcomes" ||
          t.topic === "quantified_operational_metrics"
      )
    );

    // Fall back to all segments if no BoFu/Post-Sale ones found
    const targetSegments =
      valuableSegments.length > 0 ? valuableSegments : segments;

    const transcriptText = targetSegments
      .map((s) => {
        const speaker = s.speaker ? `[${s.speaker}]:` : "";
        return `${speaker} ${s.chunkText}`;
      })
      .join("\n\n");

    const response = await this.openai.chat.completions.create({
      model: this.model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: QUOTE_EXTRACTION_PROMPT },
        {
          role: "user",
          content: `Extract high-value quotes with quantified metrics from these transcript segments:\n\n${transcriptText}`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return [];

    try {
      const parsed = JSON.parse(content);
      const rawQuotes: Array<{
        speaker?: string;
        quote_text: string;
        context?: string;
        metric_type?: string;
        metric_value?: string;
      }> = parsed.quotes ?? [];

      // Find the call ID for each quote (best-effort match)
      return rawQuotes.map((q) => {
        const matchingSegment = targetSegments.find((s) =>
          s.chunkText.includes(q.quote_text.slice(0, 50))
        );
        return {
          speaker: q.speaker ?? null,
          quoteText: q.quote_text,
          context: q.context ?? null,
          metricType: q.metric_type ?? null,
          metricValue: q.metric_value ?? null,
          callId: matchingSegment?.callId ?? targetSegments[0].callId,
        };
      });
    } catch {
      return [];
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private generateTitle(
    accountName: string,
    topics?: TaxonomyTopic[]
  ): string {
    if (!topics || topics.length === 0) {
      return `${accountName}: Account Journey`;
    }
    const topicLabel = TOPIC_LABELS[topics[0]] ?? topics[0];
    return `${accountName}: ${topicLabel} Story`;
  }

  private inferStoryType(
    options: StoryBuilderOptions
  ): "FULL_JOURNEY" | "ONBOARDING" | "ROI_ANALYSIS" | "COMPETITIVE_WIN" | "EXPANSION" | "CUSTOM" {
    const explicitType = options.storyType;
    if (explicitType === "FULL_ACCOUNT_JOURNEY") return "FULL_JOURNEY";
    if (explicitType === "implementation_onboarding") return "ONBOARDING";
    if (explicitType === "roi_financial_outcomes") return "ROI_ANALYSIS";
    if (explicitType === "competitive_displacement") return "COMPETITIVE_WIN";
    if (explicitType === "upsell_cross_sell_expansion") return "EXPANSION";

    const topics = options.filterTopics;
    if (!topics || topics.length === 0) return "FULL_JOURNEY";
    if (topics.includes("implementation_onboarding")) return "ONBOARDING";
    if (topics.includes("roi_financial_outcomes")) return "ROI_ANALYSIS";
    if (topics.includes("competitive_displacement")) return "COMPETITIVE_WIN";
    if (topics.includes("upsell_cross_sell_expansion")) return "EXPANSION";
    return "CUSTOM";
  }

  private computeStoryConfidence(
    segments: TranscriptSegment[],
    quotes: ExtractedQuote[]
  ): number {
    if (segments.length === 0) return 0.25;
    const tagConfidences = segments.flatMap((s) => s.tags.map((t) => t.confidence));
    const avgTagConfidence =
      tagConfidences.length > 0
        ? tagConfidences.reduce((sum, value) => sum + value, 0) /
          tagConfidences.length
        : 0.55;
    const evidenceBoost = Math.min(0.2, quotes.length * 0.02);
    return Math.max(0, Math.min(1, avgTagConfidence * 0.8 + 0.2 + evidenceBoost));
  }

  private computeQuoteConfidence(segment?: TranscriptSegment): number {
    if (!segment || segment.tags.length === 0) return 0.6;
    const avg =
      segment.tags.reduce((sum, tag) => sum + tag.confidence, 0) /
      segment.tags.length;
    return Math.max(0, Math.min(1, avg));
  }
}
