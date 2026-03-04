import type {
  AnalyticsData,
  DataQualityOverview,
  RevOpsKpiData,
  SellerAdoptionEventType,
  SellerAdoptionMetrics,
  StoryLineageResponse,
  StoryQualityFeedbackRow,
} from "./types";
import { request } from "./http";

export async function getAnalyticsData(): Promise<AnalyticsData> {
  return request<AnalyticsData>("/analytics");
}

export async function getRevOpsKpis(): Promise<RevOpsKpiData> {
  return request<RevOpsKpiData>("/analytics/revops-kpis");
}

export async function trackSellerAdoptionEvent(body: {
  event_type: SellerAdoptionEventType;
  flow_id: string;
  step?: string;
  account_id?: string;
  story_id?: string;
  stage_preset?: string;
  visibility_mode?: "ANONYMOUS" | "NAMED";
  action_name?: string;
  duration_ms?: number;
  metadata?: Record<string, unknown>;
}): Promise<{ accepted: boolean }> {
  return request<{ accepted: boolean }>("/dashboard/seller-adoption/events", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getSellerAdoptionMetrics(
  windowDays = 30
): Promise<SellerAdoptionMetrics> {
  return request<SellerAdoptionMetrics>(
    `/dashboard/seller-adoption/metrics?window_days=${windowDays}`
  );
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
