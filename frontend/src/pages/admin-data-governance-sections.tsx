import type { Dispatch, SetStateAction } from "react";
import {
  type ApprovalPolicyMode,
  type ArtifactGovernancePolicySettings,
  type DataGovernanceSettings,
  type DashboardPublishSettings,
} from "../lib/api";
import { formatEnumLabel } from "../lib/format";

interface PolicySectionProps {
  dashboardSettings: DashboardPublishSettings;
  setDashboardSettings: Dispatch<SetStateAction<DashboardPublishSettings>>;
  policy: DataGovernanceSettings;
  setPolicy: Dispatch<SetStateAction<DataGovernanceSettings>>;
  savePolicy: () => Promise<void>;
  saving: boolean;
}

export function PolicySection({
  dashboardSettings,
  setDashboardSettings,
  policy,
  setPolicy,
  savePolicy,
  saving,
}: PolicySectionProps) {
  return (
    <section className="card card--elevated">
      <label className="form-group">
        Publish approval policy
        <select
          value={dashboardSettings.approval_policy}
          onChange={(e) =>
            setDashboardSettings((current) => ({
              ...current,
              approval_policy: e.target.value as ApprovalPolicyMode,
            }))
          }
        >
          <option value="ALL_REQUIRED">All stories require approval</option>
          <option value="ANON_NO_APPROVAL">
            Anonymous stories publish directly; named require approval
          </option>
          <option value="NAMED_NO_APPROVAL">
            Named stories publish directly; anonymous require approval
          </option>
          <option value="ALL_NO_APPROVAL">All stories publish directly</option>
        </select>
      </label>

      <label className="form-group">
        Data retention (days)
        <input
          type="number"
          min={30}
          max={3650}
          value={policy.retention_days}
          onChange={(e) =>
            setPolicy((current) => ({
              ...current,
              retention_days: Number(e.target.value) || 365,
            }))
          }
        />
      </label>

      <label className="form-group">
        Audit log retention (days)
        <input
          type="number"
          min={30}
          max={3650}
          value={policy.audit_log_retention_days}
          onChange={(e) =>
            setPolicy((current) => ({
              ...current,
              audit_log_retention_days: Number(e.target.value) || 365,
            }))
          }
        />
      </label>

      <label className="form-group">
        RTO target (minutes)
        <input
          type="number"
          min={5}
          max={60 * 24 * 14}
          value={policy.rto_target_minutes}
          onChange={(e) =>
            setPolicy((current) => ({
              ...current,
              rto_target_minutes: Number(e.target.value) || 240,
            }))
          }
        />
      </label>

      <label className="form-group">
        RPO target (minutes)
        <input
          type="number"
          min={5}
          max={60 * 24 * 14}
          value={policy.rpo_target_minutes}
          onChange={(e) =>
            setPolicy((current) => ({
              ...current,
              rpo_target_minutes: Number(e.target.value) || 60,
            }))
          }
        />
      </label>

      <label className="form-row">
        <input
          type="checkbox"
          checked={policy.legal_hold_enabled}
          onChange={(e) =>
            setPolicy((current) => ({ ...current, legal_hold_enabled: e.target.checked }))
          }
        />
        Enable legal hold (blocks deletions)
      </label>

      <label className="form-row">
        <input
          type="checkbox"
          checked={policy.pii_export_enabled}
          onChange={(e) =>
            setPolicy((current) => ({ ...current, pii_export_enabled: e.target.checked }))
          }
        />
        Allow exports containing governed data
      </label>

      <label className="form-row">
        <input
          type="checkbox"
          checked={policy.allow_named_story_exports}
          onChange={(e) =>
            setPolicy((current) => ({
              ...current,
              allow_named_story_exports: e.target.checked,
            }))
          }
        />
        Allow named story exports
      </label>

      <label className="form-row">
        <input
          type="checkbox"
          checked={policy.deletion_requires_approval}
          onChange={(e) =>
            setPolicy((current) => ({
              ...current,
              deletion_requires_approval: e.target.checked,
            }))
          }
        />
        Require approval before deletion
      </label>

      <button className="btn btn--primary" onClick={() => void savePolicy()} disabled={saving}>
        {saving ? "Saving..." : "Save Policy"}
      </button>
    </section>
  );
}

interface ArtifactGovernanceSectionProps {
  artifactPolicy: ArtifactGovernancePolicySettings;
  setArtifactPolicy: Dispatch<SetStateAction<ArtifactGovernancePolicySettings>>;
  saveArtifactPolicy: () => Promise<void>;
  saving: boolean;
}

