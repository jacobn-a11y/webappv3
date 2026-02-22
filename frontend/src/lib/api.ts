/**
 * API client for StoryEngine backend.
 */

import type { FunnelStage, TaxonomyTopic, StoryFormat } from "../types/taxonomy";
import type { StoryLength, StoryOutline, StoryTypeInput } from "../types/taxonomy";

// ─── Types ───────────────────────────────────────────────────────────────────

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
  call_id?: string;
}

export interface BuildStoryResponse {
  title: string;
  markdown: string;
  quotes: StoryQuote[];
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
  funnel_stages: FunnelStage[];
  filter_tags: string[];
  generated_at: string;
  markdown: string;
  quotes: StoryQuote[];
}

export interface CreateLandingPageRequest {
  story_id: string;
  title: string;
  subtitle?: string;
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
    recording_provider: { complete: boolean };
    crm: { complete: boolean };
    account_sync: { complete: boolean };
    plan: { complete: boolean };
    permissions: { complete: boolean };
  };
}

export interface SetupPlanCatalog {
  billing_enabled: boolean;
  plans: Array<{
    id: "FREE_TRIAL" | "STARTER" | "PROFESSIONAL" | "ENTERPRISE";
    name: string;
    description: string;
    price: number | null;
    features: string[];
  }>;
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

export interface FirstValueRecommendations {
  starter_story_templates: Array<{
    id: string;
    label: string;
    funnel_stage: string;
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
}

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
  // Call-specific
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
  // CRM event-specific
  event_type?: string;
  stage_name?: string;
  opportunity_id?: string;
  amount?: number;
  description?: string;
}

// ─── Client ──────────────────────────────────────────────────────────────────

const BASE_URL = "/api";
const SUPPORT_IMPERSONATION_TOKEN_KEY = "support_impersonation_token";
const APP_SESSION_TOKEN_KEY = "app_session_token";
const APP_AUTH_USER_KEY = "app_auth_user";
const AUTH_CHANGED_EVENT = "storyengine-auth-changed";

function emitAuthChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  }
}

function getSupportImpersonationToken(): string | null {
  try {
    return localStorage.getItem(SUPPORT_IMPERSONATION_TOKEN_KEY);
  } catch {
    return null;
  }
}

