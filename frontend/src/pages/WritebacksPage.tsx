import { useEffect, useState } from "react";
import {
  getWritebacks,
  requestWriteback,
  reviewWriteback,
  rollbackWriteback,
  type WritebackRequest,
} from "../lib/api";
import { formatEnumLabel, badgeClass, formatDate } from "../lib/format";
import { useToast } from "../components/Toast";

export function WritebacksPage({ userRole }: { userRole?: string }) {
  const isViewer = userRole === "VIEWER";
  const [writebacks, setWritebacks] = useState<WritebackRequest[]>([]);
  const [accountId, setAccountId] = useState("");
  const [actionType, setActionType] = useState<"TASK" | "NOTE" | "FIELD_UPDATE" | "TIMELINE_EVENT">("TASK");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  const load = async () => {
    setError(null);
    try {
      const res = await getWritebacks();
      setWritebacks(res.writebacks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load writebacks");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async () => {
    if (!accountId.trim()) return;
    setError(null);
    try {
      await requestWriteback({
        action_type: actionType,
        account_id: accountId.trim(),
        title: title || undefined,
        body: body || undefined,
      });
      setAccountId("");
      setTitle("");
      setBody("");
      showToast("Writeback requested", "success");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to request writeback");
    }
  };

  const pending = writebacks.filter((w) => w.status === "PENDING");

  return (
    <div className="page">
      <div className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">CRM Writebacks</h1>
          <p className="page__subtitle">Push updates back to your CRM with approval workflows</p>
        </div>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {/* Request Form */}
      {!isViewer && <div className="card card--elevated">
        <div className="card__header">
          <div className="card__title">Request Writeback</div>
        </div>
        <div className="form-grid-2">
          <div className="form-group">
            <label className="form-group__label">Account ID</label>
            <input className="form-input" value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="acc_..." />
          </div>
          <div className="form-group">
            <label className="form-group__label">Action Type</label>
            <select className="form-select" value={actionType} onChange={(e) => setActionType(e.target.value as typeof actionType)}>
              <option value="TASK">Task</option>
              <option value="NOTE">Note</option>
              <option value="FIELD_UPDATE">Field Update</option>
              <option value="TIMELINE_EVENT">Timeline Event</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-group__label">Title</label>
            <input className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional title" />
          </div>
          <div className="form-group">
            <label className="form-group__label">Body</label>
            <input className="form-input" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Optional description" />
          </div>
        </div>
        <div className="form-actions-end">
          <button className="btn btn--primary" onClick={submit}>Request Writeback</button>
        </div>
      </div>}

      {/* Pending Queue */}
      {pending.length > 0 && (
        <div className="card card--elevated">
          <div className="card__header">
            <div className="card__title">Pending Approval</div>
            <span className="badge badge--draft">{pending.length} pending</span>
          </div>
          <div className="table-container table-container--flush">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Target</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((w) => (
                  <tr key={w.id}>
                    <td>{formatDate(w.created_at)}</td>
                    <td><code className="code--sm">{w.target_id}</code></td>
                    <td><span className={badgeClass(w.status)}>{formatEnumLabel(w.status)}</span></td>
                    <td>
                      <div className="table-actions">
                        <button className="btn btn--primary btn--sm" onClick={async () => { await reviewWriteback(w.id, { decision: "APPROVE" }); showToast("Approved", "success"); await load(); }}>
                          Approve
                        </button>
                        <button className="btn btn--ghost btn--sm btn--danger-text" onClick={async () => { await reviewWriteback(w.id, { decision: "REJECT" }); showToast("Rejected", "info"); await load(); }}>
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

      {/* All Writebacks */}
      <div className="card card--elevated">
        <div className="card__header">
          <div className="card__title">All Writebacks</div>
          <span className="badge badge--accent">{writebacks.length} total</span>
        </div>
        <div className="table-container table-container--flush">
          <table className="data-table">
            <thead>
              <tr>
                <th>Created</th>
                <th>Status</th>
                <th>Target</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {writebacks.length === 0 ? (
                <tr><td colSpan={4} className="data-table__empty">
                  <div className="state-view state-view--sm">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-border)" strokeWidth="1.5" aria-hidden="true"><polyline points="23,4 23,10 17,10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></svg>
                    <div className="state-view__title">No writebacks yet</div>
                    <div className="state-view__message">Writebacks will appear here when data is synced back to your CRM.</div>
                  </div>
                </td></tr>
              ) : (
                writebacks.map((w) => (
                  <tr key={w.id}>
                    <td>{formatDate(w.created_at)}</td>
                    <td><span className={badgeClass(w.status)}>{formatEnumLabel(w.status)}</span></td>
                    <td><code className="code--sm">{w.target_id}</code></td>
                    <td>
                      {w.status === "COMPLETED" ? (
                        <button className="btn btn--ghost btn--sm" onClick={async () => { await rollbackWriteback(w.id); showToast("Rolled back", "info"); await load(); }}>
                          Rollback
                        </button>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
