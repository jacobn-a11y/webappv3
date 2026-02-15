/**
 * Markdown Story Builder
 *
 * Prompt-chaining function that:
 *  1. Takes all transcripts associated with an Account_ID
 *  2. Filters by specific taxonomy tags (e.g., "Onboarding," "ROI")
 *  3. Summarizes the journey into a structured Markdown document
 *  4. Extracts "High-Value Quotes" (specifically looking for quantified value)
 *
 * Uses the AIClient abstraction so the caller can choose which AI provider
 * and model to use. The TrackedAIClient wrapper handles usage tracking
 * and billing automatically.
 */

import type { PrismaClient, FunnelStage } from "@prisma/client";
import type { AIClient } from "./ai-client.js";
import { TOPIC_LABELS, type TaxonomyTopic } from "../types/taxonomy.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StoryBuilderOptions {
  accountId: string;
  organizationId: string;
  userId: string;
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
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Main entry point: builds a complete Markdown story for an account.
   * Uses a 3-step prompt chain:
   *   1. Gather & filter transcript segments
   *   2. Generate the journey narrative (Markdown)
   *   3. Extract high-value quotes
   *
   * @param options - Story configuration (account, filters, etc.)
   * @param aiClient - The AI client to use (may be a TrackedAIClient)
   */
  async buildStory(
    options: StoryBuilderOptions,
    aiClient: AIClient
  ): Promise<StoryResult> {
    // ── Step 1: Gather transcript segments ───────────────────────────
    const segments = await this.gatherSegments(options);

    if (segments.length === 0) {
      return {
        title: options.title ?? "No Data Available",
        markdownBody:
          "No transcript segments matched the specified filters for this account.",
        quotes: [],
      };
    }

    const account = await this.prisma.account.findUniqueOrThrow({
      where: { id: options.accountId },
    });

    // ── Step 2: Generate journey narrative ───────────────────────────
    const markdown = await this.generateNarrative(
      account.name,
      segments,
      aiClient
    );

    // ── Step 3: Extract high-value quotes ────────────────────────────
    const quotes = await this.extractQuotes(segments, aiClient);

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
        aiProvider: aiClient.providerName,
        aiModel: aiClient.modelName,
        generatedById: options.userId,
      },
    });

    // Persist quotes
    for (const q of quotes) {
      await this.prisma.highValueQuote.create({
        data: {
          storyId: story.id,
          speaker: q.speaker,
          quoteText: q.quoteText,
          context: q.context,
          metricType: q.metricType,
          metricValue: q.metricValue,
          callId: q.callId,
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

  // ─── Step 2: Generate Narrative ───────────────────────────────────

  private async generateNarrative(
    accountName: string,
    segments: TranscriptSegment[],
    aiClient: AIClient
  ): Promise<string> {
    // Prepare the transcript context
    const transcriptContext = segments
      .map((s) => {
        const date = s.occurredAt.toISOString().split("T")[0];
        const speaker = s.speaker ? `[${s.speaker}]` : "";
        const tags = s.tags.map((t) => TOPIC_LABELS[t.topic as TaxonomyTopic] ?? t.topic).join(", ");
        return `--- Call: "${s.callTitle ?? "Untitled"}" (${date}) ${speaker} [Tags: ${tags}] ---\n${s.chunkText}`;
      })
      .join("\n\n");

    const result = await aiClient.chatCompletion({
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
      temperature: 0.3,
      maxTokens: 4000,
    });

    return result.content || "# Story generation failed";
  }

  // ─── Step 3: Extract Quotes ───────────────────────────────────────

  private async extractQuotes(
    segments: TranscriptSegment[],
    aiClient: AIClient
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

    const result = await aiClient.chatCompletion({
      messages: [
        { role: "system", content: QUOTE_EXTRACTION_PROMPT },
        {
          role: "user",
          content: `Extract high-value quotes with quantified metrics from these transcript segments:\n\n${transcriptText}`,
        },
      ],
      temperature: 0.1,
      jsonMode: true,
    });

    if (!result.content) return [];

    try {
      const parsed = JSON.parse(result.content);
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
