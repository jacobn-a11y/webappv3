import { formatNumber } from "../../lib/format";
import type { RoleAwareHome, CustomerSuccessHealth } from "../../lib/api";

export interface StatsGridProps {
  data: RoleAwareHome;
  csHealth: CustomerSuccessHealth | null;
}

export function StatsGrid({ data, csHealth }: StatsGridProps) {
  return (
    <div className="home__stats-grid">
      <div className="home__stat-card">
        <span className="home__stat-label">Stories (30d)</span>
        <span className="home__stat-value">{formatNumber(data.summary.stories_30d)}</span>
      </div>
      <div className="home__stat-card">
        <span className="home__stat-label">Pages (30d)</span>
        <span className="home__stat-value">{formatNumber(data.summary.pages_30d)}</span>
      </div>
      <div className="home__stat-card">
        <span className="home__stat-label">Pending Approvals</span>
        <span className="home__stat-value">{formatNumber(data.summary.pending_approvals)}</span>
      </div>
      <div className="home__stat-card">
        <span className="home__stat-label">Integration Issues</span>
        <span className="home__stat-value">{formatNumber(data.summary.failed_integrations)}</span>
      </div>
      <div className="home__stat-card">
        <span className="home__stat-label">Page Views</span>
        <span className="home__stat-value">{formatNumber(data.summary.total_page_views)}</span>
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
              {csHealth.teams.filter((team) => team.risk === "HIGH").length}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
