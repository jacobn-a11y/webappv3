import type { StoryLength, StoryOutline, StoryFormat, StoryTypeInput } from "../../../types/taxonomy";

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
