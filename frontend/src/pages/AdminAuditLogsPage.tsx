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
import { formatEnumLabel, badgeClass } from "../lib/format";

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
    <div className="page">
      <div className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">Audit Logs</h1>
          <p className="page__subtitle">Track and investigate all system events and user actions</p>
        </div>
        <div className="page__actions">
          <button className="btn btn--secondary" onClick={() => onExport("csv")}>Export CSV</button>
          <button className="btn btn--secondary" onClick={() => onExport("json")}>Export JSON</button>
        </div>
      </div>

      <div className="card card--elevated">
        <div className="card__header">
          <div className="card__title">Filters</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          <div className="form-group">
            <label className="form-group__label">Category</label>
            <input className="form-input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. AUTH" aria-label="Filter by category" />
          </div>
          <div className="form-group">
            <label className="form-group__label">Action</label>
            <input className="form-input" value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. LOGIN" aria-label="Filter by action" />
          </div>
          <div className="form-group">
            <label className="form-group__label">Severity</label>
            <input className="form-input" value={severity} onChange={(e) => setSeverity(e.target.value)} placeholder="e.g. HIGH" aria-label="Filter by severity" />
          </div>
          <div className="form-group">
            <label className="form-group__label">Actor User ID</label>
            <input className="form-input" value={actorUserId} onChange={(e) => setActorUserId(e.target.value)} placeholder="usr_..." aria-label="Filter by actor user ID" />
          </div>
          <div className="form-group">
            <label className="form-group__label">Target Type</label>
            <input className="form-input" value={targetType} onChange={(e) => setTargetType(e.target.value)} placeholder="e.g. PAGE" aria-label="Filter by target type" />
          </div>
          <div className="form-group">
            <label className="form-group__label">Target ID</label>
            <input className="form-input" value={targetId} onChange={(e) => setTargetId(e.target.value)} placeholder="Target ID" aria-label="Filter by target ID" />
          </div>
        </div>
        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
          <button className="btn btn--primary" onClick={runSearch}>Apply Filters</button>
        </div>
      </div>

      {error && <div className="alert alert--error" role="alert">{error}</div>}

      {loading ? (
        <div className="state-view" style={{ minHeight: 200 }} role="status" aria-live="polite">
          <div className="spinner" />
          <div className="state-view__title">Loading audit logs...</div>
        </div>
      ) : (
        <div className="card card--elevated">
          <div className="table-container" style={{ border: "none", borderRadius: 0 }}>
            <table className="data-table">
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
                {logs.length === 0 ? (
                  <tr><td colSpan={8} className="data-table__empty">No audit log entries found</td></tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{new Date(log.created_at).toLocaleString()}</td>
                      <td><span className="badge badge--info">{formatEnumLabel(log.category)}</span></td>
                      <td>{formatEnumLabel(log.action)}</td>
                      <td>
                        {log.actor_user_id ? (
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={() => openActorDrilldown(log.actor_user_id!)}
                            style={{ textDecoration: "underline", padding: "2px 4px" }}
                          >
                            {log.actor_user_id}
                          </button>
                        ) : (
                          <span style={{ color: "var(--color-text-muted)" }}>system</span>
                        )}
                      </td>
                      <td>
                        {log.target_type && log.target_id ? (
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={() => openResourceDrilldown(log.target_type!, log.target_id!)}
                            style={{ textDecoration: "underline", padding: "2px 4px" }}
                          >
                            {log.target_type}:{log.target_id}
                          </button>
                        ) : (
                          <span style={{ color: "var(--color-text-muted)" }}>-</span>
                        )}
                      </td>
                      <td><span className={badgeClass(log.severity)}>{formatEnumLabel(log.severity)}</span></td>
                      <td>{log.schema_version}</td>
                      <td>
                        <pre style={{ margin: 0, fontSize: 11, maxWidth: 300, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                          {JSON.stringify(log.metadata ?? {}, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderTop: "1px solid var(--color-border)" }}>
            <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>{logs.length} events loaded</span>
            <button
              className="btn btn--secondary btn--sm"
              disabled={!hasMore || loading}
              onClick={loadMore}
            >
              {hasMore ? "Load More" : "No More Logs"}
            </button>
          </div>
        </div>
      )}

      {actorDrilldown && (
        <div className="card card--elevated">
          <div className="card__header">
            <div>
              <div className="card__title">Actor Drilldown</div>
              <div className="card__subtitle">{actorDrilldown.actor.name ?? actorDrilldown.actor.id}</div>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={() => setActorDrilldown(null)}>Close</button>
          </div>
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Email</div>
                <div className="kpi-card__value" style={{ fontSize: 14 }}>{actorDrilldown.actor.email ?? "unknown"}</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Total Events</div>
                <div className="kpi-card__value">{actorDrilldown.total_events}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {resourceDrilldown && (
        <div className="card card--elevated">
          <div className="card__header">
            <div>
              <div className="card__title">Resource Drilldown</div>
              <div className="card__subtitle">{resourceDrilldown.resource.target_type}:{resourceDrilldown.resource.target_id}</div>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={() => setResourceDrilldown(null)}>Close</button>
          </div>
          <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Resource</div>
                <div className="kpi-card__value" style={{ fontSize: 14 }}>{resourceDrilldown.resource.target_type}:{resourceDrilldown.resource.target_id}</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Total Events</div>
                <div className="kpi-card__value">{resourceDrilldown.total_events}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
