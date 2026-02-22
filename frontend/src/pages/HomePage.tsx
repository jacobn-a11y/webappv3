import { useEffect, useState } from "react";
import {
  getCustomerSuccessHealth,
  getRenewalValueReport,
  getRoleAwareHome,
  type CustomerSuccessHealth,
  type RenewalValueReport,
  type RoleAwareHome,
} from "../lib/api";

const PERSONA_LABELS: Record<RoleAwareHome["persona"], string> = {
  REVOPS_ADMIN: "RevOps Admin",
  MARKETING_ANALYST: "Marketing Analyst",
  SALES_MANAGER: "Sales Manager",
  CSM: "Customer Success Manager",
  EXEC: "Executive",
};

export function HomePage() {
  const [data, setData] = useState<RoleAwareHome | null>(null);
  const [csHealth, setCsHealth] = useState<CustomerSuccessHealth | null>(null);
  const [renewal, setRenewal] = useState<RenewalValueReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getRoleAwareHome(), getCustomerSuccessHealth(), getRenewalValueReport()])
      .then(([home, health, report]) => {
        setData(home);
        setCsHealth(health);
        setRenewal(report);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load home")
      );
  }, []);

  if (error) {
    return <div className="page-error">{error}</div>;
  }
  if (!data) {
    return <div className="admin-security__page">Loading home...</div>;
  }

  return (
    <div className="admin-security__page">
      <h1 className="admin-security__title">Home</h1>
      <section className="admin-security__card">
        <h2>
          {PERSONA_LABELS[data.persona]} View
          {data.user.role_profile_name ? ` · ${data.user.role_profile_name}` : ""}
        </h2>
        <div className="admin-ops__grid">
          <div>Stories (30d): {data.summary.stories_30d}</div>
          <div>Pages (30d): {data.summary.pages_30d}</div>
          <div>Total Page Views: {data.summary.total_page_views}</div>
          <div>Pending Approvals: {data.summary.pending_approvals}</div>
          <div>Failed Integrations: {data.summary.failed_integrations}</div>
          <div>Post-Sale Stories (30d): {data.summary.post_sale_stories_30d}</div>
        </div>
      </section>

      <section className="admin-security__card">
        <h2>Recommended Next Actions</h2>
        <ul>
          {data.recommended_actions.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      {csHealth && (
        <section className="admin-security__card">
          <h2>Customer Success Health</h2>
          <div className="admin-ops__grid">
            <div>Overall Score: {csHealth.overall_score}</div>
            <div>Onboarding Progress: {csHealth.onboarding_progress_pct}%</div>
            <div>Adoption Rate: {csHealth.adoption_rate_pct}%</div>
            <div>Reliability Score: {csHealth.reliability_score}</div>
          </div>
          <table className="admin-ops__table">
            <thead>
              <tr>
                <th>Team</th>
                <th>Members</th>
                <th>Workspaces</th>
                <th>Score</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {csHealth.teams.map((team) => (
                <tr key={team.team}>
                  <td>{team.team}</td>
                  <td>{team.members}</td>
                  <td>{team.workspace_count}</td>
                  <td>{team.score}</td>
                  <td>{team.risk}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {csHealth.risk_indicators.length > 0 && (
            <>
              <h3>Risk Indicators</h3>
              <ul>
                {csHealth.risk_indicators.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {renewal && (
        <section className="admin-security__card">
          <h2>Renewal Value Report</h2>
          <div className="admin-ops__grid">
            <div>Renewal Health: {renewal.renewal_health}</div>
            <div>Stories (90d): {renewal.outcomes.stories_generated_90d}</div>
            <div>Published Pages (90d): {renewal.outcomes.pages_published_90d}</div>
            <div>Adoption (30d): {renewal.outcomes.adoption_rate_pct}%</div>
          </div>
          <p>{renewal.headline}</p>
          <p>{renewal.roi_narrative}</p>
        </section>
      )}
    </div>
  );
}
