-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE_TRIAL', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "CallProvider" AS ENUM ('GONG', 'CHORUS', 'ZOOM', 'GOOGLE_MEET', 'TEAMS', 'FIREFLIES', 'DIALPAD', 'AIRCALL', 'RINGCENTRAL', 'SALESLOFT', 'OUTREACH', 'OTHER');

-- CreateEnum
CREATE TYPE "FunnelStage" AS ENUM ('TOFU', 'MOFU', 'BOFU', 'POST_SALE', 'INTERNAL', 'VERTICAL');

-- CreateEnum
CREATE TYPE "SalesforceEventType" AS ENUM ('OPPORTUNITY_CREATED', 'OPPORTUNITY_STAGE_CHANGE', 'CLOSED_WON', 'CLOSED_LOST', 'CONTACT_CREATED', 'LEAD_CONVERTED', 'TASK_COMPLETED', 'NOTE_ADDED');

-- CreateEnum
CREATE TYPE "StoryType" AS ENUM ('FULL_JOURNEY', 'ONBOARDING', 'ROI_ANALYSIS', 'COMPETITIVE_WIN', 'EXPANSION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PageVisibility" AS ENUM ('PRIVATE', 'SHARED_WITH_LINK');

-- CreateEnum
CREATE TYPE "PageStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PermissionType" AS ENUM ('CREATE_LANDING_PAGE', 'PUBLISH_LANDING_PAGE', 'PUBLISH_NAMED_LANDING_PAGE', 'EDIT_ANY_LANDING_PAGE', 'DELETE_ANY_LANDING_PAGE', 'MANAGE_PERMISSIONS', 'VIEW_ANALYTICS');

-- CreateEnum
CREATE TYPE "AccountScopeType" AS ENUM ('ALL_ACCOUNTS', 'SINGLE_ACCOUNT', 'ACCOUNT_LIST', 'CRM_REPORT');

-- CreateEnum
CREATE TYPE "CRMProvider" AS ENUM ('SALESFORCE', 'HUBSPOT');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workosOrgId" TEXT,
    "stripeCustomerId" TEXT,
    "plan" "Plan" NOT NULL DEFAULT 'FREE_TRIAL',
    "trialEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "workosUserId" TEXT,
    "organizationId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "domain" TEXT,
    "salesforceId" TEXT,
    "hubspotId" TEXT,
    "mergeAccountId" TEXT,
    "industry" TEXT,
    "employeeCount" INTEGER,
    "annualRevenue" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_domains" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,

    CONSTRAINT "account_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailDomain" TEXT NOT NULL,
    "name" TEXT,
    "title" TEXT,
    "phone" TEXT,
    "salesforceId" TEXT,
    "hubspotId" TEXT,
    "mergeContactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calls" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT,
    "title" TEXT,
    "provider" "CallProvider" NOT NULL,
    "mergeRecordingId" TEXT,
    "externalId" TEXT,
    "recordingUrl" TEXT,
    "duration" INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_participants" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "contactId" TEXT,
    "email" TEXT,
    "name" TEXT,
    "isHost" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "call_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcripts" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "fullText" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "wordCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transcripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcript_chunks" (
    "id" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "speaker" TEXT,
    "startMs" INTEGER,
    "endMs" INTEGER,
    "embeddingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transcript_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_tags" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "funnelStage" "FunnelStage" NOT NULL,
    "topic" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chunk_tags" (
    "id" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "funnelStage" "FunnelStage" NOT NULL,
    "topic" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chunk_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salesforce_events" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "eventType" "SalesforceEventType" NOT NULL,
    "stageName" TEXT,
    "opportunityId" TEXT,
    "amount" DOUBLE PRECISION,
    "closeDate" TIMESTAMP(3),
    "description" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salesforce_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stories" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "markdownBody" TEXT NOT NULL,
    "storyType" "StoryType" NOT NULL,
    "funnelStages" "FunnelStage"[],
    "filterTags" TEXT[],
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "high_value_quotes" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "speaker" TEXT,
    "quoteText" TEXT NOT NULL,
    "context" TEXT,
    "metricType" TEXT,
    "metricValue" TEXT,
    "callId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "high_value_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landing_pages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "editableBody" TEXT NOT NULL,
    "scrubbedBody" TEXT NOT NULL,
    "heroImageUrl" TEXT,
    "calloutBoxes" JSONB,
    "totalCallHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "visibility" "PageVisibility" NOT NULL DEFAULT 'PRIVATE',
    "status" "PageStatus" NOT NULL DEFAULT 'DRAFT',
    "password" TEXT,
    "includeCompanyName" BOOLEAN NOT NULL DEFAULT false,
    "noIndex" BOOLEAN NOT NULL DEFAULT true,
    "customCss" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landing_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landing_page_edits" (
    "id" TEXT NOT NULL,
    "landingPageId" TEXT NOT NULL,
    "editedById" TEXT NOT NULL,
    "previousBody" TEXT NOT NULL,
    "newBody" TEXT NOT NULL,
    "editSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "landing_page_edits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "landingPagesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultPageVisibility" "PageVisibility" NOT NULL DEFAULT 'PRIVATE',
    "requireApprovalToPublish" BOOLEAN NOT NULL DEFAULT false,
    "allowedPublishers" "UserRole"[] DEFAULT ARRAY['OWNER', 'ADMIN']::"UserRole"[],
    "maxPagesPerUser" INTEGER,
    "companyNameReplacements" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_permissions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" "PermissionType" NOT NULL,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_account_access" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scopeType" "AccountScopeType" NOT NULL,
    "accountId" TEXT,
    "crmReportId" TEXT,
    "crmProvider" "CRMProvider",
    "crmReportName" TEXT,
    "cachedAccountIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastSyncedAt" TIMESTAMP(3),
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_account_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_workosOrgId_key" ON "organizations"("workosOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_stripeCustomerId_key" ON "organizations"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_workosUserId_key" ON "users"("workosUserId");

-- CreateIndex
CREATE INDEX "users_organizationId_idx" ON "users"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_organizationId_domain_key" ON "accounts"("organizationId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_organizationId_salesforceId_key" ON "accounts"("organizationId", "salesforceId");

-- CreateIndex
CREATE INDEX "accounts_organizationId_normalizedName_idx" ON "accounts"("organizationId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "account_domains_accountId_domain_key" ON "account_domains"("accountId", "domain");

-- CreateIndex
CREATE INDEX "account_domains_domain_idx" ON "account_domains"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_accountId_email_key" ON "contacts"("accountId", "email");

-- CreateIndex
CREATE INDEX "contacts_emailDomain_idx" ON "contacts"("emailDomain");

-- CreateIndex
CREATE UNIQUE INDEX "calls_mergeRecordingId_key" ON "calls"("mergeRecordingId");

-- CreateIndex
CREATE INDEX "calls_organizationId_accountId_idx" ON "calls"("organizationId", "accountId");

-- CreateIndex
CREATE INDEX "calls_organizationId_occurredAt_idx" ON "calls"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "call_participants_callId_idx" ON "call_participants"("callId");

-- CreateIndex
CREATE INDEX "call_participants_email_idx" ON "call_participants"("email");

-- CreateIndex
CREATE UNIQUE INDEX "transcripts_callId_key" ON "transcripts"("callId");

-- CreateIndex
CREATE UNIQUE INDEX "transcript_chunks_transcriptId_chunkIndex_key" ON "transcript_chunks"("transcriptId", "chunkIndex");

-- CreateIndex
CREATE UNIQUE INDEX "call_tags_callId_funnelStage_topic_key" ON "call_tags"("callId", "funnelStage", "topic");

-- CreateIndex
CREATE INDEX "call_tags_funnelStage_idx" ON "call_tags"("funnelStage");

-- CreateIndex
CREATE UNIQUE INDEX "chunk_tags_chunkId_funnelStage_topic_key" ON "chunk_tags"("chunkId", "funnelStage", "topic");

-- CreateIndex
CREATE INDEX "salesforce_events_accountId_eventType_idx" ON "salesforce_events"("accountId", "eventType");

-- CreateIndex
CREATE INDEX "stories_organizationId_accountId_idx" ON "stories"("organizationId", "accountId");

-- CreateIndex
CREATE INDEX "high_value_quotes_storyId_idx" ON "high_value_quotes"("storyId");

-- CreateIndex
CREATE UNIQUE INDEX "landing_pages_slug_key" ON "landing_pages"("slug");

-- CreateIndex
CREATE INDEX "landing_pages_organizationId_status_idx" ON "landing_pages"("organizationId", "status");

-- CreateIndex
CREATE INDEX "landing_pages_slug_idx" ON "landing_pages"("slug");

-- CreateIndex
CREATE INDEX "landing_page_edits_landingPageId_idx" ON "landing_page_edits"("landingPageId");

-- CreateIndex
CREATE UNIQUE INDEX "org_settings_organizationId_key" ON "org_settings"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "user_permissions_userId_permission_key" ON "user_permissions"("userId", "permission");

-- CreateIndex
CREATE INDEX "user_account_access_userId_organizationId_idx" ON "user_account_access"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "user_account_access_userId_accountId_idx" ON "user_account_access"("userId", "accountId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_domains" ADD CONSTRAINT "account_domains_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_participants" ADD CONSTRAINT "call_participants_callId_fkey" FOREIGN KEY ("callId") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_participants" ADD CONSTRAINT "call_participants_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_callId_fkey" FOREIGN KEY ("callId") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcript_chunks" ADD CONSTRAINT "transcript_chunks_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "transcripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_tags" ADD CONSTRAINT "call_tags_callId_fkey" FOREIGN KEY ("callId") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chunk_tags" ADD CONSTRAINT "chunk_tags_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "transcript_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salesforce_events" ADD CONSTRAINT "salesforce_events_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "high_value_quotes" ADD CONSTRAINT "high_value_quotes_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landing_page_edits" ADD CONSTRAINT "landing_page_edits_landingPageId_fkey" FOREIGN KEY ("landingPageId") REFERENCES "landing_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landing_page_edits" ADD CONSTRAINT "landing_page_edits_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_account_access" ADD CONSTRAINT "user_account_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_account_access" ADD CONSTRAINT "user_account_access_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
