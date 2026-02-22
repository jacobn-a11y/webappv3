/**
 * Connections Setup Wizard Routes
 *
 * First-run onboarding flow for new organizations:
 *
 *   GET  /api/setup/status                    — Current wizard state
 *   POST /api/setup/step/recording-provider   — Step 1: Init Merge.dev Link for recordings
 *   POST /api/setup/step/recording-provider/complete — Step 1: Complete after Merge Link
 *   POST /api/setup/step/crm                  — Step 2: Init Merge.dev Link for CRM
 *   POST /api/setup/step/crm/complete         — Step 2: Complete after CRM Link
 *   GET  /api/setup/step/account-sync         — Step 3: Preview account sync
 *   POST /api/setup/step/account-sync/resolve — Step 3: Fix entity resolution mismatches
 *   POST /api/setup/step/account-sync/complete — Step 3: Mark sync review done
 *   GET  /api/setup/step/plan                 — Step 4: List available plans
 *   POST /api/setup/step/plan                 — Step 4: Choose plan
 *   POST /api/setup/step/permissions          — Step 5: Set default permissions
 *   POST /api/setup/skip                      — Skip the current step
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { PrismaClient, UserRole, CallProvider, CRMProvider, Plan } from "@prisma/client";
import Stripe from "stripe";
import { SetupWizardService } from "../services/setup-wizard.js";
import { RoleProfileService } from "../services/role-profiles.js";
import { isBillingEnabled } from "../middleware/billing.js";
import { getStripePriceId } from "../config/stripe-plans.js";
import { buildPublicAppUrl } from "../lib/public-app-url.js";

// ─── Validation Schemas ──────────────────────────────────────────────────────

const CompleteRecordingProviderSchema = z.object({
  provider: z.enum([
    "GONG", "CHORUS", "ZOOM", "GOOGLE_MEET", "TEAMS",
    "FIREFLIES", "DIALPAD", "AIRCALL", "RINGCENTRAL",
    "SALESLOFT", "OUTREACH", "OTHER",
  ]),
  merge_linked_account_id: z.string().min(1),
});

const CompleteCrmSchema = z.object({
  crm_provider: z.enum(["SALESFORCE", "HUBSPOT"]),
  merge_linked_account_id: z.string().min(1),
});

const EntityResolutionFixSchema = z.object({
  fixes: z.array(
    z.object({
      call_id: z.string().min(1),
      account_id: z.string().min(1),
    })
  ),
});

const SelectPlanSchema = z.object({
  plan: z.enum(["FREE_TRIAL", "STARTER", "PROFESSIONAL", "ENTERPRISE"]),
});

const PermissionsSchema = z.object({
  default_page_visibility: z.enum(["PRIVATE", "SHARED_WITH_LINK"]),
  allowed_publishers: z.array(
    z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"])
  ),
  require_approval_to_publish: z.boolean(),
});

const OrgProfileSchema = z.object({
  company_overview: z.string().max(5000).optional(),
  products: z.array(z.string().min(1).max(200)).optional(),
  target_personas: z.array(z.string().min(1).max(120)).optional(),
  target_industries: z.array(z.string().min(1).max(120)).optional(),
});

const GovernanceDefaultsSchema = z.object({
  retention_days: z.number().int().min(30).max(3650).optional(),
  audit_log_retention_days: z.number().int().min(30).max(3650).optional(),
  legal_hold_enabled: z.boolean().optional(),
  pii_export_enabled: z.boolean().optional(),
  deletion_requires_approval: z.boolean().optional(),
  allow_named_story_exports: z.boolean().optional(),
  rto_target_minutes: z.number().int().min(5).max(60 * 24 * 14).optional(),
  rpo_target_minutes: z.number().int().min(5).max(60 * 24 * 14).optional(),
});

const SkipStepSchema = z.object({
  step: z.enum([
    "RECORDING_PROVIDER", "CRM", "ACCOUNT_SYNC", "PLAN", "PERMISSIONS",
  ]),
});

// ─── Auth Request Type ───────────────────────────────────────────────────────

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createSetupRoutes(
  prisma: PrismaClient,
  stripe: Stripe
): Router {
  const router = Router();
  const wizardService = new SetupWizardService(prisma);
  const roleProfiles = new RoleProfileService(prisma);

  // ── GET /api/setup/status ─────────────────────────────────────────

  /**
   * Returns the current wizard state for the authenticated org.
   * Use this to determine which step to show the user.
   */
  router.get("/status", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const status = await wizardService.getStatus(req.organizationId);
      res.json(status);
    } catch (err) {
      console.error("Setup status error:", err);
      res.status(500).json({ error: "Failed to load setup status" });
    }
  });

  // ── Step 1: Recording Provider ────────────────────────────────────

  /**
   * POST /api/setup/step/recording-provider
   *
   * Initiates the Merge.dev Link flow for connecting a recording provider.
   * Returns a link_token the frontend uses to open the Merge Link modal.
   */
  router.post(
    "/step/recording-provider",
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        const linkToken = await wizardService.initRecordingProviderLink(
          req.organizationId
        );
        res.json(linkToken);
      } catch (err) {
        console.error("Recording provider link error:", err);
        res.status(500).json({ error: "Failed to create Merge.dev link session" });
      }
    }
  );

  /**
   * POST /api/setup/step/recording-provider/complete
   *
   * Called after the user finishes the Merge Link flow for recordings.
   * Records the provider choice and linked account, then advances to Step 2.
   */
  router.post(
    "/step/recording-provider/complete",
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const parse = CompleteRecordingProviderSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({
          error: "validation_error",
          details: parse.error.issues,
        });
        return;
      }

      try {
        await wizardService.completeRecordingProvider(
          req.organizationId,
          parse.data.provider as CallProvider,
          parse.data.merge_linked_account_id
        );

        const status = await wizardService.getStatus(req.organizationId);
        res.json({ completed: true, status });
      } catch (err) {
        console.error("Complete recording provider error:", err);
        res.status(500).json({ error: "Failed to complete recording provider setup" });
      }
    }
  );

  // ── Step 2: CRM Connection ────────────────────────────────────────

  /**
   * POST /api/setup/step/crm
   *
   * Initiates the Merge.dev Link flow for connecting a CRM (Salesforce or HubSpot).
   * Returns a link_token for the frontend.
   */
  router.post("/step/crm", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const linkToken = await wizardService.initCrmLink(req.organizationId);
      res.json(linkToken);
    } catch (err) {
      console.error("CRM link error:", err);
      res.status(500).json({ error: "Failed to create Merge.dev CRM link session" });
    }
  });

  /**
   * POST /api/setup/step/crm/complete
   *
   * Called after the user finishes the CRM Merge Link flow.
   * Records the CRM provider and linked account, then advances to Step 3.
   */
  router.post("/step/crm/complete", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const parse = CompleteCrmSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        error: "validation_error",
        details: parse.error.issues,
      });
      return;
    }

    try {
      await wizardService.completeCrmConnection(
        req.organizationId,
        parse.data.crm_provider as CRMProvider,
        parse.data.merge_linked_account_id
      );

      const status = await wizardService.getStatus(req.organizationId);
      res.json({ completed: true, status });
    } catch (err) {
      console.error("Complete CRM error:", err);
      res.status(500).json({ error: "Failed to complete CRM setup" });
    }
  });

  // ── Step 3: Account Sync Review ───────────────────────────────────

  /**
   * GET /api/setup/step/account-sync
   *
   * Returns a preview of the initial account sync. Shows:
   *   - Total accounts synced from CRM
   *   - Calls matched to accounts (resolved)
   *   - Unmatched calls with suggested matches (for manual review)
   */
  router.get("/step/account-sync", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const preview = await wizardService.getAccountSyncPreview(
        req.organizationId
      );
      res.json(preview);
    } catch (err) {
      console.error("Account sync preview error:", err);
      res.status(500).json({ error: "Failed to load account sync preview" });
    }
  });

  /**
   * POST /api/setup/step/account-sync/resolve
   *
   * Applies manual entity resolution fixes. The user maps unmatched calls
   * to the correct accounts.
   */
  router.post(
    "/step/account-sync/resolve",
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const parse = EntityResolutionFixSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({
          error: "validation_error",
          details: parse.error.issues,
        });
        return;
      }

      try {
        const result = await wizardService.applyEntityResolutionFixes(
          req.organizationId,
          parse.data.fixes.map((f) => ({
            callId: f.call_id,
            accountId: f.account_id,
          }))
        );
        res.json(result);
      } catch (err) {
        console.error("Entity resolution fix error:", err);
        res.status(500).json({ error: "Failed to apply entity resolution fixes" });
      }
    }
  );

  /**
   * POST /api/setup/step/account-sync/complete
   *
   * Marks the account sync review as done and advances to Step 4.
   */
  router.post(
    "/step/account-sync/complete",
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        await wizardService.completeAccountSyncReview(req.organizationId);
        const status = await wizardService.getStatus(req.organizationId);
        res.json({ completed: true, status });
      } catch (err) {
        console.error("Complete account sync error:", err);
        res.status(500).json({ error: "Failed to complete account sync review" });
      }
    }
  );

  // ── Step 4: Plan Selection ────────────────────────────────────────

  /**
   * GET /api/setup/step/plan
   *
   * Returns available plans with pricing and feature details.
   * When billing is disabled, indicates that the plan step is
   * informational only and will be auto-completed.
   */
  router.get("/step/plan", async (_req: AuthReq, res: Response) => {
    const plans = wizardService.getAvailablePlans();
    res.json({
      plans,
      billing_enabled: isBillingEnabled(),
    });
  });

  /**
   * POST /api/setup/step/plan
   *
   * Selects a plan. For paid plans, returns a Stripe checkout URL.
   * For FREE_TRIAL, activates the 14-day trial immediately.
   *
   * When BILLING_ENABLED is not "true", the step auto-completes as
   * FREE_TRIAL with no trial expiration (internal use mode).
   */
  router.post("/step/plan", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    // When billing is disabled, auto-complete with FREE_TRIAL and no expiration
    if (!isBillingEnabled()) {
      try {
        const result = await wizardService.completePlanSelection(
          req.organizationId,
          "FREE_TRIAL" as Plan,
          {
            createCheckoutSession: async () => null,
          }
        );

        // Remove trial expiration so internal users are never gated
        await prisma.organization.update({
          where: { id: req.organizationId },
          data: { trialEndsAt: null },
        });

        const status = await wizardService.getStatus(req.organizationId);
        res.json({
          completed: true,
          checkoutUrl: result.checkoutUrl,
          billing_enabled: false,
          status,
        });
      } catch (err) {
        console.error("Plan selection error (billing disabled):", err);
        res.status(500).json({ error: "Failed to complete plan selection" });
      }
      return;
    }

    const parse = SelectPlanSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        error: "validation_error",
        details: parse.error.issues,
      });
      return;
    }

    try {
      const result = await wizardService.completePlanSelection(
        req.organizationId,
        parse.data.plan as Plan,
        {
          createCheckoutSession: async (orgId: string, plan: Plan) => {
            const org = await prisma.organization.findUnique({
              where: { id: orgId },
            });

            if (!org) return null;

            // Create or retrieve Stripe customer
            let customerId = org.stripeCustomerId;
            if (!customerId) {
              const customer = await stripe.customers.create({
                metadata: {
                  organizationId: orgId,
                  organizationName: org.name,
                },
              });
              customerId = customer.id;
              await prisma.organization.update({
                where: { id: orgId },
                data: { stripeCustomerId: customerId },
              });
            }

            if (plan === "FREE_TRIAL") return null;
            const priceId = getStripePriceId(plan);
            if (!priceId) return null;

            const session = await stripe.checkout.sessions.create({
              customer: customerId,
              mode: "subscription",
              line_items: [{ price: priceId }],
              success_url: buildPublicAppUrl("/admin/setup?checkout=success"),
              cancel_url: buildPublicAppUrl("/admin/setup?checkout=canceled"),
              subscription_data: {
                metadata: { organizationId: orgId, plan },
              },
            });

            return session.url;
          },
        }
      );

      const status = await wizardService.getStatus(req.organizationId);
      res.json({
        completed: true,
        checkoutUrl: result.checkoutUrl,
        status,
      });
    } catch (err) {
      console.error("Plan selection error:", err);
      const message =
        err instanceof Error ? err.message : "Failed to complete plan selection";
      const statusCode = message.includes("not configured") ? 400 : 500;
      res.status(statusCode).json({ error: message });
    }
  });

  // ── Step 5: Permissions ───────────────────────────────────────────

  /**
   * POST /api/setup/step/permissions
   *
   * Sets default landing page permissions for the org, completing the wizard.
   */
  router.post("/step/permissions", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const parse = PermissionsSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        error: "validation_error",
        details: parse.error.issues,
      });
      return;
    }

    try {
      await wizardService.completePermissionsSetup(req.organizationId, {
        defaultPageVisibility: parse.data.default_page_visibility,
        allowedPublishers: parse.data.allowed_publishers as UserRole[],
        requireApprovalToPublish: parse.data.require_approval_to_publish,
      });

      const status = await wizardService.getStatus(req.organizationId);
      res.json({ completed: true, status });
    } catch (err) {
      console.error("Permissions setup error:", err);
      res.status(500).json({ error: "Failed to configure permissions" });
    }
  });

  // ── Step 6: Org Profile Context (Setup companion) ────────────────

  router.post("/step/org-profile", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const parse = OrgProfileSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "validation_error", details: parse.error.issues });
      return;
    }

    try {
      const d = parse.data;
      await prisma.orgSettings.upsert({
        where: { organizationId: req.organizationId },
        create: {
          organizationId: req.organizationId,
          storyContext: {
            companyOverview: d.company_overview ?? "",
            products: d.products ?? [],
            targetPersonas: d.target_personas ?? [],
            targetIndustries: d.target_industries ?? [],
          },
        },
        update: {
          storyContext: {
            companyOverview: d.company_overview ?? "",
            products: d.products ?? [],
            targetPersonas: d.target_personas ?? [],
            targetIndustries: d.target_industries ?? [],
          },
        },
      });
      const status = await wizardService.getStatus(req.organizationId);
      res.json({ updated: true, status });
    } catch (err) {
      console.error("Org profile setup error:", err);
      res.status(500).json({ error: "Failed to save org profile setup" });
    }
  });

  // ── Step 7: Governance Defaults (Setup companion) ────────────────

  router.post("/step/governance-defaults", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const parse = GovernanceDefaultsSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "validation_error", details: parse.error.issues });
      return;
    }
    try {
      const d = parse.data;
      await prisma.orgSettings.upsert({
        where: { organizationId: req.organizationId },
        create: {
          organizationId: req.organizationId,
          dataGovernancePolicy: {
            retention_days: d.retention_days ?? 365,
            audit_log_retention_days: d.audit_log_retention_days ?? 365,
            legal_hold_enabled: d.legal_hold_enabled ?? false,
            pii_export_enabled: d.pii_export_enabled ?? true,
            deletion_requires_approval: d.deletion_requires_approval ?? true,
            allow_named_story_exports: d.allow_named_story_exports ?? false,
            rto_target_minutes: d.rto_target_minutes ?? 240,
            rpo_target_minutes: d.rpo_target_minutes ?? 60,
          },
        },
        update: {
          dataGovernancePolicy: {
            retention_days: d.retention_days ?? 365,
            audit_log_retention_days: d.audit_log_retention_days ?? 365,
            legal_hold_enabled: d.legal_hold_enabled ?? false,
            pii_export_enabled: d.pii_export_enabled ?? true,
            deletion_requires_approval: d.deletion_requires_approval ?? true,
            allow_named_story_exports: d.allow_named_story_exports ?? false,
            rto_target_minutes: d.rto_target_minutes ?? 240,
            rpo_target_minutes: d.rpo_target_minutes ?? 60,
          },
        },
      });
      const status = await wizardService.getStatus(req.organizationId);
      res.json({ updated: true, status });
    } catch (err) {
      console.error("Governance defaults setup error:", err);
      res.status(500).json({ error: "Failed to save governance defaults" });
    }
  });

  // ── Step 8: Role Presets (Setup companion) ────────────────────────

  router.post("/step/role-presets", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    try {
      await roleProfiles.ensurePresetRoles(req.organizationId);
      const status = await wizardService.getStatus(req.organizationId);
      res.json({ updated: true, status });
    } catch (err) {
      console.error("Role presets setup error:", err);
      res.status(500).json({ error: "Failed to apply role presets" });
    }
  });

  // ── First-Value Workflow Companion ────────────────────────────────

  router.get("/first-value/recommendations", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    try {
      const [storyCount, pageCount, account] = await Promise.all([
        prisma.story.count({ where: { organizationId: req.organizationId } }),
        prisma.landingPage.count({
          where: { organizationId: req.organizationId, status: "PUBLISHED" },
        }),
        prisma.account.findFirst({
          where: { organizationId: req.organizationId },
          select: { id: true, name: true },
          orderBy: { updatedAt: "desc" },
        }),
      ]);

      const tasks: string[] = [];
      if (storyCount === 0) tasks.push("Generate your first story from a high-signal account.");
      if (pageCount === 0) tasks.push("Publish a landing page for sales enablement.");
      if (!account) tasks.push("Sync CRM and map at least one account before generation.");

      res.json({
        starter_story_templates: [
          {
            id: "before_after_transformation",
            label: "Before/After Transformation",
            funnel_stage: "BOFU",
          },
          {
            id: "roi_hard_outcomes",
            label: "ROI and Hard Financial Outcomes",
            funnel_stage: "BOFU",
          },
          {
            id: "implementation_time_to_value",
            label: "Implementation and Time-to-Value",
            funnel_stage: "MOFU",
          },
        ],
        suggested_account: account
          ? { id: account.id, name: account.name }
          : null,
        completion: {
          stories_generated: storyCount,
          pages_published: pageCount,
          first_value_complete: storyCount > 0 && pageCount > 0,
        },
        next_tasks: tasks,
      });
    } catch (err) {
      console.error("First-value recommendation error:", err);
      res.status(500).json({ error: "Failed to load first-value recommendations" });
    }
  });

  // ── Skip Step ─────────────────────────────────────────────────────

  /**
   * POST /api/setup/skip
   *
   * Skips the specified step and advances to the next one.
   * Useful for "I'll do this later" scenarios.
   */
  router.post("/skip", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const parse = SkipStepSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({
        error: "validation_error",
        details: parse.error.issues,
      });
      return;
    }

    try {
      await wizardService.skipStep(
        req.organizationId,
        parse.data.step
      );

      const status = await wizardService.getStatus(req.organizationId);
      res.json({ skipped: true, status });
    } catch (err) {
      console.error("Skip step error:", err);
      res.status(500).json({ error: "Failed to skip step" });
    }
  });

  return router;
}
