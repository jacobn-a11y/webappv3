-- CreateEnum
CREATE TYPE "MatchMethod" AS ENUM ('NONE', 'EMAIL_DOMAIN', 'FUZZY_NAME', 'MANUAL');

-- AlterTable
ALTER TABLE "calls"
  ADD COLUMN "matchMethod" "MatchMethod" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "matchConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "dismissedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "calls_organizationId_matchMethod_matchConfidence_idx" ON "calls"("organizationId", "matchMethod", "matchConfidence");
