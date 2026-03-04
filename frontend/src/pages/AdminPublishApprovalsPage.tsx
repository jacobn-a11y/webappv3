import { useEffect, useState } from "react";
import {
  getApprovalSlackSettings,
  getPublishApprovals,
  reviewPublishApproval,
  saveApprovalSlackSettings,
  type PublishApprovalRequestRow,
} from "../lib/api";
import { badgeClass, formatEnumLabel } from "../lib/format";
import { AdminErrorState } from "../components/admin/AdminErrorState";
import { AdminSection } from "../components/admin/AdminLayoutPrimitives";

export function AdminPublishApprovalsPage() {
  const [rows, setRows] = useState<PublishApprovalRequestRow[]>([]);
  const [status, setStatus] = useState("PENDING");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [slackSettingsVisible, setSlackSettingsVisible] = useState(false);
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [approverWebhook, setApproverWebhook] = useState("");
  const [creatorWebhook, setCreatorWebhook] = useState("");
  const [approverWebhookMasked, setApproverWebhookMasked] = useState<string | null>(null);
  const [creatorWebhookMasked, setCreatorWebhookMasked] = useState<string | null>(null);
  const [slackSaving, setSlackSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getPublishApprovals(status);
      setRows(res.approvals);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load publish approvals");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const intervalId = window.setInterval(() => {
      void load();
    }, 30_000);
    return () => window.clearInterval(intervalId);
  }, [status]);

  useEffect(() => {
    getApprovalSlackSettings()
      .then((settings) => {
        setSlackSettingsVisible(true);
        setSlackEnabled(settings.enabled);
        setApproverWebhookMasked(settings.approver_webhook_url_masked);
        setCreatorWebhookMasked(settings.creator_webhook_url_masked);
      })
      .catch(() => {
        setSlackSettingsVisible(false);
      });
  }, []);

  const review = async (id: string, decision: "APPROVE" | "REJECT") => {
    setError(null);
    try {
      await reviewPublishApproval(id, { decision });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to review request");
    }
  };

  const saveSlackSettings = async () => {
    setSlackSaving(true);
    setError(null);
    try {
      await saveApprovalSlackSettings({
        enabled: slackEnabled,
        approver_webhook_url: approverWebhook.trim() || undefined,
        creator_webhook_url: creatorWebhook.trim() || undefined,
      });
      const refreshed = await getApprovalSlackSettings();
      setApproverWebhook("");
      setCreatorWebhook("");
      setApproverWebhookMasked(refreshed.approver_webhook_url_masked);
      setCreatorWebhookMasked(refreshed.creator_webhook_url_masked);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save Slack settings");
    } finally {
      setSlackSaving(false);
    }
  };

  return (
    <div className="page">
      <div className="page__header"><div className="page__header-text"><h1 className="page__title">Publish Approvals</h1><p className="page__subtitle">Review and approve content publishing requests</p></div></div>

      <AdminSection title="Filters">
        <div className="form-group" style={{ maxWidth: 200 }}>
          <label className="form-group__label">Filter by Status</label>
          <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>
      </AdminSection>

      {slackSettingsVisible && (
        <AdminSection
          title="Slack Integration"
          subtitle="Send approval requests to approvers and decision updates to creators."
        >
          <div className="form-grid" style={{ gridTemplateColumns: "220px 1fr 1fr auto" }}>
            <label className="form-group">
              <span className="form-group__label">Enabled</span>
              <input
                type="checkbox"
                checked={slackEnabled}
                onChange={(event) => setSlackEnabled(event.target.checked)}
              />
            </label>
            <label className="form-group">
              <span className="form-group__label">Approver webhook URL</span>
              <input
                className="form-input"
                value={approverWebhook}
                onChange={(event) => setApproverWebhook(event.target.value)}
                placeholder={approverWebhookMasked ?? "https://hooks.slack.com/services/..."}
              />
            </label>
            <label className="form-group">
              <span className="form-group__label">Creator webhook URL</span>
              <input
                className="form-input"
                value={creatorWebhook}
                onChange={(event) => setCreatorWebhook(event.target.value)}
                placeholder={creatorWebhookMasked ?? "https://hooks.slack.com/services/..."}
              />
            </label>
            <div className="form-group" style={{ alignSelf: "end" }}>
              <button
                className="btn btn--secondary"
                onClick={() => void saveSlackSettings()}
                disabled={slackSaving}
              >
                {slackSaving ? "Saving..." : "Save Slack Settings"}
              </button>
            </div>
          </div>
        </AdminSection>
      )}

      {error && (
        <AdminErrorState
          title="Publish Approvals Request Failed"
          message={error}
          onRetry={() => void load()}
        />
      )}

      <AdminSection
        title="Approval Queue"
        subtitle={`${rows.length} request${rows.length === 1 ? "" : "s"}`}
      >
        {loading ? (
          <div className="state-view" style={{ minHeight: 120 }} role="status" aria-live="polite">
            <div className="spinner spinner--sm" />
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Created</th>
                <th>Status</th>
                <th>Asset</th>
                <th>Title</th>
                <th>Account</th>
                <th>Requested By</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                return (
                  <tr key={r.id}>
                    <td>{new Date(r.created_at).toLocaleString()}</td>
                    <td><span className={badgeClass(r.status)}>{formatEnumLabel(r.status)}</span></td>
                    <td>{formatEnumLabel(r.asset_type)}</td>
                    <td>{r.title}</td>
                    <td>{r.account_name ?? "-"}</td>
                    <td>{r.requested_by.name || r.requested_by.email}</td>
                    <td>
                      {r.status === "PENDING" ? (
                        <>
                          <button className="btn btn--secondary" onClick={() => review(r.id, "APPROVE")}>
                            Approve
                          </button>{" "}
                          <button className="btn btn--secondary" onClick={() => review(r.id, "REJECT")}>
                            Reject
                          </button>
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </AdminSection>
    </div>
  );
}
