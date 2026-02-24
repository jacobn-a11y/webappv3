import { useEffect, useState } from "react";
import {
  applySetupRolePresets,
  getFirstValueRecommendations,
  getSetupMvpQuickstartStatus,
  getSetupPlans,
  getSetupStatus,
  indexSetupMvpGongAccounts,
  saveSetupGovernanceDefaults,
  saveSetupMvpGongAccountSelection,
  saveSetupMvpQuickstartKeys,
  saveSetupOrgProfile,
  selectSetupPlan,
  type FirstValueRecommendations,
  type SetupMvpAccountRow,
  type SetupMvpQuickstartStatus,
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
  const [mvpStatus, setMvpStatus] = useState<SetupMvpQuickstartStatus | null>(null);
  const [gongApiKey, setGongApiKey] = useState("");
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [gongBaseUrl, setGongBaseUrl] = useState("https://api.gong.io");
  const [accountFilter, setAccountFilter] = useState("");
  const [accountRows, setAccountRows] = useState<SetupMvpAccountRow[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [savingMvpKeys, setSavingMvpKeys] = useState(false);
  const [indexingAccounts, setIndexingAccounts] = useState(false);
  const [savingSelection, setSavingSelection] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  const load = async () => {
    setError(null);
    try {
      const [statusRes, firstValueRes, plansRes, mvpRes] = await Promise.all([
        getSetupStatus(),
        getFirstValueRecommendations(),
        getSetupPlans(),
        getSetupMvpQuickstartStatus(),
      ]);
      setStatus(statusRes);
      setFirstValue(firstValueRes);
      setPlans(plansRes);
      setMvpStatus(mvpRes);
      setGongBaseUrl(mvpRes.gong_base_url || "https://api.gong.io");
      setAccountRows(mvpRes.account_index.accounts ?? []);
      setSelectedAccounts(mvpRes.selected_account_names ?? []);
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

  const saveMvpKeys = async () => {
    setSavingMvpKeys(true);
    setError(null);
    try {
      const result = await saveSetupMvpQuickstartKeys({
        gong_api_key: gongApiKey.trim(),
        openai_api_key: openaiApiKey.trim(),
        gong_base_url: gongBaseUrl.trim() || undefined,
      });
      setMvpStatus(result.status);
      setAccountRows(result.status.account_index.accounts ?? []);
      setSelectedAccounts(result.status.selected_account_names ?? []);
      setGongApiKey("");
      setOpenaiApiKey("");
      showToast("Gong and OpenAI keys saved", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save MVP setup keys");
    } finally {
      setSavingMvpKeys(false);
    }
  };

  const refreshMvpAccountIndex = async () => {
    setIndexingAccounts(true);
    setError(null);
    try {
      const result = await indexSetupMvpGongAccounts({ refresh: true });
      setAccountRows(result.accounts ?? []);
      showToast(
        `Indexed ${result.total_accounts} accounts from ${result.total_calls_indexed} calls`,
        "success"
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to index Gong accounts");
    } finally {
      setIndexingAccounts(false);
    }
  };

  const toggleSelectedAccount = (name: string) => {
    setSelectedAccounts((prev) =>
      prev.includes(name) ? prev.filter((row) => row !== name) : [...prev, name]
    );
  };

  const saveAccountSelection = async () => {
    setSavingSelection(true);
    setError(null);
    try {
      const result = await saveSetupMvpGongAccountSelection({
        account_names: selectedAccounts,
        trigger_ingest: true,
      });
      setSelectedAccounts(result.selected_account_names);
      showToast(
        result.ingest_started
          ? "Selection saved and Gong ingest started"
          : "Selection saved",
        "success"
      );
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save Gong account selection"
      );
    } finally {
      setSavingSelection(false);
    }
  };

  const completionScore = status?.completionScore ?? 0;
  const normalizedFilter = accountFilter.trim().toLowerCase();
  const visibleAccounts = accountRows.filter((row) =>
    normalizedFilter
      ? `${row.name} ${row.count}`.toLowerCase().includes(normalizedFilter)
      : true
  );
  const selectedSet = new Set(selectedAccounts);
  const selectedCallCount = accountRows
    .filter((row) => selectedSet.has(row.name))
    .reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="page">
      <div className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">Setup Wizard</h1>
          <p className="page__subtitle">Complete your organization setup to unlock all features</p>
        </div>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      <div className="card card--elevated">
        <div className="card__header">
          <div>
            <div className="card__title">MVP Quick Setup (Gong + OpenAI)</div>
            <div className="card__subtitle">
              Save two keys, index Gong accounts, select scope, then ingest.
            </div>
          </div>
          {mvpStatus && (
            <span
              className={`badge ${
                mvpStatus.gong_configured && mvpStatus.openai_configured
                  ? "badge--success"
                  : "badge--draft"
              }`}
            >
              {mvpStatus.gong_configured && mvpStatus.openai_configured
                ? "Configured"
                : "Needs Keys"}
            </span>
          )}
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <div className="form-group">
            <label className="form-group__label" htmlFor="setup-gong-api-key">Gong API Key Bundle</label>
            <input
              id="setup-gong-api-key"
              className="form-input"
              type="password"
              value={gongApiKey}
              onChange={(e) => setGongApiKey(e.target.value)}
              placeholder="accessKey:accessKeySecret"
              autoComplete="off"
              aria-label="Gong API key bundle"
            />
            <span className="form-group__hint">
              Format: `accessKey:accessKeySecret` or `Basic &lt;base64&gt;`.
            </span>
          </div>

          <div className="form-group">
            <label className="form-group__label" htmlFor="setup-openai-api-key">OpenAI API Key</label>
            <input
              id="setup-openai-api-key"
              className="form-input"
              type="password"
              value={openaiApiKey}
              onChange={(e) => setOpenaiApiKey(e.target.value)}
              placeholder="sk-..."
              autoComplete="off"
              aria-label="OpenAI API key"
            />
          </div>

          <div className="form-group">
            <label className="form-group__label" htmlFor="setup-gong-base-url">Gong Base URL (optional)</label>
            <input
              id="setup-gong-base-url"
              className="form-input"
              value={gongBaseUrl}
              onChange={(e) => setGongBaseUrl(e.target.value)}
              placeholder="https://api.gong.io"
              aria-label="Gong base URL"
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              className="btn btn--primary"
              onClick={saveMvpKeys}
              disabled={savingMvpKeys}
            >
              {savingMvpKeys ? "Saving..." : "Save Gong + OpenAI Keys"}
            </button>
          </div>
        </div>

        {mvpStatus && (
          <div style={{ marginTop: 14, display: "grid", gap: 8, fontSize: 13 }}>
            <div>
              Gong status: <strong>{formatEnumLabel(mvpStatus.gong_status)}</strong>
              {mvpStatus.gong_last_sync_at
                ? ` · Last sync ${new Date(mvpStatus.gong_last_sync_at).toLocaleString()}`
                : ""}
            </div>
            <div>
              OpenAI configured:{" "}
              <strong>{mvpStatus.openai_configured ? "Yes" : "No"}</strong>
            </div>
            {mvpStatus.gong_last_error && (
              <div style={{ color: "var(--color-danger)" }}>
                Last Gong error: {mvpStatus.gong_last_error}
              </div>
            )}
          </div>
        )}

        {(mvpStatus?.gong_configured ?? false) && (
          <div style={{ marginTop: 20 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <div style={{ fontWeight: 600 }}>Account Search & Selection</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={refreshMvpAccountIndex}
                  disabled={indexingAccounts}
                >
                  {indexingAccounts ? "Indexing..." : "Refresh Account Index"}
                </button>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() =>
                    setSelectedAccounts(visibleAccounts.map((row) => row.name))
                  }
                  type="button"
                >
                  Select Visible
                </button>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => setSelectedAccounts([])}
                  type="button"
                >
                  Clear
                </button>
              </div>
            </div>

            <input
              id="setup-account-filter"
              type="search"
              className="form-input"
              placeholder="Type to filter accounts..."
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
              aria-label="Filter indexed accounts"
            />

            <div
              style={{
                marginTop: 8,
                marginBottom: 8,
                fontSize: 13,
                color: "var(--color-text-secondary)",
              }}
            >
              {selectedAccounts.length} account
              {selectedAccounts.length === 1 ? "" : "s"} selected · {selectedCallCount} tagged
              call{selectedCallCount === 1 ? "" : "s"}
            </div>

            <div
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: 10,
                maxHeight: 280,
                overflowY: "auto",
                padding: 8,
              }}
            >
              {visibleAccounts.length === 0 ? (
                <div style={{ padding: "0.5rem", color: "var(--color-text-secondary)" }}>
                  {accountRows.length === 0
                    ? "No accounts indexed yet."
                    : "No accounts match your filter."}
                </div>
              ) : (
                visibleAccounts.map((row) => (
                  <label
                    key={row.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      borderRadius: 8,
                      padding: "0.45rem 0.55rem",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={selectedSet.has(row.name)}
                        onChange={() => toggleSelectedAccount(row.name)}
                        aria-label={`Select account ${row.name}`}
                      />
                      <span>{row.name}</span>
                    </span>
                    <span style={{ color: "var(--color-text-secondary)", fontSize: 12 }}>
                      {row.count} call{row.count === 1 ? "" : "s"}
                    </span>
                  </label>
                ))
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button
                className="btn btn--primary"
                onClick={saveAccountSelection}
                disabled={savingSelection || selectedAccounts.length === 0}
              >
                {savingSelection ? "Saving..." : "Save Selection & Ingest Calls"}
              </button>
            </div>
          </div>
        )}
      </div>

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
            <label className="form-group__label" htmlFor="setup-company-overview">Company Overview</label>
            <textarea id="setup-company-overview" className="form-textarea" value={companyOverview} onChange={(e) => setCompanyOverview(e.target.value)} rows={4} placeholder="Describe what your company does..." aria-label="Company overview" />
          </div>
          <div className="form-group">
            <label className="form-group__label" htmlFor="setup-products">Products</label>
            <input id="setup-products" className="form-input" value={products} onChange={(e) => setProducts(e.target.value)} placeholder="Product A, Product B, Product C" aria-label="Products list" />
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
