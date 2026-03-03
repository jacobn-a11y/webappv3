import {
  type CRMProvider,
  type CallProvider,
  type Plan,
  type UserRole,
} from "@prisma/client";
import type { Response } from "express";
import { respondAuthRequired } from "../_shared/errors.js";
import { parseRequestBody } from "../_shared/validators.js";
import { isBillingEnabled } from "../../middleware/billing.js";
import { getStripePriceId } from "../../config/stripe-plans.js";
import { buildPublicAppUrl } from "../../lib/public-app-url.js";
import {
  CompleteCrmSchema,
  CompleteRecordingProviderSchema,
  EntityResolutionFixSchema,
  GovernanceDefaultsSchema,
  OrgProfileSchema,
  PermissionsSchema,
  SelectPlanSchema,
  SkipStepSchema,
} from "./schemas.js";
import type { AuthReq, SetupRouteContext } from "./types.js";

export function registerSetupStepRoutes({
  prisma,
  requireSetupAdmin,
  roleProfiles,
  router,
  stripe,
  wizardService,
}: Pick<
  SetupRouteContext,
  "prisma" | "requireSetupAdmin" | "roleProfiles" | "router" | "stripe" | "wizardService"
>): void {
  router.post("/step/recording-provider", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      respondAuthRequired(res);
      return;
    }
    if (!requireSetupAdmin(req, res)) return;

    try {
      const linkToken = await wizardService.initRecordingProviderLink(req.organizationId);
      res.json(linkToken);
    } catch (err) {
      console.error("Recording provider link error:", err);
      res.status(500).json({ error: "Failed to create Merge.dev link session" });
    }
  });

  router.post(
    "/step/recording-provider/complete",
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        respondAuthRequired(res);
        return;
      }
      if (!requireSetupAdmin(req, res)) return;

      const payload = parseRequestBody(CompleteRecordingProviderSchema, req.body, res);
      if (!payload) {
        return;
      }

      try {
        await wizardService.completeRecordingProvider(
          req.organizationId,
          payload.provider as CallProvider,
          payload.merge_linked_account_id
        );

        const status = await wizardService.getStatus(req.organizationId);
        res.json({ completed: true, status });
      } catch (err) {
        console.error("Complete recording provider error:", err);
        res.status(500).json({ error: "Failed to complete recording provider setup" });
      }
    }
  );

  router.post("/step/crm", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      respondAuthRequired(res);
      return;
    }
    if (!requireSetupAdmin(req, res)) return;

    try {
      const linkToken = await wizardService.initCrmLink(req.organizationId);
      res.json(linkToken);
    } catch (err) {
      console.error("CRM link error:", err);
      res.status(500).json({ error: "Failed to create Merge.dev CRM link session" });
    }
  });

  router.post("/step/crm/complete", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      respondAuthRequired(res);
      return;
    }
    if (!requireSetupAdmin(req, res)) return;

    const payload = parseRequestBody(CompleteCrmSchema, req.body, res);
    if (!payload) {
      return;
    }

    try {
      await wizardService.completeCrmConnection(
        req.organizationId,
        payload.crm_provider as CRMProvider,
        payload.merge_linked_account_id
      );

      const status = await wizardService.getStatus(req.organizationId);
      res.json({ completed: true, status });
    } catch (err) {
      console.error("Complete CRM error:", err);
      res.status(500).json({ error: "Failed to complete CRM setup" });
    }
  });

  router.get("/step/account-sync", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      respondAuthRequired(res);
      return;
    }
    if (!requireSetupAdmin(req, res)) return;

    try {
      const preview = await wizardService.getAccountSyncPreview(req.organizationId);
      res.json(preview);
    } catch (err) {
      console.error("Account sync preview error:", err);
      res.status(500).json({ error: "Failed to load account sync preview" });
    }
  });

  router.post("/step/account-sync/resolve", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      respondAuthRequired(res);
      return;
    }
    if (!requireSetupAdmin(req, res)) return;

    const payload = parseRequestBody(EntityResolutionFixSchema, req.body, res);
    if (!payload) {
      return;
    }

    try {
      const result = await wizardService.applyEntityResolutionFixes(
        req.organizationId,
        payload.fixes.map((fix) => ({
          callId: fix.call_id,
          accountId: fix.account_id,
        }))
      );
      res.json(result);
    } catch (err) {
      console.error("Entity resolution fix error:", err);
      res.status(500).json({ error: "Failed to apply entity resolution fixes" });
    }
  });

  router.post("/step/account-sync/complete", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      respondAuthRequired(res);
      return;
    }
    if (!requireSetupAdmin(req, res)) return;

    try {
      await wizardService.completeAccountSyncReview(req.organizationId);
      const status = await wizardService.getStatus(req.organizationId);
      res.json({ completed: true, status });
    } catch (err) {
      console.error("Complete account sync error:", err);
      res.status(500).json({ error: "Failed to complete account sync review" });
    }
  });

  router.get("/step/plan", async (_req: AuthReq, res: Response) => {
    const plans = wizardService.getAvailablePlans();
    res.json({
      plans,
      billing_enabled: isBillingEnabled(),
    });
  });

  router.post("/step/plan", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      respondAuthRequired(res);
      return;
    }
    if (!requireSetupAdmin(req, res)) return;

    if (!isBillingEnabled()) {
      try {
        const result = await wizardService.completePlanSelection(
          req.organizationId,
          "FREE_TRIAL" as Plan,
          {
            createCheckoutSession: async () => null,
          }
        );

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

    const payload = parseRequestBody(SelectPlanSchema, req.body, res);
    if (!payload) {
      return;
    }

    try {
      const result = await wizardService.completePlanSelection(
        req.organizationId,
        payload.plan as Plan,
        {
          createCheckoutSession: async (orgId: string, plan: Plan) => {
            const org = await prisma.organization.findUnique({ where: { id: orgId } });
            if (!org) return null;

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

  router.post("/step/permissions", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      respondAuthRequired(res);
      return;
    }
    if (!requireSetupAdmin(req, res)) return;

    const payload = parseRequestBody(PermissionsSchema, req.body, res);
    if (!payload) {
      return;
    }

    try {
      await wizardService.completePermissionsSetup(req.organizationId, {
        defaultPageVisibility: payload.default_page_visibility,
        allowedPublishers: payload.allowed_publishers as UserRole[],
        requireApprovalToPublish: payload.require_approval_to_publish,
      });

      const status = await wizardService.getStatus(req.organizationId);
      res.json({ completed: true, status });
    } catch (err) {
      console.error("Permissions setup error:", err);
      res.status(500).json({ error: "Failed to configure permissions" });
    }
  });

  router.post("/step/org-profile", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      respondAuthRequired(res);
      return;
    }
    if (!requireSetupAdmin(req, res)) return;

    const payload = parseRequestBody(OrgProfileSchema, req.body, res);
    if (!payload) {
      return;
    }

    try {
      const data = payload;
      await prisma.orgSettings.upsert({
        where: { organizationId: req.organizationId },
        create: {
          organizationId: req.organizationId,
          storyContext: {
            companyOverview: data.company_overview ?? "",
            products: data.products ?? [],
            targetPersonas: data.target_personas ?? [],
            targetIndustries: data.target_industries ?? [],
          },
        },
        update: {
          storyContext: {
            companyOverview: data.company_overview ?? "",
            products: data.products ?? [],
            targetPersonas: data.target_personas ?? [],
            targetIndustries: data.target_industries ?? [],
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

  router.post("/step/governance-defaults", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      respondAuthRequired(res);
      return;
    }
    if (!requireSetupAdmin(req, res)) return;

    const payload = parseRequestBody(GovernanceDefaultsSchema, req.body, res);
    if (!payload) {
      return;
    }

    try {
      const data = payload;
      await prisma.orgSettings.upsert({
        where: { organizationId: req.organizationId },
        create: {
          organizationId: req.organizationId,
          dataGovernancePolicy: {
            retention_days: data.retention_days ?? 365,
            audit_log_retention_days: data.audit_log_retention_days ?? 365,
            legal_hold_enabled: data.legal_hold_enabled ?? false,
            pii_export_enabled: data.pii_export_enabled ?? true,
            deletion_requires_approval: data.deletion_requires_approval ?? true,
            allow_named_story_exports: data.allow_named_story_exports ?? false,
            rto_target_minutes: data.rto_target_minutes ?? 240,
            rpo_target_minutes: data.rpo_target_minutes ?? 60,
          },
        },
        update: {
          dataGovernancePolicy: {
            retention_days: data.retention_days ?? 365,
            audit_log_retention_days: data.audit_log_retention_days ?? 365,
            legal_hold_enabled: data.legal_hold_enabled ?? false,
            pii_export_enabled: data.pii_export_enabled ?? true,
            deletion_requires_approval: data.deletion_requires_approval ?? true,
            allow_named_story_exports: data.allow_named_story_exports ?? false,
            rto_target_minutes: data.rto_target_minutes ?? 240,
            rpo_target_minutes: data.rpo_target_minutes ?? 60,
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

  router.post("/step/role-presets", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      respondAuthRequired(res);
      return;
    }
    if (!requireSetupAdmin(req, res)) return;

    try {
      await roleProfiles.ensurePresetRoles(req.organizationId);
      const status = await wizardService.getStatus(req.organizationId);
      res.json({ updated: true, status });
    } catch (err) {
      console.error("Role presets setup error:", err);
      res.status(500).json({ error: "Failed to apply role presets" });
    }
  });

  router.post("/skip", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      respondAuthRequired(res);
      return;
    }
    if (!requireSetupAdmin(req, res)) return;

    const payload = parseRequestBody(SkipStepSchema, req.body, res);
    if (!payload) {
      return;
    }

    try {
      await wizardService.skipStep(req.organizationId, payload.step);
      const status = await wizardService.getStatus(req.organizationId);
      res.json({ skipped: true, status });
    } catch (err) {
      console.error("Skip step error:", err);
      res.status(500).json({ error: "Failed to skip step" });
    }
  });
}
