/**
 * Transcript Viewer
 *
 * Renders a full transcript page for a given callId with:
 *   - Speaker-attributed segments with timestamp markers
 *   - Inline taxonomy tag highlights (hover for topic + confidence)
 *   - Client-side search bar that highlights matching text
 *   - Sidebar with call metadata, participants, and entity resolution result
 *
 * Served at /api/calls/:callId/transcript (behind auth + trial gate).
 */

import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { TOPIC_LABELS, type TaxonomyTopic } from "../types/taxonomy.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface SegmentTag {
  funnelStage: string;
  topic: string;
  confidence: number;
}

interface TranscriptSegment {
  id: string;
  chunkIndex: number;
  speaker: string | null;
  text: string;
  startMs: number | null;
  endMs: number | null;
  tags: SegmentTag[];
}

interface ParticipantInfo {
  name: string | null;
  email: string | null;
  isHost: boolean;
  contactName: string | null;
  contactTitle: string | null;
}

interface EntityResolutionInfo {
  accountId: string | null;
  accountName: string | null;
  accountDomain: string | null;
  accountIndustry: string | null;
}

interface CallMetadata {
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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

/** Returns a CSS color for a funnel stage. */
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

/** Deterministic hash-based color for speaker avatars. */
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

  // Build the tag pills (shown below the text)
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

