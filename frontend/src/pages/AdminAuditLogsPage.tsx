import { useEffect, useState } from "react";
import {
  exportAuditLogs,
  getAuditActorDrilldown,
  getAuditLogs,
  getAuditResourceDrilldown,
  type AuditActorDrilldown,
  type AuditLogEntry,
  type AuditResourceDrilldown,
} from "../lib/api";

export function AdminAuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [action, setAction] = useState("");
  const [severity, setSeverity] = useState("");
  const [actorUserId, setActorUserId] = useState("");
  const [targetType, setTargetType] = useState("");
  const [targetId, setTargetId] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [actorDrilldown, setActorDrilldown] = useState<AuditActorDrilldown | null>(null);
  const [resourceDrilldown, setResourceDrilldown] =
    useState<AuditResourceDrilldown | null>(null);

  const load = async (append = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getAuditLogs({
        limit: 100,
        category: category || undefined,
        action: action || undefined,
        severity: severity || undefined,
        actor_user_id: actorUserId || undefined,
        target_type: targetType || undefined,
        target_id: targetId || undefined,
        before: append ? nextCursor ?? undefined : undefined,
      });
      setLogs((prev) => (append ? [...prev, ...res.logs] : res.logs));
      setHasMore(res.page.has_more);
      setNextCursor(res.page.next_cursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const runSearch = () => {
    setActorDrilldown(null);
    setResourceDrilldown(null);
    setNextCursor(null);
    void load(false);
  };

  const loadMore = () => {
    if (!hasMore || !nextCursor) return;
    void load(true);
  };

  const onExport = async (format: "csv" | "json") => {
    try {
      await exportAuditLogs(format, {
        limit: 10000,
        category: category || undefined,
        action: action || undefined,
        severity: severity || undefined,
        actor_user_id: actorUserId || undefined,
        target_type: targetType || undefined,
        target_id: targetId || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export audit logs");
    }
  };

  const openActorDrilldown = async (id: string) => {
    try {
      const data = await getAuditActorDrilldown(id);
      setActorDrilldown(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load actor drilldown");
    }
  };

  const openResourceDrilldown = async (type: string, id: string) => {
    try {
      const data = await getAuditResourceDrilldown(type, id);
      setResourceDrilldown(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load resource drilldown");
    }
  };

  return (
    <div className="admin-audit__page">
      <header className="admin-audit__header">
        <h1 className="admin-audit__title">Audit Logs</h1>
        <div className="admin-audit__filters">
          <input
            className="admin-audit__input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Category"
          />
          <input
            className="admin-audit__input"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="Action"
          />
          <input
            className="admin-audit__input"
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            placeholder="Severity"
          />
          <input
            className="admin-audit__input"
            value={actorUserId}
            onChange={(e) => setActorUserId(e.target.value)}
            placeholder="Actor User ID"
          />
          <input
            className="admin-audit__input"
            value={targetType}
            onChange={(e) => setTargetType(e.target.value)}
            placeholder="Target Type"
          />
          <input
            className="admin-audit__input"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            placeholder="Target ID"
          />
          <button className="btn btn--secondary" onClick={runSearch}>
            Apply
          </button>
          <button className="btn btn--secondary" onClick={() => onExport("csv")}>
            Export CSV
          </button>
          <button className="btn btn--secondary" onClick={() => onExport("json")}>
            Export JSON
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
                <th>Schema</th>
                <th>Metadata</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{new Date(log.created_at).toLocaleString()}</td>
                  <td>{log.category}</td>
                  <td>{log.action}</td>
                  <td>
                    {log.actor_user_id ? (
                      <button
                        className="admin-audit__link-btn"
                        onClick={() => openActorDrilldown(log.actor_user_id!)}
                      >
                        {log.actor_user_id}
                      </button>
                    ) : (
                      "system"
                    )}
                  </td>
                  <td>
                    {log.target_type && log.target_id ? (
                      <button
                        className="admin-audit__link-btn"
                        onClick={() => openResourceDrilldown(log.target_type!, log.target_id!)}
                      >
                        {log.target_type}:{log.target_id}
                      </button>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td>{log.severity}</td>
                  <td>{log.schema_version}</td>
                  <td>
                    <pre className="admin-audit__meta">
                      {JSON.stringify(log.metadata ?? {}, null, 2)}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="admin-audit__footer">
            <div>{logs.length} events loaded</div>
            <button
              className="btn btn--secondary"
              disabled={!hasMore || loading}
              onClick={loadMore}
            >
              {hasMore ? "Load More" : "No More Logs"}
            </button>
          </div>
        </div>
      )}

      {actorDrilldown && (
        <section className="admin-audit__drilldown">
          <h2>Actor Drilldown</h2>
          <div>
            {actorDrilldown.actor.name ?? actorDrilldown.actor.id} (
            {actorDrilldown.actor.email ?? "unknown"})
          </div>
          <div>Total Events: {actorDrilldown.total_events}</div>
        </section>
      )}

      {resourceDrilldown && (
        <section className="admin-audit__drilldown">
          <h2>Resource Drilldown</h2>
          <div>
            {resourceDrilldown.resource.target_type}:
            {resourceDrilldown.resource.target_id}
          </div>
          <div>Total Events: {resourceDrilldown.total_events}</div>
        </section>
      )}
    </div>
  );
}
