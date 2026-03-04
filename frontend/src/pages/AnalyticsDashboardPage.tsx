/**
 * AnalyticsDashboardPage — Layout shell, filter state, data fetching.
 * Sub-components decomposed into ./analytics/
 */

import { useState, useEffect } from "react";
import {
  getAnalyticsData,
  getRevOpsKpis,
  type AnalyticsData,
  type RevOpsKpiData,
} from "../lib/api";
import { SummaryCards } from "./analytics/SummaryCards";
import { RevOpsKPIs } from "./analytics/RevOpsKPIs";
import {
  CallsPerWeekChart,
  FunnelDonutChart,
  TopAccountsChart,
  ResolutionChart,
  PageViewsChart,
  TaxonomyTreemap,
  QuoteLeaderboardTable,
  TopPagesTable,
} from "./analytics/AnalyticsCharts";

// Re-export sub-components for backward compatibility
export { SummaryCards, SummaryCard } from "./analytics/SummaryCards";
export type { SummaryCardsProps } from "./analytics/SummaryCards";
export { RevOpsKPIs } from "./analytics/RevOpsKPIs";
export type { RevOpsKPIsProps } from "./analytics/RevOpsKPIs";
export {
  CallsPerWeekChart,
  FunnelDonutChart,
  TopAccountsChart,
  ResolutionChart,
  PageViewsChart,
  TaxonomyTreemap,
  QuoteLeaderboardTable,
  TopPagesTable,
} from "./analytics/AnalyticsCharts";

// ─── Filter Options ─────────────────────────────────────────────────────────

const SEGMENT_OPTIONS = [
  { value: "ALL", label: "All Segments" },
  { value: "Top of Funnel", label: "Top of Funnel" },
  { value: "Mid-Funnel", label: "Mid-Funnel" },
  { value: "Bottom of Funnel", label: "Bottom of Funnel" },
  { value: "Post-Sale", label: "Post-Sale" },
] as const;

const FOCUS_OPTIONS = [
  { value: "ALL", label: "All Metrics" },
  { value: "PIPELINE", label: "Pipeline Focus" },
  { value: "CONTENT", label: "Content Focus" },
  { value: "ADOPTION", label: "Adoption Focus" },
] as const;

type SegmentValue = (typeof SEGMENT_OPTIONS)[number]["value"];
type FocusValue = (typeof FOCUS_OPTIONS)[number]["value"];

interface SavedAnalyticsView {
  id: string;
  name: string;
  segment: SegmentValue;
  focus: FocusValue;
}

const SAVED_ANALYTICS_VIEWS_KEY = "storyengine.analytics.savedViews.v1";

function loadSavedAnalyticsViews(): SavedAnalyticsView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SAVED_ANALYTICS_VIEWS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedAnalyticsView[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (view) =>
        typeof view.id === "string" &&
        typeof view.name === "string" &&
        SEGMENT_OPTIONS.some((s) => s.value === view.segment) &&
        FOCUS_OPTIONS.some((f) => f.value === view.focus)
    );
  } catch {
    return [];
  }
}

function persistSavedAnalyticsViews(views: SavedAnalyticsView[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SAVED_ANALYTICS_VIEWS_KEY, JSON.stringify(views));
}

// ─── Component ──────────────────────────────────────────────────────────────

