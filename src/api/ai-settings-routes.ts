/**
 * AI Settings & Usage Management Routes
 *
 * Admin routes for:
 *   - Configuring org's own AI providers and API keys
 *   - Setting usage limits per user or org-wide (token, request, story-count)
 *   - Managing per-role AI access defaults
 *   - Managing per-user AI access overrides
 *   - Managing user prepaid balances (top-up, view)
 *   - Org-level AI settings (default provider, seat pricing)
 *   - Viewing usage history and stats
 *
 * User routes for:
 *   - Viewing available providers/models (respecting access controls)
 *   - Viewing their own usage, limits, and balance
 *   - Fetching and acknowledging notifications
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { PrismaClient, UserRole } from "@prisma/client";
import { requirePermission } from "../middleware/permissions.js";
import { AIConfigService } from "../services/ai-config.js";
import { AIUsageTracker } from "../services/ai-usage-tracker.js";
import {
  PROVIDER_MODELS,
  DEFAULT_MODELS,
  type AIProviderName,
} from "../services/ai-client.js";

// ─── Validation ──────────────────────────────────────────────────────────────

const UpsertProviderSchema = z.object({
  provider: z.enum(["openai", "anthropic", "google"]),
  api_key: z.string().min(1, "API key is required"),
  display_name: z.string().optional(),
  default_model: z.string().optional(),
  embedding_model: z.string().optional(),
  is_default: z.boolean().optional(),
});

const ValidateKeySchema = z.object({
  provider: z.enum(["openai", "anthropic", "google"]),
  api_key: z.string().min(1),
});

const SetLimitSchema = z.object({
  user_id: z.string().optional(),
  max_tokens_per_day: z.number().int().min(0).nullable().optional(),
  max_tokens_per_month: z.number().int().min(0).nullable().optional(),
  max_requests_per_day: z.number().int().min(0).nullable().optional(),
  max_requests_per_month: z.number().int().min(0).nullable().optional(),
  max_stories_per_month: z.number().int().min(0).nullable().optional(),
  warning_threshold_pct: z.number().int().min(1).max(99).optional(),
});

const SetUserAccessSchema = z.object({
  user_id: z.string().min(1),
  allowed_providers: z.array(z.enum(["OPENAI", "ANTHROPIC", "GOOGLE"])).optional(),
  allowed_models: z.array(z.string()).optional(),
  denied_providers: z.array(z.enum(["OPENAI", "ANTHROPIC", "GOOGLE"])).optional(),
  denied_models: z.array(z.string()).optional(),
});

const SetRoleDefaultSchema = z.object({
  role: z.enum(["MEMBER", "VIEWER"]),
  allowed_providers: z.array(z.enum(["OPENAI", "ANTHROPIC", "GOOGLE"])).optional(),
  allowed_models: z.array(z.string()).optional(),
  max_tokens_per_day: z.number().int().min(0).nullable().optional(),
  max_tokens_per_month: z.number().int().min(0).nullable().optional(),
  max_stories_per_month: z.number().int().min(0).nullable().optional(),
  max_requests_per_day: z.number().int().min(0).nullable().optional(),
});

const AddBalanceSchema = z.object({
  user_id: z.string().min(1),
  amount_cents: z.number().int().min(1),
  description: z.string().optional(),
});

const OrgAISettingsSchema = z.object({
  default_provider: z.string().optional().nullable(),
  default_model: z.string().optional().nullable(),
  per_seat_token_budget_per_month: z.number().int().min(0).optional().nullable(),
  per_seat_stories_per_month: z.number().int().min(0).optional().nullable(),
  max_stories_per_month: z.number().int().min(0).optional().nullable(),
});

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createAISettingsRoutes(
  prisma: PrismaClient,
  configService: AIConfigService,
  usageTracker: AIUsageTracker
): Router {
  const router = Router();

  // ════════════════════════════════════════════════════════════════════
  // USER ROUTES — any authenticated user
  // ════════════════════════════════════════════════════════════════════

  /**
   * GET /api/ai/providers
   *
   * Lists available AI providers and models, respecting user's access controls.
   * Shows both org-configured providers and platform-available providers.
   */
  router.get("/providers", async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId || !req.userRole) {
      res.status(401).json({ error: "Authentication required" });
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

      // Filter platform models by user's access
      const filteredPlatformModels =
        access.allowedProviders.length === 0
          ? platformModels
          : platformModels.filter((m) =>
              access.allowedProviders.includes(m.provider)
            );

      res.json({
        org_providers: orgConfigs.map((c) => ({
          provider: c.provider,
          display_name: c.displayName,
          default_model: c.defaultModel,
          is_default: c.isDefault,
          is_active: c.isActive,
          available_models: PROVIDER_MODELS[c.provider as AIProviderName] ?? [],
        })),
        platform_models: filteredPlatformModels,
        all_providers: Object.entries(PROVIDER_MODELS).map(
          ([provider, models]) => ({
            provider,
            models,
            default_model: DEFAULT_MODELS[provider as AIProviderName],
          })
        ),
        user_access: access,
      });
    } catch (err) {
      console.error("List providers error:", err);
      res.status(500).json({ error: "Failed to list AI providers" });
    }
  });

  /**
   * GET /api/ai/usage/me
   *
   * Returns the current user's usage, limit status, and balance.
   */
  router.get("/usage/me", async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const status = await usageTracker.getLimitStatus(
        req.organizationId,
        req.userId
      );

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
      console.error("Usage status error:", err);
      res.status(500).json({ error: "Failed to get usage status" });
    }
  });

  /**
   * GET /api/ai/balance/me
   *
   * Returns the current user's balance with recent transactions.
   */
  router.get("/balance/me", async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const balance = await usageTracker.getBalance(
        req.organizationId,
        req.userId
      );

      if (!balance) {
        res.json({ balance: null });
        return;
      }

      res.json({
        balance: {
          balance_cents: balance.balanceCents,
          lifetime_spent_cents: balance.lifetimeSpentCents,
          transactions: balance.transactions.map((t) => ({
            id: t.id,
            type: t.type,
            amount_cents: t.amountCents,
            description: t.description,
            created_at: t.createdAt.toISOString(),
          })),
        },
      });
    } catch (err) {
      console.error("Balance error:", err);
      res.status(500).json({ error: "Failed to get balance" });
    }
  });

  /**
   * GET /api/ai/notifications
   *
   * Returns pending usage notifications for the current user.
   */
  router.get("/notifications", async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const notifications = await usageTracker.getPendingNotifications(
        req.organizationId,
        req.userId
      );

      res.json({
        notifications: notifications.map((n) => ({
          id: n.id,
          limit_type: n.limitType,
          threshold_pct: n.thresholdPct,
          current_usage: n.currentUsage,
          limit_value: n.limitValue,
          message: n.message,
          created_at: n.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      console.error("Notifications error:", err);
      res.status(500).json({ error: "Failed to get notifications" });
    }
  });

  /**
   * POST /api/ai/notifications/:id/acknowledge
   */
  router.post(
    "/notifications/:id/acknowledge",
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId || !req.userId) {
        res.status(401).json({ error: "Authentication required" });
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
        console.error("Acknowledge notification error:", err);
        res.status(500).json({ error: "Failed to acknowledge notification" });
      }
    }
  );

  /**
   * POST /api/ai/notifications/acknowledge-all
   */
  router.post(
    "/notifications/acknowledge-all",
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId || !req.userId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        const acknowledgedCount = await usageTracker.acknowledgeAllNotifications(
          req.organizationId,
          req.userId
        );
        res.json({ acknowledged: true, count: acknowledgedCount });
      } catch (err) {
        console.error("Acknowledge all notifications error:", err);
        res.status(500).json({ error: "Failed to acknowledge notifications" });
      }
    }
  );

  // ════════════════════════════════════════════════════════════════════
  // ADMIN ROUTES — require MANAGE_AI_SETTINGS permission
  // ════════════════════════════════════════════════════════════════════

  // ── Admin: Org AI Settings ────────────────────────────────────────

  /**
   * GET /api/ai/admin/settings
   *
   * Returns the org's AI settings (default provider, seat pricing, etc.)
   */
  router.get(
    "/admin/settings",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        const settings = await prisma.orgAISettings.findUnique({
          where: { organizationId: req.organizationId },
        });

        res.json({ settings: settings ?? null });
      } catch (err) {
        console.error("Get org AI settings error:", err);
        res.status(500).json({ error: "Failed to get AI settings" });
      }
    }
  );

  /**
   * PUT /api/ai/admin/settings
   *
   * Updates the org's AI settings.
   */
  router.put(
    "/admin/settings",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      const parse = OrgAISettingsSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        await prisma.orgAISettings.upsert({
          where: { organizationId: req.organizationId },
          create: {
            organizationId: req.organizationId,
            defaultProvider: parse.data.default_provider,
            defaultModel: parse.data.default_model,
            perSeatTokenBudgetPerMonth: parse.data.per_seat_token_budget_per_month,
            perSeatStoriesPerMonth: parse.data.per_seat_stories_per_month,
            maxStoriesPerMonth: parse.data.max_stories_per_month,
          },
          update: {
            defaultProvider: parse.data.default_provider,
            defaultModel: parse.data.default_model,
            perSeatTokenBudgetPerMonth: parse.data.per_seat_token_budget_per_month,
            perSeatStoriesPerMonth: parse.data.per_seat_stories_per_month,
            maxStoriesPerMonth: parse.data.max_stories_per_month,
          },
        });

        res.json({ saved: true });
      } catch (err) {
        console.error("Update org AI settings error:", err);
        res.status(500).json({ error: "Failed to update AI settings" });
      }
    }
  );

  // ── Admin: Provider Management ────────────────────────────────────

  /**
   * GET /api/ai/admin/providers
   *
   * Lists all org provider configs including masked API key previews.
   */
  router.get(
    "/admin/providers",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        const configs = await configService.listOrgConfigs(req.organizationId);

        res.json({
          providers: configs.map((c) => ({
            id: c.id,
            provider: c.provider,
            display_name: c.displayName,
            default_model: c.defaultModel,
            embedding_model: c.embeddingModel,
            is_default: c.isDefault,
            is_active: c.isActive,
            api_key_preview: c.apiKeyPreview,
            available_models:
              PROVIDER_MODELS[c.provider as AIProviderName] ?? [],
            created_at: c.createdAt,
            updated_at: c.updatedAt,
          })),
        });
      } catch (err) {
        console.error("Admin list providers error:", err);
        res.status(500).json({ error: "Failed to list AI providers" });
      }
    }
  );

  /**
   * POST /api/ai/admin/providers
   *
   * Adds or updates an org AI provider configuration (encrypts the API key).
   */
  router.post(
    "/admin/providers",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      const parse = UpsertProviderSchema.safeParse(req.body);
      if (!parse.success) {
        res
          .status(400)
          .json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        const configId = await configService.upsertOrgConfig(
          req.organizationId,
          {
            provider: parse.data.provider as AIProviderName,
            apiKey: parse.data.api_key,
            displayName: parse.data.display_name,
            defaultModel: parse.data.default_model,
            embeddingModel: parse.data.embedding_model,
            isDefault: parse.data.is_default,
          }
        );

        res.json({ id: configId, saved: true });
      } catch (err) {
        console.error("Upsert provider error:", err);
        res.status(500).json({ error: "Failed to save AI provider config" });
      }
    }
  );

  /**
   * POST /api/ai/admin/providers/validate
   *
   * Validates an API key by making a minimal test call.
   */
  router.post(
    "/admin/providers/validate",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      const parse = ValidateKeySchema.safeParse(req.body);
      if (!parse.success) {
        res
          .status(400)
          .json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      try {
        const result = await configService.validateApiKey(
          parse.data.provider as AIProviderName,
          parse.data.api_key
        );

        res.json(result);
      } catch (err) {
        console.error("Validate key error:", err);
        res.status(500).json({ error: "Failed to validate API key" });
      }
    }
  );

  /**
   * DELETE /api/ai/admin/providers/:provider
   *
   * Removes an AI provider configuration.
   */
  router.delete(
    "/admin/providers/:provider",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const provider = req.params.provider as AIProviderName;
      if (!["openai", "anthropic", "google"].includes(provider)) {
        res.status(400).json({ error: "Invalid provider" });
        return;
      }

      try {
        await configService.deleteOrgConfig(req.organizationId, provider);
        res.json({ deleted: true });
      } catch (err) {
        console.error("Delete provider error:", err);
        res.status(500).json({ error: "Failed to delete AI provider" });
      }
    }
  );

  // ── Admin: Role Defaults ──────────────────────────────────────────

  /**
   * GET /api/ai/admin/role-defaults
   *
   * Lists AI access defaults for each role.
   */
  router.get(
    "/admin/role-defaults",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        const defaults = await prisma.orgAIRoleDefault.findMany({
          where: { organizationId: req.organizationId },
          orderBy: { role: "asc" },
        });

        res.json({ role_defaults: defaults });
      } catch (err) {
        console.error("List role defaults error:", err);
        res.status(500).json({ error: "Failed to list role defaults" });
      }
    }
  );

  /**
   * POST /api/ai/admin/role-defaults
   *
   * Sets AI access defaults for a role.
   */
  router.post(
    "/admin/role-defaults",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      const parse = SetRoleDefaultSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        await prisma.orgAIRoleDefault.upsert({
          where: {
            organizationId_role: {
              organizationId: req.organizationId,
              role: parse.data.role,
            },
          },
          create: {
            organizationId: req.organizationId,
            role: parse.data.role,
            allowedProviders: parse.data.allowed_providers ?? [],
            allowedModels: parse.data.allowed_models ?? [],
            maxTokensPerDay: parse.data.max_tokens_per_day,
            maxTokensPerMonth: parse.data.max_tokens_per_month,
            maxStoriesPerMonth: parse.data.max_stories_per_month,
            maxRequestsPerDay: parse.data.max_requests_per_day,
          },
          update: {
            allowedProviders: parse.data.allowed_providers,
            allowedModels: parse.data.allowed_models,
            maxTokensPerDay: parse.data.max_tokens_per_day,
            maxTokensPerMonth: parse.data.max_tokens_per_month,
            maxStoriesPerMonth: parse.data.max_stories_per_month,
            maxRequestsPerDay: parse.data.max_requests_per_day,
          },
        });

        res.json({ saved: true });
      } catch (err) {
        console.error("Set role default error:", err);
        res.status(500).json({ error: "Failed to set role default" });
      }
    }
  );

  /**
   * DELETE /api/ai/admin/role-defaults/:role
   *
   * Removes the AI access defaults for a role.
   */
  router.delete(
    "/admin/role-defaults/:role",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
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
        console.error("Delete role default error:", err);
        res.status(500).json({ error: "Failed to delete role default" });
      }
    }
  );

  // ── Admin: Per-User AI Access ─────────────────────────────────────

  /**
   * GET /api/ai/admin/user-access
   *
   * Lists all per-user AI access overrides.
   */
  router.get(
    "/admin/user-access",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
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
        console.error("List user access error:", err);
        res.status(500).json({ error: "Failed to list user access" });
      }
    }
  );

  /**
   * POST /api/ai/admin/user-access
   *
   * Sets per-user AI access overrides (allowed/denied providers and models).
   */
  router.post(
    "/admin/user-access",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      const parse = SetUserAccessSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      if (!req.organizationId || !req.userId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        await prisma.userAIAccess.upsert({
          where: {
            organizationId_userId: {
              organizationId: req.organizationId,
              userId: parse.data.user_id,
            },
          },
          create: {
            organizationId: req.organizationId,
            userId: parse.data.user_id,
            allowedProviders: parse.data.allowed_providers ?? [],
            allowedModels: parse.data.allowed_models ?? [],
            deniedProviders: parse.data.denied_providers ?? [],
            deniedModels: parse.data.denied_models ?? [],
            grantedById: req.userId,
          },
          update: {
            allowedProviders: parse.data.allowed_providers,
            allowedModels: parse.data.allowed_models,
            deniedProviders: parse.data.denied_providers,
            deniedModels: parse.data.denied_models,
            grantedById: req.userId,
          },
        });

        res.json({ saved: true });
      } catch (err) {
        console.error("Set user access error:", err);
        res.status(500).json({ error: "Failed to set user access" });
      }
    }
  );

  /**
   * DELETE /api/ai/admin/user-access/:userId
   *
   * Removes per-user AI access overrides (reverts to role defaults).
   */
  router.delete(
    "/admin/user-access/:userId",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
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
        console.error("Delete user access error:", err);
        res.status(500).json({ error: "Failed to delete user access" });
      }
    }
  );

  // ── Admin: Balance Management ─────────────────────────────────────

  /**
   * GET /api/ai/admin/balances
   *
   * Lists all user balances in the org.
   */
  router.get(
    "/admin/balances",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        const balances = await prisma.userAIBalance.findMany({
          where: { organizationId: req.organizationId },
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
          orderBy: { updatedAt: "desc" },
        });

        res.json({
          balances: balances.map((b) => ({
            user_id: b.userId,
            user_name: b.user.name,
            user_email: b.user.email,
            balance_cents: b.balanceCents,
            lifetime_spent_cents: b.lifetimeSpentCents,
            updated_at: b.updatedAt.toISOString(),
          })),
        });
      } catch (err) {
        console.error("List balances error:", err);
        res.status(500).json({ error: "Failed to list balances" });
      }
    }
  );

  /**
   * POST /api/ai/admin/balances/top-up
   *
   * Adds funds to a user's AI balance.
   */
  router.post(
    "/admin/balances/top-up",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      const parse = AddBalanceSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        await usageTracker.addBalance(
          req.organizationId,
          parse.data.user_id,
          parse.data.amount_cents,
          parse.data.description
        );

        res.json({ topped_up: true, amount_cents: parse.data.amount_cents });
      } catch (err) {
        console.error("Top-up balance error:", err);
        res.status(500).json({ error: "Failed to top up balance" });
      }
    }
  );

  /**
   * GET /api/ai/admin/balances/:userId
   *
   * Returns a specific user's balance with transaction history.
   */
  router.get(
    "/admin/balances/:userId",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        const balance = await usageTracker.getBalance(
          req.organizationId,
          req.params.userId as string
        );

        if (!balance) {
          res.json({ balance: null });
          return;
        }

        res.json({
          balance: {
            balance_cents: balance.balanceCents,
            lifetime_spent_cents: balance.lifetimeSpentCents,
            transactions: balance.transactions.map((t) => ({
              id: t.id,
              type: t.type,
              amount_cents: t.amountCents,
              description: t.description,
              created_at: t.createdAt.toISOString(),
            })),
          },
        });
      } catch (err) {
        console.error("Get user balance error:", err);
        res.status(500).json({ error: "Failed to get user balance" });
      }
    }
  );

  // ── Admin: Usage Limits ─────────────────────────────────────────────

  /**
   * GET /api/ai/admin/limits
   */
  router.get(
    "/admin/limits",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        const limits = await usageTracker.listLimits(req.organizationId);

        res.json({
          limits: limits.map((l) => ({
            id: l.id,
            user: l.user
              ? { id: l.user.id, name: l.user.name, email: l.user.email }
              : null,
            is_org_default: !l.userId,
            max_tokens_per_day: l.maxTokensPerDay,
            max_tokens_per_month: l.maxTokensPerMonth,
            max_requests_per_day: l.maxRequestsPerDay,
            max_requests_per_month: l.maxRequestsPerMonth,
            max_stories_per_month: l.maxStoriesPerMonth,
            warning_threshold_pct: l.warningThresholdPct,
            created_at: l.createdAt,
            updated_at: l.updatedAt,
          })),
        });
      } catch (err) {
        console.error("List limits error:", err);
        res.status(500).json({ error: "Failed to list usage limits" });
      }
    }
  );

  /**
   * POST /api/ai/admin/limits
   */
  router.post(
    "/admin/limits",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      const parse = SetLimitSchema.safeParse(req.body);
      if (!parse.success) {
        res
          .status(400)
          .json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        await usageTracker.setLimit({
          organizationId: req.organizationId,
          userId: parse.data.user_id,
          maxTokensPerDay: parse.data.max_tokens_per_day,
          maxTokensPerMonth: parse.data.max_tokens_per_month,
          maxRequestsPerDay: parse.data.max_requests_per_day,
          maxRequestsPerMonth: parse.data.max_requests_per_month,
          maxStoriesPerMonth: parse.data.max_stories_per_month,
          warningThresholdPct: parse.data.warning_threshold_pct,
        });

        res.json({ saved: true });
      } catch (err) {
        console.error("Set limit error:", err);
        res.status(500).json({ error: "Failed to set usage limit" });
      }
    }
  );

  /**
   * DELETE /api/ai/admin/limits/:userId
   */
  router.delete(
    "/admin/limits/:userId",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
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
        console.error("Remove limit error:", err);
        res.status(500).json({ error: "Failed to remove usage limit" });
      }
    }
  );

  // ── Admin: Usage History ────────────────────────────────────────────

  /**
   * GET /api/ai/admin/usage
   */
  router.get(
    "/admin/usage",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        const userId = req.query.user_id as string | undefined;
        const days = parseInt(req.query.days as string, 10) || 30;

        const records = await usageTracker.getUsageHistory(
          req.organizationId,
          userId,
          days
        );

        res.json({
          records: records.map((r) => ({
            id: r.id,
            user_id: r.userId,
            provider: r.provider,
            model: r.model,
            operation: r.operation,
            input_tokens: r.inputTokens,
            output_tokens: r.outputTokens,
            total_tokens: r.totalTokens,
            cost_cents: r.costCents,
            created_at: r.createdAt.toISOString(),
          })),
        });
      } catch (err) {
        console.error("Usage history error:", err);
        res.status(500).json({ error: "Failed to get usage history" });
      }
    }
  );

  /**
   * GET /api/ai/admin/usage/summary
   */
  router.get(
    "/admin/usage/summary",
    requirePermission(prisma, "manage_ai_settings"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
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

        // Hydrate user names
        const userIds = byUser.map((b) => b.userId);
        const users = await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        });
        const userMap = new Map(users.map((u) => [u.id, u]));

        res.json({
          period_start: startOfMonth.toISOString(),
          users: byUser.map((b) => {
            const user = userMap.get(b.userId);
            return {
              user_id: b.userId,
              user_name: user?.name ?? null,
              user_email: user?.email ?? "unknown",
              total_tokens: b._sum.totalTokens ?? 0,
              total_cost_cents: b._sum.costCents ?? 0,
              total_requests: b._count,
            };
          }),
        });
      } catch (err) {
        console.error("Usage summary error:", err);
        res.status(500).json({ error: "Failed to get usage summary" });
      }
    }
  );

  return router;
}
