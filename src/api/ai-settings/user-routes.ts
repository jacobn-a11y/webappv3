import type { Response } from "express";
import { sendUnauthorized } from "../_shared/responses.js";
import {
  DEFAULT_MODELS,
  PROVIDER_MODELS,
  type AIProviderName,
} from "../../services/ai-client.js";
import type { AISettingsRouteContext, AuthReq } from "./types.js";
import logger from "../../lib/logger.js";

export function registerAISettingsUserRoutes({
  configService,
  router,
  usageTracker,
}: Pick<AISettingsRouteContext, "configService" | "router" | "usageTracker">): void {
  router.get("/providers", async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId || !req.userRole) {
      sendUnauthorized(res);
      return;
    }

    try {
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
    } catch (err) {
      logger.error("List providers error", { error: err });
      res.status(500).json({ error: "Failed to list AI providers" });
    }
  });

  router.get("/usage/me", async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      sendUnauthorized(res);
      return;
    }

    try {
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
    } catch (err) {
      logger.error("Usage status error", { error: err });
      res.status(500).json({ error: "Failed to get usage status" });
    }
  });

  router.get("/balance/me", async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      sendUnauthorized(res);
      return;
    }

    try {
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
    } catch (err) {
      logger.error("Balance error", { error: err });
      res.status(500).json({ error: "Failed to get balance" });
    }
  });

  router.get("/notifications", async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      sendUnauthorized(res);
      return;
    }

    try {
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
    } catch (err) {
      logger.error("Notifications error", { error: err });
      res.status(500).json({ error: "Failed to get notifications" });
    }
  });

  router.post("/notifications/:id/acknowledge", async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      sendUnauthorized(res);
      return;
    }

    try {
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
    } catch (err) {
      logger.error("Acknowledge notification error", { error: err });
      res.status(500).json({ error: "Failed to acknowledge notification" });
    }
  });

  router.post("/notifications/acknowledge-all", async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      sendUnauthorized(res);
      return;
    }

    try {
      const acknowledgedCount = await usageTracker.acknowledgeAllNotifications(
        req.organizationId,
        req.userId
      );
      res.json({ acknowledged: true, count: acknowledgedCount });
    } catch (err) {
      logger.error("Acknowledge all notifications error", { error: err });
      res.status(500).json({ error: "Failed to acknowledge notifications" });
    }
  });
}
