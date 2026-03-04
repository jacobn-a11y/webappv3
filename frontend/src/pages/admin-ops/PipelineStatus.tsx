import { badgeClass, formatEnumLabel } from "../../lib/format";
import type { OpsDiagnostics, PipelineStatus as PipelineStatusData, DrReadiness, SyntheticHealth, QueueSloMetrics, SellerAdoptionMetrics, ReplayObservability, BackfillRun, DeadLetterRun } from "../../lib/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatDurationMs(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  const seconds = Math.max(0, Math.round(value / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${remMinutes}m`;
}

// ─── Pipeline Status ──────────────────────────────────────────────────────────

export interface PipelineStatusProps {
  data: OpsDiagnostics;
  pipelineStatus: PipelineStatusData | null;
  drReadiness: DrReadiness | null;
  syntheticHealth: SyntheticHealth | null;
  queueSlo: QueueSloMetrics | null;
  sellerAdoption: SellerAdoptionMetrics | null;
  replayObservability: ReplayObservability | null;
  backfills: BackfillRun[];
  deadLetterRuns: DeadLetterRun[];
  // Replay filter state
  replayWindowHours: number;
  setReplayWindowHours: (v: number) => void;
  replayProviderFilter: string;
  setReplayProviderFilter: (v: string) => void;
  replayOutcomeFilter: string;
  setReplayOutcomeFilter: (v: string) => void;
  replayRunTypeFilter: string;
  setReplayRunTypeFilter: (v: string) => void;
  replayOperatorFilter: string;
  setReplayOperatorFilter: (v: string) => void;
  replayingRunId: string | null;
  // Backfill state
  backfillProvider: string;
  setBackfillProvider: (v: string) => void;
  backfillStartDate: string;
  setBackfillStartDate: (v: string) => void;
  backfillCursor: string;
  setBackfillCursor: (v: string) => void;
  // Callbacks
  onLoad: () => void;
  onTriggerBackfill: () => void;
  onTriggerBackupVerify: () => void;
  onTriggerRestoreValidation: () => void;
  onReplayRun: (runId: string) => void;
}

