import type { UserRole } from "@prisma/client";
import type { Response } from "express";
import { requirePermission } from "../../middleware/permissions.js";
import { sendUnauthorized, sendSuccess, sendBadRequest } from "../_shared/responses.js";
import logger from "../../lib/logger.js";
import { parseRequestBody } from "../_shared/validators.js";
import { PROVIDER_MODELS, type AIProviderName } from "../../services/ai-client.js";
import { parseAIProviderName } from "../../services/provider-policy.js";
import {
  OrgAISettingsSchema,
  SetLimitSchema,
  SetRoleDefaultSchema,
  SetUserAccessSchema,
  UpsertProviderSchema,
  ValidateKeySchema,
} from "./schemas.js";
import type { AISettingsRouteContext, AuthReq } from "./types.js";
import { asyncHandler } from "../../lib/async-handler.js";

export function registerAISettingsAdminRoutes({
  configService,
  prisma,
  router,
  usageTracker,
}: AISettingsRouteContext): void {
  router.get(
    "/admin/settings",
    requirePermission(prisma, "manage_ai_settings"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res);
        return;
      }

        const settings = await prisma.orgAISettings.findUnique({
          where: { organizationId: req.organizationId },
        });

        sendSuccess(res, { settings: settings ?? null });
      
    }
  ));

  router.put(
    "/admin/settings",
    requirePermission(prisma, "manage_ai_settings"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      const payload = parseRequestBody(OrgAISettingsSchema, req.body, res);
      if (!payload) {
        return;
      }

      if (!req.organizationId) {
        sendUnauthorized(res);
        return;
      }

        await prisma.orgAISettings.upsert({
          where: { organizationId: req.organizationId },
          create: {
            organizationId: req.organizationId,
            defaultProvider: payload.default_provider,
            defaultModel: payload.default_model,
            perSeatTokenBudgetPerMonth: payload.per_seat_token_budget_per_month,
            perSeatStoriesPerMonth: payload.per_seat_stories_per_month,
            maxStoriesPerMonth: payload.max_stories_per_month,
          },
          update: {
            defaultProvider: payload.default_provider,
            defaultModel: payload.default_model,
            perSeatTokenBudgetPerMonth: payload.per_seat_token_budget_per_month,
            perSeatStoriesPerMonth: payload.per_seat_stories_per_month,
            maxStoriesPerMonth: payload.max_stories_per_month,
          },
        });

        sendSuccess(res, { saved: true });
      
    }
  ));

  router.get(
    "/admin/providers",
    requirePermission(prisma, "manage_ai_settings"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res);
        return;
      }

        const configs = await configService.listOrgConfigs(req.organizationId);

        sendSuccess(res, {
          providers: configs.map((config) => ({
            id: config.id,
            provider: config.provider,
            display_name: config.displayName,
            default_model: config.defaultModel,
            embedding_model: config.embeddingModel,
            is_default: config.isDefault,
            is_active: config.isActive,
            api_key_preview: config.apiKeyPreview,
            available_models: PROVIDER_MODELS[config.provider as AIProviderName] ?? [],
            created_at: config.createdAt,
            updated_at: config.updatedAt,
          })),
        });
      
    }
  ));

  router.post(
    "/admin/providers",
    requirePermission(prisma, "manage_ai_settings"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      const payload = parseRequestBody(UpsertProviderSchema, req.body, res);
      if (!payload) {
        return;
      }

      if (!req.organizationId) {
        sendUnauthorized(res);
        return;
      }

        const configId = await configService.upsertOrgConfig(req.organizationId, {
          provider: payload.provider as AIProviderName,
          apiKey: payload.api_key,
          displayName: payload.display_name,
          defaultModel: payload.default_model,
          embeddingModel: payload.embedding_model,
          isDefault: payload.is_default,
        });

        sendSuccess(res, { id: configId, saved: true });
      
    }
  ));

  router.post(
    "/admin/providers/validate",
    requirePermission(prisma, "manage_ai_settings"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      const payload = parseRequestBody(ValidateKeySchema, req.body, res);
      if (!payload) {
        return;
      }

        const result = await configService.validateApiKey(
          payload.provider as AIProviderName,
          payload.api_key
        );

        sendSuccess(res, result);
      
    }
  ));

  router.delete(
    "/admin/providers/:provider",
    requirePermission(prisma, "manage_ai_settings"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res);
        return;
      }

      const provider = parseAIProviderName(req.params.provider);
      if (!provider) {
        sendBadRequest(res, "Invalid provider");
        return;
      }

        await configService.deleteOrgConfig(req.organizationId, provider);
        sendSuccess(res, { deleted: true });
      
    }
  ));

  router.get(
    "/admin/role-defaults",
    requirePermission(prisma, "manage_ai_settings"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res);
        return;
      }

        const defaults = await prisma.orgAIRoleDefault.findMany({
          where: { organizationId: req.organizationId },
          orderBy: { role: "asc" },
        });

        sendSuccess(res, { role_defaults: defaults });
      
    }
  ));

  router.post(
    "/admin/role-defaults",
    requirePermission(prisma, "manage_ai_settings"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      const payload = parseRequestBody(SetRoleDefaultSchema, req.body, res);
      if (!payload) {
        return;
      }

      if (!req.organizationId) {
        sendUnauthorized(res);
        return;
      }

        await prisma.orgAIRoleDefault.upsert({
          where: {
            organizationId_role: {
              organizationId: req.organizationId,
              role: payload.role,
            },
          },
          create: {
            organizationId: req.organizationId,
            role: payload.role,
            allowedProviders: payload.allowed_providers ?? [],
            allowedModels: payload.allowed_models ?? [],
            maxTokensPerDay: payload.max_tokens_per_day,
            maxTokensPerMonth: payload.max_tokens_per_month,
            maxStoriesPerMonth: payload.max_stories_per_month,
            maxRequestsPerDay: payload.max_requests_per_day,
          },
          update: {
            allowedProviders: payload.allowed_providers,
            allowedModels: payload.allowed_models,
            maxTokensPerDay: payload.max_tokens_per_day,
            maxTokensPerMonth: payload.max_tokens_per_month,
            maxStoriesPerMonth: payload.max_stories_per_month,
            maxRequestsPerDay: payload.max_requests_per_day,
          },
        });

        sendSuccess(res, { saved: true });
      
    }
  ));

  router.delete(
    "/admin/role-defaults/:role",
    requirePermission(prisma, "manage_ai_settings"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res);
        return;
      }

        await prisma.orgAIRoleDefault.deleteMany({
          where: {
            organizationId: req.organizationId,
            role: req.params.role as UserRole,
          },
        });

        sendSuccess(res, { deleted: true });
      
    }
  ));

  router.get(
    "/admin/user-access",
    requirePermission(prisma, "manage_ai_settings"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res);
        return;
      }

        const access = await prisma.userAIAccess.findMany({
          where: { organizationId: req.organizationId },
          include: {
            user: { select: { id: true, name: true, email: true, role: true } },
          },
        });

        sendSuccess(res, { user_access: access });
      
    }
  ));

  router.post(
    "/admin/user-access",
    requirePermission(prisma, "manage_ai_settings"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      const payload = parseRequestBody(SetUserAccessSchema, req.body, res);
      if (!payload) {
        return;
      }

      if (!req.organizationId || !req.userId) {
        sendUnauthorized(res);
        return;
      }

        await prisma.userAIAccess.upsert({
          where: {
            organizationId_userId: {
              organizationId: req.organizationId,
              userId: payload.user_id,
            },
          },
          create: {
            organizationId: req.organizationId,
            userId: payload.user_id,
            allowedProviders: payload.allowed_providers ?? [],
            allowedModels: payload.allowed_models ?? [],
            deniedProviders: payload.denied_providers ?? [],
            deniedModels: payload.denied_models ?? [],
            grantedById: req.userId,
          },
          update: {
            allowedProviders: payload.allowed_providers,
            allowedModels: payload.allowed_models,
            deniedProviders: payload.denied_providers,
            deniedModels: payload.denied_models,
            grantedById: req.userId,
          },
        });

        sendSuccess(res, { saved: true });
      
    }
  ));

  router.delete(
    "/admin/user-access/:userId",
    requirePermission(prisma, "manage_ai_settings"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res);
        return;
      }

        await prisma.userAIAccess.deleteMany({
          where: {
            organizationId: req.organizationId,
            userId: req.params.userId as string,
          },
        });

        sendSuccess(res, { deleted: true });
      
    }
  ));

  router.get(
    "/admin/limits",
    requirePermission(prisma, "manage_ai_settings"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res);
        return;
      }

        const limits = await usageTracker.listLimits(req.organizationId);
        sendSuccess(res, {
          limits: limits.map((limit) => ({
            id: limit.id,
            user: limit.user
              ? { id: limit.user.id, name: limit.user.name, email: limit.user.email }
              : null,
            is_org_default: !limit.userId,
            max_tokens_per_day: limit.maxTokensPerDay,
            max_tokens_per_month: limit.maxTokensPerMonth,
            max_requests_per_day: limit.maxRequestsPerDay,
            max_requests_per_month: limit.maxRequestsPerMonth,
            max_stories_per_month: limit.maxStoriesPerMonth,
            warning_threshold_pct: limit.warningThresholdPct,
            created_at: limit.createdAt,
            updated_at: limit.updatedAt,
          })),
        });
      
    }
  ));

  router.post(
    "/admin/limits",
    requirePermission(prisma, "manage_ai_settings"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      const payload = parseRequestBody(SetLimitSchema, req.body, res);
      if (!payload) {
        return;
      }

      if (!req.organizationId) {
        sendUnauthorized(res);
        return;
      }

        await usageTracker.setLimit({
          organizationId: req.organizationId,
          userId: payload.user_id,
          maxTokensPerDay: payload.max_tokens_per_day,
          maxTokensPerMonth: payload.max_tokens_per_month,
          maxRequestsPerDay: payload.max_requests_per_day,
          maxRequestsPerMonth: payload.max_requests_per_month,
          maxStoriesPerMonth: payload.max_stories_per_month,
          warningThresholdPct: payload.warning_threshold_pct,
        });

        sendSuccess(res, { saved: true });
      
    }
  ));

  router.delete(
    "/admin/limits/:userId",
    requirePermission(prisma, "manage_ai_settings"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res);
        return;
      }

        const userId =
          req.params.userId === "org_default"
            ? undefined
            : (req.params.userId as string);

        await usageTracker.removeLimit(req.organizationId, userId);
        sendSuccess(res, { deleted: true });
      
    }
  ));

  router.get(
    "/admin/usage",
    requirePermission(prisma, "manage_ai_settings"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res);
        return;
      }

        const userId = req.query.user_id as string | undefined;
        const days = parseInt(req.query.days as string, 10) || 30;

        const records = await usageTracker.getUsageHistory(req.organizationId, userId, days);

        sendSuccess(res, {
          records: records.map((record) => ({
            id: record.id,
            user_id: record.userId,
            provider: record.provider,
            model: record.model,
            operation: record.operation,
            input_tokens: record.inputTokens,
            output_tokens: record.outputTokens,
            total_tokens: record.totalTokens,
            cost_cents: record.costCents,
            created_at: record.createdAt.toISOString(),
          })),
        });
      
    }
  ));

  router.get(
    "/admin/usage/summary",
    requirePermission(prisma, "manage_ai_settings"),
    asyncHandler(async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res);
        return;
      }

        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const byUser = await prisma.aIUsageRecord.groupBy({
          by: ["userId"],
          where: {
            organizationId: req.organizationId,
            createdAt: { gte: startOfMonth },
          },
          _sum: { totalTokens: true, costCents: true },
          _count: true,
        });

        const userIds = byUser.map((bucket) => bucket.userId);
        const users = await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        });
        const userMap = new Map(users.map((user) => [user.id, user]));

        sendSuccess(res, {
          period_start: startOfMonth.toISOString(),
          users: byUser.map((bucket) => {
            const user = userMap.get(bucket.userId);
            return {
              user_id: bucket.userId,
              user_name: user?.name ?? null,
              user_email: user?.email ?? "unknown",
              total_tokens: bucket._sum.totalTokens ?? 0,
              total_cost_cents: bucket._sum.costCents ?? 0,
              total_requests: bucket._count,
            };
          }),
        });
      
    }
  ));
}
