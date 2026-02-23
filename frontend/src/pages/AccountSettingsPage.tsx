/**
 * Account Settings Page (Tenant-Side)
 *
 * Available to OWNER role only:
 * - View/manage support account opt-out
 * - Request account deletion (30-day grace, cancellable)
 *
 * The deletion approval by platform owner is invisible to this user.
 */

import { useEffect, useState } from "react";
import {
  cancelAccountDeletion,
  getAccountDeletionStatus,
  getSupportAccountInfo,
  optInSupportAccount,
  optOutSupportAccount,
  requestAccountDeletion,
  type SupportAccountInfo,
} from "../lib/api";
import { useToast } from "../components/Toast";

export function AccountSettingsPage() {
  const [support, setSupport] = useState<SupportAccountInfo | null>(null);
  const [deletionStatus, setDeletionStatus] = useState<{
    has_request: boolean;
    status: string | null;
    scheduled_delete_at: string | null;
    created_at: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [processing, setProcessing] = useState(false);
  const { showToast } = useToast();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, d] = await Promise.all([
        getSupportAccountInfo(),
        getAccountDeletionStatus(),
      ]);
      setSupport(s);
      setDeletionStatus(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load account settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggleSupportAccess = async () => {
    if (!support) return;
    setProcessing(true);
    try {
      if (support.opted_out) {
        await optInSupportAccount();
        showToast("Support access restored", "success");
      } else {
        await optOutSupportAccount();
        showToast("Support access removed from your account", "info");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update support access");
    } finally {
      setProcessing(false);
    }
  };

  const handleDeleteRequest = async () => {
    setProcessing(true);
    try {
      await requestAccountDeletion(deleteReason || undefined);
      showToast("Account scheduled for deletion in 30 days", "info");
      setShowDeleteConfirm(false);
      setDeleteReason("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to request account deletion");
    } finally {
      setProcessing(false);
    }
  };

  const handleCancelDeletion = async () => {
    setProcessing(true);
    try {
      await cancelAccountDeletion();
      showToast("Account deletion cancelled", "success");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel deletion");
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="state-view" role="status" aria-live="polite">
        <div className="spinner" />
        <div className="state-view__title">Loading account settings...</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">Account Settings</h1>
          <p className="page__subtitle">Manage support access and account lifecycle</p>
        </div>
      </div>

      {error && <div className="alert alert--error" role="alert">{error}</div>}

      {/* Support Account */}
      {support && support.email && (
        <div className="card card--elevated">
          <div className="card__header">
            <div>
              <div className="card__title">Platform Support Access</div>
              <div className="card__subtitle">
                {support.label} has support access to your account for troubleshooting and assistance
              </div>
            </div>
          </div>
          <div className="support-account-row">
            <div className="support-account-info">
              <div className="support-account-info__email support-account-info__email--readonly">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                <span>{support.email}</span>
                <span className="badge badge--info" style={{ marginLeft: 8 }}>Support</span>
              </div>
              <p className="support-account-info__hint">
                This account has full read/write access (except billing). You can opt out below.
              </p>
            </div>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={!support.opted_out}
                onChange={toggleSupportAccess}
                disabled={processing}
              />
              <span className="toggle-row__label">
                {support.opted_out ? "Support access disabled" : "Support access enabled"}
              </span>
            </label>
          </div>
        </div>
      )}

      {/* Account Deletion */}
      <div className="card card--elevated">
        <div className="card__header">
          <div>
            <div className="card__title">Delete Account</div>
            <div className="card__subtitle">
              Permanently delete your organization and all associated data
            </div>
          </div>
        </div>

        {deletionStatus?.has_request ? (
          <div className="deletion-status">
            <div className="callout callout--error">
              <div className="callout__title">Account Scheduled for Deletion</div>
              <p style={{ margin: "4px 0 0", fontSize: 13, opacity: 0.85 }}>
                Your account will be permanently deleted on{" "}
                <strong>
                  {deletionStatus.scheduled_delete_at
                    ? new Date(deletionStatus.scheduled_delete_at).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })
                    : "a future date"}
                </strong>
                . All data, stories, pages, and user accounts will be permanently removed.
              </p>
            </div>
            <button
              className="btn btn--primary"
              onClick={handleCancelDeletion}
              disabled={processing}
              style={{ marginTop: 16 }}
            >
              {processing ? "Cancelling..." : "Cancel Deletion"}
            </button>
          </div>
        ) : (
          <div className="deletion-inactive">
            <p style={{ fontSize: 14, color: "var(--color-text-muted)", marginBottom: 16, lineHeight: 1.7 }}>
              Once deleted, your organization and all associated data (stories, pages, calls, users) will be permanently removed after a 30-day grace period. You can cancel during this period.
            </p>
            <button
              className="btn btn--ghost"
              style={{ color: "var(--color-error)" }}
              onClick={() => setShowDeleteConfirm(true)}
            >
              Request Account Deletion
            </button>
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="modal modal--sm" onClick={(e) => e.stopPropagation()} role="alertdialog">
            <h3 className="modal__title">Delete Account</h3>
            <p className="modal__message">
              This will schedule your account for permanent deletion in 30 days. All data will be irreversibly removed. You can cancel any time during the grace period.
            </p>
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-group__label">Reason (optional)</label>
              <input
                className="form-input"
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="Why are you deleting this account?"
              />
            </div>
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
              <button
                className="btn btn--danger"
                onClick={handleDeleteRequest}
                disabled={processing}
              >
                {processing ? "Requesting..." : "Delete Account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
