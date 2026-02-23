import { useEffect, useState } from "react";
import {
  addApprovalGroupMember,
  createApprovalGroup,
  createDeletionRequest,
  getArtifactGovernancePolicy,
  getApprovalGroups,
  getDataGovernanceSettings,
  getDeletionRequests,
  getTeamApprovalAdminScopes,
  replaceTeamApprovalAdminScopes,
  replaceArtifactApprovalSteps,
  removeApprovalGroupMember,
  reviewDeletionRequest,
  updateArtifactGovernancePolicy,
  updateDataGovernanceSettings,
  type ArtifactGovernancePolicySettings,
  type ApprovalGroup,
  type DataGovernanceSettings,
  type DeletionRequest,
  type TeamApprovalAdminScopeRow,
} from "../lib/api";

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
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDescription, setNewGroupDescription] = useState("");
  const [groupMemberUserId, setGroupMemberUserId] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [policyRes, requestRes, artifactPolicyRes, groupsRes, scopesRes] = await Promise.all([
        getDataGovernanceSettings(),
        getDeletionRequests(),
        getArtifactGovernancePolicy(),
        getApprovalGroups(),
        getTeamApprovalAdminScopes(),
      ]);
      setPolicy(policyRes);
      setRequests(requestRes.requests);
      setArtifactPolicy(artifactPolicyRes);
      setApprovalGroups(groupsRes.groups);
      setTeamApprovalScopes(scopesRes.scopes);
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
      await updateDataGovernanceSettings(policy);
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
    return <div className="state-view"><div className="spinner" /><div className="state-view__title">Loading data governance...</div></div>;
  }

  if (error && (error.includes("permission") || error.includes("denied") || error.includes("forbidden") || error.includes("unauthorized"))) {
    return (
      <div className="access-denied">
        <div className="access-denied__icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
        </div>
        <h2 className="access-denied__title">Access Restricted</h2>
        <p className="access-denied__message">You don't have permission to view data governance settings. Contact your administrator.</p>
        <a href="/" className="btn btn--primary">Return to Home</a>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page__header"><div className="page__header-text"><h1 className="page__title">Data Governance</h1><p className="page__subtitle">Manage retention policies, deletion approvals, and artifact governance</p></div></div>
      {error && <div className="alert alert--error">{error}</div>}
      {notice && <div className="alert alert--success">{notice}</div>}

      <section className="card card--elevated form-container">
        <label className="form-group">
          Data retention (days)
          <input
            className="form-input"
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
            className="form-input"
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
            className="form-input"
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
            className="form-input"
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
            className="form-checkbox"
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
            className="form-checkbox"
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
            className="form-checkbox"
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
            className="form-checkbox"
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
            className="form-checkbox"
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
            className="form-checkbox"
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
            className="form-input"
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
              className="form-input"
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
              className="form-input"
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
              className="form-select"
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
              <option value="OWNER">OWNER</option>
              <option value="ADMIN">ADMIN</option>
              <option value="MEMBER">MEMBER</option>
              <option value="VIEWER">VIEWER</option>
            </select>
            <input
              className="form-input"
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
              className="form-select"
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
              <option value="ROLE_PROFILE">ROLE_PROFILE</option>
              <option value="TEAM">TEAM</option>
              <option value="USER">USER</option>
              <option value="GROUP">GROUP</option>
              <option value="SELF">SELF</option>
            </select>
            <input
              className="form-input"
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
                className="form-checkbox"
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
                className="form-checkbox"
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
          <select className="form-select" value={targetType} onChange={(e) => setTargetType(e.target.value as "CALL" | "STORY" | "LANDING_PAGE")}>
            <option value="CALL">Call</option>
            <option value="STORY">Story</option>
            <option value="LANDING_PAGE">Landing Page</option>
          </select>
          <input
            className="form-input"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            placeholder="Target ID"
          />
          <input
            className="form-input"
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
            className="form-input"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="Group name"
          />
          <input
            className="form-input"
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
                className="form-input"
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
                    className="form-input"
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
                  <td>{r.status}</td>
                  <td>{r.target_type}</td>
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
