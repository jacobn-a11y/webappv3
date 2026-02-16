import { useState, useEffect, useRef, useCallback } from "react";
import { Chart, registerables } from "chart.js";
import { getAnalyticsData, type AnalyticsData } from "../lib/api";

Chart.register(...registerables);

// ─── Color Palette ──────────────────────────────────────────────────────────

const PALETTE = [
  "#4f46e5",
  "#7c3aed",
  "#2563eb",
  "#059669",
  "#d97706",
  "#dc2626",
  "#0891b2",
  "#4338ca",
  "#7c2d12",
  "#065f46",
  "#6d28d9",
  "#b91c1c",
];

const FUNNEL_COLORS: Record<string, string> = {
  "Top of Funnel": "#2563eb",
  "Mid-Funnel": "#7c3aed",
  "Bottom of Funnel": "#059669",
  "Post-Sale": "#d97706",
  Internal: "#6b7280",
};

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

// ─── Chart Hook ─────────────────────────────────────────────────────────────

function useChart(
  builder: (ctx: CanvasRenderingContext2D) => Chart
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    // Destroy previous instance
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    chartRef.current = builder(ctx);

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builder]);

  return canvasRef;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function AnalyticsDashboardPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getAnalyticsData()
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load analytics");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="analytics__loading">
        <div className="analytics__spinner" />
        <p>Loading analytics data...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="analytics__error">
        <p>Error: {error ?? "No data available"}</p>
      </div>
    );
  }

  return (
    <div className="analytics__container">
      {/* Header */}
      <header className="analytics__header">
        <h1 className="analytics__title">Analytics Dashboard</h1>
        <p className="analytics__subtitle">
          Org-wide metrics and performance insights
        </p>
      </header>

      {/* Summary Cards */}
      <div className="analytics__summary-grid">
        <SummaryCard
          title="Total Calls"
          value={formatNumber(data.summary.totalCalls)}
          icon={
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
            </svg>
          }
        />
        <SummaryCard
          title="Accounts"
          value={formatNumber(data.summary.totalAccounts)}
          icon={
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2">
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
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
          }
        />
        <SummaryCard
          title="Resolution Rate"
          value={formatPercent(data.summary.overallResolutionRate)}
          icon={
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
              <path d="M22 4L12 14.01l-3-3" />
            </svg>
          }
        />
        <SummaryCard
          title="Quantified Quotes"
          value={formatNumber(data.summary.totalQuotes)}
          icon={
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
          }
        />
        <SummaryCard
          title="Page Views"
          value={formatNumber(data.summary.totalPageViews)}
          icon={
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          }
        />
      </div>

      {/* Charts Row 1 */}
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

      {/* Charts Row 2 */}
      <div className="analytics__charts-row">
        <div className="analytics__chart-card">
          <h3 className="analytics__chart-title">
            Top 10 Accounts by Call Volume
          </h3>
          <TopAccountsChart data={data} />
        </div>
        <div className="analytics__chart-card">
          <h3 className="analytics__chart-title">
            Entity Resolution Success Rate
          </h3>
          <ResolutionChart data={data} />
        </div>
      </div>

      {/* Charts Row 3 */}
      <div className="analytics__charts-row analytics__charts-row--full">
        <div className="analytics__chart-card">
          <h3 className="analytics__chart-title">
            Landing Page Views Over Time
          </h3>
          <PageViewsChart data={data} />
        </div>
      </div>

      {/* Taxonomy Topics Treemap */}
      <div className="analytics__section">
        <h3 className="analytics__section-title">Taxonomy Topics</h3>
        <TaxonomyTreemap topics={data.topTopics} />
      </div>

      {/* Tables Row */}
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
    </div>
  );
}

// ─── Summary Card ───────────────────────────────────────────────────────────

