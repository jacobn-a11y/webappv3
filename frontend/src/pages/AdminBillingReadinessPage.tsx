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

export function AdminBillingReadinessPage() {
  const [readiness, setReadiness] = useState<BillingReadiness | null>(null);
  const [reconciliation, setReconciliation] = useState<BillingReconciliation | null>(null);
  const [seatLimitInput, setSeatLimitInput] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<"STARTER" | "PROFESSIONAL" | "ENTERPRISE">("STARTER");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
    setNotice(null);
    const parsed = Number(seatLimitInput);
    if (!Number.isFinite(parsed) || parsed < 1) {
      setError("Enter a valid seat limit.");
      return;
    }
    try {
      await updateSeatLimit(parsed);
      setNotice("Seat limit updated.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update seat limit");
    }
  };

  const startCheckout = async () => {
    setError(null);
    setNotice(null);
    try {
      const { checkoutUrl } = await createSelfServeCheckout(selectedPlan);
      window.location.assign(checkoutUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start checkout");
    }
  };

  const openPortal = async () => {
    setError(null);
    setNotice(null);
    try {
      const { portalUrl } = await createSelfServePortal();
      window.location.assign(portalUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open billing portal");
    }
  };

  return (
    <div className="admin-security__page">
      <h1 className="admin-security__title">Billing Readiness</h1>
      {error && <div className="admin-story-context__error">{error}</div>}
      {notice && <div className="admin-story-context__notice">{notice}</div>}

      {readiness && (
        <>
          <section className="admin-security__card">
            <h2>Self-Service Billing</h2>
            <div className="admin-security__inline">
              <select
                value={selectedPlan}
                onChange={(e) =>
                  setSelectedPlan(
                    e.target.value as "STARTER" | "PROFESSIONAL" | "ENTERPRISE"
                  )
                }
              >
                <option value="STARTER">Starter</option>
                <option value="PROFESSIONAL">Professional</option>
                <option value="ENTERPRISE">Enterprise</option>
              </select>
              <button className="btn btn--primary" onClick={startCheckout}>
                Start Checkout
              </button>
              <button className="btn btn--secondary" onClick={openPortal}>
                Open Billing Portal
              </button>
            </div>
          </section>

          <section className="admin-security__card">
            <h2>Seats</h2>
            <div className="admin-ops__grid">
              <div>Plan: {readiness.organization.plan}</div>
              <div>Pricing: {readiness.organization.pricing_model}</div>
              <div>Used: {readiness.seats.used}</div>
              <div>Limit: {readiness.seats.limit ?? "Unlimited"}</div>
            </div>
            <div className="admin-security__inline">
              <input
                type="number"
                min={1}
                value={seatLimitInput}
                onChange={(e) => setSeatLimitInput(e.target.value)}
                placeholder="Seat limit"
              />
              <button className="btn btn--secondary" onClick={saveSeatLimit}>
                Update Seat Limit
              </button>
            </div>
          </section>

          <section className="admin-security__card">
            <h2>Overage & Entitlements</h2>
            <div className="admin-ops__grid">
              <div>Usage Metric: {readiness.overage.metric}</div>
              <div>Included Units: {readiness.overage.included_units ?? "-"}</div>
              <div>Used Units: {readiness.overage.used_units}</div>
              <div>Overage Units: {readiness.overage.overage_units}</div>
            </div>
            <div>Projected Overage Cost: {readiness.overage.projected_cost ?? "-"}</div>
            <div>Feature Flags: {readiness.entitlements.feature_flags.join(", ") || "-"}</div>
          </section>
        </>
      )}

      {reconciliation && (
        <section className="admin-security__card">
          <h2>Usage Reconciliation</h2>
          <div className="admin-ops__grid">
            <div>Status: {reconciliation.status}</div>
            <div>Metered Minutes: {reconciliation.metered_minutes}</div>
            <div>Computed Minutes: {reconciliation.computed_minutes}</div>
            <div>Mismatch: {reconciliation.mismatch_percent}%</div>
          </div>
          <div>
            Stripe Reporting Coverage: {reconciliation.stripe_report_coverage_percent}%
          </div>
        </section>
      )}
    </div>
  );
}
