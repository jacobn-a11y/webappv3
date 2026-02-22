-- Workspace and shared asset models for team-based self-service collaboration

DO $$ BEGIN
  CREATE TYPE "WorkspaceTeam" AS ENUM ('REVOPS', 'MARKETING', 'SALES', 'CS');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "WorkspaceVisibility" AS ENUM ('PRIVATE', 'TEAM', 'ORG');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "AssetType" AS ENUM ('STORY', 'PAGE', 'REPORT', 'PLAYBOOK', 'TEMPLATE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "team_workspaces" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "team" "WorkspaceTeam" NOT NULL,
  "visibility" "WorkspaceVisibility" NOT NULL DEFAULT 'TEAM',
  "ownerUserId" TEXT NOT NULL,
  "savedViewConfig" JSONB,
  "allowedRoleProfileKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "team_workspaces_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "team_workspaces_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "team_workspaces_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "shared_assets" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT,
  "ownerUserId" TEXT NOT NULL,
  "assetType" "AssetType" NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "sourceStoryId" TEXT,
  "sourcePageId" TEXT,
  "sourceAccountId" TEXT,
  "visibility" "WorkspaceVisibility" NOT NULL DEFAULT 'TEAM',
  "allowedRoleProfileKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "shared_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shared_assets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "shared_assets_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "team_workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "shared_assets_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "team_workspaces_organizationId_team_visibility_idx"
  ON "team_workspaces"("organizationId", "team", "visibility");
CREATE INDEX IF NOT EXISTS "team_workspaces_organizationId_ownerUserId_idx"
  ON "team_workspaces"("organizationId", "ownerUserId");

CREATE INDEX IF NOT EXISTS "shared_assets_organizationId_assetType_visibility_idx"
  ON "shared_assets"("organizationId", "assetType", "visibility");
CREATE INDEX IF NOT EXISTS "shared_assets_organizationId_workspaceId_idx"
  ON "shared_assets"("organizationId", "workspaceId");