export function ArtifactGovernanceSection({
  artifactPolicy,
  setArtifactPolicy,
  saveArtifactPolicy,
  saving,
}: ArtifactGovernanceSectionProps) {
  return (
    <section className="card card--elevated">
      <h2>Artifact Governance (Publishing)</h2>

      <label className="form-row">
        <input
          type="checkbox"
          checked={artifactPolicy.approval_chain_enabled}
          onChange={(e) =>
            setArtifactPolicy((current) => ({
              ...current,
              approval_chain_enabled: e.target.checked,
            }))
          }
        />
        Require approval chain before publishing
      </label>

      <label className="form-row">
        <input
          type="checkbox"
          checked={artifactPolicy.require_provenance}
          onChange={(e) =>
            setArtifactPolicy((current) => ({
              ...current,
              require_provenance: e.target.checked,
            }))
          }
        />
        Require release provenance metadata
      </label>

      <label className="form-group">
        Max expiration (days, optional)
        <input
          type="number"
          min={1}
          max={3650}
          value={artifactPolicy.max_expiration_days ?? ""}
          onChange={(e) =>
            setArtifactPolicy((current) => ({
              ...current,
              max_expiration_days: e.target.value ? Number(e.target.value) : null,
            }))
          }
        />
      </label>

      <h3>Approval Steps</h3>
      <div className="form-row" style={{ marginBottom: 8 }}>
        <button
          className="btn btn--secondary"
          onClick={() =>
            setArtifactPolicy((current) => ({
              ...current,
              steps: [
                ...current.steps,
                {
                  step_order: current.steps.length + 1,
                  min_approvals: 1,
                  required_role_profile_key: null,
                  required_user_role: "ADMIN",
                  enabled: true,
                },
              ],
            }))
          }
        >
          Add Step
        </button>
      </div>

      {artifactPolicy.steps.map((step, idx) => (
        <div key={`${step.step_order}-${idx}`} className="form-row">
          <input
            type="number"
            min={1}
            value={step.step_order}
            onChange={(e) =>
              setArtifactPolicy((current) => ({
                ...current,
                steps: current.steps.map((row, rowIndex) =>
                  rowIndex === idx
                    ? { ...row, step_order: Number(e.target.value) || row.step_order }
                    : row
                ),
              }))
            }
            placeholder="Order"
          />
          <input
            type="number"
            min={1}
            value={step.min_approvals}
            onChange={(e) =>
              setArtifactPolicy((current) => ({
                ...current,
                steps: current.steps.map((row, rowIndex) =>
                  rowIndex === idx ? { ...row, min_approvals: Number(e.target.value) || 1 } : row
                ),
              }))
            }
            placeholder="Min approvals"
          />
          <select
            value={step.required_user_role ?? ""}
            onChange={(e) =>
              setArtifactPolicy((current) => ({
                ...current,
                steps: current.steps.map((row, rowIndex) =>
                  rowIndex === idx
                    ? {
                        ...row,
                        required_user_role: e.target.value
                          ? (e.target.value as "OWNER" | "ADMIN" | "MEMBER" | "VIEWER")
                          : null,
                      }
                    : row
                ),
              }))
            }
          >
            <option value="">Any role</option>
            <option value="OWNER">{formatEnumLabel("OWNER")}</option>
            <option value="ADMIN">{formatEnumLabel("ADMIN")}</option>
            <option value="MEMBER">{formatEnumLabel("MEMBER")}</option>
            <option value="VIEWER">{formatEnumLabel("VIEWER")}</option>
          </select>
          <input
            value={step.required_role_profile_key ?? ""}
            onChange={(e) =>
              setArtifactPolicy((current) => ({
                ...current,
                steps: current.steps.map((row, rowIndex) =>
                  rowIndex === idx
                    ? {
                        ...row,
                        required_role_profile_key: e.target.value || null,
                      }
                    : row
                ),
              }))
            }
            placeholder="Role profile key (optional)"
          />
          <select
            value={step.approver_scope_type ?? "ROLE_PROFILE"}
            onChange={(e) =>
              setArtifactPolicy((current) => ({
                ...current,
                steps: current.steps.map((row, rowIndex) =>
                  rowIndex === idx
                    ? {
                        ...row,
                        approver_scope_type: e.target.value as
                          | "ROLE_PROFILE"
                          | "TEAM"
                          | "USER"
                          | "GROUP"
                          | "SELF",
                      }
                    : row
                ),
              }))
            }
          >
            <option value="ROLE_PROFILE">{formatEnumLabel("ROLE_PROFILE")}</option>
            <option value="TEAM">{formatEnumLabel("TEAM")}</option>
            <option value="USER">{formatEnumLabel("USER")}</option>
            <option value="GROUP">{formatEnumLabel("GROUP")}</option>
            <option value="SELF">{formatEnumLabel("SELF")}</option>
          </select>
          <input
            value={step.approver_scope_value ?? ""}
            onChange={(e) =>
              setArtifactPolicy((current) => ({
                ...current,
                steps: current.steps.map((row, rowIndex) =>
                  rowIndex === idx
                    ? {
                        ...row,
                        approver_scope_value: e.target.value || null,
                      }
                    : row
                ),
              }))
            }
            placeholder="Scope value (team key/user id/group id)"
          />
          <label className="form-row">
            <input
              type="checkbox"
              checked={step.enabled}
              onChange={(e) =>
                setArtifactPolicy((current) => ({
                  ...current,
                  steps: current.steps.map((row, rowIndex) =>
                    rowIndex === idx ? { ...row, enabled: e.target.checked } : row
                  ),
                }))
              }
            />
            Enabled
          </label>
          <label className="form-row">
            <input
              type="checkbox"
              checked={step.allow_self_approval ?? false}
              onChange={(e) =>
                setArtifactPolicy((current) => ({
                  ...current,
                  steps: current.steps.map((row, rowIndex) =>
                    rowIndex === idx ? { ...row, allow_self_approval: e.target.checked } : row
                  ),
                }))
              }
            />
            Allow self approval
          </label>
          <button
            className="btn btn--secondary"
            onClick={() =>
              setArtifactPolicy((current) => ({
                ...current,
                steps: current.steps.filter((_, rowIndex) => rowIndex !== idx),
              }))
            }
          >
            Remove
          </button>
        </div>
      ))}

      <button className="btn btn--primary" onClick={() => void saveArtifactPolicy()} disabled={saving}>
        {saving ? "Saving..." : "Save Artifact Governance"}
      </button>
    </section>
  );
}
