import type { ReactNode, RefObject } from "react";
import type { AccessUser, AccountSearchResult, CrmReport } from "../lib/api";
import { GrantRow } from "./admin-account-access-grant-row";

export function getInitials(name: string): string {
  if (!name) return "?";
  const parts = name.split(/[\s@]+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0].substring(0, 2).toUpperCase();
}

export function AccessUserCard({
  user,
  onOpenModal,
  onRevoke,
  onSync,
}: {
  user: AccessUser;
  onOpenModal: (userId: string, userName: string) => void;
  onRevoke: (grantId: string) => void;
  onSync: (grantId: string) => void;
}) {
  const displayName = user.user_name || user.user_email.split("@")[0];
  const initials = getInitials(user.user_name || user.user_email);
  const isAdmin = user.role === "OWNER" || user.role === "ADMIN";
  const roleClass = "admin-access__role admin-access__role--" + user.role.toLowerCase();

  let grantsContent: ReactNode;
  if (isAdmin && user.grants.length === 0) {
    grantsContent = (
      <div className="admin-access__grant-row">
        <div className="admin-access__grant-info">
          <span className="admin-access__badge admin-access__badge--all">All Accounts</span>
          <span className="admin-access__grant-accounts">
            Implicit via {user.role} role
          </span>
        </div>
      </div>
    );
  } else if (user.grants.length === 0) {
    grantsContent = (
      <div className="admin-access__grants-empty">No account access granted</div>
    );
  } else {
    grantsContent = user.grants.map((grant) => (
      <GrantRow
        key={grant.id}
        grant={grant}
        onRevoke={onRevoke}
        onSync={onSync}
      />
    ));
  }

  return (
    <div className="admin-access__user-card" key={user.user_id}>
      <div className="admin-access__user-header">
        <div className="admin-access__user-info">
          <div className="admin-access__avatar">{initials}</div>
          <div>
            <div className="admin-access__user-name">{displayName}</div>
            <div className="admin-access__user-email">{user.user_email}</div>
          </div>
        </div>
        <div className="admin-access__user-header-right">
          <span className={roleClass}>{user.role}</span>
          <div className="admin-access__user-actions">
            <button
              type="button"
              className="admin-access__btn admin-access__btn--primary admin-access__btn--sm"
              onClick={() => onOpenModal(user.user_id, displayName)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Grant Access
            </button>
          </div>
        </div>
      </div>
      <div className="admin-access__user-grants">{grantsContent}</div>
    </div>
  );
}

function SearchResults({
  results,
  onSelect,
  excludeIds,
  emptyLabel,
}: {
  results: AccountSearchResult[];
  onSelect: (account: AccountSearchResult) => void;
  excludeIds?: Set<string>;
  emptyLabel?: string;
}) {
  const filtered = excludeIds ? results.filter((account) => !excludeIds.has(account.id)) : results;
  if (filtered.length === 0) {
    return (
      <div className="admin-access__search-results active">
        <div className="admin-access__search-result-item admin-access__search-result-item--empty">
          {emptyLabel || "No accounts found"}
        </div>
      </div>
    );
  }
  return (
    <div className="admin-access__search-results active" role="listbox">
      {filtered.map((account) => (
        <div
          key={account.id}
          className="admin-access__search-result-item"
          role="option"
          tabIndex={0}
          onMouseDown={() => onSelect(account)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(account);
            }
          }}
        >
          <span className="admin-access__search-result-name">{account.name}</span>
          {account.domain && (
            <span className="admin-access__search-result-domain">{account.domain}</span>
          )}
        </div>
      ))}
    </div>
  );
}

