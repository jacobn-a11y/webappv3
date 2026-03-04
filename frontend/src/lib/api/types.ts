import type { FunnelStage, TaxonomyTopic, StoryFormat } from "../../types/taxonomy";
import type { StoryLength, StoryOutline, StoryTypeInput } from "../../types/taxonomy";

export type { FunnelStage, TaxonomyTopic, StoryFormat, StoryLength, StoryOutline, StoryTypeInput };

export interface BuildStoryRequest {
  account_id: string;
  funnel_stages?: FunnelStage[];
  filter_topics?: TaxonomyTopic[];
  title?: string;
  format?: StoryFormat;
  story_length?: StoryLength;
  story_outline?: StoryOutline;
  story_type?: StoryTypeInput;
}

export interface StoryQuote {
  speaker: string | null;
  quote_text: string;
  context: string | null;
  metric_type: string | null;
  metric_value: string | null;
  confidence_score?: number;
  call_id?: string;
  source_chunk_id?: string;
  source_timestamp_ms?: number;
  source_call_title?: string;
  source_recording_url?: string;
  transcript_deep_link?: string;
}

export interface BuildStoryResponse {
  story_id: string | null;
  title: string;
  markdown: string;
  quotes: StoryQuote[];
}

export interface StoryLandingPageSummary {
  id: string;
  slug?: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  published_at: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  organizationId: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  sessionToken: string;
  sessionExpiresAt: string;
}

export interface InviteSummary {
  email: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  organizationId: string;
  organizationName: string;
  expiresAt: string;
}

export interface StorySummary {
  id: string;
  title: string;
  story_type: string;
  story_status: "DRAFT" | "PAGE_CREATED" | "PUBLISHED" | "ARCHIVED";
  funnel_stages: FunnelStage[];
  filter_tags: string[];
  generated_at: string;
  markdown: string;
  landing_page: StoryLandingPageSummary | null;
  quotes: StoryQuote[];
}

export interface StoryLibraryItem extends StorySummary {
  account: {
    id: string;
    name: string;
    domain: string | null;
  };
}

export interface StoryComment {
  id: string;
  message: string;
  parent_id: string | null;
  target_type: "STORY" | "PAGE";
  target_id: string;
  created_at: string;
  author: {
    id: string;
    name: string | null;
    email: string;
  } | null;
}

export interface AccountsListItem {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  totalCalls: number;
  lastCallDate: string | null;
  storyCount: number;
  landingPageCount: number;
  createdAt: string;
  funnelStageDistribution: Array<{
    stage: string;
    count: number;
  }>;
}

export interface AccountsListResponse {
  accounts: AccountsListItem[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
  };
}

export interface CreateLandingPageRequest {
  story_id: string;
  title: string;
  subtitle?: string;
  include_company_name?: boolean;
  callout_boxes?: Array<{
    title: string;
    body: string;
    icon?: string;
  }>;
}

export interface CreateLandingPageResponse {
  id: string;
  slug: string;
  title: string;
  status: string;
  editable_body: string;
  callout_boxes: unknown[];
  total_call_hours: number;
}

// ─── Admin Account Access ───────────────────────────────────────────────────

export interface AccessUser {
  user_id: string;
  user_name: string | null;
  user_email: string;
  role: string;
  grants: AccessGrant[];
}

export interface AccessGrant {
  id: string;
  scope_type: string;
  account?: { id: string; name: string; domain: string | null };
  cached_account_count: number;
  crm_report_id?: string;
  crm_provider?: string;
  crm_report_name?: string;
  last_synced_at?: string;
}

export interface AccountSearchResult {
  id: string;
  name: string;
  domain: string | null;
}

export interface CrmReport {
  id: string;
  name: string;
}

// ─── Admin Permissions ──────────────────────────────────────────────────────

export interface PermissionUser {
  userId: string;
  userName: string | null;
  userEmail: string;
  role: string;
  permissions: string[];
  accessGrants?: PermissionAccessGrant[];
}