  // Entity resolution result
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

function renderTranscriptPage(
  meta: CallMetadata,
  segments: TranscriptSegment[],
  participants: ParticipantInfo[],
  entity: EntityResolutionInfo,
  callTags: SegmentTag[]
): string {
  const segmentsHtml = segments.map(renderSegment).join("");

  // Build call-level tag summary for the header
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
  <style>
    /* ─── Reset & Base ──────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --color-bg: #f8f9fb;
      --color-surface: #ffffff;
      --color-text: #1a1a2e;
      --color-text-secondary: #555770;
      --color-text-muted: #8b8fa3;
      --color-accent: #4f46e5;
      --color-accent-light: #eef2ff;
      --color-border: #e5e7eb;
      --color-border-light: #f0f1f3;
      --color-highlight: #fef08a;
      --color-highlight-active: #fde047;
      --sidebar-width: 340px;
      --header-height: 64px;
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --font-mono: 'SF Mono', 'Fira Code', 'Fira Mono', Menlo, monospace;
    }

    body {
      font-family: var(--font-sans);
      background: var(--color-bg);
      color: var(--color-text);
      line-height: 1.6;
      font-size: 14px;
      -webkit-font-smoothing: antialiased;
    }

    /* ─── Layout ─────────────────────────────────────────────────── */
    .layout {
      display: flex;
      min-height: 100vh;
    }

    .main {
      flex: 1;
      min-width: 0;
      margin-right: var(--sidebar-width);
      transition: margin-right 0.3s ease;
    }

    .main.sidebar-collapsed {
      margin-right: 0;
    }

    /* ─── Header ─────────────────────────────────────────────────── */
    .header {
      position: sticky;
      top: 0;
      z-index: 100;
      background: var(--color-surface);
      border-bottom: 1px solid var(--color-border);
      padding: 0 2rem;
    }

    .header__inner {
      display: flex;
      align-items: center;
      gap: 1rem;
      height: var(--header-height);
    }

    .header__title {
      font-size: 1.1rem;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 400px;
    }

    .header__tags {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      flex: 1;
      overflow: hidden;
      max-height: 2rem;
    }

    /* ─── Search Bar ─────────────────────────────────────────────── */
    .search {
      position: relative;
      margin-left: auto;
      flex-shrink: 0;
    }

    .search__input {
      width: 260px;
      height: 36px;
      padding: 0 2.25rem 0 2.25rem;
      border: 1px solid var(--color-border);
      border-radius: 8px;
      font-size: 0.85rem;
      font-family: var(--font-sans);
      background: var(--color-bg);
      color: var(--color-text);
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }

    .search__input:focus {
      border-color: var(--color-accent);
      box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
    }

    .search__icon {
      position: absolute;
      left: 0.65rem;
      top: 50%;
      transform: translateY(-50%);
      width: 16px;
      height: 16px;
      color: var(--color-text-muted);
      pointer-events: none;
    }

    .search__count {
      position: absolute;
      right: 0.65rem;
      top: 50%;
      transform: translateY(-50%);
      font-size: 0.7rem;
      color: var(--color-text-muted);
      pointer-events: none;
    }

    .search__nav {
      display: none;
      align-items: center;
      gap: 0.25rem;
      margin-left: 0.5rem;
    }

    .search__nav.active { display: flex; }

    .search__nav-btn {
      width: 28px;
      height: 28px;
      border: 1px solid var(--color-border);
      border-radius: 6px;
      background: var(--color-surface);
      color: var(--color-text-secondary);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }

    .search__nav-btn:hover { background: var(--color-bg); }

    .search__nav-btn svg { width: 14px; height: 14px; }

    /* ─── Transcript Body ────────────────────────────────────────── */
    .transcript {
      padding: 1.5rem 2rem 4rem;
      max-width: 860px;
    }

    /* ─── Segment ────────────────────────────────────────────────── */
    .seg {
      display: flex;
      gap: 1rem;
      padding: 1rem 0;
      border-bottom: 1px solid var(--color-border-light);
      scroll-margin-top: calc(var(--header-height) + 1rem);
    }

    .seg:last-child { border-bottom: none; }

    .seg__gutter {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.35rem;
      flex-shrink: 0;
      width: 52px;
    }

    .seg__avatar {
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

    .seg__timestamp {
      font-size: 0.7rem;
      font-family: var(--font-mono);
      color: var(--color-text-muted);
      white-space: nowrap;
    }

    .seg__body {
      flex: 1;
      min-width: 0;
    }

    .seg__header {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      margin-bottom: 0.3rem;
    }

    .seg__speaker {
      font-weight: 600;
      font-size: 0.9rem;
      color: var(--color-text);
    }

    .seg__duration {
      font-size: 0.7rem;
      color: var(--color-text-muted);
      font-family: var(--font-mono);
    }

    .seg__text {
      font-size: 0.9rem;
      line-height: 1.7;
      color: var(--color-text);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .seg__tags {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
      margin-top: 0.5rem;
    }

    /* ─── Tag Pills ──────────────────────────────────────────────── */
    .tag-pill {
      display: inline-flex;
      align-items: center;
      padding: 0.15rem 0.55rem;
      border-radius: 100px;
      font-size: 0.7rem;
      font-weight: 600;
      border: 1px solid;
      cursor: default;
      position: relative;
      white-space: nowrap;
    }

    .tag-pill--header {
      font-size: 0.65rem;
      padding: 0.1rem 0.45rem;
    }

    .tag-pill[data-tooltip]:hover::after {
      content: attr(data-tooltip);
      position: absolute;
      bottom: calc(100% + 6px);
      left: 50%;
      transform: translateX(-50%);
      background: var(--color-text);
      color: white;
      padding: 0.4rem 0.65rem;
      border-radius: 6px;
      font-size: 0.72rem;
      font-weight: 400;
      white-space: nowrap;
      z-index: 1000;
      pointer-events: none;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }

    .tag-pill[data-tooltip]:hover::before {
      content: '';
      position: absolute;
      bottom: calc(100% + 2px);
      left: 50%;
      transform: translateX(-50%);
      border: 4px solid transparent;
      border-top-color: var(--color-text);
      z-index: 1000;
    }

    /* ─── Search Highlights ──────────────────────────────────────── */
    mark.search-hit {
      background: var(--color-highlight);
      color: inherit;
      border-radius: 2px;
      padding: 0 1px;
    }

    mark.search-hit.active {
      background: var(--color-highlight-active);
      outline: 2px solid var(--color-accent);
      outline-offset: 1px;
    }

    /* ─── Sidebar ────────────────────────────────────────────────── */
    .sidebar {
      position: fixed;
      top: 0;
      right: 0;
      width: var(--sidebar-width);
      height: 100vh;
      background: var(--color-surface);
      border-left: 1px solid var(--color-border);
      overflow-y: auto;
      z-index: 50;
      transition: transform 0.3s ease;
    }

    .sidebar.collapsed {
      transform: translateX(100%);
    }

    .sidebar__toggle {
      position: absolute;
      top: 1rem;
      left: -16px;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10;
      box-shadow: 0 2px 6px rgba(0,0,0,0.08);
      transition: transform 0.3s;
    }

    .sidebar__toggle svg {
      width: 16px;
      height: 16px;
      color: var(--color-text-secondary);
      transition: transform 0.3s;
    }

    .sidebar.collapsed .sidebar__toggle { left: -40px; }
    .sidebar.collapsed .sidebar__toggle svg { transform: rotate(180deg); }

    .sidebar__content {
      padding: 1.5rem;
    }

    .sidebar__section {
      margin-bottom: 1.75rem;
    }

    .sidebar__section:last-child { margin-bottom: 0; }

    .sidebar__heading {
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--color-text-muted);
      margin-bottom: 0.75rem;
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }

    .sidebar__call-title {
      font-size: 1rem;
      font-weight: 600;
      color: var(--color-text);
      margin-bottom: 0.75rem;
      line-height: 1.4;
    }

    .count-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 100px;
      background: var(--color-accent-light);
      color: var(--color-accent);
      font-size: 0.65rem;
      font-weight: 700;
    }

    .recording-link {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--color-accent);
      text-decoration: none;
      margin-bottom: 0.75rem;
    }

