/**
 * Platform Admin Routes
 *
 * Dashboard for the platform owner (SaaS operator) to manage:
 *   - Platform-level AI providers and API keys
 *   - Per-model pricing (input/output cost per 1k tokens)
 *   - Enable/disable providers and models
 *
 * Authentication: x-platform-admin-key header must match PLATFORM_ADMIN_API_KEY env var.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { AIConfigService } from "../services/ai-config.js";
import { PROVIDER_MODELS, type AIProviderName } from "../services/ai-client.js";
import { parseAIProviderName } from "../services/provider-policy.js";
import { asyncHandler } from "../lib/async-handler.js";
import { sendSuccess, sendError, sendUnauthorized, sendBadRequest } from "./_shared/responses.js";
import logger from "../lib/logger.js";

// ─── Validation ──────────────────────────────────────────────────────────────

const UpsertPlatformProviderSchema = z.object({
  provider: z.enum(["openai", "anthropic", "google"]),
  api_key: z.string().min(1, "API key is required"),
  is_active: z.boolean().optional(),
});

const UpsertModelPricingSchema = z.object({
  provider: z.enum(["openai", "anthropic", "google"]),
  model_id: z.string().min(1),
  display_name: z.string().min(1),
  input_cost_per_1k_tokens: z.number().min(0),
  output_cost_per_1k_tokens: z.number().min(0),
  is_available: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

const ValidateKeySchema = z.object({
  provider: z.enum(["openai", "anthropic", "google"]),
  api_key: z.string().min(1),
});

// ─── Auth Middleware ─────────────────────────────────────────────────────────

function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
  const key = req.headers["x-platform-admin-key"];
  const expected = process.env.PLATFORM_ADMIN_API_KEY;

  if (!expected) {
    sendError(res, 500, "internal_error", "PLATFORM_ADMIN_API_KEY is not configured");
    return;
  }

  if (key !== expected) {
    sendUnauthorized(res, "Invalid or missing platform admin key");
    return;
  }

  next();
}

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createPlatformAdminRoutes(
  configService: AIConfigService
): Router {
  const router = Router();
  router.use(requirePlatformAdmin);

  // ── Providers ────────────────────────────────────────────────────────

  /**
   * GET /api/platform/providers
   *
   * Lists all platform AI providers with their models and pricing.
   */
  router.get("/providers", asyncHandler(async (_req: Request, res: Response) => {
    const providers = await configService.listPlatformProviders();
    sendSuccess(res, { providers });
  }));

  /**
   * POST /api/platform/providers
   *
   * Adds or updates a platform AI provider (sets the platform's API key).
   */
  router.post("/providers", asyncHandler(async (req: Request, res: Response) => {
    const parse = UpsertPlatformProviderSchema.safeParse(req.body);
    if (!parse.success) {
      sendBadRequest(res, "validation_error", parse.error.issues);
      return;
    }

    const id = await configService.upsertPlatformProvider({
      provider: parse.data.provider as AIProviderName,
      apiKey: parse.data.api_key,
      isActive: parse.data.is_active,
    });

    sendSuccess(res, { id, saved: true });
  }));

  /**
   * POST /api/platform/providers/validate
   *
   * Validates an API key by making a minimal test call.
   */
  router.post("/providers/validate", asyncHandler(async (req: Request, res: Response) => {
    const parse = ValidateKeySchema.safeParse(req.body);
    if (!parse.success) {
      sendBadRequest(res, "validation_error", parse.error.issues);
      return;
    }

    const result = await configService.validateApiKey(
      parse.data.provider as AIProviderName,
      parse.data.api_key
    );
    sendSuccess(res, result);
  }));

  // ── Model Pricing ────────────────────────────────────────────────────

  /**
   * GET /api/platform/models
   *
   * Lists all model pricing entries across all providers.
   */
  router.get("/models", asyncHandler(async (_req: Request, res: Response) => {
    const models = await configService.listAvailablePlatformModels();

    sendSuccess(res, {
      models,
      known_models: Object.entries(PROVIDER_MODELS).map(
        ([provider, modelIds]) => ({ provider, model_ids: modelIds })
      ),
    });
  }));

  /**
   * POST /api/platform/models/pricing
   *
   * Adds or updates pricing for a specific model.
   */
  router.post("/models/pricing", asyncHandler(async (req: Request, res: Response) => {
    const parse = UpsertModelPricingSchema.safeParse(req.body);
    if (!parse.success) {
      sendBadRequest(res, "validation_error", parse.error.issues);
      return;
    }

    const id = await configService.upsertModelPricing({
      provider: parse.data.provider as AIProviderName,
      modelId: parse.data.model_id,
      displayName: parse.data.display_name,
      inputCostPer1kTokens: parse.data.input_cost_per_1k_tokens,
      outputCostPer1kTokens: parse.data.output_cost_per_1k_tokens,
      isAvailable: parse.data.is_available,
      sortOrder: parse.data.sort_order,
    });

    sendSuccess(res, { id, saved: true });
  }));

  /**
   * DELETE /api/platform/models/pricing/:provider/:modelId
   *
   * Removes pricing for a specific model.
   */
  router.delete(
    "/models/pricing/:provider/:modelId",
    asyncHandler(async (req: Request, res: Response) => {
      const provider = parseAIProviderName(req.params.provider);
      if (!provider) {
        sendBadRequest(res, "Invalid provider");
        return;
      }

      await configService.deleteModelPricing(provider, req.params.modelId as string);
      sendSuccess(res, { deleted: true });
    })
  );

  return router;
}
