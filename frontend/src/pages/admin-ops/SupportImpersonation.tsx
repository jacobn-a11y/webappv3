import { formatEnumLabel } from "../../lib/format";
import type { SupportImpersonationSession } from "../../lib/api";

export interface SupportImpersonationProps {
  supportSessions: SupportImpersonationSession[];
  activeSupportToken: string | null;
  supportTargetUserId: string;
  setSupportTargetUserId: (v: string) => void;
  supportReason: string;
  setSupportReason: (v: string) => void;
  supportTtlMinutes: number;
  setSupportTtlMinutes: (v: number) => void;
  supportWriteScope: boolean;
  setSupportWriteScope: (v: boolean) => void;
  startingSupportSession: boolean;
  revokingSupportSessionId: string | null;
  onStartSession: () => void;
  onClearSession: () => void;
  onRevokeSession: (sessionId: string) => void;
}

export function SupportImpersonation({
  supportSessions,
  activeSupportToken,
  supportTargetUserId,
  setSupportTargetUserId,
  supportReason,
  setSupportReason,
  supportTtlMinutes,
  setSupportTtlMinutes,
  supportWriteScope,
  setSupportWriteScope,
  startingSupportSession,
  revokingSupportSessionId,
  onStartSession,
  onClearSession,
  onRevokeSession,
}: SupportImpersonationProps) {
  return (
    <section className="card card--elevated">
      <h2>Support Impersonation</h2>
      <div className="kpi-grid">
        <div>Current Session Token: {activeSupportToken ? "Active in this browser" : "None"}</div>
      </div>
      <div className="form-row">
        <input value={supportTargetUserId} onChange={(e) => setSupportTargetUserId(e.target.value)} placeholder="Target user ID" />
        <input value={supportReason} onChange={(e) => setSupportReason(e.target.value)} placeholder="Reason (required)" />
        <input type="number" min={5} max={240} value={supportTtlMinutes} onChange={(e) => setSupportTtlMinutes(Number(e.target.value) || 30)} placeholder="TTL minutes" />
        <label>
          <input type="checkbox" checked={supportWriteScope} onChange={(e) => setSupportWriteScope(e.target.checked)} /> Allow write actions
        </label>
        <button className="btn btn--secondary" onClick={onStartSession} disabled={startingSupportSession}>
          {startingSupportSession ? "Starting..." : "Start"}
        </button>
        <button className="btn btn--secondary" onClick={onClearSession}>Clear Local Token</button>
      </div>
      <table className="data-table">
        <thead>
          <tr><th>Started</th><th>Actor</th><th>Target</th><th>Scope</th><th>Reason</th><th>Expires</th><th>Status</th><th>Action</th></tr>
        </thead>
        <tbody>
          {supportSessions.map((s) => (
            <tr key={s.id}>
              <td>{new Date(s.started_at).toLocaleString()}</td>
              <td>{s.actor_user_email}</td>
              <td>{s.target_user_email}</td>
              <td>{s.scope.map((value) => formatEnumLabel(value)).join(", ")}</td>
              <td>{s.reason}</td>
              <td>{new Date(s.expires_at).toLocaleString()}</td>
              <td>{s.revoked_at ? "Revoked" : "Active"}</td>
              <td>
                {s.revoked_at ? "-" : (
                  <button className="btn btn--secondary" onClick={() => onRevokeSession(s.id)} disabled={revokingSupportSessionId === s.id}>
                    {revokingSupportSessionId === s.id ? "Revoking..." : "Revoke"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
