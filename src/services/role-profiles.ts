import type {
  AccountScopeType,
  PermissionType,
  PrismaClient,
  UserRole,
} from "@prisma/client";

type RolePresetKey = "SALES" | "CS" | "EXEC";

export interface EffectiveRolePolicy {
  permissions: PermissionType[];
  canAccessAnonymousStories: boolean;
  canGenerateAnonymousStories: boolean;
  canAccessNamedStories: boolean;
  canGenerateNamedStories: boolean;
  defaultAccountScopeType: AccountScopeType;
  defaultAccountIds: string[];
  maxTokensPerDay: number | null;
  maxTokensPerMonth: number | null;
  maxRequestsPerDay: number | null;
  maxRequestsPerMonth: number | null;
  maxStoriesPerMonth: number | null;
  source: "admin_override" | "assigned_profile" | "fallback";
}

export interface RoleProfileInput {
  key: string;
  name: string;
  description?: string;
  isPreset?: boolean;
  permissions: PermissionType[];
  canAccessAnonymousStories: boolean;
  canGenerateAnonymousStories: boolean;
  canAccessNamedStories: boolean;
  canGenerateNamedStories: boolean;
  defaultAccountScopeType: AccountScopeType;
  defaultAccountIds?: string[];
  maxTokensPerDay?: number | null;
  maxTokensPerMonth?: number | null;
  maxRequestsPerDay?: number | null;
  maxRequestsPerMonth?: number | null;
  maxStoriesPerMonth?: number | null;
}

const PRESETS: Record<RolePresetKey, RoleProfileInput> = {
  SALES: {
    key: "SALES",
    name: "Sales Team",
    description: "Builds stories and publishes customer-facing outputs.",
    isPreset: true,
    permissions: [
      "CREATE_LANDING_PAGE",
      "PUBLISH_LANDING_PAGE",
      "PUBLISH_NAMED_LANDING_PAGE",
      "VIEW_ANALYTICS",
    ],
    canAccessAnonymousStories: true,
    canGenerateAnonymousStories: true,
    canAccessNamedStories: true,
    canGenerateNamedStories: true,
    defaultAccountScopeType: "ALL_ACCOUNTS",
    maxStoriesPerMonth: 200,
  },
  CS: {
    key: "CS",
    name: "Customer Success Team",
    description: "Builds internal/external stories, usually anonymized by default.",
    isPreset: true,
    permissions: [
      "CREATE_LANDING_PAGE",
      "PUBLISH_LANDING_PAGE",
      "VIEW_ANALYTICS",
    ],
    canAccessAnonymousStories: true,
    canGenerateAnonymousStories: true,
    canAccessNamedStories: false,
    canGenerateNamedStories: false,
    defaultAccountScopeType: "ALL_ACCOUNTS",
    maxStoriesPerMonth: 120,
  },
  EXEC: {
    key: "EXEC",
    name: "Executive (View Only)",
    description:
      "View reporting and content that has already been created. No generation/publish actions.",
    isPreset: true,
    permissions: ["VIEW_ANALYTICS"],
    canAccessAnonymousStories: true,
    canGenerateAnonymousStories: false,
    canAccessNamedStories: false,
    canGenerateNamedStories: false,
    defaultAccountScopeType: "ACCOUNT_LIST",
    maxStoriesPerMonth: 0,
  },
};

