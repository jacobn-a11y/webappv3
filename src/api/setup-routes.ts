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
   */
  router.get("/step/plan", async (_req: AuthReq, res: Response) => {
    const plans = wizardService.getAvailablePlans();
    res.json({ plans });
  });

  /**
   * POST /api/setup/step/plan
   *
   * Selects a plan. For paid plans, returns a Stripe checkout URL.
   * For FREE_TRIAL, activates the 14-day trial immediately.
   * For ENTERPRISE, the user is directed to contact sales.
   */
  router.post("/step/plan", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
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
          createCheckoutSession: async (orgId: string, _plan: Plan) => {
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

            const priceId = process.env.STRIPE_FREE_TRIAL_PRICE_ID;
            if (!priceId) return null;

            const session = await stripe.checkout.sessions.create({
              customer: customerId,
              mode: "subscription",
              line_items: [{ price: priceId }],
              success_url: `${process.env.APP_URL}/setup?step=permissions&checkout=success`,
              cancel_url: `${process.env.APP_URL}/setup?step=plan&checkout=canceled`,
              subscription_data: {
                metadata: { organizationId: orgId },
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
      res.status(500).json({ error: "Failed to complete plan selection" });
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
