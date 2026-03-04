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
          <span className="home__renewal-label">Pipeline Value</span>
          <span className="home__renewal-amount">
            ${formatNumber(report.pipeline_value)}
          </span>
        </div>
        <div className="home__renewal-card">
          <span className="home__renewal-label">Renewal Value</span>
          <span className="home__renewal-amount">
            ${formatNumber(report.renewal_value)}
          </span>
        </div>
        <div className="home__renewal-card">
          <span className="home__renewal-label">At-Risk Value</span>
          <span className="home__renewal-amount">
            ${formatNumber(report.at_risk_value)}
          </span>
        </div>
        {report.top_renewals && report.top_renewals.length > 0 && (
          <div className="home__renewal-card home__renewal-card--wide">
            <span className="home__renewal-label">Top Renewals</span>
            <ul className="home__renewal-list">
              {report.top_renewals.map((item, index) => (
                <li key={index} className="home__renewal-item">
                  <span>{item.account_name}</span>
                  <span>${formatNumber(item.value)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
