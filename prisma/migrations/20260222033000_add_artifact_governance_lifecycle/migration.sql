-- Artifact governance lifecycle: approval chains + version/provenance history

DO $$ BEGIN
  CREATE TYPE "ArtifactType" AS ENUM ('LANDING_PAGE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "artifact_governance_policies" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "artifactType" "ArtifactType" NOT NULL DEFAULT 'LANDING_PAGE',
  "approvalChainEnabled" BOOLEAN NOT NULL DEFAULT false,
  "maxExpirationDays" INTEGER,
  "requireProvenance" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "artifact_governance_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "artifact_governance_policies_organizationId_key"
  ON "artifact_governance_policies"("organizationId");
CREATE INDEX IF NOT EXISTS "artifact_governance_policies_organizationId_artifactType_idx"
  ON "artifact_governance_policies"("organizationId", "artifactType");

CREATE TABLE IF NOT EXISTS "artifact_approval_steps" (
  "id" TEXT NOT NULL,
  "governancePolicyId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "stepOrder" INTEGER NOT NULL,
  "minApprovals" INTEGER NOT NULL DEFAULT 1,
  "requiredRoleProfileKey" TEXT,
  "requiredUserRole" "UserRole",
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "artifact_approval_steps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "artifact_approval_steps_governancePolicyId_stepOrder_key"
  ON "artifact_approval_steps"("governancePolicyId", "stepOrder");
CREATE INDEX IF NOT EXISTS "artifact_approval_steps_organizationId_stepOrder_enabled_idx"
  ON "artifact_approval_steps"("organizationId", "stepOrder", "enabled");

CREATE TABLE IF NOT EXISTS "published_artifact_versions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "artifactType" "ArtifactType" NOT NULL DEFAULT 'LANDING_PAGE',
  "landingPageId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "releaseNotes" TEXT,
  "titleSnapshot" TEXT NOT NULL,
  "subtitleSnapshot" TEXT,
  "bodySnapshot" TEXT NOT NULL,
  "calloutBoxesSnapshot" JSONB,
  "visibilitySnapshot" "PageVisibility" NOT NULL,
  "expiresAtSnapshot" TIMESTAMP(3),
  "publishedAtSnapshot" TIMESTAMP(3),
  "sourceEditId" TEXT,
  "publishedByUserId" TEXT,
  "approvalRequestId" TEXT,
  "provenance" JSONB,
  "rolledBackFromVersionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "published_artifact_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "published_artifact_versions_landingPageId_versionNumber_key"
  ON "published_artifact_versions"("landingPageId", "versionNumber");
CREATE INDEX IF NOT EXISTS "published_artifact_versions_organizationId_artifactType_createdAt_idx"
  ON "published_artifact_versions"("organizationId", "artifactType", "createdAt");
CREATE INDEX IF NOT EXISTS "published_artifact_versions_landingPageId_status_createdAt_idx"
  ON "published_artifact_versions"("landingPageId", "status", "createdAt");

DO $$ BEGIN
  ALTER TABLE "artifact_governance_policies"
    ADD CONSTRAINT "artifact_governance_policies_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "artifact_approval_steps"
    ADD CONSTRAINT "artifact_approval_steps_governancePolicyId_fkey"
    FOREIGN KEY ("governancePolicyId") REFERENCES "artifact_governance_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "artifact_approval_steps"
    ADD CONSTRAINT "artifact_approval_steps_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "published_artifact_versions"
    ADD CONSTRAINT "published_artifact_versions_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "published_artifact_versions"
    ADD CONSTRAINT "published_artifact_versions_landingPageId_fkey"
    FOREIGN KEY ("landingPageId") REFERENCES "landing_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "published_artifact_versions"
    ADD CONSTRAINT "published_artifact_versions_publishedByUserId_fkey"
    FOREIGN KEY ("publishedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
