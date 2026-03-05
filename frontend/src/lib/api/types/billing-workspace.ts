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