function fallbackPolicy(userRole?: UserRole): EffectiveRolePolicy {
  if (userRole === "OWNER" || userRole === "ADMIN") {
    return {
      permissions: [
        "CREATE_LANDING_PAGE",
        "PUBLISH_LANDING_PAGE",
        "PUBLISH_NAMED_LANDING_PAGE",
        "EDIT_ANY_LANDING_PAGE",
        "DELETE_ANY_LANDING_PAGE",
        "MANAGE_PERMISSIONS",
        "VIEW_ANALYTICS",
        "MANAGE_ENTITY_RESOLUTION",
        "MANAGE_AI_SETTINGS",
      ],
      canAccessAnonymousStories: true,
      canGenerateAnonymousStories: true,
      canAccessNamedStories: true,
      canGenerateNamedStories: true,
      defaultAccountScopeType: "ALL_ACCOUNTS",
      defaultAccountIds: [],
      maxTokensPerDay: null,
      maxTokensPerMonth: null,
      maxRequestsPerDay: null,
      maxRequestsPerMonth: null,
      maxStoriesPerMonth: null,
      source: "admin_override",
    };
  }

  if (userRole === "VIEWER") {
    return {
      permissions: ["VIEW_ANALYTICS"],
      canAccessAnonymousStories: true,
      canGenerateAnonymousStories: false,
      canAccessNamedStories: false,
      canGenerateNamedStories: false,
      defaultAccountScopeType: "ACCOUNT_LIST",
      defaultAccountIds: [],
      maxTokensPerDay: null,
      maxTokensPerMonth: null,
      maxRequestsPerDay: null,
      maxRequestsPerMonth: null,
      maxStoriesPerMonth: 0,
      source: "fallback",
    };
  }

  return {
    permissions: [],
    canAccessAnonymousStories: true,
    canGenerateAnonymousStories: true,
    canAccessNamedStories: false,
    canGenerateNamedStories: false,
    defaultAccountScopeType: "ACCOUNT_LIST",
    defaultAccountIds: [],
    maxTokensPerDay: null,
    maxTokensPerMonth: null,
    maxRequestsPerDay: null,
    maxRequestsPerMonth: null,
    maxStoriesPerMonth: null,
    source: "fallback",
  };
}

export class RoleProfileService {
  constructor(private prisma: PrismaClient) {}

  async ensurePresetRoles(organizationId: string): Promise<void> {
    for (const preset of Object.values(PRESETS)) {
      await this.prisma.roleProfile.upsert({
        where: { organizationId_key: { organizationId, key: preset.key } },
        create: {
          organizationId,
          key: preset.key,
          name: preset.name,
          description: preset.description,
          isPreset: true,
          permissions: preset.permissions,
          canAccessAnonymousStories: preset.canAccessAnonymousStories,
          canGenerateAnonymousStories: preset.canGenerateAnonymousStories,
          canAccessNamedStories: preset.canAccessNamedStories,
          canGenerateNamedStories: preset.canGenerateNamedStories,
          defaultAccountScopeType: preset.defaultAccountScopeType,
          defaultAccountIds: preset.defaultAccountIds ?? [],
          maxTokensPerDay: preset.maxTokensPerDay ?? null,
          maxTokensPerMonth: preset.maxTokensPerMonth ?? null,
          maxRequestsPerDay: preset.maxRequestsPerDay ?? null,
          maxRequestsPerMonth: preset.maxRequestsPerMonth ?? null,
          maxStoriesPerMonth: preset.maxStoriesPerMonth ?? null,
        },
        update: {
          name: preset.name,
          description: preset.description,
          isPreset: true,
          permissions: preset.permissions,
          canAccessAnonymousStories: preset.canAccessAnonymousStories,
          canGenerateAnonymousStories: preset.canGenerateAnonymousStories,
          canAccessNamedStories: preset.canAccessNamedStories,
          canGenerateNamedStories: preset.canGenerateNamedStories,
          defaultAccountScopeType: preset.defaultAccountScopeType,
          defaultAccountIds: preset.defaultAccountIds ?? [],
          maxTokensPerDay: preset.maxTokensPerDay ?? null,
          maxTokensPerMonth: preset.maxTokensPerMonth ?? null,
          maxRequestsPerDay: preset.maxRequestsPerDay ?? null,
          maxRequestsPerMonth: preset.maxRequestsPerMonth ?? null,
          maxStoriesPerMonth: preset.maxStoriesPerMonth ?? null,
        },
      });
    }
  }

