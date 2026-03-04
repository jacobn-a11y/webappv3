import { badgeClass, formatEnumLabel } from "../../lib/format";
import type { IncidentRow } from "../../lib/api";

export interface IncidentResponseProps {
  incidents: IncidentRow[];
  incidentTitle: string;
  setIncidentTitle: (v: string) => void;
  incidentSummary: string;
  setIncidentSummary: (v: string) => void;
  incidentSeverity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  setIncidentSeverity: (v: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL") => void;
  creatingIncident: boolean;
  incidentUpdateText: Record<string, string>;
  setIncidentUpdateText: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
  incidentUpdateStatus: Record<string, "OPEN" | "MONITORING" | "RESOLVED" | "">;
  setIncidentUpdateStatus: (fn: (prev: Record<string, "OPEN" | "MONITORING" | "RESOLVED" | "">) => Record<string, "OPEN" | "MONITORING" | "RESOLVED" | "">) => void;
  updatingIncidentId: string | null;
  onSubmitIncident: () => void;
  onSubmitIncidentUpdate: (incidentId: string) => void;
}

export function IncidentResponse({
  incidents,
  incidentTitle,
  setIncidentTitle,
  incidentSummary,
  setIncidentSummary,
  incidentSeverity,
  setIncidentSeverity,
  creatingIncident,
  incidentUpdateText,
  setIncidentUpdateText,
  incidentUpdateStatus,
  setIncidentUpdateStatus,
  updatingIncidentId,
  onSubmitIncident,
  onSubmitIncidentUpdate,
}: IncidentResponseProps) {
  return (
    <section className="card card--elevated">
      <h2>Incident Response & Status</h2>
      <div className="form-row">
        <input value={incidentTitle} onChange={(e) => setIncidentTitle(e.target.value)} placeholder="Incident title" />
        <input value={incidentSummary} onChange={(e) => setIncidentSummary(e.target.value)} placeholder="Incident summary" />
        <select value={incidentSeverity} onChange={(e) => setIncidentSeverity(e.target.value as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL")}>
          <option value="LOW">{formatEnumLabel("LOW")}</option>
          <option value="MEDIUM">{formatEnumLabel("MEDIUM")}</option>
          <option value="HIGH">{formatEnumLabel("HIGH")}</option>
          <option value="CRITICAL">{formatEnumLabel("CRITICAL")}</option>
        </select>
        <button className="btn btn--secondary" onClick={onSubmitIncident} disabled={creatingIncident}>
          {creatingIncident ? "Creating..." : "Open Incident"}
        </button>
      </div>

      {incidents.length === 0 ? (
        <div>No incidents reported.</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Started</th><th>Title</th><th>Severity</th><th>Status</th><th>Summary</th><th>Update</th></tr>
          </thead>
          <tbody>
            {incidents.map((incident) => (
              <tr key={incident.id}>
                <td>{new Date(incident.started_at).toLocaleString()}</td>
                <td>{incident.title}</td>
                <td><span className={badgeClass(incident.severity)}>{formatEnumLabel(incident.severity)}</span></td>
                <td><span className={badgeClass(incident.status)}>{formatEnumLabel(incident.status)}</span></td>
                <td>{incident.summary}</td>
                <td>
                  <div className="form-row">
                    <input
                      value={incidentUpdateText[incident.id] ?? ""}
                      onChange={(e) => setIncidentUpdateText((prev) => ({ ...prev, [incident.id]: e.target.value }))}
                      placeholder="Update message"
                    />
                    <select
                      value={incidentUpdateStatus[incident.id] ?? ""}
                      onChange={(e) => setIncidentUpdateStatus((prev) => ({ ...prev, [incident.id]: e.target.value as "OPEN" | "MONITORING" | "RESOLVED" }))}
                    >
                      <option value="">Keep Status</option>
                      <option value="OPEN">{formatEnumLabel("OPEN")}</option>
                      <option value="MONITORING">{formatEnumLabel("MONITORING")}</option>
                      <option value="RESOLVED">{formatEnumLabel("RESOLVED")}</option>
                    </select>
                    <button className="btn btn--secondary" onClick={() => onSubmitIncidentUpdate(incident.id)} disabled={updatingIncidentId === incident.id}>
                      {updatingIncidentId === incident.id ? "Posting..." : "Post"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