function SummaryCard({
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

// ─── Calls Per Week (Bar Chart) ─────────────────────────────────────────────

function CallsPerWeekChart({ data }: { data: AnalyticsData }) {
  const builder = useCallback(
    (ctx: CanvasRenderingContext2D) =>
      new Chart(ctx, {
        type: "bar",
        data: {
          labels: data.callsPerWeek.map((d) => d.weekStart),
          datasets: [
            {
              label: "Calls",
              data: data.callsPerWeek.map((d) => d.count),
              backgroundColor: PALETTE[0],
              borderRadius: 4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false } },
            y: { beginAtZero: true },
          },
        },
      }),
    [data.callsPerWeek]
  );

  const canvasRef = useChart(builder);
  return (
    <div className="analytics__chart-wrapper">
      <canvas ref={canvasRef} />
    </div>
  );
}

// ─── Funnel Stage Distribution (Donut Chart) ───────────────────────────────

function FunnelDonutChart({ data }: { data: AnalyticsData }) {
  const builder = useCallback(
    (ctx: CanvasRenderingContext2D) =>
      new Chart(ctx, {
        type: "doughnut",
        data: {
          labels: data.funnelDistribution.map((d) => d.stage),
          datasets: [
            {
              data: data.funnelDistribution.map((d) => d.count),
              backgroundColor: data.funnelDistribution.map(
                (d) => FUNNEL_COLORS[d.stage] ?? "#6b7280"
              ),
              borderWidth: 2,
              borderColor: "#fff",
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "60%",
          plugins: {
            legend: {
              position: "bottom",
              labels: { padding: 16, usePointStyle: true },
            },
          },
        },
      }),
    [data.funnelDistribution]
  );

  const canvasRef = useChart(builder);
  return (
    <div className="analytics__chart-wrapper">
      <canvas ref={canvasRef} />
    </div>
  );
}

// ─── Top 10 Accounts (Horizontal Bar) ──────────────────────────────────────

function TopAccountsChart({ data }: { data: AnalyticsData }) {
  const builder = useCallback(
    (ctx: CanvasRenderingContext2D) =>
      new Chart(ctx, {
        type: "bar",
        data: {
          labels: data.topAccounts.map((d) => d.accountName),
          datasets: [
            {
              label: "Calls",
              data: data.topAccounts.map((d) => d.callCount),
              backgroundColor: PALETTE.slice(0, data.topAccounts.length),
              borderRadius: 4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: "y",
          plugins: { legend: { display: false } },
          scales: {
            x: { beginAtZero: true },
            y: { grid: { display: false } },
          },
        },
      }),
    [data.topAccounts]
  );

  const canvasRef = useChart(builder);
  return (
    <div className="analytics__chart-wrapper analytics__chart-wrapper--tall">
      <canvas ref={canvasRef} />
    </div>
  );
}

// ─── Entity Resolution Over Time (Line Chart) ──────────────────────────────

function ResolutionChart({ data }: { data: AnalyticsData }) {
  const builder = useCallback(
    (ctx: CanvasRenderingContext2D) =>
      new Chart(ctx, {
        type: "line",
        data: {
          labels: data.entityResolutionOverTime.map((d) => d.weekStart),
          datasets: [
            {
              label: "Resolution Rate",
              data: data.entityResolutionOverTime.map((d) => d.rate * 100),
              borderColor: PALETTE[3],
              backgroundColor: `${PALETTE[3]}20`,
              fill: true,
              tension: 0.3,
              pointRadius: 3,
              pointHoverRadius: 6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => `${(ctx.parsed?.y ?? 0).toFixed(1)}%`,
              },
            },
          },
          scales: {
            x: { grid: { display: false } },
            y: {
              beginAtZero: true,
              max: 100,
              ticks: { callback: (v) => `${v}%` },
            },
          },
        },
      }),
    [data.entityResolutionOverTime]
  );

  const canvasRef = useChart(builder);
  return (
    <div className="analytics__chart-wrapper">
      <canvas ref={canvasRef} />
    </div>
  );
}

// ─── Landing Page Views Over Time (Bar + Line Combo) ────────────────────────

function PageViewsChart({ data }: { data: AnalyticsData }) {
  const builder = useCallback(
    (ctx: CanvasRenderingContext2D) =>
      new Chart(ctx, {
        type: "bar",
        data: {
          labels: data.viewsOverTime.map((d) => d.weekStart),
          datasets: [
            {
              type: "bar" as const,
              label: "Total Views",
              data: data.viewsOverTime.map((d) => d.totalViews),
              backgroundColor: `${PALETTE[2]}80`,
              borderRadius: 4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
          },
          scales: {
            x: { grid: { display: false } },
            y: { beginAtZero: true },
          },
        },
      }),
    [data.viewsOverTime]
  );

  const canvasRef = useChart(builder);
  return (
    <div className="analytics__chart-wrapper">
      <canvas ref={canvasRef} />
    </div>
  );
}

// ─── Taxonomy Topics Treemap (CSS Grid) ─────────────────────────────────────

function TaxonomyTreemap({
  topics,
}: {
  topics: AnalyticsData["topTopics"];
}) {
  const maxCount = Math.max(...topics.map((t) => t.count), 1);

  return (
    <div className="analytics__treemap">
      {topics.map((topic, i) => {
        const shade = Math.max(0.2, topic.count / maxCount);
        const bgColor = FUNNEL_COLORS[topic.funnelStage] ?? PALETTE[i % PALETTE.length];
        return (
          <div
            key={topic.label}
            className="analytics__treemap-cell"
            style={{
              backgroundColor: bgColor,
              opacity: shade,
              gridColumn: topic.count > maxCount * 0.5 ? "span 2" : undefined,
            }}
            title={`${topic.label}: ${topic.count} (${topic.funnelStage})`}
          >
            <span className="analytics__treemap-label">{topic.label}</span>
            <span className="analytics__treemap-count">{topic.count}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Quote Leaderboard Table ────────────────────────────────────────────────

function QuoteLeaderboardTable({
  entries,
}: {
  entries: AnalyticsData["quoteLeaderboard"];
}) {
  return (
    <div className="analytics__table-wrapper">
      <table className="analytics__table">
        <thead>
          <tr>
            <th className="analytics__th">#</th>
            <th className="analytics__th">Account</th>
            <th className="analytics__th">Quotes</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, i) => (
            <tr key={`${entry.accountName}-${i}`} className="analytics__tr">
              <td className="analytics__td analytics__td--rank">{i + 1}</td>
              <td className="analytics__td">{entry.accountName}</td>
              <td className="analytics__td analytics__td--count">
                {entry.quoteCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Top Pages Table ────────────────────────────────────────────────────────

function TopPagesTable({
  pages,
}: {
  pages: AnalyticsData["topPagesByViews"];
}) {
  return (
    <div className="analytics__table-wrapper">
      <table className="analytics__table">
        <thead>
          <tr>
            <th className="analytics__th">#</th>
            <th className="analytics__th">Page</th>
            <th className="analytics__th">Views</th>
          </tr>
        </thead>
        <tbody>
          {pages.map((page, i) => (
            <tr key={page.slug} className="analytics__tr">
              <td className="analytics__td analytics__td--rank">{i + 1}</td>
              <td className="analytics__td">
                <div className="analytics__page-info">
                  <span className="analytics__page-title">{page.title}</span>
                  <span className="analytics__page-path">{page.slug}</span>
                </div>
              </td>
              <td className="analytics__td analytics__td--count">
                {formatNumber(page.viewCount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