  async getEffectivePolicy(
    organizationId: string,
    userId: string,
    userRole?: UserRole
  ): Promise<EffectiveRolePolicy> {
    if (userRole === "OWNER" || userRole === "ADMIN") {
      return fallbackPolicy(userRole);
    }

    const userRoleAssignmentDelegate = (
      this.prisma as unknown as {
        userRoleAssignment?: {
          findUnique: (args: unknown) => Promise<{
            roleProfile: {
              organizationId: string;
              permissions: PermissionType[];
              canAccessAnonymousStories: boolean;
              canGenerateAnonymousStories: boolean;
              canAccessNamedStories: boolean;
              canGenerateNamedStories: boolean;
              defaultAccountScopeType: AccountScopeType;
              defaultAccountIds: string[];
              maxTokensPerDay: number | null;
              maxTokensPerMonth: number | null;
              maxRequestsPerDay: number | null;
              maxRequestsPerMonth: number | null;
              maxStoriesPerMonth: number | null;
            };
          } | null>;
        };
      }
    ).userRoleAssignment;

    if (!userRoleAssignmentDelegate) {
      return fallbackPolicy(userRole);
    }

    const assignment = await userRoleAssignmentDelegate.findUnique({
      where: { userId },
      include: { roleProfile: true },
    });

    if (
      assignment &&
      assignment.roleProfile.organizationId === organizationId
    ) {
      return {
        permissions: assignment.roleProfile.permissions,
        canAccessAnonymousStories:
          assignment.roleProfile.canAccessAnonymousStories,
        canGenerateAnonymousStories:
          assignment.roleProfile.canGenerateAnonymousStories,
        canAccessNamedStories: assignment.roleProfile.canAccessNamedStories,
        canGenerateNamedStories: assignment.roleProfile.canGenerateNamedStories,
        defaultAccountScopeType: assignment.roleProfile.defaultAccountScopeType,
        defaultAccountIds: assignment.roleProfile.defaultAccountIds,
        maxTokensPerDay: assignment.roleProfile.maxTokensPerDay,
        maxTokensPerMonth: assignment.roleProfile.maxTokensPerMonth,
        maxRequestsPerDay: assignment.roleProfile.maxRequestsPerDay,
        maxRequestsPerMonth: assignment.roleProfile.maxRequestsPerMonth,
        maxStoriesPerMonth: assignment.roleProfile.maxStoriesPerMonth,
        source: "assigned_profile",
      };
    }

    return fallbackPolicy(userRole);
  }

  async assignRoleToUser(
    organizationId: string,
    userId: string,
    roleProfileId: string,
    assignedById?: string
  ): Promise<void> {
    const [profile, user] = await Promise.all([
      this.prisma.roleProfile.findFirst({
        where: { id: roleProfileId, organizationId },
      }),
      this.prisma.user.findFirst({
        where: { id: userId, organizationId },
      }),
    ]);

    if (!profile || !user) {
      throw new Error("User or role profile not found in this organization");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.userRoleAssignment.upsert({
        where: { userId },
        create: { userId, roleProfileId, assignedById },
        update: { roleProfileId, assignedById },
      });

      await tx.aIUsageLimit.upsert({
        where: { organizationId_userId: { organizationId, userId } },
        create: {
          organizationId,
          userId,
          maxTokensPerDay: profile.maxTokensPerDay,
          maxTokensPerMonth: profile.maxTokensPerMonth,
          maxRequestsPerDay: profile.maxRequestsPerDay,
          maxRequestsPerMonth: profile.maxRequestsPerMonth,
          maxStoriesPerMonth: profile.maxStoriesPerMonth,
        },
        update: {
          maxTokensPerDay: profile.maxTokensPerDay,
          maxTokensPerMonth: profile.maxTokensPerMonth,
          maxRequestsPerDay: profile.maxRequestsPerDay,
          maxRequestsPerMonth: profile.maxRequestsPerMonth,
          maxStoriesPerMonth: profile.maxStoriesPerMonth,
        },
      });

      await tx.userAccountAccess.deleteMany({ where: { userId, organizationId } });
      await tx.userAccountAccess.create({
        data: {
          userId,
          organizationId,
          scopeType: profile.defaultAccountScopeType,
          cachedAccountIds:
            profile.defaultAccountScopeType === "ACCOUNT_LIST"
              ? profile.defaultAccountIds
              : [],
          accountId:
            profile.defaultAccountScopeType === "SINGLE_ACCOUNT"
              ? (profile.defaultAccountIds[0] ?? null)
              : null,
          grantedById: assignedById ?? null,
        },
      });
    });
  }
}
