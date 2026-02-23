import { useEffect, useMemo, useState } from "react";
import {
  getPublicStatusIncidents,
  type PublicStatusIncident,
} from "../lib/api";
import { formatEnumLabel, badgeClass } from "../lib/format";

const STORAGE_KEY = "status_page_org_id";

export function StatusPage() {
  const [organizationId, setOrganizationId] = useState("");
  const [incidents, setIncidents] = useState<PublicStatusIncident[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        setOrganizationId(saved);
      }
    } catch {
      // Ignore storage read failures.
    }
  }, []);

  const load = async (orgId: string) => {
    if (!orgId.trim()) {
      setError("Organization ID is required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const trimmed = orgId.trim();
      const res = await getPublicStatusIncidents(trimmed);
      setIncidents(res.incidents);
      try {
        localStorage.setItem(STORAGE_KEY, trimmed);
      } catch {
        // Ignore storage write failures.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load status incidents");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!organizationId.trim()) return;
    const timer = setInterval(() => {
      void load(organizationId);
    }, 60_000);
    return () => clearInterval(timer);
  }, [organizationId]);

  const grouped = useMemo(() => {
    const open = incidents.filter((i) => i.status === "OPEN");
    const monitoring = incidents.filter((i) => i.status === "MONITORING");
    return { open, monitoring };
  }, [incidents]);

  const allClear = incidents.length === 0 && !loading && organizationId.trim();

  return (
    <div className="page">
      <div className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">System Status</h1>
          <p className="page__subtitle">Monitor active incidents and service health</p>
        </div>
      </div>

      {/* Org ID Input */}
      <div className="card card--elevated">
        <div className="card__header">
          <div className="card__title">Organization</div>
        </div>
        <div className="form-row">
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-group__label" htmlFor="org-id">Organization ID</label>
            <input
              id="org-id"
              className="form-input"
              value={organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
              placeholder="Enter your organization ID"
              onKeyDown={(e) => e.key === "Enter" && load(organizationId)}
            />
          </div>
          <button className="btn btn--primary" onClick={() => load(organizationId)} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
        {error && <div className="alert alert--error" style={{ marginTop: 12 }}>{error}</div>}
      </div>

      {/* Summary Cards */}
      {incidents.length > 0 && (
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-card__icon kpi-card__icon--error">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
            </div>
            <div className="kpi-card__content">
              <div className="kpi-card__label">Open</div>
              <div className="kpi-card__value">{grouped.open.length}</div>
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-card__icon kpi-card__icon--warning">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
            </div>
            <div className="kpi-card__content">
              <div className="kpi-card__label">Monitoring</div>
              <div className="kpi-card__value">{grouped.monitoring.length}</div>
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-card__icon kpi-card__icon--accent">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12" /></svg>
            </div>
            <div className="kpi-card__content">
              <div className="kpi-card__label">Total Active</div>
              <div className="kpi-card__value">{incidents.length}</div>
            </div>
          </div>
        </div>
      )}

      {/* All Clear */}
      {allClear && (
        <div className="callout callout--success">
          <div className="callout__title">All Systems Operational</div>
          <p style={{ margin: "4px 0 0", fontSize: 13, opacity: 0.85 }}>No active incidents for this organization.</p>
        </div>
      )}

      {/* Incidents Table */}
      {incidents.length > 0 && (
        <div className="card card--elevated">
          <div className="card__header">
            <div className="card__title">Active Incidents</div>
          </div>
          <div className="table-container" style={{ border: "none", borderRadius: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Title</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Summary</th>
                  <th>Latest Update</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((incident) => (
                  <tr key={incident.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{new Date(incident.started_at).toLocaleString()}</td>
                    <td><strong>{incident.title}</strong></td>
                    <td><span className={badgeClass(incident.severity)}>{formatEnumLabel(incident.severity)}</span></td>
                    <td><span className={badgeClass(incident.status)}>{formatEnumLabel(incident.status)}</span></td>
                    <td>{incident.summary}</td>
                    <td>{incident.updates[0]?.message ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
