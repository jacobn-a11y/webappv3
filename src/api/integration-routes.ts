/**
 * Integration Management API Routes
 *
 * CRUD operations for managing per-org integration configurations.
 * Admins use these endpoints to connect Grain, Gong, Salesforce, or
 * re-enable the Merge.dev unified API.
 *
 * Routes:
 *   GET    /api/integrations              — List all integrations for the org
 *   GET    /api/integrations/:provider    — Get a specific integration config
 *   POST   /api/integrations              — Create a new integration
 *   PATCH  /api/integrations/:provider    — Update credentials or settings
 *   DELETE /api/integrations/:provider    — Remove an integration
 *   POST   /api/integrations/:provider/test — Validate credentials
 *   POST   /api/integrations/:provider/sync — Trigger on-demand sync
 */

import { Router, type Request, type Response } from "express";
import type { PrismaClient, IntegrationProvider } from "@prisma/client";
import { z } from "zod";
import type { ProviderRegistry } from "../integrations/types.js";
import type { SyncEngine } from "../integrations/sync-engine.js";

// ─── Validation Schemas ─────────────────────────────────────────────────────

const VALID_PROVIDERS = ["GRAIN", "GONG", "SALESFORCE", "MERGE_DEV"] as const;

const createIntegrationSchema = z.object({
  provider: z.enum(VALID_PROVIDERS),
  credentials: z.record(z.unknown()),
  settings: z.record(z.unknown()).optional(),
  webhookSecret: z.string().optional(),
});

const updateIntegrationSchema = z.object({
  credentials: z.record(z.unknown()).optional(),
  settings: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
  webhookSecret: z.string().optional(),
});

// ─── Route Factory ──────────────────────────────────────────────────────────

