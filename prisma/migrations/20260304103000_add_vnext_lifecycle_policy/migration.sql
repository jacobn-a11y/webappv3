-- vNext lifecycle + simplified approval policy

-- Approval policy enum for org-level publish behavior
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ApprovalPolicy') THEN
    CREATE TYPE "ApprovalPolicy" AS ENUM (
      'ALL_REQUIRED',
      'ANON_NO_APPROVAL',
      'NAMED_NO_APPROVAL',
      'ALL_NO_APPROVAL'
    );
  END IF;
END
$$;

-- Add new org-level approval policy field
ALTER TABLE "org_settings"
  ADD COLUMN IF NOT EXISTS "approvalPolicy" "ApprovalPolicy" NOT NULL DEFAULT 'ALL_REQUIRED';

-- Add Story lifecycle publish marker
ALTER TABLE "stories"
  ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(3);

-- Extend permission enum for approval reviewers
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'PermissionType'
      AND e.enumlabel = 'APPROVE_PUBLISH_REQUESTS'
  ) THEN
    ALTER TYPE "PermissionType" ADD VALUE 'APPROVE_PUBLISH_REQUESTS';
  END IF;
END
$$;
