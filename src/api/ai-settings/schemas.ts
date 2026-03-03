import { z } from "zod";

export const UpsertProviderSchema = z.object({
  provider: z.enum(["openai", "anthropic", "google"]),
  api_key: z.string().min(1, "API key is required"),
  display_name: z.string().optional(),
  default_model: z.string().optional(),
  embedding_model: z.string().optional(),
  is_default: z.boolean().optional(),
});

export const ValidateKeySchema = z.object({
  provider: z.enum(["openai", "anthropic", "google"]),
  api_key: z.string().min(1),
});

export const SetLimitSchema = z.object({
  user_id: z.string().optional(),
  max_tokens_per_day: z.number().int().min(0).nullable().optional(),
  max_tokens_per_month: z.number().int().min(0).nullable().optional(),
  max_requests_per_day: z.number().int().min(0).nullable().optional(),
  max_requests_per_month: z.number().int().min(0).nullable().optional(),
  max_stories_per_month: z.number().int().min(0).nullable().optional(),
  warning_threshold_pct: z.number().int().min(1).max(99).optional(),
});

export const SetUserAccessSchema = z.object({
  user_id: z.string().min(1),
  allowed_providers: z.array(z.enum(["OPENAI", "ANTHROPIC", "GOOGLE"])).optional(),
  allowed_models: z.array(z.string()).optional(),
  denied_providers: z.array(z.enum(["OPENAI", "ANTHROPIC", "GOOGLE"])).optional(),
  denied_models: z.array(z.string()).optional(),
});

export const SetRoleDefaultSchema = z.object({
  role: z.enum(["MEMBER", "VIEWER"]),
  allowed_providers: z.array(z.enum(["OPENAI", "ANTHROPIC", "GOOGLE"])).optional(),
  allowed_models: z.array(z.string()).optional(),
  max_tokens_per_day: z.number().int().min(0).nullable().optional(),
  max_tokens_per_month: z.number().int().min(0).nullable().optional(),
  max_stories_per_month: z.number().int().min(0).nullable().optional(),
  max_requests_per_day: z.number().int().min(0).nullable().optional(),
});

export const AddBalanceSchema = z.object({
  user_id: z.string().min(1),
  amount_cents: z.number().int().min(1),
  description: z.string().optional(),
});

export const OrgAISettingsSchema = z.object({
  default_provider: z.string().optional().nullable(),
  default_model: z.string().optional().nullable(),
  per_seat_token_budget_per_month: z.number().int().min(0).optional().nullable(),
  per_seat_stories_per_month: z.number().int().min(0).optional().nullable(),
  max_stories_per_month: z.number().int().min(0).optional().nullable(),
});
