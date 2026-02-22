import { useEffect, useState } from "react";
import { getAuditLogs, type AuditLogEntry } from "../lib/api";

export function AdminAuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getAuditLogs({ limit: 300, category: category || undefined });
      setLogs(res.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="admin-audit__page">
      <header className="admin-audit__header">
        <h1 className="admin-audit__title">Audit Logs</h1>
        <div className="admin-audit__filters">
          <input
            className="admin-audit__input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Filter by category (e.g. PERMISSION)"
          />
          <button className="btn btn--secondary" onClick={load}>
            Refresh
          </button>
        </div>
      </header>

      {loading && <div>Loading audit logs...</div>}
      {error && <div className="admin-story-context__error">{error}</div>}

      {!loading && !error && (
        <div className="admin-audit__table-wrap">
          <table className="admin-audit__table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Category</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Target</th>
                <th>Severity</th>
                <th>Metadata</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{new Date(log.created_at).toLocaleString()}</td>
                  <td>{log.category}</td>
                  <td>{log.action}</td>
                  <td>{log.actor_user_id ?? "system"}</td>
                  <td>
                    {log.target_type ?? "-"}:{log.target_id ?? "-"}
                  </td>
                  <td>{log.severity}</td>
                  <td>
                    <pre className="admin-audit__meta">
                      {JSON.stringify(log.metadata ?? {}, null, 2)}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
