import type { StoryContextSettings } from "./types";
import { request } from "./http";

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

export interface AIProviderCatalog {
  org_providers: Array<{
    provider: string;
    display_name: string;
    default_model: string;
    is_default: boolean;
    is_active: boolean;
    available_models: string[];
  }>;
  platform_models: Array<{
    provider: string;
    model: string;
  }>;
  all_providers: Array<{
    provider: string;
    models: string[];
    default_model: string;
  }>;
  user_access: {
    allowedProviders: string[];
    allowedModels: string[];
  };
}

export interface AIUsageSummaryResponse {
  period_start: string;
  users: Array<{
    user_id: string;
    user_name: string | null;
    user_email: string;
    total_tokens: number;
    total_cost_cents: number;
    total_requests: number;
  }>;
}

export interface AIUsageRecordsResponse {
  records: Array<{
    id: string;
    user_id: string;
    provider: string;
    model: string;
    operation: string;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cost_cents: number;
    created_at: string;
  }>;
}

export interface AILimitsResponse {
  limits: Array<{
    id: string;
    user: { id: string; name: string | null; email: string } | null;
    is_org_default: boolean;
    max_tokens_per_week: number | null;
    max_tokens_per_day: number | null;
    max_tokens_per_month: number | null;
    max_requests_per_week: number | null;
    max_requests_per_day: number | null;
    max_requests_per_month: number | null;
    max_stories_per_week: number | null;
    max_stories_per_month: number | null;
    warning_threshold_pct: number;
    created_at: string;
    updated_at: string;
  }>;
}

export interface AIBudgetAlertsSettings {
  mode: "TOKENS" | "COST_CENTS";
  monthly_budget_tokens: number | null;
  monthly_budget_cents: number | null;
  thresholds: number[];
  block_at_100: boolean;
}

export async function getAvailableAIProviders(): Promise<AIProviderCatalog> {
  return request<AIProviderCatalog>("/ai/providers");
}

export async function getAIUsageSummary(): Promise<AIUsageSummaryResponse> {
  return request<AIUsageSummaryResponse>("/ai/admin/usage/summary");
}

export async function getAIUsageRecords(params?: {
  user_id?: string;
  days?: number;
}): Promise<AIUsageRecordsResponse> {
  const qs = new URLSearchParams();
  if (params?.user_id) qs.set("user_id", params.user_id);
  if (params?.days != null) qs.set("days", String(params.days));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return request<AIUsageRecordsResponse>(`/ai/admin/usage${suffix}`);
}

export async function getAILimits(): Promise<AILimitsResponse> {
  return request<AILimitsResponse>("/ai/admin/limits");
}

export async function saveAILimit(body: {
  user_id?: string;
  max_tokens_per_week?: number | null;
  max_tokens_per_day?: number | null;
  max_tokens_per_month?: number | null;
  max_requests_per_week?: number | null;
  max_requests_per_day?: number | null;
  max_requests_per_month?: number | null;
  max_stories_per_week?: number | null;
  max_stories_per_month?: number | null;
  warning_threshold_pct?: number;
}): Promise<{ saved: boolean }> {
  return request<{ saved: boolean }>("/ai/admin/limits", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deleteAILimit(userId?: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/ai/admin/limits/${encodeURIComponent(userId ?? "org_default")}`, {
    method: "DELETE",
  });
}

export async function getAIBudgetAlertsSettings(): Promise<AIBudgetAlertsSettings> {
  return request<AIBudgetAlertsSettings>("/ai/admin/budget-alerts");
}

export async function saveAIBudgetAlertsSettings(body: AIBudgetAlertsSettings): Promise<{
  saved: boolean;
  settings: AIBudgetAlertsSettings;
}> {
  return request<{ saved: boolean; settings: AIBudgetAlertsSettings }>(
    "/ai/admin/budget-alerts",
    {
      method: "PUT",
      body: JSON.stringify(body),
    }
  );
}
