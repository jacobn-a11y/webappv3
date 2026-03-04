import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getAccountsList, type AccountsListResponse } from "../lib/api";
import { TableSkeleton } from "../components/PageSkeleton";

export function AccountsIndexPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accountsData, setAccountsData] = useState<AccountsListResponse | null>(
    null
  );
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const resolveAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getAccountsList({
        search: search || undefined,
        page,
        limit: pageSize,
        sort_by: "lastCallDate",
        sort_order: "desc",
      });
      setAccountsData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, [search, page, pageSize]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(id);
  }, [searchDraft]);

  useEffect(() => {
    if (!openMenuId) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenuId(null);
    };
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openMenuId]);

  useEffect(() => {
    void resolveAccounts();
  }, [resolveAccounts]);

  const totalCount = accountsData?.pagination.totalCount ?? 0;
  const pageLimit = accountsData?.pagination.limit ?? pageSize;
  const rangeStart = totalCount === 0 ? 0 : ((accountsData?.pagination.page ?? page) - 1) * pageLimit + 1;
  const rangeEnd = totalCount === 0 ? 0 : Math.min(rangeStart + pageLimit - 1, totalCount);

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">Accounts</h1>
          <p className="page__subtitle">
            Browse accounts and generate stories in one click.
          </p>
        </div>
      </header>

      <div className="account-list-controls">
        <input
          type="search"
          className="form-field__input"
          placeholder="Search accounts by name or domain"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          aria-label="Search accounts"
        />
        <select
          className="form-field__input account-list-controls__page-size"
          value={pageSize}
          onChange={(event) => {
            setPageSize(Number(event.target.value));
            setPage(1);
          }}
          aria-label="Accounts per page"
        >
          <option value={25}>25 / page</option>
          <option value={50}>50 / page</option>
          <option value={100}>100 / page</option>
        </select>
        <span className="account-list-controls__count" aria-live="polite">
          {loading
            ? "Loading..."
            : `${rangeStart}-${rangeEnd} of ${totalCount} account${totalCount === 1 ? "" : "s"}`}
        </span>
      </div>

      {loading && (
        <TableSkeleton rows={pageSize} />
      )}

      {!loading && error && (
        <div className="state-view state-view--error" role="alert">
          <div className="state-view__title">Unable to load accounts</div>
          <div className="state-view__message">{error}</div>
          <div className="state-view__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void resolveAccounts()}
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {!loading && !error && (accountsData?.accounts.length ?? 0) === 0 && (
        <div className="state-view" role="status" aria-live="polite">
          <div className="state-view__title">No accessible accounts yet</div>
          <div className="state-view__message">
            Ask an admin to grant account access, or return home.
          </div>
          <div className="state-view__actions">
            <Link className="btn btn--primary" to="/">
              Return Home
            </Link>
          </div>
        </div>
      )}

      {!loading && !error && (accountsData?.accounts.length ?? 0) > 0 && (
        <>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Domain</th>
                  <th>Calls</th>
                  <th>Stories</th>
                  <th>Last Activity</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {accountsData?.accounts.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <strong>{account.name}</strong>
                    </td>
                    <td>{account.domain ?? "—"}</td>
                    <td>{account.totalCalls.toLocaleString()}</td>
                    <td>{account.storyCount.toLocaleString()}</td>
                    <td>
                      {account.lastCallDate
                        ? new Date(account.lastCallDate).toLocaleDateString()
                        : "No calls yet"}
                    </td>
                    <td>
                      <div className="account-list-actions">
                        <Link className="btn btn--sm btn--primary" to={`/accounts/${account.id}?newStory=1`}>
                          Generate Story
                        </Link>
                        <Link className="btn btn--sm btn--ghost" to={`/accounts/${account.id}`}>
                          Open
                        </Link>
                        <div
                          className="account-list-actions__overflow"
                          ref={openMenuId === account.id ? menuRef : undefined}
                        >
                          <button
                            type="button"
                            className="btn btn--sm btn--ghost account-list-actions__overflow-toggle"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId(openMenuId === account.id ? null : account.id);
                            }}
                            aria-label={`More actions for ${account.name}`}
                            aria-haspopup="menu"
                            aria-expanded={openMenuId === account.id}
                          >
                            &#8943;
                          </button>
                          {openMenuId === account.id && (
                            <div className="account-list-actions__menu" role="menu">
                              <Link
                                className="account-list-actions__menu-item"
                                role="menuitem"
                                to={`/accounts/${account.id}/journey`}
                                onClick={() => setOpenMenuId(null)}
                              >
                                Journey
                              </Link>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="account-list-pagination">
            <button
              type="button"
              className="btn btn--secondary"
              disabled={page <= 1}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              Previous
            </button>
            <span>
              Page {accountsData?.pagination.page ?? 1} of {Math.max(accountsData?.pagination.totalPages ?? 1, 1)}
            </span>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={page >= (accountsData?.pagination.totalPages ?? 1)}
              onClick={() => setPage((prev) => prev + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
