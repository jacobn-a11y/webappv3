import { useEffect, useState } from "react";
import {
  createSelfServeCheckout,
  createSelfServePortal,
  getBillingReadiness,
  getBillingReconciliation,
  updateSeatLimit,
  type BillingReadiness,
  type BillingReconciliation,
} from "../lib/api";
import { formatEnumLabel, badgeClass } from "../lib/format";
import { useToast } from "../components/Toast";

export function AdminBillingReadinessPage() {
  const [readiness, setReadiness] = useState<BillingReadiness | null>(null);
  const [reconciliation, setReconciliation] = useState<BillingReconciliation | null>(null);
  const [seatLimitInput, setSeatLimitInput] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<"STARTER" | "PROFESSIONAL" | "ENTERPRISE">("STARTER");
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  const load = async () => {
    setError(null);
    try {
      const [r, rec] = await Promise.all([
        getBillingReadiness(),
        getBillingReconciliation(),
      ]);
      setReadiness(r);
      setReconciliation(rec);
      setSeatLimitInput(String(r.seats.limit ?? ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load billing readiness");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const saveSeatLimit = async () => {
    setError(null);
    const parsed = Number(seatLimitInput);
    if (!Number.isFinite(parsed) || parsed < 1) {
      setError("Enter a valid seat limit.");
      return;
    }
    try {
      await updateSeatLimit(parsed);
      showToast("Seat limit updated", "success");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update seat limit");
    }
  };

  const startCheckout = async () => {
    setError(null);
    try {
      const { checkoutUrl } = await createSelfServeCheckout(selectedPlan);
      window.location.assign(checkoutUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start checkout");
    }
  };

  const openPortal = async () => {
    setError(null);
    try {
      const { portalUrl } = await createSelfServePortal();
      window.location.assign(portalUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open billing portal");
    }
  };

  const seatPercent = readiness
    ? readiness.seats.limit
      ? Math.min(Math.round((readiness.seats.used / readiness.seats.limit) * 100), 100)
      : 0
    : 0;

  return (
    <div className="page">
      <div className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">Billing & Usage</h1>
          <p className="page__subtitle">Manage your plan, seats, and billing details</p>
        </div>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {readiness && (
        <>
          {/* Current Plan */}
          <div className="card card--elevated">
            <div className="card__header">
              <div>
                <div className="card__title">Current Plan</div>
                <div className="card__subtitle">{formatEnumLabel(readiness.organization.pricing_model)} pricing</div>
              </div>
              <span className="badge badge--accent" style={{ fontSize: 13, padding: "4px 14px" }}>
                {formatEnumLabel(readiness.organization.plan)}
              </span>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-group__label">Change Plan</label>
                <select className="form-select" value={selectedPlan} onChange={(e) => setSelectedPlan(e.target.value as typeof selectedPlan)}>
                  <option value="STARTER">Starter</option>
                  <option value="PROFESSIONAL">Professional</option>
                  <option value="ENTERPRISE">Enterprise</option>
                </select>
              </div>
              <button className="btn btn--primary" onClick={startCheckout}>Start Checkout</button>
              <button className="btn btn--secondary" onClick={openPortal}>Billing Portal</button>
            </div>
          </div>

          {/* Seats */}
          <div className="card card--elevated">
            <div className="card__header">
              <div>
                <div className="card__title">Seat Usage</div>
                <div className="card__subtitle">
                  {readiness.seats.used} of {readiness.seats.limit ?? "unlimited"} seats used
                </div>
              </div>
            </div>
            {readiness.seats.limit && (
              <div style={{ marginBottom: 16 }}>
                <div className="progress-bar" style={{ height: 10 }}>
                  <div
                    className={`progress-bar__fill${seatPercent >= 90 ? " progress-bar__fill--error" : seatPercent >= 70 ? " progress-bar__fill--warning" : " progress-bar__fill--success"}`}
                    style={{ width: `${seatPercent}%` }}
                  />
                </div>
                <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
                  {seatPercent}% utilized
                </div>
              </div>
            )}
            <div className="form-row">
              <div className="form-group" style={{ flex: 1, maxWidth: 200 }}>
                <label className="form-group__label">Seat Limit</label>
                <input className="form-input" type="number" min={1} value={seatLimitInput} onChange={(e) => setSeatLimitInput(e.target.value)} placeholder="e.g. 25" />
              </div>
              <button className="btn btn--secondary" onClick={saveSeatLimit}>Update Limit</button>
            </div>
          </div>

          {/* Usage & Overage */}
          <div className="card card--elevated">
            <div className="card__header">
              <div className="card__title">Usage & Overage</div>
            </div>
            <div className="kpi-grid">
              <div className="kpi-card">
                <div className="kpi-card__content">
                  <div className="kpi-card__label">Usage Metric</div>
                  <div className="kpi-card__value" style={{ fontSize: 18 }}>{formatEnumLabel(readiness.overage.metric)}</div>
                </div>
              </div>
              <div className="kpi-card">
                <div className="kpi-card__content">
                  <div className="kpi-card__label">Included</div>
                  <div className="kpi-card__value">{readiness.overage.included_units ?? "Unlimited"}</div>
                </div>
              </div>
              <div className="kpi-card">
                <div className="kpi-card__content">
                  <div className="kpi-card__label">Used</div>
                  <div className="kpi-card__value">{readiness.overage.used_units}</div>
                </div>
              </div>
              <div className="kpi-card">
                <div className="kpi-card__content">
                  <div className="kpi-card__label">Overage</div>
                  <div className="kpi-card__value" style={{ color: readiness.overage.overage_units > 0 ? "var(--color-error)" : "inherit" }}>
                    {readiness.overage.overage_units}
                  </div>
                </div>
              </div>
            </div>
            {readiness.overage.projected_cost && (
              <div className="callout callout--warning" style={{ marginTop: 16 }}>
                <div className="callout__title">Projected Overage Cost: {readiness.overage.projected_cost}</div>
              </div>
            )}
            {readiness.entitlements.feature_flags.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Feature Flags</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {readiness.entitlements.feature_flags.map((flag) => (
                    <span key={flag} className="badge badge--accent">{flag}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Reconciliation */}
      {reconciliation && (
        <div className="card card--elevated">
          <div className="card__header">
            <div>
              <div className="card__title">Usage Reconciliation</div>
              <div className="card__subtitle">Compare metered vs. computed usage</div>
            </div>
            <span className={badgeClass(reconciliation.status)}>{formatEnumLabel(reconciliation.status)}</span>
          </div>
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Metered Minutes</div>
                <div className="kpi-card__value">{reconciliation.metered_minutes}</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Computed Minutes</div>
                <div className="kpi-card__value">{reconciliation.computed_minutes}</div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Mismatch</div>
                <div className="kpi-card__value" style={{ color: reconciliation.mismatch_percent > 5 ? "var(--color-error)" : "inherit" }}>
                  {reconciliation.mismatch_percent}%
                </div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__content">
                <div className="kpi-card__label">Stripe Coverage</div>
                <div className="kpi-card__value">{reconciliation.stripe_report_coverage_percent}%</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
