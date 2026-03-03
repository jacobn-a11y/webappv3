import type { Response } from "express";
import { sendUnauthorized } from "../_shared/responses.js";
import {
  DEFAULT_MODELS,
  PROVIDER_MODELS,
  type AIProviderName,
} from "../../services/ai-client.js";
import type { AISettingsRouteContext, AuthReq } from "./types.js";
import logger from "../../lib/logger.js";
import { asyncHandler } from "../../lib/async-handler.js";

export function registerAISettingsUserRoutes({
  configService,
  router,
  usageTracker,
}: Pick<AISettingsRouteContext, "configService" | "router" | "usageTracker">): void {
  router.get("/providers", asyncHandler(async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId || !req.userRole) {
      sendUnauthorized(res);
      return;
    }

      const access = await configService.resolveUserAccess(
        req.organizationId,
        req.userId,
        req.userRole
      );

      const orgConfigs = await configService.listOrgConfigs(req.organizationId);
      const platformModels = await configService.listAvailablePlatformModels();

      const filteredPlatformModels =
        access.allowedProviders.length === 0
          ? platformModels
          : platformModels.filter((m) => access.allowedProviders.includes(m.provider));

      res.json({
        org_providers: orgConfigs.map((config) => ({
          provider: config.provider,
          display_name: config.displayName,
          default_model: config.defaultModel,
          is_default: config.isDefault,
          is_active: config.isActive,
          available_models: PROVIDER_MODELS[config.provider as AIProviderName] ?? [],
        })),
        platform_models: filteredPlatformModels,
        all_providers: Object.entries(PROVIDER_MODELS).map(([provider, models]) => ({
          provider,
          models,
          default_model: DEFAULT_MODELS[provider as AIProviderName],
        })),
        user_access: access,
      });
    
  }));

  router.get("/usage/me", asyncHandler(async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      sendUnauthorized(res);
      return;
    }

      const status = await usageTracker.getLimitStatus(req.organizationId, req.userId);

      res.json({
        allowed: status.allowed,
        reason: status.reason,
        usage: {
          daily_tokens: status.usage.dailyTokens,
          monthly_tokens: status.usage.monthlyTokens,
          daily_requests: status.usage.dailyRequests,
          monthly_requests: status.usage.monthlyRequests,
          monthly_stories: status.usage.monthlyStories,
        },
        limits: {
          max_tokens_per_day: status.limits.maxTokensPerDay,
          max_tokens_per_month: status.limits.maxTokensPerMonth,
          max_requests_per_day: status.limits.maxRequestsPerDay,
          max_requests_per_month: status.limits.maxRequestsPerMonth,
          max_stories_per_month: status.limits.maxStoriesPerMonth,
        },
        balance: status.balance
          ? {
              balance_cents: status.balance.balanceCents,
              lifetime_spent_cents: status.balance.lifetimeSpentCents,
            }
          : null,
      });
    
  }));

  router.get("/balance/me", asyncHandler(async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      sendUnauthorized(res);
      return;
    }

      const balance = await usageTracker.getBalance(req.organizationId, req.userId);
      if (!balance) {
        res.json({ balance: null });
        return;
      }

      res.json({
        balance: {
          balance_cents: balance.balanceCents,
          lifetime_spent_cents: balance.lifetimeSpentCents,
          transactions: balance.transactions.map((txn) => ({
            id: txn.id,
            type: txn.type,
            amount_cents: txn.amountCents,
            description: txn.description,
            created_at: txn.createdAt.toISOString(),
          })),
        },
      });
    
  }));

  router.get("/notifications", asyncHandler(async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      sendUnauthorized(res);
      return;
    }

      const notifications = await usageTracker.getPendingNotifications(
        req.organizationId,
        req.userId
      );

      res.json({
        notifications: notifications.map((notice) => ({
          id: notice.id,
          limit_type: notice.limitType,
          threshold_pct: notice.thresholdPct,
          current_usage: notice.currentUsage,
          limit_value: notice.limitValue,
          message: notice.message,
          created_at: notice.createdAt.toISOString(),
        })),
      });
    
  }));

  router.post("/notifications/:id/acknowledge", asyncHandler(async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      sendUnauthorized(res);
      return;
    }

      const acknowledged = await usageTracker.acknowledgeNotification(
        req.organizationId,
        req.userId,
        req.params.id as string
      );
      if (!acknowledged) {
        res.status(404).json({ error: "notification_not_found" });
        return;
      }

      res.json({ acknowledged: true });
    
  }));

  router.post("/notifications/acknowledge-all", asyncHandler(async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      sendUnauthorized(res);
      return;
    }

      const acknowledgedCount = await usageTracker.acknowledgeAllNotifications(
        req.organizationId,
        req.userId
      );
      res.json({ acknowledged: true, count: acknowledgedCount });
    
  }));
}
