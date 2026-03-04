/**
 * Transcript Viewer — HTML Template & Helpers
 *
 * Renders a full transcript page for a given callId with:
 *   - Speaker-attributed segments with timestamp markers
 *   - Inline taxonomy tag highlights (hover for topic + confidence)
 *   - Client-side search bar that highlights matching text
 *   - Sidebar with call metadata, participants, and entity resolution result
 */

import { TOPIC_LABELS, type TaxonomyTopic } from "../../types/taxonomy.js";
import { escapeHtml } from "../../lib/html-utils.js";
import { getTranscriptViewerStyles } from "./transcript-viewer-styles.js";
import { getTranscriptViewerScripts } from "./transcript-viewer-scripts.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SegmentTag {
  funnelStage: string;
  topic: string;
  confidence: number;
}

export interface TranscriptSegment {
  id: string;
  chunkIndex: number;
  speaker: string | null;
  text: string;
  startMs: number | null;
  endMs: number | null;
  tags: SegmentTag[];
}

export interface ParticipantInfo {
  name: string | null;
  email: string | null;
  isHost: boolean;
  contactName: string | null;
  contactTitle: string | null;
}

export interface EntityResolutionInfo {
  accountId: string | null;
  accountName: string | null;
  accountDomain: string | null;
  accountIndustry: string | null;
}

export interface CallMetadata {
  id: string;
  title: string | null;
  provider: string;
  duration: number | null;
  occurredAt: string;
  recordingUrl: string | null;
  language: string;
  wordCount: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  return parts.join(" ");
}

