-- Backfill enum/table prerequisites that older migrations assume already exist.
-- This keeps `prisma migrate deploy` working from a clean database.

-- Ensure enums required by enterprise-control migrations exist.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'integrationprovider') THEN
    CREATE TYPE "IntegrationProvider" AS ENUM ('GRAIN', 'GONG', 'SALESFORCE', 'MERGE_DEV');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'integrationstatus') THEN
    CREATE TYPE "IntegrationStatus" AS ENUM ('PENDING_SETUP', 'ACTIVE', 'ERROR', 'DISABLED');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notificationtype') THEN
    CREATE TYPE "NotificationType" AS ENUM (
      'STORY_COMPLETED',
      'CALL_PROCESSED',
      'CALL_PROCESSING_FAILED',
      'TRIAL_EXPIRING',
      'TRIAL_EXPIRED',
      'PAGE_PUBLISHED',
      'PAGE_NEEDS_APPROVAL',
      'EXPORT_READY',
      'SYSTEM_ALERT'
    );
  END IF;
END
$$;

-- Backfill enum values that exist in the Prisma schema but were never migrated.
ALTER TYPE "CallProvider" ADD VALUE IF NOT EXISTS 'GRAIN';
ALTER TYPE "PermissionType" ADD VALUE IF NOT EXISTS 'MANAGE_ENTITY_RESOLUTION';
ALTER TYPE "PermissionType" ADD VALUE IF NOT EXISTS 'MANAGE_AI_SETTINGS';

-- Create integration configs table required by integration run foreign keys.
CREATE TABLE IF NOT EXISTS "integration_configs" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "provider" "IntegrationProvider" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "credentials" JSONB NOT NULL,
  "settings" JSONB,
  "lastSyncAt" TIMESTAMP(3),
  "syncCursor" TEXT,
  "webhookSecret" TEXT,
  "status" "IntegrationStatus" NOT NULL DEFAULT 'PENDING_SETUP',
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "integration_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "integration_configs_organizationId_provider_key"
  ON "integration_configs"("organizationId", "provider");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'integration_configs_organizationId_fkey'
  ) THEN
    ALTER TABLE "integration_configs"
      ADD CONSTRAINT "integration_configs_organizationId_fkey"
      FOREIGN KEY ("organizationId")
      REFERENCES "organizations"("id")
      ON DELETE RESTRICT
      ON UPDATE CASCADE;
  END IF;
END
$$;

-- Create notifications table before notification enum alterations in later migrations.
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT,
  "type" "NotificationType" NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "metadata" JSONB,
  "read" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "notifications_organizationId_userId_read_idx"
  ON "notifications"("organizationId", "userId", "read");

CREATE INDEX IF NOT EXISTS "notifications_organizationId_createdAt_idx"
  ON "notifications"("organizationId", "createdAt");