export interface PermissionAccessGrant {
  id: string;
  scopeType: string;
  account: { id: string; name: string; domain: string | null } | null;
  cachedAccountIds: string[];
  crmReportId: string | null;
  crmProvider: string | null;
  crmReportName: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
}

// ─── Role Profiles ─────────────────────────────────────────────────────────

export interface RoleProfile {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isPreset: boolean;
  permissions: string[];
  canAccessAnonymousStories: boolean;
  canGenerateAnonymousStories: boolean;
  canAccessNamedStories: boolean;
  canGenerateNamedStories: boolean;
  defaultAccountScopeType: string;
  defaultAccountIds: string[];
  maxTokensPerDay: number | null;
  maxTokensPerMonth: number | null;
  maxRequestsPerDay: number | null;
  maxRequestsPerMonth: number | null;
  maxStoriesPerMonth: number | null;
  assignments: Array<{
    userId: string;
    user: { name: string | null; email: string };
  }>;
}

export interface RoleAssignableUser {
  id: string;
  name: string | null;
  email: string;
  base_role: string;
  role_profile_id: string | null;
}

export interface UpsertRoleProfileRequest {
  key: string;
  name: string;
  description?: string;
  permissions: string[];
  can_access_anonymous_stories: boolean;
  can_generate_anonymous_stories: boolean;
  can_access_named_stories: boolean;
  can_generate_named_stories: boolean;
  default_account_scope_type: string;
  default_account_ids?: string[];
  max_tokens_per_day?: number | null;
  max_tokens_per_month?: number | null;
  max_requests_per_day?: number | null;
  max_requests_per_month?: number | null;
  max_stories_per_month?: number | null;
}

export interface StoryContextSettings {
  company_overview: string;
  products: string[];
  target_personas: string[];
  target_industries: string[];
  differentiators: string[];
  proof_points: string[];
  banned_claims: string[];
  writing_style_guide: string;
  approved_terminology: string[];
  published_branding?: {
    brand_name: string;
    logo_url: string;
    primary_color: string;
    accent_color: string;
    surface_color: string;
  };
  default_story_length: StoryLength;
  default_story_outline: StoryOutline;
  default_story_format: StoryFormat | null;
  default_story_type: StoryTypeInput;
}

export interface AuditLogEntry {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  category: string;
  action: string;
  schema_version: number;
  target_type: string | null;
  target_id: string | null;
  severity: string;
  metadata: unknown;
  ip_address: string | null;
  user_agent: string | null;
  expires_at: string | null;
}

export interface AuditLogsPage {
  has_more: boolean;
  next_cursor: string | null;
}

export interface AuditActorDrilldown {
  actor: {
    id: string;
    name: string | null;
    email: string | null;
    role: string | null;
  };
  total_events: number;
  recent_events: Array<{
    id: string;
    created_at: string;
    category: string;
    action: string;
    target_type: string | null;
    target_id: string | null;
    severity: string;
  }>;
}

export interface AuditResourceDrilldown {
  resource: {
    target_type: string;
    target_id: string;
  };
  total_events: number;
  recent_events: Array<{
    id: string;
    created_at: string;
    actor_user_id: string | null;
    category: string;
    action: string;
    severity: string;
  }>;
}

export interface OpsDiagnostics {
  timestamp: string;
  tenant: {
    organization_id: string;
    totals: {
      accounts: number;
      calls: number;
      stories: number;
      landing_pages: number;
    };
  };
  integrations: {
    total: number;
    enabled: number;
    failed: number;
    providers: Array<{
      id: string;
      provider: string;
      enabled: boolean;
      status: string;
      last_sync_at: string | null;
      last_error: string | null;
      updated_at: string;
    }>;
  };
  alerts: {
    unresolved_notifications: Array<{
      id: string;
      type: string;
      severity: string;
      created_at: string;
    }>;
  };
  recent_audit_events: Array<{
    id: string;
    created_at: string;
    category: string;
    action: string;
    severity: string;
  }>;
  recent_usage: Array<{
    id: string;
    metric: string;
    quantity: number;
    occurred_at: string;
  }>;
}

