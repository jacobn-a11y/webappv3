/**
 * TranscriptSidebar — Call details, participants list, and entity resolution card.
 */

import { useMemo } from "react";
import type { TranscriptData } from "../../lib/api";
import { speakerColor, speakerInitials } from "./TranscriptBody";

// ─── Constants ──────────────────────────────────────────────────────────────

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

function formatProvider(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
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

// ─── TranscriptSidebar Component ────────────────────────────────────────────

export interface TranscriptSidebarProps {
  meta: TranscriptData["meta"];
  participants: TranscriptData["participants"];
  entity: TranscriptData["entity"];
  collapsed: boolean;
  onToggle: () => void;
}

export function TranscriptSidebar({
  meta,
  participants,
  entity,
  collapsed,
  onToggle,
}: TranscriptSidebarProps) {
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
