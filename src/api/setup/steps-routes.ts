import {
  type CRMProvider,
  type CallProvider,
  type Plan,
  type UserRole,
} from "@prisma/client";
import type { Response } from "express";
import { sendSuccess, sendUnauthorized } from "../_shared/responses.js";
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
import logger from "../../lib/logger.js";
import { asyncHandler } from "../../lib/async-handler.js";

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
  router.post("/step/recording-provider", asyncHandler(async (req: AuthReq, res: Response) => {
    if (!req.organizationId!) {
      sendUnauthorized(res);
      return;
    }
    if (!requireSetupAdmin(req, res)) return;

      const linkToken = await wizardService.initRecordingProviderLink(req.organizationId!);
      sendSuccess(res, linkToken);
    
  }));

  router.post(
    "/step/recording-provider/complete",
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!req.organizationId!) {
        sendUnauthorized(res);
        return;
      }
      if (!requireSetupAdmin(req, res)) return;

      const payload = parseRequestBody(CompleteRecordingProviderSchema, req.body, res);
      if (!payload) {
        return;
      }

        await wizardService.completeRecordingProvider(
          req.organizationId!,
          payload.provider as CallProvider,
          payload.merge_linked_account_id
        );

        const status = await wizardService.getStatus(req.organizationId!);
        sendSuccess(res, { completed: true, status });
      
    }
  ));

  router.post("/step/crm", asyncHandler(async (req: AuthReq, res: Response) => {
    if (!req.organizationId!) {
      sendUnauthorized(res);
      return;
    }
    if (!requireSetupAdmin(req, res)) return;

      const linkToken = await wizardService.initCrmLink(req.organizationId!);
      sendSuccess(res, linkToken);
    
  }));

  router.post("/step/crm/complete", asyncHandler(async (req: AuthReq, res: Response) => {
    if (!req.organizationId!) {
      sendUnauthorized(res);
      return;
    }
    if (!requireSetupAdmin(req, res)) return;

    const payload = parseRequestBody(CompleteCrmSchema, req.body, res);
    if (!payload) {
      return;
    }

      await wizardService.completeCrmConnection(
        req.organizationId!,
        payload.crm_provider as CRMProvider,
        payload.merge_linked_account_id
      );

      const status = await wizardService.getStatus(req.organizationId!);
      sendSuccess(res, { completed: true, status });
    
  }));

  router.get("/step/account-sync", asyncHandler(async (req: AuthReq, res: Response) => {
    if (!req.organizationId!) {
      sendUnauthorized(res);
      return;
    }
    if (!requireSetupAdmin(req, res)) return;

      const preview = await wizardService.getAccountSyncPreview(req.organizationId!);
      sendSuccess(res, preview);
    
  }));

  router.post("/step/account-sync/resolve", asyncHandler(async (req: AuthReq, res: Response) => {
    if (!req.organizationId!) {
      sendUnauthorized(res);
      return;
    }
    if (!requireSetupAdmin(req, res)) return;

    const payload = parseRequestBody(EntityResolutionFixSchema, req.body, res);
    if (!payload) {
      return;
    }

      const result = await wizardService.applyEntityResolutionFixes(
        req.organizationId!,
        payload.fixes.map((fix) => ({
          callId: fix.call_id,
          accountId: fix.account_id,
        }))
      );
      sendSuccess(res, result);
    
  }));

  router.post("/step/account-sync/complete", asyncHandler(async (req: AuthReq, res: Response) => {
    if (!req.organizationId!) {
      sendUnauthorized(res);
      return;
    }
    if (!requireSetupAdmin(req, res)) return;

      await wizardService.completeAccountSyncReview(req.organizationId!);
      const status = await wizardService.getStatus(req.organizationId!);
      sendSuccess(res, { completed: true, status });
    
  }));

  router.get("/step/plan", asyncHandler(async (_req: AuthReq, res: Response) => {
    const plans = wizardService.getAvailablePlans();
    sendSuccess(res, {
      plans,
      billing_enabled: isBillingEnabled(),
    });
  }));

  router.post("/step/plan", asyncHandler(async (req: AuthReq, res: Response) => {
    if (!req.organizationId!) {
      sendUnauthorized(res);
      return;
    }
    if (!requireSetupAdmin(req, res)) return;

    if (!isBillingEnabled()) {

      const result = await wizardService.completePlanSelection(
      req.organizationId!,
      "FREE_TRIAL" as Plan,
      {
        createCheckoutSession: async () => null,
      }
      );

      await prisma.organization.update({
      where: { id: req.organizationId! },
      data: { trialEndsAt: null },
      });

      const status = await wizardService.getStatus(req.organizationId!);
      sendSuccess(res, {
      completed: true,
      checkoutUrl: result.checkoutUrl,
      billing_enabled: false,
      status,
      });
      
      return;
    }

    const payload = parseRequestBody(SelectPlanSchema, req.body, res);
    if (!payload) {
      return;
    }

    try {
      const result = await wizardService.completePlanSelection(
        req.organizationId!,
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

      const status = await wizardService.getStatus(req.organizationId!);
      sendSuccess(res, {
        completed: true,
        checkoutUrl: result.checkoutUrl,
        status,
      });
    } catch (err) {
      logger.error("Plan selection error", { error: err });
      const message =
        err instanceof Error ? err.message : "Failed to complete plan selection";
      const statusCode = message.includes("not configured") ? 400 : 500;
      res.status(statusCode).json({ error: message });
    }
  }));

  router.post("/step/permissions", asyncHandler(async (req: AuthReq, res: Response) => {
    if (!req.organizationId!) {
      sendUnauthorized(res);
      return;
    }
    if (!requireSetupAdmin(req, res)) return;

    const payload = parseRequestBody(PermissionsSchema, req.body, res);
    if (!payload) {
      return;
    }

      await wizardService.completePermissionsSetup(req.organizationId!, {
        defaultPageVisibility: payload.default_page_visibility,
        allowedPublishers: payload.allowed_publishers as UserRole[],
        requireApprovalToPublish: payload.require_approval_to_publish,
      });

      const status = await wizardService.getStatus(req.organizationId!);
      sendSuccess(res, { completed: true, status });
    
  }));

  router.post("/step/org-profile", asyncHandler(async (req: AuthReq, res: Response) => {
    if (!req.organizationId!) {
      sendUnauthorized(res);
      return;
    }
    if (!requireSetupAdmin(req, res)) return;

    const payload = parseRequestBody(OrgProfileSchema, req.body, res);
    if (!payload) {
      return;
    }

      const data = payload;
      await prisma.orgSettings.upsert({
        where: { organizationId: req.organizationId! },
        create: {
          organizationId: req.organizationId!,
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
      const status = await wizardService.getStatus(req.organizationId!);
      sendSuccess(res, { updated: true, status });
    
  }));

  router.post("/step/governance-defaults", asyncHandler(async (req: AuthReq, res: Response) => {
    if (!req.organizationId!) {
      sendUnauthorized(res);
      return;
    }
    if (!requireSetupAdmin(req, res)) return;

    const payload = parseRequestBody(GovernanceDefaultsSchema, req.body, res);
    if (!payload) {
      return;
    }

      const data = payload;
      await prisma.orgSettings.upsert({
        where: { organizationId: req.organizationId! },
        create: {
          organizationId: req.organizationId!,
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
      const status = await wizardService.getStatus(req.organizationId!);
      sendSuccess(res, { updated: true, status });
    
  }));

  router.post("/step/role-presets", asyncHandler(async (req: AuthReq, res: Response) => {
    if (!req.organizationId!) {
      sendUnauthorized(res);
      return;
    }
    if (!requireSetupAdmin(req, res)) return;

      await roleProfiles.ensurePresetRoles(req.organizationId!);
      const status = await wizardService.getStatus(req.organizationId!);
      sendSuccess(res, { updated: true, status });
    
  }));

  router.post("/skip", asyncHandler(async (req: AuthReq, res: Response) => {
    if (!req.organizationId!) {
      sendUnauthorized(res);
      return;
    }
    if (!requireSetupAdmin(req, res)) return;

    const payload = parseRequestBody(SkipStepSchema, req.body, res);
    if (!payload) {
      return;
    }

      await wizardService.skipStep(req.organizationId!, payload.step);
      const status = await wizardService.getStatus(req.organizationId!);
      sendSuccess(res, { skipped: true, status });
    
  }));
}
