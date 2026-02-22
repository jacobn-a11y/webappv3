import { useEffect, useState } from "react";
import {
  createAutomationRule,
  deleteAutomationRule,
  getAutomationRules,
  runAutomationRule,
  type AutomationRule,
} from "../lib/api";

export function AutomationsPage() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState<"THRESHOLD" | "SCHEDULE" | "EVENT">(
    "THRESHOLD"
  );
  const [deliveryType, setDeliveryType] = useState<"SLACK" | "EMAIL" | "WEBHOOK">(
    "EMAIL"
  );
  const [deliveryTarget, setDeliveryTarget] = useState("");
  const [metric, setMetric] = useState("failure_rate");
  const [threshold, setThreshold] = useState("10");
  const [scheduleCron, setScheduleCron] = useState("0 9 * * 1");
  const [eventType, setEventType] = useState("INTEGRATION_FAILURE");
  const [error, setError] = useState<string | null>(null);

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
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create automation");
    }
  };

  return (
    <div className="admin-security__page">
      <h1 className="admin-security__title">Workflow Automations</h1>
      {error && <div className="admin-story-context__error">{error}</div>}

      <section className="admin-security__card">
        <h2>Create Rule</h2>
        <div className="admin-security__inline">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rule name" />
          <select value={triggerType} onChange={(e) => setTriggerType(e.target.value as typeof triggerType)}>
            <option value="THRESHOLD">THRESHOLD</option>
            <option value="SCHEDULE">SCHEDULE</option>
            <option value="EVENT">EVENT</option>
          </select>
          {triggerType === "THRESHOLD" && (
            <>
              <input value={metric} onChange={(e) => setMetric(e.target.value)} placeholder="Metric" />
              <input value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="Threshold" />
            </>
          )}
          {triggerType === "SCHEDULE" && (
            <input value={scheduleCron} onChange={(e) => setScheduleCron(e.target.value)} placeholder="Cron" />
          )}
          {triggerType === "EVENT" && (
            <input value={eventType} onChange={(e) => setEventType(e.target.value)} placeholder="Event type" />
          )}
          <select value={deliveryType} onChange={(e) => setDeliveryType(e.target.value as typeof deliveryType)}>
            <option value="EMAIL">EMAIL</option>
            <option value="SLACK">SLACK</option>
            <option value="WEBHOOK">WEBHOOK</option>
          </select>
          <input
            value={deliveryTarget}
            onChange={(e) => setDeliveryTarget(e.target.value)}
            placeholder="Delivery target"
          />
          <button className="btn btn--secondary" onClick={create}>
            Create
          </button>
        </div>
      </section>

      <section className="admin-security__card">
        <h2>Configured Rules</h2>
        <table className="admin-ops__table">
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
            {rules.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.trigger_type}</td>
                <td>{r.delivery_type}</td>
                <td>{r.last_run_at ? new Date(r.last_run_at).toLocaleString() : "-"}</td>
                <td>{r.last_run_status ?? "-"}</td>
                <td>
                  <button className="btn btn--secondary" onClick={async () => { await runAutomationRule(r.id); await load(); }}>
                    Run
                  </button>{" "}
                  <button className="btn btn--secondary" onClick={async () => { await deleteAutomationRule(r.id); await load(); }}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
