-- Story quality/trust: confidence + lineage + human feedback loop

ALTER TABLE "stories"
  ADD COLUMN IF NOT EXISTS "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS "lineageSummary" JSONB;

ALTER TABLE "high_value_quotes"
  ADD COLUMN IF NOT EXISTS "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
  ADD COLUMN IF NOT EXISTS "lineageMetadata" JSONB;

CREATE TABLE IF NOT EXISTS "story_claim_lineage" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storyId" TEXT NOT NULL,
  "claimType" TEXT NOT NULL,
  "claimText" TEXT NOT NULL,
  "sourceCallId" TEXT,
  "sourceChunkId" TEXT,
  "sourceTimestampMs" INTEGER,
  "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "story_claim_lineage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "story_claim_lineage_organizationId_storyId_createdAt_idx"
  ON "story_claim_lineage"("organizationId", "storyId", "createdAt");
CREATE INDEX IF NOT EXISTS "story_claim_lineage_organizationId_sourceCallId_idx"
  ON "story_claim_lineage"("organizationId", "sourceCallId");

CREATE TABLE IF NOT EXISTS "story_quality_feedback" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storyId" TEXT NOT NULL,
  "submittedByUserId" TEXT,
  "feedbackType" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT,
  "originalValue" TEXT,
  "correctedValue" TEXT,
  "notes" TEXT,
  "applyToPromptTuning" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "story_quality_feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "story_quality_feedback_organizationId_status_createdAt_idx"
  ON "story_quality_feedback"("organizationId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "story_quality_feedback_organizationId_storyId_createdAt_idx"
  ON "story_quality_feedback"("organizationId", "storyId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "story_claim_lineage"
    ADD CONSTRAINT "story_claim_lineage_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "story_claim_lineage"
    ADD CONSTRAINT "story_claim_lineage_storyId_fkey"
    FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "story_quality_feedback"
    ADD CONSTRAINT "story_quality_feedback_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "story_quality_feedback"
    ADD CONSTRAINT "story_quality_feedback_storyId_fkey"
    FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "story_quality_feedback"
    ADD CONSTRAINT "story_quality_feedback_submittedByUserId_fkey"
    FOREIGN KEY ("submittedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
