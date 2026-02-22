-- AlterTable
ALTER TABLE "org_settings" ADD COLUMN     "securityPolicy" JSONB;

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_ip_allowlist_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cidr" TEXT NOT NULL,
    "label" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_ip_allowlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scim_provisioning" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "tokenHash" TEXT,
    "endpointSecretHint" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scim_provisioning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scim_identities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scim_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "reviewerUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestPayload" JSONB,
    "reviewNotes" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integrationConfigId" TEXT,
    "provider" "IntegrationProvider" NOT NULL,
    "runType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_sessionToken_key" ON "user_sessions"("sessionToken");

-- CreateIndex
CREATE INDEX "user_sessions_organizationId_userId_revokedAt_idx" ON "user_sessions"("organizationId", "userId", "revokedAt");

-- CreateIndex
CREATE INDEX "user_sessions_organizationId_expiresAt_idx" ON "user_sessions"("organizationId", "expiresAt");

-- CreateIndex
CREATE INDEX "org_ip_allowlist_entries_organizationId_enabled_idx" ON "org_ip_allowlist_entries"("organizationId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "org_ip_allowlist_entries_organizationId_cidr_key" ON "org_ip_allowlist_entries"("organizationId", "cidr");

-- CreateIndex
CREATE UNIQUE INDEX "scim_provisioning_organizationId_key" ON "scim_provisioning"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "scim_identities_userId_key" ON "scim_identities"("userId");

-- CreateIndex
CREATE INDEX "scim_identities_organizationId_active_idx" ON "scim_identities"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "scim_identities_organizationId_externalId_key" ON "scim_identities"("organizationId", "externalId");

-- CreateIndex
CREATE INDEX "approval_requests_organizationId_status_createdAt_idx" ON "approval_requests"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "approval_requests_organizationId_targetType_targetId_idx" ON "approval_requests"("organizationId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "integration_runs_organizationId_provider_startedAt_idx" ON "integration_runs"("organizationId", "provider", "startedAt");

-- CreateIndex
CREATE INDEX "integration_runs_organizationId_status_startedAt_idx" ON "integration_runs"("organizationId", "status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "integration_runs_organizationId_idempotencyKey_key" ON "integration_runs"("organizationId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_ip_allowlist_entries" ADD CONSTRAINT "org_ip_allowlist_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scim_provisioning" ADD CONSTRAINT "scim_provisioning_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scim_identities" ADD CONSTRAINT "scim_identities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scim_identities" ADD CONSTRAINT "scim_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_runs" ADD CONSTRAINT "integration_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_runs" ADD CONSTRAINT "integration_runs_integrationConfigId_fkey" FOREIGN KEY ("integrationConfigId") REFERENCES "integration_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

