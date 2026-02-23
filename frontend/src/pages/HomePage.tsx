import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getCustomerSuccessHealth,
  getRenewalValueReport,
  getRoleAwareHome,
  type CustomerSuccessHealth,
  type RenewalValueReport,
  type RoleAwareHome,
} from "../lib/api";
import { formatEnumLabel, formatNumber, badgeClass } from "../lib/format";

const PERSONA_LABELS: Record<RoleAwareHome["persona"], string> = {
  REVOPS_ADMIN: "RevOps Admin",
  MARKETING_ANALYST: "Marketing Analyst",
  SALES_MANAGER: "Sales Manager",
  CSM: "Customer Success Manager",
  EXEC: "Executive",
};

function mapActionToLink(action: string): string | null {
  const lower = action.toLowerCase();
  if (lower.includes("approv")) return "/admin/publish-approvals";
  if (lower.includes("story") || lower.includes("stories")) return "/accounts/acc_meridian";
  if (lower.includes("page")) return "/dashboard/pages";
  if (lower.includes("integration") || lower.includes("connect")) return "/admin/ops";
  if (lower.includes("security") || lower.includes("mfa")) return "/admin/security";
  if (lower.includes("billing") || lower.includes("subscription")) return "/admin/billing";
  if (lower.includes("role") || lower.includes("permission")) return "/admin/permissions";
  if (lower.includes("governance") || lower.includes("retention")) return "/admin/governance";
  if (lower.includes("analytics") || lower.includes("report")) return "/analytics";
  if (lower.includes("workspace")) return "/workspaces";
  if (lower.includes("setup") || lower.includes("onboard")) return "/admin/setup";
  return null;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

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
    return (
      <div className="state-view state-view--error" role="alert">
        <div className="state-view__icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
        </div>
        <div className="state-view__title">Failed to load dashboard</div>
        <div className="state-view__message">{error}</div>
        <div className="state-view__actions">
          <button className="btn btn--primary" onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="state-view" role="status" aria-live="polite">
        <div className="spinner" />
        <div className="state-view__title">Loading dashboard...</div>
      </div>
    );
  }

  const userName = data.user.role_profile_name || data.user.email?.split("@")[0] || "there";
  const persona = data.persona;

  // Route to persona-specific dashboard
  if (persona === "EXEC") {
    return <ExecDashboard data={data} csHealth={csHealth} renewal={renewal} userName={userName} />;
  }
  if (persona === "CSM") {
    return <CsmDashboard data={data} csHealth={csHealth} renewal={renewal} userName={userName} />;
  }
  if (persona === "MARKETING_ANALYST" || data.user.base_role === "MEMBER") {
    return <MemberDashboard data={data} userName={userName} />;
  }

  // Default: REVOPS_ADMIN / SALES_MANAGER — full admin dashboard
  return <AdminDashboard data={data} csHealth={csHealth} renewal={renewal} userName={userName} />;
}

// ─── EXEC Dashboard (KPIs Only) ──────────────────────────────────────────────

