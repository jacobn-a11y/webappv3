import { useRef, useEffect, useCallback } from "react";
import { Chart, registerables } from "chart.js";
import type { AnalyticsData } from "../../lib/api";

Chart.register(...registerables);

// ─── Color Palette ──────────────────────────────────────────────────────────

const PALETTE = [
  "#336FE6",
  "#8B5CF6",
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#06B6D4",
  "#336FE6",
  "#EA580C",
  "#14B8A6",
  "#A78BFA",
  "#F87171",
];

const FUNNEL_COLORS: Record<string, string> = {
  "Top of Funnel": "#3B82F6",
  "Mid-Funnel": "#8B5CF6",
  "Bottom of Funnel": "#10B981",
  "Post-Sale": "#F59E0B",
  Internal: "#8A888E",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
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

// ─── Calls Per Week (Bar Chart) ─────────────────────────────────────────────

export function CallsPerWeekChart({ data }: { data: AnalyticsData }) {
  const builder = useCallback(
    (ctx: CanvasRenderingContext2D) =>
      new Chart(ctx, {
        type: "bar",
        data: {
          labels: data.callsPerWeek.map((d) => formatShortDate(d.weekStart)),
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
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: "#121213",
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: "#8A888E" },
            },
            y: {
              beginAtZero: true,
              grid: { color: "rgba(46,45,47,0.4)", lineWidth: 0.5 },
              ticks: { color: "#8A888E" },
            },
          },
        },
      }),
    [data.callsPerWeek]
  );

  const canvasRef = useChart(builder);
  return (
    <div className="analytics__chart-wrapper">
      <canvas ref={canvasRef} role="img" aria-label="Bar chart showing the number of calls per week" />
    </div>
  );
}

// ─── Funnel Stage Distribution (Donut Chart) ───────────────────────────────

export function FunnelDonutChart({ data }: { data: AnalyticsData }) {
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
                (d) => FUNNEL_COLORS[d.stage] ?? "#8A888E"
              ),
              borderWidth: 2,
              borderColor: "#121213",
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
              labels: { padding: 16, usePointStyle: true, color: "#B8B6BD" },
            },
            tooltip: {
              backgroundColor: "#121213",
            },
          },
        },
      }),
    [data.funnelDistribution]
  );

  const canvasRef = useChart(builder);
  return (
    <div className="analytics__chart-wrapper">
      <canvas ref={canvasRef} role="img" aria-label="Donut chart showing funnel stage distribution" />
    </div>
  );
}

// ─── Top 10 Accounts (Horizontal Bar) ──────────────────────────────────────

export function TopAccountsChart({ data }: { data: AnalyticsData }) {
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
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: "#121213",
            },
          },
          scales: {
            x: {
              beginAtZero: true,
              grid: { color: "rgba(46,45,47,0.4)", lineWidth: 0.5 },
              ticks: { color: "#8A888E" },
            },
            y: {
              grid: { display: false },
              ticks: { color: "#8A888E" },
            },
          },
        },
      }),
    [data.topAccounts]
  );

  const canvasRef = useChart(builder);
  return (
    <div className="analytics__chart-wrapper analytics__chart-wrapper--tall">
      <canvas ref={canvasRef} role="img" aria-label="Horizontal bar chart showing top 10 accounts by call volume" />
    </div>
  );
}

// ─── Entity Resolution Over Time (Line Chart) ──────────────────────────────

export function ResolutionChart({ data }: { data: AnalyticsData }) {
  const builder = useCallback(
    (ctx: CanvasRenderingContext2D) =>
      new Chart(ctx, {
        type: "line",
        data: {
          labels: data.entityResolutionOverTime.map((d) => formatShortDate(d.weekStart)),
          datasets: [
            {
              label: "Resolution Rate",
              data: data.entityResolutionOverTime.map((d) => d.rate * 100),
              borderColor: PALETTE[3],
              backgroundColor: `${PALETTE[3]}20`,
              fill: true,
              tension: 0.4,
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
              backgroundColor: "#121213",
              callbacks: {
                label: (ctx) => `${(ctx.parsed?.y ?? 0).toFixed(1)}%`,
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: "#8A888E" },
            },
            y: {
              beginAtZero: true,
              max: 100,
              grid: { color: "rgba(46,45,47,0.4)", lineWidth: 0.5 },
              ticks: { color: "#8A888E", callback: (v) => `${v}%` },
            },
          },
        },
      }),
    [data.entityResolutionOverTime]
  );

  const canvasRef = useChart(builder);
  return (
    <div className="analytics__chart-wrapper">
      <canvas ref={canvasRef} role="img" aria-label="Line chart showing entity resolution success rate over time" />
    </div>
  );
}

// ─── Landing Page Views Over Time (Bar + Line Combo) ────────────────────────

export function PageViewsChart({ data }: { data: AnalyticsData }) {
  const builder = useCallback(
    (ctx: CanvasRenderingContext2D) =>
      new Chart(ctx, {
        type: "bar",
        data: {
          labels: data.viewsOverTime.map((d) => formatShortDate(d.weekStart)),
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
            tooltip: {
              backgroundColor: "#121213",
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: "#8A888E" },
            },
            y: {
              beginAtZero: true,
              grid: { color: "rgba(46,45,47,0.4)", lineWidth: 0.5 },
              ticks: { color: "#8A888E" },
            },
          },
        },
      }),
    [data.viewsOverTime]
  );

  const canvasRef = useChart(builder);
  return (
    <div className="analytics__chart-wrapper">
      <canvas ref={canvasRef} role="img" aria-label="Bar chart showing landing page views over time" />
    </div>
  );
}

// ─── Taxonomy Topics Treemap (CSS Grid) ─────────────────────────────────────

export function TaxonomyTreemap({
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

export function QuoteLeaderboardTable({
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

export function TopPagesTable({
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
