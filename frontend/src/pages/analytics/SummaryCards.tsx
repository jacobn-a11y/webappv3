import type { AnalyticsData } from "../../lib/api";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatHours(h: number): string {
  return `${h.toFixed(1)}h`;
}

function formatPercent(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

// ─── SummaryCard ────────────────────────────────────────────────────────────

export function SummaryCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="analytics__summary-card">
      <div className="analytics__summary-icon">{icon}</div>
      <div className="analytics__summary-content">
        <span className="analytics__summary-value">{value}</span>
        <span className="analytics__summary-label">{title}</span>
      </div>
    </div>
  );
}

// ─── SummaryCards Grid ──────────────────────────────────────────────────────

export interface SummaryCardsProps {
  data: AnalyticsData;
  segment: string;
  segmentVolume: number;
  segmentSharePct: number | null;
}

export function SummaryCards({
  data,
  segment,
  segmentVolume,
  segmentSharePct,
}: SummaryCardsProps) {
  return (
    <div className="analytics__summary-grid">
      <SummaryCard
        title="Total Calls"
        value={formatNumber(data.summary.totalCalls)}
        icon={
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#336FE6" strokeWidth="2" aria-hidden="true">
            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
          </svg>
        }
      />
      <SummaryCard
        title="Accounts"
        value={formatNumber(data.summary.totalAccounts)}
        icon={
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2" aria-hidden="true">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
          </svg>
        }
      />
      <SummaryCard
        title="Transcript Hours"
        value={formatHours(data.summary.totalTranscriptHours)}
        icon={
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
        }
      />
      <SummaryCard
        title="Resolution Rate"
        value={formatPercent(data.summary.overallResolutionRate)}
        icon={
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" aria-hidden="true">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
            <path d="M22 4L12 14.01l-3-3" />
          </svg>
        }
      />
      <SummaryCard
        title="Quantified Quotes"
        value={formatNumber(data.summary.totalQuotes)}
        icon={
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" aria-hidden="true">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        }
      />
      <SummaryCard
        title="Page Views"
        value={formatNumber(data.summary.totalPageViews)}
        icon={
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        }
      />
      {segment !== "ALL" && (
        <SummaryCard
          title={`${segment} Calls`}
          value={`${formatNumber(segmentVolume)}${segmentSharePct != null ? ` (${segmentSharePct}%)` : ""}`}
          icon={
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#14B8A6" strokeWidth="2" aria-hidden="true">
              <path d="M3 12h18" />
              <path d="M3 6h18" />
              <path d="M3 18h18" />
            </svg>
          }
        />
      )}
    </div>
  );
}
