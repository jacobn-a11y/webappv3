-- CreateEnum
CREATE TYPE "TranscriptTruncationMode" AS ENUM ('OLDEST_FIRST', 'NEWEST_FIRST');

-- AlterTable: Add transcript merge configuration to org_settings
ALTER TABLE "org_settings" ADD COLUMN "transcriptMergeMaxWords" INTEGER NOT NULL DEFAULT 600000;
ALTER TABLE "org_settings" ADD COLUMN "transcriptTruncationMode" "TranscriptTruncationMode" NOT NULL DEFAULT 'OLDEST_FIRST';
