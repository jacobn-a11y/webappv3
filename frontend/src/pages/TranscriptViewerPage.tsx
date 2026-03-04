/**
 * TranscriptViewerPage — Layout shell, data fetching, and state management.
 * Sub-components decomposed into ./transcript/
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { useLocation, useParams } from "react-router-dom";
import {
  getTranscriptData,
  saveQuoteFromTranscript,
  type TranscriptData,
} from "../lib/api";
import { TranscriptBody, TagPill } from "./transcript/TranscriptBody";
import { TranscriptSidebar } from "./transcript/TranscriptSidebar";
import { TranscriptSearch } from "./transcript/TranscriptSearch";
import "./TranscriptViewerPage.css";

// Re-export sub-components for backward compatibility
export { TranscriptBody } from "./transcript/TranscriptBody";
export type { TranscriptBodyProps } from "./transcript/TranscriptBody";
export { TranscriptSidebar } from "./transcript/TranscriptSidebar";
export type { TranscriptSidebarProps } from "./transcript/TranscriptSidebar";
export { TranscriptSearch } from "./transcript/TranscriptSearch";
export type { TranscriptSearchProps } from "./transcript/TranscriptSearch";

// ─── Helpers (search-related, kept here since they drive page-level state) ──

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseNonNegativeInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

// ─── Main Page Component ────────────────────────────────────────────────────

export function TranscriptViewerPage() {
  const { callId } = useParams<{ callId: string }>();
  const location = useLocation();

  const [data, setData] = useState<TranscriptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [savingSegmentId, setSavingSegmentId] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(-1);
  const [totalMatches, setTotalMatches] = useState(0);
  const [highlightedSegmentId, setHighlightedSegmentId] = useState<string | null>(null);

  const matchRefs = useRef<Map<number, HTMLElement>>(new Map());
  const segmentRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deepLinkHandledRef = useRef<string | null>(null);
  const deepLinkClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const deepLinkTarget = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return {
      timestampMs: parseNonNegativeInt(params.get("tms")),
      chunkId: params.get("chunk")?.trim() || null,
    };
  }, [location.search]);

  // ─── Data Fetching ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!callId) return;
    setLoading(true);
    setError(null);

    getTranscriptData(callId)
      .then((result) => {
        setData(result);
      })
      .catch((err: Error) => {
        setError(err.message ?? "Failed to load transcript");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [callId]);

  // ─── Debounced Search ─────────────────────────────────────────────────

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 200);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [searchQuery]);

  // ─── Compute Match Indices per Segment ────────────────────────────────

  const segmentMatchStarts = useMemo(() => {
    if (!data || !debouncedQuery || debouncedQuery.length < 2) return [];

    const starts: number[] = [];
    let runningTotal = 0;
    const regex = new RegExp(escapeRegex(debouncedQuery), "gi");

    for (const segment of data.segments) {
      starts.push(runningTotal);
      const matches = segment.text.match(regex);
      runningTotal += matches ? matches.length : 0;
    }

    return starts;
  }, [data, debouncedQuery]);

  // ─── Update Total Matches ────────────────────────────────────────────

  useEffect(() => {
    if (!data || !debouncedQuery || debouncedQuery.length < 2) {
      setTotalMatches(0);
      setActiveMatchIndex(-1);
      matchRefs.current.clear();
      return;
    }

    const regex = new RegExp(escapeRegex(debouncedQuery), "gi");
    let count = 0;
    for (const segment of data.segments) {
      const matches = segment.text.match(regex);
      if (matches) count += matches.length;
    }

    setTotalMatches(count);
    matchRefs.current.clear();
    if (count > 0) {
      setActiveMatchIndex(0);
    } else {
      setActiveMatchIndex(-1);
    }
  }, [data, debouncedQuery]);

  // ─── Scroll to Active Match ──────────────────────────────────────────

  useEffect(() => {
    if (activeMatchIndex < 0) return;

    requestAnimationFrame(() => {
      const el = matchRefs.current.get(activeMatchIndex);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }, [activeMatchIndex, debouncedQuery]);

  // ─── Deep-Link Jump (quote provenance) ──────────────────────────────────

  useEffect(() => {
    if (!data) return;
    const { timestampMs, chunkId } = deepLinkTarget;
    if (timestampMs == null && !chunkId) return;

    const fingerprint = `${callId ?? ""}:${chunkId ?? ""}:${timestampMs ?? ""}`;
    if (deepLinkHandledRef.current === fingerprint) return;

    let targetSegment = chunkId
      ? data.segments.find((segment) => segment.id === chunkId)
      : undefined;

    if (!targetSegment && timestampMs != null) {
      const segmentsWithTimestamp = data.segments.filter(
        (segment) => typeof segment.startMs === "number"
      );
      if (segmentsWithTimestamp.length > 0) {
        targetSegment = segmentsWithTimestamp.reduce((closest, current) => {
          const closestDistance = Math.abs((closest.startMs as number) - timestampMs);
          const currentDistance = Math.abs((current.startMs as number) - timestampMs);
          return currentDistance < closestDistance ? current : closest;
        });
      }
    }

    if (!targetSegment) return;

    deepLinkHandledRef.current = fingerprint;
    setHighlightedSegmentId(targetSegment.id);

    requestAnimationFrame(() => {
      segmentRefs.current
        .get(targetSegment.id)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    if (deepLinkClearTimerRef.current) {
      clearTimeout(deepLinkClearTimerRef.current);
    }
    deepLinkClearTimerRef.current = setTimeout(() => {
      setHighlightedSegmentId((current) =>
        current === targetSegment?.id ? null : current
      );
    }, 3500);
  }, [callId, data, deepLinkTarget]);

  useEffect(() => {
    return () => {
      if (deepLinkClearTimerRef.current) {
        clearTimeout(deepLinkClearTimerRef.current);
      }
    };
  }, []);

  // ─── Navigation Callbacks ────────────────────────────────────────────

  const goToPrevMatch = useCallback(() => {
    if (totalMatches <= 0) return;
    setActiveMatchIndex((prev) =>
      (prev - 1 + totalMatches) % totalMatches,
    );
  }, [totalMatches]);

  const goToNextMatch = useCallback(() => {
    if (totalMatches <= 0) return;
    setActiveMatchIndex((prev) => (prev + 1) % totalMatches);
  }, [totalMatches]);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setDebouncedQuery("");
  }, []);

  // ─── Toggle Sidebar ──────────────────────────────────────────────────

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

  const handleSaveQuote = useCallback(
    async (segment: TranscriptData["segments"][number]) => {
      if (!callId) return;
      setSavingSegmentId(segment.id);
      setError(null);
      setNotice(null);
      try {
        await saveQuoteFromTranscript({
          call_id: callId,
          source_chunk_id: segment.id,
          quote_text: segment.text,
        });
        setNotice("Saved as curated quote.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save quote");
      } finally {
        setSavingSegmentId(null);
      }
    },
    [callId]
  );

  // ─── Render: Loading / Error States ──────────────────────────────────

  if (!callId) {
    return (
      <div className="transcript__error">
        No call ID provided.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="transcript__loading" role="status" aria-live="polite">
        <div className="transcript__loading-spinner" aria-hidden="true" />
        <span>Loading transcript...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="transcript__error" role="alert">
        <svg
          className="transcript__error-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          width="48"
          height="48"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
        <p className="transcript__error-title">Failed to load transcript</p>
        <p className="transcript__error-detail">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="transcript__error">
        <p className="transcript__error-title">No data available</p>
      </div>
    );
  }

  // ─── Render: Full Page ────────────────────────────────────────────────

  const mainClasses = [
    "transcript__main",
    sidebarCollapsed ? "transcript__main--sidebar-collapsed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="transcript__layout">
      <h1 className="sr-only">
        {data.meta.title ? `${data.meta.title} Transcript` : "Transcript"}
      </h1>
      <div className={mainClasses}>
        {notice && (
          <div className="alert alert--success" style={{ marginBottom: 12 }}>
            {notice}
          </div>
        )}
        {/* Header */}
        <div className="transcript__header">
          <div className="transcript__header-inner">
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="transcript__header-title">
                {data.meta.title ?? "Transcript"}
              </span>
              <span className={`badge ${data.meta.viewMode === "SCRUBBED" ? "badge--warning" : "badge--info"}`}>
                {data.meta.viewMode === "SCRUBBED" ? "Scrubbed transcript" : "Raw transcript"}
              </span>
            </div>

            {data.callTags.length > 0 && (
              <div className="transcript__header-tags">
                {data.callTags.map((tag, i) => (
                  <TagPill
                    key={i}
                    funnelStage={tag.funnelStage}
                    topic={tag.topic}
                    confidence={tag.confidence}
                    small
                  />
                ))}
              </div>
            )}

            <TranscriptSearch
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              debouncedQuery={debouncedQuery}
              onClearSearch={clearSearch}
              activeMatchIndex={activeMatchIndex}
              totalMatches={totalMatches}
              onPrevMatch={goToPrevMatch}
              onNextMatch={goToNextMatch}
            />
          </div>
        </div>

        {/* Transcript Body */}
        <div className="transcript__body">
        <TranscriptBody
          segments={data.segments}
          searchQuery={debouncedQuery}
          activeMatchIndex={activeMatchIndex}
          segmentMatchStarts={segmentMatchStarts}
          matchRefs={matchRefs}
          segmentRefs={segmentRefs}
          highlightedSegmentId={highlightedSegmentId}
          onSaveQuote={handleSaveQuote}
          savingSegmentId={savingSegmentId}
        />
        </div>
      </div>

      {/* Sidebar */}
      <TranscriptSidebar
        meta={data.meta}
        participants={data.participants}
        entity={data.entity}
        collapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
      />
    </div>
  );
}
