-- Merge safety ledger: previews, moved records, undo support

CREATE TABLE IF NOT EXISTS "account_merge_runs" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "primaryAccountId" TEXT NOT NULL,
  "secondaryAccountId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'COMPLETED',
  "initiatedByUserId" TEXT,
  "undoneByUserId" TEXT,
  "mergePreview" JSONB,
  "movedContactIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "movedCallIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "movedStoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "movedLandingPageIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "undoneAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "account_merge_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "account_merge_runs_organizationId_createdAt_idx"
  ON "account_merge_runs"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "account_merge_runs_organizationId_status_createdAt_idx"
  ON "account_merge_runs"("organizationId", "status", "createdAt");

DO $$ BEGIN
  ALTER TABLE "account_merge_runs"
    ADD CONSTRAINT "account_merge_runs_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
