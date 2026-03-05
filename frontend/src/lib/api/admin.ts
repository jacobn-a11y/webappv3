import type {
  AccessUser,
  ApprovalGroup,
  ArtifactGovernancePolicySettings,
  AuditActorDrilldown,
  AuditLogEntry,
  AuditLogsPage,
  AuditResourceDrilldown,
  AutomationRule,
  AutomationScheduledReport,
  BillingReadiness,
  BillingReconciliation,
  CrmReport,
  CustomerSuccessHealth,
  DataGovernanceOverview,
  DataGovernanceSettings,
  DashboardPublishSettings,
  DeletionRequest,
  DrReadiness,
  IncidentRow,
  IpAllowlistEntry,
  OpsDiagnostics,
  OutboundWebhookEventType,
  OutboundWebhookSubscription,
  PermissionUser,
  PipelineStatus,
  PublicStatusIncident,
  QueueSloMetrics,
  RenewalValueReport,
  ReplayObservability,
  RoleAssignableUser,
  RoleAwareHome,
  RoleProfile,
  SellerAdoptionEventType,
  ScimProvisioningSettings,
  SecurityPolicySettings,
  SecuritySession,
  SharedAsset,
  StartSupportImpersonationResponse,
  SupportImpersonationSession,
  SyntheticHealth,
  TeamApprovalAdminScopeRow,
  TeamWorkspace,
  UpsertRoleProfileRequest,
  WritebackRequest,
} from "./types";
import { BASE_URL, buildRequestHeaders, request, requestBlob } from "./http";

export interface TrackSellerAdoptionEventRequest {
  event_type: SellerAdoptionEventType;
  flow_id: string;
  account_id?: string;
  story_id?: string;
  stage_preset?: string;
  visibility_mode?: "ANONYMOUS" | "NAMED";
  step?: string;
  action_name?: string;
  duration_ms?: number;
  metadata?: Record<string, unknown>;
}

export async function trackSellerAdoptionEvent(
  _body: TrackSellerAdoptionEventRequest
): Promise<{ tracked: boolean }> {
  // Telemetry endpoint retired in this slimmed app surface.
  return { tracked: false };
}

// ─── Admin Account Access ───────────────────────────────────────────────────

export async function getAccessUsers(): Promise<{ users: AccessUser[] }> {
  return request<{ users: AccessUser[] }>("/dashboard/access");
}

export async function grantAccess(body: {
  user_id: string;
  scope_type: string;
  account_id?: string;
  account_ids?: string[];
  crm_report_id?: string;
  crm_provider?: string;
  crm_report_name?: string;
}): Promise<void> {
  return request<void>("/dashboard/access/grant", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function revokeAccess(grantId: string): Promise<void> {
  return request<void>(`/dashboard/access/${grantId}`, { method: "DELETE" });
}

export async function syncAccessGrant(grantId: string): Promise<{ account_count: number }> {
  return request<{ account_count: number }>(`/dashboard/access/${grantId}/sync`, { method: "POST" });
}

export async function getCrmReports(provider: string): Promise<{ reports: CrmReport[] }> {
  return request<{ reports: CrmReport[] }>(`/dashboard/crm-reports?provider=${encodeURIComponent(provider)}`);
}

// ─── Admin Permissions ──────────────────────────────────────────────────────

export async function getPermissions(): Promise<{ users: PermissionUser[] }> {
  return request<{ users: PermissionUser[] }>("/dashboard/permissions");
}

export async function grantPermission(userId: string, permission: string): Promise<void> {
  return request<void>("/dashboard/permissions/grant", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, permission }),
  });
}

export async function revokePermission(userId: string, permission: string): Promise<void> {
  return request<void>("/dashboard/permissions/revoke", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, permission }),
  });
}

// ─── Audit Logs ─────────────────────────────────────────────────────────────

export async function getAuditLogs(params?: {
  limit?: number;
  category?: string;
  actor_user_id?: string;
  action?: string;
  severity?: string;
  target_type?: string;
  target_id?: string;
  before?: string;
}): Promise<{ logs: AuditLogEntry[]; page: AuditLogsPage }> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.category) qs.set("category", params.category);
  if (params?.actor_user_id) qs.set("actor_user_id", params.actor_user_id);
  if (params?.action) qs.set("action", params.action);
  if (params?.severity) qs.set("severity", params.severity);
  if (params?.target_type) qs.set("target_type", params.target_type);
  if (params?.target_id) qs.set("target_id", params.target_id);
  if (params?.before) qs.set("before", params.before);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return request<{ logs: AuditLogEntry[]; page: AuditLogsPage }>(`/dashboard/audit-logs${suffix}`);
}

