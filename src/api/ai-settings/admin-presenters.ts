import { PROVIDER_MODELS, type AIProviderName } from "../../services/ai-client.js";

interface ProviderConfigViewModel {
  id: string;
  provider: string;
  displayName: string | null;
  defaultModel: string | null;
  embeddingModel: string | null;
  isDefault: boolean;
  isActive: boolean;
  apiKeyPreview: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function presentProviderConfig(config: ProviderConfigViewModel) {
  return {
    id: config.id,
    provider: config.provider,
    display_name: config.displayName,
    default_model: config.defaultModel,
    embedding_model: config.embeddingModel,
    is_default: config.isDefault,
    is_active: config.isActive,
    api_key_preview: config.apiKeyPreview,
    available_models: PROVIDER_MODELS[config.provider as AIProviderName] ?? [],
    created_at: config.createdAt,
    updated_at: config.updatedAt,
  };
}

interface UsageLimitViewModel {
  id: string;
  userId: string | null;
  user: { id: string; name: string | null; email: string } | null;
  maxTokensPerWeek: number | null;
  maxTokensPerDay: number | null;
  maxTokensPerMonth: number | null;
  maxRequestsPerWeek: number | null;
  maxRequestsPerDay: number | null;
  maxRequestsPerMonth: number | null;
  maxStoriesPerWeek: number | null;
  maxStoriesPerMonth: number | null;
  warningThresholdPct: number;
  createdAt: Date;
  updatedAt: Date;
}

export function presentUsageLimit(limit: UsageLimitViewModel) {
  return {
    id: limit.id,
    user: limit.user
      ? { id: limit.user.id, name: limit.user.name, email: limit.user.email }
      : null,
    is_org_default: !limit.userId,
    max_tokens_per_week: limit.maxTokensPerWeek,
    max_tokens_per_day: limit.maxTokensPerDay,
    max_tokens_per_month: limit.maxTokensPerMonth,
    max_requests_per_week: limit.maxRequestsPerWeek,
    max_requests_per_day: limit.maxRequestsPerDay,
    max_requests_per_month: limit.maxRequestsPerMonth,
    max_stories_per_week: limit.maxStoriesPerWeek,
    max_stories_per_month: limit.maxStoriesPerMonth,
    warning_threshold_pct: limit.warningThresholdPct,
    created_at: limit.createdAt,
    updated_at: limit.updatedAt,
  };
}

interface UsageRecordViewModel {
  id: string;
  userId: string;
  provider: string;
  model: string;
  operation: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCents: number;
  createdAt: Date;
}

export function presentUsageRecord(record: UsageRecordViewModel) {
  return {
    id: record.id,
    user_id: record.userId,
    provider: record.provider,
    model: record.model,
    operation: record.operation,
    input_tokens: record.inputTokens,
    output_tokens: record.outputTokens,
    total_tokens: record.totalTokens,
    cost_cents: record.costCents,
    created_at: record.createdAt.toISOString(),
  };
}

interface UsageSummaryBucketViewModel {
  userId: string;
  userName: string | null;
  userEmail: string | null;
  totalTokens: number;
  totalCostCents: number;
  totalRequests: number;
}

export function presentUsageSummaryBucket(bucket: UsageSummaryBucketViewModel) {
  return {
    user_id: bucket.userId,
    user_name: bucket.userName,
    user_email: bucket.userEmail,
    total_tokens: bucket.totalTokens,
    total_cost_cents: bucket.totalCostCents,
    total_requests: bucket.totalRequests,
  };
}