interface GrantAccessModalProps {
  modalOpen: boolean;
  closeModal: () => void;
  modalUserName: string;
  activeTab: "all" | "single" | "list" | "crm";
  setActiveTab: (tab: "all" | "single" | "list" | "crm") => void;
  submitting: boolean;
  onSubmit: () => void;
  singleSearchRef: RefObject<HTMLDivElement>;
  singleSearchQuery: string;
  onSingleSearch: (value: string) => void;
  singleSearchOpen: boolean;
  singleSearchResults: AccountSearchResult[];
  onSelectSingle: (account: AccountSearchResult) => void;
  singleSelected: AccountSearchResult | null;
  listSearchRef: RefObject<HTMLDivElement>;
  listSearchQuery: string;
  onListSearch: (value: string) => void;
  listSearchOpen: boolean;
  listSearchResults: AccountSearchResult[];
  onAddList: (account: AccountSearchResult) => void;
  listSelected: Map<string, string>;
  onRemoveList: (id: string) => void;
  crmProvider: "SALESFORCE" | "HUBSPOT";
  onProviderChange: (provider: "SALESFORCE" | "HUBSPOT") => void;
  crmReportsLoading: boolean;
  crmReports: CrmReport[];
  selectedReportId: string;
  setSelectedReportId: (id: string) => void;
}