export function PipelineStatusSection({
  data,
  pipelineStatus,
  drReadiness,
  syntheticHealth,
  queueSlo,
  sellerAdoption,
  replayObservability,
  backfills,
  deadLetterRuns,
  replayWindowHours, setReplayWindowHours,
  replayProviderFilter, setReplayProviderFilter,
  replayOutcomeFilter, setReplayOutcomeFilter,
  replayRunTypeFilter, setReplayRunTypeFilter,
  replayOperatorFilter, setReplayOperatorFilter,
  replayingRunId,
  backfillProvider, setBackfillProvider,
  backfillStartDate, setBackfillStartDate,
  backfillCursor, setBackfillCursor,
  onLoad,
  onTriggerBackfill,
  onTriggerBackupVerify,
  onTriggerRestoreValidation,
  onReplayRun,
}: PipelineStatusProps) {
  return (
    <>
      <section className="card card--elevated">
        <h2>Tenant Totals</h2>
        <div className="kpi-grid">
          <div>Accounts: {data.tenant.totals.accounts}</div>
          <div>Calls: {data.tenant.totals.calls}</div>
          <div>Stories: {data.tenant.totals.stories}</div>
          <div>Landing Pages: {data.tenant.totals.landing_pages}</div>
        </div>
      </section>

      <section className="card card--elevated">
        <h2>Pipeline Status (Last 24h)</h2>
        {pipelineStatus ? (
          <>
            <div className="kpi-grid">
              <div>Pending Approvals: {pipelineStatus.pending_approvals}</div>
              <div>Failed Backfills: {pipelineStatus.failed_backfills}</div>
              <div>Sync Failed: {pipelineStatus.sync.failed}</div>
              <div>Replay Failed: {pipelineStatus.replay.failed}</div>
            </div>
            <table className="data-table">
              <thead>
                <tr><th>Run Type</th><th>Status</th><th>Provider</th><th>Started</th><th>Processed</th><th>Failures</th></tr>
              </thead>
              <tbody>
                {pipelineStatus.latest_runs.map((r, idx) => (
                  <tr key={`${r.run_type}-${r.started_at}-${idx}`}>
                    <td>{formatEnumLabel(r.run_type)}</td>
                    <td><span className={badgeClass(r.status)}>{formatEnumLabel(r.status)}</span></td>
                    <td>{formatEnumLabel(r.provider)}</td>
                    <td>{new Date(r.started_at).toLocaleString()}</td>
                    <td>{r.processed_count}</td>
                    <td>{r.failure_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (<div>No pipeline status available.</div>)}
      </section>

      <section className="card card--elevated">
        <h2>DR Readiness</h2>
        {drReadiness ? (
          <>
            <div className="kpi-grid">
              <div>Status: {formatEnumLabel(drReadiness.status)}</div>
              <div>RTO Target: {drReadiness.targets.rto_minutes}m</div>
              <div>RPO Target: {drReadiness.targets.rpo_minutes}m</div>
              <div>Backup Age: {drReadiness.backup_age_minutes ?? "-"}m</div>
            </div>
            <div className="form-row">
              <button className="btn btn--secondary" onClick={onTriggerBackupVerify}>Verify Backup Snapshot</button>
              <button className="btn btn--secondary" onClick={onTriggerRestoreValidation}>Run Restore Validation</button>
            </div>
          </>
        ) : (<div>No DR readiness data.</div>)}
      </section>

      <section className="card card--elevated">
        <h2>Synthetic Dependency Health</h2>
        {syntheticHealth ? (
          <>
            <div>Status: <strong>{formatEnumLabel(syntheticHealth.status)}</strong> (checked {new Date(syntheticHealth.checked_at).toLocaleString()})</div>
            <table className="data-table">
              <thead><tr><th>Dependency</th><th>Healthy</th><th>Detail</th></tr></thead>
              <tbody>
                {syntheticHealth.checks.map((c) => (
                  <tr key={c.dependency}><td>{c.dependency}</td><td>{c.healthy ? "Yes" : "No"}</td><td>{c.detail}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (<div>No synthetic health data.</div>)}
      </section>

      <section className="card card--elevated">
        <h2>Queue SLO (Last 24h)</h2>
        {queueSlo ? (
          <>
            <div className="kpi-grid">
              <div>Total Runs: {queueSlo.total_runs}</div>
              <div>Failed Runs: {queueSlo.failed_runs}</div>
              <div>Failure Rate: {queueSlo.failure_rate}%</div>
              <div>Stale Integrations: {queueSlo.stale_integrations}</div>
            </div>
            {queueSlo.alerts.length > 0 && (
              <ul>{queueSlo.alerts.map((a) => (<li key={`${a.code}-${a.message}`}>[{formatEnumLabel(a.severity)}] {a.message}</li>))}</ul>
            )}
          </>
        ) : (<div>No queue metrics available.</div>)}
      </section>

      <section className="card card--elevated">
        <h2>Seller Adoption (Last 30d)</h2>
        {sellerAdoption ? (
          <>
            <div className="kpi-grid">
              <div>Events: {sellerAdoption.totals.event_count}</div>
              <div>Flows: {sellerAdoption.totals.flow_count}</div>
              <div>Users: {sellerAdoption.totals.user_count}</div>
              <div>Median Time to First Story: {formatDurationMs(sellerAdoption.kpis.median_time_to_first_story_ms)}</div>
              <div>Median Time to Share: {formatDurationMs(sellerAdoption.kpis.median_time_to_share_ms)}</div>
            </div>
            <table className="data-table">
              <thead><tr><th>Funnel Step</th><th>Flows</th><th>Conversion</th></tr></thead>
              <tbody>{sellerAdoption.funnel.steps.map((row) => (<tr key={row.step}><td>{formatEnumLabel(row.step)}</td><td>{row.flows}</td><td>{Math.round(row.conversion_from_start * 100)}%</td></tr>))}</tbody>
            </table>
          </>
        ) : (<div>No seller adoption telemetry available.</div>)}
      </section>

      <section className="card card--elevated">
        <h2>Replay Observability</h2>
        <div className="form-row">
          <label>Window (hours)<input type="number" min={1} max={168} value={replayWindowHours} onChange={(e) => setReplayWindowHours(Number(e.target.value) || 24)} /></label>
          <input value={replayProviderFilter} onChange={(e) => setReplayProviderFilter(e.target.value.toUpperCase())} placeholder="Provider (optional)" />
          <select value={replayOutcomeFilter} onChange={(e) => setReplayOutcomeFilter(e.target.value)}>
            <option value="">All outcomes</option><option value="COMPLETED">Completed</option><option value="FAILED">Failed</option><option value="RUNNING">Running</option><option value="PENDING">Pending</option>
          </select>
          <select value={replayRunTypeFilter} onChange={(e) => setReplayRunTypeFilter(e.target.value)}>
            <option value="">All source run types</option><option value="SYNC">Sync</option><option value="BACKFILL">Backfill</option><option value="MANUAL">Manual</option><option value="REPLAY">Replay</option>
          </select>
          <input value={replayOperatorFilter} onChange={(e) => setReplayOperatorFilter(e.target.value)} placeholder="Operator user ID (optional)" />
          <button className="btn btn--secondary" onClick={onLoad}>Apply Replay Filters</button>
        </div>
        {replayObservability ? (
          <>
            <div className="kpi-grid">
              <div>Replay Triggers: {replayObservability.totals.replay_triggers}</div>
              <div>Unique Operators: {replayObservability.totals.unique_operators}</div>
              <div>Window: {replayObservability.window_hours}h</div>
            </div>
            <table className="data-table">
              <thead><tr><th>Outcome</th><th>Count</th></tr></thead>
              <tbody>{replayObservability.outcomes.map((row) => (<tr key={row.outcome}><td>{formatEnumLabel(row.outcome)}</td><td>{row.count}</td></tr>))}</tbody>
            </table>
            <h3>By Operator</h3>
            <table className="data-table">
              <thead><tr><th>Operator</th><th>Role</th><th>Replay Triggers</th><th>Providers</th><th>Last Triggered</th></tr></thead>
              <tbody>
                {replayObservability.operators.map((row, idx) => (
                  <tr key={`${row.actor_user_id ?? "unknown"}-${idx}`}>
                    <td>{row.actor_user_email ?? row.actor_user_id ?? "Unknown actor"}</td>
                    <td>{row.actor_user_role ? formatEnumLabel(row.actor_user_role) : "-"}</td>
                    <td>{row.replay_triggers}</td>
                    <td>{row.providers.map((p) => formatEnumLabel(p)).join(", ") || "-"}</td>
                    <td>{new Date(row.last_triggered_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>Recent Replay Events</h3>
            {replayObservability.recent_events.length === 0 ? (<div>No replay events for current filters.</div>) : (
              <table className="data-table">
                <thead><tr><th>Triggered</th><th>Provider</th><th>Outcome</th><th>Operator</th><th>Source Run</th><th>Replay Attempt</th></tr></thead>
                <tbody>
                  {replayObservability.recent_events.map((event) => (
                    <tr key={event.audit_log_id}>
                      <td>{new Date(event.triggered_at).toLocaleString()}</td>
                      <td>{formatEnumLabel(event.provider)}</td>
                      <td><span className={badgeClass(event.outcome)}>{formatEnumLabel(event.outcome)}</span></td>
                      <td>{event.actor_user_id ?? "-"}</td>
                      <td>{event.source_run_id ?? "-"}</td>
                      <td>{event.replay_attempt !== null ? `${event.replay_attempt}${event.replay_attempt_cap !== null ? `/${event.replay_attempt_cap}` : ""}` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : (<div>No replay observability data.</div>)}
      </section>

      <section className="card card--elevated">
        <h2>Dead-Letter Integration Runs</h2>
        {deadLetterRuns.length === 0 ? (<div>No failed integration runs.</div>) : (
          <table className="data-table">
            <thead><tr><th>Provider</th><th>Started</th><th>Error</th><th>Failures</th><th>Replay</th></tr></thead>
            <tbody>
              {deadLetterRuns.map((r) => (
                <tr key={r.id}>
                  <td>{formatEnumLabel(r.provider)}</td>
                  <td>{new Date(r.started_at).toLocaleString()}</td>
                  <td>{r.error_message ?? "-"}</td>
                  <td>{r.failure_count}</td>
                  <td><button className="btn btn--secondary" onClick={() => onReplayRun(r.id)} disabled={replayingRunId === r.id}>{replayingRunId === r.id ? "Replaying..." : "Replay"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card card--elevated">
        <h2>Backfill Runs</h2>
        <div className="form-row">
          <select value={backfillProvider} onChange={(e) => setBackfillProvider(e.target.value)}>
            <option value="GONG">{formatEnumLabel("GONG")}</option>
            <option value="GRAIN">{formatEnumLabel("GRAIN")}</option>
            <option value="SALESFORCE">{formatEnumLabel("SALESFORCE")}</option>
            <option value="MERGE_DEV">{formatEnumLabel("MERGE_DEV")}</option>
          </select>
          <input type="datetime-local" value={backfillStartDate} onChange={(e) => setBackfillStartDate(e.target.value)} />
          <input value={backfillCursor} onChange={(e) => setBackfillCursor(e.target.value)} placeholder="Cursor (optional)" />
          <button className="btn btn--secondary" onClick={onTriggerBackfill}>Trigger Backfill</button>
        </div>
        <table className="data-table">
          <thead><tr><th>Provider</th><th>Status</th><th>Started</th><th>Processed</th><th>Failures</th><th>Error</th></tr></thead>
          <tbody>
            {backfills.map((r) => (
              <tr key={r.id}>
                <td>{formatEnumLabel(r.provider)}</td>
                <td><span className={badgeClass(r.status)}>{formatEnumLabel(r.status)}</span></td>
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
  );
}
