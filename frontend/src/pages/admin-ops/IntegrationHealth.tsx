import { badgeClass, formatEnumLabel } from "../../lib/format";
import type { IntegrationHealthRow, OpsDiagnostics } from "../../lib/api";

export interface IntegrationHealthProps {
  integrationHealth: IntegrationHealthRow[];
  data: OpsDiagnostics;
}

export function IntegrationHealthSection({ integrationHealth, data }: IntegrationHealthProps) {
  return (
    <>
      <section className="card card--elevated">
        <h2>Integration Health</h2>
        <table className="data-table">
          <thead>
            <tr><th>Provider</th><th>Status</th><th>Lag (min)</th><th>Last Success</th><th>Last Failure</th><th>Recent Throughput</th><th>Recent Failures</th></tr>
          </thead>
          <tbody>
            {integrationHealth.map((h) => (
              <tr key={h.id}>
                <td>{formatEnumLabel(h.provider)}</td>
                <td><span className={badgeClass(h.status)}>{formatEnumLabel(h.status)}</span></td>
                <td>{h.lag_minutes ?? "-"}</td>
                <td>{h.last_success_at ? new Date(h.last_success_at).toLocaleString() : "-"}</td>
                <td>{h.last_failure_at ? new Date(h.last_failure_at).toLocaleString() : "-"}</td>
                <td>{h.throughput_recent}</td>
                <td>{h.failures_recent}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card card--elevated">
        <h2>Integrations</h2>
        <div className="kpi-grid">
          <div>Total: {data.integrations.total}</div>
          <div>Enabled: {data.integrations.enabled}</div>
          <div>Failed: {data.integrations.failed}</div>
        </div>
        <table className="data-table">
          <thead>
            <tr><th>Provider</th><th>Status</th><th>Enabled</th><th>Last Sync</th><th>Last Error</th></tr>
          </thead>
          <tbody>
            {data.integrations.providers.map((p) => (
              <tr key={p.id}>
                <td>{formatEnumLabel(p.provider)}</td>
                <td><span className={badgeClass(p.status)}>{formatEnumLabel(p.status)}</span></td>
                <td>{p.enabled ? "Yes" : "No"}</td>
                <td>{p.last_sync_at ? new Date(p.last_sync_at).toLocaleString() : "-"}</td>
                <td>{p.last_error ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card card--elevated">
        <h2>Recent Audit Events</h2>
        <table className="data-table">
          <thead>
            <tr><th>Time</th><th>Category</th><th>Action</th><th>Severity</th></tr>
          </thead>
          <tbody>
            {data.recent_audit_events.map((a) => (
              <tr key={a.id}>
                <td>{new Date(a.created_at).toLocaleString()}</td>
                <td>{formatEnumLabel(a.category)}</td>
                <td>{formatEnumLabel(a.action)}</td>
                <td><span className={badgeClass(a.severity)}>{formatEnumLabel(a.severity)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