function ExecDashboard({
  data,
  csHealth,
  renewal,
  userName,
}: {
  data: RoleAwareHome;
  csHealth: CustomerSuccessHealth | null;
  renewal: RenewalValueReport | null;
  userName: string;
}) {
  return (
    <div className="page">
      <div className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">{getGreeting()}, {userName}</h1>
          <p className="page__subtitle">Executive Overview</p>
        </div>
      </div>

      {/* High-level KPIs */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card__icon kpi-card__icon--accent">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
          </div>
          <div className="kpi-card__content">
            <div className="kpi-card__label">Stories (30d)</div>
            <div className="kpi-card__value">{data.summary.stories_30d}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__icon kpi-card__icon--info">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14,2 14,8 20,8" /></svg>
          </div>
          <div className="kpi-card__content">
            <div className="kpi-card__label">Pages (30d)</div>
            <div className="kpi-card__value">{data.summary.pages_30d}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__icon kpi-card__icon--success">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
          </div>
          <div className="kpi-card__content">
            <div className="kpi-card__label">Total Page Views</div>
            <div className="kpi-card__value">{formatNumber(data.summary.total_page_views)}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__icon kpi-card__icon--accent">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22,4 12,14.01 9,11.01" /></svg>
          </div>
          <div className="kpi-card__content">
            <div className="kpi-card__label">Post-Sale Stories</div>
            <div className="kpi-card__value">{data.summary.post_sale_stories_30d}</div>
          </div>
        </div>
      </div>

      {/* Customer Health Summary */}
      {csHealth && (
        <div className="card card--elevated">
          <div className="card__header">
            <div>
              <div className="card__title">Customer Success Health</div>
              <div className="card__subtitle">Platform health at a glance</div>
            </div>
            <span className={badgeClass(csHealth.overall_score >= 80 ? "SUCCESS" : csHealth.overall_score >= 60 ? "WARNING" : "ERROR")}>
              Score: {csHealth.overall_score}
            </span>
          </div>
          <div className="kpi-grid" style={{ marginBottom: 20 }}>
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Onboarding</div>
                <div className="kpi-card__value">{csHealth.onboarding_progress_pct}%</div>
                <div className="progress-bar" style={{ marginTop: 8 }}>
                  <div className="progress-bar__fill" style={{ width: `${csHealth.onboarding_progress_pct}%` }} />
                </div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Adoption Rate</div>
                <div className="kpi-card__value">{csHealth.adoption_rate_pct}%</div>
                <div className="progress-bar" style={{ marginTop: 8 }}>
                  <div className={`progress-bar__fill${csHealth.adoption_rate_pct >= 70 ? " progress-bar__fill--success" : csHealth.adoption_rate_pct >= 40 ? " progress-bar__fill--warning" : " progress-bar__fill--error"}`} style={{ width: `${csHealth.adoption_rate_pct}%` }} />
                </div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Reliability</div>
                <div className="kpi-card__value">{csHealth.reliability_score}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Renewal Snapshot */}
      {renewal && (
        <div className="card card--elevated">
          <div className="card__header">
            <div>
              <div className="card__title">Renewal Readiness</div>
              <div className="card__subtitle">90-day outlook</div>
            </div>
            <span className={badgeClass(renewal.renewal_health)}>
              {formatEnumLabel(renewal.renewal_health)}
            </span>
          </div>
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Stories (90d)</div>
                <div className="kpi-card__value">{renewal.outcomes.stories_generated_90d}</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Pages Published</div>
                <div className="kpi-card__value">{renewal.outcomes.pages_published_90d}</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Adoption</div>
                <div className="kpi-card__value">{renewal.outcomes.adoption_rate_pct}%</div>
              </div>
            </div>
          </div>
          {renewal.headline && (
            <div className="callout callout--accent" style={{ marginTop: 16 }}>
              <div className="callout__title">{renewal.headline}</div>
              {renewal.roi_narrative && <p style={{ margin: "4px 0 0", fontSize: 13, opacity: 0.85 }}>{renewal.roi_narrative}</p>}
            </div>
          )}
        </div>
      )}

      {/* Quick Links */}
      <div className="home-cta-row">
        <Link to="/analytics" className="home-cta">
          <div className="home-cta__icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
          </div>
          <div className="home-cta__text">
            <span className="home-cta__label">View Full Analytics</span>
            <span className="home-cta__hint">Detailed KPIs and performance metrics</span>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9,18 15,12 9,6" /></svg>
        </Link>
        <Link to="/accounts/acc_meridian" className="home-cta">
          <div className="home-cta__icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
          </div>
          <div className="home-cta__text">
            <span className="home-cta__label">Account Journeys</span>
            <span className="home-cta__hint">Review customer health and call history</span>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9,18 15,12 9,6" /></svg>
        </Link>
      </div>
    </div>
  );
}

// ─── CSM Dashboard (Customer Health + Renewals) ──────────────────────────────

function CsmDashboard({
  data,
  csHealth,
  renewal,
  userName,
}: {
  data: RoleAwareHome;
  csHealth: CustomerSuccessHealth | null;
  renewal: RenewalValueReport | null;
  userName: string;
}) {
  return (
    <div className="page">
      <div className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">{getGreeting()}, {userName}</h1>
          <p className="page__subtitle">Customer Success Dashboard</p>
        </div>
      </div>

      {/* Customer Health — Primary Section */}
      {csHealth && (
        <div className="card card--elevated">
          <div className="card__header">
            <div>
              <div className="card__title">Customer Success Health</div>
              <div className="card__subtitle">Platform adoption and reliability metrics</div>
            </div>
            <span className={badgeClass(csHealth.overall_score >= 80 ? "SUCCESS" : csHealth.overall_score >= 60 ? "WARNING" : "ERROR")}>
              Score: {csHealth.overall_score}
            </span>
          </div>

          <div className="kpi-grid" style={{ marginBottom: 20 }}>
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Onboarding</div>
                <div className="kpi-card__value">{csHealth.onboarding_progress_pct}%</div>
                <div className="progress-bar" style={{ marginTop: 8 }}>
                  <div className="progress-bar__fill" style={{ width: `${csHealth.onboarding_progress_pct}%` }} />
                </div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Adoption Rate</div>
                <div className="kpi-card__value">{csHealth.adoption_rate_pct}%</div>
                <div className="progress-bar" style={{ marginTop: 8 }}>
                  <div className={`progress-bar__fill${csHealth.adoption_rate_pct >= 70 ? " progress-bar__fill--success" : csHealth.adoption_rate_pct >= 40 ? " progress-bar__fill--warning" : " progress-bar__fill--error"}`} style={{ width: `${csHealth.adoption_rate_pct}%` }} />
                </div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Reliability</div>
                <div className="kpi-card__value">{csHealth.reliability_score}</div>
              </div>
            </div>
          </div>

          {/* Teams table */}
          <div className="table-container">
            <table className="data-table data-table--compact">
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
                    <td><strong>{formatEnumLabel(team.team)}</strong></td>
                    <td>{team.members}</td>
                    <td>{team.workspace_count}</td>
                    <td>{team.score}</td>
                    <td>
                      <span className={badgeClass(team.risk === "LOW" ? "SUCCESS" : team.risk === "MEDIUM" ? "WARNING" : "ERROR")}>
                        {formatEnumLabel(team.risk)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {csHealth.risk_indicators.length > 0 && (
            <div className="callout callout--warning" style={{ marginTop: 16 }}>
              <div className="callout__title">Risk Indicators</div>
              <ul style={{ margin: "8px 0 0 16px", fontSize: 13 }}>
                {csHealth.risk_indicators.map((item) => (
                  <li key={item} style={{ marginBottom: 4 }}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Renewal Value Report */}
      {renewal && (
        <div className="card card--elevated">
          <div className="card__header">
            <div>
              <div className="card__title">Renewal Value Report</div>
              <div className="card__subtitle">90-day outcome metrics and renewal readiness</div>
            </div>
            <span className={badgeClass(renewal.renewal_health)}>
              {formatEnumLabel(renewal.renewal_health)}
            </span>
          </div>

          <div className="kpi-grid" style={{ marginBottom: 20 }}>
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Stories (90d)</div>
                <div className="kpi-card__value">{renewal.outcomes.stories_generated_90d}</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Pages Published (90d)</div>
                <div className="kpi-card__value">{renewal.outcomes.pages_published_90d}</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Adoption (30d)</div>
                <div className="kpi-card__value">{renewal.outcomes.adoption_rate_pct}%</div>
              </div>
            </div>
          </div>

          {renewal.headline && (
            <div className="callout callout--accent" style={{ marginBottom: 12 }}>
              <div className="callout__title">{renewal.headline}</div>
              {renewal.roi_narrative && <p style={{ margin: "4px 0 0", fontSize: 13, opacity: 0.85 }}>{renewal.roi_narrative}</p>}
            </div>
          )}
        </div>
      )}

      {/* Quick Actions */}
      <div className="home-cta-row">
        <Link to="/accounts/acc_meridian" className="home-cta home-cta--primary">
          <div className="home-cta__icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
          </div>
          <div className="home-cta__text">
            <span className="home-cta__label">Account Journeys</span>
            <span className="home-cta__hint">Review customer health and call history</span>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9,18 15,12 9,6" /></svg>
        </Link>
        <Link to="/workspaces" className="home-cta">
          <div className="home-cta__icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
          </div>
          <div className="home-cta__text">
            <span className="home-cta__label">Workspaces</span>
            <span className="home-cta__hint">Team workspaces and shared assets</span>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9,18 15,12 9,6" /></svg>
        </Link>
      </div>

      {/* Summary KPIs */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card__icon kpi-card__icon--accent">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22,4 12,14.01 9,11.01" /></svg>
          </div>
          <div className="kpi-card__content">
            <div className="kpi-card__label">Post-Sale Stories</div>
            <div className="kpi-card__value">{data.summary.post_sale_stories_30d}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__icon kpi-card__icon--info">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14,2 14,8 20,8" /></svg>
          </div>
          <div className="kpi-card__content">
            <div className="kpi-card__label">Pages (30d)</div>
            <div className="kpi-card__value">{data.summary.pages_30d}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__icon kpi-card__icon--success">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
          </div>
          <div className="kpi-card__content">
            <div className="kpi-card__label">Page Views</div>
            <div className="kpi-card__value">{formatNumber(data.summary.total_page_views)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MEMBER Dashboard (My Stories, Recent Pages) ─────────────────────────────

function MemberDashboard({
  data,
  userName,
}: {
  data: RoleAwareHome;
  userName: string;
}) {
  return (
    <div className="page">
      <div className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">{getGreeting()}, {userName}</h1>
          <p className="page__subtitle">Content Creator Dashboard</p>
        </div>
      </div>

      {/* Quick Actions — Primary CTA */}
      <div className="home-cta-row">
        <Link to="/accounts/acc_meridian" className="home-cta home-cta--primary">
          <div className="home-cta__icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
          </div>
          <div className="home-cta__text">
            <span className="home-cta__label">Generate Story</span>
            <span className="home-cta__hint">Create a new story from account calls</span>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9,18 15,12 9,6" /></svg>
        </Link>
        <Link to="/dashboard/pages" className="home-cta">
          <div className="home-cta__icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14,2 14,8 20,8" /></svg>
          </div>
          <div className="home-cta__text">
            <span className="home-cta__label">My Landing Pages</span>
            <span className="home-cta__hint">View and manage published pages</span>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9,18 15,12 9,6" /></svg>
        </Link>
        <Link to="/analytics" className="home-cta">
          <div className="home-cta__icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
          </div>
          <div className="home-cta__text">
            <span className="home-cta__label">Analytics</span>
            <span className="home-cta__hint">View content performance metrics</span>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9,18 15,12 9,6" /></svg>
        </Link>
      </div>

      {/* My Content KPIs */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card__icon kpi-card__icon--accent">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
          </div>
          <div className="kpi-card__content">
            <div className="kpi-card__label">Stories (30d)</div>
            <div className="kpi-card__value">{data.summary.stories_30d}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__icon kpi-card__icon--info">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14,2 14,8 20,8" /></svg>
          </div>
          <div className="kpi-card__content">
            <div className="kpi-card__label">Pages (30d)</div>
            <div className="kpi-card__value">{data.summary.pages_30d}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__icon kpi-card__icon--success">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
          </div>
          <div className="kpi-card__content">
            <div className="kpi-card__label">Page Views</div>
            <div className="kpi-card__value">{formatNumber(data.summary.total_page_views)}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__icon kpi-card__icon--accent">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22,4 12,14.01 9,11.01" /></svg>
          </div>
          <div className="kpi-card__content">
            <div className="kpi-card__label">Post-Sale Stories</div>
            <div className="kpi-card__value">{data.summary.post_sale_stories_30d}</div>
          </div>
        </div>
      </div>

      {/* Recommended Actions */}
      {data.recommended_actions.length > 0 && (
        <RecommendedActions actions={data.recommended_actions} />
      )}
    </div>
  );
}

// ─── Admin/Default Dashboard (Full View) ─────────────────────────────────────

function AdminDashboard({
  data,
  csHealth,
  renewal,
  userName,
}: {
  data: RoleAwareHome;
  csHealth: CustomerSuccessHealth | null;
  renewal: RenewalValueReport | null;
  userName: string;
}) {
  return (
    <div className="page">
      {/* Header with greeting */}
      <div className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">{getGreeting()}, {userName}</h1>
          <p className="page__subtitle">
            {PERSONA_LABELS[data.persona]} Dashboard
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card__icon kpi-card__icon--accent">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
          </div>
          <div className="kpi-card__content">
            <div className="kpi-card__label">Stories (30d)</div>
            <div className="kpi-card__value">{data.summary.stories_30d}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__icon kpi-card__icon--info">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14,2 14,8 20,8" /></svg>
          </div>
          <div className="kpi-card__content">
            <div className="kpi-card__label">Pages (30d)</div>
            <div className="kpi-card__value">{data.summary.pages_30d}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__icon kpi-card__icon--success">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
          </div>
          <div className="kpi-card__content">
            <div className="kpi-card__label">Page Views</div>
            <div className="kpi-card__value">{formatNumber(data.summary.total_page_views)}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__icon kpi-card__icon--warning">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          </div>
          <div className="kpi-card__content">
            <div className="kpi-card__label">Pending Approvals</div>
            <div className="kpi-card__value">{data.summary.pending_approvals}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__icon kpi-card__icon--error">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
          </div>
          <div className="kpi-card__content">
            <div className="kpi-card__label">Failed Integrations</div>
            <div className="kpi-card__value">{data.summary.failed_integrations}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__icon kpi-card__icon--accent">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22,4 12,14.01 9,11.01" /></svg>
          </div>
          <div className="kpi-card__content">
            <div className="kpi-card__label">Post-Sale Stories</div>
            <div className="kpi-card__value">{data.summary.post_sale_stories_30d}</div>
          </div>
        </div>
      </div>

      {/* Recommended Actions */}
      {data.recommended_actions.length > 0 && (
        <RecommendedActions actions={data.recommended_actions} />
      )}

      {/* Customer Success Health */}
      {csHealth && (
        <div className="card card--elevated">
          <div className="card__header">
            <div>
              <div className="card__title">Customer Success Health</div>
              <div className="card__subtitle">Platform adoption and reliability metrics</div>
            </div>
            <span className={badgeClass(csHealth.overall_score >= 80 ? "SUCCESS" : csHealth.overall_score >= 60 ? "WARNING" : "ERROR")}>
              Score: {csHealth.overall_score}
            </span>
          </div>
          <div className="kpi-grid" style={{ marginBottom: 20 }}>
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Onboarding</div>
                <div className="kpi-card__value">{csHealth.onboarding_progress_pct}%</div>
                <div className="progress-bar" style={{ marginTop: 8 }}>
                  <div className="progress-bar__fill" style={{ width: `${csHealth.onboarding_progress_pct}%` }} />
                </div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Adoption Rate</div>
                <div className="kpi-card__value">{csHealth.adoption_rate_pct}%</div>
                <div className="progress-bar" style={{ marginTop: 8 }}>
                  <div className={`progress-bar__fill${csHealth.adoption_rate_pct >= 70 ? " progress-bar__fill--success" : csHealth.adoption_rate_pct >= 40 ? " progress-bar__fill--warning" : " progress-bar__fill--error"}`} style={{ width: `${csHealth.adoption_rate_pct}%` }} />
                </div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Reliability</div>
                <div className="kpi-card__value">{csHealth.reliability_score}</div>
              </div>
            </div>
          </div>
          <div className="table-container">
            <table className="data-table data-table--compact">
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
                    <td><strong>{formatEnumLabel(team.team)}</strong></td>
                    <td>{team.members}</td>
                    <td>{team.workspace_count}</td>
                    <td>{team.score}</td>
                    <td>
                      <span className={badgeClass(team.risk === "LOW" ? "SUCCESS" : team.risk === "MEDIUM" ? "WARNING" : "ERROR")}>
                        {formatEnumLabel(team.risk)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {csHealth.risk_indicators.length > 0 && (
            <div className="callout callout--warning" style={{ marginTop: 16 }}>
              <div className="callout__title">Risk Indicators</div>
              <ul style={{ margin: "8px 0 0 16px", fontSize: 13 }}>
                {csHealth.risk_indicators.map((item) => (
                  <li key={item} style={{ marginBottom: 4 }}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Renewal Value Report */}
      {renewal && (
        <div className="card card--elevated">
          <div className="card__header">
            <div>
              <div className="card__title">Renewal Value Report</div>
              <div className="card__subtitle">90-day outcome metrics and renewal readiness</div>
            </div>
            <span className={badgeClass(renewal.renewal_health)}>
              {formatEnumLabel(renewal.renewal_health)}
            </span>
          </div>
          <div className="kpi-grid" style={{ marginBottom: 20 }}>
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Stories (90d)</div>
                <div className="kpi-card__value">{renewal.outcomes.stories_generated_90d}</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Pages Published (90d)</div>
                <div className="kpi-card__value">{renewal.outcomes.pages_published_90d}</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Adoption (30d)</div>
                <div className="kpi-card__value">{renewal.outcomes.adoption_rate_pct}%</div>
              </div>
            </div>
          </div>
          {renewal.headline && (
            <div className="callout callout--accent" style={{ marginBottom: 12 }}>
              <div className="callout__title">{renewal.headline}</div>
              {renewal.roi_narrative && <p style={{ margin: "4px 0 0", fontSize: 13, opacity: 0.85 }}>{renewal.roi_narrative}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Shared Components ───────────────────────────────────────────────────────

function RecommendedActions({ actions }: { actions: string[] }) {
  return (
    <div className="card card--elevated">
      <div className="card__header">
        <div>
          <div className="card__title">Recommended Next Actions</div>
          <div className="card__subtitle">{actions.length} items to review</div>
        </div>
      </div>
      <div className="action-list">
        {actions.map((item, i) => {
          const actionLink = mapActionToLink(item);
          const content = (
            <>
              <div className="action-item__icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9,11 12,14 22,4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>
              </div>
              <span className="action-item__text">{item}</span>
              <div className="action-item__chevron">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9,18 15,12 9,6" /></svg>
              </div>
            </>
          );
          return actionLink ? (
            <Link to={actionLink} className="action-item action-item--link" key={i}>
              {content}
            </Link>
          ) : (
            <div className="action-item" key={i}>
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
