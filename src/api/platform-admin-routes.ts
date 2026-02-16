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
    res.status(500).json({ error: "PLATFORM_ADMIN_API_KEY is not configured" });
    return;
  }

  if (key !== expected) {
    res.status(401).json({ error: "Invalid or missing platform admin key" });
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
  router.get("/providers", async (_req: Request, res: Response) => {
    try {
      const providers = await configService.listPlatformProviders();
      res.json({ providers });
    } catch (err) {
      console.error("Platform list providers error:", err);
      res.status(500).json({ error: "Failed to list platform providers" });
    }
  });

  /**
   * POST /api/platform/providers
   *
   * Adds or updates a platform AI provider (sets the platform's API key).
   */
  router.post("/providers", async (req: Request, res: Response) => {
    const parse = UpsertPlatformProviderSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "validation_error", details: parse.error.issues });
      return;
    }

    try {
      const id = await configService.upsertPlatformProvider({
        provider: parse.data.provider as AIProviderName,
        apiKey: parse.data.api_key,
        isActive: parse.data.is_active,
      });

      res.json({ id, saved: true });
    } catch (err) {
      console.error("Platform upsert provider error:", err);
      res.status(500).json({ error: "Failed to save platform provider" });
    }
  });

  /**
   * POST /api/platform/providers/validate
   *
   * Validates an API key by making a minimal test call.
   */
  router.post("/providers/validate", async (req: Request, res: Response) => {
    const parse = ValidateKeySchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "validation_error", details: parse.error.issues });
      return;
    }

    try {
      const result = await configService.validateApiKey(
        parse.data.provider as AIProviderName,
        parse.data.api_key
      );
      res.json(result);
    } catch (err) {
      console.error("Platform validate key error:", err);
      res.status(500).json({ error: "Failed to validate API key" });
    }
  });

  // ── Model Pricing ────────────────────────────────────────────────────

  /**
   * GET /api/platform/models
   *
   * Lists all model pricing entries across all providers.
   */
  router.get("/models", async (_req: Request, res: Response) => {
    try {
      const models = await configService.listAvailablePlatformModels();

      res.json({
        models,
        known_models: Object.entries(PROVIDER_MODELS).map(
          ([provider, modelIds]) => ({ provider, model_ids: modelIds })
        ),
      });
    } catch (err) {
      console.error("Platform list models error:", err);
      res.status(500).json({ error: "Failed to list platform models" });
    }
  });

  /**
   * POST /api/platform/models/pricing
   *
   * Adds or updates pricing for a specific model.
   */
  router.post("/models/pricing", async (req: Request, res: Response) => {
    const parse = UpsertModelPricingSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: "validation_error", details: parse.error.issues });
      return;
    }

    try {
      const id = await configService.upsertModelPricing({
        provider: parse.data.provider as AIProviderName,
        modelId: parse.data.model_id,
        displayName: parse.data.display_name,
        inputCostPer1kTokens: parse.data.input_cost_per_1k_tokens,
        outputCostPer1kTokens: parse.data.output_cost_per_1k_tokens,
        isAvailable: parse.data.is_available,
        sortOrder: parse.data.sort_order,
      });

      res.json({ id, saved: true });
    } catch (err) {
      console.error("Platform upsert model pricing error:", err);
      res.status(500).json({ error: "Failed to save model pricing" });
    }
  });

  /**
   * DELETE /api/platform/models/pricing/:provider/:modelId
   *
   * Removes pricing for a specific model.
   */
  router.delete(
    "/models/pricing/:provider/:modelId",
    async (req: Request, res: Response) => {
      const provider = req.params.provider as AIProviderName;
      if (!["openai", "anthropic", "google"].includes(provider)) {
        res.status(400).json({ error: "Invalid provider" });
        return;
      }

      try {
        await configService.deleteModelPricing(provider, req.params.modelId as string);
        res.json({ deleted: true });
      } catch (err) {
        console.error("Platform delete model pricing error:", err);
        res.status(500).json({ error: "Failed to delete model pricing" });
      }
    }
  );

  return router;
}