function formatProvider(provider: string): string {
  const labels: Record<string, string> = {
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
  return labels[provider] ?? provider;
}

function stageColor(stage: string): string {
  const colors: Record<string, string> = {
    TOFU: "#2563eb",
    MOFU: "#7c3aed",
    BOFU: "#059669",
    POST_SALE: "#d97706",
    INTERNAL: "#6b7280",
    VERTICAL: "#dc2626",
  };
  return colors[stage] ?? "#6b7280";
}

function stageBgColor(stage: string): string {
  const colors: Record<string, string> = {
    TOFU: "#eff6ff",
    MOFU: "#f5f3ff",
    BOFU: "#ecfdf5",
    POST_SALE: "#fffbeb",
    INTERNAL: "#f3f4f6",
    VERTICAL: "#fef2f2",
  };
  return colors[stage] ?? "#f3f4f6";
}

function stageLabel(stage: string): string {
  const labels: Record<string, string> = {
    TOFU: "Top of Funnel",
    MOFU: "Mid-Funnel",
    BOFU: "Bottom of Funnel",
    POST_SALE: "Post-Sale",
    INTERNAL: "Internal",
    VERTICAL: "Vertical",
  };
  return labels[stage] ?? stage;
}

function topicLabel(topic: string): string {
  return (
    TOPIC_LABELS[topic as TaxonomyTopic] ??
    topic.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function speakerInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
}

function speakerColor(name: string): string {
  const palette = [
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
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) & 0x7fffffff;
  }
  return palette[hash % palette.length];
}

// ─── Segment HTML Renderer ──────────────────────────────────────────────────

function renderSegment(segment: TranscriptSegment): string {
  const speaker = segment.speaker ?? "Unknown Speaker";
  const color = speakerColor(speaker);
  const initials = speakerInitials(speaker);

  const timestampHtml =
    segment.startMs != null
      ? `<span class="seg__timestamp" data-ms="${segment.startMs}">${formatMs(segment.startMs)}</span>`
      : "";

  const tagPillsHtml =
    segment.tags.length > 0
      ? `<div class="seg__tags">${segment.tags
          .map(
            (t) =>
              `<span class="tag-pill" style="background:${stageBgColor(t.funnelStage)};color:${stageColor(t.funnelStage)};border-color:${stageColor(t.funnelStage)}20" data-tooltip="${escapeHtml(topicLabel(t.topic))} (${stageLabel(t.funnelStage)}) &mdash; ${Math.round(t.confidence * 100)}% confidence">${escapeHtml(topicLabel(t.topic))}</span>`
          )
          .join("")}</div>`
      : "";

  return `
    <div class="seg" data-speaker="${escapeHtml(speaker)}" data-chunk-id="${escapeHtml(segment.id)}">
      <div class="seg__gutter">
        <div class="seg__avatar" style="background:${color}">${escapeHtml(initials)}</div>
        ${timestampHtml}
      </div>
      <div class="seg__body">
        <div class="seg__header">
          <span class="seg__speaker">${escapeHtml(speaker)}</span>
          ${segment.endMs != null && segment.startMs != null ? `<span class="seg__duration">${formatMs(segment.endMs - segment.startMs)}</span>` : ""}
        </div>
        <div class="seg__text">${escapeHtml(segment.text)}</div>
        ${tagPillsHtml}
      </div>
    </div>`;
}

// ─── Sidebar HTML ───────────────────────────────────────────────────────────

function renderSidebar(
  meta: CallMetadata,
  participants: ParticipantInfo[],
  entity: EntityResolutionInfo
): string {
  const metaRows = [
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
    ...(meta.duration != null
      ? [{ label: "Duration", value: formatDuration(meta.duration) }]
      : []),
    { label: "Language", value: meta.language.toUpperCase() },
    { label: "Word Count", value: meta.wordCount.toLocaleString() },
  ];

  const metaHtml = metaRows
    .map(
      (r) =>
        `<div class="meta-row"><span class="meta-label">${escapeHtml(r.label)}</span><span class="meta-value">${escapeHtml(String(r.value))}</span></div>`
    )
    .join("");

  const participantsHtml =
    participants.length > 0
      ? participants
          .map((p) => {
            const displayName = p.contactName ?? p.name ?? p.email ?? "Unknown";
            const subtitle = p.contactTitle
              ? escapeHtml(p.contactTitle)
              : p.email
                ? escapeHtml(p.email)
                : "";
            const hostBadge = p.isHost
              ? '<span class="host-badge">Host</span>'
              : "";
            const color = speakerColor(displayName);
            const initials = speakerInitials(displayName);
            return `
            <div class="participant">
              <div class="participant__avatar" style="background:${color}">${escapeHtml(initials)}</div>
              <div class="participant__info">
                <span class="participant__name">${escapeHtml(displayName)} ${hostBadge}</span>
                ${subtitle ? `<span class="participant__subtitle">${subtitle}</span>` : ""}
              </div>
            </div>`;
          })
          .join("")
      : '<p class="sidebar__empty">No participants recorded</p>';

  let entityHtml: string;
  if (entity.accountId) {
    const confidence = entity.accountName ? "Resolved" : "Partial";
    entityHtml = `
      <div class="entity-card entity-card--resolved">
        <div class="entity-status">
          <span class="entity-dot entity-dot--resolved"></span>
          <span>${confidence}</span>
        </div>
        <div class="entity-detail">
          <span class="entity-label">Account</span>
          <span class="entity-value">${escapeHtml(entity.accountName ?? "—")}</span>
        </div>
        ${entity.accountDomain ? `<div class="entity-detail"><span class="entity-label">Domain</span><span class="entity-value">${escapeHtml(entity.accountDomain)}</span></div>` : ""}
        ${entity.accountIndustry ? `<div class="entity-detail"><span class="entity-label">Industry</span><span class="entity-value">${escapeHtml(entity.accountIndustry)}</span></div>` : ""}
      </div>`;
  } else {
    entityHtml = `
      <div class="entity-card entity-card--unresolved">
        <div class="entity-status">
          <span class="entity-dot entity-dot--unresolved"></span>
          <span>Unresolved</span>
        </div>
        <p class="entity-note">This call has not been matched to a CRM account.</p>
      </div>`;
  }

  return `
  <aside class="sidebar" id="sidebar">
    <button class="sidebar__toggle" id="sidebar-toggle" aria-label="Toggle sidebar">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
    </button>

    <div class="sidebar__content">
      <section class="sidebar__section">
        <h3 class="sidebar__heading">Call Details</h3>
        ${meta.title ? `<h4 class="sidebar__call-title">${escapeHtml(meta.title)}</h4>` : ""}
        ${meta.recordingUrl ? `<a href="${escapeHtml(meta.recordingUrl)}" target="_blank" rel="noopener" class="recording-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polygon points="5,3 19,12 5,21"/></svg> Play Recording</a>` : ""}
        <div class="meta-grid">${metaHtml}</div>
      </section>

      <section class="sidebar__section">
        <h3 class="sidebar__heading">Participants <span class="count-badge">${participants.length}</span></h3>
        <div class="participants-list">${participantsHtml}</div>
      </section>

      <section class="sidebar__section">
        <h3 class="sidebar__heading">Entity Resolution</h3>
        ${entityHtml}
      </section>
    </div>
  </aside>`;
}

// ─── Full Page HTML ─────────────────────────────────────────────────────────

export function renderTranscriptPage(
  meta: CallMetadata,
  segments: TranscriptSegment[],
  participants: ParticipantInfo[],
  entity: EntityResolutionInfo,
  callTags: SegmentTag[]
): string {
  const segmentsHtml = segments.map(renderSegment).join("");

  const callTagsHtml =
    callTags.length > 0
      ? callTags
          .map(
            (t) =>
              `<span class="tag-pill tag-pill--header" style="background:${stageBgColor(t.funnelStage)};color:${stageColor(t.funnelStage)};border-color:${stageColor(t.funnelStage)}20" data-tooltip="${escapeHtml(topicLabel(t.topic))} (${stageLabel(t.funnelStage)}) &mdash; ${Math.round(t.confidence * 100)}% confidence">${escapeHtml(topicLabel(t.topic))}</span>`
          )
          .join("")
      : "";

  const sidebarHtml = renderSidebar(meta, participants, entity);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>Transcript${meta.title ? ` — ${escapeHtml(meta.title)}` : ""}</title>
  <style>${getTranscriptViewerStyles()}</style>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body>
  <div class="layout">
    <div class="main" id="main">
      <!-- Header with search -->
      <div class="header">
        <div class="header__inner">
          <span class="header__title">${escapeHtml(meta.title ?? "Transcript")}</span>
          <div class="header__tags">${callTagsHtml}</div>
          <div class="search" role="search">
            <svg class="search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              class="search__input"
              id="search-input"
              type="text"
              placeholder="Search transcript..."
              autocomplete="off"
              spellcheck="false"
            />
            <span class="search__count" id="search-count"></span>
          </div>
          <div class="search__nav" id="search-nav">
            <button class="search__nav-btn" id="search-prev" aria-label="Previous match">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18,15 12,9 6,15"/></svg>
            </button>
            <button class="search__nav-btn" id="search-next" aria-label="Next match">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6,9 12,15 18,9"/></svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Transcript segments -->
      <div class="transcript" id="transcript">
        ${segments.length > 0 ? segmentsHtml : `
          <div class="empty-state">
            <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2z"/>
              <path d="M7 7h10M7 12h10M7 17h6"/>
            </svg>
            <p class="empty-state__title">No transcript segments</p>
            <p class="empty-state__subtitle">This call hasn't been transcribed yet.</p>
          </div>
        `}
      </div>
    </div>

    <!-- Sidebar -->
    ${sidebarHtml}
  </div>

  <script>${getTranscriptViewerScripts()}</script>
</body>
</html>`;
}
