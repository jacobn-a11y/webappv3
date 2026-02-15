/**
 * Analytics Dashboard Routes
 *
 * Provides:
 *   - GET /api/analytics        — JSON API returning all analytics data
 *   - GET /api/analytics/dashboard — Server-rendered HTML analytics dashboard
 *
 * Charts rendered via Chart.js (CDN) with 7 visualizations:
 *   1. Calls per week (bar chart)
 *   2. Funnel stage distribution (donut chart)
 *   3. Top 10 accounts by call volume (horizontal bar)
 *   4. Entity resolution success rate over time (line chart)
 *   5. Most common taxonomy topics (treemap)
 *   6. High-value quote leaderboard (horizontal bar)
 *   7. Landing page performance (bar + table)
 */

import { Router, type Request, type Response } from "express";
import type { PrismaClient, UserRole } from "@prisma/client";
import { AnalyticsService, type AnalyticsDashboardData } from "../services/analytics.js";
import { requirePermission } from "../middleware/permissions.js";

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

// ─── Route Factory ─────────────────────────────────────────────────────────

export function createAnalyticsRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const analytics = new AnalyticsService(prisma);

  /**
   * GET /api/analytics
   *
   * Returns all analytics data as JSON.
   */
  router.get("/", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const data = await analytics.getDashboardData(req.organizationId);
      res.json(data);
    } catch (err) {
      console.error("Analytics data error:", err);
      res.status(500).json({ error: "Failed to load analytics data" });
    }
  });

  /**
   * GET /api/analytics/dashboard
   *
   * Serves a full server-rendered HTML analytics dashboard with Chart.js.
   */
  router.get("/dashboard", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const data = await analytics.getDashboardData(req.organizationId);
      res.setHeader("Content-Type", "text/html");
      res.send(renderAnalyticsDashboard(data));
    } catch (err) {
      console.error("Analytics dashboard error:", err);
      res.status(500).json({ error: "Failed to render analytics dashboard" });
    }
  });

  return router;
}

