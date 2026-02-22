import { useEffect, useMemo, useState } from "react";
import {
  getPublicStatusIncidents,
  type PublicStatusIncident,
} from "../lib/api";

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

  return (
    <div className="admin-security__page">
      <h1 className="admin-security__title">Status</h1>
      <section className="admin-security__card">
        <h2>Public Incident Feed</h2>
        <div className="admin-security__inline">
          <input
            value={organizationId}
            onChange={(e) => setOrganizationId(e.target.value)}
            placeholder="Organization ID"
          />
          <button className="btn btn--secondary" onClick={() => load(organizationId)}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
        {error && <div className="admin-story-context__error">{error}</div>}
      </section>

      <section className="admin-security__card">
        <h2>Summary</h2>
        <div className="admin-ops__grid">
          <div>Open: {grouped.open.length}</div>
          <div>Monitoring: {grouped.monitoring.length}</div>
          <div>Total Active Incidents: {incidents.length}</div>
        </div>
      </section>

      <section className="admin-security__card">
        <h2>Active Incidents</h2>
        {incidents.length === 0 ? (
          <div>No active incidents for this organization.</div>
        ) : (
          <table className="admin-ops__table">
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
                  <td>{new Date(incident.started_at).toLocaleString()}</td>
                  <td>{incident.title}</td>
                  <td>{incident.severity}</td>
                  <td>{incident.status}</td>
                  <td>{incident.summary}</td>
                  <td>{incident.updates[0]?.message ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
