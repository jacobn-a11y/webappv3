import { beforeEach, describe, expect, it, vi } from "vitest";
import { PolicyService, type PolicyEvaluationInput } from "../src/services/policy-engine.js";
import { RoleProfileService } from "../src/services/role-profiles.js";
import { AccountAccessService } from "../src/services/account-access.js";

describe("PolicyService", () => {
  const prisma = {
    userPermission: {
      findUnique: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(RoleProfileService.prototype, "getEffectivePolicy").mockResolvedValue({
      permissions: [],
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
      source: "assigned_profile",
    });
    vi.spyOn(AccountAccessService.prototype, "canAccessAccount").mockResolvedValue(true);
  });

  async function evaluate(input: Partial<PolicyEvaluationInput>) {
    const service = new PolicyService(prisma);
    return service.evaluate({
      action: "manage_permissions",
      organizationId: "org-1",
      userId: "user-1",
      userRole: "MEMBER",
      ...input,
    });
  }

  it("denies when org policy disables PII exports", async () => {
    const decision = await evaluate({
      action: "export_pii",
      orgDataGovernancePolicy: { pii_export_enabled: false },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("org_policy_denied");
  });

  it("denies when requested account is outside account scope", async () => {
    vi.spyOn(AccountAccessService.prototype, "canAccessAccount").mockResolvedValue(false);

    const decision = await evaluate({
      action: "view_analytics",
      accountId: "acct-2",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("account_scope_denied");
  });

  it("allows when role profile includes required permission", async () => {
    vi.spyOn(RoleProfileService.prototype, "getEffectivePolicy").mockResolvedValue({
      permissions: ["MANAGE_PERMISSIONS"],
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
      source: "assigned_profile",
    });

    const decision = await evaluate({ action: "manage_permissions" });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("role_profile_allow");
  });

  it("allows when user-level permission exists", async () => {
    prisma.userPermission.findUnique.mockResolvedValue({
      id: "perm-1",
      userId: "user-1",
      permission: "VIEW_ANALYTICS",
    });

    const decision = await evaluate({ action: "view_analytics" });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("user_permission_allow");
  });
});

