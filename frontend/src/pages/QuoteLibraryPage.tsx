import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  demoteQuote,
  getAccountsList,
  getQuoteLibrary,
  getQuoteAttributionSettings,
  promoteQuote,
  saveQuoteAttributionSettings,
  starQuote,
  unstarQuote,
  type QuoteAttributionDisplay,
  type QuoteLibraryItem,
} from "../lib/api";
import { formatEnumLabel } from "../lib/format";

export function QuoteLibraryPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<QuoteLibraryItem[]>([]);
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState<"ALL" | "AUTO" | "CURATED">("ALL");
  const [starredOnly, setStarredOnly] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([]);
  const [attributionDisplay, setAttributionDisplay] =
    useState<QuoteAttributionDisplay>("DISPLAYED");
  const [savingAttribution, setSavingAttribution] = useState(false);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        const [quoteRes, accountRes, attributionRes] = await Promise.all([
          getQuoteLibrary({
            q: search || undefined,
            tier,
            account_id: accountId || undefined,
            starred: starredOnly || undefined,
            limit: 200,
          }),
          getAccountsList({ limit: 100, sort_by: "name", sort_order: "asc" }),
          getQuoteAttributionSettings(),
        ]);
        setRows(quoteRes.quotes);
        setAttributionDisplay(quoteRes.attribution_display || attributionRes.display);
        setAccounts(
          accountRes.accounts.map((account) => ({
            id: account.id,
            name: account.name,
          }))
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load quote library");
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [accountId, search, starredOnly, tier]
  );

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load({ silent: true }), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const counts = useMemo(
    () => ({
      total: rows.length,
      curated: rows.filter((row) => row.tier === "CURATED").length,
      auto: rows.filter((row) => row.tier === "AUTO").length,
      starred: rows.filter((row) => row.is_starred).length,
    }),
    [rows]
  );

  const handleCopy = async (row: QuoteLibraryItem) => {
    await navigator.clipboard.writeText(row.quote_text);
  };

  const handleOpenSource = (row: QuoteLibraryItem) => {
    if (!row.source.available || !row.source.url) return;
    navigate(row.source.url);
  };

  const handlePromote = async (row: QuoteLibraryItem) => {
    setError(null);
    try {
      await promoteQuote(row.id);
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to promote quote");
    }
  };

  const handleDemote = async (row: QuoteLibraryItem) => {
    setError(null);
    try {
      await demoteQuote(row.id);
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to demote quote");
    }
  };

  const handleStarToggle = async (row: QuoteLibraryItem) => {
    setError(null);
    try {
      if (row.is_starred) {
        await unstarQuote(row.id);
      } else {
        await starQuote(row.id);
      }
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update star");
    }
  };

  const handleAttributionChange = async (
    display: QuoteAttributionDisplay
  ) => {
    setSavingAttribution(true);
    setError(null);
    try {
      await saveQuoteAttributionSettings(display);
      setAttributionDisplay(display);
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save attribution setting");
    } finally {
      setSavingAttribution(false);
    }
  };

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">Quote Library</h1>
          <p className="page__subtitle">Auto and curated quotes with source provenance.</p>
        </div>
      </header>

      {error && <div className="alert alert--danger">{error}</div>}

      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card"><span className="stat-card__label">Total</span><strong className="stat-card__value">{counts.total}</strong></div>
        <div className="stat-card"><span className="stat-card__label">Curated</span><strong className="stat-card__value">{counts.curated}</strong></div>
        <div className="stat-card"><span className="stat-card__label">Auto</span><strong className="stat-card__value">{counts.auto}</strong></div>
        <div className="stat-card"><span className="stat-card__label">Starred</span><strong className="stat-card__value">{counts.starred}</strong></div>
      </div>

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card__body">
          <div className="form-grid" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr auto" }}>
            <label className="form-group">
              <span className="form-group__label">Search</span>
              <input
                className="form-input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search quote text"
              />
            </label>
            <label className="form-group">
              <span className="form-group__label">Tier</span>
              <select
                className="form-select"
                value={tier}
                onChange={(event) => setTier(event.target.value as "ALL" | "AUTO" | "CURATED")}
              >
                <option value="ALL">All</option>
                <option value="CURATED">Curated</option>
                <option value="AUTO">Auto</option>
              </select>
            </label>
            <label className="form-group">
              <span className="form-group__label">Account</span>
              <select
                className="form-select"
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
              >
                <option value="">All accounts</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.name}</option>
                ))}
              </select>
            </label>
            <label className="form-group">
              <span className="form-group__label">Attribution</span>
              <select
                className="form-select"
                value={attributionDisplay}
                disabled={savingAttribution}
                onChange={(event) =>
                  void handleAttributionChange(
                    event.target.value as QuoteAttributionDisplay
                  )
                }
              >
                <option value="DISPLAYED">Displayed</option>
                <option value="HIDDEN">Hidden</option>
                <option value="OBFUSCATED">Obfuscated</option>
              </select>
            </label>
            <label className="form-group" style={{ alignSelf: "end" }}>
              <span className="form-group__label">Starred</span>
              <input
                type="checkbox"
                checked={starredOnly}
                onChange={(event) => setStarredOnly(event.target.checked)}
              />
            </label>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="state-view" role="status" aria-live="polite">
          <div className="spinner" />
          <div className="state-view__title">Loading quote library...</div>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Quote</th>
                <th>Tier</th>
                <th>Account</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td style={{ maxWidth: 520 }}>
                    <div style={{ fontStyle: "italic" }}>"{row.quote_text}"</div>
                    {row.source.url && (
                      <button
                        type="button"
                        className="btn btn--link"
                        onClick={() => handleOpenSource(row)}
                      >
                        View source
                      </button>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${row.tier === "CURATED" ? "badge--success" : "badge--draft"}`}>
                      {formatEnumLabel(row.tier)}
                    </span>
                  </td>
                  <td>{row.account?.name ?? "Restricted"}</td>
                  <td>{new Date(row.created_at).toLocaleString()}</td>
                  <td>
                    <button className="btn btn--sm btn--secondary" onClick={() => void handleCopy(row)}>Copy</button>{" "}
                    <button className="btn btn--sm btn--secondary" onClick={() => void handleStarToggle(row)}>
                      {row.is_starred ? "Unstar" : "Star"}
                    </button>{" "}
                    {row.tier === "AUTO" ? (
                      <button className="btn btn--sm btn--secondary" onClick={() => void handlePromote(row)}>Promote</button>
                    ) : (
                      <button className="btn btn--sm btn--secondary" onClick={() => void handleDemote(row)}>Demote</button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5}>No quotes found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default QuoteLibraryPage;
