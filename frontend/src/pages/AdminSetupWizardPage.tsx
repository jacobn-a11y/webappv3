import { useEffect, useState } from "react";
import {
  applySetupRolePresets,
  getFirstValueRecommendations,
  getSetupPlans,
  getSetupStatus,
  saveSetupGovernanceDefaults,
  saveSetupOrgProfile,
  selectSetupPlan,
  type FirstValueRecommendations,
  type SetupPlanCatalog,
  type SetupStatus,
} from "../lib/api";
import { useToast } from "../components/Toast";
import { formatEnumLabel } from "../lib/format";

export function AdminSetupWizardPage() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [plans, setPlans] = useState<SetupPlanCatalog | null>(null);
  const [firstValue, setFirstValue] = useState<FirstValueRecommendations | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<
    "FREE_TRIAL" | "STARTER" | "PROFESSIONAL" | "ENTERPRISE"
  >("STARTER");
  const [companyOverview, setCompanyOverview] = useState("");
  const [products, setProducts] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  const load = async () => {
    setError(null);
    try {
      const [statusRes, firstValueRes, plansRes] = await Promise.all([
        getSetupStatus(),
        getFirstValueRecommendations(),
        getSetupPlans(),
      ]);
      setStatus(statusRes);
      setFirstValue(firstValueRes);
      setPlans(plansRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load setup data");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const saveOrgProfile = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveSetupOrgProfile({
        company_overview: companyOverview,
        products: products.split(",").map((s) => s.trim()).filter(Boolean),
      });
      showToast("Organization profile saved", "success");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save org profile");
    } finally {
      setSaving(false);
    }
  };

  const saveGovernanceDefaults = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveSetupGovernanceDefaults({
        retention_days: 365,
        audit_log_retention_days: 365,
        legal_hold_enabled: false,
        pii_export_enabled: true,
        deletion_requires_approval: true,
        allow_named_story_exports: false,
        rto_target_minutes: 240,
        rpo_target_minutes: 60,
      });
      showToast("Governance defaults applied", "success");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply governance defaults");
    } finally {
      setSaving(false);
    }
  };

  const applyRolePresets = async () => {
    setSaving(true);
    setError(null);
    try {
      await applySetupRolePresets();
      showToast("Role presets applied", "success");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply role presets");
    } finally {
      setSaving(false);
    }
  };

  const continuePlanSelection = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await selectSetupPlan(selectedPlan);
      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      showToast("Plan selection saved", "success");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to select plan");
    } finally {
      setSaving(false);
    }
  };

  const completionScore = status?.completionScore ?? 0;

  return (
    <div className="page">
      <div className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">Setup Wizard</h1>
          <p className="page__subtitle">Complete your organization setup to unlock all features</p>
        </div>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {/* Progress */}
      {status && (
        <div className="card card--elevated">
          <div className="card__header">
            <div>
              <div className="card__title">Onboarding Progress</div>
              <div className="card__subtitle">Current step: {formatEnumLabel(status.currentStep)}</div>
            </div>
            <span className={`badge ${completionScore >= 80 ? "badge--success" : completionScore >= 40 ? "badge--draft" : "badge--error"}`}>
              {completionScore}% complete
            </span>
          </div>
          <div className="progress-bar" style={{ height: 10 }}>
            <div
              className={`progress-bar__fill${completionScore >= 80 ? " progress-bar__fill--success" : completionScore >= 40 ? "" : " progress-bar__fill--warning"}`}
              style={{ width: `${completionScore}%` }}
            />
          </div>
          {status.missingPrompts.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Remaining Steps</div>
              <div className="action-list">
                {status.missingPrompts.map((p) => (
                  <div className="action-item" key={p}>
                    <div className="action-item__icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                    </div>
                    <span className="action-item__text">{p}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Org Profile */}
      <div className="card card--elevated">
        <div className="card__header">
          <div className="card__title">Organization Profile</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="form-group">
            <label className="form-group__label">Company Overview</label>
            <textarea className="form-textarea" value={companyOverview} onChange={(e) => setCompanyOverview(e.target.value)} rows={4} placeholder="Describe what your company does..." />
          </div>
          <div className="form-group">
            <label className="form-group__label">Products</label>
            <input className="form-input" value={products} onChange={(e) => setProducts(e.target.value)} placeholder="Product A, Product B, Product C" />
            <span className="form-group__hint">Comma-separated list of product names</span>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn--primary" onClick={saveOrgProfile} disabled={saving}>Save Profile</button>
          </div>
        </div>
      </div>

      {/* Plan Selection */}
      {plans && (
        <div className="card card--elevated">
          <div className="card__header">
            <div>
              <div className="card__title">Plan Selection</div>
              <div className="card__subtitle">
                {plans.billing_enabled ? "Billing is enabled for your organization" : "Select a plan to get started"}
              </div>
            </div>
          </div>
          <div className="plan-card-grid">
            {plans.plans.map((plan) => (
              <div
                key={plan.id}
                className={`plan-card${selectedPlan === plan.id ? " plan-card--selected" : ""}`}
                onClick={() => setSelectedPlan(plan.id as typeof selectedPlan)}
              >
                <div className="plan-card__name">{plan.name}</div>
                {plan.price != null && (
                  <div className="plan-card__price">
                    {typeof plan.price === "object" && plan.price.amount != null
                      ? `$${plan.price.amount}/${plan.price.interval ?? "mo"}`
                      : plan.price === 0
                        ? "Free"
                        : `$${plan.price}/mo`}
                  </div>
                )}
                {plan.price == null && <div className="plan-card__price">Free</div>}
                {plan.description && (
                  <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 8 }}>{plan.description}</div>
                )}
                {plan.features && plan.features.length > 0 && (
                  <ul className="plan-card__features">
                    {plan.features.map((f: string, i: number) => <li key={i}>{f}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn--primary" onClick={continuePlanSelection} disabled={saving}>
              Continue with {formatEnumLabel(selectedPlan)}
            </button>
          </div>
        </div>
      )}

      {/* Quick Setup Actions */}
      <div className="card card--elevated">
        <div className="card__header">
          <div className="card__title">Quick Setup Actions</div>
          <div className="card__subtitle">Apply recommended defaults in one click</div>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button className="btn btn--secondary" onClick={saveGovernanceDefaults} disabled={saving}>
            Apply Governance Defaults
          </button>
          <button className="btn btn--secondary" onClick={applyRolePresets} disabled={saving}>
            Apply Role Presets
          </button>
        </div>
      </div>

      {/* First Value Workflow */}
      {firstValue && (
        <div className="card card--elevated">
          <div className="card__header">
            <div>
              <div className="card__title">First-Value Workflow</div>
              <div className="card__subtitle">Track your path to first value realization</div>
            </div>
            <span className={`badge ${firstValue.completion.first_value_complete ? "badge--success" : "badge--draft"}`}>
              {firstValue.completion.first_value_complete ? "Complete" : "In Progress"}
            </span>
          </div>

          <div className="kpi-grid" style={{ marginBottom: 20 }}>
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Stories Generated</div>
                <div className="kpi-card__value">{firstValue.completion.stories_generated}</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Pages Published</div>
                <div className="kpi-card__value">{firstValue.completion.pages_published}</div>
              </div>
            </div>
          </div>

          {firstValue.starter_story_templates.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Starter Templates</div>
              <div className="action-list">
                {firstValue.starter_story_templates.map((t) => (
                  <div className="action-item" key={t.id}>
                    <div className="action-item__icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14,2 14,8 20,8" /></svg>
                    </div>
                    <span className="action-item__text">{t.label}</span>
                    <span className="badge badge--accent">{formatEnumLabel(t.funnel_stage)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {firstValue.next_tasks.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Next Steps</div>
              <div className="action-list">
                {firstValue.next_tasks.map((t) => (
                  <div className="action-item" key={t}>
                    <div className="action-item__icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9,11 12,14 22,4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>
                    </div>
                    <span className="action-item__text">{t}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