function getSessionToken(): string | null {
  try {
    return localStorage.getItem(APP_SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

function readStoredAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(APP_AUTH_USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const headers = new Headers(options?.headers ?? {});
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  const sessionToken = getSessionToken();
  if (sessionToken) {
    headers.set("x-session-token", sessionToken);
  }
  const supportToken = getSupportImpersonationToken();
  if (supportToken) {
    headers.set("x-support-impersonation-token", supportToken);
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export function setSupportImpersonationToken(token: string | null): void {
  try {
    if (!token) {
      localStorage.removeItem(SUPPORT_IMPERSONATION_TOKEN_KEY);
      return;
    }
    localStorage.setItem(SUPPORT_IMPERSONATION_TOKEN_KEY, token);
  } catch {
    // Ignore storage errors in restricted environments.
  }
}

export function readSupportImpersonationToken(): string | null {
  return getSupportImpersonationToken();
}

function persistAuthState(payload: { sessionToken: string; user: AuthUser }): void {
  try {
    localStorage.setItem(APP_SESSION_TOKEN_KEY, payload.sessionToken);
    localStorage.setItem(APP_AUTH_USER_KEY, JSON.stringify(payload.user));
    emitAuthChanged();
  } catch {
    // Ignore storage failures in restricted environments.
  }
}

export function clearAuthState(): void {
  try {
    localStorage.removeItem(APP_SESSION_TOKEN_KEY);
    localStorage.removeItem(APP_AUTH_USER_KEY);
    localStorage.removeItem(SUPPORT_IMPERSONATION_TOKEN_KEY);
    emitAuthChanged();
  } catch {
    // Ignore storage failures in restricted environments.
  }
}

export function getStoredAuthUser(): AuthUser | null {
  return readStoredAuthUser();
}

export function subscribeAuthChanges(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  window.addEventListener(AUTH_CHANGED_EVENT, listener);
  return () => window.removeEventListener(AUTH_CHANGED_EVENT, listener);
}

export async function signupWithPassword(body: {
  email: string;
  password: string;
  name?: string;
  organizationName?: string;
}): Promise<AuthResponse> {
  const response = await request<AuthResponse>("/auth/signup", {
    method: "POST",
    body: JSON.stringify(body),
  });
  persistAuthState({ sessionToken: response.sessionToken, user: response.user });
  return response;
}

export async function getSsoAuthorizationUrl(screen?: "sign-up" | "sign-in"): Promise<string> {
  const query =
    screen === "sign-up" ? "?provider=google&screen=sign-up" : "?provider=google";
  const response = await request<{ authorizationUrl: string }>(`/auth/login${query}`);
  return response.authorizationUrl;
}

export async function completeSsoCallback(code: string): Promise<AuthResponse> {
  const response = await request<AuthResponse>(
    `/auth/callback?code=${encodeURIComponent(code)}`
  );
  persistAuthState({ sessionToken: response.sessionToken, user: response.user });
  return response;
}

export async function loginWithPassword(body: {
  email: string;
  password: string;
}): Promise<AuthResponse> {
  const response = await request<AuthResponse>("/auth/login/password", {
    method: "POST",
    body: JSON.stringify(body),
  });
  persistAuthState({ sessionToken: response.sessionToken, user: response.user });
  return response;
}

export async function getAuthMe(): Promise<{ user: AuthUser; sessionExpiresAt: string }> {
  const response = await request<{ user: AuthUser; sessionExpiresAt: string }>(
    "/auth/me"
  );
  const existingToken = getSessionToken();
  if (existingToken) {
    persistAuthState({ sessionToken: existingToken, user: response.user });
  }
  return response;
}

export async function logoutSelfService(): Promise<void> {
  try {
    await request<{ success: boolean }>("/auth/logout", {
      method: "POST",
    });
  } finally {
    clearAuthState();
  }
}

export async function getInviteDetails(token: string): Promise<{ invite: InviteSummary }> {
  return request<{ invite: InviteSummary }>(`/auth/invites/${encodeURIComponent(token)}`);
}

export async function acceptInvite(token: string, body: {
  password: string;
  name?: string;
}): Promise<AuthResponse> {
  const response = await request<AuthResponse>(
    `/auth/invites/${encodeURIComponent(token)}/accept`,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
  persistAuthState({ sessionToken: response.sessionToken, user: response.user });
  return response;
}

export async function createSelfServeCheckout(plan: "STARTER" | "PROFESSIONAL" | "ENTERPRISE"): Promise<{
  checkoutUrl: string;
}> {
  return request<{ checkoutUrl: string }>("/billing/checkout", {
    method: "POST",
    body: JSON.stringify({ plan }),
  });
}

export async function createSelfServePortal(): Promise<{ portalUrl: string }> {
  return request<{ portalUrl: string }>("/billing/portal", {
    method: "POST",
  });
}

export async function buildStory(
  req: BuildStoryRequest
): Promise<BuildStoryResponse> {
  return request<BuildStoryResponse>("/stories/build", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function getAccountStories(
  accountId: string
): Promise<{ stories: StorySummary[] }> {
  return request<{ stories: StorySummary[] }>(`/stories/${accountId}`);
}

export async function createLandingPage(
  req: CreateLandingPageRequest
): Promise<CreateLandingPageResponse> {
  return request<CreateLandingPageResponse>("/pages", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

// ─── Admin Account Access ───────────────────────────────────────────────────

export async function getAccessUsers(): Promise<{ users: AccessUser[] }> {
  return request<{ users: AccessUser[] }>("/dashboard/access");
}

export async function searchAccounts(query: string): Promise<{ accounts: AccountSearchResult[] }> {
  return request<{ accounts: AccountSearchResult[] }>(`/dashboard/accounts/search?q=${encodeURIComponent(query)}`);
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

export async function getStoryContextSettings(): Promise<StoryContextSettings> {
  return request<StoryContextSettings>("/dashboard/story-context");
}

export async function updateStoryContextSettings(
  body: StoryContextSettings
): Promise<void> {
  return request<void>("/dashboard/story-context", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

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
  const response = await fetch(`/api/dashboard/audit-logs/export?${qs.toString()}`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Failed to export audit logs");
  }
  const blob = await response.blob();
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

export async function getSupportImpersonationSessions(): Promise<{
  sessions: SupportImpersonationSession[];
}> {
  return request<{ sessions: SupportImpersonationSession[] }>(
    "/dashboard/support/impersonation/sessions"
  );
}

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

export async function getSetupStatus(): Promise<SetupStatus> {
  return request<SetupStatus>("/setup/status");
}

export async function getSetupPlans(): Promise<SetupPlanCatalog> {
  return request<SetupPlanCatalog>("/setup/step/plan");
}

export async function selectSetupPlan(plan: "FREE_TRIAL" | "STARTER" | "PROFESSIONAL" | "ENTERPRISE"): Promise<{
  completed: boolean;
  checkoutUrl: string | null;
  status: SetupStatus;
}> {
  return request<{ completed: boolean; checkoutUrl: string | null; status: SetupStatus }>(
    "/setup/step/plan",
    {
      method: "POST",
      body: JSON.stringify({ plan }),
    }
  );
}

export async function saveSetupOrgProfile(body: {
  company_overview?: string;
  products?: string[];
  target_personas?: string[];
  target_industries?: string[];
}): Promise<{ updated: boolean; status: SetupStatus }> {
  return request<{ updated: boolean; status: SetupStatus }>("/setup/step/org-profile", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function saveSetupGovernanceDefaults(body: {
  retention_days?: number;
  audit_log_retention_days?: number;
  legal_hold_enabled?: boolean;
  pii_export_enabled?: boolean;
  deletion_requires_approval?: boolean;
  allow_named_story_exports?: boolean;
  rto_target_minutes?: number;
  rpo_target_minutes?: number;
}): Promise<{ updated: boolean; status: SetupStatus }> {
  return request<{ updated: boolean; status: SetupStatus }>(
    "/setup/step/governance-defaults",
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
}

export async function applySetupRolePresets(): Promise<{
  updated: boolean;
  status: SetupStatus;
}> {
  return request<{ updated: boolean; status: SetupStatus }>("/setup/step/role-presets", {
    method: "POST",
  });
}

export async function getFirstValueRecommendations(): Promise<FirstValueRecommendations> {
  return request<FirstValueRecommendations>("/setup/first-value/recommendations");
}

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

export async function runAutomationRule(ruleId: string): Promise<{ status: string; error?: string | null }> {
  return request<{ status: string; error?: string | null }>(`/dashboard/automations/${ruleId}/run`, {
    method: "POST",
  });
}

export async function deleteAutomationRule(ruleId: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/dashboard/automations/${ruleId}`, {
    method: "DELETE",
  });
}

export async function getIntegrationHealth(): Promise<{
  integrations: IntegrationHealthRow[];
}> {
  return request<{ integrations: IntegrationHealthRow[] }>(
    "/dashboard/integrations/health"
  );
}

export async function getIntegrationDeadLetterRuns(params?: {
  limit?: number;
  provider?: string;
}): Promise<{ failed_runs: DeadLetterRun[]; total_failed: number }> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.provider) qs.set("provider", params.provider);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return request<{ failed_runs: DeadLetterRun[]; total_failed: number }>(
    `/integrations/ops/dead-letter${suffix}`
  );
}

export async function replayDeadLetterRun(runId: string): Promise<void> {
  return request<void>(`/integrations/ops/dead-letter/${runId}/replay`, {
    method: "POST",
  });
}

export async function getIntegrationBackfills(params?: {
  limit?: number;
  provider?: string;
}): Promise<{ backfills: BackfillRun[] }> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.provider) qs.set("provider", params.provider);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return request<{ backfills: BackfillRun[] }>(`/integrations/ops/backfills${suffix}`);
}

export async function triggerIntegrationBackfill(body: {
  provider: "GRAIN" | "GONG" | "SALESFORCE" | "MERGE_DEV";
  start_date?: string;
  end_date?: string;
  cursor?: string;
  idempotency_key?: string;
}): Promise<void> {
  return request<void>("/integrations/ops/backfills", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

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

export async function getDataGovernanceSettings(): Promise<DataGovernanceSettings> {
  return request<DataGovernanceSettings>("/dashboard/data-governance");
}

export async function updateDataGovernanceSettings(
  body: Partial<DataGovernanceSettings>
): Promise<void> {
  return request<void>("/dashboard/data-governance", {
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

// ─── Transcript Viewer ──────────────────────────────────────────────────────

export async function getTranscriptData(callId: string): Promise<TranscriptData> {
  return request<TranscriptData>(`/calls/${callId}/transcript`);
}

// ─── Editor Page ────────────────────────────────────────────────────────────

export async function getEditorPageData(pageId: string): Promise<EditorPageData> {
  return request<EditorPageData>(`/pages/${pageId}/edit-data`);
}

export async function savePageDraft(pageId: string, body: string): Promise<void> {
  return request<void>(`/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({ editable_body: body }),
  });
}

export async function getPreviewScrub(pageId: string): Promise<{
  original: { body: string };
  scrubbed: { body: string };
  replacements_made: number;
}> {
  return request<{ original: { body: string }; scrubbed: { body: string }; replacements_made: number }>(
    `/pages/${pageId}/preview-scrub`,
    { method: "POST" }
  );
}

export async function publishPage(pageId: string, options: {
  visibility: string;
  password?: string;
  expires_at?: string;
  release_notes?: string;
}): Promise<{ url?: string; queued_for_approval?: boolean; request_id?: string }> {
  return request<{ url?: string; queued_for_approval?: boolean; request_id?: string }>(`/pages/${pageId}/publish`, {
    method: "POST",
    body: JSON.stringify(options),
  });
}

export async function getPageVersions(pageId: string): Promise<{ versions: ArtifactVersion[] }> {
  return request<{ versions: ArtifactVersion[] }>(`/pages/${pageId}/versions`);
}

export async function rollbackPageVersion(pageId: string, versionId: string): Promise<{ rolled_back: boolean }> {
  return request<{ rolled_back: boolean }>(`/pages/${pageId}/versions/${versionId}/rollback`, {
    method: "POST",
  });
}

export async function getPublishApprovals(status = "PENDING"): Promise<{ approvals: PublishApprovalRequestRow[] }> {
  return request<{ approvals: PublishApprovalRequestRow[] }>(`/pages/approvals/publish?status=${encodeURIComponent(status)}`);
}

export async function reviewPublishApproval(
  requestId: string,
  body: { decision: "APPROVE" | "REJECT"; notes?: string }
): Promise<{ status: string; published?: boolean; url?: string }> {
  return request<{ status: string; published?: boolean; url?: string }>(`/pages/approvals/publish/${requestId}/review`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

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

export async function getDataQualityOverview(): Promise<DataQualityOverview> {
  return request<DataQualityOverview>("/dashboard/data-quality/overview");
}

export async function getStoryLineage(storyId: string): Promise<StoryLineageResponse> {
  return request<StoryLineageResponse>(`/dashboard/data-quality/stories/${storyId}/lineage`);
}

export async function submitStoryQualityFeedback(body: {
  story_id: string;
  feedback_type: "CORRECTION" | "DISPUTE" | "MISSING_EVIDENCE" | "LINEAGE_FIX";
  target_type: "STORY" | "QUOTE" | "CLAIM";
  target_id?: string;
  original_value?: string;
  corrected_value?: string;
  notes?: string;
  apply_to_prompt_tuning?: boolean;
}): Promise<{ id: string; status: string; created_at: string }> {
  return request<{ id: string; status: string; created_at: string }>("/dashboard/data-quality/feedback", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getStoryQualityFeedback(
  status?: string
): Promise<{ feedback: StoryQualityFeedbackRow[] }> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return request<{ feedback: StoryQualityFeedbackRow[] }>(`/dashboard/data-quality/feedback${qs}`);
}

export async function reviewStoryQualityFeedback(
  feedbackId: string,
  body: { status: "OPEN" | "ACCEPTED" | "REJECTED" | "APPLIED"; notes?: string }
): Promise<{ status: string; updated_at: string }> {
  return request<{ status: string; updated_at: string }>(`/dashboard/data-quality/feedback/${feedbackId}/review`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ─── Dashboard Pages ────────────────────────────────────────────────────────

export async function getDashboardPagesData(params?: {
  search?: string;
  status?: string;
  visibility?: string;
  created_by?: string;
  sort_by?: string;
  sort_dir?: string;
}): Promise<{
  stats: DashboardStats;
  pages: DashboardPageSummary[];
  creators: DashboardCreator[];
  isAdmin: boolean;
}> {
  const qs = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, v); });
  }
  const query = qs.toString();
  return request<{
    stats: DashboardStats;
    pages: DashboardPageSummary[];
    creators: DashboardCreator[];
    isAdmin: boolean;
  }>(`/dashboard/pages/data${query ? `?${query}` : ""}`);
}

export async function unpublishPage(pageId: string): Promise<void> {
  return request<void>(`/pages/${pageId}/unpublish`, { method: "POST" });
}

export async function archivePage(pageId: string): Promise<void> {
  return request<void>(`/pages/${pageId}/archive`, { method: "POST" });
}

export async function deletePage(pageId: string): Promise<void> {
  return request<void>(`/pages/${pageId}`, { method: "DELETE" });
}

// ─── Chatbot Connector ──────────────────────────────────────────────────────

export async function getChatAccounts(search?: string): Promise<{ accounts: ChatAccount[] }> {
  const qs = search ? `?search=${encodeURIComponent(search)}` : "";
  return request<{ accounts: ChatAccount[] }>(`/rag/accounts${qs}`);
}

export async function sendChatMessage(body: {
  query: string;
  account_id: string | null;
  history: Array<{ role: string; content: string }>;
  top_k?: number;
}): Promise<{ answer: string; sources: ChatSource[] }> {
  return request<{ answer: string; sources: ChatSource[] }>("/rag/chat", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ─── Analytics Dashboard ────────────────────────────────────────────────────

export async function getAnalyticsData(): Promise<AnalyticsData> {
  return request<AnalyticsData>("/analytics");
}

export async function getRevOpsKpis(): Promise<RevOpsKpiData> {
  return request<RevOpsKpiData>("/analytics/revops-kpis");
}

// ─── Account Journey ────────────────────────────────────────────────────────

export async function getAccountJourney(accountId: string): Promise<{
  account: JourneyAccount;
  timeline: JourneyTimelineNode[];
  stage_counts: Record<string, number>;
}> {
  return request<{
    account: JourneyAccount;
    timeline: JourneyTimelineNode[];
    stage_counts: Record<string, number>;
  }>(`/accounts/${accountId}/journey`);
}
