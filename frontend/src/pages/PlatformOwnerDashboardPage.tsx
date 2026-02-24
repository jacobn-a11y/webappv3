/**
 * Platform Owner Dashboard
 *
 * Standalone environment for the application owner to manage:
 * - Support account email configuration
 * - Tenant overview with usage metrics
 * - Tenant deletion request approvals
 */

import { useEffect, useState } from "react";
import {
  getPlatformSettings,
  getPlatformTenants,
  updatePlatformSettings,
  approveTenantDeletion,
  rejectTenantDeletion,
  type PlatformSettings,
  type TenantOverview,
} from "../lib/api";
import { useToast } from "../components/Toast";
import { formatEnumLabel } from "../lib/format";

export function PlatformOwnerDashboardPage() {
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [tenants, setTenants] = useState<TenantOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [confirmAction, setConfirmAction] = useState<{
    orgId: string;
    orgName: string;
    action: "approve" | "reject";
  } | null>(null);
  const { showToast } = useToast();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, t] = await Promise.all([getPlatformSettings(), getPlatformTenants()]);
      setSettings(s);
      setTenants(t.tenants);
      setEmailInput(s.support_account_email ?? "");
      setLabelInput(s.support_account_label);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load platform data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const saveSupportSettings = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updatePlatformSettings({
        support_account_email: emailInput.trim() || null,
        support_account_label: labelInput.trim() || "Platform Support",
      });
      setSettings(updated);
      showToast("Support account settings saved", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleDeletionAction = async () => {
    if (!confirmAction) return;
    try {
      if (confirmAction.action === "approve") {
        await approveTenantDeletion(confirmAction.orgId);
        showToast(`Deletion approved for ${confirmAction.orgName} — scheduled in 30 days`, "success");
      } else {
        await rejectTenantDeletion(confirmAction.orgId);
        showToast(`Deletion request rejected for ${confirmAction.orgName}`, "info");
      }
      setConfirmAction(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process deletion request");
      setConfirmAction(null);
    }
  };

  const pendingDeletions = tenants.filter(
    (t) => t.deletion_request?.status === "PENDING_APPROVAL"
  );
  const approvedDeletions = tenants.filter(
    (t) => t.deletion_request?.status === "APPROVED"
  );

  if (loading) {
    return (
      <div className="state-view" role="status" aria-live="polite">
        <div className="spinner" />
        <div className="state-view__title">Loading platform dashboard...</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">Platform Owner Dashboard</h1>
          <p className="page__subtitle">Manage tenants, support access, and deletion requests</p>
        </div>
      </div>

      {error && <div className="alert alert--error" role="alert">{error}</div>}

      {/* KPIs */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card__icon kpi-card__icon--accent">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>
          </div>
          <div className="kpi-card__content">
            <div className="kpi-card__label">Total Tenants</div>
            <div className="kpi-card__value">{tenants.length}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__icon kpi-card__icon--warning">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          </div>
          <div className="kpi-card__content">
            <div className="kpi-card__label">Pending Deletions</div>
            <div className="kpi-card__value">{pendingDeletions.length}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__icon kpi-card__icon--error">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
          </div>
          <div className="kpi-card__content">
            <div className="kpi-card__label">Scheduled Deletions</div>
            <div className="kpi-card__value">{approvedDeletions.length}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__icon kpi-card__icon--info">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
          </div>
          <div className="kpi-card__content">
            <div className="kpi-card__label">Support Opt-outs</div>
            <div className="kpi-card__value">{tenants.filter((t) => t.support_opted_out).length}</div>
          </div>
        </div>
      </div>

      {/* Support Account Configuration */}
      <div className="card card--elevated">
        <div className="card__header">
          <div>
            <div className="card__title">Support Account</div>
            <div className="card__subtitle">This email gets highest permissions (except billing) on every tenant automatically</div>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-group__label">Support Email</label>
            <input
              className="form-input"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="support@yourcompany.com"
              type="email"
            />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-group__label">Display Label</label>
            <input
              className="form-input"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              placeholder="Platform Support"
            />
          </div>
          <button className="btn btn--primary" onClick={saveSupportSettings} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Pending Deletion Requests */}
      {pendingDeletions.length > 0 && (
        <div className="card card--elevated">
          <div className="card__header">
            <div>
              <div className="card__title">Pending Deletion Requests</div>
              <div className="card__subtitle">These tenants have requested account deletion</div>
            </div>
            <span className="badge badge--draft">{pendingDeletions.length} pending</span>
          </div>
          <div className="table-container" style={{ border: "none", borderRadius: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Users</th>
                  <th>Requested By</th>
                  <th>Reason</th>
                  <th>Requested</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingDeletions.map((t) => (
                  <tr key={t.id}>
                    <td><strong>{t.name}</strong></td>
                    <td>{t.user_count}</td>
                    <td>{t.deletion_request?.requested_by_email ?? "-"}</td>
                    <td>{t.deletion_request?.reason ?? <span style={{ color: "var(--color-text-muted)" }}>No reason provided</span>}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{t.deletion_request?.created_at ? new Date(t.deletion_request.created_at).toLocaleDateString() : "-"}</td>
                    <td>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          className="btn btn--primary btn--sm"
                          onClick={() => setConfirmAction({ orgId: t.id, orgName: t.name, action: "approve" })}
                        >
                          Approve
                        </button>
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={() => setConfirmAction({ orgId: t.id, orgName: t.name, action: "reject" })}
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* All Tenants */}
      <div className="card card--elevated">
        <div className="card__header">
          <div>
            <div className="card__title">All Tenants</div>
            <div className="card__subtitle">Overview of all tenant organizations</div>
          </div>
          <span className="badge badge--accent">{tenants.length} tenants</span>
        </div>
        <div className="table-container" style={{ border: "none", borderRadius: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Organization</th>
                <th>Plan</th>
                <th>Users</th>
                <th>Stories (30d)</th>
                <th>Pages (30d)</th>
                <th>Support</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tenants.length === 0 ? (
                <tr><td colSpan={7} className="data-table__empty">No tenants found</td></tr>
              ) : (
                tenants.map((t) => (
                  <tr key={t.id}>
                    <td><strong>{t.name}</strong></td>
                    <td><span className="badge badge--accent">{formatEnumLabel(t.plan)}</span></td>
                    <td>{t.user_count}</td>
                    <td>{t.story_count_30d}</td>
                    <td>{t.page_count_30d}</td>
                    <td>
                      {t.support_opted_out ? (
                        <span className="badge badge--draft">Opted Out</span>
                      ) : (
                        <span className="badge badge--success">Active</span>
                      )}
                    </td>
                    <td>
                      {t.deletion_request ? (
                        <span className={`badge ${t.deletion_request.status === "PENDING_APPROVAL" ? "badge--draft" : t.deletion_request.status === "APPROVED" ? "badge--error" : "badge--archived"}`}>
                          {t.deletion_request.status === "PENDING_APPROVAL" ? "Deletion Pending" : t.deletion_request.status === "APPROVED" ? "Deleting " + (t.deletion_request.scheduled_delete_at ? new Date(t.deletion_request.scheduled_delete_at).toLocaleDateString() : "") : formatEnumLabel(t.deletion_request.status)}
                        </span>
                      ) : (
                        <span className="badge badge--success">Active</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirmation Dialog */}
      {confirmAction && (
        <div className="modal-overlay" onClick={() => setConfirmAction(null)}>
          <div className="modal modal--sm" onClick={(e) => e.stopPropagation()} role="alertdialog">
            <h3 className="modal__title">
              {confirmAction.action === "approve" ? "Approve Deletion" : "Reject Deletion"}
            </h3>
            <p className="modal__message">
              {confirmAction.action === "approve"
                ? `Approving deletion for "${confirmAction.orgName}" will schedule it for permanent removal in 30 days. The tenant can cancel during this period.`
                : `Reject the deletion request for "${confirmAction.orgName}"? The tenant will be able to submit a new request.`
              }
            </p>
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setConfirmAction(null)}>Cancel</button>
              <button
                className={`btn ${confirmAction.action === "approve" ? "btn--danger" : "btn--primary"}`}
                onClick={handleDeletionAction}
              >
                {confirmAction.action === "approve" ? "Approve Deletion" : "Reject Request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
