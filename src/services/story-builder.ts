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
}

interface TranscriptSegment {
  callId: string;
  callTitle: string | null;
  occurredAt: Date;
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

// ─── Prompts ─────────────────────────────────────────────────────────────────

const JOURNEY_SUMMARY_PROMPT = `You are an expert B2B content strategist. Given a collection of transcript segments from calls with a customer account, produce a structured Markdown case study / account journey document.

GUIDELINES:
- Write in third person, professional tone
- Organize chronologically with clear section headers
- Highlight key milestones, decisions, and outcomes
- Use bullet points for lists of benefits or features
- Include a "Timeline" section showing the progression
- Include a "Key Outcomes" section summarizing measurable results
- Bold any quantified metrics (numbers, percentages, dollar amounts)
- Keep it concise but comprehensive — aim for 800-1500 words
- Do NOT fabricate information; only use what's in the transcripts

OUTPUT FORMAT (Markdown):
# [Account Name]: [Journey Title]

## Executive Summary
[2-3 sentence overview]

## Timeline
| Date | Milestone |
|------|-----------|
| ...  | ...       |

## The Journey
### [Phase 1 Title]
[Narrative]

### [Phase 2 Title]
[Narrative]

...

## Key Outcomes
- **[Metric]**: [Value and context]

## Notable Quotes
> "[Quote]" — [Speaker, Title]
`;

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
    const account = await this.prisma.account.findUniqueOrThrow({
      where: { id: options.accountId },
    });

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
      segments
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
        storyType: this.inferStoryType(options.filterTopics),
        funnelStages: options.funnelStages ?? [],
        filterTags: options.filterTopics ?? [],
      },
    });

    // Persist quotes
    if (quotes.length > 0) {
      await this.prisma.highValueQuote.createMany({
        data: quotes.map((q) => ({
          storyId: story.id,
          speaker: q.speaker,
          quoteText: q.quoteText,
          context: q.context,
          metricType: q.metricType,
          metricValue: q.metricValue,
          callId: q.callId,
        })),
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
          callTitle: call.title,
          occurredAt: call.occurredAt,
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
    segments: TranscriptSegment[]
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
        { role: "system", content: JOURNEY_SUMMARY_PROMPT },
        {
          role: "user",
          content: `Account Name: ${accountName}
Number of calls: ${callCount}
${topicSummary ? `\nKey Topics Identified: ${topicSummary}\n` : ""}${truncationNote}

FULL MERGED TRANSCRIPT:
${mergedMarkdown}`,
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
    topics?: TaxonomyTopic[]
  ): "FULL_JOURNEY" | "ONBOARDING" | "ROI_ANALYSIS" | "COMPETITIVE_WIN" | "EXPANSION" | "CUSTOM" {
    if (!topics || topics.length === 0) return "FULL_JOURNEY";
    if (topics.includes("implementation_onboarding")) return "ONBOARDING";
    if (topics.includes("roi_financial_outcomes")) return "ROI_ANALYSIS";
    if (topics.includes("competitive_displacement")) return "COMPETITIVE_WIN";
    if (topics.includes("upsell_cross_sell_expansion")) return "EXPANSION";
    return "CUSTOM";
  }
}
