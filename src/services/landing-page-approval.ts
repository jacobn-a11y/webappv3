/**
 * Landing Page Approval Workflow Service
 *
 * Handles publish-approval governance: fetching approval policies,
 * determining step eligibility, and permission checks for named stories.
 */

import type { PrismaClient, UserRole } from "@prisma/client";
import type { RoleProfileService } from "./role-profiles.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PublishApprovalStep {
  step_order: number;
  min_approvals: number;
  required_role_profile_key: string | null;
  required_user_role: string | null;
  approver_scope_type: "ROLE_PROFILE" | "TEAM" | "USER" | "GROUP" | "SELF";
  approver_scope_value: string | null;
  allow_self_approval: boolean;
}

export interface PublishApprovalPayload {
  page_id: string;
  options: {
    visibility: "PRIVATE" | "SHARED_WITH_LINK";
    password?: string;
    expires_at?: string;
    release_notes?: string;
  };
  steps: PublishApprovalStep[];
  approvals?: Array<{
    step_order: number;
    reviewer_user_id: string;
    reviewer_name: string | null;
    reviewer_email: string | null;
    decided_at: string;
    notes: string | null;
  }>;
  current_step_order?: number;
}

export interface ArtifactPublishGovernance {
  approvalChainEnabled: boolean;
  maxExpirationDays: number | null;
  requireProvenance: boolean;
  steps: PublishApprovalStep[];
}

// ─── Permission Helpers ─────────────────────────────────────────────────────

export function isAdminRole(userRole?: string): boolean {
  return !!userRole && ["OWNER", "ADMIN"].includes(userRole);
}

export async function canAccessNamedStories(
  prisma: PrismaClient,
  roleProfiles: RoleProfileService,
  params: { organizationId?: string; userId?: string; userRole?: string }
): Promise<boolean> {
  if (isAdminRole(params.userRole)) {
    return true;
  }
  if (!params.organizationId || !params.userId) {
    return false;
  }
  const policy = await roleProfiles.getEffectivePolicy(
    params.organizationId,
    params.userId,
    params.userRole as UserRole | undefined
  );
  if (
    policy.canAccessNamedStories ||
    policy.permissions.includes("PUBLISH_NAMED_LANDING_PAGE")
  ) {
    return true;
  }
  const userPerm = await prisma.userPermission.findUnique({
    where: {
      userId_permission: {
        userId: params.userId,
        permission: "PUBLISH_NAMED_LANDING_PAGE",
      },
    },
  });
  return !!userPerm;
}

export async function canGenerateNamedStories(
  prisma: PrismaClient,
  roleProfiles: RoleProfileService,
  params: { organizationId?: string; userId?: string; userRole?: string }
): Promise<boolean> {
  if (isAdminRole(params.userRole)) {
    return true;
  }
  if (!params.organizationId || !params.userId) {
    return false;
  }
  const policy = await roleProfiles.getEffectivePolicy(
    params.organizationId,
    params.userId,
    params.userRole as UserRole | undefined
  );
  if (
    policy.canGenerateNamedStories ||
    policy.permissions.includes("PUBLISH_NAMED_LANDING_PAGE")
  ) {
    return true;
  }
  const userPerm = await prisma.userPermission.findUnique({
    where: {
      userId_permission: {
        userId: params.userId,
        permission: "PUBLISH_NAMED_LANDING_PAGE",
      },
    },
  });
  return !!userPerm;
}

// ─── Governance Policy ──────────────────────────────────────────────────────

export async function getArtifactPublishGovernance(
  prisma: PrismaClient,
  organizationId: string
): Promise<ArtifactPublishGovernance> {
  const policy = await prisma.artifactGovernancePolicy.findUnique({
    where: { organizationId },
    include: {
      approvalSteps: {
        where: { enabled: true },
        orderBy: { stepOrder: "asc" },
      },
    },
  });

  if (!policy) {
    return {
      approvalChainEnabled: false,
      maxExpirationDays: null,
      requireProvenance: true,
      steps: [],
    };
  }

  return {
    approvalChainEnabled: policy.approvalChainEnabled,
    maxExpirationDays: policy.maxExpirationDays ?? null,
    requireProvenance: policy.requireProvenance,
    steps: policy.approvalSteps.map((s) => ({
      step_order: s.stepOrder,
      min_approvals: s.minApprovals,
      required_role_profile_key: s.requiredRoleProfileKey ?? null,
      required_user_role: s.requiredUserRole ?? null,
      approver_scope_type:
        (s.approverScopeType as "ROLE_PROFILE" | "TEAM" | "USER" | "GROUP" | "SELF") ??
        "ROLE_PROFILE",
      approver_scope_value: s.approverScopeValue ?? null,
      allow_self_approval: s.allowSelfApproval,
    })),
  };
}

// ─── Step Eligibility ───────────────────────────────────────────────────────

export async function canUserApproveStep(
  prisma: PrismaClient,
  params: { organizationId?: string; userId?: string; userRole?: string },
  step: PublishApprovalStep,
  requestedByUserId?: string
): Promise<boolean> {
  if (!params.organizationId || !params.userId) {
    return false;
  }

  if (step.required_user_role && params.userRole !== step.required_user_role) {
    return false;
  }

  const assignment = await prisma.userRoleAssignment.findUnique({
    where: { userId: params.userId },
    include: { roleProfile: { select: { key: true, organizationId: true } } },
  });
  const roleProfileKey =
    assignment && assignment.roleProfile.organizationId === params.organizationId
      ? assignment.roleProfile.key
      : null;

  if (roleProfileKey === "BILLING_ADMIN" || roleProfileKey === "APPROVAL_ADMIN") {
    return true;
  }

  if (step.required_role_profile_key && roleProfileKey !== step.required_role_profile_key) {
    return false;
  }

  if (
    !step.allow_self_approval &&
    requestedByUserId &&
    requestedByUserId === params.userId
  ) {
    return false;
  }

  const scopeType = step.approver_scope_type ?? "ROLE_PROFILE";
  const scopeValue = step.approver_scope_value ?? null;

  if (scopeType === "SELF") {
    return requestedByUserId === params.userId;
  }
  if (scopeType === "USER") {
    return !!scopeValue && params.userId === scopeValue;
  }
  if (scopeType === "GROUP") {
    if (!scopeValue) return false;
    const member = await prisma.approvalGroupMember.findFirst({
      where: {
        organizationId: params.organizationId,
        groupId: scopeValue,
        userId: params.userId,
      },
    });
    return !!member;
  }
  if (scopeType === "TEAM") {
    if (!scopeValue) return false;
    if (roleProfileKey === "TEAM_APPROVAL_ADMIN") {
      const scope = await prisma.teamApprovalAdminScope.findFirst({
        where: {
          organizationId: params.organizationId,
          userId: params.userId,
          teamKey: scopeValue,
        },
      });
      return !!scope;
    }
    return roleProfileKey === scopeValue;
  }

  // ROLE_PROFILE (default)
  if (!scopeValue) {
    return !!roleProfileKey;
  }
  return roleProfileKey === scopeValue;
}