    .recording-link:hover { text-decoration: underline; }

    /* ─── Metadata Grid ──────────────────────────────────────────── */
    .meta-grid {
      display: flex;
      flex-direction: column;
      gap: 0;
    }

    .meta-row {
      display: flex;
      justify-content: space-between;
      padding: 0.4rem 0;
      border-bottom: 1px solid var(--color-border-light);
      font-size: 0.82rem;
    }

    .meta-row:last-child { border-bottom: none; }

    .meta-label {
      color: var(--color-text-muted);
      font-weight: 500;
    }

    .meta-value {
      color: var(--color-text);
      font-weight: 500;
      text-align: right;
    }

    /* ─── Participants List ───────────────────────────────────────── */
    .participants-list {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }

    .participant {
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }

    .participant__avatar {
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

    .participant__info {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .participant__name {
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--color-text);
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }

    .participant__subtitle {
      font-size: 0.72rem;
      color: var(--color-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .host-badge {
      font-size: 0.6rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-accent);
      background: var(--color-accent-light);
      padding: 0.05rem 0.35rem;
      border-radius: 4px;
    }

    .sidebar__empty {
      font-size: 0.82rem;
      color: var(--color-text-muted);
      font-style: italic;
    }

    /* ─── Entity Card ────────────────────────────────────────────── */
    .entity-card {
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 0.75rem;
    }

    .entity-card--resolved { border-color: #a7f3d0; background: #f0fdf4; }
    .entity-card--unresolved { border-color: #fecaca; background: #fef2f2; }

    .entity-status {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.78rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }

    .entity-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .entity-dot--resolved { background: #059669; }
    .entity-dot--unresolved { background: #dc2626; }

    .entity-detail {
      display: flex;
      justify-content: space-between;
      padding: 0.25rem 0;
      font-size: 0.78rem;
    }

    .entity-label { color: var(--color-text-muted); }
    .entity-value { color: var(--color-text); font-weight: 500; }

    .entity-note {
      font-size: 0.78rem;
      color: var(--color-text-muted);
    }

    /* ─── Empty / Error States ───────────────────────────────────── */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 4rem 2rem;
      text-align: center;
    }

    .empty-state__icon {
      width: 48px;
      height: 48px;
      color: var(--color-text-muted);
      margin-bottom: 1rem;
    }

    .empty-state__title {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--color-text);
      margin-bottom: 0.3rem;
    }

    .empty-state__subtitle {
      font-size: 0.9rem;
      color: var(--color-text-muted);
    }

    /* ─── Responsive ─────────────────────────────────────────────── */
    @media (max-width: 900px) {
      :root { --sidebar-width: 280px; }
    }

    @media (max-width: 700px) {
      :root { --sidebar-width: 100vw; }
      .main { margin-right: 0; }
      .sidebar { transform: translateX(100%); }
      .sidebar.mobile-open { transform: translateX(0); }
      .sidebar__toggle { display: flex; }
      .search__input { width: 160px; }
      .transcript { padding: 1rem; }
    }
  </style>
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

  <script>
  (function() {
    'use strict';

    // ─── Sidebar Toggle ────────────────────────────────────────
    var sidebar = document.getElementById('sidebar');
    var main = document.getElementById('main');
    var toggle = document.getElementById('sidebar-toggle');

    toggle.addEventListener('click', function() {
      var isMobile = window.innerWidth <= 700;
      if (isMobile) {
        sidebar.classList.toggle('mobile-open');
      } else {
        sidebar.classList.toggle('collapsed');
        main.classList.toggle('sidebar-collapsed');
      }
    });

    // ─── Search ────────────────────────────────────────────────
    var searchInput = document.getElementById('search-input');
    var searchCount = document.getElementById('search-count');
    var searchNav = document.getElementById('search-nav');
    var prevBtn = document.getElementById('search-prev');
    var nextBtn = document.getElementById('search-next');
    var textEls = document.querySelectorAll('.seg__text');
    var originalTexts = [];
    var currentMatches = [];
    var currentIndex = -1;

    // Store original text content
    for (var i = 0; i < textEls.length; i++) {
      originalTexts.push(textEls[i].textContent);
    }

    function escapeRegex(str) {
      return str.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
    }

    function clearHighlights() {
      for (var i = 0; i < textEls.length; i++) {
        textEls[i].textContent = originalTexts[i];
      }
      currentMatches = [];
      currentIndex = -1;
      searchCount.textContent = '';
      searchNav.classList.remove('active');
    }

    function performSearch(query) {
      clearHighlights();
      if (!query || query.length < 2) return;

      var regex = new RegExp('(' + escapeRegex(query) + ')', 'gi');
      var matchId = 0;

      for (var i = 0; i < textEls.length; i++) {
        var text = originalTexts[i];
        if (regex.test(text)) {
          regex.lastIndex = 0;
          var html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          var safeRegex = new RegExp('(' + escapeRegex(query).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + ')', 'gi');
          html = html.replace(safeRegex, function(match) {
            return '<mark class="search-hit" data-match-id="' + (matchId++) + '">' + match + '</mark>';
          });
          textEls[i].innerHTML = html;
        }
      }

      currentMatches = document.querySelectorAll('mark.search-hit');
      if (currentMatches.length > 0) {
        searchNav.classList.add('active');
        currentIndex = 0;
        activateMatch(0);
        searchCount.textContent = '1/' + currentMatches.length;
      } else {
        searchCount.textContent = '0 results';
      }
    }

    function activateMatch(index) {
      // Deactivate all
      for (var i = 0; i < currentMatches.length; i++) {
        currentMatches[i].classList.remove('active');
      }
      if (index >= 0 && index < currentMatches.length) {
        currentMatches[index].classList.add('active');
        currentMatches[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
        searchCount.textContent = (index + 1) + '/' + currentMatches.length;
      }
    }

    var debounceTimer;
    searchInput.addEventListener('input', function() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function() {
        performSearch(searchInput.value.trim());
      }, 200);
    });

    searchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (currentMatches.length > 0) {
          if (e.shiftKey) {
            currentIndex = (currentIndex - 1 + currentMatches.length) % currentMatches.length;
          } else {
            currentIndex = (currentIndex + 1) % currentMatches.length;
          }
          activateMatch(currentIndex);
        }
      }
      if (e.key === 'Escape') {
        searchInput.value = '';
        clearHighlights();
        searchInput.blur();
      }
    });

    prevBtn.addEventListener('click', function() {
      if (currentMatches.length > 0) {
        currentIndex = (currentIndex - 1 + currentMatches.length) % currentMatches.length;
        activateMatch(currentIndex);
      }
    });

    nextBtn.addEventListener('click', function() {
      if (currentMatches.length > 0) {
        currentIndex = (currentIndex + 1) % currentMatches.length;
        activateMatch(currentIndex);
      }
    });

    // Keyboard shortcut: Ctrl/Cmd + F focuses search
    document.addEventListener('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
    });
  })();
  </script>
