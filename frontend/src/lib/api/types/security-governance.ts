export interface SecurityPolicySettings {
  enforce_mfa_for_admin_actions: boolean;
  sso_enforced?: boolean;
  allowed_sso_domains?: string[];
  session_controls_enabled?: boolean;
  max_session_age_hours?: number;
  reauth_interval_minutes?: number;
  ip_allowlist_enabled: boolean;
  ip_allowlist: string[];
}

export interface DataGovernanceSettings {
  retention_days: number;
  audit_log_retention_days: number;
  legal_hold_enabled: boolean;
  pii_export_enabled: boolean;
  deletion_requires_approval: boolean;
  allow_named_story_exports: boolean;
  rto_target_minutes: number;
  rpo_target_minutes: number;
}

export type ApprovalPolicyMode =
  | "ALL_REQUIRED"
  | "ANON_NO_APPROVAL"
  | "NAMED_NO_APPROVAL"
  | "ALL_NO_APPROVAL";

export interface DashboardPublishSettings {
  landing_pages_enabled: boolean;
  default_page_visibility: "PRIVATE" | "SHARED_WITH_LINK";
  approval_policy: ApprovalPolicyMode;
  require_approval_to_publish: boolean;
  allowed_publishers: string[];
  max_pages_per_user: number | null;
  company_name_replacements: Record<string, string>;
}

export interface DataGovernanceOverview {
  pending_approvals_count: number;
  pending_deletion_requests_count: number;
  retention_days: number;
  eligible_call_deletions: number;
  legal_hold_enabled: boolean;
  pii_export_enabled: boolean;
  allow_named_story_exports: boolean;
  recent_audit_events: Array<{
    id: string;
    category: string;
    action: string;
    severity: string;
    actor_user_id: string | null;
    created_at: string;
  }>;
}

export interface DeletionRequest {
  id: string;
  status: string;
  target_type: string;
  target_id: string;
  request_payload: unknown;
  requested_by_user_id: string;
  reviewer_user_id: string | null;
  review_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IpAllowlistEntry {
  id: string;
  cidr: string;
  label: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface SecuritySession {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string | null;
  user_role: string;
  device_label: string | null;
  ip_address: string | null;
  user_agent: string | null;
  last_seen_at: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface ScimProvisioningSettings {
  enabled: boolean;
  endpoint_secret_hint: string | null;
  last_sync_at: string | null;
  identities_count: number;
}

export type OutboundWebhookEventType =
  | "landing_page_published"
  | "story_generated"
  | "story_generation_failed"
  | "scheduled_report_generated"
  | "webhook.test"
  | "ALL_EVENTS";

export interface OutboundWebhookSubscription {
  id: string;
  url: string;
  secret: string;
  event_types: OutboundWebhookEventType[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}
