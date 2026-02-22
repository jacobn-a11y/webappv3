-- ============================================================================
-- Comprehensive migration: backfill ALL schema objects missing from migrations
-- ============================================================================

-- ─── Fix snake_case → camelCase column names in 3 recent migrations ─────────

-- incidents: rename snake_case columns to camelCase
ALTER TABLE "incidents" RENAME COLUMN "organization_id" TO "organizationId";
ALTER TABLE "incidents" RENAME COLUMN "started_at" TO "startedAt";
ALTER TABLE "incidents" RENAME COLUMN "resolved_at" TO "resolvedAt";
ALTER TABLE "incidents" RENAME COLUMN "created_by_user_id" TO "createdByUserId";
ALTER TABLE "incidents" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "incidents" RENAME COLUMN "updated_at" TO "updatedAt";

-- incident_updates: rename snake_case columns to camelCase
ALTER TABLE "incident_updates" RENAME COLUMN "incident_id" TO "incidentId";
ALTER TABLE "incident_updates" RENAME COLUMN "organization_id" TO "organizationId";
ALTER TABLE "incident_updates" RENAME COLUMN "created_by_user_id" TO "createdByUserId";
ALTER TABLE "incident_updates" RENAME COLUMN "created_at" TO "createdAt";

-- support_impersonation_sessions: rename snake_case columns to camelCase
ALTER TABLE "support_impersonation_sessions" RENAME COLUMN "organization_id" TO "organizationId";
ALTER TABLE "support_impersonation_sessions" RENAME COLUMN "actor_user_id" TO "actorUserId";
ALTER TABLE "support_impersonation_sessions" RENAME COLUMN "target_user_id" TO "targetUserId";
ALTER TABLE "support_impersonation_sessions" RENAME COLUMN "revoked_by_user_id" TO "revokedByUserId";
ALTER TABLE "support_impersonation_sessions" RENAME COLUMN "session_token_hash" TO "sessionTokenHash";
ALTER TABLE "support_impersonation_sessions" RENAME COLUMN "last_used_at" TO "lastUsedAt";
ALTER TABLE "support_impersonation_sessions" RENAME COLUMN "started_at" TO "startedAt";
ALTER TABLE "support_impersonation_sessions" RENAME COLUMN "expires_at" TO "expiresAt";
ALTER TABLE "support_impersonation_sessions" RENAME COLUMN "revoked_at" TO "revokedAt";
ALTER TABLE "support_impersonation_sessions" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "support_impersonation_sessions" RENAME COLUMN "updated_at" TO "updatedAt";

-- ─── Missing columns on stories table ───────────────────────────────────────

ALTER TABLE "stories"
  ADD COLUMN IF NOT EXISTS "aiProvider" TEXT,
  ADD COLUMN IF NOT EXISTS "aiModel" TEXT,
  ADD COLUMN IF NOT EXISTS "generatedById" TEXT;

CREATE INDEX IF NOT EXISTS "stories_organizationId_generatedById_idx"
  ON "stories"("organizationId", "generatedById");

-- ─── Missing enums ──────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELED', 'TRIALING');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "UsageMetric" AS ENUM ('TRANSCRIPT_MINUTES', 'CALLS_PROCESSED', 'STORIES_GENERATED', 'PAGES_PUBLISHED', 'AI_TOKENS_USED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MergeCategory" AS ENUM ('CRM', 'RECORDING');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "LinkedAccountStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ERROR', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SetupWizardStep" AS ENUM ('RECORDING_PROVIDER', 'CRM', 'ACCOUNT_SYNC', 'PLAN', 'PERMISSIONS', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AIProviderType" AS ENUM ('OPENAI', 'ANTHROPIC', 'GOOGLE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AITransactionType" AS ENUM ('CREDIT', 'DEBIT', 'REFUND');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AIOperation" AS ENUM ('STORY_GENERATION', 'QUOTE_EXTRACTION', 'TRANSCRIPT_TAGGING', 'RAG_QUERY', 'EMBEDDING');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Also add MANAGE_ENTITY_RESOLUTION and MANAGE_AI_SETTINGS to PermissionType if missing
DO $$ BEGIN
  ALTER TYPE "PermissionType" ADD VALUE IF NOT EXISTS 'MANAGE_ENTITY_RESOLUTION';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "PermissionType" ADD VALUE IF NOT EXISTS 'MANAGE_AI_SETTINGS';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Missing tables ─────────────────────────────────────────────────────────

