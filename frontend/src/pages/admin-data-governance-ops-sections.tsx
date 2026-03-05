import type { Dispatch, SetStateAction } from "react";
import {
  type ApprovalGroup,
  type DataGovernanceOverview,
  type DeletionRequest,
  type TeamApprovalAdminScopeRow,
} from "../lib/api";
import { badgeClass, formatEnumLabel } from "../lib/format";

export function GovernanceOverviewSection({ overview }: { overview: DataGovernanceOverview }) {
  return (
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
  );
}

interface DeletionRequestSectionProps {
  targetType: "CALL" | "STORY" | "LANDING_PAGE";
  setTargetType: (value: "CALL" | "STORY" | "LANDING_PAGE") => void;
  targetId: string;
  setTargetId: (value: string) => void;
  reason: string;
  setReason: (value: string) => void;
  requestDeletion: () => Promise<void>;
}

export function DeletionRequestSection({
  targetType,
  setTargetType,
  targetId,
  setTargetId,
  reason,
  setReason,
  requestDeletion,
}: DeletionRequestSectionProps) {
  return (
    <section className="card card--elevated">
      <h2>Request Deletion</h2>
      <div className="form-row">
        <select
          value={targetType}
          onChange={(e) => setTargetType(e.target.value as "CALL" | "STORY" | "LANDING_PAGE")}
        >
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
        <button className="btn btn--secondary" onClick={() => void requestDeletion()}>
          Submit
        </button>
      </div>
    </section>
  );
}

interface ApprovalGroupsSectionProps {
  approvalGroups: ApprovalGroup[];
  newGroupName: string;
  setNewGroupName: (value: string) => void;
  newGroupDescription: string;
  setNewGroupDescription: (value: string) => void;
  groupMemberUserId: Record<string, string>;
  setGroupMemberUserId: Dispatch<SetStateAction<Record<string, string>>>;
  createGroup: () => Promise<void>;
  addGroupMember: (groupId: string) => Promise<void>;
  removeGroupMember: (groupId: string, userId: string) => Promise<void>;
}

export function ApprovalGroupsSection({
  approvalGroups,
  newGroupName,
  setNewGroupName,
  newGroupDescription,
  setNewGroupDescription,
  groupMemberUserId,
  setGroupMemberUserId,
  createGroup,
  addGroupMember,
  removeGroupMember,
}: ApprovalGroupsSectionProps) {
  return (
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
        <button className="btn btn--secondary" onClick={() => void createGroup()}>
          Create Group
        </button>
      </div>
      {approvalGroups.map((group) => (
        <div key={group.id} className="card card--elevated" style={{ marginTop: 8 }}>
          <h3>{group.name}</h3>
          <div>{group.description || "-"}</div>
          <div className="form-row">
            <input
              value={groupMemberUserId[group.id] ?? ""}
              onChange={(e) =>
                setGroupMemberUserId((previous) => ({ ...previous, [group.id]: e.target.value }))
              }
              placeholder="User ID to add"
            />
            <button className="btn btn--secondary" onClick={() => void addGroupMember(group.id)}>
              Add Member
            </button>
          </div>
          <ul>
            {group.members.map((member) => (
              <li key={member.id}>
                {member.name || member.email} ({member.id}){" "}
                <button
                  className="btn btn--secondary"
                  onClick={() => void removeGroupMember(group.id, member.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

interface TeamApprovalScopesSectionProps {
  teamApprovalScopes: TeamApprovalAdminScopeRow[];
  setTeamScopes: (userId: string, raw: string) => Promise<void>;
}

export function TeamApprovalScopesSection({
  teamApprovalScopes,
  setTeamScopes,
}: TeamApprovalScopesSectionProps) {
  return (
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
                    void setTeamScopes(row.user.id, input?.value || "");
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
  );
}

interface DeletionApprovalQueueSectionProps {
  requests: DeletionRequest[];
  review: (id: string, decision: "APPROVE" | "REJECT") => Promise<void>;
}

export function DeletionApprovalQueueSection({
  requests,
  review,
}: DeletionApprovalQueueSectionProps) {
  return (
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
          {requests.map((request) => {
            const payload =
              request.request_payload && typeof request.request_payload === "object"
                ? (request.request_payload as { reason?: string | null })
                : {};
            return (
              <tr key={request.id}>
                <td>{new Date(request.created_at).toLocaleString()}</td>
                <td>
                  <span className={badgeClass(request.status)}>
                    {formatEnumLabel(request.status)}
                  </span>
                </td>
                <td>{formatEnumLabel(request.target_type)}</td>
                <td>{request.target_id}</td>
                <td>{payload.reason ?? "-"}</td>
                <td>
                  {request.status === "PENDING" ? (
                    <>
                      <button
                        className="btn btn--secondary"
                        onClick={() => void review(request.id, "APPROVE")}
                      >
                        Approve
                      </button>{" "}
                      <button
                        className="btn btn--secondary"
                        onClick={() => void review(request.id, "REJECT")}
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
  );
}
