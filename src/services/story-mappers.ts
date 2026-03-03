/**
 * Story Data Mappers
 *
 * Pure mapping/transformation functions for story data
 * used by the story routes and potentially other consumers.
 */

import type { HighValueQuote } from "@prisma/client";

export function mapStorySummary(s: {
  id: string;
  title: string;
  storyType: string;
  funnelStages: string[];
  filterTags: string[];
  generatedAt: Date;
  markdownBody: string;
  quotes: HighValueQuote[];
  landingPages: Array<{
    id: string;
    slug: string;
    status: string;
    publishedAt: Date | null;
  }>;
}) {
  return {
    story_status:
      s.landingPages.length === 0
        ? "DRAFT"
        : s.landingPages[0]?.status === "PUBLISHED"
          ? "PUBLISHED"
          : s.landingPages[0]?.status === "ARCHIVED"
            ? "ARCHIVED"
            : "PAGE_CREATED",
    id: s.id,
    title: s.title,
    story_type: s.storyType,
    funnel_stages: s.funnelStages,
    filter_tags: s.filterTags,
    generated_at: s.generatedAt.toISOString(),
    markdown: s.markdownBody,
    landing_page:
      s.landingPages[0] == null
        ? null
        : {
            id: s.landingPages[0].id,
            slug: s.landingPages[0].slug,
            status: s.landingPages[0].status,
            published_at: s.landingPages[0].publishedAt?.toISOString() ?? null,
          },
    quotes: s.quotes.map((q) => mapStoredQuote(q)),
  };
}

export function mapGeneratedQuote(q: {
  speaker: string | null;
  quoteText: string;
  context: string | null;
  metricType: string | null;
  metricValue: string | null;
  callId: string;
  sourceChunkId: string | null;
  sourceTimestampMs: number | null;
  sourceCallTitle: string | null;
  sourceRecordingUrl: string | null;
  confidenceScore?: number;
}) {
  return {
    speaker: q.speaker,
    quote_text: q.quoteText,
    context: q.context,
    metric_type: q.metricType,
    metric_value: q.metricValue,
    confidence_score: q.confidenceScore ?? undefined,
    call_id: q.callId,
    source_chunk_id: q.sourceChunkId ?? undefined,
    source_timestamp_ms: q.sourceTimestampMs ?? undefined,
    source_call_title: q.sourceCallTitle ?? undefined,
    source_recording_url: q.sourceRecordingUrl ?? undefined,
    transcript_deep_link: buildTranscriptDeepLink(
      q.callId,
      q.sourceTimestampMs ?? undefined,
      q.sourceChunkId ?? undefined
    ),
  };
}

export function mapStoredQuote(q: HighValueQuote) {
  const metadata = parseLineageMetadata(q.lineageMetadata);
  const sourceCallId = q.callId ?? metadata.source_call_id;

  return {
    speaker: q.speaker,
    quote_text: q.quoteText,
    context: q.context,
    metric_type: q.metricType,
    metric_value: q.metricValue,
    confidence_score: q.confidenceScore,
    call_id: sourceCallId ?? undefined,
    source_chunk_id: metadata.source_chunk_id,
    source_timestamp_ms: metadata.source_start_ms,
    source_call_title: metadata.source_call_title,
    source_recording_url: metadata.source_recording_url,
    transcript_deep_link: sourceCallId
      ? buildTranscriptDeepLink(sourceCallId, metadata.source_start_ms, metadata.source_chunk_id)
      : undefined,
  };
}

export function parseLineageMetadata(lineageMetadata: unknown): {
  source_call_id?: string;
  source_chunk_id?: string;
  source_start_ms?: number;
  source_call_title?: string;
  source_recording_url?: string;
} {
  if (!lineageMetadata || typeof lineageMetadata !== "object" || Array.isArray(lineageMetadata)) {
    return {};
  }

  const metadata = lineageMetadata as Record<string, unknown>;
  const sourceStartMs = metadata.source_start_ms;
  return {
    source_call_id:
      typeof metadata.source_call_id === "string" ? metadata.source_call_id : undefined,
    source_chunk_id:
      typeof metadata.source_chunk_id === "string" ? metadata.source_chunk_id : undefined,
    source_start_ms:
      typeof sourceStartMs === "number"
        ? sourceStartMs
        : typeof sourceStartMs === "string"
          ? Number.isFinite(Number(sourceStartMs))
            ? Number(sourceStartMs)
            : undefined
          : undefined,
    source_call_title:
      typeof metadata.source_call_title === "string" ? metadata.source_call_title : undefined,
    source_recording_url:
      typeof metadata.source_recording_url === "string"
        ? metadata.source_recording_url
        : undefined,
  };
}

export function buildTranscriptDeepLink(
  callId: string,
  sourceTimestampMs?: number,
  sourceChunkId?: string
): string {
  const params = new URLSearchParams();
  if (typeof sourceTimestampMs === "number" && Number.isFinite(sourceTimestampMs) && sourceTimestampMs >= 0) {
    params.set("tms", String(Math.floor(sourceTimestampMs)));
  }
  if (typeof sourceChunkId === "string" && sourceChunkId.length > 0) {
    params.set("chunk", sourceChunkId);
  }
  const query = params.toString();
  return query.length > 0
    ? `/calls/${encodeURIComponent(callId)}/transcript?${query}`
    : `/calls/${encodeURIComponent(callId)}/transcript`;
}
