-- vNext quote library + transcript attribution + weekly AI limit extensions

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'QuoteAttributionDisplay') THEN
    CREATE TYPE "QuoteAttributionDisplay" AS ENUM (
      'DISPLAYED',
      'HIDDEN',
      'OBFUSCATED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'PermissionType'
      AND e.enumlabel = 'VIEW_RAW_TRANSCRIPTS'
  ) THEN
    ALTER TYPE "PermissionType" ADD VALUE 'VIEW_RAW_TRANSCRIPTS';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'QuoteAuditAction') THEN
    CREATE TYPE "QuoteAuditAction" AS ENUM (
      'CREATE',
      'AUTO_EXTRACT',
      'SAVE_FROM_TRANSCRIPT',
      'PROMOTE',
      'DEMOTE',
      'STAR',
      'UNSTAR'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'QuoteTier') THEN
    CREATE TYPE "QuoteTier" AS ENUM (
      'AUTO',
      'CURATED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'QuoteCreatedByType') THEN
    CREATE TYPE "QuoteCreatedByType" AS ENUM (
      'SYSTEM',
      'USER'
    );
  END IF;
END $$;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "quoteAttributionDisplay" "QuoteAttributionDisplay" NOT NULL DEFAULT 'DISPLAYED';

ALTER TABLE "ai_usage_limits"
  ADD COLUMN IF NOT EXISTS "maxTokensPerWeek" INTEGER,
  ADD COLUMN IF NOT EXISTS "maxRequestsPerWeek" INTEGER,
  ADD COLUMN IF NOT EXISTS "maxStoriesPerWeek" INTEGER;

CREATE TABLE IF NOT EXISTS "quotes" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "storyId" TEXT,
  "callId" TEXT NOT NULL,
  "quoteText" TEXT NOT NULL,
  "sourceChunkId" TEXT NOT NULL,
  "sourceStartMs" INTEGER,
  "sourceEndMs" INTEGER,
  "tier" "QuoteTier" NOT NULL DEFAULT 'AUTO',
  "createdByType" "QuoteCreatedByType" NOT NULL DEFAULT 'SYSTEM',
  "createdByUserId" TEXT,
  "curatedByUserId" TEXT,
  "curatedAt" TIMESTAMP(3),
  "curationNote" TEXT,
  "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "quote_stars" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quote_stars_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "quote_audit_events" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "action" "QuoteAuditAction" NOT NULL,
  "previousTier" "QuoteTier",
  "newTier" "QuoteTier",
  "metadata" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quote_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "quotes_organizationId_accountId_tier_createdAt_idx"
  ON "quotes"("organizationId", "accountId", "tier", "createdAt");

CREATE INDEX IF NOT EXISTS "quotes_organizationId_callId_createdAt_idx"
  ON "quotes"("organizationId", "callId", "createdAt");

CREATE INDEX IF NOT EXISTS "quotes_organizationId_sourceChunkId_idx"
  ON "quotes"("organizationId", "sourceChunkId");

CREATE INDEX IF NOT EXISTS "quote_stars_organizationId_userId_createdAt_idx"
  ON "quote_stars"("organizationId", "userId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "quote_stars_userId_quoteId_key"
  ON "quote_stars"("userId", "quoteId");

CREATE INDEX IF NOT EXISTS "quote_audit_events_organizationId_quoteId_occurredAt_idx"
  ON "quote_audit_events"("organizationId", "quoteId", "occurredAt");

CREATE INDEX IF NOT EXISTS "quote_audit_events_organizationId_actorUserId_occurredAt_idx"
  ON "quote_audit_events"("organizationId", "actorUserId", "occurredAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quotes_organizationId_fkey'
  ) THEN
    ALTER TABLE "quotes"
      ADD CONSTRAINT "quotes_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quotes_accountId_fkey'
  ) THEN
    ALTER TABLE "quotes"
      ADD CONSTRAINT "quotes_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quotes_storyId_fkey'
  ) THEN
    ALTER TABLE "quotes"
      ADD CONSTRAINT "quotes_storyId_fkey"
      FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quotes_callId_fkey'
  ) THEN
    ALTER TABLE "quotes"
      ADD CONSTRAINT "quotes_callId_fkey"
      FOREIGN KEY ("callId") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quotes_createdByUserId_fkey'
  ) THEN
    ALTER TABLE "quotes"
      ADD CONSTRAINT "quotes_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quotes_curatedByUserId_fkey'
  ) THEN
    ALTER TABLE "quotes"
      ADD CONSTRAINT "quotes_curatedByUserId_fkey"
      FOREIGN KEY ("curatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quote_stars_organizationId_fkey'
  ) THEN
    ALTER TABLE "quote_stars"
      ADD CONSTRAINT "quote_stars_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quote_stars_userId_fkey'
  ) THEN
    ALTER TABLE "quote_stars"
      ADD CONSTRAINT "quote_stars_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quote_stars_quoteId_fkey'
  ) THEN
    ALTER TABLE "quote_stars"
      ADD CONSTRAINT "quote_stars_quoteId_fkey"
      FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quote_audit_events_organizationId_fkey'
  ) THEN
    ALTER TABLE "quote_audit_events"
      ADD CONSTRAINT "quote_audit_events_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quote_audit_events_quoteId_fkey'
  ) THEN
    ALTER TABLE "quote_audit_events"
      ADD CONSTRAINT "quote_audit_events_quoteId_fkey"
      FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quote_audit_events_actorUserId_fkey'
  ) THEN
    ALTER TABLE "quote_audit_events"
      ADD CONSTRAINT "quote_audit_events_actorUserId_fkey"
      FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