export function createIntegrationRoutes(
  prisma: PrismaClient,
  registry: ProviderRegistry,
  syncEngine: SyncEngine
): Router {
  const router = Router();

  // ── List all integrations for the org ───────────────────────────────
  router.get("/", async (req: Request, res: Response) => {
    const organizationId = (req as any).organizationId as string;

    const configs = await prisma.integrationConfig.findMany({
      where: { organizationId },
      select: {
        id: true,
        provider: true,
        enabled: true,
        status: true,
        lastSyncAt: true,
        lastError: true,
        settings: true,
        createdAt: true,
        updatedAt: true,
        // Never return raw credentials in list view
      },
    });

    // Return available providers with their status
    const available = VALID_PROVIDERS.map((provider) => {
      const config = configs.find((c: { provider: string }) => c.provider === provider);
      return {
        provider,
        configured: !!config,
        enabled: config?.enabled ?? false,
        status: config?.status ?? "PENDING_SETUP",
        lastSyncAt: config?.lastSyncAt ?? null,
        lastError: config?.lastError ?? null,
      };
    });

    res.json({ integrations: available });
  });

  // ── Get a specific integration config ───────────────────────────────
  router.get("/:provider", async (req: Request, res: Response) => {
    const organizationId = (req as any).organizationId as string;
    const provider = (req.params.provider as string).toUpperCase() as IntegrationProvider;

    if (!VALID_PROVIDERS.includes(provider as any)) {
      res.status(400).json({ error: `Invalid provider: ${req.params.provider}` });
      return;
    }

    const config = await prisma.integrationConfig.findUnique({
      where: {
        organizationId_provider: { organizationId, provider },
      },
    });

    if (!config) {
      res.status(404).json({ error: "Integration not configured" });
      return;
    }

    // Redact sensitive fields from credentials
    const redactedCredentials = redactCredentials(
      config.credentials as Record<string, unknown>
    );

    res.json({
      id: config.id,
      provider: config.provider,
      enabled: config.enabled,
      status: config.status,
      credentials: redactedCredentials,
      settings: config.settings,
      lastSyncAt: config.lastSyncAt,
      lastError: config.lastError,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    });
  });

  // ── Create a new integration ────────────────────────────────────────
  router.post("/", async (req: Request, res: Response) => {
    const organizationId = (req as any).organizationId as string;

    const parsed = createIntegrationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }

    const { provider, credentials, settings, webhookSecret } = parsed.data;

    // Check if already exists
    const existing = await prisma.integrationConfig.findUnique({
      where: {
        organizationId_provider: {
          organizationId,
          provider: provider as IntegrationProvider,
        },
      },
    });

    if (existing) {
      res.status(409).json({
        error: "Integration already configured. Use PATCH to update.",
      });
      return;
    }

    const config = await prisma.integrationConfig.create({
      data: {
        organizationId,
        provider: provider as IntegrationProvider,
        credentials: credentials as object,
        settings: settings as object | undefined,
        webhookSecret,
        status: "PENDING_SETUP",
      },
    });

    res.status(201).json({
      id: config.id,
      provider: config.provider,
      status: config.status,
      message: "Integration created. Use POST /:provider/test to validate credentials.",
    });
  });

  // ── Update an integration ───────────────────────────────────────────
  router.patch("/:provider", async (req: Request, res: Response) => {
    const organizationId = (req as any).organizationId as string;
    const provider = (req.params.provider as string).toUpperCase() as IntegrationProvider;

    if (!VALID_PROVIDERS.includes(provider as any)) {
      res.status(400).json({ error: `Invalid provider: ${req.params.provider}` });
      return;
    }

    const parsed = updateIntegrationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }

    const config = await prisma.integrationConfig.findUnique({
      where: { organizationId_provider: { organizationId, provider } },
    });

    if (!config) {
      res.status(404).json({ error: "Integration not configured" });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (parsed.data.credentials) {
      // Merge new credentials with existing (allows partial updates)
      const existingCreds = config.credentials as Record<string, unknown>;
      updateData.credentials = { ...existingCreds, ...parsed.data.credentials };
    }
    if (parsed.data.settings !== undefined) {
      updateData.settings = parsed.data.settings;
    }
    if (parsed.data.enabled !== undefined) {
      updateData.enabled = parsed.data.enabled;
      if (!parsed.data.enabled) {
        updateData.status = "DISABLED";
      }
    }
    if (parsed.data.webhookSecret !== undefined) {
      updateData.webhookSecret = parsed.data.webhookSecret;
    }

    const updated = await prisma.integrationConfig.update({
      where: { id: config.id },
      data: updateData,
    });

    res.json({
      id: updated.id,
      provider: updated.provider,
      enabled: updated.enabled,
      status: updated.status,
    });
  });

  // ── Delete an integration ───────────────────────────────────────────
  router.delete("/:provider", async (req: Request, res: Response) => {
    const organizationId = (req as any).organizationId as string;
    const provider = (req.params.provider as string).toUpperCase() as IntegrationProvider;

    if (!VALID_PROVIDERS.includes(provider as any)) {
      res.status(400).json({ error: `Invalid provider: ${req.params.provider}` });
      return;
    }

    const config = await prisma.integrationConfig.findUnique({
      where: { organizationId_provider: { organizationId, provider } },
    });

    if (!config) {
      res.status(404).json({ error: "Integration not configured" });
      return;
    }

    await prisma.integrationConfig.delete({ where: { id: config.id } });

    res.json({ deleted: true, provider });
  });

  // ── Test credentials ────────────────────────────────────────────────
  router.post("/:provider/test", async (req: Request, res: Response) => {
    const organizationId = (req as any).organizationId as string;
    const provider = (req.params.provider as string).toUpperCase() as IntegrationProvider;

    if (!VALID_PROVIDERS.includes(provider as any)) {
      res.status(400).json({ error: `Invalid provider: ${req.params.provider}` });
      return;
    }

    const config = await prisma.integrationConfig.findUnique({
      where: { organizationId_provider: { organizationId, provider } },
    });

    if (!config) {
      res.status(404).json({ error: "Integration not configured" });
      return;
    }

    const credentials = config.credentials as Record<string, unknown>;

    // Find the provider implementation
    const callProvider = registry.callRecording.get(provider);
    const crmProvider = registry.crm.get(provider);
    const providerImpl = callProvider ?? crmProvider;

    if (!providerImpl) {
      // Merge.dev doesn't have a validation endpoint — just mark as active
      if (provider === "MERGE_DEV") {
        await prisma.integrationConfig.update({
          where: { id: config.id },
          data: { status: "ACTIVE", lastError: null },
        });
        res.json({ valid: true, message: "Merge.dev integration activated" });
        return;
      }
      res.status(400).json({ error: "No provider implementation available" });
      return;
    }

    try {
      const valid = await providerImpl.validateCredentials(credentials as any);

      if (valid) {
        await prisma.integrationConfig.update({
          where: { id: config.id },
          data: { status: "ACTIVE", lastError: null },
        });
        res.json({ valid: true, message: "Credentials validated successfully" });
      } else {
        await prisma.integrationConfig.update({
          where: { id: config.id },
          data: {
            status: "ERROR",
            lastError: "Credential validation failed",
          },
        });
        res.json({ valid: false, message: "Credential validation failed" });
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Validation error";
      await prisma.integrationConfig.update({
        where: { id: config.id },
        data: { status: "ERROR", lastError: errorMessage },
      });
      res.json({ valid: false, message: errorMessage });
    }
  });

  // ── Trigger on-demand sync ──────────────────────────────────────────
  router.post("/:provider/sync", async (req: Request, res: Response) => {
    const organizationId = (req as any).organizationId as string;
    const provider = (req.params.provider as string).toUpperCase() as IntegrationProvider;

    if (!VALID_PROVIDERS.includes(provider as any)) {
      res.status(400).json({ error: `Invalid provider: ${req.params.provider}` });
      return;
    }

    if (provider === "MERGE_DEV") {
      res.status(400).json({
        error: "Merge.dev uses webhook-based sync. No on-demand sync available.",
      });
      return;
    }

    const config = await prisma.integrationConfig.findUnique({
      where: { organizationId_provider: { organizationId, provider } },
    });

    if (!config) {
      res.status(404).json({ error: "Integration not configured" });
      return;
    }

    if (config.status !== "ACTIVE") {
      res.status(400).json({
        error: "Integration must be in ACTIVE status. Test credentials first.",
      });
      return;
    }

    // Run sync in background — don't block the HTTP response
    syncEngine.syncIntegration(config).catch((err) => {
      console.error(`On-demand sync failed for ${provider}:`, err);
    });

    res.json({
      message: `Sync started for ${provider}. Check status via GET /api/integrations/${provider.toLowerCase()}`,
    });
  });

  return router;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Redacts sensitive fields from credentials before sending to the client.
 * Shows the first 4 chars of API keys/tokens so the user can identify them.
 */
function redactCredentials(
  creds: Record<string, unknown>
): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  const sensitiveKeys = new Set([
    "accessKey",
    "accessKeySecret",
    "apiToken",
    "accessToken",
    "refreshToken",
    "clientSecret",
    "apiKey",
    "accountToken",
    "webhookSecret",
  ]);

  for (const [key, value] of Object.entries(creds)) {
    if (sensitiveKeys.has(key) && typeof value === "string") {
      redacted[key] =
        value.length > 4 ? `${value.slice(0, 4)}${"*".repeat(12)}` : "****";
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}
