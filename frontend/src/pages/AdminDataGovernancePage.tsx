import { useEffect, useState } from "react";
import {
  addApprovalGroupMember,
  createApprovalGroup,
  createDeletionRequest,
  getDashboardPublishSettings,
  getArtifactGovernancePolicy,
  getApprovalGroups,
  getDataGovernanceSettings,
  getDataGovernanceOverview,
  getDeletionRequests,
  getTeamApprovalAdminScopes,
  replaceTeamApprovalAdminScopes,
  replaceArtifactApprovalSteps,
  removeApprovalGroupMember,
  reviewDeletionRequest,
  updateDashboardPublishSettings,
  updateArtifactGovernancePolicy,
  updateDataGovernanceSettings,
  type ApprovalPolicyMode,
  type ArtifactGovernancePolicySettings,
  type ApprovalGroup,
  type DataGovernanceSettings,
  type DataGovernanceOverview,
  type DashboardPublishSettings,
  type DeletionRequest,
  type TeamApprovalAdminScopeRow,
} from "../lib/api";
import { badgeClass, formatEnumLabel } from "../lib/format";
import { AdminErrorState, isPermissionError } from "../components/admin/AdminErrorState";

const DEFAULT_POLICY: DataGovernanceSettings = {
  retention_days: 365,
  audit_log_retention_days: 365,
  legal_hold_enabled: false,
  pii_export_enabled: true,
  deletion_requires_approval: true,
  allow_named_story_exports: false,
  rto_target_minutes: 240,
  rpo_target_minutes: 60,
};

const DEFAULT_ARTIFACT_POLICY: ArtifactGovernancePolicySettings = {
  approval_chain_enabled: false,
  max_expiration_days: null,
  require_provenance: true,
  steps: [],
};

const DEFAULT_OVERVIEW: DataGovernanceOverview = {
  pending_approvals_count: 0,
  pending_deletion_requests_count: 0,
  retention_days: 365,
  eligible_call_deletions: 0,
  legal_hold_enabled: false,
  pii_export_enabled: true,
  allow_named_story_exports: false,
  recent_audit_events: [],
};

const DEFAULT_DASHBOARD_SETTINGS: DashboardPublishSettings = {
  landing_pages_enabled: true,
  default_page_visibility: "PRIVATE",
  approval_policy: "ALL_REQUIRED",
  require_approval_to_publish: false,
  allowed_publishers: ["OWNER", "ADMIN"],
  max_pages_per_user: null,
  company_name_replacements: {},
};

