import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { useParams } from "react-router-dom";
import { getTranscriptData, type TranscriptData } from "../lib/api";
import { TOPIC_LABELS, type TaxonomyTopic } from "../types/taxonomy";

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
  TOFU: "#eff6ff",
  MOFU: "#f5f3ff",
  BOFU: "#ecfdf5",
  POST_SALE: "#fffbeb",
  INTERNAL: "#f3f4f6",
  VERTICAL: "#fef2f2",
};

const STAGE_LABELS: Record<string, string> = {
  TOFU: "Top of Funnel",
  MOFU: "Mid-Funnel",
  BOFU: "Bottom of Funnel",
  POST_SALE: "Post-Sale",
  INTERNAL: "Internal",
  VERTICAL: "Vertical",
};

const PROVIDER_LABELS: Record<string, string> = {
  GONG: "Gong",
  CHORUS: "Chorus",
  ZOOM: "Zoom",
  GOOGLE_MEET: "Google Meet",
  TEAMS: "Microsoft Teams",
  FIREFLIES: "Fireflies",
  DIALPAD: "Dialpad",
  AIRCALL: "Aircall",
  RINGCENTRAL: "RingCentral",
  SALESLOFT: "SalesLoft",
  OUTREACH: "Outreach",
  OTHER: "Other",
};

// ─── Helper Functions ───────────────────────────────────────────────────────

function speakerColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) & 0x7fffffff;
  }
  return SPEAKER_PALETTE[hash % SPEAKER_PALETTE.length];
}

function speakerInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
}

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  return parts.join(" ");
}