-- 1. role_profiles
CREATE TABLE IF NOT EXISTS "role_profiles" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isPreset" BOOLEAN NOT NULL DEFAULT false,
  "permissions" "PermissionType"[] DEFAULT ARRAY[]::"PermissionType"[],
  "canAccessAnonymousStories" BOOLEAN NOT NULL DEFAULT true,
  "canGenerateAnonymousStories" BOOLEAN NOT NULL DEFAULT true,
  "canAccessNamedStories" BOOLEAN NOT NULL DEFAULT false,
  "canGenerateNamedStories" BOOLEAN NOT NULL DEFAULT false,
  "defaultAccountScopeType" "AccountScopeType" NOT NULL DEFAULT 'ACCOUNT_LIST',
  "defaultAccountIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "maxTokensPerDay" INTEGER,
  "maxTokensPerMonth" INTEGER,
  "maxRequestsPerDay" INTEGER,
  "maxRequestsPerMonth" INTEGER,
  "maxStoriesPerMonth" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "role_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "role_profiles_organizationId_key_key"
  ON "role_profiles"("organizationId", "key");
ALTER TABLE "role_profiles"
  ADD CONSTRAINT "role_profiles_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. user_role_assignments
CREATE TABLE IF NOT EXISTS "user_role_assignments" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "roleProfileId" TEXT NOT NULL,
  "assignedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_role_assignments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_role_assignments_userId_key"
  ON "user_role_assignments"("userId");
CREATE INDEX IF NOT EXISTS "user_role_assignments_roleProfileId_idx"
  ON "user_role_assignments"("roleProfileId");
ALTER TABLE "user_role_assignments"
  ADD CONSTRAINT "user_role_assignments_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_role_assignments"
  ADD CONSTRAINT "user_role_assignments_roleProfileId_fkey"
  FOREIGN KEY ("roleProfileId") REFERENCES "role_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. subscriptions
CREATE TABLE IF NOT EXISTS "subscriptions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "stripeSubscriptionId" TEXT,
  "pricingModel" "PricingModel" NOT NULL,
  "billingChannel" "BillingChannel" NOT NULL,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "seatCount" INTEGER,
  "seatUnitPrice" INTEGER,
  "meteredUnitPrice" INTEGER,
  "includedUnits" INTEGER,
  "contractValue" INTEGER,
  "billingInterval" "BillingInterval" NOT NULL DEFAULT 'MONTHLY',
  "currentPeriodStart" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_stripeSubscriptionId_key"
  ON "subscriptions"("stripeSubscriptionId");
CREATE INDEX IF NOT EXISTS "subscriptions_organizationId_status_idx"
  ON "subscriptions"("organizationId", "status");
ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. usage_records
CREATE TABLE IF NOT EXISTS "usage_records" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "metric" "UsageMetric" NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "reportedToStripe" BOOLEAN NOT NULL DEFAULT false,
  "stripeRecordId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "usage_records_organizationId_periodStart_idx"
  ON "usage_records"("organizationId", "periodStart");
CREATE INDEX IF NOT EXISTS "usage_records_reportedToStripe_idx"
  ON "usage_records"("reportedToStripe");
ALTER TABLE "usage_records"
  ADD CONSTRAINT "usage_records_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5. api_keys
CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "keyPrefix" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "scopes" TEXT[] DEFAULT ARRAY['rag:query']::TEXT[],
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "replacedByKeyId" TEXT,
  "gracePeriodEndsAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_keyHash_key" ON "api_keys"("keyHash");
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_replacedByKeyId_key" ON "api_keys"("replacedByKeyId");
CREATE INDEX IF NOT EXISTS "api_keys_organizationId_idx" ON "api_keys"("organizationId");
ALTER TABLE "api_keys"
  ADD CONSTRAINT "api_keys_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "api_keys"
  ADD CONSTRAINT "api_keys_replacedByKeyId_fkey"
  FOREIGN KEY ("replacedByKeyId") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 6. api_usage_logs
CREATE TABLE IF NOT EXISTS "api_usage_logs" (
  "id" TEXT NOT NULL,
  "apiKeyId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "statusCode" INTEGER NOT NULL,
  "tokensUsed" INTEGER,
  "responseTimeMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "api_usage_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "api_usage_logs_apiKeyId_createdAt_idx"
  ON "api_usage_logs"("apiKeyId", "createdAt");
CREATE INDEX IF NOT EXISTS "api_usage_logs_organizationId_createdAt_idx"
  ON "api_usage_logs"("organizationId", "createdAt");
ALTER TABLE "api_usage_logs"
  ADD CONSTRAINT "api_usage_logs_apiKeyId_fkey"
  FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 7. linked_accounts
CREATE TABLE IF NOT EXISTS "linked_accounts" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "mergeLinkedAccountId" TEXT NOT NULL,
  "accountToken" TEXT NOT NULL,
  "integrationSlug" TEXT NOT NULL,
  "category" "MergeCategory" NOT NULL,
  "status" "LinkedAccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "lastSyncedAt" TIMESTAMP(3),
  "initialSyncDone" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "linked_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "linked_accounts_mergeLinkedAccountId_key"
  ON "linked_accounts"("mergeLinkedAccountId");
CREATE INDEX IF NOT EXISTS "linked_accounts_organizationId_category_idx"
  ON "linked_accounts"("organizationId", "category");
CREATE INDEX IF NOT EXISTS "linked_accounts_status_idx"
  ON "linked_accounts"("status");
ALTER TABLE "linked_accounts"
  ADD CONSTRAINT "linked_accounts_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 8. org_invites
CREATE TABLE IF NOT EXISTS "org_invites" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
  "invitedById" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "org_invites_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "org_invites_token_key" ON "org_invites"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "org_invites_organizationId_email_key"
  ON "org_invites"("organizationId", "email");
ALTER TABLE "org_invites"
  ADD CONSTRAINT "org_invites_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 9. setup_wizards
CREATE TABLE IF NOT EXISTS "setup_wizards" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "currentStep" "SetupWizardStep" NOT NULL DEFAULT 'RECORDING_PROVIDER',
  "completedAt" TIMESTAMP(3),
  "recordingProvider" "CallProvider",
  "mergeLinkedAccountId" TEXT,
  "crmProvider" "CRMProvider",
  "crmMergeLinkedAccountId" TEXT,
  "syncedAccountCount" INTEGER NOT NULL DEFAULT 0,
  "unresolvedCount" INTEGER NOT NULL DEFAULT 0,
  "syncReviewedAt" TIMESTAMP(3),
  "selectedPlan" "Plan",
  "permissionsConfiguredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "setup_wizards_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "setup_wizards_organizationId_key"
  ON "setup_wizards"("organizationId");
ALTER TABLE "setup_wizards"
  ADD CONSTRAINT "setup_wizards_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 10. story_regen_logs
CREATE TABLE IF NOT EXISTS "story_regen_logs" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "previousStoryId" TEXT,
  "newStoryId" TEXT NOT NULL,
  "callsProcessed" INTEGER NOT NULL,
  "diffSummary" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_regen_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "story_regen_logs_organizationId_createdAt_idx"
  ON "story_regen_logs"("organizationId", "createdAt");
ALTER TABLE "story_regen_logs"
  ADD CONSTRAINT "story_regen_logs_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "story_regen_logs"
  ADD CONSTRAINT "story_regen_logs_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 11. validation_samples
CREATE TABLE IF NOT EXISTS "validation_samples" (
  "id" TEXT NOT NULL,
  "chunkText" TEXT NOT NULL,
  "expectedFunnelStage" TEXT NOT NULL,
  "expectedTopic" TEXT NOT NULL,
  "organizationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "validation_samples_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "validation_samples_expectedFunnelStage_expectedTopic_idx"
  ON "validation_samples"("expectedFunnelStage", "expectedTopic");

-- 12. platform_ai_providers
CREATE TABLE IF NOT EXISTS "platform_ai_providers" (
  "id" TEXT NOT NULL,
  "provider" "AIProviderType" NOT NULL,
  "encryptedApiKey" TEXT NOT NULL,
  "keyIv" TEXT NOT NULL,
  "keyAuthTag" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_ai_providers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "platform_ai_providers_provider_key"
  ON "platform_ai_providers"("provider");

-- 13. platform_model_pricing
CREATE TABLE IF NOT EXISTS "platform_model_pricing" (
  "id" TEXT NOT NULL,
  "platformProviderId" TEXT NOT NULL,
  "provider" "AIProviderType" NOT NULL,
  "modelId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "inputCostPer1kTokens" DOUBLE PRECISION NOT NULL,
  "outputCostPer1kTokens" DOUBLE PRECISION NOT NULL,
  "isAvailable" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_model_pricing_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "platform_model_pricing_provider_modelId_key"
  ON "platform_model_pricing"("provider", "modelId");
ALTER TABLE "platform_model_pricing"
  ADD CONSTRAINT "platform_model_pricing_platformProviderId_fkey"
  FOREIGN KEY ("platformProviderId") REFERENCES "platform_ai_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 14. org_ai_settings
CREATE TABLE IF NOT EXISTS "org_ai_settings" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "defaultProvider" TEXT,
  "defaultModel" TEXT,
  "perSeatTokenBudgetPerMonth" INTEGER,
  "perSeatStoriesPerMonth" INTEGER,
  "maxStoriesPerMonth" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "org_ai_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "org_ai_settings_organizationId_key"
  ON "org_ai_settings"("organizationId");
ALTER TABLE "org_ai_settings"
  ADD CONSTRAINT "org_ai_settings_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 15. org_ai_role_defaults
CREATE TABLE IF NOT EXISTS "org_ai_role_defaults" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "allowedProviders" "AIProviderType"[] DEFAULT ARRAY[]::"AIProviderType"[],
  "allowedModels" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "maxTokensPerDay" INTEGER,
  "maxTokensPerMonth" INTEGER,
  "maxStoriesPerMonth" INTEGER,
  "maxRequestsPerDay" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "org_ai_role_defaults_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "org_ai_role_defaults_organizationId_role_key"
  ON "org_ai_role_defaults"("organizationId", "role");
ALTER TABLE "org_ai_role_defaults"
  ADD CONSTRAINT "org_ai_role_defaults_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 16. user_ai_access
CREATE TABLE IF NOT EXISTS "user_ai_access" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "allowedProviders" "AIProviderType"[] DEFAULT ARRAY[]::"AIProviderType"[],
  "allowedModels" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "deniedProviders" "AIProviderType"[] DEFAULT ARRAY[]::"AIProviderType"[],
  "deniedModels" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "grantedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_ai_access_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_ai_access_organizationId_userId_key"
  ON "user_ai_access"("organizationId", "userId");
ALTER TABLE "user_ai_access"
  ADD CONSTRAINT "user_ai_access_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 17. ai_provider_configs
CREATE TABLE IF NOT EXISTS "ai_provider_configs" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "provider" "AIProviderType" NOT NULL,
  "encryptedApiKey" TEXT NOT NULL,
  "keyIv" TEXT NOT NULL,
  "keyAuthTag" TEXT NOT NULL,
  "displayName" TEXT,
  "defaultModel" TEXT,
  "embeddingModel" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_provider_configs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_provider_configs_organizationId_provider_key"
  ON "ai_provider_configs"("organizationId", "provider");
ALTER TABLE "ai_provider_configs"
  ADD CONSTRAINT "ai_provider_configs_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 18. user_ai_balances
CREATE TABLE IF NOT EXISTS "user_ai_balances" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "balanceCents" INTEGER NOT NULL DEFAULT 0,
  "lifetimeSpentCents" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_ai_balances_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_ai_balances_organizationId_userId_key"
  ON "user_ai_balances"("organizationId", "userId");
ALTER TABLE "user_ai_balances"
  ADD CONSTRAINT "user_ai_balances_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_ai_balances"
  ADD CONSTRAINT "user_ai_balances_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 19. user_ai_transactions
CREATE TABLE IF NOT EXISTS "user_ai_transactions" (
  "id" TEXT NOT NULL,
  "balanceId" TEXT NOT NULL,
  "type" "AITransactionType" NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "usageRecordId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_ai_transactions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "user_ai_transactions_balanceId_createdAt_idx"
  ON "user_ai_transactions"("balanceId", "createdAt");
ALTER TABLE "user_ai_transactions"
  ADD CONSTRAINT "user_ai_transactions_balanceId_fkey"
  FOREIGN KEY ("balanceId") REFERENCES "user_ai_balances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 20. ai_usage_records
CREATE TABLE IF NOT EXISTS "ai_usage_records" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "operation" "AIOperation" NOT NULL,
  "inputTokens" INTEGER NOT NULL,
  "outputTokens" INTEGER NOT NULL,
  "totalTokens" INTEGER NOT NULL,
  "costCents" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_usage_records_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_usage_records_organizationId_userId_createdAt_idx"
  ON "ai_usage_records"("organizationId", "userId", "createdAt");
CREATE INDEX IF NOT EXISTS "ai_usage_records_organizationId_createdAt_idx"
  ON "ai_usage_records"("organizationId", "createdAt");
ALTER TABLE "ai_usage_records"
  ADD CONSTRAINT "ai_usage_records_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_usage_records"
  ADD CONSTRAINT "ai_usage_records_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 21. ai_usage_limits
CREATE TABLE IF NOT EXISTS "ai_usage_limits" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT,
  "maxTokensPerDay" INTEGER,
  "maxTokensPerMonth" INTEGER,
  "maxRequestsPerDay" INTEGER,
  "maxRequestsPerMonth" INTEGER,
  "maxStoriesPerMonth" INTEGER,
  "warningThresholdPct" INTEGER NOT NULL DEFAULT 80,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_usage_limits_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_usage_limits_organizationId_userId_key"
  ON "ai_usage_limits"("organizationId", "userId");
ALTER TABLE "ai_usage_limits"
  ADD CONSTRAINT "ai_usage_limits_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_usage_limits"
  ADD CONSTRAINT "ai_usage_limits_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 22. ai_usage_notifications
CREATE TABLE IF NOT EXISTS "ai_usage_notifications" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "limitType" TEXT NOT NULL,
  "thresholdPct" INTEGER NOT NULL,
  "currentUsage" INTEGER NOT NULL,
  "limitValue" INTEGER NOT NULL,
  "message" TEXT NOT NULL,
  "acknowledged" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_usage_notifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_usage_notifications_userId_acknowledged_createdAt_idx"
  ON "ai_usage_notifications"("userId", "acknowledged", "createdAt");
ALTER TABLE "ai_usage_notifications"
  ADD CONSTRAINT "ai_usage_notifications_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_usage_notifications"
  ADD CONSTRAINT "ai_usage_notifications_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