export function AdminDataGovernancePage() {
  const [policy, setPolicy] = useState<DataGovernanceSettings>(DEFAULT_POLICY);
  const [requests, setRequests] = useState<DeletionRequest[]>([]);
  const [targetType, setTargetType] = useState<"CALL" | "STORY" | "LANDING_PAGE">("CALL");
  const [targetId, setTargetId] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [artifactPolicy, setArtifactPolicy] = useState<ArtifactGovernancePolicySettings>(
    DEFAULT_ARTIFACT_POLICY
  );
  const [approvalGroups, setApprovalGroups] = useState<ApprovalGroup[]>([]);
  const [teamApprovalScopes, setTeamApprovalScopes] = useState<TeamApprovalAdminScopeRow[]>([]);
  const [dashboardSettings, setDashboardSettings] = useState<DashboardPublishSettings>(
    DEFAULT_DASHBOARD_SETTINGS
  );
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDescription, setNewGroupDescription] = useState("");
  const [groupMemberUserId, setGroupMemberUserId] = useState<Record<string, string>>({});
  const [overview, setOverview] = useState<DataGovernanceOverview>(DEFAULT_OVERVIEW);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        policyRes,
        overviewRes,
        deletionRes,
        artifactPolicyRes,
        groupsRes,
        scopesRes,
        dashboardSettingsRes,
      ] = await Promise.all([
        getDataGovernanceSettings(),
        getDataGovernanceOverview(),
        getDeletionRequests(),
        getArtifactGovernancePolicy(),
        getApprovalGroups(),
        getTeamApprovalAdminScopes(),
        getDashboardPublishSettings(),
      ]);
      setPolicy(policyRes);
      setOverview(overviewRes);
      setRequests(deletionRes.requests);
      setArtifactPolicy(artifactPolicyRes);
      setApprovalGroups(groupsRes.groups);
      setTeamApprovalScopes(scopesRes.scopes);
      setDashboardSettings(dashboardSettingsRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load governance data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const savePolicy = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await Promise.all([
        updateDataGovernanceSettings(policy),
        updateDashboardPublishSettings({
          approval_policy: dashboardSettings.approval_policy,
        }),
      ]);
      setNotice("Data governance policy saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save policy");
    } finally {
      setSaving(false);
    }
  };

  const requestDeletion = async () => {
    if (!targetId.trim()) return;
    setError(null);
    setNotice(null);
    try {
      const res = await createDeletionRequest({
        target_type: targetType,
        target_id: targetId.trim(),
        reason: reason.trim() || undefined,
      });
      setNotice(
        res.queued_for_approval
          ? "Deletion request submitted for approval."
          : "Deletion executed immediately."
      );
      setTargetId("");
      setReason("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit deletion request");
    }
  };

  const review = async (id: string, decision: "APPROVE" | "REJECT") => {
    setError(null);
    try {
      await reviewDeletionRequest(id, { decision });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to review deletion request");
    }
  };

  const saveArtifactPolicy = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await updateArtifactGovernancePolicy({
        approval_chain_enabled: artifactPolicy.approval_chain_enabled,
        max_expiration_days: artifactPolicy.max_expiration_days,
        require_provenance: artifactPolicy.require_provenance,
      });
      await replaceArtifactApprovalSteps(
        artifactPolicy.steps.map((s) => ({
          step_order: s.step_order,
          min_approvals: s.min_approvals,
          required_role_profile_key: s.required_role_profile_key ?? undefined,
          required_user_role:
            (s.required_user_role as "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" | null) ??
            undefined,
          approver_scope_type: s.approver_scope_type ?? "ROLE_PROFILE",
          approver_scope_value: s.approver_scope_value ?? undefined,
          allow_self_approval: s.allow_self_approval ?? false,
          enabled: s.enabled,
        }))
      );
      setNotice("Artifact governance policy saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save artifact governance policy");
    } finally {
      setSaving(false);
    }
  };

  const createGroup = async () => {
    if (!newGroupName.trim()) return;
    setError(null);
    try {
      await createApprovalGroup({
        name: newGroupName.trim(),
        description: newGroupDescription.trim() || undefined,
      });
      setNewGroupName("");
      setNewGroupDescription("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create approval group");
    }
  };

  const addGroupMember = async (groupId: string) => {
    const userId = groupMemberUserId[groupId]?.trim();
    if (!userId) return;
    setError(null);
    try {
      await addApprovalGroupMember(groupId, userId);
      setGroupMemberUserId((prev) => ({ ...prev, [groupId]: "" }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add group member");
    }
  };

  const removeGroupMember = async (groupId: string, userId: string) => {
    setError(null);
    try {
      await removeApprovalGroupMember(groupId, userId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove group member");
    }
  };

  const setTeamScopes = async (userId: string, raw: string) => {
    const keys = raw
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    setError(null);
    try {
      await replaceTeamApprovalAdminScopes(userId, keys);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update team scopes");
    }
  };

  if (loading) {
    return (
      <div className="state-view" role="status" aria-live="polite">
        <div className="spinner" />
        <div className="state-view__title">Loading data governance...</div>
      </div>
    );
  }

  if (error && isPermissionError(error)) {
    return (
      <div className="page">
        <div className="page__header">
          <div className="page__header-text">
            <h1 className="page__title">Data Governance</h1>
          </div>
        </div>
        <AdminErrorState
          title="Access Restricted"
          message={error}
          guidance="You do not have permission to view data governance settings. Contact an organization owner or admin."
        />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page__header"><div className="page__header-text"><h1 className="page__title">Data Governance</h1><p className="page__subtitle">Manage retention policies, deletion approvals, and artifact governance</p></div></div>
      {error && (
        <AdminErrorState
          title="Governance Action Failed"
          message={error}
          onRetry={() => void load()}
        />
      )}
      {notice && <div className="alert alert--success">{notice}</div>}

      <section className="card card--elevated">
        <h2>Governance Overview</h2>
        <div className="kpi-grid" style={{ marginBottom: 16 }}>
          <article className="kpi-card">
            <h3 className="kpi-card__label">Pending approvals</h3>
            <div className="kpi-card__value">{overview.pending_approvals_count}</div>
            <p className="kpi-card__meta">Publish requests awaiting review</p>
          </article>
          <article className="kpi-card">
            <h3 className="kpi-card__label">Retention window</h3>
            <div className="kpi-card__value">{overview.retention_days}d</div>
            <p className="kpi-card__meta">
              {overview.eligible_call_deletions} call(s) eligible for deletion
            </p>
          </article>
          <article className="kpi-card">
            <h3 className="kpi-card__label">Deletion queue</h3>
            <div className="kpi-card__value">{overview.pending_deletion_requests_count}</div>
            <p className="kpi-card__meta">Pending data deletion requests</p>
          </article>
        </div>
        <div className="data-table-wrap" style={{ marginTop: 8 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Control</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Legal hold</td>
                <td>
                  <span className={`badge ${overview.legal_hold_enabled ? "badge--warning" : "badge--success"}`}>
                    {overview.legal_hold_enabled ? "Enabled" : "Disabled"}
                  </span>
                </td>
              </tr>
              <tr>
                <td>PII exports</td>
                <td>
                  <span className={`badge ${overview.pii_export_enabled ? "badge--success" : "badge--danger"}`}>
                    {overview.pii_export_enabled ? "Allowed" : "Blocked"}
                  </span>
                </td>
              </tr>
              <tr>
                <td>Named story exports</td>
                <td>
                  <span className={`badge ${overview.allow_named_story_exports ? "badge--success" : "badge--danger"}`}>
                    {overview.allow_named_story_exports ? "Allowed" : "Blocked"}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <h3 style={{ marginTop: 16 }}>Recent Audit Events</h3>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Category</th>
                <th>Action</th>
                <th>Severity</th>
              </tr>
            </thead>
            <tbody>
              {overview.recent_audit_events.length === 0 && (
                <tr>
                  <td colSpan={4}>No recent audit events.</td>
                </tr>
              )}
              {overview.recent_audit_events.map((event) => (
                <tr key={event.id}>
                  <td>{new Date(event.created_at).toLocaleString()}</td>
                  <td>{formatEnumLabel(event.category)}</td>
                  <td>{formatEnumLabel(event.action)}</td>
                  <td>
                    <span className={badgeClass(event.severity)}>
                      {formatEnumLabel(event.severity)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

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
              setPolicy((p) => ({ ...p, retention_days: Number(e.target.value) || 365 }))
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
              setPolicy((p) => ({
                ...p,
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
              setPolicy((p) => ({
                ...p,
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
              setPolicy((p) => ({
                ...p,
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
              setPolicy((p) => ({ ...p, legal_hold_enabled: e.target.checked }))
            }
          />
          Enable legal hold (blocks deletions)
        </label>

        <label className="form-row">
          <input
            type="checkbox"
            checked={policy.pii_export_enabled}
            onChange={(e) =>
              setPolicy((p) => ({ ...p, pii_export_enabled: e.target.checked }))
            }
          />
          Allow exports containing governed data
        </label>

        <label className="form-row">
          <input
            type="checkbox"
            checked={policy.allow_named_story_exports}
            onChange={(e) =>
              setPolicy((p) => ({
                ...p,
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
              setPolicy((p) => ({
                ...p,
                deletion_requires_approval: e.target.checked,
              }))
            }
          />
          Require approval before deletion
        </label>

        <button className="btn btn--primary" onClick={savePolicy} disabled={saving}>
          {saving ? "Saving..." : "Save Policy"}
        </button>
      </section>

      <section className="card card--elevated">
        <h2>Artifact Governance (Publishing)</h2>

        <label className="form-row">
          <input
            type="checkbox"
            checked={artifactPolicy.approval_chain_enabled}
            onChange={(e) =>
              setArtifactPolicy((p) => ({
                ...p,
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
              setArtifactPolicy((p) => ({
                ...p,
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
              setArtifactPolicy((p) => ({
                ...p,
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
              setArtifactPolicy((p) => ({
                ...p,
                steps: [
                  ...p.steps,
                  {
                    step_order: p.steps.length + 1,
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
                setArtifactPolicy((p) => ({
                  ...p,
                  steps: p.steps.map((s, i) =>
                    i === idx ? { ...s, step_order: Number(e.target.value) || s.step_order } : s
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
                setArtifactPolicy((p) => ({
                  ...p,
                  steps: p.steps.map((s, i) =>
                    i === idx ? { ...s, min_approvals: Number(e.target.value) || 1 } : s
                  ),
                }))
              }
              placeholder="Min approvals"
            />
            <select
              value={step.required_user_role ?? ""}
              onChange={(e) =>
                setArtifactPolicy((p) => ({
                  ...p,
                  steps: p.steps.map((s, i) =>
                    i === idx
                      ? {
                          ...s,
                          required_user_role: e.target.value
                            ? (e.target.value as "OWNER" | "ADMIN" | "MEMBER" | "VIEWER")
                            : null,
                        }
                      : s
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
                setArtifactPolicy((p) => ({
                  ...p,
                  steps: p.steps.map((s, i) =>
                    i === idx
                      ? {
                          ...s,
                          required_role_profile_key: e.target.value || null,
                        }
                      : s
                  ),
                }))
              }
              placeholder="Role profile key (optional)"
            />
            <select
              value={step.approver_scope_type ?? "ROLE_PROFILE"}
              onChange={(e) =>
                setArtifactPolicy((p) => ({
                  ...p,
                  steps: p.steps.map((s, i) =>
                    i === idx
                      ? {
                          ...s,
                          approver_scope_type: e.target.value as
                            | "ROLE_PROFILE"
                            | "TEAM"
                            | "USER"
                            | "GROUP"
                            | "SELF",
                        }
                      : s
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
                setArtifactPolicy((p) => ({
                  ...p,
                  steps: p.steps.map((s, i) =>
                    i === idx
                      ? {
                          ...s,
                          approver_scope_value: e.target.value || null,
                        }
                      : s
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
                  setArtifactPolicy((p) => ({
                    ...p,
                    steps: p.steps.map((s, i) =>
                      i === idx ? { ...s, enabled: e.target.checked } : s
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
                  setArtifactPolicy((p) => ({
                    ...p,
                    steps: p.steps.map((s, i) =>
                      i === idx
                        ? { ...s, allow_self_approval: e.target.checked }
                        : s
                    ),
                  }))
                }
              />
              Allow self approval
            </label>
            <button
              className="btn btn--secondary"
              onClick={() =>
                setArtifactPolicy((p) => ({
                  ...p,
                  steps: p.steps.filter((_, i) => i !== idx),
                }))
              }
            >
              Remove
            </button>
          </div>
        ))}

        <button className="btn btn--primary" onClick={saveArtifactPolicy} disabled={saving}>
          {saving ? "Saving..." : "Save Artifact Governance"}
        </button>
      </section>

      <section className="card card--elevated">
        <h2>Request Deletion</h2>
        <div className="form-row">
          <select value={targetType} onChange={(e) => setTargetType(e.target.value as "CALL" | "STORY" | "LANDING_PAGE")}>
            <option value="CALL">Call</option>
            <option value="STORY">Story</option>
            <option value="LANDING_PAGE">Landing Page</option>
          </select>
          <input
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            placeholder="Target ID"
          />
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
          />
          <button className="btn btn--secondary" onClick={requestDeletion}>
            Submit
          </button>
        </div>
      </section>

      <section className="card card--elevated">
        <h2>Approval Groups</h2>
        <div className="form-row">
          <input
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="Group name"
          />
          <input
            value={newGroupDescription}
            onChange={(e) => setNewGroupDescription(e.target.value)}
            placeholder="Description (optional)"
          />
          <button className="btn btn--secondary" onClick={createGroup}>
            Create Group
          </button>
        </div>
        {approvalGroups.map((g) => (
          <div key={g.id} className="card card--elevated" style={{ marginTop: 8 }}>
            <h3>{g.name}</h3>
            <div>{g.description || "-"}</div>
            <div className="form-row">
              <input
                value={groupMemberUserId[g.id] ?? ""}
                onChange={(e) =>
                  setGroupMemberUserId((prev) => ({ ...prev, [g.id]: e.target.value }))
                }
                placeholder="User ID to add"
              />
              <button className="btn btn--secondary" onClick={() => addGroupMember(g.id)}>
                Add Member
              </button>
            </div>
            <ul>
              {g.members.map((m) => (
                <li key={m.id}>
                  {m.name || m.email} ({m.id}){" "}
                  <button className="btn btn--secondary" onClick={() => removeGroupMember(g.id, m.id)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="card card--elevated">
        <h2>Team Approval Admin Scopes</h2>
        <p>Billing admins can set which team keys each Team Approval Admin can approve.</p>
        <table className="data-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Team keys (comma-separated)</th>
              <th>Save</th>
            </tr>
          </thead>
          <tbody>
            {teamApprovalScopes.map((row) => (
              <tr key={row.user.id}>
                <td>{row.user.name || row.user.id}</td>
                <td>{row.user.email}</td>
                <td>
                  <input
                    defaultValue={row.team_keys.join(",")}
                    id={`scope-${row.user.id}`}
                  />
                </td>
                <td>
                  <button
                    className="btn btn--secondary"
                    onClick={() => {
                      const input = document.getElementById(
                        `scope-${row.user.id}`
                      ) as HTMLInputElement | null;
                      setTeamScopes(row.user.id, input?.value || "");
                    }}
                  >
                    Save
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card card--elevated">
        <h2>Deletion Approval Queue</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Created</th>
              <th>Status</th>
              <th>Target</th>
              <th>Target ID</th>
              <th>Reason</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => {
              const payload =
                r.request_payload && typeof r.request_payload === "object"
                  ? (r.request_payload as { reason?: string | null })
                  : {};
              return (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleString()}</td>
                  <td><span className={badgeClass(r.status)}>{formatEnumLabel(r.status)}</span></td>
                  <td>{formatEnumLabel(r.target_type)}</td>
                  <td>{r.target_id}</td>
                  <td>{payload.reason ?? "-"}</td>
                  <td>
                    {r.status === "PENDING" ? (
                      <>
                        <button
                          className="btn btn--secondary"
                          onClick={() => review(r.id, "APPROVE")}
                        >
                          Approve
                        </button>{" "}
                        <button
                          className="btn btn--secondary"
                          onClick={() => review(r.id, "REJECT")}
                        >
                          Reject
                        </button>
                      </>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