export function AnalyticsDashboardPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [kpis, setKpis] = useState<RevOpsKpiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [segment, setSegment] = useState<SegmentValue>("ALL");
  const [focus, setFocus] = useState<FocusValue>("ALL");
  const [savedViews, setSavedViews] = useState<SavedAnalyticsView[]>([]);

  useEffect(() => {
    setSavedViews(loadSavedAnalyticsViews());
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([getAnalyticsData(), getRevOpsKpis()])
      .then(([analyticsRes, kpiRes]) => {
        setData(analyticsRes);
        setKpis(kpiRes);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load analytics");
      })
      .finally(() => setLoading(false));
  }, []);

  // ── Derived state ───────────────────────────────────────────────────────

  const segmentTopics =
    data && segment !== "ALL"
      ? data.topTopics.filter((topic) => topic.funnelStage === segment)
      : data?.topTopics ?? [];
  const segmentVolume = data?.funnelDistribution.find((item) => item.stage === segment)?.count ?? 0;
  const segmentTotal = data?.funnelDistribution.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const segmentSharePct =
    segment !== "ALL" && segmentTotal > 0
      ? Math.round((segmentVolume / segmentTotal) * 100)
      : null;

  const showPipelineSections = focus === "ALL" || focus === "PIPELINE";
  const showContentSections = focus === "ALL" || focus === "CONTENT";
  const showAdoptionSections = focus === "ALL" || focus === "ADOPTION";

  // ── Saved view handlers ─────────────────────────────────────────────────

  const saveCurrentView = () => {
    const name = window.prompt("Saved view name");
    if (!name || !name.trim()) return;
    const next: SavedAnalyticsView[] = [
      { id: `${Date.now()}`, name: name.trim(), segment, focus },
      ...savedViews,
    ].slice(0, 10);
    setSavedViews(next);
    persistSavedAnalyticsViews(next);
  };

  const applySavedView = (viewId: string) => {
    const view = savedViews.find((item) => item.id === viewId);
    if (!view) return;
    setSegment(view.segment);
    setFocus(view.focus);
  };

  const deleteSavedView = (viewId: string) => {
    const next = savedViews.filter((view) => view.id !== viewId);
    setSavedViews(next);
    persistSavedAnalyticsViews(next);
  };

  // ── Loading / Error ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="analytics__loading" role="status" aria-live="polite">
        <div className="analytics__spinner" aria-hidden="true" />
        <p>Loading analytics data...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="analytics__error" role="alert">
        <p>Error: {error ?? "No data available"}</p>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="analytics__container">
      {/* Header */}
      <header className="analytics__header">
        <h1 className="analytics__title">Analytics Dashboard</h1>
        <p className="analytics__subtitle">
          Org-wide metrics and performance insights
        </p>
      </header>

      <div className="analytics__view-controls">
        <select
          className="form-input"
          value={segment}
          onChange={(event) => setSegment(event.target.value as SegmentValue)}
          aria-label="Filter analytics by funnel segment"
        >
          {SEGMENT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          className="form-input"
          value={focus}
          onChange={(event) => setFocus(event.target.value as FocusValue)}
          aria-label="Choose analytics focus"
        >
          {FOCUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn--secondary btn--sm" onClick={saveCurrentView}>
          Save View
        </button>
        {savedViews.length > 0 && (
          <select
            className="form-input"
            value=""
            onChange={(event) => {
              if (event.target.value) applySavedView(event.target.value);
            }}
            aria-label="Load saved analytics view"
          >
            <option value="">Load Saved View…</option>
            {savedViews.map((view) => (
              <option key={view.id} value={view.id}>
                {view.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {savedViews.length > 0 && (
        <div className="analytics__saved-views">
          {savedViews.map((view) => (
            <div key={view.id} className="analytics__saved-pill-group">
              <button
                type="button"
                className="analytics__saved-pill"
                onClick={() => applySavedView(view.id)}
                title={`${view.segment} • ${view.focus}`}
              >
                {view.name}
              </button>
              <button
                type="button"
                className="analytics__saved-pill-delete"
                onClick={() => deleteSavedView(view.id)}
                aria-label={`Delete saved view ${view.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Summary Cards */}
      <SummaryCards
        data={data}
        segment={segment}
        segmentVolume={segmentVolume}
        segmentSharePct={segmentSharePct}
      />

      {/* RevOps KPIs */}
      {kpis && showPipelineSections && <RevOpsKPIs kpis={kpis} />}

      {/* Charts Row 1 */}
      {showPipelineSections && (
        <div className="analytics__charts-row">
          <div className="analytics__chart-card">
            <h3 className="analytics__chart-title">Calls Per Week</h3>
            <CallsPerWeekChart data={data} />
          </div>
          <div className="analytics__chart-card">
            <h3 className="analytics__chart-title">Funnel Stage Distribution</h3>
            <FunnelDonutChart data={data} />
          </div>
        </div>
      )}

      {/* Charts Row 2 */}
      {showPipelineSections && (
        <div className="analytics__charts-row">
          <div className="analytics__chart-card">
            <h3 className="analytics__chart-title">Top 10 Accounts by Call Volume</h3>
            <TopAccountsChart data={data} />
          </div>
          <div className="analytics__chart-card">
            <h3 className="analytics__chart-title">Entity Resolution Success Rate</h3>
            <ResolutionChart data={data} />
          </div>
        </div>
      )}

      {/* Charts Row 3 */}
      {showAdoptionSections && (
        <div className="analytics__charts-row analytics__charts-row--full">
          <div className="analytics__chart-card">
            <h3 className="analytics__chart-title">Landing Page Views Over Time</h3>
            <PageViewsChart data={data} />
          </div>
        </div>
      )}

      {/* Taxonomy Topics Treemap */}
      {showContentSections && (
        <div className="analytics__section">
          <h3 className="analytics__section-title">Taxonomy Topics</h3>
          <TaxonomyTreemap topics={segmentTopics} />
        </div>
      )}

      {/* Tables Row */}
      {showContentSections && (
        <div className="analytics__tables-row">
          <div className="analytics__table-card">
            <h3 className="analytics__table-title">Quote Leaderboard</h3>
            <QuoteLeaderboardTable entries={data.quoteLeaderboard} />
          </div>
          <div className="analytics__table-card">
            <h3 className="analytics__table-title">Top Pages by Views</h3>
            <TopPagesTable pages={data.topPagesByViews} />
          </div>
        </div>
      )}
    </div>
  );
}
