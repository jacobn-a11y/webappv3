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

export interface PublishPiiScanResult {
  blocking: boolean;
  total_detections: number;
  by_type: Record<string, number>;
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
  asset_type: string;
  asset_id: string;
  title: string;
  account_name: string | null;
  request_type: string;
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

export interface MyApprovalRequestRow {
  id: string;
  status: string;
  asset_type: string;
  asset_id: string;
  title: string;
  account_name: string | null;
  request_type: string;
  created_at: string;
  reviewed_at: string | null;
  review_notes: string | null;
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
}

export interface ApprovalSlackSettings {
  enabled: boolean;
  approver_webhook_url_masked: string | null;
  creator_webhook_url_masked: string | null;
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
