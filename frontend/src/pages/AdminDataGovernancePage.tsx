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
  type ArtifactGovernancePolicySettings,
  type ApprovalGroup,
  type DataGovernanceSettings,
  type DataGovernanceOverview,
  type DashboardPublishSettings,
  type DeletionRequest,
  type TeamApprovalAdminScopeRow,
} from "../lib/api";
import { AdminErrorState, isPermissionError } from "../components/admin/AdminErrorState";
import {
  ArtifactGovernanceSection,
  PolicySection,
} from "./admin-data-governance-sections";
import {
  ApprovalGroupsSection,
  DeletionApprovalQueueSection,
  DeletionRequestSection,
  GovernanceOverviewSection,
  TeamApprovalScopesSection,
} from "./admin-data-governance-ops-sections";

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
      <div className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">Data Governance</h1>
          <p className="page__subtitle">
            Manage retention policies, deletion approvals, and artifact governance
          </p>
        </div>
      </div>
      {error && (
        <AdminErrorState
          title="Governance Action Failed"
          message={error}
          onRetry={() => void load()}
        />
      )}
      {notice && <div className="alert alert--success">{notice}</div>}

      <GovernanceOverviewSection overview={overview} />

      <PolicySection
        dashboardSettings={dashboardSettings}
        setDashboardSettings={setDashboardSettings}
        policy={policy}
        setPolicy={setPolicy}
        savePolicy={savePolicy}
        saving={saving}
      />

      <ArtifactGovernanceSection
        artifactPolicy={artifactPolicy}
        setArtifactPolicy={setArtifactPolicy}
        saveArtifactPolicy={saveArtifactPolicy}
        saving={saving}
      />

      <DeletionRequestSection
        targetType={targetType}
        setTargetType={setTargetType}
        targetId={targetId}
        setTargetId={setTargetId}
        reason={reason}
        setReason={setReason}
        requestDeletion={requestDeletion}
      />

      <ApprovalGroupsSection
        approvalGroups={approvalGroups}
        newGroupName={newGroupName}
        setNewGroupName={setNewGroupName}
        newGroupDescription={newGroupDescription}
        setNewGroupDescription={setNewGroupDescription}
        groupMemberUserId={groupMemberUserId}
        setGroupMemberUserId={setGroupMemberUserId}
        createGroup={createGroup}
        addGroupMember={addGroupMember}
        removeGroupMember={removeGroupMember}
      />

      <TeamApprovalScopesSection
        teamApprovalScopes={teamApprovalScopes}
        setTeamScopes={setTeamScopes}
      />

      <DeletionApprovalQueueSection
        requests={requests}
        review={review}
      />
    </div>
  );
}
