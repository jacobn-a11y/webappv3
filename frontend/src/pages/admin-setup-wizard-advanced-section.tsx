import type { FirstValueRecommendations, SetupPlanCatalog, SetupStatus } from "../lib/api";
import { formatEnumLabel } from "../lib/format";

interface AdminSetupWizardAdvancedSectionProps {
  show: boolean;
  status: SetupStatus | null;
  completionScore: number;
  companyOverview: string;
  products: string;
  saving: boolean;
  plans: SetupPlanCatalog | null;
  selectedPlan: "FREE_TRIAL" | "STARTER" | "PROFESSIONAL" | "ENTERPRISE";
  firstValue: FirstValueRecommendations | null;
  onCompanyOverviewChange: (value: string) => void;
  onProductsChange: (value: string) => void;
  onSaveOrgProfile: () => void;
  onSelectPlan: (plan: "FREE_TRIAL" | "STARTER" | "PROFESSIONAL" | "ENTERPRISE") => void;
  onContinuePlanSelection: () => void;
  onSaveGovernanceDefaults: () => void;
  onApplyRolePresets: () => void;
}

export function AdminSetupWizardAdvancedSection({
  show,
  status,
  completionScore,
  companyOverview,
  products,
  saving,
  plans,
  selectedPlan,
  firstValue,
  onCompanyOverviewChange,
  onProductsChange,
  onSaveOrgProfile,
  onSelectPlan,
  onContinuePlanSelection,
  onSaveGovernanceDefaults,
  onApplyRolePresets,
}: AdminSetupWizardAdvancedSectionProps) {
  if (!show) {
    return null;
  }

  return (
    <>
      {status && (
        <div className="card card--elevated">
          <div className="card__header">
            <div>
              <div className="card__title">Onboarding Progress</div>
              <div className="card__subtitle">Current step: {formatEnumLabel(status.currentStep)}</div>
            </div>
            <span
              className={`badge ${
                completionScore >= 80
                  ? "badge--success"
                  : completionScore >= 40
                    ? "badge--draft"
                    : "badge--error"
              }`}
            >
              {completionScore}% complete
            </span>
          </div>
          <div className="progress-bar" style={{ height: 10 }}>
            <div
              className={`progress-bar__fill${
                completionScore >= 80
                  ? " progress-bar__fill--success"
                  : completionScore >= 40
                    ? ""
                    : " progress-bar__fill--warning"
              }`}
              style={{ width: `${completionScore}%` }}
            />
          </div>
          {status.missingPrompts.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Remaining Steps</div>
              <div className="action-list">
                {status.missingPrompts.map((prompt) => (
                  <div className="action-item" key={prompt}>
                    <div className="action-item__icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                    </div>
                    <span className="action-item__text">{prompt}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card card--elevated">
        <div className="card__header">
          <div className="card__title">Organization Profile</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="form-group">
            <label className="form-group__label" htmlFor="setup-company-overview">
              Company Overview
            </label>
            <textarea
              id="setup-company-overview"
              className="form-textarea"
              value={companyOverview}
              onChange={(event) => onCompanyOverviewChange(event.target.value)}
              rows={4}
              placeholder="Describe what your company does..."
              aria-label="Company overview"
            />
          </div>
          <div className="form-group">
            <label className="form-group__label" htmlFor="setup-products">
              Products
            </label>
            <input
              id="setup-products"
              className="form-input"
              value={products}
              onChange={(event) => onProductsChange(event.target.value)}
              placeholder="Product A, Product B, Product C"
              aria-label="Products list"
            />
            <span className="form-group__hint">Comma-separated list of product names</span>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn--primary" onClick={onSaveOrgProfile} disabled={saving}>
              Save Profile
            </button>
          </div>
        </div>
      </div>

      {plans && (
        <div className="card card--elevated">
          <div className="card__header">
            <div>
              <div className="card__title">Plan Selection</div>
              <div className="card__subtitle">
                {plans.billing_enabled
                  ? "Billing is enabled for your organization"
                  : "Select a plan to get started"}
              </div>
            </div>
          </div>
          <div className="plan-card-grid">
            {plans.plans.map((plan) => (
              <div
                key={plan.id}
                className={`plan-card${selectedPlan === plan.id ? " plan-card--selected" : ""}`}
                onClick={() => onSelectPlan(plan.id as typeof selectedPlan)}
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
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--color-text-secondary)",
                      marginTop: 8,
                    }}
                  >
                    {plan.description}
                  </div>
                )}
                {plan.features && plan.features.length > 0 && (
                  <ul className="plan-card__features">
                    {plan.features.map((feature: string, index: number) => (
                      <li key={index}>{feature}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn--primary" onClick={onContinuePlanSelection} disabled={saving}>
              Continue with {formatEnumLabel(selectedPlan)}
            </button>
          </div>
        </div>
      )}

      <div className="card card--elevated">
        <div className="card__header">
          <div className="card__title">Quick Setup Actions</div>
          <div className="card__subtitle">Apply recommended defaults in one click</div>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button className="btn btn--secondary" onClick={onSaveGovernanceDefaults} disabled={saving}>
            Apply Governance Defaults
          </button>
          <button className="btn btn--secondary" onClick={onApplyRolePresets} disabled={saving}>
            Apply Role Presets
          </button>
        </div>
      </div>

      {firstValue && (
        <div className="card card--elevated">
          <div className="card__header">
            <div>
              <div className="card__title">First-Value Workflow</div>
              <div className="card__subtitle">Track your path to first value realization</div>
            </div>
            <span
              className={`badge ${
                firstValue.completion.first_value_complete ? "badge--success" : "badge--draft"
              }`}
            >
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
                {firstValue.starter_story_templates.map((template) => (
                  <div className="action-item" key={template.id}>
                    <div className="action-item__icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                        <polyline points="14,2 14,8 20,8" />
                      </svg>
                    </div>
                    <span className="action-item__text">{template.label}</span>
                    <span className="badge badge--accent">{formatEnumLabel(template.funnel_stage)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {firstValue.next_tasks.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Next Steps</div>
              <div className="action-list">
                {firstValue.next_tasks.map((task) => (
                  <div className="action-item" key={task}>
                    <div className="action-item__icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="9,11 12,14 22,4" />
                        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                      </svg>
                    </div>
                    <span className="action-item__text">{task}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