export interface IntegrationHealthRow {
  id: string;
  provider: string;
  enabled: boolean;
  status: string;
  lag_minutes: number | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_failure_error: string | null;
  throughput_recent: number;
  failures_recent: number;
}

export interface DeadLetterRun {
  id: string;
  provider: string;
  run_type: string;
  started_at: string;
  finished_at: string | null;
  processed_count: number;
  success_count: number;
  failure_count: number;
  error_message: string | null;
  idempotency_key: string | null;
}

export interface BackfillRun {
  id: string;
  provider: string;
  status: string;
  idempotency_key: string | null;
  started_at: string;
  finished_at: string | null;
  processed_count: number;
  success_count: number;
  failure_count: number;
  error_message: string | null;
}

export interface QueueSloMetrics {
  window_hours: number;
  total_runs: number;
  failed_runs: number;
  failure_rate: number;
  stale_integrations: number;
  failed_runs_by_provider: Array<{
    provider: string;
    failed_runs: number;
    failure_events: number;
  }>;
  alerts: Array<{
    severity: "WARN" | "CRITICAL";
    code: string;
    message: string;
  }>;
}

export interface SyntheticHealth {
  status: "HEALTHY" | "DEGRADED" | "CRITICAL";
  checked_at: string;
  checks: Array<{
    dependency: string;
    healthy: boolean;
    detail: string;
  }>;
}

export interface PipelineSummary {
  total: number;
  completed: number;
  failed: number;
  running: number;
  processed: number;
  successes: number;
  failures: number;
}

export interface PipelineStatus {
  window_hours: number;
  sync: PipelineSummary;
  backfill: PipelineSummary;
  replay: PipelineSummary;
  pending_approvals: number;
  failed_backfills: number;
  latest_runs: Array<{
    run_type: string;
    status: string;
    provider: string;
    started_at: string;
    finished_at: string | null;
    processed_count: number;
    success_count: number;
    failure_count: number;
  }>;
}

export interface ReplayObservabilityEvent {
  audit_log_id: string;
  triggered_at: string;
  action: string;
  actor_user_id: string | null;
  source_run_id: string | null;
  source_run_type: string | null;
  replay_run_id: string | null;
  provider: string;
  outcome: "COMPLETED" | "FAILED" | "RUNNING" | "PENDING";
  replay_attempt: number | null;
  replay_attempt_cap: number | null;
  replay_window_hours: number | null;
  source_run_age_hours: number | null;
}

export interface ReplayObservability {
  window_hours: number;
  filters: {
    provider: string | null;
    operator_user_id: string | null;
    outcome: "COMPLETED" | "FAILED" | "RUNNING" | "PENDING" | null;
    run_type: "SYNC" | "BACKFILL" | "MANUAL" | "REPLAY" | null;
    limit: number;
  };
  totals: {
    replay_triggers: number;
    unique_operators: number;
  };
  outcomes: Array<{
    outcome: "COMPLETED" | "FAILED" | "RUNNING" | "PENDING";
    count: number;
  }>;
  providers: Array<{
    provider: string;
    replay_triggers: number;
    completed: number;
    failed: number;
    running: number;
    pending: number;
  }>;
  operators: Array<{
    actor_user_id: string | null;
    actor_user_email: string | null;
    actor_user_name: string | null;
    actor_user_role: string | null;
    replay_triggers: number;
    last_triggered_at: string;
    providers: string[];
  }>;
  recent_events: ReplayObservabilityEvent[];
}

export type SellerAdoptionEventType =
  | "modal_open"
  | "preset_selected"
  | "visibility_mode_selected"
  | "generation_started"
  | "story_generated"
  | "generation_failed"
  | "share_action"
  | "library_action";

