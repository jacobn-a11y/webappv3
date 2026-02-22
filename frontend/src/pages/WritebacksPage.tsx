import { useEffect, useState } from "react";
import {
  getWritebacks,
  requestWriteback,
  reviewWriteback,
  rollbackWriteback,
  type WritebackRequest,
} from "../lib/api";

export function WritebacksPage() {
  const [writebacks, setWritebacks] = useState<WritebackRequest[]>([]);
  const [accountId, setAccountId] = useState("");
  const [actionType, setActionType] = useState<"TASK" | "NOTE" | "FIELD_UPDATE" | "TIMELINE_EVENT">("TASK");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

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
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to request writeback");
    }
  };

  return (
    <div className="admin-security__page">
      <h1 className="admin-security__title">CRM Writebacks</h1>
      {error && <div className="admin-story-context__error">{error}</div>}

      <section className="admin-security__card">
        <h2>Request Writeback</h2>
        <div className="admin-security__inline">
          <input
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="Account ID"
          />
          <select value={actionType} onChange={(e) => setActionType(e.target.value as typeof actionType)}>
            <option value="TASK">TASK</option>
            <option value="NOTE">NOTE</option>
            <option value="FIELD_UPDATE">FIELD_UPDATE</option>
            <option value="TIMELINE_EVENT">TIMELINE_EVENT</option>
          </select>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
          <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Body" />
          <button className="btn btn--secondary" onClick={submit}>
            Request
          </button>
        </div>
      </section>

      <section className="admin-security__card">
        <h2>Approval Queue</h2>
        <table className="admin-ops__table">
          <thead>
            <tr>
              <th>Created</th>
              <th>Status</th>
              <th>Target</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {writebacks.map((w) => (
              <tr key={w.id}>
                <td>{new Date(w.created_at).toLocaleString()}</td>
                <td>{w.status}</td>
                <td>{w.target_id}</td>
                <td>
                  {w.status === "PENDING" ? (
                    <>
                      <button className="btn btn--secondary" onClick={async () => { await reviewWriteback(w.id, { decision: "APPROVE" }); await load(); }}>
                        Approve
                      </button>{" "}
                      <button className="btn btn--secondary" onClick={async () => { await reviewWriteback(w.id, { decision: "REJECT" }); await load(); }}>
                        Reject
                      </button>
                    </>
                  ) : w.status === "COMPLETED" ? (
                    <button className="btn btn--secondary" onClick={async () => { await rollbackWriteback(w.id); await load(); }}>
                      Rollback
                    </button>
                  ) : (
                    "-"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
