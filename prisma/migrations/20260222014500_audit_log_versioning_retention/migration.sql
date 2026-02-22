-- AlterTable
ALTER TABLE "audit_logs"
  ADD COLUMN "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "expiresAt" TIMESTAMP(3);

-- Backfill expiration for existing rows (default retention window)
UPDATE "audit_logs"
SET "expiresAt" = "createdAt" + INTERVAL '365 days'
WHERE "expiresAt" IS NULL;

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_expiresAt_idx"
ON "audit_logs"("organizationId", "expiresAt");