export interface SellerAdoptionMetrics {
  window_days: number;
  totals: {
    event_count: number;
    flow_count: number;
    user_count: number;
  };
  kpis: {
    median_time_to_first_story_ms: number | null;
    median_time_to_share_ms: number | null;
  };
  usage: {
    stage_presets: Array<{ preset: string; count: number }>;
    visibility_modes: Array<{ mode: string; count: number }>;
  };
  funnel: {
    steps: Array<{
      step: string;
      flows: number;
      conversion_from_start: number;
    }>;
    drop_off: Array<{
      from_step: string;
      to_step: string;
      previous_flows: number;
      current_flows: number;
      drop_off_rate: number;
    }>;
  };
  recent_events: Array<{
    flow_id: string;
    actor_user_id: string | null;
    event_type: string;
    stage_preset: string | null;
    visibility_mode: string | null;
    action_name: string | null;
    duration_ms: number | null;
    created_at: string;
  }>;
}

export interface DrReadiness {
  status: "READY" | "AT_RISK";
  targets: {
    rto_minutes: number;
    rpo_minutes: number;
  };
  last_backup_verified_at: string | null;
  last_restore_validated_at: string | null;
  backup_age_minutes: number | null;
  restore_validation_age_minutes: number | null;
  critical_entity_counts: {
    accounts: number;
    calls: number;
    stories: number;
    landing_pages: number;
  };
}

export interface SupportImpersonationSession {
  id: string;
  actor_user_id: string;
  target_user_id: string;
  actor_user_email: string;
  target_user_email: string;
  actor_user_name: string | null;
  target_user_name: string | null;
  actor_user_role: string;
  target_user_role: string;
  reason: string;
  scope: string[];
  started_at: string;
  last_used_at: string | null;
  expires_at: string;
  revoked_at: string | null;
  revoked_by_user_id: string | null;
  revoked_by_user_email: string | null;
}

export interface IncidentUpdateRow {
  id: string;
  message: string;
  status: string | null;
  metadata?: Record<string, unknown> | null;
  created_by_user_id?: string | null;
  created_at: string;
}

export interface IncidentRow {
  id: string;
  title: string;
  summary: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | string;
  status: "OPEN" | "MONITORING" | "RESOLVED" | string;
  started_at: string;
  resolved_at: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  updates: IncidentUpdateRow[];
}

export interface PublicStatusIncident {
  id: string;
  title: string;
  summary: string;
  severity: string;
  status: string;
  started_at: string;
  updated_at: string;
  updates: Array<{
    id: string;
    message: string;
    status: string | null;
    created_at: string;
  }>;
}

export interface StartSupportImpersonationResponse {
  id: string;
  support_impersonation_token: string;
  actor_user_id: string;
  target_user_id: string;
  scope: string[];
  expires_at: string;
  reason: string;
}

export interface SetupStatus {
  currentStep: string;
  completedAt: string | null;
  completionScore: number;
  missingPrompts: string[];
  firstValue: {
    storiesGenerated: number;
    pagesPublished: number;
    complete: boolean;
  };
  steps: {
    recording_provider: {
      complete: boolean;
      provider?: string | null;
      mergeLinkedAccountId?: string | null;
    };
    crm: {
      complete: boolean;
      provider?: string | null;
      mergeLinkedAccountId?: string | null;
    };
    account_sync: {
      complete: boolean;
      syncedAccountCount?: number;
      unresolvedCount?: number;
      reviewedAt?: string | null;
    };
    plan: { complete: boolean };
    permissions: {
      complete: boolean;
      configuredAt?: string | null;
    };
  };
}

export interface SetupPlanCatalog {
  billing_enabled: boolean;
  plans: Array<{
    id: "FREE_TRIAL" | "STARTER" | "PROFESSIONAL" | "ENTERPRISE";
    name: string;
    description: string;
    price: number | { amount: number; currency: string; interval: string } | null;
    features: string[];
  }>;
}

