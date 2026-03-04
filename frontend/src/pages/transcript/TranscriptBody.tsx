/**
 * TranscriptBody — Renders transcript segments with speaker avatars,
 * timestamps, tags, and search highlight support.
 */

import type { TranscriptData } from "../../lib/api";
import { formatEnumLabel } from "../../lib/format";
import { TOPIC_LABELS, type TaxonomyTopic } from "../../types/taxonomy";

// ─── Constants ──────────────────────────────────────────────────────────────

const SPEAKER_PALETTE = [
  "#4f46e5",
  "#7c3aed",
  "#059669",
  "#d97706",
  "#dc2626",
  "#2563eb",
  "#0891b2",
  "#be185d",
  "#65a30d",
  "#ea580c",
];

const STAGE_COLORS: Record<string, string> = {
  TOFU: "#2563eb",
  MOFU: "#7c3aed",
  BOFU: "#059669",
  POST_SALE: "#d97706",
  INTERNAL: "#6b7280",
  VERTICAL: "#dc2626",
};

const STAGE_BG_COLORS: Record<string, string> = {
  TOFU: "rgba(37, 99, 235, 0.12)",
  MOFU: "rgba(124, 58, 237, 0.12)",
  BOFU: "rgba(5, 150, 105, 0.12)",
  POST_SALE: "rgba(217, 119, 6, 0.12)",
  INTERNAL: "rgba(107, 114, 128, 0.12)",
  VERTICAL: "rgba(220, 38, 38, 0.12)",
};

const STAGE_LABELS: Record<string, string> = {
  TOFU: "Top of Funnel",
  MOFU: "Mid-Funnel",
  BOFU: "Bottom of Funnel",
  POST_SALE: "Post-Sale",
  INTERNAL: "Internal",
  VERTICAL: "Vertical",
};

// ─── Helper Functions ───────────────────────────────────────────────────────

export function speakerColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) & 0x7fffffff;
  }
  return SPEAKER_PALETTE[hash % SPEAKER_PALETTE.length];
}

export function speakerInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
}

export function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

function stageColor(stage: string): string {
  return STAGE_COLORS[stage] ?? "#6b7280";
}

function stageBgColor(stage: string): string {
  return STAGE_BG_COLORS[stage] ?? "rgba(107, 114, 128, 0.12)";
}

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

function topicLabel(topic: string): string {
  return (
    TOPIC_LABELS[topic as TaxonomyTopic] ??
    formatEnumLabel(topic)
  );
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Search Highlight Helper ────────────────────────────────────────────────

interface HighlightResult {
  parts: Array<{ text: string; isMatch: boolean; matchIndex: number }>;
  matchCount: number;
}

function highlightText(
  text: string,
  query: string,
  startMatchIndex: number,
): HighlightResult {
  if (!query || query.length < 2) {
    return { parts: [{ text, isMatch: false, matchIndex: -1 }], matchCount: 0 };
  }

  const regex = new RegExp(`(${escapeRegex(query)})`, "gi");
  const parts: HighlightResult["parts"] = [];
  let lastIndex = 0;
  let matchCount = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        text: text.slice(lastIndex, match.index),
        isMatch: false,
        matchIndex: -1,
      });
    }
    parts.push({
      text: match[1],
      isMatch: true,
      matchIndex: startMatchIndex + matchCount,
    });
    matchCount++;
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push({
      text: text.slice(lastIndex),
      isMatch: false,
      matchIndex: -1,
    });
  }

  if (parts.length === 0) {
    parts.push({ text, isMatch: false, matchIndex: -1 });
  }

  return { parts, matchCount };
}

// ─── Tag Pill Component ─────────────────────────────────────────────────────

interface TagPillProps {
  funnelStage: string;
  topic: string;
  confidence: number;
  small?: boolean;
}

export function TagPill({ funnelStage, topic, confidence, small }: TagPillProps) {
  const label = topicLabel(topic);
  const tooltip = `${label} (${stageLabel(funnelStage)}) \u2014 ${Math.round(confidence * 100)}% confidence`;

  return (
    <span
      className={`transcript__tag-pill${small ? " transcript__tag-pill--header" : ""}`}
      style={{
        background: stageBgColor(funnelStage),
        color: stageColor(funnelStage),
        borderColor: `${stageColor(funnelStage)}20`,
      }}
      title={tooltip}
    >
      {label}
    </span>
  );
}

// ─── Segment Component ──────────────────────────────────────────────────────

