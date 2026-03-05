import type { SetupMvpAccountRow, SetupMvpQuickstartStatus } from "../lib/api";
import { formatEnumLabel } from "../lib/format";

interface AdminSetupWizardMvpSectionProps {
  showAdvancedSetup: boolean;
  mvpStatus: SetupMvpQuickstartStatus | null;
  mvpReadyForIngest: boolean;
  gongApiKey: string;
  openaiApiKey: string;
  gongBaseUrl: string;
  savingMvpKeys: boolean;
  indexingAccounts: boolean;
  accountFilter: string;
  visibleAccounts: SetupMvpAccountRow[];
  selectedAccounts: string[];
  selectedCallCount: number;
  accountRows: SetupMvpAccountRow[];
  selectedSet: Set<string>;
  savingSelection: boolean;
  onToggleAdvanced: () => void;
  onGongApiKeyChange: (value: string) => void;
  onOpenAiApiKeyChange: (value: string) => void;
  onGongBaseUrlChange: (value: string) => void;
  onSaveMvpKeys: () => void;
  onRefreshMvpAccountIndex: () => void;
  onSelectVisible: () => void;
  onClearSelection: () => void;
  onAccountFilterChange: (value: string) => void;
  onToggleSelectedAccount: (name: string) => void;
  onSaveAccountSelection: () => void;
}

export function AdminSetupWizardMvpSection({
  showAdvancedSetup,
  mvpStatus,
  mvpReadyForIngest,
  gongApiKey,
  openaiApiKey,
  gongBaseUrl,
  savingMvpKeys,
  indexingAccounts,
  accountFilter,
  visibleAccounts,
  selectedAccounts,
  selectedCallCount,
  accountRows,
  selectedSet,
  savingSelection,
  onToggleAdvanced,
  onGongApiKeyChange,
  onOpenAiApiKeyChange,
  onGongBaseUrlChange,
  onSaveMvpKeys,
  onRefreshMvpAccountIndex,
  onSelectVisible,
  onClearSelection,
  onAccountFilterChange,
  onToggleSelectedAccount,
  onSaveAccountSelection,
}: AdminSetupWizardMvpSectionProps) {
  return (
    <div className="card card--elevated">
      <div className="card__header">
        <div>
          <div className="card__title">MVP Quick Setup (Gong + OpenAI)</div>
          <div className="card__subtitle">
            1) Save keys, 2) index Gong accounts, 3) select accounts, 4) ingest calls.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            className="btn btn--ghost btn--sm"
            type="button"
            onClick={onToggleAdvanced}
            aria-expanded={showAdvancedSetup}
          >
            {showAdvancedSetup ? "Hide Advanced" : "Show Advanced"}
          </button>
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
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        <div className="form-group">
          <label className="form-group__label" htmlFor="setup-gong-api-key">
            Gong API Key Bundle
          </label>
          <input
            id="setup-gong-api-key"
            className="form-input"
            type="password"
            value={gongApiKey}
            onChange={(event) => onGongApiKeyChange(event.target.value)}
            placeholder="accessKey:accessKeySecret"
            autoComplete="off"
            aria-label="Gong API key bundle"
          />
          <span className="form-group__hint">
            Format: `accessKey:accessKeySecret` or `Basic &lt;base64&gt;`.
          </span>
        </div>

        <div className="form-group">
          <label className="form-group__label" htmlFor="setup-openai-api-key">
            OpenAI API Key
          </label>
          <input
            id="setup-openai-api-key"
            className="form-input"
            type="password"
            value={openaiApiKey}
            onChange={(event) => onOpenAiApiKeyChange(event.target.value)}
            placeholder="sk-..."
            autoComplete="off"
            aria-label="OpenAI API key"
          />
        </div>

        {showAdvancedSetup && (
          <div className="form-group">
            <label className="form-group__label" htmlFor="setup-gong-base-url">
              Gong Base URL (optional)
            </label>
            <input
              id="setup-gong-base-url"
              className="form-input"
              value={gongBaseUrl}
              onChange={(event) => onGongBaseUrlChange(event.target.value)}
              placeholder="https://api.gong.io"
              aria-label="Gong base URL"
            />
            <span className="form-group__hint">
              Keep default unless your Gong workspace uses a custom endpoint.
            </span>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="btn btn--primary" onClick={onSaveMvpKeys} disabled={savingMvpKeys}>
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
            OpenAI configured: <strong>{mvpStatus.openai_configured ? "Yes" : "No"}</strong>
          </div>
          {mvpStatus.gong_last_error && (
            <div style={{ color: "var(--color-danger)" }}>
              Last Gong error: {mvpStatus.gong_last_error}
            </div>
          )}
        </div>
      )}

      {!mvpReadyForIngest && (mvpStatus?.gong_configured ?? false) && (
        <div style={{ marginTop: 12, fontSize: 13, color: "var(--color-text-secondary)" }}>
          Save a valid OpenAI key to continue with Gong account indexing and ingest.
        </div>
      )}

      {mvpReadyForIngest && (
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
                onClick={onRefreshMvpAccountIndex}
                disabled={indexingAccounts}
              >
                {indexingAccounts ? "Indexing..." : "Refresh Account Index"}
              </button>
              <button className="btn btn--ghost btn--sm" onClick={onSelectVisible} type="button">
                Select Visible
              </button>
              <button className="btn btn--ghost btn--sm" onClick={onClearSelection} type="button">
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
            onChange={(event) => onAccountFilterChange(event.target.value)}
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
            {selectedAccounts.length} account{selectedAccounts.length === 1 ? "" : "s"} selected · {selectedCallCount} tagged
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
                {accountRows.length === 0 ? "No accounts indexed yet." : "No accounts match your filter."}
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
                      onChange={() => onToggleSelectedAccount(row.name)}
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
              onClick={onSaveAccountSelection}
              disabled={savingSelection || selectedAccounts.length === 0}
            >
              {savingSelection ? "Saving..." : "Save Selection & Ingest Calls"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