function formatProvider(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

function stageColor(stage: string): string {
  return STAGE_COLORS[stage] ?? "#6b7280";
}

function stageBgColor(stage: string): string {
  return STAGE_BG_COLORS[stage] ?? "#f3f4f6";
}

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

function topicLabel(topic: string): string {
  return (
    TOPIC_LABELS[topic as TaxonomyTopic] ??
    topic.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
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

function TagPill({ funnelStage, topic, confidence, small }: TagPillProps) {
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
}

function Segment({
  segment,
  searchQuery,
  activeMatchIndex,
  matchStartIndex,
  matchRefs,
}: SegmentProps) {
  const speaker = segment.speaker ?? "Unknown Speaker";
  const color = speakerColor(speaker);
  const initials = speakerInitials(speaker);

  const { parts } = highlightText(segment.text, searchQuery, matchStartIndex);

  return (
    <div
      className="transcript__seg"
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
          {segment.endMs != null && segment.startMs != null && (
            <span className="transcript__seg-duration">
              {formatMs(segment.endMs - segment.startMs)}
            </span>
          )}
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

// ─── Sidebar Component ──────────────────────────────────────────────────────

interface SidebarProps {
  meta: TranscriptData["meta"];
  participants: TranscriptData["participants"];
  entity: TranscriptData["entity"];
  collapsed: boolean;
  onToggle: () => void;
}

function Sidebar({
  meta,
  participants,
  entity,
  collapsed,
  onToggle,
}: SidebarProps) {
  const metaRows = useMemo(() => {
    const rows = [
      { label: "Provider", value: formatProvider(meta.provider) },
      {
        label: "Date",
        value: new Date(meta.occurredAt).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
      },
      {
        label: "Time",
        value: new Date(meta.occurredAt).toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      },
    ];
    if (meta.duration != null) {
      rows.push({ label: "Duration", value: formatDuration(meta.duration) });
    }
    rows.push(
      { label: "Language", value: meta.language.toUpperCase() },
      { label: "Word Count", value: meta.wordCount.toLocaleString() },
    );
    return rows;
  }, [meta]);

  const sidebarClasses = [
    "transcript__sidebar",
    collapsed ? "transcript__sidebar--collapsed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <aside className={sidebarClasses}>
      <button
        className="transcript__sidebar-toggle"
        onClick={onToggle}
        aria-label="Toggle sidebar"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>

      <div className="transcript__sidebar-content">
        {/* Call Details */}
        <section className="transcript__sidebar-section">
          <h3 className="transcript__sidebar-heading">Call Details</h3>
          {meta.title && (
            <h4 className="transcript__sidebar-call-title">{meta.title}</h4>
          )}
          {meta.recordingUrl && (
            <a
              href={meta.recordingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="transcript__recording-link"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                width="14"
                height="14"
              >
                <polygon points="5,3 19,12 5,21" />
              </svg>
              Play Recording
            </a>
          )}
          <div className="transcript__meta-grid">
            {metaRows.map((row) => (
              <div className="transcript__meta-row" key={row.label}>
                <span className="transcript__meta-label">{row.label}</span>
                <span className="transcript__meta-value">{row.value}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Participants */}
        <section className="transcript__sidebar-section">
          <h3 className="transcript__sidebar-heading">
            Participants{" "}
            <span className="transcript__count-badge">
              {participants.length}
            </span>
          </h3>
          <div className="transcript__participants-list">
            {participants.length > 0 ? (
              participants.map((p, i) => {
                const displayName =
                  p.contactName ?? p.name ?? p.email ?? "Unknown";
                const subtitle = p.contactTitle ?? p.email ?? "";
                const pColor = speakerColor(displayName);
                const pInitials = speakerInitials(displayName);

                return (
                  <div className="transcript__participant" key={i}>
                    <div
                      className="transcript__participant-avatar"
                      style={{ background: pColor }}
                    >
                      {pInitials}
                    </div>
                    <div className="transcript__participant-info">
                      <span className="transcript__participant-name">
                        {displayName}
                        {p.isHost && (
                          <span className="transcript__host-badge">Host</span>
                        )}
                      </span>
                      {subtitle && (
                        <span className="transcript__participant-subtitle">
                          {subtitle}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="transcript__sidebar-empty">
                No participants recorded
              </p>
            )}
          </div>
        </section>

        {/* Entity Resolution */}
        <section className="transcript__sidebar-section">
          <h3 className="transcript__sidebar-heading">Entity Resolution</h3>
          {entity.accountId ? (
            <div className="transcript__entity-card transcript__entity-card--resolved">
              <div className="transcript__entity-status">
                <span className="transcript__entity-dot transcript__entity-dot--resolved" />
                <span>{entity.accountName ? "Resolved" : "Partial"}</span>
              </div>
              <div className="transcript__entity-detail">
                <span className="transcript__entity-label">Account</span>
                <span className="transcript__entity-value">
                  {entity.accountName ?? "\u2014"}
                </span>
              </div>
              {entity.accountDomain && (
                <div className="transcript__entity-detail">
                  <span className="transcript__entity-label">Domain</span>
                  <span className="transcript__entity-value">
                    {entity.accountDomain}
                  </span>
                </div>
              )}
              {entity.accountIndustry && (
                <div className="transcript__entity-detail">
                  <span className="transcript__entity-label">Industry</span>
                  <span className="transcript__entity-value">
                    {entity.accountIndustry}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="transcript__entity-card transcript__entity-card--unresolved">
              <div className="transcript__entity-status">
                <span className="transcript__entity-dot transcript__entity-dot--unresolved" />
                <span>Unresolved</span>
              </div>
              <p className="transcript__entity-note">
                This call has not been matched to a CRM account.
              </p>
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}

// ─── Main Page Component ────────────────────────────────────────────────────

export function TranscriptViewerPage() {
  const { callId } = useParams<{ callId: string }>();

  const [data, setData] = useState<TranscriptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(-1);
  const [totalMatches, setTotalMatches] = useState(0);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const matchRefs = useRef<Map<number, HTMLElement>>(new Map());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    // Use requestAnimationFrame to ensure refs are populated after render
    requestAnimationFrame(() => {
      const el = matchRefs.current.get(activeMatchIndex);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }, [activeMatchIndex, debouncedQuery]);

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

  // ─── Keyboard Shortcuts ──────────────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ctrl/Cmd+F focuses search
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (totalMatches > 0) {
          if (e.shiftKey) {
            goToPrevMatch();
          } else {
            goToNextMatch();
          }
        }
      }
      if (e.key === "Escape") {
        setSearchQuery("");
        setDebouncedQuery("");
        searchInputRef.current?.blur();
      }
    },
    [totalMatches, goToPrevMatch, goToNextMatch],
  );

  // ─── Toggle Sidebar ──────────────────────────────────────────────────

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

  // ─── Render: Loading ──────────────────────────────────────────────────

  if (!callId) {
    return (
      <div className="transcript__error">
        No call ID provided.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="transcript__loading">
        <div className="transcript__loading-spinner" />
        <span>Loading transcript...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="transcript__error">
        <svg
          className="transcript__error-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          width="48"
          height="48"
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
      <div className={mainClasses}>
        {/* Header */}
        <div className="transcript__header">
          <div className="transcript__header-inner">
            <span className="transcript__header-title">
              {data.meta.title ?? "Transcript"}
            </span>

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

            <div className="transcript__search" role="search">
              <svg
                className="transcript__search-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={searchInputRef}
                className="transcript__search-input"
                type="text"
                placeholder="Search transcript..."
                autoComplete="off"
                spellCheck={false}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
              />
              <span className="transcript__search-count">
                {debouncedQuery.length >= 2
                  ? totalMatches > 0
                    ? `${activeMatchIndex + 1}/${totalMatches}`
                    : "0 results"
                  : ""}
              </span>
            </div>

            {totalMatches > 0 && (
              <div className="transcript__search-nav">
                <button
                  className="transcript__search-nav-btn"
                  onClick={goToPrevMatch}
                  aria-label="Previous match"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polyline points="18,15 12,9 6,15" />
                  </svg>
                </button>
                <button
                  className="transcript__search-nav-btn"
                  onClick={goToNextMatch}
                  aria-label="Next match"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polyline points="6,9 12,15 18,9" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Transcript Body */}
        <div className="transcript__body">
          {data.segments.length > 0 ? (
            data.segments.map((segment, i) => (
              <Segment
                key={segment.id}
                segment={segment}
                searchQuery={debouncedQuery}
                activeMatchIndex={activeMatchIndex}
                matchStartIndex={segmentMatchStarts[i] ?? 0}
                matchRefs={matchRefs}
              />
            ))
          ) : (
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
          )}
        </div>
      </div>

      {/* Sidebar */}
      <Sidebar
        meta={data.meta}
        participants={data.participants}
        entity={data.entity}
        collapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
      />

      {/* Scoped Styles */}
      <style>{transcriptStyles}</style>
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const transcriptStyles = `
/* ─── Layout ──────────────────────────────────────────────────── */
.transcript__layout {
  display: flex;
  min-height: 100vh;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #f8f9fb;
  color: #1a1a2e;
  font-size: 14px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

.transcript__main {
  flex: 1;
  min-width: 0;
  margin-right: 340px;
  transition: margin-right 0.3s ease;
}

.transcript__main--sidebar-collapsed {
  margin-right: 0;
}

/* ─── Loading & Error States ──────────────────────────────────── */
.transcript__loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  gap: 1rem;
  color: #555770;
}

.transcript__loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e5e7eb;
  border-top-color: #4f46e5;
  border-radius: 50%;
  animation: transcript-spin 0.8s linear infinite;
}

@keyframes transcript-spin {
  to { transform: rotate(360deg); }
}

.transcript__error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  gap: 0.5rem;
  color: #555770;
  text-align: center;
  padding: 2rem;
}

.transcript__error-icon {
  color: #dc2626;
  margin-bottom: 0.5rem;
}

.transcript__error-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: #1a1a2e;
}

.transcript__error-detail {
  font-size: 0.9rem;
  color: #8b8fa3;
}

/* ─── Header ──────────────────────────────────────────────────── */
.transcript__header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: #ffffff;
  border-bottom: 1px solid #e5e7eb;
  padding: 0 2rem;
}

.transcript__header-inner {
  display: flex;
  align-items: center;
  gap: 1rem;
  height: 64px;
}

.transcript__header-title {
  font-size: 1.1rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 400px;
}

.transcript__header-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  flex: 1;
  overflow: hidden;
  max-height: 2rem;
}

/* ─── Search Bar ──────────────────────────────────────────────── */
.transcript__search {
  position: relative;
  margin-left: auto;
  flex-shrink: 0;
}

.transcript__search-input {
  width: 260px;
  height: 36px;
  padding: 0 2.25rem;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  font-size: 0.85rem;
  font-family: inherit;
  background: #f8f9fb;
  color: #1a1a2e;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.transcript__search-input:focus {
  border-color: #4f46e5;
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
}

.transcript__search-icon {
  position: absolute;
  left: 0.65rem;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  color: #8b8fa3;
  pointer-events: none;
}

.transcript__search-count {
  position: absolute;
  right: 0.65rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.7rem;
  color: #8b8fa3;
  pointer-events: none;
}

.transcript__search-nav {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
}

.transcript__search-nav-btn {
  width: 28px;
  height: 28px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #ffffff;
  color: #555770;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.transcript__search-nav-btn:hover {
  background: #f8f9fb;
}

.transcript__search-nav-btn svg {
  width: 14px;
  height: 14px;
}

/* ─── Transcript Body ─────────────────────────────────────────── */
.transcript__body {
  padding: 1.5rem 2rem 4rem;
  max-width: 860px;
}

/* ─── Segment ─────────────────────────────────────────────────── */
.transcript__seg {
  display: flex;
  gap: 1rem;
  padding: 1rem 0;
  border-bottom: 1px solid #f0f1f3;
  scroll-margin-top: calc(64px + 1rem);
}

.transcript__seg:last-child {
  border-bottom: none;
}

.transcript__seg-gutter {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
  width: 52px;
}

.transcript__seg-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: 700;
  color: white;
  letter-spacing: 0.02em;
}

.transcript__seg-timestamp {
  font-size: 0.7rem;
  font-family: 'SF Mono', 'Fira Code', 'Fira Mono', Menlo, monospace;
  color: #8b8fa3;
  white-space: nowrap;
}

.transcript__seg-body {
  flex: 1;
  min-width: 0;
}

.transcript__seg-header {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 0.3rem;
}

.transcript__seg-speaker {
  font-weight: 600;
  font-size: 0.9rem;
  color: #1a1a2e;
}

.transcript__seg-duration {
  font-size: 0.7rem;
  color: #8b8fa3;
  font-family: 'SF Mono', 'Fira Code', 'Fira Mono', Menlo, monospace;
}

.transcript__seg-text {
  font-size: 0.9rem;
  line-height: 1.7;
  color: #1a1a2e;
  white-space: pre-wrap;
  word-break: break-word;
}

.transcript__seg-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: 0.5rem;
}

/* ─── Tag Pills ───────────────────────────────────────────────── */
.transcript__tag-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.55rem;
  border-radius: 100px;
  font-size: 0.7rem;
  font-weight: 600;
  border: 1px solid;
  cursor: default;
  white-space: nowrap;
}

.transcript__tag-pill--header {
  font-size: 0.65rem;
  padding: 0.1rem 0.45rem;
}

/* ─── Search Highlights ───────────────────────────────────────── */
.transcript__search-hit {
  background: #fef08a;
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
}

.transcript__search-hit--active {
  background: #fde047;
  outline: 2px solid #4f46e5;
  outline-offset: 1px;
}

/* ─── Sidebar ─────────────────────────────────────────────────── */
.transcript__sidebar {
  position: fixed;
  top: 0;
  right: 0;
  width: 340px;
  height: 100vh;
  background: #ffffff;
  border-left: 1px solid #e5e7eb;
  overflow-y: auto;
  z-index: 50;
  transition: transform 0.3s ease;
}

.transcript__sidebar--collapsed {
  transform: translateX(100%);
}

.transcript__sidebar-toggle {
  position: absolute;
  top: 1rem;
  left: -16px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
  transition: transform 0.3s;
}

.transcript__sidebar-toggle svg {
  width: 16px;
  height: 16px;
  color: #555770;
  transition: transform 0.3s;
}

.transcript__sidebar--collapsed .transcript__sidebar-toggle {
  left: -40px;
}

.transcript__sidebar--collapsed .transcript__sidebar-toggle svg {
  transform: rotate(180deg);
}

.transcript__sidebar-content {
  padding: 1.5rem;
}

.transcript__sidebar-section {
  margin-bottom: 1.75rem;
}

.transcript__sidebar-section:last-child {
  margin-bottom: 0;
}

.transcript__sidebar-heading {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #8b8fa3;
  margin-bottom: 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.transcript__sidebar-call-title {
  font-size: 1rem;
  font-weight: 600;
  color: #1a1a2e;
  margin-bottom: 0.75rem;
  line-height: 1.4;
}

.transcript__count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 100px;
  background: #eef2ff;
  color: #4f46e5;
  font-size: 0.65rem;
  font-weight: 700;
}

.transcript__recording-link {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
  font-weight: 500;
  color: #4f46e5;
  text-decoration: none;
  margin-bottom: 0.75rem;
}

.transcript__recording-link:hover {
  text-decoration: underline;
}

/* ─── Metadata Grid ───────────────────────────────────────────── */
.transcript__meta-grid {
  display: flex;
  flex-direction: column;
}

.transcript__meta-row {
  display: flex;
  justify-content: space-between;
  padding: 0.4rem 0;
  border-bottom: 1px solid #f0f1f3;
  font-size: 0.82rem;
}

.transcript__meta-row:last-child {
  border-bottom: none;
}

.transcript__meta-label {
  color: #8b8fa3;
  font-weight: 500;
}

.transcript__meta-value {
  color: #1a1a2e;
  font-weight: 500;
  text-align: right;
}

/* ─── Participants List ───────────────────────────────────────── */
.transcript__participants-list {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.transcript__participant {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.transcript__participant-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.6rem;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
}

.transcript__participant-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.transcript__participant-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: #1a1a2e;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.transcript__participant-subtitle {
  font-size: 0.72rem;
  color: #8b8fa3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transcript__host-badge {
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #4f46e5;
  background: #eef2ff;
  padding: 0.05rem 0.35rem;
  border-radius: 4px;
}

.transcript__sidebar-empty {
  font-size: 0.82rem;
  color: #8b8fa3;
  font-style: italic;
}

/* ─── Entity Card ─────────────────────────────────────────────── */
.transcript__entity-card {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 0.75rem;
}

.transcript__entity-card--resolved {
  border-color: #a7f3d0;
  background: #f0fdf4;
}

.transcript__entity-card--unresolved {
  border-color: #fecaca;
  background: #fef2f2;
}

.transcript__entity-status {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.transcript__entity-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.transcript__entity-dot--resolved {
  background: #059669;
}

.transcript__entity-dot--unresolved {
  background: #dc2626;
}

.transcript__entity-detail {
  display: flex;
  justify-content: space-between;
  padding: 0.25rem 0;
  font-size: 0.78rem;
}

.transcript__entity-label {
  color: #8b8fa3;
}

.transcript__entity-value {
  color: #1a1a2e;
  font-weight: 500;
}

.transcript__entity-note {
  font-size: 0.78rem;
  color: #8b8fa3;
}

/* ─── Empty State ─────────────────────────────────────────────── */
.transcript__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem 2rem;
  text-align: center;
}

.transcript__empty-icon {
  color: #8b8fa3;
  margin-bottom: 1rem;
}

.transcript__empty-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: #1a1a2e;
  margin-bottom: 0.3rem;
}

.transcript__empty-subtitle {
  font-size: 0.9rem;
  color: #8b8fa3;
}

/* ─── Responsive ──────────────────────────────────────────────── */
@media (max-width: 900px) {
  .transcript__sidebar {
    width: 280px;
  }
  .transcript__main {
    margin-right: 280px;
  }
  .transcript__main--sidebar-collapsed {
    margin-right: 0;
  }
}

@media (max-width: 700px) {
  .transcript__main {
    margin-right: 0;
  }
  .transcript__main--sidebar-collapsed {
    margin-right: 0;
  }
  .transcript__sidebar {
    width: 100vw;
    transform: translateX(100%);
  }
  .transcript__sidebar:not(.transcript__sidebar--collapsed) {
    transform: translateX(0);
  }
  .transcript__sidebar--collapsed {
    transform: translateX(100%);
  }
  .transcript__search-input {
    width: 160px;
  }
  .transcript__body {
    padding: 1rem;
  }
  .transcript__header {
    padding: 0 1rem;
  }
  .transcript__header-title {
    max-width: 200px;
  }
  .transcript__header-tags {
    display: none;
  }
}
`;
