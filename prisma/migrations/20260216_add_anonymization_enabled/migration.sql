-- AlterTable: Add org-level anonymization toggle
ALTER TABLE "org_settings" ADD COLUMN "anonymizationEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable: Store scrubbed versions of title/subtitle/callouts separately
-- so the original content is never overwritten and anonymization is reversible.
ALTER TABLE "landing_pages" ADD COLUMN "scrubbedTitle" TEXT;
ALTER TABLE "landing_pages" ADD COLUMN "scrubbedSubtitle" TEXT;
ALTER TABLE "landing_pages" ADD COLUMN "scrubbedCalloutBoxes" JSONB;
