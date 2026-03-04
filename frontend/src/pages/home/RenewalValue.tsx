import { formatNumber } from "../../lib/format";
import type { RenewalValueReport } from "../../lib/api";

export interface RenewalValueProps {
  report: RenewalValueReport | null;
  loading: boolean;
}

export function RenewalValue({ report, loading }: RenewalValueProps) {
  if (loading) {
    return (
      <section className="home__renewal-value">
        <h2 className="home__section-title">Renewal / Pipeline Value</h2>
        <div className="home__loading" role="status" aria-live="polite">
          Loading renewal data...
        </div>
      </section>
    );
  }

  if (!report) {
    return null;
  }

  return (
    <section className="home__renewal-value">
      <h2 className="home__section-title">Renewal / Pipeline Value</h2>
      <div className="home__renewal-grid">
        <div className="home__renewal-card">
          <span className="home__renewal-label">Contract Value</span>
          <span className="home__renewal-amount">
            {report.contract_context.contract_value_cents == null
              ? "N/A"
              : `$${formatNumber(Math.round(report.contract_context.contract_value_cents / 100))}`}
          </span>
        </div>
        <div className="home__renewal-card">
          <span className="home__renewal-label">Active Users (30d)</span>
          <span className="home__renewal-amount">
            {formatNumber(report.outcomes.active_users_30d)}
          </span>
        </div>
        <div className="home__renewal-card">
          <span className="home__renewal-label">Adoption Rate</span>
          <span className="home__renewal-amount">
            {formatNumber(report.outcomes.adoption_rate_pct)}%
          </span>
        </div>
        {report.outcomes.top_topics && report.outcomes.top_topics.length > 0 && (
          <div className="home__renewal-card home__renewal-card--wide">
            <span className="home__renewal-label">Top Topics</span>
            <ul className="home__renewal-list">
              {report.outcomes.top_topics.map((item, index: number) => (
                <li key={index} className="home__renewal-item">
                  <span>{item.topic}</span>
                  <span>{formatNumber(item.count)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