</body>
</html>`;
}

// ─── Route Factory ──────────────────────────────────────────────────────────

export function createTranscriptViewerRoutes(prisma: PrismaClient): Router {
  const router = Router();

  /**
   * GET /api/calls/:callId/transcript
   *
   * Renders the Transcript Viewer page for the given call.
   * Requires authentication (organizationId on request).
   */
  router.get("/:callId/transcript", async (req: Request, res: Response) => {
    const organizationId = (req as unknown as Record<string, unknown>)
      .organizationId as string;
    if (!organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const callId = req.params.callId as string;

    // Fetch call with all related data
    const call = await prisma.call.findFirst({
      where: {
        id: callId,
        organizationId,
      },
      include: {
        account: true,
        transcript: {
          include: {
            chunks: {
              include: {
                tags: true,
              },
              orderBy: { chunkIndex: "asc" },
            },
          },
        },
        participants: {
          include: {
            contact: true,
          },
        },
        tags: {
          orderBy: { confidence: "desc" },
        },
      },
    });

    if (!call) {
      res.status(404).json({ error: "Call not found" });
      return;
    }

    // Build metadata
    const meta: CallMetadata = {
      id: call.id,
      title: call.title,
      provider: call.provider,
      duration: call.duration,
      occurredAt: call.occurredAt.toISOString(),
      recordingUrl: call.recordingUrl,
      language: call.transcript?.language ?? "en",
      wordCount: call.transcript?.wordCount ?? 0,
    };

    // Build segments from transcript chunks
    const segments: TranscriptSegment[] = (call.transcript?.chunks ?? []).map(
      (chunk: { id: string; chunkIndex: number; speaker: string | null; text: string; startMs: number | null; endMs: number | null; tags: Array<{ funnelStage: string; topic: string; confidence: number }> }) => ({
        id: chunk.id,
        chunkIndex: chunk.chunkIndex,
        speaker: chunk.speaker,
        text: chunk.text,
        startMs: chunk.startMs,
        endMs: chunk.endMs,
        tags: chunk.tags.map((t: { funnelStage: string; topic: string; confidence: number }) => ({
          funnelStage: t.funnelStage,
          topic: t.topic,
          confidence: t.confidence,
        })),
      })
    );

    // Build participant list
    const participants: ParticipantInfo[] = call.participants.map((p: { name: string | null; email: string | null; isHost: boolean; contact: { name: string | null; title: string | null } | null }) => ({
      name: p.name,
      email: p.email,
      isHost: p.isHost,
      contactName: p.contact?.name ?? null,
      contactTitle: p.contact?.title ?? null,
    }));

    // Build entity resolution info
    const entity: EntityResolutionInfo = {
      accountId: call.account?.id ?? null,
      accountName: call.account?.name ?? null,
      accountDomain: call.account?.domain ?? null,
      accountIndustry: call.account?.industry ?? null,
    };

    // Build call-level tags
    const callTags: SegmentTag[] = call.tags.map((t: { funnelStage: string; topic: string; confidence: number }) => ({
      funnelStage: t.funnelStage,
      topic: t.topic,
      confidence: t.confidence,
    }));

    res.setHeader("Cache-Control", "private, no-cache");
    res.send(renderTranscriptPage(meta, segments, participants, entity, callTags));
  });

  return router;
}
