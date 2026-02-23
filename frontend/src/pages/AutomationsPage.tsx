import { useEffect, useState } from "react";
import {
  createAutomationRule,
  deleteAutomationRule,
  getAutomationRules,
  runAutomationRule,
  type AutomationRule,
} from "../lib/api";
import { formatEnumLabel, badgeClass, formatDate } from "../lib/format";
import { useToast } from "../components/Toast";

export function AutomationsPage({ userRole }: { userRole?: string }) {
  const isViewer = userRole === "VIEWER";
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState<"THRESHOLD" | "SCHEDULE" | "EVENT">("THRESHOLD");
  const [deliveryType, setDeliveryType] = useState<"SLACK" | "EMAIL" | "WEBHOOK">("EMAIL");
  const [deliveryTarget, setDeliveryTarget] = useState("");
  const [metric, setMetric] = useState("failure_rate");
  const [threshold, setThreshold] = useState("10");
  const [scheduleCron, setScheduleCron] = useState("0 9 * * 1");
  const [eventType, setEventType] = useState("INTEGRATION_FAILURE");
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  const load = async () => {
    setError(null);
    try {
      const res = await getAutomationRules();
      setRules(res.rules);
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
    try {
      await createAutomationRule({
        name: name.trim(),
        enabled: true,
        trigger_type: triggerType,
        metric: triggerType === "THRESHOLD" ? metric : undefined,
        operator: triggerType === "THRESHOLD" ? ">=" : undefined,
        threshold: triggerType === "THRESHOLD" ? Number(threshold) : undefined,
        schedule_cron: triggerType === "SCHEDULE" ? scheduleCron : undefined,
        event_type: triggerType === "EVENT" ? eventType : undefined,
        delivery_type: deliveryType,
        delivery_target: deliveryTarget.trim(),
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

      {/* Create Rule */}
      {!isViewer && <div className="card card--elevated">
        <div className="card__header">
          <div className="card__title">Create Rule</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="form-group">
            <label className="form-group__label">Rule Name</label>
            <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alert on high failure rate" />
          </div>
          <div className="form-group">
            <label className="form-group__label">Trigger Type</label>
            <select className="form-select" value={triggerType} onChange={(e) => setTriggerType(e.target.value as typeof triggerType)}>
              <option value="THRESHOLD">Threshold</option>
              <option value="SCHEDULE">Schedule</option>
              <option value="EVENT">Event</option>
            </select>
          </div>

          {triggerType === "THRESHOLD" && (
            <>
              <div className="form-group">
                <label className="form-group__label">Metric</label>
                <input className="form-input" value={metric} onChange={(e) => setMetric(e.target.value)} placeholder="Metric name" />
              </div>
              <div className="form-group">
                <label className="form-group__label">Threshold</label>
                <input className="form-input" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="Threshold value" />
              </div>
            </>
          )}
          {triggerType === "SCHEDULE" && (
            <div className="form-group" style={{ gridColumn: "1 / -1" }}>
              <label className="form-group__label">Cron Expression</label>
              <input className="form-input" value={scheduleCron} onChange={(e) => setScheduleCron(e.target.value)} placeholder="0 9 * * 1" />
              <span className="form-group__hint">Standard cron format (minute hour day month weekday)</span>
            </div>
          )}
          {triggerType === "EVENT" && (
            <div className="form-group" style={{ gridColumn: "1 / -1" }}>
              <label className="form-group__label">Event Type</label>
              <input className="form-input" value={eventType} onChange={(e) => setEventType(e.target.value)} placeholder="Event type" />
            </div>
          )}

          <div className="form-group">
            <label className="form-group__label">Delivery Channel</label>
            <select className="form-select" value={deliveryType} onChange={(e) => setDeliveryType(e.target.value as typeof deliveryType)}>
              <option value="EMAIL">Email</option>
              <option value="SLACK">Slack</option>
              <option value="WEBHOOK">Webhook</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-group__label">Delivery Target</label>
            <input className="form-input" value={deliveryTarget} onChange={(e) => setDeliveryTarget(e.target.value)} placeholder={deliveryType === "EMAIL" ? "team@company.com" : deliveryType === "SLACK" ? "#channel" : "https://..."} />
          </div>
        </div>
        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
          <button className="btn btn--primary" onClick={create}>Create Rule</button>
        </div>
      </div>}

      {/* Rules Table */}
      <div className="card card--elevated">
        <div className="card__header">
          <div className="card__title">Configured Rules</div>
          <span className="badge badge--accent">{rules.length} rules</span>
        </div>
        <div className="table-container" style={{ border: "none", borderRadius: 0 }}>
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
                <tr><td colSpan={6} className="data-table__empty">No automation rules configured</td></tr>
              ) : (
                rules.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.name}</strong></td>
                    <td><span className="badge badge--accent">{formatEnumLabel(r.trigger_type)}</span></td>
                    <td><span className="badge badge--info">{formatEnumLabel(r.delivery_type)}</span></td>
                    <td>{r.last_run_at ? formatDate(r.last_run_at) : <span style={{ color: "var(--color-text-muted)" }}>Never</span>}</td>
                    <td>
                      {r.last_run_status
                        ? <span className={badgeClass(r.last_run_status)}>{formatEnumLabel(r.last_run_status)}</span>
                        : <span style={{ color: "var(--color-text-muted)" }}>-</span>
                      }
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn btn--ghost btn--sm" onClick={async () => { await runAutomationRule(r.id); showToast("Rule executed", "success"); await load(); }}>
                          Run
                        </button>
                        <button className="btn btn--ghost btn--sm" style={{ color: "var(--color-error)" }} onClick={async () => { await deleteAutomationRule(r.id); showToast("Rule deleted", "info"); await load(); }}>
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
    </div>
  );
}
