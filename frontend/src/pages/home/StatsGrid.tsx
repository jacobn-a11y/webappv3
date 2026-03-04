import { Link } from "react-router-dom";
import { formatNumber, badgeClass } from "../../lib/format";
import type { RoleAwareHome, CustomerSuccessHealth } from "../../lib/api";

export interface StatsGridProps {
  data: RoleAwareHome;
  csHealth: CustomerSuccessHealth | null;
}

export function StatsGrid({ data, csHealth }: StatsGridProps) {
  return (
    <div className="home__stats-grid">
      <div className="home__stat-card">
        <span className="home__stat-label">Total Calls</span>
        <span className="home__stat-value">{formatNumber(data.stats.total_calls)}</span>
      </div>
      <div className="home__stat-card">
        <span className="home__stat-label">Accounts</span>
        <span className="home__stat-value">{formatNumber(data.stats.total_accounts)}</span>
      </div>
      <div className="home__stat-card">
        <span className="home__stat-label">Stories</span>
        <span className="home__stat-value">{formatNumber(data.stats.total_stories)}</span>
      </div>
      <div className="home__stat-card">
        <span className="home__stat-label">Landing Pages</span>
        <span className="home__stat-value">{formatNumber(data.stats.total_landing_pages)}</span>
      </div>
      <div className="home__stat-card">
        <span className="home__stat-label">Page Views</span>
        <span className="home__stat-value">{formatNumber(data.stats.total_page_views)}</span>
      </div>
      {csHealth && (
        <>
          <div className="home__stat-card">
            <span className="home__stat-label">CS Health Score</span>
            <span className="home__stat-value">
              {csHealth.overall_score != null
                ? `${Math.round(csHealth.overall_score * 100)}%`
                : "N/A"}
            </span>
          </div>
          <div className="home__stat-card">
            <span className="home__stat-label">At-Risk Accounts</span>
            <span className="home__stat-value">
              {csHealth.at_risk_count ?? 0}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
