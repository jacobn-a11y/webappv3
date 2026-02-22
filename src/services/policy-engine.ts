import type { PermissionType, PrismaClient, UserRole } from "@prisma/client";
import logger from "../lib/logger.js";
import { AccountAccessService } from "./account-access.js";
import { RoleProfileService } from "./role-profiles.js";

export type PolicyAction =
  | "create_landing_page"
  | "publish_landing_page"
  | "edit_any_landing_page"
  | "delete_any_landing_page"
  | "manage_permissions"
  | "view_analytics"
  | "view_queue_health"
  | "manage_integrations"
  | "view_audit_logs"
  | "export_pii"
  | "view_named_story"
  | "view_anonymous_story"
  | "generate_named_story"
  | "generate_anonymous_story";

export interface PolicyEvaluationInput {
  action: PolicyAction;
  organizationId: string;
  userId: string;
  userRole?: UserRole;
  accountId?: string;
  storyIsAnonymous?: boolean;
  orgDataGovernancePolicy?: Record<string, unknown> | null;
}

export interface PolicyDecision {
  allowed: boolean;
  reason:
    | "admin_bypass"
    | "role_profile_allow"
    | "user_permission_allow"
    | "account_scope_denied"
    | "story_sensitivity_denied"
    | "org_policy_denied"
    | "permission_denied";
  requiredPermission?: PermissionType;
}

export const ACTION_PERMISSION_MATRIX: Partial<
  Record<PolicyAction, PermissionType>
> = {
  create_landing_page: "CREATE_LANDING_PAGE",
  publish_landing_page: "PUBLISH_LANDING_PAGE",
  edit_any_landing_page: "EDIT_ANY_LANDING_PAGE",
  delete_any_landing_page: "DELETE_ANY_LANDING_PAGE",
  manage_permissions: "MANAGE_PERMISSIONS",
  view_analytics: "VIEW_ANALYTICS",
  view_queue_health: "MANAGE_PERMISSIONS",
  manage_integrations: "MANAGE_PERMISSIONS",
  view_audit_logs: "MANAGE_PERMISSIONS",
};

const ADMIN_ROLES: UserRole[] = ["OWNER", "ADMIN"];

export class PolicyService {
  private roleProfiles: RoleProfileService;
  private accountAccess: AccountAccessService;

  constructor(private prisma: PrismaClient) {
    this.roleProfiles = new RoleProfileService(prisma);
    this.accountAccess = new AccountAccessService(prisma);
  }

  async evaluate(input: PolicyEvaluationInput): Promise<PolicyDecision> {
    if (input.userRole && ADMIN_ROLES.includes(input.userRole)) {
      return { allowed: true, reason: "admin_bypass" };
    }

    const rolePolicy = await this.roleProfiles.getEffectivePolicy(
      input.organizationId,
      input.userId,
      input.userRole
    );

    if (input.action === "export_pii") {
      const piiEnabled =
        (input.orgDataGovernancePolicy?.pii_export_enabled as boolean | undefined) ??
        true;
      if (!piiEnabled) {
        return { allowed: false, reason: "org_policy_denied" };
      }
    }

    if (input.action === "view_named_story" || input.action === "generate_named_story") {
      if (!rolePolicy.canAccessNamedStories || !rolePolicy.canGenerateNamedStories) {
        return { allowed: false, reason: "story_sensitivity_denied" };
      }
    }

    if (
      input.action === "view_anonymous_story" ||
      input.action === "generate_anonymous_story"
    ) {
      const allowsAnonymous =
        input.action === "view_anonymous_story"
          ? rolePolicy.canAccessAnonymousStories
          : rolePolicy.canGenerateAnonymousStories;
      if (!allowsAnonymous) {
        return { allowed: false, reason: "story_sensitivity_denied" };
      }
    }

    if (input.accountId) {
      const accountAllowed = await this.accountAccess.canAccessAccount(
        input.userId,
        input.organizationId,
        input.accountId,
        input.userRole
      );
      if (!accountAllowed) {
        return { allowed: false, reason: "account_scope_denied" };
      }
    }

    const requiredPermission = ACTION_PERMISSION_MATRIX[input.action];
    if (requiredPermission && rolePolicy.permissions.includes(requiredPermission)) {
      return {
        allowed: true,
        reason: "role_profile_allow",
        requiredPermission,
      };
    }

    if (requiredPermission) {
      const granted = await this.prisma.userPermission.findUnique({
        where: {
          userId_permission: {
            userId: input.userId,
            permission: requiredPermission,
          },
        },
      });
      if (granted) {
        return {
          allowed: true,
          reason: "user_permission_allow",
          requiredPermission,
        };
      }
      return {
        allowed: false,
        reason: "permission_denied",
        requiredPermission,
      };
    }

    return { allowed: true, reason: "role_profile_allow" };
  }

  emitDenyTelemetry(input: PolicyEvaluationInput, decision: PolicyDecision): void {
    if (decision.allowed) return;
    logger.warn("Policy denied action", {
      organizationId: input.organizationId,
      userId: input.userId,
      action: input.action,
      reason: decision.reason,
      requiredPermission: decision.requiredPermission,
      accountId: input.accountId,
      storyIsAnonymous: input.storyIsAnonymous,
    });
  }
}

export function legacyPermissionActionToPolicyAction(
  action: string
): PolicyAction | null {
  const map: Record<string, PolicyAction> = {
    create: "create_landing_page",
    publish: "publish_landing_page",
    edit_any: "edit_any_landing_page",
    delete_any: "delete_any_landing_page",
    manage_permissions: "manage_permissions",
    view_analytics: "view_analytics",
  };
  return map[action] ?? null;
}