export function GrantAccessModal({
  modalOpen,
  closeModal,
  modalUserName,
  activeTab,
  setActiveTab,
  submitting,
  onSubmit,
  singleSearchRef,
  singleSearchQuery,
  onSingleSearch,
  singleSearchOpen,
  singleSearchResults,
  onSelectSingle,
  singleSelected,
  listSearchRef,
  listSearchQuery,
  onListSearch,
  listSearchOpen,
  listSearchResults,
  onAddList,
  listSelected,
  onRemoveList,
  crmProvider,
  onProviderChange,
  crmReportsLoading,
  crmReports,
  selectedReportId,
  setSelectedReportId,
}: GrantAccessModalProps) {
  if (!modalOpen) return null;

  const reportLabel =
    crmProvider === "SALESFORCE"
      ? "Select a Salesforce Report"
      : "Select a HubSpot List";
  const tabs: { key: "all" | "single" | "list" | "crm"; label: string }[] = [
    { key: "all", label: "All Accounts" },
    { key: "single", label: "Single Account" },
    { key: "list", label: "Account List" },
    { key: "crm", label: "CRM Report" },
  ];
  const listExcludeIds = new Set<string>(listSelected.keys());

  return (
    <div
      className="admin-access__modal-overlay active"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-access-modal-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") closeModal();
      }}
    >
      <div className="admin-access__modal">
        <div className="admin-access__modal-header">
          <h2 id="admin-access-modal-title">Grant Account Access</h2>
          <button
            type="button"
            className="admin-access__modal-close"
            onClick={closeModal}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="admin-access__modal-body">
          <p className="admin-access__modal-user-label">
            Granting access to: {modalUserName}
          </p>

          <div className="admin-access__tabs">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={"admin-access__tab" + (activeTab === tab.key ? " active" : "")}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "all" && (
            <div className="admin-access__tab-panel">
              <p className="admin-access__tab-description">
                Grant unrestricted access to all current and future accounts.
              </p>
              <div className="admin-access__all-accounts-notice">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                  <polyline points="22,4 12,14.01 9,11.01" />
                </svg>
                This user will be able to access all accounts.
              </div>
            </div>
          )}

          {activeTab === "single" && (
            <div className="admin-access__tab-panel">
              <div className="admin-access__form-group">
                <label className="admin-access__label">Search for an account</label>
                <div className="admin-access__search-wrap" ref={singleSearchRef}>
                  <div className="admin-access__search-input-wrap">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="8" />
                      <path d="M21 21l-4.35-4.35" />
                    </svg>
                    <input
                      type="search"
                      className="admin-access__input"
                      placeholder="Type account name or domain..."
                      value={singleSearchQuery}
                      onChange={(e) => onSingleSearch(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  {singleSearchOpen && (
                    <SearchResults
                      results={singleSearchResults}
                      onSelect={onSelectSingle}
                    />
                  )}
                </div>
              </div>
              {singleSelected && (
                <div className="admin-access__single-selected">
                  <div className="admin-access__selected-label">Selected:</div>
                  <span className="admin-access__badge admin-access__badge--account">
                    {singleSelected.name}
                    {singleSelected.domain ? " (" + singleSelected.domain + ")" : ""}
                  </span>
                </div>
              )}
            </div>
          )}

          {activeTab === "list" && (
            <div className="admin-access__tab-panel">
              <div className="admin-access__form-group">
                <label className="admin-access__label">Search and add accounts</label>
                <div className="admin-access__search-wrap" ref={listSearchRef}>
                  <div className="admin-access__search-input-wrap">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="8" />
                      <path d="M21 21l-4.35-4.35" />
                    </svg>
                    <input
                      type="search"
                      className="admin-access__input"
                      placeholder="Type to search accounts..."
                      value={listSearchQuery}
                      onChange={(e) => onListSearch(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  {listSearchOpen && (
                    <SearchResults
                      results={listSearchResults}
                      onSelect={onAddList}
                      excludeIds={listExcludeIds}
                      emptyLabel="No more accounts found"
                    />
                  )}
                </div>
              </div>
              <div className="admin-access__selected-accounts">
                {(Array.from(listSelected.entries()) as [string, string][]).map(([id, name]) => (
                  <span className="admin-access__selected-tag" key={id}>
                    {name}
                    <button
                      type="button"
                      onClick={() => onRemoveList(id)}
                      title="Remove"
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
              <p className="admin-access__hint">
                {listSelected.size} account{listSelected.size !== 1 ? "s" : ""} selected
              </p>
            </div>
          )}

          {activeTab === "crm" && (
            <div className="admin-access__tab-panel">
              <div className="admin-access__form-group">
                <label className="admin-access__label">CRM Provider</label>
                <div className="admin-access__provider-toggle">
                  <button
                    type="button"
                    className={"admin-access__provider-btn" + (crmProvider === "SALESFORCE" ? " active" : "")}
                    onClick={() => onProviderChange("SALESFORCE")}
                  >
                    Salesforce Reports
                  </button>
                  <button
                    type="button"
                    className={"admin-access__provider-btn" + (crmProvider === "HUBSPOT" ? " active" : "")}
                    onClick={() => onProviderChange("HUBSPOT")}
                  >
                    HubSpot Lists
                  </button>
                </div>
              </div>

              <div className="admin-access__form-group">
                <label className="admin-access__label">{reportLabel}</label>
                {crmReportsLoading ? (
                  <div className="admin-access__reports-loading">
                    <div className="admin-access__spinner admin-access__spinner--sm" />
                    <p>Fetching reports...</p>
                  </div>
                ) : crmReports.length === 0 ? (
                  <>
                    <select className="admin-access__select" disabled>
                      <option value="">No reports available</option>
                    </select>
                    <div className="admin-access__reports-empty">
                      No reports found. Make sure your CRM is connected via Merge.dev.
                    </div>
                  </>
                ) : (
                  <select
                    className="admin-access__select"
                    value={selectedReportId}
                    onChange={(e) => setSelectedReportId(e.target.value)}
                  >
                    <option value="">Choose a report...</option>
                    {crmReports.map((report) => (
                      <option key={report.id} value={report.id}>
                        {report.name}
                      </option>
                    ))}
                  </select>
                )}
                <p className="admin-access__hint">
                  Account access will be synced from this report. You can refresh the sync
                  at any time.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="admin-access__modal-footer">
          <button
            type="button"
            className="admin-access__btn"
            onClick={closeModal}
          >
            Cancel
          </button>
          <button
            type="button"
            className="admin-access__btn admin-access__btn--primary"
            disabled={submitting}
            onClick={onSubmit}
          >
            {submitting ? "Granting…" : "Grant Access"}
          </button>
        </div>
      </div>
    </div>
  );
}
