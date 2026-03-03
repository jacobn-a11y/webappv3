import type { UserRole } from "@prisma/client";
import type { Response } from "express";
import { requirePermission } from "../../middleware/permissions.js";
import { respondAuthRequired } from "../_shared/errors.js";
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

export function registerAISettingsAdminRoutes({
  configService,
  prisma,
  router,
  usageTracker,
}: AISettingsRouteContext): void {
  router.get(
    "/admin/settings",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        respondAuthRequired(res);
        return;
      }

      try {
        const settings = await prisma.orgAISettings.findUnique({
          where: { organizationId: req.organizationId },
        });

        res.json({ settings: settings ?? null });
      } catch (err) {
        logger.error("Get org AI settings error", { error: err });
        res.status(500).json({ error: "Failed to get AI settings" });
      }
    }
  );

  router.put(
    "/admin/settings",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      const payload = parseRequestBody(OrgAISettingsSchema, req.body, res);
      if (!payload) {
        return;
      }

      if (!req.organizationId) {
        respondAuthRequired(res);
        return;
      }

      try {
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

        res.json({ saved: true });
      } catch (err) {
        logger.error("Update org AI settings error", { error: err });
        res.status(500).json({ error: "Failed to update AI settings" });
      }
    }
  );

  router.get(
    "/admin/providers",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        respondAuthRequired(res);
        return;
      }

      try {
        const configs = await configService.listOrgConfigs(req.organizationId);

        res.json({
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
      } catch (err) {
        logger.error("Admin list providers error", { error: err });
        res.status(500).json({ error: "Failed to list AI providers" });
      }
    }
  );

  router.post(
    "/admin/providers",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      const payload = parseRequestBody(UpsertProviderSchema, req.body, res);
      if (!payload) {
        return;
      }

      if (!req.organizationId) {
        respondAuthRequired(res);
        return;
      }

      try {
        const configId = await configService.upsertOrgConfig(req.organizationId, {
          provider: payload.provider as AIProviderName,
          apiKey: payload.api_key,
          displayName: payload.display_name,
          defaultModel: payload.default_model,
          embeddingModel: payload.embedding_model,
          isDefault: payload.is_default,
        });

        res.json({ id: configId, saved: true });
      } catch (err) {
        logger.error("Upsert provider error", { error: err });
        res.status(500).json({ error: "Failed to save AI provider config" });
      }
    }
  );

  router.post(
    "/admin/providers/validate",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      const payload = parseRequestBody(ValidateKeySchema, req.body, res);
      if (!payload) {
        return;
      }

      try {
        const result = await configService.validateApiKey(
          payload.provider as AIProviderName,
          payload.api_key
        );

        res.json(result);
      } catch (err) {
        logger.error("Validate key error", { error: err });
        res.status(500).json({ error: "Failed to validate API key" });
      }
    }
  );

  router.delete(
    "/admin/providers/:provider",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        respondAuthRequired(res);
        return;
      }

      const provider = parseAIProviderName(req.params.provider);
      if (!provider) {
        res.status(400).json({ error: "Invalid provider" });
        return;
      }

      try {
        await configService.deleteOrgConfig(req.organizationId, provider);
        res.json({ deleted: true });
      } catch (err) {
        logger.error("Delete provider error", { error: err });
        res.status(500).json({ error: "Failed to delete AI provider" });
      }
    }
  );

  router.get(
    "/admin/role-defaults",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        respondAuthRequired(res);
        return;
      }

      try {
        const defaults = await prisma.orgAIRoleDefault.findMany({
          where: { organizationId: req.organizationId },
          orderBy: { role: "asc" },
        });

        res.json({ role_defaults: defaults });
      } catch (err) {
        logger.error("List role defaults error", { error: err });
        res.status(500).json({ error: "Failed to list role defaults" });
      }
    }
  );

  router.post(
    "/admin/role-defaults",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      const payload = parseRequestBody(SetRoleDefaultSchema, req.body, res);
      if (!payload) {
        return;
      }

      if (!req.organizationId) {
        respondAuthRequired(res);
        return;
      }

      try {
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

        res.json({ saved: true });
      } catch (err) {
        logger.error("Set role default error", { error: err });
        res.status(500).json({ error: "Failed to set role default" });
      }
    }
  );

  router.delete(
    "/admin/role-defaults/:role",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        respondAuthRequired(res);
        return;
      }

      try {
        await prisma.orgAIRoleDefault.deleteMany({
          where: {
            organizationId: req.organizationId,
            role: req.params.role as UserRole,
          },
        });

        res.json({ deleted: true });
      } catch (err) {
        logger.error("Delete role default error", { error: err });
        res.status(500).json({ error: "Failed to delete role default" });
      }
    }
  );

  router.get(
    "/admin/user-access",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        respondAuthRequired(res);
        return;
      }

      try {
        const access = await prisma.userAIAccess.findMany({
          where: { organizationId: req.organizationId },
          include: {
            user: { select: { id: true, name: true, email: true, role: true } },
          },
        });

        res.json({ user_access: access });
      } catch (err) {
        logger.error("List user access error", { error: err });
        res.status(500).json({ error: "Failed to list user access" });
      }
    }
  );

  router.post(
    "/admin/user-access",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      const payload = parseRequestBody(SetUserAccessSchema, req.body, res);
      if (!payload) {
        return;
      }

      if (!req.organizationId || !req.userId) {
        respondAuthRequired(res);
        return;
      }

      try {
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

        res.json({ saved: true });
      } catch (err) {
        logger.error("Set user access error", { error: err });
        res.status(500).json({ error: "Failed to set user access" });
      }
    }
  );

  router.delete(
    "/admin/user-access/:userId",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        respondAuthRequired(res);
        return;
      }

      try {
        await prisma.userAIAccess.deleteMany({
          where: {
            organizationId: req.organizationId,
            userId: req.params.userId as string,
          },
        });

        res.json({ deleted: true });
      } catch (err) {
        logger.error("Delete user access error", { error: err });
        res.status(500).json({ error: "Failed to delete user access" });
      }
    }
  );

  router.get(
    "/admin/limits",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        respondAuthRequired(res);
        return;
      }

      try {
        const limits = await usageTracker.listLimits(req.organizationId);
        res.json({
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
      } catch (err) {
        logger.error("List limits error", { error: err });
        res.status(500).json({ error: "Failed to list usage limits" });
      }
    }
  );

  router.post(
    "/admin/limits",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      const payload = parseRequestBody(SetLimitSchema, req.body, res);
      if (!payload) {
        return;
      }

      if (!req.organizationId) {
        respondAuthRequired(res);
        return;
      }

      try {
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

        res.json({ saved: true });
      } catch (err) {
        logger.error("Set limit error", { error: err });
        res.status(500).json({ error: "Failed to set usage limit" });
      }
    }
  );

  router.delete(
    "/admin/limits/:userId",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        respondAuthRequired(res);
        return;
      }

      try {
        const userId =
          req.params.userId === "org_default"
            ? undefined
            : (req.params.userId as string);

        await usageTracker.removeLimit(req.organizationId, userId);
        res.json({ deleted: true });
      } catch (err) {
        logger.error("Remove limit error", { error: err });
        res.status(500).json({ error: "Failed to remove usage limit" });
      }
    }
  );

  router.get(
    "/admin/usage",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        respondAuthRequired(res);
        return;
      }

      try {
        const userId = req.query.user_id as string | undefined;
        const days = parseInt(req.query.days as string, 10) || 30;

        const records = await usageTracker.getUsageHistory(req.organizationId, userId, days);

        res.json({
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
      } catch (err) {
        logger.error("Usage history error", { error: err });
        res.status(500).json({ error: "Failed to get usage history" });
      }
    }
  );

  router.get(
    "/admin/usage/summary",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        respondAuthRequired(res);
        return;
      }

      try {
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

        res.json({
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
      } catch (err) {
        logger.error("Usage summary error", { error: err });
        res.status(500).json({ error: "Failed to get usage summary" });
      }
    }
  );
}
