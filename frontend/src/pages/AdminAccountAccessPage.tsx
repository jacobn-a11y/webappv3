import { useState, useEffect, useCallback, useRef } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import {
  getAccessUsers,
  searchAccounts,
  grantAccess,
  revokeAccess,
  syncAccessGrant,
  getCrmReports,
  type AccessUser,
  type AccountSearchResult,
  type CrmReport,
} from "../lib/api";
import { AdminErrorState } from "../components/admin/AdminErrorState";
import {
  AccessUserCard,
  GrantAccessModal,
} from "./admin-account-access-components";

// ─── Types ────────────────────────────────────────────────────────────────────

type GrantTab = "all" | "single" | "list" | "crm";
type CrmProvider = "SALESFORCE" | "HUBSPOT";

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

  // Refs for debounce and outside-click
  const singleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const singleSearchRef = useRef<HTMLDivElement>(null);
  const listSearchRef = useRef<HTMLDivElement>(null);

  const { showToast } = useToast();
  const [confirmState, setConfirmState] = useState<{ action: () => void; title: string; message: string } | null>(null);

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
    (grantId: string) => {
      setConfirmState({
        title: "Revoke Access",
        message: "Are you sure you want to revoke this access grant? The user will lose access to the associated accounts immediately.",
        action: async () => {
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
      });
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
        <div className="admin-access__loading-state" role="status" aria-live="polite">
          <div className="admin-access__spinner" aria-hidden="true" />
          <p>Loading users...</p>
        </div>
      )}

      {error && !loading && (
        <AdminErrorState
          title="Account Access Request Failed"
          message={error}
          onRetry={() => void loadUsers()}
        />
      )}

      {!loading && !error && users.length === 0 && (
        <div className="admin-access__empty-state" role="status" aria-live="polite">
          <p>No users found.</p>
        </div>
      )}

      {!loading && !error && users.length > 0 && (
        <div className="admin-access__user-list">
          {users.map((user) => (
            <AccessUserCard
              key={user.user_id}
              user={user}
              onOpenModal={openModal}
              onRevoke={handleRevoke}
              onSync={(grantId) => void handleSync(grantId)}
            />
          ))}
        </div>
      )}

      <GrantAccessModal
        modalOpen={modalOpen}
        closeModal={closeModal}
        modalUserName={modalUserName}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        submitting={submitting}
        onSubmit={() => void handleSubmitGrant()}
        singleSearchRef={singleSearchRef}
        singleSearchQuery={singleSearchQuery}
        onSingleSearch={handleSingleSearch}
        singleSearchOpen={singleSearchOpen}
        singleSearchResults={singleSearchResults}
        onSelectSingle={selectSingleAccount}
        singleSelected={singleSelected}
        listSearchRef={listSearchRef}
        listSearchQuery={listSearchQuery}
        onListSearch={handleListSearch}
        listSearchOpen={listSearchOpen}
        listSearchResults={listSearchResults}
        onAddList={addListAccount}
        listSelected={listSelected}
        onRemoveList={removeListAccount}
        crmProvider={crmProvider}
        onProviderChange={handleProviderChange}
        crmReportsLoading={crmReportsLoading}
        crmReports={crmReports}
        selectedReportId={selectedReportId}
        setSelectedReportId={setSelectedReportId}
      />

      <ConfirmDialog
        open={!!confirmState}
        title={confirmState?.title ?? ""}
        message={confirmState?.message ?? ""}
        confirmLabel="Revoke"
        destructive
        onConfirm={() => { confirmState?.action(); setConfirmState(null); }}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
}
