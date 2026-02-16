import { useState, useEffect, useCallback, useRef } from "react";
import {
  getAccessUsers,
  searchAccounts,
  grantAccess,
  revokeAccess,
  syncAccessGrant,
  getCrmReports,
  type AccessUser,
  type AccessGrant,
  type AccountSearchResult,
  type CrmReport,
} from "../lib/api";

// ─── Utility Functions ────────────────────────────────────────────────────────

function getInitials(name: string): string {
  if (!name) return "?";
  const parts = name.split(/[\s@]+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0].substring(0, 2).toUpperCase();
}

function formatRelativeTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return diffMins + "m ago";
  if (diffHours < 24) return diffHours + "h ago";
  if (diffDays < 7) return diffDays + "d ago";
  return d.toLocaleDateString();
}

// ─── Types ────────────────────────────────────────────────────────────────────

type GrantTab = "all" | "single" | "list" | "crm";
type CrmProvider = "SALESFORCE" | "HUBSPOT";

interface Toast {
  id: number;
  message: string;
  type: "success" | "error";
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AdminAccountAccessPage() {
  // Page state
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalUserId, setModalUserId] = useState<string | null>(null);
  const [modalUserName, setModalUserName] = useState<string>("");
  const [activeTab, setActiveTab] = useState<GrantTab>("all");
  const [submitting, setSubmitting] = useState(false);

  // Single account tab state
  const [singleSearchQuery, setSingleSearchQuery] = useState("");
  const [singleSearchResults, setSingleSearchResults] = useState<AccountSearchResult[]>([]);
  const [singleSearchOpen, setSingleSearchOpen] = useState(false);
  const [singleSelected, setSingleSelected] = useState<AccountSearchResult | null>(null);

  // List account tab state
  const [listSearchQuery, setListSearchQuery] = useState("");
  const [listSearchResults, setListSearchResults] = useState<AccountSearchResult[]>([]);
  const [listSearchOpen, setListSearchOpen] = useState(false);
  const [listSelected, setListSelected] = useState<Map<string, string>>(new Map());

  // CRM tab state
  const [crmProvider, setCrmProvider] = useState<CrmProvider>("SALESFORCE");
  const [crmReports, setCrmReports] = useState<CrmReport[]>([]);
  const [crmReportsLoading, setCrmReportsLoading] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState("");