export async function exportAuditLogs(
  format: "csv" | "json",
  params?: {
    limit?: number;
    category?: string;
    actor_user_id?: string;
    action?: string;
    severity?: string;
    target_type?: string;
    target_id?: string;
  }
): Promise<void> {
  const qs = new URLSearchParams();
  qs.set("format", format);
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.category) qs.set("category", params.category);
  if (params?.actor_user_id) qs.set("actor_user_id", params.actor_user_id);
  if (params?.action) qs.set("action", params.action);
  if (params?.severity) qs.set("severity", params.severity);
  if (params?.target_type) qs.set("target_type", params.target_type);
  if (params?.target_id) qs.set("target_id", params.target_id);
  const blob = await requestBlob(`/dashboard/audit-logs/export?${qs.toString()}`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-logs.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function getAuditActorDrilldown(
  actorUserId: string
): Promise<AuditActorDrilldown> {
  return request<AuditActorDrilldown>(
    `/dashboard/audit-logs/actor/${encodeURIComponent(actorUserId)}`
  );
}

export async function getAuditResourceDrilldown(
  targetType: string,
  targetId: string
): Promise<AuditResourceDrilldown> {
  const qs = new URLSearchParams({
    target_type: targetType,
    target_id: targetId,
  });
  return request<AuditResourceDrilldown>(
    `/dashboard/audit-logs/resource?${qs.toString()}`
  );
}

// ─── Operations ─────────────────────────────────────────────────────────────

export async function getOpsDiagnostics(): Promise<OpsDiagnostics> {
  return request<OpsDiagnostics>("/dashboard/ops/diagnostics");
}

export async function getQueueSloMetrics(): Promise<QueueSloMetrics> {
  return request<QueueSloMetrics>("/dashboard/ops/queue-slo");
}

export async function getSyntheticHealth(): Promise<SyntheticHealth> {
  return request<SyntheticHealth>("/dashboard/ops/synthetic-health");
}

export async function getPipelineStatus(): Promise<PipelineStatus> {
  return request<PipelineStatus>("/dashboard/ops/pipeline-status");
}

export async function getReplayObservability(params?: {
  window_hours?: number;
  provider?: string;
  outcome?: "COMPLETED" | "FAILED" | "RUNNING" | "PENDING";
  run_type?: "SYNC" | "BACKFILL" | "MANUAL" | "REPLAY";
  operator_user_id?: string;
  limit?: number;
}): Promise<ReplayObservability> {
  const qs = new URLSearchParams();
  if (params?.window_hours) qs.set("window_hours", String(params.window_hours));
  if (params?.provider) qs.set("provider", params.provider);
  if (params?.outcome) qs.set("outcome", params.outcome);
  if (params?.run_type) qs.set("run_type", params.run_type);
  if (params?.operator_user_id) qs.set("operator_user_id", params.operator_user_id);
  if (params?.limit) qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return request<ReplayObservability>(`/dashboard/ops/replay-observability${suffix}`);
}

export async function getDrReadiness(): Promise<DrReadiness> {
  return request<DrReadiness>("/dashboard/ops/dr-readiness");
}

export async function runBackupVerification(): Promise<{ verified: boolean }> {
  return request<{ verified: boolean }>("/dashboard/ops/dr-readiness/backup-verify", {
    method: "POST",
  });
}

export async function runRestoreValidation(): Promise<{ validated: boolean }> {
  return request<{ validated: boolean }>("/dashboard/ops/dr-readiness/restore-validate", {
    method: "POST",
  });
}

// ─── Support / Impersonation ────────────────────────────────────────────────

export async function getSupportImpersonationSessions(): Promise<{
  sessions: SupportImpersonationSession[];
}> {
  return request<{ sessions: SupportImpersonationSession[] }>(
    "/dashboard/support/impersonation/sessions"
  );
}

export async function startSupportImpersonation(body: {
  target_user_id: string;
  reason: string;
  ttl_minutes?: number;
  scope?: Array<"READ_ONLY" | "WRITE">;
}): Promise<StartSupportImpersonationResponse> {
  return request<StartSupportImpersonationResponse>(
    "/dashboard/support/impersonation/start",
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
}

export async function revokeSupportImpersonationSession(
  sessionId: string
): Promise<{ revoked: boolean; revoked_at: string }> {
  return request<{ revoked: boolean; revoked_at: string }>(
    `/dashboard/support/impersonation/${sessionId}/revoke`,
    { method: "POST" }
  );
}

// ─── Incidents ──────────────────────────────────────────────────────────────

export async function getIncidents(): Promise<{ incidents: IncidentRow[] }> {
  return request<{ incidents: IncidentRow[] }>("/dashboard/ops/incidents");
}

export async function createIncident(body: {
  title: string;
  summary: string;
  severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  started_at?: string;
}): Promise<{ id: string; status: string; created_at: string }> {
  return request<{ id: string; status: string; created_at: string }>(
    "/dashboard/ops/incidents",
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
}

export async function addIncidentUpdate(
  incidentId: string,
  body: {
    message: string;
    status?: "OPEN" | "MONITORING" | "RESOLVED";
    metadata?: Record<string, unknown>;
  }
): Promise<{ id: string; status: string; created_at: string }> {
  return request<{ id: string; status: string; created_at: string }>(
    `/dashboard/ops/incidents/${incidentId}/updates`,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
}

export async function getPublicStatusIncidents(
  organizationId: string
): Promise<{ incidents: PublicStatusIncident[] }> {
  return request<{ incidents: PublicStatusIncident[] }>(
    `/status/incidents?organization_id=${encodeURIComponent(organizationId)}`
  );
}

// ─── Billing ────────────────────────────────────────────────────────────────

export async function getBillingReadiness(): Promise<BillingReadiness> {
  return request<BillingReadiness>("/dashboard/billing/readiness");
}

export async function updateSeatLimit(seatLimit: number): Promise<{ updated: boolean }> {
  return request<{ updated: boolean }>("/dashboard/billing/seats", {
    method: "PATCH",
    body: JSON.stringify({ seat_limit: seatLimit }),
  });
}

export async function getBillingReconciliation(): Promise<BillingReconciliation> {
  return request<BillingReconciliation>("/dashboard/billing/reconciliation");
}

// ─── Dashboard Home ─────────────────────────────────────────────────────────

export async function getRoleAwareHome(): Promise<RoleAwareHome> {
  return request<RoleAwareHome>("/dashboard/home");
}

export async function getCustomerSuccessHealth(): Promise<CustomerSuccessHealth> {
  return request<CustomerSuccessHealth>("/dashboard/customer-success/health");
}

export async function getRenewalValueReport(): Promise<RenewalValueReport> {
  return request<RenewalValueReport>(
    "/dashboard/customer-success/renewal-value-report"
  );
}

// ─── Workspaces & Assets ────────────────────────────────────────────────────

export async function getTeamWorkspaces(): Promise<{ workspaces: TeamWorkspace[] }> {
  return request<{ workspaces: TeamWorkspace[] }>("/dashboard/workspaces");
}

export async function createTeamWorkspace(body: {
  name: string;
  description?: string;
  team: "REVOPS" | "MARKETING" | "SALES" | "CS";
  visibility: "PRIVATE" | "TEAM" | "ORG";
  allowed_role_profile_keys?: string[];
  saved_view_config?: Record<string, unknown>;
}): Promise<{ id: string }> {
  return request<{ id: string }>("/dashboard/workspaces", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateTeamWorkspace(
  workspaceId: string,
  body: {
    name: string;
    description?: string;
    team: "REVOPS" | "MARKETING" | "SALES" | "CS";
    visibility: "PRIVATE" | "TEAM" | "ORG";
    allowed_role_profile_keys?: string[];
    saved_view_config?: Record<string, unknown>;
  }
): Promise<{ updated: boolean }> {
  return request<{ updated: boolean }>(`/dashboard/workspaces/${workspaceId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteTeamWorkspace(
  workspaceId: string
): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/dashboard/workspaces/${workspaceId}`, {
    method: "DELETE",
  });
}

export async function getSharedAssets(params?: {
  workspace_id?: string;
}): Promise<{ assets: SharedAsset[] }> {
  const qs = new URLSearchParams();
  if (params?.workspace_id) qs.set("workspace_id", params.workspace_id);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return request<{ assets: SharedAsset[] }>(`/dashboard/assets${suffix}`);
}

export async function createSharedAsset(body: {
  workspace_id?: string;
  asset_type: "STORY" | "PAGE" | "REPORT" | "PLAYBOOK" | "TEMPLATE";
  title: string;
  description?: string;
  source_story_id?: string;
  source_page_id?: string;
  source_account_id?: string;
  visibility: "PRIVATE" | "TEAM" | "ORG";
  allowed_role_profile_keys?: string[];
  metadata?: Record<string, unknown>;
}): Promise<{ id: string }> {
  return request<{ id: string }>("/dashboard/assets", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deleteSharedAsset(assetId: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/dashboard/assets/${assetId}`, {
    method: "DELETE",
  });
}

// ─── Writebacks ─────────────────────────────────────────────────────────────

export async function getWritebacks(): Promise<{ writebacks: WritebackRequest[] }> {
  return request<{ writebacks: WritebackRequest[] }>("/dashboard/writebacks");
}

export async function requestWriteback(body: {
  provider?: "SALESFORCE" | "HUBSPOT";
  action_type: "TASK" | "NOTE" | "FIELD_UPDATE" | "TIMELINE_EVENT";
  account_id: string;
  opportunity_id?: string;
  title?: string;
  body?: string;
  field_name?: string;
  field_value?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ request_id: string; status: string }> {
  return request<{ request_id: string; status: string }>("/dashboard/writebacks", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function reviewWriteback(
  requestId: string,
  body: { decision: "APPROVE" | "REJECT"; notes?: string }
): Promise<{ status: string }> {
  return request<{ status: string }>(`/dashboard/writebacks/${requestId}/review`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function rollbackWriteback(requestId: string): Promise<{ status: string }> {
  return request<{ status: string }>(`/dashboard/writebacks/${requestId}/rollback`, {
    method: "POST",
  });
}

// ─── Automations ────────────────────────────────────────────────────────────

export async function getAutomationRules(): Promise<{ rules: AutomationRule[] }> {
  return request<{ rules: AutomationRule[] }>("/dashboard/automations");
}

export async function createAutomationRule(body: {
  name: string;
  description?: string;
  enabled: boolean;
  trigger_type: "THRESHOLD" | "SCHEDULE" | "EVENT";
  metric?: string;
  operator?: ">" | ">=" | "<" | "<=" | "==";
  threshold?: number;
  schedule_cron?: string;
  event_type?: string;
  delivery_type: "SLACK" | "EMAIL" | "WEBHOOK";
  delivery_target: string;
  payload_template?: Record<string, unknown>;
}): Promise<{ id: string }> {
  return request<{ id: string }>("/dashboard/automations", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function runAutomationRule(
  ruleId: string
): Promise<{ status: string; error?: string | null; report_asset_id?: string | null }> {
  return request<{ status: string; error?: string | null; report_asset_id?: string | null }>(`/dashboard/automations/${ruleId}/run`, {
    method: "POST",
  });
}

export async function deleteAutomationRule(ruleId: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/dashboard/automations/${ruleId}`, {
    method: "DELETE",
  });
}

export async function getAutomationReports(): Promise<{ reports: AutomationScheduledReport[] }> {
  return request<{ reports: AutomationScheduledReport[] }>("/dashboard/automations/reports");
}

export async function downloadAutomationReport(
  assetId: string,
  format: "csv" | "json"
): Promise<Blob> {
  return requestBlob(
    `/dashboard/automations/reports/${encodeURIComponent(assetId)}/export?format=${format}`
  );
}

// ─── Security Policy ────────────────────────────────────────────────────────

export async function getSecurityPolicySettings(): Promise<SecurityPolicySettings> {
  return request<SecurityPolicySettings>("/dashboard/security-policy");
}

export async function updateSecurityPolicySettings(
  body: SecurityPolicySettings
): Promise<void> {
  return request<void>("/dashboard/security-policy", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// ─── Data Governance ────────────────────────────────────────────────────────

export async function getDataGovernanceSettings(): Promise<DataGovernanceSettings> {
  return request<DataGovernanceSettings>("/dashboard/data-governance");
}

export async function getDataGovernanceOverview(): Promise<DataGovernanceOverview> {
  return request<DataGovernanceOverview>("/dashboard/data-governance/overview");
}

export async function updateDataGovernanceSettings(
  body: Partial<DataGovernanceSettings>
): Promise<void> {
  return request<void>("/dashboard/data-governance", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function getDashboardPublishSettings(): Promise<DashboardPublishSettings> {
  const res = await request<{ settings: DashboardPublishSettings }>("/dashboard/settings");
  return res.settings;
}

export async function updateDashboardPublishSettings(
  body: Partial<DashboardPublishSettings>
): Promise<void> {
  await request<void>("/dashboard/settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function getDeletionRequests(params?: {
  status?: "PENDING" | "REJECTED" | "COMPLETED" | "APPROVED";
}): Promise<{ requests: DeletionRequest[] }> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return request<{ requests: DeletionRequest[] }>(
    `/dashboard/data-governance/deletion-requests${suffix}`
  );
}

export async function createDeletionRequest(body: {
  target_type: "CALL" | "STORY" | "LANDING_PAGE";
  target_id: string;
  reason?: string;
}): Promise<{ request_id?: string; status?: string; queued_for_approval?: boolean; deleted?: boolean }> {
  return request<{ request_id?: string; status?: string; queued_for_approval?: boolean; deleted?: boolean }>(
    "/dashboard/data-governance/deletion-requests",
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
}

export async function reviewDeletionRequest(
  requestId: string,
  body: { decision: "APPROVE" | "REJECT"; review_notes?: string }
): Promise<{ status: string; deleted?: boolean }> {
  return request<{ status: string; deleted?: boolean }>(
    `/dashboard/data-governance/deletion-requests/${requestId}/review`,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
}

// ─── IP Allowlist & Sessions ────────────────────────────────────────────────

export async function getIpAllowlistEntries(): Promise<{ entries: IpAllowlistEntry[] }> {
  return request<{ entries: IpAllowlistEntry[] }>("/dashboard/security/ip-allowlist");
}

export async function createIpAllowlistEntry(body: {
  cidr: string;
  label?: string;
  enabled?: boolean;
}): Promise<void> {
  return request<void>("/dashboard/security/ip-allowlist", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateIpAllowlistEntry(
  entryId: string,
  body: { cidr?: string; label?: string | null; enabled?: boolean }
): Promise<void> {
  return request<void>(`/dashboard/security/ip-allowlist/${entryId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteIpAllowlistEntry(entryId: string): Promise<void> {
  return request<void>(`/dashboard/security/ip-allowlist/${entryId}`, {
    method: "DELETE",
  });
}

export async function getSecuritySessions(): Promise<{ sessions: SecuritySession[] }> {
  return request<{ sessions: SecuritySession[] }>("/dashboard/security/sessions");
}

export async function revokeSecuritySession(sessionId: string): Promise<void> {
  return request<void>(`/dashboard/security/sessions/${sessionId}/revoke`, {
    method: "POST",
  });
}

// ─── SCIM ───────────────────────────────────────────────────────────────────

export async function getScimProvisioning(): Promise<ScimProvisioningSettings> {
  return request<ScimProvisioningSettings>("/dashboard/scim-provisioning");
}

export async function updateScimProvisioning(enabled: boolean): Promise<void> {
  return request<void>("/dashboard/scim-provisioning", {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

export async function rotateScimToken(): Promise<{
  token: string;
  endpoint_secret_hint: string;
  message: string;
}> {
  return request<{
    token: string;
    endpoint_secret_hint: string;
    message: string;
  }>("/dashboard/scim-provisioning/rotate-token", {
    method: "POST",
  });
}

// ─── Outbound Webhooks ──────────────────────────────────────────────────────

export async function getOutboundWebhookSubscriptions(): Promise<{
  subscriptions: OutboundWebhookSubscription[];
  supported_events: OutboundWebhookEventType[];
}> {
  return request<{
    subscriptions: OutboundWebhookSubscription[];
    supported_events: OutboundWebhookEventType[];
  }>("/dashboard/security/outbound-webhooks");
}

export async function createOutboundWebhookSubscription(body: {
  url: string;
  event_types: OutboundWebhookEventType[];
  enabled?: boolean;
  secret?: string;
}): Promise<{ subscription: OutboundWebhookSubscription }> {
  return request<{ subscription: OutboundWebhookSubscription }>(
    "/dashboard/security/outbound-webhooks",
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
}

export async function deleteOutboundWebhookSubscription(
  subscriptionId: string
): Promise<void> {
  return request<void>(`/dashboard/security/outbound-webhooks/${subscriptionId}`, {
    method: "DELETE",
  });
}

export async function testOutboundWebhookSubscription(
  subscriptionId: string
): Promise<{ delivered: boolean; status: number; error: string | null }> {
  return request<{ delivered: boolean; status: number; error: string | null }>(
    `/dashboard/security/outbound-webhooks/${subscriptionId}/test`,
    {
      method: "POST",
    }
  );
}

// ─── Role Profiles ──────────────────────────────────────────────────────────

export async function getRoleProfiles(): Promise<{
  roles: RoleProfile[];
  users: RoleAssignableUser[];
}> {
  return request<{ roles: RoleProfile[]; users: RoleAssignableUser[] }>("/dashboard/roles");
}

export async function createRoleProfile(body: UpsertRoleProfileRequest): Promise<RoleProfile> {
  const res = await request<{ role: RoleProfile }>("/dashboard/roles", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return res.role;
}

export async function updateRoleProfile(roleId: string, body: UpsertRoleProfileRequest): Promise<RoleProfile> {
  const res = await request<{ role: RoleProfile }>(`/dashboard/roles/${roleId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return res.role;
}

export async function deleteRoleProfile(roleId: string): Promise<void> {
  return request<void>(`/dashboard/roles/${roleId}`, {
    method: "DELETE",
  });
}

export async function assignRoleProfile(userId: string, roleProfileId: string): Promise<void> {
  return request<void>("/dashboard/roles/assign", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, role_profile_id: roleProfileId }),
  });
}

// ─── Artifact Governance ────────────────────────────────────────────────────

export async function getArtifactGovernancePolicy(): Promise<ArtifactGovernancePolicySettings> {
  return request<ArtifactGovernancePolicySettings>("/dashboard/artifact-governance");
}

export async function updateArtifactGovernancePolicy(
  body: Partial<{
    approval_chain_enabled: boolean;
    max_expiration_days: number | null;
    require_provenance: boolean;
  }>
): Promise<{ updated: boolean }> {
  return request<{ updated: boolean }>("/dashboard/artifact-governance", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function replaceArtifactApprovalSteps(
  steps: Array<{
    step_order: number;
    min_approvals: number;
    required_role_profile_key?: string;
    required_user_role?: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
    approver_scope_type?: "ROLE_PROFILE" | "TEAM" | "USER" | "GROUP" | "SELF";
    approver_scope_value?: string;
    allow_self_approval?: boolean;
    enabled?: boolean;
  }>
): Promise<{ updated: boolean; steps_count: number }> {
  return request<{ updated: boolean; steps_count: number }>("/dashboard/artifact-governance/steps", {
    method: "PUT",
    body: JSON.stringify({ steps }),
  });
}

// ─── Approval Groups ────────────────────────────────────────────────────────

export async function getApprovalGroups(): Promise<{ groups: ApprovalGroup[] }> {
  return request<{ groups: ApprovalGroup[] }>("/dashboard/approval-groups");
}

export async function createApprovalGroup(body: {
  name: string;
  description?: string;
}): Promise<{ id: string; name: string; description: string | null }> {
  return request<{ id: string; name: string; description: string | null }>("/dashboard/approval-groups", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function addApprovalGroupMember(
  groupId: string,
  userId: string
): Promise<{ added: boolean }> {
  return request<{ added: boolean }>(`/dashboard/approval-groups/${groupId}/members`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  });
}

export async function removeApprovalGroupMember(
  groupId: string,
  userId: string
): Promise<{ removed: boolean }> {
  return request<{ removed: boolean }>(`/dashboard/approval-groups/${groupId}/members/${userId}`, {
    method: "DELETE",
  });
}

export async function getTeamApprovalAdminScopes(): Promise<{
  scopes: TeamApprovalAdminScopeRow[];
}> {
  return request<{ scopes: TeamApprovalAdminScopeRow[] }>("/dashboard/approval-admin-scopes");
}

export async function replaceTeamApprovalAdminScopes(
  userId: string,
  teamKeys: string[]
): Promise<{ updated: boolean; team_keys: string[] }> {
  return request<{ updated: boolean; team_keys: string[] }>(`/dashboard/approval-admin-scopes/${userId}`, {
    method: "PUT",
    body: JSON.stringify({ team_keys: teamKeys }),
  });
}