interface SegmentProps {
  segment: TranscriptData["segments"][number];
  searchQuery: string;
  activeMatchIndex: number;
  matchStartIndex: number;
  matchRefs: React.MutableRefObject<Map<number, HTMLElement>>;
  segmentRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  highlightedSegmentId: string | null;
  onSaveQuote?: (segment: TranscriptData["segments"][number]) => void;
  savingSegmentId?: string | null;
}

function Segment({
  segment,
  searchQuery,
  activeMatchIndex,
  matchStartIndex,
  matchRefs,
  segmentRefs,
  highlightedSegmentId,
  onSaveQuote,
  savingSegmentId,
}: SegmentProps) {
  const speaker = segment.speaker ?? "Unknown Speaker";
  const color = speakerColor(speaker);
  const initials = speakerInitials(speaker);

  const { parts } = highlightText(segment.text, searchQuery, matchStartIndex);

  return (
    <div
      ref={(el) => {
        if (el) {
          segmentRefs.current.set(segment.id, el);
        } else {
          segmentRefs.current.delete(segment.id);
        }
      }}
      className={`transcript__seg${segment.id === highlightedSegmentId ? " transcript__seg--deep-linked" : ""}`}
      data-speaker={speaker}
      data-chunk-id={segment.id}
    >
      <div className="transcript__seg-gutter">
        <div
          className="transcript__seg-avatar"
          style={{ background: color }}
        >
          {initials}
        </div>
        {segment.startMs != null && (
          <span className="transcript__seg-timestamp">
            {formatMs(segment.startMs)}
          </span>
        )}
      </div>
      <div className="transcript__seg-body">
        <div className="transcript__seg-header">
          <span className="transcript__seg-speaker">{speaker}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {segment.endMs != null && segment.startMs != null && (
              <span className="transcript__seg-duration">
                {formatMs(segment.endMs - segment.startMs)}
              </span>
            )}
            {onSaveQuote && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={savingSegmentId === segment.id}
                onClick={() => onSaveQuote(segment)}
              >
                {savingSegmentId === segment.id ? "Saving..." : "Save quote"}
              </button>
            )}
          </div>
        </div>
        <div className="transcript__seg-text">
          {parts.map((part, i) =>
            part.isMatch ? (
              <mark
                key={i}
                ref={(el) => {
                  if (el) {
                    matchRefs.current.set(part.matchIndex, el);
                  }
                }}
                className={`transcript__search-hit${
                  part.matchIndex === activeMatchIndex
                    ? " transcript__search-hit--active"
                    : ""
                }`}
                data-match-id={part.matchIndex}
              >
                {part.text}
              </mark>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
        </div>
        {segment.tags.length > 0 && (
          <div className="transcript__seg-tags">
            {segment.tags.map((tag, i) => (
              <TagPill
                key={i}
                funnelStage={tag.funnelStage}
                topic={tag.topic}
                confidence={tag.confidence}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── TranscriptBody Component ───────────────────────────────────────────────

export interface TranscriptBodyProps {
  segments: TranscriptData["segments"];
  searchQuery: string;
  activeMatchIndex: number;
  segmentMatchStarts: number[];
  matchRefs: React.MutableRefObject<Map<number, HTMLElement>>;
  segmentRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  highlightedSegmentId: string | null;
  onSaveQuote?: (segment: TranscriptData["segments"][number]) => void;
  savingSegmentId?: string | null;
}

export function TranscriptBody({
  segments,
  searchQuery,
  activeMatchIndex,
  segmentMatchStarts,
  matchRefs,
  segmentRefs,
  highlightedSegmentId,
  onSaveQuote,
  savingSegmentId,
}: TranscriptBodyProps) {
  if (segments.length === 0) {
    return (
      <div className="transcript__empty">
        <svg
          className="transcript__empty-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          width="48"
          height="48"
        >
          <path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2z" />
          <path d="M7 7h10M7 12h10M7 17h6" />
        </svg>
        <p className="transcript__empty-title">
          No transcript segments
        </p>
        <p className="transcript__empty-subtitle">
          This call hasn't been transcribed yet.
        </p>
      </div>
    );
  }

  return (
    <>
      {segments.map((segment, i) => (
        <Segment
          key={segment.id}
          segment={segment}
          searchQuery={searchQuery}
          activeMatchIndex={activeMatchIndex}
          matchStartIndex={segmentMatchStarts[i] ?? 0}
          matchRefs={matchRefs}
          segmentRefs={segmentRefs}
          highlightedSegmentId={highlightedSegmentId}
          onSaveQuote={onSaveQuote}
          savingSegmentId={savingSegmentId}
        />
      ))}
    </>
  );
}
