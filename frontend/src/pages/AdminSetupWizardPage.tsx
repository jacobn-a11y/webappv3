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
  const [notice, setNotice] = useState<string | null>(null);

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
    setNotice(null);
    try {
      await saveSetupOrgProfile({
        company_overview: companyOverview,
        products: products
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setNotice("Org profile setup saved.");
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
    setNotice(null);
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
      setNotice("Governance defaults applied.");
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
    setNotice(null);
    try {
      await applySetupRolePresets();
      setNotice("Role presets applied.");
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
    setNotice(null);
    try {
      const result = await selectSetupPlan(selectedPlan);
      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      setNotice("Plan selection saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to select plan");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-security__page">
      <h1 className="admin-security__title">Setup Wizard</h1>
      {error && <div className="admin-story-context__error">{error}</div>}
      {notice && <div className="admin-story-context__notice">{notice}</div>}

      <section className="admin-security__card">
        <h2>Onboarding Completion</h2>
        <div>Score: {status?.completionScore ?? 0}%</div>
        <div>Current Step: {status?.currentStep ?? "-"}</div>
        {status && status.missingPrompts.length > 0 && (
          <ul>
            {status.missingPrompts.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="admin-security__card">
        <h2>Org Profile Setup</h2>
        <label className="admin-security__field">
          Company Overview
          <textarea
            value={companyOverview}
            onChange={(e) => setCompanyOverview(e.target.value)}
            rows={4}
          />
        </label>
        <label className="admin-security__field">
          Products (comma-separated)
          <input
            value={products}
            onChange={(e) => setProducts(e.target.value)}
            placeholder="Product A, Product B"
          />
        </label>
        <button className="btn btn--secondary" onClick={saveOrgProfile} disabled={saving}>
          Save Org Profile
        </button>
      </section>

      <section className="admin-security__card">
        <h2>Plan & Checkout</h2>
        <div>Billing Enabled: {plans?.billing_enabled ? "Yes" : "No"}</div>
        <label className="admin-security__field">
          Selected Plan
          <select
            value={selectedPlan}
            onChange={(e) =>
              setSelectedPlan(
                e.target.value as "FREE_TRIAL" | "STARTER" | "PROFESSIONAL" | "ENTERPRISE"
              )
            }
          >
            {plans?.plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn--primary" onClick={continuePlanSelection} disabled={saving}>
          Continue Plan Setup
        </button>
      </section>

      <section className="admin-security__card">
        <h2>Preset Setup Actions</h2>
        <div className="admin-security__inline">
          <button className="btn btn--secondary" onClick={saveGovernanceDefaults} disabled={saving}>
            Apply Governance Defaults
          </button>
          <button className="btn btn--secondary" onClick={applyRolePresets} disabled={saving}>
            Apply Role Presets
          </button>
        </div>
      </section>

      <section className="admin-security__card">
        <h2>First-Value Workflow</h2>
        {firstValue && (
          <>
            <div className="admin-ops__grid">
              <div>Stories Generated: {firstValue.completion.stories_generated}</div>
              <div>Pages Published: {firstValue.completion.pages_published}</div>
              <div>
                Complete: {firstValue.completion.first_value_complete ? "Yes" : "No"}
              </div>
            </div>
            <h3>Starter Templates</h3>
            <ul>
              {firstValue.starter_story_templates.map((t) => (
                <li key={t.id}>
                  {t.label} ({t.funnel_stage})
                </li>
              ))}
            </ul>
            <h3>Next Tasks</h3>
            <ul>
              {firstValue.next_tasks.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
