import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  applySetupRolePresets,
  completeSetupCrmConnection,
  completeSetupRecordingProvider,
  completeSettingsIntegrationLink,
  createSettingsIntegrationLinkToken,
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
  skipSetupStep,
  type FirstValueRecommendations,
  type SetupMvpAccountRow,
  type SetupMvpQuickstartStatus,
  type SetupPlanCatalog,
  type SetupStatus,
} from "../lib/api";
import { useToast } from "../components/Toast";
import { AdminErrorState } from "../components/admin/AdminErrorState";
import { MergeLinkModal } from "../components/MergeLinkModal";
import { mapCrmProvider, mapRecordingProvider } from "../lib/merge-provider-map";
import { AdminSetupWizardMvpSection } from "./admin-setup-wizard-mvp-section";
import { AdminSetupWizardAdvancedSection } from "./admin-setup-wizard-advanced-section";

export function AdminSetupWizardPage() {
  type MergeLinkState = {
    category: "crm" | "filestorage";
    linkToken: string;
  };

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
  const [showAdvancedSetup, setShowAdvancedSetup] = useState(false);
  const [mergeLink, setMergeLink] = useState<MergeLinkState | null>(null);
  const [connectingMerge, setConnectingMerge] = useState(false);
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

  const openMergeLink = async (category: "crm" | "filestorage") => {
    setError(null);
    try {
      const token = await createSettingsIntegrationLinkToken({ category });
      setMergeLink({ category, linkToken: token.link_token });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initialize Merge Link");
    }
  };

  const completeMergeSetupStep = async (publicToken: string) => {
    if (!mergeLink) return;

    setConnectingMerge(true);
    setError(null);
    try {
      const response = await completeSettingsIntegrationLink({
        public_token: publicToken,
        category: mergeLink.category,
      });
      const linked = response.integration;

      if (mergeLink.category === "filestorage") {
        await completeSetupRecordingProvider({
          provider: mapRecordingProvider(linked.integration),
          merge_linked_account_id: linked.merge_account_id,
        });
        showToast("Recording provider connected via Merge", "success");
      } else {
        await completeSetupCrmConnection({
          crm_provider: mapCrmProvider(linked.integration),
          merge_linked_account_id: linked.merge_account_id,
        });
        showToast("CRM connected via Merge", "success");
      }

      setMergeLink(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete Merge setup");
      throw err;
    } finally {
      setConnectingMerge(false);
    }
  };

  const skipCrmSetup = async () => {
    setSaving(true);
    setError(null);
    try {
      await skipSetupStep("CRM");
      showToast("CRM step skipped. You can connect later in Integrations.", "success");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to skip CRM step");
    } finally {
      setSaving(false);
    }
  };

  const completionScore = status?.completionScore ?? 0;
  const mvpReadyForIngest = Boolean(
    (mvpStatus?.gong_configured ?? false) && (mvpStatus?.openai_configured ?? false)
  );
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

      {error && (
        <AdminErrorState
          title="Setup Action Failed"
          message={error}
          onRetry={() => void load()}
        />
      )}

      {firstValue?.contextual_prompts && firstValue.contextual_prompts.length > 0 && (
        <div className="card card--elevated">
          <div className="card__header">
            <div>
              <div className="card__title">First Value Fast Path</div>
              <div className="card__subtitle">
                Follow these guided actions to reach first story + first share quickly.
              </div>
            </div>
          </div>
          <div className="action-list">
            {firstValue.contextual_prompts.map((prompt) => (
              <div className="action-item" key={prompt.id}>
                <div className="action-item__icon">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 8v4" />
                    <path d="M12 16h.01" />
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{prompt.title}</div>
                  <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                    {prompt.detail}
                  </div>
                </div>
                <span
                  className={`badge ${
                    prompt.status === "DONE"
                      ? "badge--success"
                      : prompt.status === "READY"
                        ? "badge--accent"
                        : "badge--draft"
                  }`}
                >
                  {prompt.status === "DONE"
                    ? "Done"
                    : prompt.status === "READY"
                      ? "Ready"
                      : "Blocked"}
                </span>
                <Link to={prompt.cta_path} className="btn btn--ghost btn--sm">
                  {prompt.cta_label}
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card card--elevated">
        <div className="card__header">
          <div>
            <div className="card__title">Merge.dev Connection Path (Recommended)</div>
            <div className="card__subtitle">
              Connect recording + CRM providers through Merge Link. You can still use MVP quickstart below.
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              className="btn btn--primary"
              type="button"
              onClick={() => void openMergeLink("filestorage")}
              disabled={connectingMerge}
            >
              Connect Recording Provider
            </button>
            <button
              className="btn btn--secondary"
              type="button"
              onClick={() => void openMergeLink("crm")}
              disabled={connectingMerge}
            >
              Connect CRM
            </button>
            <button
              className="btn btn--ghost"
              type="button"
              onClick={skipCrmSetup}
              disabled={saving || status?.currentStep !== "CRM"}
            >
              Skip CRM for now
            </button>
          </div>

          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", display: "grid", gap: 4 }}>
            <div>
              Recording status:{" "}
              <strong>
                {status?.steps.recording_provider.complete
                  ? status.steps.recording_provider.provider ?? "Connected"
                  : "Not connected"}
              </strong>
            </div>
            <div>
              CRM status:{" "}
              <strong>
                {status?.steps.crm.complete
                  ? status.steps.crm.provider ?? "Connected"
                  : "Not connected"}
              </strong>
            </div>
          </div>

          <Link to="/admin/settings/integrations" className="btn btn--ghost btn--sm" style={{ width: "fit-content" }}>
            Manage integrations in Settings
          </Link>
        </div>
      </div>

      <AdminSetupWizardMvpSection
        showAdvancedSetup={showAdvancedSetup}
        mvpStatus={mvpStatus}
        mvpReadyForIngest={mvpReadyForIngest}
        gongApiKey={gongApiKey}
        openaiApiKey={openaiApiKey}
        gongBaseUrl={gongBaseUrl}
        savingMvpKeys={savingMvpKeys}
        indexingAccounts={indexingAccounts}
        accountFilter={accountFilter}
        visibleAccounts={visibleAccounts}
        selectedAccounts={selectedAccounts}
        selectedCallCount={selectedCallCount}
        accountRows={accountRows}
        selectedSet={selectedSet}
        savingSelection={savingSelection}
        onToggleAdvanced={() => setShowAdvancedSetup((prev) => !prev)}
        onGongApiKeyChange={setGongApiKey}
        onOpenAiApiKeyChange={setOpenaiApiKey}
        onGongBaseUrlChange={setGongBaseUrl}
        onSaveMvpKeys={() => void saveMvpKeys()}
        onRefreshMvpAccountIndex={() => void refreshMvpAccountIndex()}
        onSelectVisible={() => setSelectedAccounts(visibleAccounts.map((row) => row.name))}
        onClearSelection={() => setSelectedAccounts([])}
        onAccountFilterChange={setAccountFilter}
        onToggleSelectedAccount={toggleSelectedAccount}
        onSaveAccountSelection={() => void saveAccountSelection()}
      />

      <AdminSetupWizardAdvancedSection
        show={showAdvancedSetup}
        status={status}
        completionScore={completionScore}
        companyOverview={companyOverview}
        products={products}
        saving={saving}
        plans={plans}
        selectedPlan={selectedPlan}
        firstValue={firstValue}
        onCompanyOverviewChange={setCompanyOverview}
        onProductsChange={setProducts}
        onSaveOrgProfile={() => void saveOrgProfile()}
        onSelectPlan={setSelectedPlan}
        onContinuePlanSelection={() => void continuePlanSelection()}
        onSaveGovernanceDefaults={() => void saveGovernanceDefaults()}
        onApplyRolePresets={() => void applyRolePresets()}
      />

      <MergeLinkModal
        open={Boolean(mergeLink)}
        title={
          mergeLink?.category === "crm"
            ? "Connect CRM via Merge Link"
            : "Connect Recording Provider via Merge Link"
        }
        linkToken={mergeLink?.linkToken ?? null}
        onClose={() => setMergeLink(null)}
        onComplete={completeMergeSetupStep}
      />
    </div>
  );
}