// ─── HTML Dashboard Renderer ───────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderAnalyticsDashboard(data: AnalyticsDashboardData): string {
  const dataJson = JSON.stringify(data);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>Analytics Dashboard | StoryEngine</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
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
      --color-success: #059669;
      --color-warning: #d97706;
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --radius: 12px;
      --shadow-sm: 0 1px 3px rgba(0,0,0,0.04);
      --shadow-md: 0 4px 12px rgba(0,0,0,0.06);
    }

    body {
      font-family: var(--font-sans);
      background: var(--color-bg);
      color: var(--color-text);
      line-height: 1.6;
      font-size: 14px;
      -webkit-font-smoothing: antialiased;
    }

    /* ─── Layout ────────────────────────────────────────────── */
    .dashboard {
      max-width: 1280px;
      margin: 0 auto;
      padding: 2rem 1.5rem 4rem;
    }

    .dashboard-header {
      margin-bottom: 2rem;
    }
    .dashboard-header h1 {
      font-size: 1.75rem;
      font-weight: 700;
      color: var(--color-text);
      letter-spacing: -0.02em;
    }
    .dashboard-header p {
      color: var(--color-text-secondary);
      margin-top: 0.25rem;
    }

    /* ─── Summary Cards ─────────────────────────────────────── */
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .summary-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 1.25rem;
      box-shadow: var(--shadow-sm);
    }
    .summary-card__label {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--color-text-muted);
      margin-bottom: 0.5rem;
    }
    .summary-card__value {
      font-size: 1.75rem;
      font-weight: 700;
      color: var(--color-text);
      line-height: 1.2;
    }
    .summary-card__sub {
      font-size: 0.8rem;
      color: var(--color-text-secondary);
      margin-top: 0.25rem;
    }

    /* ─── Chart Grid ────────────────────────────────────────── */
    .chart-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1.5rem;
    }
    .chart-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 1.5rem;
      box-shadow: var(--shadow-sm);
    }
    .chart-card--wide {
      grid-column: 1 / -1;
    }
    .chart-card__title {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--color-text);
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .chart-card__title .badge {
      font-size: 0.7rem;
      font-weight: 500;
      background: var(--color-accent-light);
      color: var(--color-accent);
      padding: 0.15rem 0.5rem;
      border-radius: 6px;
    }
    .chart-container {
      position: relative;
      width: 100%;
    }
    .chart-container--bar { height: 300px; }
    .chart-container--donut { height: 280px; }
    .chart-container--hbar { height: 320px; }
    .chart-container--line { height: 280px; }
    .chart-container--treemap { min-height: 320px; }

    /* ─── Leaderboard Table ─────────────────────────────────── */
    .leaderboard {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
    }
    .leaderboard th {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--color-text-muted);
      text-align: left;
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--color-border);
    }
    .leaderboard td {
      padding: 0.6rem 0.75rem;
      border-bottom: 1px solid #f3f4f6;
      font-size: 0.85rem;
    }
    .leaderboard tr:last-child td {
      border-bottom: none;
    }
    .leaderboard .rank {
      font-weight: 700;
      color: var(--color-accent);
      width: 2.5rem;
    }
    .leaderboard .count {
      font-weight: 600;
      text-align: right;
    }
    .leaderboard .bar-cell {
      width: 40%;
    }
    .leaderboard .bar-bg {
      height: 6px;
      background: #f3f4f6;
      border-radius: 3px;
      overflow: hidden;
    }
    .leaderboard .bar-fill {
      height: 100%;
      background: var(--color-accent);
      border-radius: 3px;
      transition: width 0.6s ease;
    }

    /* ─── Treemap ───────────────────────────────────────────── */
    .treemap {
      display: grid;
      gap: 3px;
      min-height: 320px;
    }
    .treemap-cell {
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      padding: 0.5rem;
      text-align: center;
      transition: opacity 0.2s;
      cursor: default;
    }
    .treemap-cell:hover { opacity: 0.85; }
    .treemap-cell__label {
      font-size: 0.7rem;
      font-weight: 600;
      color: rgba(255,255,255,0.95);
      line-height: 1.2;
    }
    .treemap-cell__count {
      font-size: 1.1rem;
      font-weight: 700;
      color: #fff;
      margin-top: 0.15rem;
    }

    /* ─── Pages Table ───────────────────────────────────────── */
    .pages-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
    }
    .pages-table th {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--color-text-muted);
      text-align: left;
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--color-border);
    }
    .pages-table td {
      padding: 0.6rem 0.75rem;
      border-bottom: 1px solid #f3f4f6;
      font-size: 0.85rem;
    }
    .pages-table tr:last-child td { border-bottom: none; }
    .pages-table .views {
      font-weight: 600;
      text-align: right;
      color: var(--color-accent);
    }
    .pages-table .slug {
      color: var(--color-text-muted);
      font-family: monospace;
      font-size: 0.8rem;
    }

    /* ─── Empty State ───────────────────────────────────────── */
    .empty-state {
      text-align: center;
      padding: 3rem 1rem;
      color: var(--color-text-muted);
    }
    .empty-state svg {
      width: 48px;
      height: 48px;
      margin-bottom: 0.75rem;
      opacity: 0.4;
    }

    /* ─── Responsive ────────────────────────────────────────── */
    @media (max-width: 900px) {
      .chart-grid { grid-template-columns: 1fr; }
      .chart-card--wide { grid-column: 1; }
    }
    @media (max-width: 600px) {
      .dashboard { padding: 1rem 0.75rem 3rem; }
      .summary-grid { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <div class="dashboard">
    <!-- Header -->
    <header class="dashboard-header">
      <h1>Analytics Dashboard</h1>
      <p>Org-wide metrics and performance insights</p>
    </header>

    <!-- Summary Cards -->
    <section class="summary-grid">
      <div class="summary-card">
        <div class="summary-card__label">Total Calls</div>
        <div class="summary-card__value" id="stat-calls">${data.summary.totalCalls.toLocaleString()}</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">Accounts</div>
        <div class="summary-card__value" id="stat-accounts">${data.summary.totalAccounts.toLocaleString()}</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">Transcript Hours</div>
        <div class="summary-card__value" id="stat-hours">${data.summary.totalTranscriptHours}</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">Resolution Rate</div>
        <div class="summary-card__value" id="stat-resolution">${Math.round(data.summary.overallResolutionRate * 100)}%</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">Quantified Quotes</div>
        <div class="summary-card__value" id="stat-quotes">${data.summary.totalQuotes.toLocaleString()}</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">Page Views</div>
        <div class="summary-card__value" id="stat-views">${data.summary.totalPageViews.toLocaleString()}</div>
      </div>
    </section>

    <!-- Charts Grid -->
    <section class="chart-grid">

      <!-- 1. Calls Per Week (Bar Chart) -->
      <div class="chart-card chart-card--wide">
        <div class="chart-card__title">
          Calls Per Week
          <span class="badge">Last 12 weeks</span>
        </div>
        <div class="chart-container chart-container--bar">
          <canvas id="chart-calls-per-week"></canvas>
        </div>
      </div>

      <!-- 2. Funnel Stage Distribution (Donut Chart) -->
      <div class="chart-card">
        <div class="chart-card__title">Funnel Stage Distribution</div>
        <div class="chart-container chart-container--donut">
          <canvas id="chart-funnel"></canvas>
        </div>
      </div>

      <!-- 3. Top 10 Accounts (Horizontal Bar) -->
      <div class="chart-card">
        <div class="chart-card__title">Top 10 Accounts by Call Volume</div>
        <div class="chart-container chart-container--hbar">
          <canvas id="chart-top-accounts"></canvas>
        </div>
      </div>

      <!-- 4. Entity Resolution Over Time (Line Chart) -->
      <div class="chart-card chart-card--wide">
        <div class="chart-card__title">
          Entity Resolution Success Rate
          <span class="badge">Last 12 weeks</span>
        </div>
        <div class="chart-container chart-container--line">
          <canvas id="chart-resolution"></canvas>
        </div>
      </div>

      <!-- 5. Most Common Taxonomy Topics (Treemap) -->
      <div class="chart-card chart-card--wide">
        <div class="chart-card__title">
          Most Common Taxonomy Topics
          <span class="badge">Top 25</span>
        </div>
        <div class="chart-container chart-container--treemap" id="treemap-container"></div>
      </div>

      <!-- 6. High-Value Quote Leaderboard -->
      <div class="chart-card">
        <div class="chart-card__title">Quote Leaderboard</div>
        <div id="leaderboard-container"></div>
      </div>

      <!-- 7. Landing Page Performance -->
      <div class="chart-card">
        <div class="chart-card__title">Top Pages by Views</div>
        <div id="pages-container"></div>
      </div>

      <!-- 7b. Views Over Time -->
      <div class="chart-card chart-card--wide">
        <div class="chart-card__title">Landing Page Views Over Time</div>
        <div class="chart-container chart-container--bar">
          <canvas id="chart-views-over-time"></canvas>
        </div>
      </div>
    </section>
  </div>

  <script>
    const data = ${dataJson};

    // ─── Chart.js Defaults ──────────────────────────────────────────
    Chart.defaults.font.family = "'Inter', -apple-system, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = '#555770';
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.pointStyleWidth = 8;

    const PALETTE = [
      '#4f46e5', '#7c3aed', '#2563eb', '#059669', '#d97706',
      '#dc2626', '#0891b2', '#4338ca', '#7c2d12', '#065f46',
      '#6d28d9', '#b91c1c'
    ];

    const FUNNEL_COLORS = {
      'Top of Funnel': '#2563eb',
      'Mid-Funnel': '#7c3aed',
      'Bottom of Funnel': '#059669',
      'Post-Sale': '#d97706',
      'Internal': '#6b7280',
      'Vertical': '#0891b2',
    };

    const FUNNEL_TAG_COLORS = {
      'TOFU': '#2563eb',
      'MOFU': '#7c3aed',
      'BOFU': '#059669',
      'POST_SALE': '#d97706',
      'INTERNAL': '#6b7280',
      'VERTICAL': '#0891b2',
    };

    // ─── 1. Calls Per Week (Bar Chart) ──────────────────────────────
    (function() {
      const ctx = document.getElementById('chart-calls-per-week');
      if (!data.callsPerWeek.length) return;

      new Chart(ctx, {
        type: 'bar',
        data: {
          labels: data.callsPerWeek.map(d => {
            const dt = new Date(d.weekStart + 'T00:00:00Z');
            return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          }),
          datasets: [{
            label: 'Calls',
            data: data.callsPerWeek.map(d => d.count),
            backgroundColor: '#4f46e5',
            borderRadius: 6,
            borderSkipped: false,
            maxBarThickness: 48,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { precision: 0 },
              grid: { color: '#f3f4f6' },
            },
            x: {
              grid: { display: false },
            }
          }
        }
      });
    })();

    // ─── 2. Funnel Stage Distribution (Donut Chart) ─────────────────
    (function() {
      const ctx = document.getElementById('chart-funnel');
      if (!data.funnelDistribution.length) return;

      new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: data.funnelDistribution.map(d => d.stage),
          datasets: [{
            data: data.funnelDistribution.map(d => d.count),
            backgroundColor: data.funnelDistribution.map(d => FUNNEL_COLORS[d.stage] || '#6b7280'),
            borderWidth: 2,
            borderColor: '#ffffff',
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '55%',
          plugins: {
            legend: {
              position: 'right',
              labels: { padding: 16, font: { size: 11 } }
            }
          }
        }
      });
    })();

    // ─── 3. Top 10 Accounts (Horizontal Bar) ────────────────────────
    (function() {
      const ctx = document.getElementById('chart-top-accounts');
      if (!data.topAccounts.length) return;

      new Chart(ctx, {
        type: 'bar',
        data: {
          labels: data.topAccounts.map(d => d.accountName.length > 20
            ? d.accountName.slice(0, 20) + '...'
            : d.accountName),
          datasets: [{
            label: 'Calls',
            data: data.topAccounts.map(d => d.callCount),
            backgroundColor: PALETTE.slice(0, data.topAccounts.length),
            borderRadius: 6,
            borderSkipped: false,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: 'y',
          plugins: { legend: { display: false } },
          scales: {
            x: {
              beginAtZero: true,
              ticks: { precision: 0 },
              grid: { color: '#f3f4f6' },
            },
            y: {
              grid: { display: false },
              ticks: { font: { size: 11 } }
            }
          }
        }
      });
    })();

    // ─── 4. Entity Resolution Over Time (Line Chart) ────────────────
    (function() {
      const ctx = document.getElementById('chart-resolution');
      if (!data.entityResolutionOverTime.length) return;

      new Chart(ctx, {
        type: 'line',
        data: {
          labels: data.entityResolutionOverTime.map(d => {
            const dt = new Date(d.weekStart + 'T00:00:00Z');
            return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          }),
          datasets: [{
            label: 'Resolution Rate',
            data: data.entityResolutionOverTime.map(d => Math.round(d.rate * 100)),
            borderColor: '#059669',
            backgroundColor: 'rgba(5, 150, 105, 0.08)',
            fill: true,
            tension: 0.35,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: '#059669',
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function(ctx) {
                  const d = data.entityResolutionOverTime[ctx.dataIndex];
                  return ctx.parsed.y + '% (' + d.resolvedCalls + '/' + d.totalCalls + ' calls)';
                }
              }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              max: 100,
              ticks: { callback: v => v + '%' },
              grid: { color: '#f3f4f6' },
            },
            x: {
              grid: { display: false },
            }
          }
        }
      });
    })();

    // ─── 5. Taxonomy Topics Treemap (CSS Grid) ─────────────────────
    (function() {
      const container = document.getElementById('treemap-container');
      if (!data.topTopics.length) {
        container.innerHTML = '<div class="empty-state"><p>No taxonomy data yet</p></div>';
        return;
      }

      const maxCount = Math.max(...data.topTopics.map(t => t.count));
      const total = data.topTopics.reduce((s, t) => s + t.count, 0);

      // Build a CSS grid layout weighted by count
      // Use a simple row-based approach: assign rows based on proportion
      const sorted = [...data.topTopics].sort((a, b) => b.count - a.count);

      // Calculate grid columns (fixed 6-column grid)
      const cols = 6;
      let gridHtml = '';
      container.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';

      for (const topic of sorted) {
        // Span proportional to count (min 1, max cols)
        const proportion = topic.count / maxCount;
        const span = Math.max(1, Math.min(cols, Math.round(proportion * 3) + 1));
        const color = FUNNEL_TAG_COLORS[topic.funnelStage] || '#6b7280';
        const opacity = 0.6 + (proportion * 0.4);

        gridHtml += '<div class="treemap-cell" style="'
          + 'grid-column: span ' + Math.min(span, cols) + ';'
          + 'background-color: ' + color + ';'
          + 'opacity: ' + opacity.toFixed(2) + ';'
          + '" title="' + escapeAttr(topic.label) + ': ' + topic.count + ' tags (' + topic.funnelStage + ')">'
          + '<div class="treemap-cell__label">' + escapeAttr(topic.label) + '</div>'
          + '<div class="treemap-cell__count">' + topic.count + '</div>'
          + '</div>';
      }

      container.classList.add('treemap');
      container.innerHTML = gridHtml;
    })();

    // ─── 6. Quote Leaderboard ───────────────────────────────────────
    (function() {
      const container = document.getElementById('leaderboard-container');
      if (!data.quoteLeaderboard.length) {
        container.innerHTML = '<div class="empty-state"><p>No quantified-value quotes yet</p></div>';
        return;
      }

      const maxQ = Math.max(...data.quoteLeaderboard.map(q => q.quoteCount));

      let html = '<table class="leaderboard"><thead><tr>'
        + '<th>#</th><th>Account</th><th class="bar-cell"></th><th style="text-align:right">Quotes</th>'
        + '</tr></thead><tbody>';

      data.quoteLeaderboard.forEach((entry, i) => {
        const pct = maxQ > 0 ? (entry.quoteCount / maxQ * 100) : 0;
        html += '<tr>'
          + '<td class="rank">' + (i + 1) + '</td>'
          + '<td>' + escapeAttr(entry.accountName) + '</td>'
          + '<td class="bar-cell"><div class="bar-bg"><div class="bar-fill" style="width:' + pct.toFixed(1) + '%"></div></div></td>'
          + '<td class="count">' + entry.quoteCount + '</td>'
          + '</tr>';
      });

      html += '</tbody></table>';
      container.innerHTML = html;
    })();

    // ─── 7. Top Pages by Views ──────────────────────────────────────
    (function() {
      const container = document.getElementById('pages-container');
      if (!data.topPagesByViews.length) {
        container.innerHTML = '<div class="empty-state"><p>No published pages yet</p></div>';
        return;
      }

      let html = '<table class="pages-table"><thead><tr>'
        + '<th>Page</th><th style="text-align:right">Views</th>'
        + '</tr></thead><tbody>';

      data.topPagesByViews.forEach(page => {
        const published = page.publishedAt
          ? new Date(page.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : '';
        html += '<tr>'
          + '<td>'
          + '<div>' + escapeAttr(page.title.length > 35 ? page.title.slice(0, 35) + '...' : page.title) + '</div>'
          + '<div class="slug">/s/' + escapeAttr(page.slug.length > 25 ? page.slug.slice(0, 25) + '...' : page.slug) + '</div>'
          + '</td>'
          + '<td class="views">' + page.viewCount.toLocaleString() + '</td>'
          + '</tr>';
      });

      html += '</tbody></table>';
      container.innerHTML = html;
    })();

    // ─── 7b. Views Over Time ────────────────────────────────────────
    (function() {
      const ctx = document.getElementById('chart-views-over-time');
      if (!data.viewsOverTime.length) return;

      const sorted = [...data.viewsOverTime].sort((a, b) => a.weekStart.localeCompare(b.weekStart));

      new Chart(ctx, {
        type: 'bar',
        data: {
          labels: sorted.map(d => {
            const dt = new Date(d.weekStart + 'T00:00:00Z');
            return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          }),
          datasets: [
            {
              label: 'Total Views',
              data: sorted.map(d => d.totalViews),
              backgroundColor: '#4f46e5',
              borderRadius: 6,
              borderSkipped: false,
              yAxisID: 'y',
            },
            {
              label: 'Pages Published',
              data: sorted.map(d => d.pagesPublished),
              type: 'line',
              borderColor: '#d97706',
              backgroundColor: 'rgba(217, 119, 6, 0.1)',
              pointBackgroundColor: '#d97706',
              tension: 0.3,
              yAxisID: 'y1',
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: { font: { size: 11 } }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              position: 'left',
              ticks: { precision: 0 },
              grid: { color: '#f3f4f6' },
              title: { display: true, text: 'Views', font: { size: 11 } }
            },
            y1: {
              beginAtZero: true,
              position: 'right',
              ticks: { precision: 0 },
              grid: { drawOnChartArea: false },
              title: { display: true, text: 'Pages', font: { size: 11 } }
            },
            x: {
              grid: { display: false },
            }
          }
        }
      });
    })();

    // ─── Utility ────────────────────────────────────────────────────
    function escapeAttr(str) {
      return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#039;');
    }
  </script>
</body>
</html>`;
}
