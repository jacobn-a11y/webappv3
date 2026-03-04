import { useEffect, useMemo, useState } from "react";
import {
  deleteAILimit,
  getAIBudgetAlertsSettings,
  getAILimits,
  getAIUsageRecords,
  getAIUsageSummary,
  saveAIBudgetAlertsSettings,
  saveAILimit,
  type AIBudgetAlertsSettings,
  type AILimitsResponse,
  type AIUsageRecordsResponse,
  type AIUsageSummaryResponse,
} from "../lib/api";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function tokenStepOptions(): number[] {
  const values: number[] = [];
  for (let n = 100_000; n <= 1_000_000; n += 100_000) values.push(n);
  for (let n = 1_250_000; n <= 2_000_000; n += 250_000) values.push(n);
  for (let n = 3_000_000; n <= 10_000_000; n += 1_000_000) values.push(n);
  return values;
}

const TOKEN_OPTIONS = tokenStepOptions();

type LimitPeriodMode = "WEEKLY" | "MONTHLY" | "BOTH";

export function AdminAIUsagePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [summary, setSummary] = useState<AIUsageSummaryResponse>({ period_start: new Date().toISOString(), users: [] });
  const [records, setRecords] = useState<AIUsageRecordsResponse>({ records: [] });
  const [limits, setLimits] = useState<AILimitsResponse>({ limits: [] });
  const [budgetSettings, setBudgetSettings] = useState<AIBudgetAlertsSettings>({
    mode: "COST_CENTS",
    monthly_budget_tokens: null,
    monthly_budget_cents: null,
    thresholds: [80, 90, 100],
    block_at_100: false,
  });

  const [limitUserId, setLimitUserId] = useState("");
  const [limitPeriodMode, setLimitPeriodMode] = useState<LimitPeriodMode>("BOTH");
  const [maxTokensWeekly, setMaxTokensWeekly] = useState("");
  const [maxTokensMonthly, setMaxTokensMonthly] = useState("");
  const [maxStoriesWeekly, setMaxStoriesWeekly] = useState("");
  const [maxStoriesMonthly, setMaxStoriesMonthly] = useState("");

  const [budgetMode, setBudgetMode] = useState<"TOKENS" | "COST_CENTS">("COST_CENTS");
  const [budgetTokens, setBudgetTokens] = useState("");
  const [budgetCents, setBudgetCents] = useState("");
  const [budgetThresholds, setBudgetThresholds] = useState("80,90,100");
  const [budgetBlockAt100, setBudgetBlockAt100] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, recordsRes, limitsRes, budgetRes] = await Promise.all([
        getAIUsageSummary(),
        getAIUsageRecords({ user_id: selectedUserId || undefined, days }),
        getAILimits(),
        getAIBudgetAlertsSettings(),
      ]);
      setSummary(summaryRes);
      setRecords(recordsRes);
      setLimits(limitsRes);
      setBudgetSettings(budgetRes);
      setBudgetMode(budgetRes.mode);
      setBudgetTokens(
        budgetRes.monthly_budget_tokens != null ? String(budgetRes.monthly_budget_tokens) : ""
      );
      setBudgetCents(
        budgetRes.monthly_budget_cents != null ? String(budgetRes.monthly_budget_cents) : ""
      );
      setBudgetThresholds((budgetRes.thresholds ?? [80, 90, 100]).join(","));
      setBudgetBlockAt100(Boolean(budgetRes.block_at_100));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load AI usage");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [days, selectedUserId]);

  const operationBreakdown = useMemo(() => {
    const bucket = new Map<string, { requests: number; tokens: number; costCents: number }>();
    for (const record of records.records) {
      const key = record.operation;
      const current = bucket.get(key) ?? { requests: 0, tokens: 0, costCents: 0 };
      current.requests += 1;
      current.tokens += record.total_tokens;
      current.costCents += record.cost_cents;
      bucket.set(key, current);
    }
    return Array.from(bucket.entries())
      .map(([operation, value]) => ({ operation, ...value }))
      .sort((a, b) => b.tokens - a.tokens);
  }, [records.records]);

  const totals = useMemo(() => {
    return summary.users.reduce(
      (acc, user) => {
        acc.tokens += user.total_tokens;
        acc.costCents += user.total_cost_cents;
        acc.requests += user.total_requests;
        return acc;
      },
      { tokens: 0, costCents: 0, requests: 0 }
    );
  }, [summary.users]);

  const saveLimit = async () => {
    setError(null);
    setNotice(null);
    try {
      await saveAILimit({
        user_id: limitUserId.trim() || undefined,
        max_tokens_per_week:
          limitPeriodMode === "WEEKLY" || limitPeriodMode === "BOTH"
            ? maxTokensWeekly.trim()
              ? Number(maxTokensWeekly)
              : null
            : null,
        max_tokens_per_month:
          limitPeriodMode === "MONTHLY" || limitPeriodMode === "BOTH"
            ? maxTokensMonthly.trim()
              ? Number(maxTokensMonthly)
              : null
            : null,
        max_stories_per_week:
          limitPeriodMode === "WEEKLY" || limitPeriodMode === "BOTH"
            ? maxStoriesWeekly.trim()
              ? Number(maxStoriesWeekly)
              : null
            : null,
        max_stories_per_month:
          limitPeriodMode === "MONTHLY" || limitPeriodMode === "BOTH"
            ? maxStoriesMonthly.trim()
              ? Number(maxStoriesMonthly)
              : null
            : null,
      });
      setNotice("AI usage limit saved.");
      setLimitUserId("");
      setMaxTokensWeekly("");
      setMaxTokensMonthly("");
      setMaxStoriesWeekly("");
      setMaxStoriesMonthly("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save limit");
    }
  };

  const clearLimit = async (userId?: string) => {
    setError(null);
    try {
      await deleteAILimit(userId);
      setNotice("AI usage limit removed.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete limit");
    }
  };

  const saveBudget = async () => {
    setError(null);
    setNotice(null);
    try {
      const thresholds = budgetThresholds
        .split(",")
        .map((token) => Number(token.trim()))
        .filter((num) => Number.isFinite(num) && num >= 1 && num <= 100);
      if (thresholds.length === 0) {
        throw new Error("At least one budget threshold is required.");
      }

      await saveAIBudgetAlertsSettings({
        mode: budgetMode,
        monthly_budget_tokens: budgetTokens.trim() ? Number(budgetTokens) : null,
        monthly_budget_cents: budgetCents.trim() ? Number(budgetCents) : null,
        thresholds,
        block_at_100: budgetBlockAt100,
      });
      setNotice("Budget alert settings saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save budget settings");
    }
  };

  return (
    <div className="page">
      <div className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">AI Usage</h1>
          <p className="page__subtitle">Track usage by user and operation, enforce quotas, and configure budget alerts.</p>
        </div>
      </div>

      {error && <div className="alert alert--danger">{error}</div>}
      {notice && <div className="alert alert--success">{notice}</div>}

      {loading ? (
        <div className="state-view" role="status" aria-live="polite">
          <div className="spinner" />
          <div className="state-view__title">Loading AI usage...</div>
        </div>
      ) : (
        <>
          <section className="kpi-grid">
            <article className="kpi-card">
              <h3 className="kpi-card__label">Total tokens</h3>
              <div className="kpi-card__value">{totals.tokens.toLocaleString()}</div>
            </article>
            <article className="kpi-card">
              <h3 className="kpi-card__label">Estimated cost</h3>
              <div className="kpi-card__value">{formatCents(totals.costCents)}</div>
            </article>
            <article className="kpi-card">
              <h3 className="kpi-card__label">Requests</h3>
              <div className="kpi-card__value">{totals.requests.toLocaleString()}</div>
            </article>
          </section>

          <section className="card card--elevated" style={{ marginTop: 16 }}>
            <h2>Filters</h2>
            <div className="form-grid-3">
              <label className="form-group">
                Window (days)
                <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                  <option value={7}>Last 7 days</option>
                  <option value={30}>Last 30 days</option>
                  <option value={90}>Last 90 days</option>
                </select>
              </label>
              <label className="form-group">
                User
                <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}>
                  <option value="">All users</option>
                  {summary.users.map((user) => (
                    <option key={user.user_id} value={user.user_id}>
                      {user.user_name || user.user_email}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-group" style={{ alignSelf: "end" }}>
                <button className="btn btn--secondary" onClick={() => void load()}>Refresh</button>
              </div>
            </div>
          </section>

          <section className="card card--elevated" style={{ marginTop: 16 }}>
            <h2>Usage by User</h2>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Email</th>
                    <th>Tokens</th>
                    <th>Requests</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.users.map((user) => (
                    <tr key={user.user_id}>
                      <td>{user.user_name || "Unknown"}</td>
                      <td>{user.user_email}</td>
                      <td>{user.total_tokens.toLocaleString()}</td>
                      <td>{user.total_requests.toLocaleString()}</td>
                      <td>{formatCents(user.total_cost_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card card--elevated" style={{ marginTop: 16 }}>
            <h2>Usage by Operation</h2>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Operation</th>
                    <th>Requests</th>
                    <th>Tokens</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {operationBreakdown.map((row) => (
                    <tr key={row.operation}>
                      <td>{row.operation}</td>
                      <td>{row.requests.toLocaleString()}</td>
                      <td>{row.tokens.toLocaleString()}</td>
                      <td>{formatCents(row.costCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card card--elevated" style={{ marginTop: 16 }}>
            <h2>Per-user Quotas</h2>
            <div className="form-grid-4" style={{ marginBottom: 12 }}>
              <label className="form-group">
                User ID (blank = org default)
                <input className="form-input" value={limitUserId} onChange={(e) => setLimitUserId(e.target.value)} placeholder="user_..." />
              </label>
              <label className="form-group">
                Period
                <select className="form-select" value={limitPeriodMode} onChange={(e) => setLimitPeriodMode(e.target.value as LimitPeriodMode)}>
                  <option value="WEEKLY">Weekly</option>
                  <option value="MONTHLY">Monthly</option>
                  <option value="BOTH">Weekly + Monthly</option>
                </select>
              </label>
              {(limitPeriodMode === "WEEKLY" || limitPeriodMode === "BOTH") && (
                <label className="form-group">
                  Max tokens/week
                  <select className="form-select" value={maxTokensWeekly} onChange={(e) => setMaxTokensWeekly(e.target.value)}>
                    <option value="">Unlimited</option>
                    {TOKEN_OPTIONS.map((value) => (
                      <option key={`wk-${value}`} value={String(value)}>{value.toLocaleString()}</option>
                    ))}
                  </select>
                </label>
              )}
              {(limitPeriodMode === "MONTHLY" || limitPeriodMode === "BOTH") && (
                <label className="form-group">
                  Max tokens/month
                  <select className="form-select" value={maxTokensMonthly} onChange={(e) => setMaxTokensMonthly(e.target.value)}>
                    <option value="">Unlimited</option>
                    {TOKEN_OPTIONS.map((value) => (
                      <option key={`mo-${value}`} value={String(value)}>{value.toLocaleString()}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <div className="form-grid-4" style={{ marginBottom: 12 }}>
              {(limitPeriodMode === "WEEKLY" || limitPeriodMode === "BOTH") && (
                <label className="form-group">
                  Max stories/week
                  <input className="form-input" type="number" min={0} value={maxStoriesWeekly} onChange={(e) => setMaxStoriesWeekly(e.target.value)} placeholder="Unlimited" />
                </label>
              )}
              {(limitPeriodMode === "MONTHLY" || limitPeriodMode === "BOTH") && (
                <label className="form-group">
                  Max stories/month
                  <input className="form-input" type="number" min={0} value={maxStoriesMonthly} onChange={(e) => setMaxStoriesMonthly(e.target.value)} placeholder="Unlimited" />
                </label>
              )}
            </div>

            <button className="btn btn--primary" onClick={() => void saveLimit()}>Save Limit</button>

            <div className="data-table-wrap" style={{ marginTop: 16 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Scope</th>
                    <th>Tokens/week</th>
                    <th>Tokens/month</th>
                    <th>Stories/week</th>
                    <th>Stories/month</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {limits.limits.map((limit) => (
                    <tr key={limit.id}>
                      <td>{limit.is_org_default ? "Org Default" : limit.user?.email || limit.user?.id || "Unknown"}</td>
                      <td>{limit.max_tokens_per_week?.toLocaleString() || "Unlimited"}</td>
                      <td>{limit.max_tokens_per_month?.toLocaleString() || "Unlimited"}</td>
                      <td>{limit.max_stories_per_week?.toLocaleString() || "Unlimited"}</td>
                      <td>{limit.max_stories_per_month?.toLocaleString() || "Unlimited"}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => void clearLimit(limit.user?.id)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card card--elevated" style={{ marginTop: 16 }}>
            <h2>Budget Alerts</h2>
            <div className="form-grid-4" style={{ marginBottom: 12 }}>
              <label className="form-group">
                Budget mode
                <select className="form-select" value={budgetMode} onChange={(e) => setBudgetMode(e.target.value as "TOKENS" | "COST_CENTS") }>
                  <option value="COST_CENTS">Cost (cents)</option>
                  <option value="TOKENS">Tokens</option>
                </select>
              </label>
              {budgetMode === "TOKENS" ? (
                <label className="form-group">
                  Monthly token budget
                  <input className="form-input" type="number" min={0} value={budgetTokens} onChange={(e) => setBudgetTokens(e.target.value)} placeholder="e.g. 2000000" />
                </label>
              ) : (
                <label className="form-group">
                  Monthly cost budget (cents)
                  <input className="form-input" type="number" min={0} value={budgetCents} onChange={(e) => setBudgetCents(e.target.value)} placeholder="e.g. 500000" />
                </label>
              )}
              <label className="form-group">
                Thresholds (%)
                <input className="form-input" value={budgetThresholds} onChange={(e) => setBudgetThresholds(e.target.value)} placeholder="80,90,100" />
              </label>
              <label className="form-group" style={{ alignSelf: "end" }}>
                <span className="form-group__label">Block at 100%</span>
                <input type="checkbox" checked={budgetBlockAt100} onChange={(e) => setBudgetBlockAt100(e.target.checked)} />
              </label>
            </div>
            <button className="btn btn--primary" onClick={() => void saveBudget()}>Save Budget Alerts</button>
            <p className="muted" style={{ marginTop: 8 }}>
              Active mode: {budgetSettings.mode}. Current thresholds: {(budgetSettings.thresholds ?? []).join(", ")}%.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

export default AdminAIUsagePage;