  // Toast state
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);

  // Refs for debounce and outside-click
  const singleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const singleSearchRef = useRef<HTMLDivElement>(null);
  const listSearchRef = useRef<HTMLDivElement>(null);

  // ─── Toast Helper ─────────────────────────────────────────────────────────

  const showToast = useCallback((message: string, type: "success" | "error") => {
    const id = ++toastIdRef.current;
    setToasts((prev: Toast[]) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev: Toast[]) => prev.filter((t: Toast) => t.id !== id));
    }, 3800);
  }, []);

  // ─── Load Users ───────────────────────────────────────────────────────────

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAccessUsers();
      setUsers(data.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  // ─── Outside Click: close dropdowns ───────────────────────────────────────

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        singleSearchRef.current &&
        !singleSearchRef.current.contains(e.target as Node)
      ) {
        setSingleSearchOpen(false);
      }
      if (
        listSearchRef.current &&
        !listSearchRef.current.contains(e.target as Node)
      ) {
        setListSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ─── Single Account Search (debounced) ────────────────────────────────────

  const handleSingleSearch = useCallback((query: string) => {
    setSingleSearchQuery(query);

    if (singleDebounceRef.current) clearTimeout(singleDebounceRef.current);

    if (query.length < 1) {
      setSingleSearchResults([]);
      setSingleSearchOpen(false);
      return;
    }

    singleDebounceRef.current = setTimeout(async () => {
      try {
        const data = await searchAccounts(query);
        setSingleSearchResults(data.accounts);
        setSingleSearchOpen(true);
      } catch {
        /* ignore */
      }
    }, 250);
  }, []);

  const selectSingleAccount = useCallback((account: AccountSearchResult) => {
    setSingleSelected(account);
    setSingleSearchQuery("");
    setSingleSearchResults([]);
    setSingleSearchOpen(false);
  }, []);

  // ─── List Account Search (debounced, multi-select) ────────────────────────

  const handleListSearch = useCallback((query: string) => {
    setListSearchQuery(query);

    if (listDebounceRef.current) clearTimeout(listDebounceRef.current);

    if (query.length < 1) {
      setListSearchResults([]);
      setListSearchOpen(false);
      return;
    }

    listDebounceRef.current = setTimeout(async () => {
      try {
        const data = await searchAccounts(query);
        setListSearchResults(data.accounts);
        setListSearchOpen(true);
      } catch {
        /* ignore */
      }
    }, 250);
  }, []);

  const addListAccount = useCallback((account: AccountSearchResult) => {
    setListSelected((prev: Map<string, string>) => {
      const next = new Map(prev);
      next.set(account.id, account.name);
      return next;
    });
    setListSearchQuery("");
    setListSearchResults([]);
    setListSearchOpen(false);
  }, []);

  const removeListAccount = useCallback((id: string) => {
    setListSelected((prev: Map<string, string>) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // ─── CRM Reports ─────────────────────────────────────────────────────────

  const loadCrmReports = useCallback(async (provider: CrmProvider) => {
    setCrmReportsLoading(true);
    setCrmReports([]);
    setSelectedReportId("");
    try {
      const data = await getCrmReports(provider);
      setCrmReports(data.reports || []);
    } catch {
      setCrmReports([]);
    } finally {
      setCrmReportsLoading(false);
    }
  }, []);

  const handleProviderChange = useCallback(
    (provider: CrmProvider) => {
      setCrmProvider(provider);
      loadCrmReports(provider);
    },
    [loadCrmReports]
  );

  // ─── Modal Open / Close ───────────────────────────────────────────────────

  const openModal = useCallback(
    (userId: string, userName: string) => {
      setModalUserId(userId);
      setModalUserName(userName);
      setActiveTab("all");

      // Reset all tab state
      setSingleSearchQuery("");
      setSingleSearchResults([]);
      setSingleSearchOpen(false);
      setSingleSelected(null);
      setListSearchQuery("");
      setListSearchResults([]);
      setListSearchOpen(false);
      setListSelected(new Map());
      setCrmProvider("SALESFORCE");
      setSelectedReportId("");

      setModalOpen(true);
      loadCrmReports("SALESFORCE");
    },
    [loadCrmReports]
  );

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setModalUserId(null);
  }, []);

  // ─── Submit Grant ─────────────────────────────────────────────────────────

  const handleSubmitGrant = useCallback(async () => {
    if (!modalUserId) return;

    const body: {
      user_id: string;
      scope_type: string;
      account_id?: string;
      account_ids?: string[];
      crm_report_id?: string;
      crm_provider?: string;
      crm_report_name?: string;
    } = { user_id: modalUserId, scope_type: "" };

    switch (activeTab) {
      case "all":
        body.scope_type = "ALL_ACCOUNTS";
        break;

      case "single":
        if (!singleSelected) {
          showToast("Please select an account first.", "error");
          return;
        }
        body.scope_type = "SINGLE_ACCOUNT";
        body.account_id = singleSelected.id;
        break;

      case "list":
        if (listSelected.size === 0) {
          showToast("Please select at least one account.", "error");
          return;
        }
        body.scope_type = "ACCOUNT_LIST";
        body.account_ids = Array.from(listSelected.keys());
        break;

      case "crm": {
        if (!selectedReportId) {
          showToast("Please select a CRM report.", "error");
          return;
        }
        const report = crmReports.find((r: CrmReport) => r.id === selectedReportId);
        body.scope_type = "CRM_REPORT";
        body.crm_report_id = selectedReportId;
        body.crm_provider = crmProvider;
        body.crm_report_name = report ? report.name : selectedReportId;
        break;
      }
    }

    setSubmitting(true);
    try {
      await grantAccess(body);
      showToast("Access granted to " + modalUserName, "success");
      closeModal();
      await loadUsers();
    } catch (err) {
      showToast(
        "Failed to grant access: " +
          (err instanceof Error ? err.message : "Unknown error"),
        "error"
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    activeTab,
    modalUserId,
    modalUserName,
    singleSelected,
    listSelected,
    selectedReportId,
    crmProvider,
    crmReports,
    showToast,
    closeModal,
    loadUsers,
  ]);

  // ─── Revoke Grant ─────────────────────────────────────────────────────────

  const handleRevoke = useCallback(
    async (grantId: string) => {
      if (!window.confirm("Revoke this access grant?")) return;

      try {
        await revokeAccess(grantId);
        showToast("Access revoked.", "success");
        await loadUsers();
      } catch (err) {
        showToast(
          "Failed to revoke: " +
            (err instanceof Error ? err.message : "Unknown error"),
          "error"
        );
      }
    },
    [showToast, loadUsers]
  );

  // ─── Sync CRM Grant ──────────────────────────────────────────────────────

  const handleSync = useCallback(
    async (grantId: string) => {
      try {
        const data = await syncAccessGrant(grantId);
        showToast("Synced " + data.account_count + " accounts.", "success");
        await loadUsers();
      } catch (err) {
        showToast(
          "Sync failed: " +
            (err instanceof Error ? err.message : "Unknown error"),
          "error"
        );
      }
    },
    [showToast, loadUsers]
  );

  // ─── Render: Grant Row ────────────────────────────────────────────────────

  function renderGrantRow(grant: AccessGrant) {
    let badge: React.ReactNode = null;
    let detail: React.ReactNode = null;
    let syncButton: React.ReactNode = null;

    switch (grant.scope_type) {
      case "ALL_ACCOUNTS":
        badge = <span className="admin-access__badge admin-access__badge--all">All Accounts</span>;
        break;

      case "SINGLE_ACCOUNT":
        badge = <span className="admin-access__badge admin-access__badge--account">Single Account</span>;
        if (grant.account) {
          detail = (
            <span className="admin-access__grant-accounts">
              {grant.account.name}
              {grant.account.domain && (
                <span className="admin-access__grant-domain">
                  {" "}({grant.account.domain})
                </span>
              )}
            </span>
          );
        }
        break;

      case "ACCOUNT_LIST":
        badge = <span className="admin-access__badge admin-access__badge--list">Specific Accounts</span>;
        detail = (
          <span className="admin-access__grant-accounts">
            {grant.cached_account_count} account
            {grant.cached_account_count !== 1 ? "s" : ""}
          </span>
        );
        break;

      case "CRM_REPORT":
        badge = <span className="admin-access__badge admin-access__badge--crm">CRM Report</span>;
        detail = (
          <>
            <span className="admin-access__grant-accounts">
              {grant.crm_report_name || grant.crm_report_id || "Unknown"}
            </span>
            <span className="admin-access__crm-sync-info">
              {grant.crm_provider && <>{grant.crm_provider}</>}
              {" \u00B7 "}
              {grant.cached_account_count} account
              {grant.cached_account_count !== 1 ? "s" : ""}
              {" \u00B7 "}
              {grant.last_synced_at
                ? "Synced " + formatRelativeTime(grant.last_synced_at)
                : "Never synced"}
            </span>
          </>
        );
        syncButton = (
          <button
            type="button"
            className="admin-access__btn admin-access__btn--sync"
            onClick={() => handleSync(grant.id)}
            title="Sync Now"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
            {" "}Sync
          </button>
        );
        break;
    }

    return (
      <div className="admin-access__grant-row" key={grant.id}>
        <div className="admin-access__grant-info">
          {badge}
          {detail}
        </div>
        <div className="admin-access__grant-actions">
          {syncButton}
          <button
            type="button"
            className="admin-access__btn admin-access__btn--danger"
            onClick={() => handleRevoke(grant.id)}
            title="Revoke"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
            {" "}Revoke
          </button>
        </div>
      </div>
    );
  }

  // ─── Render: User Card ────────────────────────────────────────────────────

  function renderUserCard(user: AccessUser) {
    const displayName = user.user_name || user.user_email.split("@")[0];
    const initials = getInitials(user.user_name || user.user_email);
    const isAdmin = user.role === "OWNER" || user.role === "ADMIN";
    const roleClass =
      "admin-access__role admin-access__role--" + user.role.toLowerCase();

    let grantsContent: React.ReactNode;

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
      grantsContent = user.grants.map((grant) => renderGrantRow(grant));
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
                onClick={() => openModal(user.user_id, displayName)}
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

  // ─── Render: Search Results Dropdown ──────────────────────────────────────

  function renderSearchResults(
    results: AccountSearchResult[],
    onSelect: (account: AccountSearchResult) => void,
    excludeIds?: Set<string>,
    emptyLabel?: string
  ) {
    const filtered = excludeIds
      ? results.filter((a) => !excludeIds.has(a.id))
      : results;

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
      <div className="admin-access__search-results active">
        {filtered.map((account) => (
          <div
            key={account.id}
            className="admin-access__search-result-item"
            onMouseDown={() => onSelect(account)}
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

  // ─── Render: Modal Tabs ───────────────────────────────────────────────────

  function renderTabAll() {
    return (
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
    );
  }

  function renderTabSingle() {
    return (
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
                onChange={(e) => handleSingleSearch(e.target.value)}
                autoComplete="off"
              />
            </div>
            {singleSearchOpen &&
              renderSearchResults(singleSearchResults, selectSingleAccount)}
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
    );
  }

  function renderTabList() {
    const excludeIds = new Set<string>(listSelected.keys());

    return (
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
                onChange={(e) => handleListSearch(e.target.value)}
                autoComplete="off"
              />
            </div>
            {listSearchOpen &&
              renderSearchResults(
                listSearchResults,
                addListAccount,
                excludeIds,
                "No more accounts found"
              )}
          </div>
        </div>
        <div className="admin-access__selected-accounts">
          {(Array.from(listSelected.entries()) as [string, string][]).map(([id, name]) => (
            <span className="admin-access__selected-tag" key={id}>
              {name}
              <button
                type="button"
                onClick={() => removeListAccount(id)}
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
    );
  }

  function renderTabCrm() {
    const reportLabel =
      crmProvider === "SALESFORCE"
        ? "Select a Salesforce Report"
        : "Select a HubSpot List";

    return (
      <div className="admin-access__tab-panel">
        <div className="admin-access__form-group">
          <label className="admin-access__label">CRM Provider</label>
          <div className="admin-access__provider-toggle">
            <button
              type="button"
              className={
                "admin-access__provider-btn" +
                (crmProvider === "SALESFORCE" ? " active" : "")
              }
              onClick={() => handleProviderChange("SALESFORCE")}
            >
              Salesforce Reports
            </button>
            <button
              type="button"
              className={
                "admin-access__provider-btn" +
                (crmProvider === "HUBSPOT" ? " active" : "")
              }
              onClick={() => handleProviderChange("HUBSPOT")}
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
              {crmReports.map((report: CrmReport) => (
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
    );
  }

  // ─── Render: Modal ────────────────────────────────────────────────────────

  function renderModal() {
    if (!modalOpen) return null;

    const tabs: { key: GrantTab; label: string }[] = [
      { key: "all", label: "All Accounts" },
      { key: "single", label: "Single Account" },
      { key: "list", label: "Account List" },
      { key: "crm", label: "CRM Report" },
    ];

    return (
      <div
        className="admin-access__modal-overlay active"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) closeModal();
        }}
      >
        <div className="admin-access__modal">
          <div className="admin-access__modal-header">
            <h2>Grant Account Access</h2>
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
                  className={
                    "admin-access__tab" +
                    (activeTab === tab.key ? " active" : "")
                  }
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab === "all" && renderTabAll()}
            {activeTab === "single" && renderTabSingle()}
            {activeTab === "list" && renderTabList()}
            {activeTab === "crm" && renderTabCrm()}
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
              onClick={handleSubmitGrant}
            >
              {submitting ? "Granting\u2026" : "Grant Access"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Render: Toasts ───────────────────────────────────────────────────────

  function renderToasts() {
    if (toasts.length === 0) return null;

    return (
      <div className="admin-access__toast-container">
        {toasts.map((toast: Toast) => (
          <div
            key={toast.id}
            className={
              "admin-access__toast admin-access__toast--" + toast.type
            }
          >
            {toast.message}
          </div>
        ))}
      </div>
    );
  }

  // ─── Main Render ──────────────────────────────────────────────────────────

  return (
    <div className="admin-access__page-container">
      <header className="admin-access__page-header">
        <h1>Account Access</h1>
        <p>
          Manage which accounts each team member can access for landing page
          creation.
        </p>
      </header>

      {loading && (
        <div className="admin-access__loading-state">
          <div className="admin-access__spinner" />
          <p>Loading users...</p>
        </div>
      )}

      {error && !loading && (
        <div className="admin-access__error-state">
          <p>Failed to load users: {error}</p>
          <button type="button" onClick={loadUsers}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && users.length === 0 && (
        <div className="admin-access__empty-state">
          <p>No users found.</p>
        </div>
      )}

      {!loading && !error && users.length > 0 && (
        <div className="admin-access__user-list">
          {users.map((user: AccessUser) => renderUserCard(user))}
        </div>
      )}

      {renderModal()}
      {renderToasts()}
    </div>
  );
}