export interface SetupMvpAccountRow {
  name: string;
  count: number;
}

export interface SetupMvpQuickstartStatus {
  gong_configured: boolean;
  gong_base_url: string;
  gong_status: string;
  gong_last_sync_at: string | null;
  gong_last_error: string | null;
  openai_configured: boolean;
  selected_account_names: string[];
  account_index: {
    generated_at: string | null;
    total_calls_indexed: number;
    total_accounts: number;
    accounts: SetupMvpAccountRow[];
  };
}

export interface IntegrationSettingsRow {
  id: string;
  merge_account_id: string;
  integration: string;
  category: "CRM" | "RECORDING";
  status: "ACTIVE" | "PAUSED" | "ERROR" | "REVOKED" | string;
  last_synced_at: string | null;
  initial_sync_done: boolean;
  created_at: string;
}

export interface IntegrationSettingsListResponse {
  merge_configured: boolean;
  integrations: IntegrationSettingsRow[];
}

export interface IntegrationLinkTokenResponse {
  link_token: string;
  category: "crm" | "filestorage";
}

export interface IntegrationCompleteLinkResponse {
  integration: {
    id: string;
    merge_account_id: string;
    integration: string;
    category: "CRM" | "RECORDING";
    status: "ACTIVE" | "PAUSED" | "ERROR" | "REVOKED" | string;
  };
}

export interface BillingReadiness {
  organization: {
    plan: string;
    pricing_model: string;
    billing_channel: string;
  };
  seats: {
    limit: number | null;
    used: number;
    over_limit: boolean;
    by_role: Record<string, number>;
  };
  subscription: {
    id: string;
    status: string;
    seat_count: number | null;
    included_units: number | null;
    metered_unit_price: number | null;
    current_period_start: string | null;
    current_period_end: string | null;
  } | null;
  usage_30d: Record<string, number>;
  overage: {
    metric: string;
    included_units: number | null;
    used_units: number;
    overage_units: number;
    projected_cost: number | null;
  };
  entitlements: {
    feature_flags: string[];
  };
}

export interface BillingReconciliation {
  window_days: number;
  metered_minutes: number;
  computed_minutes: number;
  delta_minutes: number;
  mismatch_percent: number;
  status: "OK" | "WARN" | "CRITICAL";
  stripe_report_coverage_percent: number;
}

export interface RoleAwareHome {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    base_role: string;
    role_profile_key: string | null;
    role_profile_name: string | null;
  };
  persona: "REVOPS_ADMIN" | "MARKETING_ANALYST" | "SALES_MANAGER" | "CSM" | "EXEC";
  summary: {
    stories_30d: number;
    pages_30d: number;
    failed_integrations: number;
    pending_approvals: number;
    post_sale_stories_30d: number;
    mofu_stories_30d: number;
    bofu_stories_30d: number;
    total_page_views: number;
  };
  recommended_actions: string[];
}

export interface CustomerSuccessHealth {
  overall_score: number;
  onboarding_progress_pct: number;
  adoption_rate_pct: number;
  reliability_score: number;
  teams: Array<{
    team: "REVOPS" | "MARKETING" | "SALES" | "CS";
    members: number;
    workspace_count: number;
    score: number;
    risk: "LOW" | "MEDIUM" | "HIGH";
  }>;
  risk_indicators: string[];
}

export interface RenewalValueReport {
  window_days: number;
  renewal_health: "STRONG" | "WATCH" | "AT_RISK";
  headline: string;
  usage_by_metric: Record<string, number>;
  outcomes: {
    stories_generated_90d: number;
    pages_created_90d: number;
    pages_published_90d: number;
    active_users_30d: number;
    total_users: number;
    adoption_rate_pct: number;
    top_topics: Array<{ topic: string; count: number }>;
  };
  contract_context: {
    subscription_status: string | null;
    billing_interval: string | null;
    current_period_end: string | null;
    contract_value_cents: number | null;
  };
  roi_narrative: string;
}

