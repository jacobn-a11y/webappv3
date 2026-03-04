/**
 * PageStatsCards — Four stat cards for the Dashboard Pages page:
 * Total Pages, Published, Drafts, Total Views.
 */

import type { DashboardStats } from "../../lib/api";

export interface PageStatsCardsProps {
  stats: DashboardStats;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toString();
}

export function PageStatsCards({ stats }: PageStatsCardsProps) {
  return (
    <div className="dash-pages__stats">
      <div className="dash-pages__stat-card dash-pages__stat-card--total">
        <div className="dash-pages__stat-icon">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            width="20"
            height="20"
            aria-hidden="true"
          >
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14,2 14,8 20,8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10,9 9,9 8,9" />
          </svg>
        </div>
        <div className="dash-pages__stat-label">Total Pages</div>
        <div className="dash-pages__stat-value">{stats.totalPages}</div>
      </div>

      <div className="dash-pages__stat-card dash-pages__stat-card--published">
        <div className="dash-pages__stat-icon">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            width="20"
            height="20"
            aria-hidden="true"
          >
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
            <polyline points="22,4 12,14.01 9,11.01" />
          </svg>
        </div>
        <div className="dash-pages__stat-label">Published</div>
        <div className="dash-pages__stat-value">{stats.publishedPages}</div>
      </div>

      <div className="dash-pages__stat-card dash-pages__stat-card--drafts">
        <div className="dash-pages__stat-icon">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            width="20"
            height="20"
            aria-hidden="true"
          >
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </div>
        <div className="dash-pages__stat-label">Drafts</div>
        <div className="dash-pages__stat-value">{stats.draftPages}</div>
      </div>

      <div className="dash-pages__stat-card dash-pages__stat-card--views">
        <div className="dash-pages__stat-icon">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            width="20"
            height="20"
            aria-hidden="true"
          >
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </div>
        <div className="dash-pages__stat-label">Total Views</div>
        <div className="dash-pages__stat-value">
          {formatNumber(stats.totalViews)}
        </div>
      </div>
    </div>
  );
}
