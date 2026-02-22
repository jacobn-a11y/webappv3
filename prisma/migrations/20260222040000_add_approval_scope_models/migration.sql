-- Scoped approval controls: team/user/group/self + admin scopes

ALTER TABLE "artifact_approval_steps"
  ADD COLUMN IF NOT EXISTS "approverScopeType" TEXT NOT NULL DEFAULT 'ROLE_PROFILE',
  ADD COLUMN IF NOT EXISTS "approverScopeValue" TEXT,
  ADD COLUMN IF NOT EXISTS "allowSelfApproval" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "approval_groups" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "ownerUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "approval_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "approval_groups_organizationId_name_key"
  ON "approval_groups"("organizationId", "name");
CREATE INDEX IF NOT EXISTS "approval_groups_organizationId_createdAt_idx"
  ON "approval_groups"("organizationId", "createdAt");

CREATE TABLE IF NOT EXISTS "approval_group_members" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "approval_group_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "approval_group_members_groupId_userId_key"
  ON "approval_group_members"("groupId", "userId");
CREATE INDEX IF NOT EXISTS "approval_group_members_organizationId_userId_idx"
  ON "approval_group_members"("organizationId", "userId");

CREATE TABLE IF NOT EXISTS "team_approval_admin_scopes" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "teamKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "team_approval_admin_scopes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "team_approval_admin_scopes_organizationId_userId_teamKey_key"
  ON "team_approval_admin_scopes"("organizationId", "userId", "teamKey");
CREATE INDEX IF NOT EXISTS "team_approval_admin_scopes_organizationId_teamKey_idx"
  ON "team_approval_admin_scopes"("organizationId", "teamKey");

DO $$ BEGIN
  ALTER TABLE "approval_groups"
    ADD CONSTRAINT "approval_groups_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "approval_groups"
    ADD CONSTRAINT "approval_groups_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "approval_group_members"
    ADD CONSTRAINT "approval_group_members_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "approval_group_members"
    ADD CONSTRAINT "approval_group_members_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "approval_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "approval_group_members"
    ADD CONSTRAINT "approval_group_members_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "team_approval_admin_scopes"
    ADD CONSTRAINT "team_approval_admin_scopes_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "team_approval_admin_scopes"
    ADD CONSTRAINT "team_approval_admin_scopes_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
