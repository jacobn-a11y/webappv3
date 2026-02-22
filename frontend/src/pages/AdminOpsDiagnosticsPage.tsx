import { useEffect, useState } from "react";
import {
  addIncidentUpdate,
  createIncident,
  getDrReadiness,
  getIncidents,
  getIntegrationHealth,
  getIntegrationBackfills,
  getIntegrationDeadLetterRuns,
  getOpsDiagnostics,
  getPipelineStatus,
  getQueueSloMetrics,
  getSyntheticHealth,
  getSupportImpersonationSessions,
  runBackupVerification,
  runRestoreValidation,
  replayDeadLetterRun,
  revokeSupportImpersonationSession,
  setSupportImpersonationToken,
  readSupportImpersonationToken,
  startSupportImpersonation,
  triggerIntegrationBackfill,
  type BackfillRun,
  type DeadLetterRun,
  type DrReadiness,
  type IntegrationHealthRow,
  type IncidentRow,
  type OpsDiagnostics,
  type PipelineStatus,
  type QueueSloMetrics,
  type SupportImpersonationSession,
  type SyntheticHealth,
} from "../lib/api";

export function AdminOpsDiagnosticsPage() {
  const [data, setData] = useState<OpsDiagnostics | null>(null);
  const [deadLetterRuns, setDeadLetterRuns] = useState<DeadLetterRun[]>([]);
  const [backfills, setBackfills] = useState<BackfillRun[]>([]);
  const [integrationHealth, setIntegrationHealth] = useState<IntegrationHealthRow[]>([]);
  const [queueSlo, setQueueSlo] = useState<QueueSloMetrics | null>(null);
  const [syntheticHealth, setSyntheticHealth] = useState<SyntheticHealth | null>(null);
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus | null>(null);
  const [drReadiness, setDrReadiness] = useState<DrReadiness | null>(null);
  const [supportSessions, setSupportSessions] = useState<SupportImpersonationSession[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [backfillProvider, setBackfillProvider] = useState("GONG");
  const [backfillStartDate, setBackfillStartDate] = useState("");
  const [backfillCursor, setBackfillCursor] = useState("");
  const [supportTargetUserId, setSupportTargetUserId] = useState("");
  const [supportReason, setSupportReason] = useState("");
  const [supportTtlMinutes, setSupportTtlMinutes] = useState(30);
  const [supportWriteScope, setSupportWriteScope] = useState(false);
  const [startingSupportSession, setStartingSupportSession] = useState(false);
  const [revokingSupportSessionId, setRevokingSupportSessionId] = useState<string | null>(null);
  const [activeSupportToken, setActiveSupportToken] = useState<string | null>(readSupportImpersonationToken());
  const [incidentTitle, setIncidentTitle] = useState("");
  const [incidentSummary, setIncidentSummary] = useState("");
  const [incidentSeverity, setIncidentSeverity] = useState<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL">("MEDIUM");
  const [creatingIncident, setCreatingIncident] = useState(false);
  const [incidentUpdateText, setIncidentUpdateText] = useState<Record<string, string>>({});
  const [incidentUpdateStatus, setIncidentUpdateStatus] = useState<Record<string, "OPEN" | "MONITORING" | "RESOLVED" | "">>({});
  const [updatingIncidentId, setUpdatingIncidentId] = useState<string | null>(null);
  const [replayingRunId, setReplayingRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, dlq, backfillRes, healthRes, queueSloRes, syntheticHealthRes, pipelineRes, drRes, supportRes, incidentRes] = await Promise.all([
        getOpsDiagnostics(),
        getIntegrationDeadLetterRuns({ limit: 100 }),
        getIntegrationBackfills({ limit: 100 }),
        getIntegrationHealth(),
        getQueueSloMetrics(),
        getSyntheticHealth(),
        getPipelineStatus(),
        getDrReadiness(),
        getSupportImpersonationSessions(),
        getIncidents(),
      ]);
      setData(res);
      setDeadLetterRuns(dlq.failed_runs);
      setBackfills(backfillRes.backfills);
      setIntegrationHealth(healthRes.integrations);
      setQueueSlo(queueSloRes);
      setSyntheticHealth(syntheticHealthRes);
      setPipelineStatus(pipelineRes);
      setDrReadiness(drRes);
      setSupportSessions(supportRes.sessions);
      setIncidents(incidentRes.incidents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load diagnostics");
    } finally {
      setLoading(false);
    }
  };

  const triggerBackfill = async () => {
    setError(null);
    try {
      await triggerIntegrationBackfill({
        provider: backfillProvider as "GRAIN" | "GONG" | "SALESFORCE" | "MERGE_DEV",
        start_date: backfillStartDate
          ? new Date(backfillStartDate).toISOString()
          : undefined,
        cursor: backfillCursor || undefined,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to trigger backfill");
    }
  };

  const replayRun = async (runId: string) => {
    setReplayingRunId(runId);
    setError(null);
    try {
      await replayDeadLetterRun(runId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to replay run");
    } finally {
      setReplayingRunId(null);
    }
  };

  const triggerBackupVerify = async () => {
    setError(null);
    try {
      await runBackupVerification();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to verify backup");
    }
  };

  const triggerRestoreValidation = async () => {
    setError(null);
    try {
      await runRestoreValidation();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to validate restore");
    }
  };

  const startSupportSession = async () => {
    if (!supportTargetUserId.trim()) {
      setError("Target user ID is required to start support impersonation.");
      return;
    }
    if (!supportReason.trim()) {
      setError("A reason is required for support impersonation.");
      return;
    }
    setStartingSupportSession(true);
    setError(null);
    try {
      const created = await startSupportImpersonation({
        target_user_id: supportTargetUserId.trim(),
        reason: supportReason.trim(),
        ttl_minutes: supportTtlMinutes,
        scope: supportWriteScope ? ["READ_ONLY", "WRITE"] : ["READ_ONLY"],
      });
      setSupportImpersonationToken(created.support_impersonation_token);
      setActiveSupportToken(created.support_impersonation_token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start support impersonation");
    } finally {
      setStartingSupportSession(false);
    }
  };

  const clearSupportSession = async () => {
    setSupportImpersonationToken(null);
    setActiveSupportToken(null);
    await load();
  };

  const revokeSupportSession = async (sessionId: string) => {
    setRevokingSupportSessionId(sessionId);
    setError(null);
    try {
      await revokeSupportImpersonationSession(sessionId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke support impersonation session");
    } finally {
      setRevokingSupportSessionId(null);
    }
  };

  const submitIncident = async () => {
    if (!incidentTitle.trim() || !incidentSummary.trim()) {
      setError("Incident title and summary are required.");
      return;
    }
    setCreatingIncident(true);
    setError(null);
    try {
      await createIncident({
        title: incidentTitle.trim(),
        summary: incidentSummary.trim(),
        severity: incidentSeverity,
      });
      setIncidentTitle("");
      setIncidentSummary("");
      setIncidentSeverity("MEDIUM");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create incident");
    } finally {
      setCreatingIncident(false);
    }
  };

  const submitIncidentUpdate = async (incidentId: string) => {
    const message = incidentUpdateText[incidentId]?.trim() ?? "";
    if (!message) {
      setError("Incident update message is required.");
      return;
    }
    setUpdatingIncidentId(incidentId);
    setError(null);
    try {
      await addIncidentUpdate(incidentId, {
        message,
        status: incidentUpdateStatus[incidentId] || undefined,
      });
      setIncidentUpdateText((prev) => ({ ...prev, [incidentId]: "" }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add incident update");
    } finally {
      setUpdatingIncidentId(null);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="admin-ops__page">
      <header className="admin-ops__header">
        <h1 className="admin-ops__title">Ops Diagnostics</h1>
        <button className="btn btn--secondary" onClick={load}>
          Refresh
        </button>
      </header>

      {loading && <div>Loading diagnostics...</div>}
      {error && <div className="admin-story-context__error">{error}</div>}

      {!loading && data && (
        <>
          <section className="admin-ops__card">
            <h2>Tenant Totals</h2>
            <div className="admin-ops__grid">
              <div>Accounts: {data.tenant.totals.accounts}</div>
              <div>Calls: {data.tenant.totals.calls}</div>
              <div>Stories: {data.tenant.totals.stories}</div>
              <div>Landing Pages: {data.tenant.totals.landing_pages}</div>
            </div>
          </section>

          <section className="admin-ops__card">
            <h2>Pipeline Status (Last 24h)</h2>
            {pipelineStatus ? (
              <>
                <div className="admin-ops__grid">
                  <div>Pending Approvals: {pipelineStatus.pending_approvals}</div>
                  <div>Failed Backfills: {pipelineStatus.failed_backfills}</div>
                  <div>Sync Failed: {pipelineStatus.sync.failed}</div>
                  <div>Replay Failed: {pipelineStatus.replay.failed}</div>
                </div>
                <table className="admin-ops__table">
                  <thead>
                    <tr>
                      <th>Run Type</th>
                      <th>Status</th>
                      <th>Provider</th>
                      <th>Started</th>
                      <th>Processed</th>
                      <th>Failures</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pipelineStatus.latest_runs.map((r, idx) => (
                      <tr key={`${r.run_type}-${r.started_at}-${idx}`}>
                        <td>{r.run_type}</td>
                        <td>{r.status}</td>
                        <td>{r.provider}</td>
                        <td>{new Date(r.started_at).toLocaleString()}</td>
                        <td>{r.processed_count}</td>
                        <td>{r.failure_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <div>No pipeline status available.</div>
            )}
          </section>

          <section className="admin-ops__card">
            <h2>DR Readiness</h2>
            {drReadiness ? (
              <>
                <div className="admin-ops__grid">
                  <div>Status: {drReadiness.status}</div>
                  <div>RTO Target: {drReadiness.targets.rto_minutes}m</div>
                  <div>RPO Target: {drReadiness.targets.rpo_minutes}m</div>
                  <div>Backup Age: {drReadiness.backup_age_minutes ?? "-"}m</div>
                </div>
                <div className="admin-security__inline">
                  <button className="btn btn--secondary" onClick={triggerBackupVerify}>
                    Verify Backup Snapshot
                  </button>
                  <button className="btn btn--secondary" onClick={triggerRestoreValidation}>
                    Run Restore Validation
                  </button>
                </div>
              </>
            ) : (
              <div>No DR readiness data.</div>
            )}
          </section>

          <section className="admin-ops__card">
            <h2>Synthetic Dependency Health</h2>
            {syntheticHealth ? (
              <>
                <div>
                  Status: <strong>{syntheticHealth.status}</strong> (checked{" "}
                  {new Date(syntheticHealth.checked_at).toLocaleString()})
                </div>
                <table className="admin-ops__table">
                  <thead>
                    <tr>
                      <th>Dependency</th>
                      <th>Healthy</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syntheticHealth.checks.map((c) => (
                      <tr key={c.dependency}>
                        <td>{c.dependency}</td>
                        <td>{c.healthy ? "Yes" : "No"}</td>
                        <td>{c.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <div>No synthetic health data.</div>
            )}
          </section>

          <section className="admin-ops__card">
            <h2>Queue SLO (Last 24h)</h2>
            {queueSlo ? (
              <>
                <div className="admin-ops__grid">
                  <div>Total Runs: {queueSlo.total_runs}</div>
                  <div>Failed Runs: {queueSlo.failed_runs}</div>
                  <div>Failure Rate: {queueSlo.failure_rate}%</div>
                  <div>Stale Integrations: {queueSlo.stale_integrations}</div>
                </div>
                {queueSlo.alerts.length > 0 && (
                  <ul>
                    {queueSlo.alerts.map((a) => (
                      <li key={`${a.code}-${a.message}`}>
                        [{a.severity}] {a.message}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <div>No queue metrics available.</div>
            )}
          </section>

          <section className="admin-ops__card">
            <h2>Support Impersonation</h2>
            <div className="admin-ops__grid">
              <div>
                Current Session Token:{" "}
                {activeSupportToken ? "Active in this browser" : "None"}
              </div>
            </div>
            <div className="admin-security__inline">
              <input
                value={supportTargetUserId}
                onChange={(e) => setSupportTargetUserId(e.target.value)}
                placeholder="Target user ID"
              />
              <input
                value={supportReason}
                onChange={(e) => setSupportReason(e.target.value)}
                placeholder="Reason (required)"
              />
              <input
                type="number"
                min={5}
                max={240}
                value={supportTtlMinutes}
                onChange={(e) => setSupportTtlMinutes(Number(e.target.value) || 30)}
                placeholder="TTL minutes"
              />
              <label>
                <input
                  type="checkbox"
                  checked={supportWriteScope}
                  onChange={(e) => setSupportWriteScope(e.target.checked)}
                />{" "}
                Allow write actions
              </label>
              <button
                className="btn btn--secondary"
                onClick={startSupportSession}
                disabled={startingSupportSession}
              >
                {startingSupportSession ? "Starting..." : "Start"}
              </button>
              <button className="btn btn--secondary" onClick={clearSupportSession}>
                Clear Local Token
              </button>
            </div>
            <table className="admin-ops__table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Actor</th>
                  <th>Target</th>
                  <th>Scope</th>
                  <th>Reason</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {supportSessions.map((s) => (
                  <tr key={s.id}>
                    <td>{new Date(s.started_at).toLocaleString()}</td>
                    <td>{s.actor_user_email}</td>
                    <td>{s.target_user_email}</td>
                    <td>{s.scope.join(", ")}</td>
                    <td>{s.reason}</td>
                    <td>{new Date(s.expires_at).toLocaleString()}</td>
                    <td>{s.revoked_at ? "Revoked" : "Active"}</td>
                    <td>
                      {s.revoked_at ? (
                        "-"
                      ) : (
                        <button
                          className="btn btn--secondary"
                          onClick={() => revokeSupportSession(s.id)}
                          disabled={revokingSupportSessionId === s.id}
                        >
                          {revokingSupportSessionId === s.id ? "Revoking..." : "Revoke"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="admin-ops__card">
            <h2>Incident Response & Status</h2>
            <div className="admin-security__inline">
              <input
                value={incidentTitle}
                onChange={(e) => setIncidentTitle(e.target.value)}
                placeholder="Incident title"
              />
              <input
                value={incidentSummary}
                onChange={(e) => setIncidentSummary(e.target.value)}
                placeholder="Incident summary"
              />
              <select
                value={incidentSeverity}
                onChange={(e) =>
                  setIncidentSeverity(
                    e.target.value as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
                  )
                }
              >
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
                <option value="CRITICAL">CRITICAL</option>
              </select>
              <button
                className="btn btn--secondary"
                onClick={submitIncident}
                disabled={creatingIncident}
              >
                {creatingIncident ? "Creating..." : "Open Incident"}
              </button>
            </div>

            {incidents.length === 0 ? (
              <div>No incidents reported.</div>
            ) : (
              <table className="admin-ops__table">
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Title</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Summary</th>
                    <th>Update</th>
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
                      <td>
                        <div className="admin-security__inline">
                          <input
                            value={incidentUpdateText[incident.id] ?? ""}
                            onChange={(e) =>
                              setIncidentUpdateText((prev) => ({
                                ...prev,
                                [incident.id]: e.target.value,
                              }))
                            }
                            placeholder="Update message"
                          />
                          <select
                            value={incidentUpdateStatus[incident.id] ?? ""}
                            onChange={(e) =>
                              setIncidentUpdateStatus((prev) => ({
                                ...prev,
                                [incident.id]:
                                  e.target.value as "OPEN" | "MONITORING" | "RESOLVED",
                              }))
                            }
                          >
                            <option value="">Keep Status</option>
                            <option value="OPEN">OPEN</option>
                            <option value="MONITORING">MONITORING</option>
                            <option value="RESOLVED">RESOLVED</option>
                          </select>
                          <button
                            className="btn btn--secondary"
                            onClick={() => submitIncidentUpdate(incident.id)}
                            disabled={updatingIncidentId === incident.id}
                          >
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

          <section className="admin-ops__card">
            <h2>Integration Health</h2>
            <table className="admin-ops__table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Status</th>
                  <th>Lag (min)</th>
                  <th>Last Success</th>
                  <th>Last Failure</th>
                  <th>Recent Throughput</th>
                  <th>Recent Failures</th>
                </tr>
              </thead>
              <tbody>
                {integrationHealth.map((h) => (
                  <tr key={h.id}>
                    <td>{h.provider}</td>
                    <td>{h.status}</td>
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

          <section className="admin-ops__card">
            <h2>Integrations</h2>
            <div className="admin-ops__grid">
              <div>Total: {data.integrations.total}</div>
              <div>Enabled: {data.integrations.enabled}</div>
              <div>Failed: {data.integrations.failed}</div>
            </div>
            <table className="admin-ops__table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Status</th>
                  <th>Enabled</th>
                  <th>Last Sync</th>
                  <th>Last Error</th>
                </tr>
              </thead>
              <tbody>
                {data.integrations.providers.map((p) => (
                  <tr key={p.id}>
                    <td>{p.provider}</td>
                    <td>{p.status}</td>
                    <td>{p.enabled ? "Yes" : "No"}</td>
                    <td>{p.last_sync_at ? new Date(p.last_sync_at).toLocaleString() : "-"}</td>
                    <td>{p.last_error ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="admin-ops__card">
            <h2>Recent Audit Events</h2>
            <table className="admin-ops__table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Category</th>
                  <th>Action</th>
                  <th>Severity</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_audit_events.map((a) => (
                  <tr key={a.id}>
                    <td>{new Date(a.created_at).toLocaleString()}</td>
                    <td>{a.category}</td>
                    <td>{a.action}</td>
                    <td>{a.severity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="admin-ops__card">
            <h2>Dead-Letter Integration Runs</h2>
            {deadLetterRuns.length === 0 ? (
              <div>No failed integration runs.</div>
            ) : (
              <table className="admin-ops__table">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Started</th>
                    <th>Error</th>
                    <th>Failures</th>
                    <th>Replay</th>
                  </tr>
                </thead>
                <tbody>
                  {deadLetterRuns.map((r) => (
                    <tr key={r.id}>
                      <td>{r.provider}</td>
                      <td>{new Date(r.started_at).toLocaleString()}</td>
                      <td>{r.error_message ?? "-"}</td>
                      <td>{r.failure_count}</td>
                      <td>
                        <button
                          className="btn btn--secondary"
                          onClick={() => replayRun(r.id)}
                          disabled={replayingRunId === r.id}
                        >
                          {replayingRunId === r.id ? "Replaying..." : "Replay"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="admin-ops__card">
            <h2>Backfill Runs</h2>
            <div className="admin-security__inline">
              <select
                value={backfillProvider}
                onChange={(e) => setBackfillProvider(e.target.value)}
              >
                <option value="GONG">GONG</option>
                <option value="GRAIN">GRAIN</option>
                <option value="SALESFORCE">SALESFORCE</option>
                <option value="MERGE_DEV">MERGE_DEV</option>
              </select>
              <input
                type="datetime-local"
                value={backfillStartDate}
                onChange={(e) => setBackfillStartDate(e.target.value)}
              />
              <input
                value={backfillCursor}
                onChange={(e) => setBackfillCursor(e.target.value)}
                placeholder="Cursor (optional)"
              />
              <button className="btn btn--secondary" onClick={triggerBackfill}>
                Trigger Backfill
              </button>
            </div>
            <table className="admin-ops__table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Processed</th>
                  <th>Failures</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {backfills.map((r) => (
                  <tr key={r.id}>
                    <td>{r.provider}</td>
                    <td>{r.status}</td>
                    <td>{new Date(r.started_at).toLocaleString()}</td>
                    <td>{r.processed_count}</td>
                    <td>{r.failure_count}</td>
                    <td>{r.error_message ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
