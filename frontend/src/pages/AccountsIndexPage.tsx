import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { getChatAccounts } from "../lib/api";

export function AccountsIndexPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [targetAccountId, setTargetAccountId] = useState<string | null>(null);

  const resolveAccount = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getChatAccounts();
      const first = res.accounts[0];
      if (!first) {
        setTargetAccountId(null);
        return;
      }
      setTargetAccountId(first.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void resolveAccount();
  }, [resolveAccount]);

  if (targetAccountId) {
    return <Navigate to={`/accounts/${targetAccountId}`} replace />;
  }

  if (loading) {
    return (
      <div className="state-view" role="status" aria-live="polite">
        <div className="spinner" />
        <div className="state-view__title">Loading your accounts...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="state-view state-view--error" role="alert">
        <div className="state-view__title">Unable to load accounts</div>
        <div className="state-view__message">{error}</div>
        <div className="state-view__actions">
          <button type="button" className="btn btn--primary" onClick={() => void resolveAccount()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
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
  );
}
