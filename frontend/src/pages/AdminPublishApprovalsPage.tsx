import { useEffect, useState } from "react";
import {
  getPublishApprovals,
  reviewPublishApproval,
  type PublishApprovalRequestRow,
} from "../lib/api";

export function AdminPublishApprovalsPage() {
  const [rows, setRows] = useState<PublishApprovalRequestRow[]>([]);
  const [status, setStatus] = useState("PENDING");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    load();
  }, [status]);

  const review = async (id: string, decision: "APPROVE" | "REJECT") => {
    setError(null);
    try {
      await reviewPublishApproval(id, { decision });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to review request");
    }
  };

  return (
    <div className="admin-security__page">
      <h1 className="admin-security__title">Publish Approvals</h1>

      <div className="admin-security__card">
        <label className="admin-security__field">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="PENDING">PENDING</option>
            <option value="APPROVED">APPROVED</option>
            <option value="REJECTED">REJECTED</option>
          </select>
        </label>
      </div>

      {error && <div className="admin-story-context__error">{error}</div>}

      <div className="admin-security__card">
        {loading ? (
          <div>Loading approvals...</div>
        ) : (
          <table className="admin-ops__table">
            <thead>
              <tr>
                <th>Created</th>
                <th>Status</th>
                <th>Page ID</th>
                <th>Requested By</th>
                <th>Current Step</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const payload =
                  r.payload && typeof r.payload === "object"
                    ? (r.payload as { current_step_order?: number })
                    : {};
                return (
                  <tr key={r.id}>
                    <td>{new Date(r.created_at).toLocaleString()}</td>
                    <td>{r.status}</td>
                    <td>{r.target_id}</td>
                    <td>{r.requested_by.name || r.requested_by.email}</td>
                    <td>{payload.current_step_order ?? "-"}</td>
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
      </div>
    </div>
  );
}
