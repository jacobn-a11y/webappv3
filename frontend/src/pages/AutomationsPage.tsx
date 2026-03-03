import { useEffect, useState } from "react";
import {
  createAutomationRule,
  deleteAutomationRule,
  downloadAutomationReport,
  getAutomationReports,
  getAutomationRules,
  runAutomationRule,
  type AutomationRule,
  type AutomationScheduledReport,
} from "../lib/api";
import { formatEnumLabel, badgeClass, formatDate } from "../lib/format";
import { useToast } from "../components/Toast";

export function AutomationsPage({ userRole }: { userRole?: string }) {
  const isViewer = userRole === "VIEWER";
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [reports, setReports] = useState<AutomationScheduledReport[]>([]);
  const [name, setName] = useState("");
  const [ruleTemplate, setRuleTemplate] = useState<"GENERIC_ALERT" | "SCHEDULED_REPORT_EXPORT">(
    "GENERIC_ALERT"
  );
  const [triggerType, setTriggerType] = useState<"THRESHOLD" | "SCHEDULE" | "EVENT">("THRESHOLD");
  const [deliveryType, setDeliveryType] = useState<"SLACK" | "EMAIL" | "WEBHOOK">("EMAIL");
  const [deliveryTarget, setDeliveryTarget] = useState("");
  const [metric, setMetric] = useState("failure_rate");
  const [threshold, setThreshold] = useState("10");
  const [scheduleCron, setScheduleCron] = useState("0 9 * * 1");
  const [eventType, setEventType] = useState("INTEGRATION_FAILURE");
  const [runningRuleId, setRunningRuleId] = useState<string | null>(null);
  const [downloadingReportId, setDownloadingReportId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  const isScheduledReportTemplate = ruleTemplate === "SCHEDULED_REPORT_EXPORT";

  const saveBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const load = async () => {
    setError(null);
    try {
      const [rulesRes, reportsRes] = await Promise.all([
        getAutomationRules(),
        getAutomationReports(),
      ]);
      setRules(rulesRes.rules);
      setReports(reportsRes.reports);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load automations");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!name.trim() || !deliveryTarget.trim()) return;
    setError(null);
    const effectiveTriggerType = isScheduledReportTemplate ? "SCHEDULE" : triggerType;
    try {
      await createAutomationRule({
        name: name.trim(),
        enabled: true,
        trigger_type: effectiveTriggerType,
        metric: effectiveTriggerType === "THRESHOLD" ? metric : undefined,
        operator: effectiveTriggerType === "THRESHOLD" ? ">=" : undefined,
        threshold: effectiveTriggerType === "THRESHOLD" ? Number(threshold) : undefined,
        schedule_cron: effectiveTriggerType === "SCHEDULE" ? scheduleCron : undefined,
        event_type:
          effectiveTriggerType === "EVENT"
            ? eventType
            : isScheduledReportTemplate
              ? "SCHEDULED_REPORT_EXPORT"
              : undefined,
        delivery_type: deliveryType,
        delivery_target: deliveryTarget.trim(),
        payload_template: isScheduledReportTemplate ? { report_export: true } : undefined,
      });
      setName("");
      showToast("Automation rule created", "success");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create automation");
    }
  };

  return (
    <div className="page">
      <div className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">Workflow Automations</h1>
          <p className="page__subtitle">Configure rules to trigger alerts and actions automatically</p>
        </div>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {!isViewer && (
        <div className="card card--elevated">
          <div className="card__header">
            <div className="card__title">Create Rule</div>
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-group__label">Template</label>
              <select
                className="form-select"
                value={ruleTemplate}
                onChange={(e) =>
                  setRuleTemplate(
                    e.target.value as "GENERIC_ALERT" | "SCHEDULED_REPORT_EXPORT"
                  )
                }
              >
                <option value="GENERIC_ALERT">Alert / Automation Rule</option>
                <option value="SCHEDULED_REPORT_EXPORT">Scheduled Reporting Export</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-group__label">Rule Name</label>
              <input
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  isScheduledReportTemplate
                    ? "e.g. Weekly pipeline summary export"
                    : "e.g. Alert on high failure rate"
                }
              />
            </div>
            <div className="form-group">
              <label className="form-group__label">Trigger Type</label>
              <select
                className="form-select"
                value={isScheduledReportTemplate ? "SCHEDULE" : triggerType}
                onChange={(e) => setTriggerType(e.target.value as typeof triggerType)}
                disabled={isScheduledReportTemplate}
              >
                <option value="THRESHOLD">Threshold</option>
                <option value="SCHEDULE">Schedule</option>
                <option value="EVENT">Event</option>
              </select>
            </div>

            {!isScheduledReportTemplate && triggerType === "THRESHOLD" && (
              <>
                <div className="form-group">
                  <label className="form-group__label">Metric</label>
                  <input
                    className="form-input"
                    value={metric}
                    onChange={(e) => setMetric(e.target.value)}
                    placeholder="Metric name"
                  />
                </div>
                <div className="form-group">
                  <label className="form-group__label">Threshold</label>
                  <input
                    className="form-input"
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                    placeholder="Threshold value"
                  />
                </div>
              </>
            )}

            {(triggerType === "SCHEDULE" || isScheduledReportTemplate) && (
              <div className="form-group form-group--full">
                <label className="form-group__label">Cron Expression</label>
                <input
                  className="form-input"
                  value={scheduleCron}
                  onChange={(e) => setScheduleCron(e.target.value)}
                  placeholder="0 9 * * 1"
                />
                <span className="form-group__hint">
                  Standard cron format (minute hour day month weekday)
                  {isScheduledReportTemplate ? " for export delivery cadence." : ""}
                </span>
              </div>
            )}

            {!isScheduledReportTemplate && triggerType === "EVENT" && (
              <div className="form-group form-group--full">
                <label className="form-group__label">Event Type</label>
                <input
                  className="form-input"
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                  placeholder="Event type"
                />
              </div>
            )}

            <div className="form-group">
              <label className="form-group__label">Delivery Channel</label>
              <select
                className="form-select"
                value={deliveryType}
                onChange={(e) => setDeliveryType(e.target.value as typeof deliveryType)}
              >
                <option value="EMAIL">Email</option>
                <option value="SLACK">Slack</option>
                <option value="WEBHOOK">Webhook</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-group__label">Delivery Target</label>
              <input
                className="form-input"
                value={deliveryTarget}
                onChange={(e) => setDeliveryTarget(e.target.value)}
                placeholder={
                  deliveryType === "EMAIL"
                    ? "team@company.com"
                    : deliveryType === "SLACK"
                      ? "#channel"
                      : "https://..."
                }
              />
            </div>
          </div>
          <div className="form-actions-end">
            <button className="btn btn--primary" onClick={create}>Create Rule</button>
          </div>
        </div>
      )}

      <div className="card card--elevated">
        <div className="card__header">
          <div className="card__title">Configured Rules</div>
          <span className="badge badge--accent">{rules.length} rules</span>
        </div>
        <div className="table-container table-container--flush">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Trigger</th>
                <th>Delivery</th>
                <th>Last Run</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.length === 0 ? (
                <tr>
                  <td colSpan={6} className="data-table__empty">
                    <div className="state-view state-view--sm">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-border)" strokeWidth="1.5" aria-hidden="true"><polygon points="13,2 3,14 12,14 11,22 21,10 12,10 13,2" /></svg>
                      <div className="state-view__title">No automation rules configured</div>
                      <div className="state-view__message">Create rules to automatically trigger actions based on story events.</div>
                    </div>
                  </td>
                </tr>
              ) : (
                rules.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.name}</strong></td>
                    <td><span className="badge badge--accent">{formatEnumLabel(r.trigger_type)}</span></td>
                    <td><span className="badge badge--info">{formatEnumLabel(r.delivery_type)}</span></td>
                    <td>{r.last_run_at ? formatDate(r.last_run_at) : <span className="text-muted">Never</span>}</td>
                    <td>
                      {r.last_run_status
                        ? <span className={badgeClass(r.last_run_status)}>{formatEnumLabel(r.last_run_status)}</span>
                        : <span className="text-muted">-</span>
                      }
                    </td>
                    <td>
                      <div className="table-actions">
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={async () => {
                            try {
                              setRunningRuleId(r.id);
                              const run = await runAutomationRule(r.id);
                              if (run.report_asset_id) {
                                showToast("Rule executed and report generated", "success");
                              } else {
                                showToast("Rule executed", "success");
                              }
                              await load();
                            } catch (err) {
                              setError(err instanceof Error ? err.message : "Failed to run rule");
                            } finally {
                              setRunningRuleId(null);
                            }
                          }}
                        >
                          {runningRuleId === r.id ? "Running..." : "Run"}
                        </button>
                        <button
                          className="btn btn--ghost btn--sm btn--danger-text"
                          onClick={async () => {
                            await deleteAutomationRule(r.id);
                            showToast("Rule deleted", "info");
                            await load();
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card card--elevated">
        <div className="card__header">
          <div className="card__title">Recent Scheduled Reports</div>
          <span className="badge badge--accent">{reports.length} reports</span>
        </div>
        <div className="table-container table-container--flush">
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Window</th>
                <th>Generated</th>
                <th>Metrics Snapshot</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 ? (
                <tr>
                  <td colSpan={5} className="data-table__empty">
                    <div className="state-view state-view--sm">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-border)" strokeWidth="1.5" aria-hidden="true"><path d="M4 4h16v16H4z" /><path d="M8 8h8" /><path d="M8 12h8" /><path d="M8 16h5" /></svg>
                      <div className="state-view__title">No scheduled reports yet</div>
                      <div className="state-view__message">Run a scheduled report export rule to generate report assets.</div>
                    </div>
                  </td>
                </tr>
              ) : (
                reports.map((report) => {
                  const metricsSummary = report.metrics
                    ? Object.entries(report.metrics)
                        .slice(0, 3)
                        .map(([key, value]) => `${formatEnumLabel(key)}: ${value}`)
                        .join(" · ")
                    : "No metrics payload";
                  return (
                    <tr key={report.id}>
                      <td>
                        <strong>{report.title}</strong>
                        {report.description ? (
                          <div className="text-muted" style={{ marginTop: 4 }}>{report.description}</div>
                        ) : null}
                      </td>
                      <td>{report.window_days ? `${report.window_days} days` : <span className="text-muted">-</span>}</td>
                      <td>{formatDate(report.created_at)}</td>
                      <td>{metricsSummary}</td>
                      <td>
                        <div className="table-actions">
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={async () => {
                              try {
                                setDownloadingReportId(`${report.id}:csv`);
                                const blob = await downloadAutomationReport(report.id, "csv");
                                const safe = report.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
                                saveBlob(blob, `${safe || "scheduled-report"}.csv`);
                              } catch (err) {
                                setError(err instanceof Error ? err.message : "Failed to download CSV");
                              } finally {
                                setDownloadingReportId(null);
                              }
                            }}
                          >
                            {downloadingReportId === `${report.id}:csv` ? "Downloading..." : "CSV"}
                          </button>
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={async () => {
                              try {
                                setDownloadingReportId(`${report.id}:json`);
                                const blob = await downloadAutomationReport(report.id, "json");
                                const safe = report.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
                                saveBlob(blob, `${safe || "scheduled-report"}.json`);
                              } catch (err) {
                                setError(err instanceof Error ? err.message : "Failed to download JSON");
                              } finally {
                                setDownloadingReportId(null);
                              }
                            }}
                          >
                            {downloadingReportId === `${report.id}:json` ? "Downloading..." : "JSON"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