export interface TeamWorkspace {
  id: string;
  name: string;
  description: string | null;
  team: "REVOPS" | "MARKETING" | "SALES" | "CS";
  visibility: "PRIVATE" | "TEAM" | "ORG";
  owner_user_id: string;
  saved_view_config: Record<string, unknown> | null;
  allowed_role_profile_keys: string[];
  created_at: string;
  updated_at: string;
}

export interface SharedAsset {
  id: string;
  workspace_id: string | null;
  asset_type: "STORY" | "PAGE" | "REPORT" | "PLAYBOOK" | "TEMPLATE";
  title: string;
  description: string | null;
  source_story_id: string | null;
  source_page_id: string | null;
  source_account_id: string | null;
  visibility: "PRIVATE" | "TEAM" | "ORG";
  owner_user_id: string;
  allowed_role_profile_keys: string[];
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface WritebackRequest {
  id: string;
  status: string;
  target_type: string;
  target_id: string;
  request_payload: Record<string, unknown> | null;
  requested_by_user_id: string;
  reviewer_user_id: string | null;
  review_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface AutomationRule {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  trigger_type: "THRESHOLD" | "SCHEDULE" | "EVENT";
  metric: string | null;
  operator: string | null;
  threshold: number | null;
  schedule_cron: string | null;
  event_type: string | null;
  delivery_type: "SLACK" | "EMAIL" | "WEBHOOK";
  delivery_target: string;
  payload_template: Record<string, unknown> | null;
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationScheduledReport {
  id: string;
  title: string;
  description: string | null;
  created_at: string;
  metrics: Record<string, number> | null;
  window_days: number | null;
}

export interface FirstValueRecommendations {
  starter_story_templates: Array<{
    id: string;
    label: string;
    funnel_stage: string;
  }>;
  contextual_prompts?: Array<{
    id: string;
    title: string;
    detail: string;
    cta_label: string;
    cta_path: string;
    status: "DONE" | "READY" | "BLOCKED";
  }>;
  suggested_account: { id: string; name: string } | null;
  completion: {
    stories_generated: number;
    pages_published: number;
    first_value_complete: boolean;
  };
  next_tasks: string[];
}

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

// ─── Transcript Viewer ──────────────────────────────────────────────────────

export interface TranscriptSegmentTag {
  funnelStage: string;
  topic: string;
  confidence: number;
}

export interface TranscriptSegment {
  id: string;
  chunkIndex: number;
  speaker: string | null;
  text: string;
  startMs: number | null;
  endMs: number | null;
  tags: TranscriptSegmentTag[];
}

export interface TranscriptParticipant {
  name: string | null;
  email: string | null;
  isHost: boolean;
  contactName: string | null;
  contactTitle: string | null;
}

export interface TranscriptEntityInfo {
  accountId: string | null;
  accountName: string | null;
  accountDomain: string | null;
  accountIndustry: string | null;
}

export interface TranscriptCallMeta {
  id: string;
  title: string | null;
  provider: string;
  duration: number | null;
  occurredAt: string;
  recordingUrl: string | null;
  language: string;
  wordCount: number;
}

export interface TranscriptData {
  meta: TranscriptCallMeta;
  segments: TranscriptSegment[];
  participants: TranscriptParticipant[];
  entity: TranscriptEntityInfo;
  callTags: TranscriptSegmentTag[];
}

// ─── Editor Page ────────────────────────────────────────────────────────────

export interface EditorPageData {
  pageId: string;
  title: string;
  subtitle: string;
  editableBody: string;
  status: string;
  visibility: string;
  includeCompanyName: boolean;
  canPublishNamed: boolean;
  updatedAt: string;
}

export interface SavePageDraftConflict {
  conflict: true;
  expected_updated_at: string;
  current_updated_at: string;
  latest_editable_body: string;
  message: string;
}

export interface SavePageDraftSuccess {
  conflict: false;
  updated_at: string;
}

export type SavePageDraftResult = SavePageDraftSuccess | SavePageDraftConflict;

export interface ArtifactVersion {
  id: string;
  version_number: number;
  status: string;
  release_notes: string | null;
  visibility: string;
  expires_at: string | null;
  published_at: string | null;
  created_at: string;
  created_by: {
    id: string;
    name: string | null;
    email: string;
  } | null;
  provenance: Record<string, unknown> | null;
}

export interface PublishApprovalRequestRow {
  id: string;
  status: string;
  target_id: string;
  created_at: string;
  reviewed_at: string | null;
  requested_by: {
    id: string;
    name: string | null;
    email: string;
  };
  reviewer: {
    id: string;
    name: string | null;
    email: string;
  } | null;
  payload: Record<string, unknown> | null;
}

export interface ArtifactGovernancePolicySettings {
  approval_chain_enabled: boolean;
  max_expiration_days: number | null;
  require_provenance: boolean;
  steps: Array<{
    id?: string;
    step_order: number;
    min_approvals: number;
    required_role_profile_key: string | null;
    required_user_role: string | null;
    approver_scope_type?: "ROLE_PROFILE" | "TEAM" | "USER" | "GROUP" | "SELF";
    approver_scope_value?: string | null;
    allow_self_approval?: boolean;
    enabled: boolean;
  }>;
}

export interface ApprovalGroup {
  id: string;
  name: string;
  description: string | null;
  owner: { id: string; name: string | null; email: string } | null;
  members: Array<{ id: string; name: string | null; email: string; role: string }>;
  created_at: string;
  updated_at: string;
}

export interface TeamApprovalAdminScopeRow {
  user: { id: string; name: string | null; email: string };
  team_keys: string[];
}

export interface DataQualityOverview {
  stories_total: number;
  confidence: {
    avg_30d: number;
    avg_prev_30d: number;
    drift_delta: number;
    drift_status: "STABLE" | "WARN" | "ALERT";
  };
  lineage: {
    claims_30d: number;
    coverage_ratio: number;
  };
  freshness: {
    last_story_at: string | null;
  };
  sync_errors: {
    failures_30d: number;
    failures_prev_30d: number;
    delta: number;
  };
  human_feedback: {
    open: number;
    applied: number;
  };
}

export interface StoryLineageResponse {
  story: {
    id: string;
    title: string;
    confidence_score: number;
    lineage_summary: Record<string, unknown> | null;
  };
  claims: Array<{
    id: string;
    claim_type: string;
    claim_text: string;
    source_call_id: string | null;
    source_chunk_id: string | null;
    source_timestamp_ms: number | null;
    confidence_score: number;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }>;
}

export interface StoryQualityFeedbackRow {
  id: string;
  status: string;
  feedback_type: string;
  target_type: string;
  target_id: string | null;
  original_value: string | null;
  corrected_value: string | null;
  notes: string | null;
  apply_to_prompt_tuning: boolean;
  story: { id: string; title: string };
  submitted_by: { id: string; name: string | null; email: string } | null;
  created_at: string;
  updated_at: string;
}

// ─── Dashboard Pages ────────────────────────────────────────────────────────

export interface DashboardStats {
  totalPages: number;
  publishedPages: number;
  draftPages: number;
  totalViews: number;
}

export interface DashboardPageSummary {
  id: string;
  title: string;
  slug: string;
  status: string;
  visibility: string;
  viewCount: number;
  accountName: string;
  createdByName: string;
  createdByEmail: string;
  publishedAt: string | null;
  updatedAt: string;
}

export interface DashboardCreator {
  userId: string;
  name: string | null;
  email: string;
}

// ─── Chatbot Connector ──────────────────────────────────────────────────────

export interface ChatAccount {
  id: string;
  name: string;
  domain: string | null;
  call_count: number;
}

export interface ChatSource {
  call_id: string;
  call_title: string;
  call_date: string;
  speaker: string;
  text: string;
  relevance_score: number;
}

// ─── Analytics Dashboard ────────────────────────────────────────────────────

export interface AnalyticsData {
  summary: {
    totalCalls: number;
    totalAccounts: number;
    totalTranscriptHours: number;
    overallResolutionRate: number;
    totalQuotes: number;
    totalPageViews: number;
  };
  callsPerWeek: Array<{ weekStart: string; count: number }>;
  funnelDistribution: Array<{ stage: string; count: number }>;
  topAccounts: Array<{ accountName: string; callCount: number }>;
  entityResolutionOverTime: Array<{ weekStart: string; rate: number; resolvedCalls: number; totalCalls: number }>;
  topTopics: Array<{ label: string; count: number; funnelStage: string }>;
  quoteLeaderboard: Array<{ accountName: string; quoteCount: number }>;
  topPagesByViews: Array<{ title: string; slug: string; viewCount: number; publishedAt: string | null }>;
  viewsOverTime: Array<{ weekStart: string; totalViews: number; pagesPublished: number }>;
}

export interface RevOpsKpiData {
  window_days: number;
  pipeline_influence: {
    influenced_accounts: number;
    accounts_with_pipeline_events: number;
    influence_rate_percent: number;
  };
  conversion_by_stage: Array<{ stage_name: string | null; count: number }>;
  win_loss: {
    closed_won: number;
    closed_lost: number;
    win_rate_percent: number;
  };
  persona_objections: {
    transcript_level_objection_mentions: number;
    top_objection_topics: Array<{ topic: string; count: number }>;
  };
  competitor_mentions: {
    transcript_level_competitor_mentions: number;
  };
  attribution_links: {
    linked_calls: number;
    linked_stories: number;
    linked_opportunity_events: number;
    linked_campaigns: number;
    note: string;
  };
  executive_summary: string[];
}

// ─── Account Journey ────────────────────────────────────────────────────────

export interface JourneyAccount {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employee_count: number | null;
  annual_revenue: number | null;
  salesforce_id: string | null;
  hubspot_id: string | null;
  contact_count: number;
  call_count: number;
  total_call_minutes: number;
  story_count: number;
  top_contacts: Array<{
    id: string;
    name: string | null;
    email: string | null;
    title: string | null;
    call_appearances: number;
  }>;
}

export interface JourneyTimelineNode {
  type: "call" | "crm_event";
  id: string;
  date: string;
  title?: string;
  provider?: string;
  duration?: number;
  primary_stage?: string;
  participants?: Array<{
    id: string;
    name: string | null;
    email: string | null;
    is_host: boolean;
    title: string | null;
  }>;
  tags?: Array<{
    funnel_stage: string;
    topic: string;
    topic_label: string;
    confidence: number;
  }>;
  event_type?: string;
  stage_name?: string;
  opportunity_id?: string;
  amount?: number;
  description?: string;
}

// ─── Platform / App Owner ────────────────────────────────────────────────────

export interface PlatformSettings {
  support_account_email: string | null;
  support_account_label: string;
}

export interface TenantOverview {
  id: string;
  name: string;
  plan: string;
  user_count: number;
  story_count_30d: number;
  page_count_30d: number;
  created_at: string;
  support_opted_out: boolean;
  deletion_request: TenantDeletionRequestInfo | null;
}

export interface TenantDeletionRequestInfo {
  id: string;
  status: "PENDING_APPROVAL" | "APPROVED" | "CANCELLED" | "COMPLETED";
  reason: string | null;
  requested_by_email: string | null;
  scheduled_delete_at: string | null;
  created_at: string;
}

export interface SupportAccountInfo {
  email: string | null;
  label: string;
  opted_out: boolean;
}
