import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getAccountsList, type AccountsListResponse } from "../lib/api";

export function AccountsIndexPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accountsData, setAccountsData] = useState<AccountsListResponse | null>(
    null
  );
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const resolveAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getAccountsList({
        search: search || undefined,
        page,
        limit: 25,
        sort_by: "lastCallDate",
        sort_order: "desc",
      });
      setAccountsData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(id);
  }, [searchDraft]);

  useEffect(() => {
    void resolveAccounts();
  }, [resolveAccounts]);

  const totalCount = accountsData?.pagination.totalCount ?? 0;

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
        <span className="account-list-controls__count" aria-live="polite">
          {loading ? "Loading..." : `${totalCount} account${totalCount === 1 ? "" : "s"}`}
        </span>
      </div>

      {loading && (
        <div className="state-view" role="status" aria-live="polite">
          <div className="spinner" />
          <div className="state-view__title">Loading your accounts...</div>
        </div>
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
                        <Link className="btn btn--sm btn--ghost" to={`/accounts/${account.id}/journey`}>
                          Journey
                        </Link>
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
