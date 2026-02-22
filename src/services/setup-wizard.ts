/**
 * Setup Wizard Service
 *
 * Orchestrates the Connections Setup Wizard — a first-run experience that walks
 * new organizations through five steps:
 *
 *   1. Connect Recording Provider — Merge.dev Link session for call recording integrations
 *   2. Connect CRM — Merge.dev Link session for Salesforce or HubSpot
 *   3. Review Account Sync — Preview the initial entity-resolution results and fix mismatches
 *   4. Choose Plan — Select a billing plan or start free trial
 *   5. Set Default Permissions — Configure landing page permissions for the team
 *
 * The wizard state is persisted in the `SetupWizard` table so the user can
 * resume at any point. Each step validates its preconditions and advances
 * `currentStep` on completion.
 */

import type {
  PrismaClient,
  CallProvider,
  CRMProvider,
  Plan,
  SetupWizardStep,
  UserRole,
} from "@prisma/client";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WizardStatus {
  currentStep: SetupWizardStep;
  completedAt: string | null;
  completionScore: number;
  missingPrompts: string[];
  firstValue: {
    storiesGenerated: number;
    pagesPublished: number;
    complete: boolean;
  };
  steps: {
    recording_provider: {
      complete: boolean;
      provider: CallProvider | null;
      mergeLinkedAccountId: string | null;
    };
    crm: {
      complete: boolean;
      provider: CRMProvider | null;
      mergeLinkedAccountId: string | null;
    };
    account_sync: {
      complete: boolean;
      syncedAccountCount: number;
      unresolvedCount: number;
      reviewedAt: string | null;
    };
    plan: {
      complete: boolean;
      selectedPlan: Plan | null;
    };
    permissions: {
      complete: boolean;
      configuredAt: string | null;
    };
  };
}

export interface MergeLinkTokenResponse {
  link_token: string;
  integration_category: string;
}

export interface AccountSyncPreview {
  totalAccounts: number;
  resolvedAccounts: number;
  unresolvedCalls: UnresolvedCallSummary[];
}

export interface UnresolvedCallSummary {
  callId: string;
  title: string | null;
  provider: CallProvider;
  occurredAt: string;
  participantEmails: string[];
  suggestedAccount: {
    id: string;
    name: string;
    confidence: number;
  } | null;
}

export interface EntityResolutionFix {
  callId: string;
  accountId: string;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class SetupWizardService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Gets or creates the wizard state for an organization.
   */
  async getOrCreateWizard(organizationId: string) {
    return this.prisma.setupWizard.upsert({
      where: { organizationId },
      create: { organizationId },
      update: {},
    });
  }

  /**
   * Returns a structured view of the wizard's current state.
   */
  async getStatus(organizationId: string): Promise<WizardStatus> {
    const wizard = await this.getOrCreateWizard(organizationId);

    const stepOrder: SetupWizardStep[] = [
      "RECORDING_PROVIDER",
      "CRM",
      "ACCOUNT_SYNC",
      "PLAN",
      "PERMISSIONS",
      "COMPLETED",
    ];
    const currentIdx = stepOrder.indexOf(wizard.currentStep);

    const [settings, rolePresetCount, storyCount, pageCount, integrationCount] =
      await Promise.all([
        this.prisma.orgSettings.findUnique({
          where: { organizationId },
          select: { storyContext: true, dataGovernancePolicy: true },
        }),
        this.prisma.roleProfile.count({
          where: { organizationId, isPreset: true },
        }),
        this.prisma.story.count({ where: { organizationId } }),
        this.prisma.landingPage.count({
          where: { organizationId, status: "PUBLISHED" },
        }),
        this.prisma.integrationConfig.count({
          where: { organizationId, enabled: true },
        }),
      ]);

    const rawStoryContext = settings?.storyContext;
    const storyContext =
      rawStoryContext && typeof rawStoryContext === "object" && !Array.isArray(rawStoryContext)
        ? (rawStoryContext as Record<string, unknown>)
        : {};
    const products =
      Array.isArray(storyContext.products) && storyContext.products.length > 0;
    const companyOverview =
      typeof storyContext.companyOverview === "string" &&
      storyContext.companyOverview.trim().length > 0;
    const orgProfileComplete = companyOverview || products;

    const governanceDefaultsComplete =
      Boolean(settings?.dataGovernancePolicy) &&
      typeof settings?.dataGovernancePolicy === "object";
    const rolePresetsComplete = rolePresetCount >= 3;
    const connectorsComplete = integrationCount >= 1;
    const firstValueComplete = storyCount > 0 && pageCount > 0;

    const checklist = [
      orgProfileComplete,
      connectorsComplete,
      rolePresetsComplete,
      governanceDefaultsComplete,
      firstValueComplete,
    ];
    const completeCount = checklist.filter(Boolean).length;
    const completionScore = Math.round((completeCount / checklist.length) * 100);
    const missingPrompts: string[] = [];
    if (!orgProfileComplete) {
      missingPrompts.push("Add company and product context in setup org profile.");
    }
    if (!connectorsComplete) {
      missingPrompts.push("Connect at least one integration to start data sync.");
    }
    if (!rolePresetsComplete) {
      missingPrompts.push("Apply preset roles (Sales, CS, Exec) for team onboarding.");
    }
    if (!governanceDefaultsComplete) {
      missingPrompts.push("Set governance defaults (retention, export rules, legal hold).");
    }
    if (!firstValueComplete) {
      missingPrompts.push("Generate your first story and publish your first landing page.");
    }

    return {
      currentStep: wizard.currentStep,
      completedAt: wizard.completedAt?.toISOString() ?? null,
      completionScore,
      missingPrompts,
      firstValue: {
        storiesGenerated: storyCount,
        pagesPublished: pageCount,
        complete: firstValueComplete,
      },
      steps: {
        recording_provider: {
          complete: currentIdx > 0,
          provider: wizard.recordingProvider,
          mergeLinkedAccountId: wizard.mergeLinkedAccountId,
        },
        crm: {
          complete: currentIdx > 1,
          provider: wizard.crmProvider,
          mergeLinkedAccountId: wizard.crmMergeLinkedAccountId,
        },
        account_sync: {
          complete: currentIdx > 2,
          syncedAccountCount: wizard.syncedAccountCount,
          unresolvedCount: wizard.unresolvedCount,
          reviewedAt: wizard.syncReviewedAt?.toISOString() ?? null,
        },
        plan: {
          complete: currentIdx > 3,
          selectedPlan: wizard.selectedPlan,
        },
        permissions: {
          complete: currentIdx > 4,
          configuredAt: wizard.permissionsConfiguredAt?.toISOString() ?? null,
        },
      },
    };
  }

  // ── Step 1: Connect Recording Provider ──────────────────────────────

  /**
   * Generates a Merge.dev Link token for the recording provider category.
   * The frontend uses this token to launch the Merge Link UI where the user
   * authenticates with their recording provider (Gong, Chorus, Zoom, etc.).
   */
  async initRecordingProviderLink(
    organizationId: string
  ): Promise<MergeLinkTokenResponse> {
    // In production, this calls the Merge.dev API:
    //   POST https://api.merge.dev/api/integrations/create-link-token
    //   { end_user_origin_id: orgId, end_user_organization_name: orgName,
    //     categories: ["ats", "file-storage"] }
    //
    // For now, return the token structure that the frontend needs.

    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });

    const mergeApiKey = process.env.MERGE_API_KEY;
    if (!mergeApiKey) {
      throw new Error("MERGE_API_KEY not configured");
    }

    // Call Merge.dev to create a link token for recording integrations
    const response = await fetch(
      "https://api.merge.dev/api/integrations/create-link-token",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${mergeApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          end_user_origin_id: organizationId,
          end_user_organization_name: org.name,
          end_user_email_address: "", // populated by WorkOS user in production
          categories: ["ats"],
        }),
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Merge.dev link token request failed: ${response.status} ${body}`);
    }

    const data = (await response.json()) as { link_token: string };
    return {
      link_token: data.link_token,
      integration_category: "recording",
    };
  }

  /**
   * Completes Step 1 after the user finishes the Merge Link flow.
   * The frontend sends back the public token from Merge Link.
   */
  async completeRecordingProvider(
    organizationId: string,
    provider: CallProvider,
    mergeLinkedAccountId: string
  ): Promise<void> {
    await this.prisma.setupWizard.update({
      where: { organizationId },
      data: {
        recordingProvider: provider,
        mergeLinkedAccountId: mergeLinkedAccountId,
        currentStep: "CRM",
      },
    });
  }

  // ── Step 2: Connect CRM ─────────────────────────────────────────────

  /**
   * Generates a Merge.dev Link token for CRM integrations.
   */
  async initCrmLink(
    organizationId: string
  ): Promise<MergeLinkTokenResponse> {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });

    const mergeApiKey = process.env.MERGE_API_KEY;
    if (!mergeApiKey) {
      throw new Error("MERGE_API_KEY not configured");
    }

    const response = await fetch(
      "https://api.merge.dev/api/integrations/create-link-token",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${mergeApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          end_user_origin_id: organizationId,
          end_user_organization_name: org.name,
          end_user_email_address: "",
          categories: ["crm"],
        }),
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Merge.dev CRM link token request failed: ${response.status} ${body}`);
    }

    const data = (await response.json()) as { link_token: string };
    return {
      link_token: data.link_token,
      integration_category: "crm",
    };
  }

  /**
   * Completes Step 2 after the user finishes the CRM Merge Link flow.
   */
  async completeCrmConnection(
    organizationId: string,
    crmProvider: CRMProvider,
    mergeLinkedAccountId: string
  ): Promise<void> {
    await this.prisma.setupWizard.update({
      where: { organizationId },
      data: {
        crmProvider,
        crmMergeLinkedAccountId: mergeLinkedAccountId,
        currentStep: "ACCOUNT_SYNC",
      },
    });
  }

  // ── Step 3: Review Account Sync ─────────────────────────────────────

  /**
   * Returns a preview of the initial account sync, including any calls
   * that couldn't be matched to a CRM account (entity resolution mismatches).
   */
  async getAccountSyncPreview(
    organizationId: string
  ): Promise<AccountSyncPreview> {
    // Count total synced accounts
    const totalAccounts = await this.prisma.account.count({
      where: { organizationId },
    });

    // Count calls resolved to accounts
    const resolvedCalls = await this.prisma.call.count({
      where: { organizationId, accountId: { not: null } },
    });

    // Fetch unresolved calls (no accountId)
    const unresolvedCalls = await this.prisma.call.findMany({
      where: { organizationId, accountId: null },
      include: {
        participants: {
          select: { email: true, name: true },
        },
      },
      orderBy: { occurredAt: "desc" },
      take: 50,
    });

    // For each unresolved call, try to suggest a match
    const unresolvedSummaries: UnresolvedCallSummary[] = [];

    for (const call of unresolvedCalls) {
      // Extract participant domains and find the best candidate account
      const emails = call.participants
        .map((p) => p.email)
        .filter((e): e is string => e !== null);

      const domains = new Set<string>();
      for (const email of emails) {
        const parts = email.split("@");
        if (parts.length === 2) domains.add(parts[1]);
      }

      let suggestedAccount: UnresolvedCallSummary["suggestedAccount"] = null;

      if (domains.size > 0) {
        // Try to find an account by domain for suggestion
        const account = await this.prisma.account.findFirst({
          where: {
            organizationId,
            domain: { in: Array.from(domains) },
          },
          select: { id: true, name: true },
        });

        if (account) {
          suggestedAccount = {
            id: account.id,
            name: account.name,
            confidence: 0.7,
          };
        }
      }

      unresolvedSummaries.push({
        callId: call.id,
        title: call.title,
        provider: call.provider,
        occurredAt: call.occurredAt.toISOString(),
        participantEmails: emails,
        suggestedAccount,
      });
    }

    return {
      totalAccounts,
      resolvedAccounts: resolvedCalls,
      unresolvedCalls: unresolvedSummaries,
    };
  }

  /**
   * Applies manual entity resolution fixes submitted by the user.
   * Each fix maps a call to an account, or creates a new account.
   */
  async applyEntityResolutionFixes(
    organizationId: string,
    fixes: EntityResolutionFix[]
  ): Promise<{ applied: number }> {
    let applied = 0;

    for (const fix of fixes) {
      // Verify the call belongs to this org and the account exists
      const call = await this.prisma.call.findFirst({
        where: { id: fix.callId, organizationId },
      });

      if (!call) continue;

      const account = await this.prisma.account.findFirst({
        where: { id: fix.accountId, organizationId },
      });

      if (!account) continue;

      await this.prisma.call.update({
        where: { id: fix.callId },
        data: { accountId: fix.accountId },
      });

      applied++;
    }

    return { applied };
  }

  /**
   * Completes Step 3 after the user has reviewed the sync.
   */
  async completeAccountSyncReview(organizationId: string): Promise<void> {
    const totalAccounts = await this.prisma.account.count({
      where: { organizationId },
    });

    const unresolvedCount = await this.prisma.call.count({
      where: { organizationId, accountId: null },
    });

    await this.prisma.setupWizard.update({
      where: { organizationId },
      data: {
        syncedAccountCount: totalAccounts,
        unresolvedCount,
        syncReviewedAt: new Date(),
        currentStep: "PLAN",
      },
    });
  }

  // ── Step 4: Choose Plan ─────────────────────────────────────────────

  /**
   * Returns available plans with pricing details.
   */
  getAvailablePlans() {
    return [
      {
        id: "FREE_TRIAL" as Plan,
        name: "Free Trial",
        description: "14-day free trial with full access. No credit card required.",
        price: null,
        features: [
          "Up to 100 transcript minutes",
          "Unlimited landing pages",
          "Basic entity resolution",
          "Email support",
        ],
      },
      {
        id: "STARTER" as Plan,
        name: "Starter",
        description: "For small teams getting started with customer stories.",
        price: { amount: 99, currency: "USD", interval: "month" },
        features: [
          "Up to 500 transcript minutes/month",
          "Unlimited landing pages",
          "Advanced entity resolution",
          "CRM sync",
          "Priority email support",
        ],
      },
      {
        id: "PROFESSIONAL" as Plan,
        name: "Professional",
        description: "For growing teams that need advanced features.",
        price: { amount: 299, currency: "USD", interval: "month" },
        features: [
          "Up to 2,000 transcript minutes/month",
          "Unlimited landing pages",
          "Advanced entity resolution",
          "CRM sync + custom reports",
          "RAG chatbot connector",
          "Custom branding",
          "Priority support",
        ],
      },
      {
        id: "ENTERPRISE" as Plan,
        name: "Enterprise",
        description: "For organizations needing advanced controls at scale.",
        price: null, // configure enterprise Stripe price ID to enable checkout
        features: [
          "Unlimited transcript minutes",
          "Unlimited landing pages",
          "Advanced entity resolution",
          "Full CRM integration suite",
          "RAG chatbot connector",
          "Custom branding + SSO controls",
          "Advanced governance automation",
          "Expanded API and policy controls",
        ],
      },
    ];
  }

  /**
   * Completes Step 4 — sets the chosen plan on the org.
   * For paid plans, returns a Stripe checkout URL.
   */
  async completePlanSelection(
    organizationId: string,
    plan: Plan,
    stripe: {
      createCheckoutSession: (
        orgId: string,
        plan: Plan
      ) => Promise<string | null>;
    }
  ): Promise<{ checkoutUrl: string | null }> {
    const isFreeTrial = plan === "FREE_TRIAL";
    const trialEndsAt = new Date(
      Date.now() + 14 * 24 * 60 * 60 * 1000
    );

    await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        // For paid plans, keep org on FREE_TRIAL until Stripe confirms payment.
        plan: "FREE_TRIAL",
        trialEndsAt,
      },
    });

    // For paid plans, create a Stripe checkout session before advancing.
    let checkoutUrl: string | null = null;
    let nextStep: "PLAN" | "PERMISSIONS" = "PERMISSIONS";
    if (!isFreeTrial) {
      checkoutUrl = await stripe.createCheckoutSession(organizationId, plan);
      if (!checkoutUrl) {
        throw new Error(
          "Selected plan is not configured for self-serve checkout."
        );
      }
      nextStep = "PLAN";
    }

    // Record selection in wizard
    await this.prisma.setupWizard.update({
      where: { organizationId },
      data: {
        selectedPlan: plan,
        currentStep: nextStep,
      },
    });

    return { checkoutUrl };
  }

  // ── Step 5: Set Default Permissions ─────────────────────────────────

  /**
   * Configures default landing page permissions for the org.
   */
  async completePermissionsSetup(
    organizationId: string,
    config: {
      defaultPageVisibility: "PRIVATE" | "SHARED_WITH_LINK";
      allowedPublishers: UserRole[];
      requireApprovalToPublish: boolean;
    }
  ): Promise<void> {
    // Upsert OrgSettings with the chosen defaults
    await this.prisma.orgSettings.upsert({
      where: { organizationId },
      create: {
        organizationId,
        landingPagesEnabled: true,
        defaultPageVisibility: config.defaultPageVisibility,
        allowedPublishers: config.allowedPublishers,
        requireApprovalToPublish: config.requireApprovalToPublish,
      },
      update: {
        defaultPageVisibility: config.defaultPageVisibility,
        allowedPublishers: config.allowedPublishers,
        requireApprovalToPublish: config.requireApprovalToPublish,
      },
    });

    // Mark wizard step complete
    await this.prisma.setupWizard.update({
      where: { organizationId },
      data: {
        permissionsConfiguredAt: new Date(),
        currentStep: "COMPLETED",
        completedAt: new Date(),
      },
    });
  }

  // ── Skip / Navigation ───────────────────────────────────────────────

  /**
   * Allows skipping a step (e.g., skip CRM connection for now).
   * Advances to the next step without recording configuration.
   */
  async skipStep(
    organizationId: string,
    step: SetupWizardStep
  ): Promise<void> {
    const stepOrder: SetupWizardStep[] = [
      "RECORDING_PROVIDER",
      "CRM",
      "ACCOUNT_SYNC",
      "PLAN",
      "PERMISSIONS",
      "COMPLETED",
    ];

    const currentIdx = stepOrder.indexOf(step);
    if (currentIdx === -1 || currentIdx >= stepOrder.length - 1) {
      throw new Error(`Cannot skip step: ${step}`);
    }

    const nextStep = stepOrder[currentIdx + 1];

    // If skipping to COMPLETED, also set completedAt
    const updateData: Record<string, unknown> = { currentStep: nextStep };
    if (nextStep === "COMPLETED") {
      updateData.completedAt = new Date();
    }

    await this.prisma.setupWizard.update({
      where: { organizationId },
      data: updateData,
    });
  }
}
