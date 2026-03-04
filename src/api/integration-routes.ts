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
import { getOrganizationIdOrThrow, TenantGuardError } from "../lib/tenant-guard.js";
import { parseBoundedLimit, PAGINATION_LIMITS } from "../lib/pagination.js";
import { AuditLogService } from "../services/audit-log.js";
import { IntegrationConfigService } from "../services/integration-config.js";
import {
  DIRECT_INTEGRATION_PROVIDERS,
  parseDirectIntegrationProvider,
  resolveIntegrationProviderSelection,
  type DirectIntegrationProvider,
} from "../services/provider-policy.js";
import { decodeCredentials } from "../types/json-boundaries.js";
import logger from "../lib/logger.js";
import { sendSuccess, sendCreated, sendBadRequest, sendNotFound, sendConflict, sendError } from "./_shared/responses.js";

// ─── Validation Schemas ─────────────────────────────────────────────────────

const gongCredentialsSchema = z.object({
  accessKey: z.string().min(1),
  accessKeySecret: z.string().min(1),
});

const grainCredentialsSchema = z.object({
  apiToken: z.string().min(1),
});

const salesforceCredentialsSchema = z.object({
  instanceUrl: z.string().url(),
  accessToken: z.string().min(1),
  refreshToken: z.string().optional(),
});

const credentialsByProvider = {
  GONG: gongCredentialsSchema,
  GRAIN: grainCredentialsSchema,
  SALESFORCE: salesforceCredentialsSchema,
} as const;

const createIntegrationSchema = z.object({
  provider: z.enum(DIRECT_INTEGRATION_PROVIDERS),
  credentials: z.record(z.unknown()),
  settings: z.record(z.unknown()).optional(),
  webhookSecret: z.string().optional(),
}).refine((data) => {
  const schema = credentialsByProvider[data.provider as keyof typeof credentialsByProvider];
  if (!schema) return true;
  return schema.safeParse(data.credentials).success;
}, {
  message: "Invalid credentials for the specified provider",
  path: ["credentials"],
});

const updateIntegrationSchema = z.object({
  credentials: z.record(z.unknown()).optional(),
  settings: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
  webhookSecret: z.string().optional(),
});

const backfillSchema = z.object({
  provider: z.enum(DIRECT_INTEGRATION_PROVIDERS),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  cursor: z.string().optional(),
  idempotency_key: z.string().min(3).max(200).optional(),
});

// ─── Route Factory ──────────────────────────────────────────────────────────

export function createIntegrationRoutes(
  prisma: PrismaClient,
  registry: ProviderRegistry,
  syncEngine: SyncEngine
): Router {
  const router = Router();
  const auditLogs = new AuditLogService(prisma);
  const integrationService = new IntegrationConfigService(prisma);
  const resolveOrgId = (req: Request, res: Response): string | null => {
    try {
      return getOrganizationIdOrThrow(req);
    } catch (error) {
      if (error instanceof TenantGuardError) {
        sendError(res, error.statusCode, error.message);
        return null;
      }
      throw error;
    }
  };
  const resolveProviderParam = (
    rawProvider: unknown,
    res: Response
  ): DirectIntegrationProvider | null => {
    const provider = parseDirectIntegrationProvider(rawProvider);
    if (!provider) {
      sendBadRequest(res, `Invalid provider: ${String(rawProvider ?? "")}`);
      return null;
    }
    return provider;
  };
  const resolveProviderFilter = (
    rawProvider: unknown,
    res: Response
  ): DirectIntegrationProvider | null | undefined => {
    if (typeof rawProvider !== "string" || rawProvider.trim().length === 0) {
      return undefined;
    }
    const provider = parseDirectIntegrationProvider(rawProvider);
    if (!provider) {
      sendBadRequest(res, `Invalid provider: ${rawProvider}`);
      return null;
    }
    return provider;
  };

  // ── List all integrations for the org ───────────────────────────────
  router.get("/", async (req: Request, res: Response) => {
    const organizationId = resolveOrgId(req, res);
    if (!organizationId) return;

    const configs = await integrationService.listConfigs(organizationId);

    // Return available providers with their status
    const available = DIRECT_INTEGRATION_PROVIDERS.map((provider) => {
      const config = configs.find((c) => c.provider === provider);
      return {
        provider,
        configured: !!config,
        enabled: config?.enabled ?? false,
        status: config?.status ?? "PENDING_SETUP",
        lastSyncAt: config?.lastSyncAt ?? null,
        lastError: config?.lastError ?? null,
      };
    });

    sendSuccess(res, { integrations: available });
  });

  // ── Get a specific integration config ───────────────────────────────
  router.get("/:provider", async (req: Request, res: Response) => {
    const organizationId = resolveOrgId(req, res);
    if (!organizationId) return;
    const provider = resolveProviderParam(req.params.provider, res);
    if (!provider) return;

    const config = await integrationService.getConfig(organizationId, provider as IntegrationProvider);

    if (!config) {
      sendNotFound(res, "Integration not configured");
      return;
    }

    // Redact sensitive fields from credentials
    const redactedCredentials = redactCredentials(
      decodeCredentials(config.credentials)
    );

    sendSuccess(res, {
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
    const organizationId = resolveOrgId(req, res);
    if (!organizationId) return;

    const parsed = createIntegrationSchema.safeParse(req.body);
    if (!parsed.success) {
      sendBadRequest(res, "Invalid request", parsed.error.issues);
      return;
    }

    const { provider, credentials, settings, webhookSecret } = parsed.data;

    // Check if already exists
    const existing = await integrationService.getConfig(organizationId, provider as IntegrationProvider);

    if (existing) {
      sendConflict(res, "Integration already configured. Use PATCH to update.");
      return;
    }

    const config = await integrationService.createConfig({
      organizationId,
      provider: provider as IntegrationProvider,
      credentials: credentials as object,
      settings: settings as object | undefined,
      webhookSecret,
    });
    await auditLogs.record({
      organizationId,
      actorUserId: (req as { userId?: string }).userId,
      category: "INTEGRATION",
      action: "INTEGRATION_CREATED",
      targetType: "integration_config",
      targetId: config.id,
      severity: "WARN",
      metadata: { provider: config.provider },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    sendCreated(res, {
      id: config.id,
      provider: config.provider,
      status: config.status,
      message: "Integration created. Use POST /:provider/test to validate credentials.",
    });
  });

  // ── Update an integration ───────────────────────────────────────────
  router.patch("/:provider", async (req: Request, res: Response) => {
    const organizationId = resolveOrgId(req, res);
    if (!organizationId) return;
    const provider = resolveProviderParam(req.params.provider, res);
    if (!provider) return;

    const parsed = updateIntegrationSchema.safeParse(req.body);
    if (!parsed.success) {
      sendBadRequest(res, "Invalid request", parsed.error.issues);
      return;
    }

    const config = await integrationService.getConfig(organizationId, provider as IntegrationProvider);

    if (!config) {
      sendNotFound(res, "Integration not configured");
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (parsed.data.credentials) {
      // Merge new credentials with existing (allows partial updates)
      const existingCreds = decodeCredentials(config.credentials);
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

    const updated = await integrationService.updateConfig(organizationId, provider as IntegrationProvider, updateData);
    await auditLogs.record({
      organizationId,
      actorUserId: (req as { userId?: string }).userId,
      category: "INTEGRATION",
      action: "INTEGRATION_UPDATED",
      targetType: "integration_config",
      targetId: updated.id,
      severity: "WARN",
      metadata: { provider: updated.provider, updated_fields: Object.keys(updateData) },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    sendSuccess(res, {
      id: updated.id,
      provider: updated.provider,
      enabled: updated.enabled,
      status: updated.status,
    });
  });

  // ── Delete an integration ───────────────────────────────────────────
  router.delete("/:provider", async (req: Request, res: Response) => {
    const organizationId = resolveOrgId(req, res);
    if (!organizationId) return;
    const provider = resolveProviderParam(req.params.provider, res);
    if (!provider) return;

    const config = await integrationService.getConfig(organizationId, provider as IntegrationProvider);

    if (!config) {
      sendNotFound(res, "Integration not configured");
      return;
    }

    await integrationService.deleteConfig(organizationId, provider as IntegrationProvider);
    await auditLogs.record({
      organizationId,
      actorUserId: (req as { userId?: string }).userId,
      category: "INTEGRATION",
      action: "INTEGRATION_DELETED",
      targetType: "integration_config",
      targetId: config.id,
      severity: "CRITICAL",
      metadata: { provider },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    sendSuccess(res, { deleted: true, provider });
  });

  // ── Test credentials ────────────────────────────────────────────────
  router.post("/:provider/test", async (req: Request, res: Response) => {
    const organizationId = resolveOrgId(req, res);
    if (!organizationId) return;
    const provider = resolveProviderParam(req.params.provider, res);
    if (!provider) return;

    const config = await integrationService.getConfig(organizationId, provider as IntegrationProvider);

    if (!config) {
      sendNotFound(res, "Integration not configured");
      return;
    }

    const credentials = decodeCredentials(config.credentials);

    // Find the provider implementation
    const selection = resolveIntegrationProviderSelection(provider, registry);
    if (!selection.supportsCredentialValidation) {
      if (selection.kind === "webhook_only") {
        await integrationService.setConfigStatus(config.id, "ACTIVE", null);
        await auditLogs.record({
          organizationId,
          actorUserId: (req as { userId?: string }).userId,
          category: "INTEGRATION",
          action: "INTEGRATION_CREDENTIALS_TESTED",
          targetType: "integration_config",
          targetId: config.id,
          severity: "INFO",
          metadata: { provider, valid: true },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        sendSuccess(res, { valid: true, message: "Merge.dev integration activated" });
        return;
      }
      sendBadRequest(res, "No provider implementation available");
      return;
    }

    try {
      const valid = await (selection.callProvider ?? selection.crmProvider)!.validateCredentials(
        credentials as any
      );

      if (valid) {
        await integrationService.setConfigStatus(config.id, "ACTIVE", null);
        await auditLogs.record({
          organizationId,
          actorUserId: (req as { userId?: string }).userId,
          category: "INTEGRATION",
          action: "INTEGRATION_CREDENTIALS_TESTED",
          targetType: "integration_config",
          targetId: config.id,
          severity: "INFO",
          metadata: { provider, valid: true },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        sendSuccess(res, { valid: true, message: "Credentials validated successfully" });
      } else {
        await integrationService.setConfigStatus(config.id, "ERROR", "Credential validation failed");
        await auditLogs.record({
          organizationId,
          actorUserId: (req as { userId?: string }).userId,
          category: "INTEGRATION",
          action: "INTEGRATION_CREDENTIALS_TESTED",
          targetType: "integration_config",
          targetId: config.id,
          severity: "WARN",
          metadata: { provider, valid: false },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        sendSuccess(res, { valid: false, message: "Credential validation failed" });
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Validation error";
      await integrationService.setConfigStatus(config.id, "ERROR", errorMessage);
      await auditLogs.record({
        organizationId,
        actorUserId: (req as { userId?: string }).userId,
        category: "INTEGRATION",
        action: "INTEGRATION_CREDENTIALS_TESTED",
        targetType: "integration_config",
        targetId: config.id,
        severity: "WARN",
        metadata: { provider, valid: false, error: errorMessage },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
      sendSuccess(res, { valid: false, message: errorMessage });
    }
  });

  // ── Trigger on-demand sync ──────────────────────────────────────────
  router.post("/:provider/sync", async (req: Request, res: Response) => {
    const organizationId = resolveOrgId(req, res);
    if (!organizationId) return;
    const provider = resolveProviderParam(req.params.provider, res);
    if (!provider) return;
    const selection = resolveIntegrationProviderSelection(provider, registry);
    if (!selection.supportsManualSync && selection.kind === "webhook_only") {
      sendBadRequest(res, "Merge.dev uses webhook-based sync. No on-demand sync available.");
      return;
    }
    if (!selection.supportsManualSync) {
      sendBadRequest(res, "No provider implementation available");
      return;
    }

    const config = await integrationService.getConfig(organizationId, provider as IntegrationProvider);

    if (!config) {
      sendNotFound(res, "Integration not configured");
      return;
    }

    if (config.status !== "ACTIVE") {
      sendBadRequest(res, "Integration must be in ACTIVE status. Test credentials first.");
      return;
    }

    const rawIdempotency = req.headers["x-idempotency-key"];
    const idempotencyKey =
      typeof rawIdempotency === "string" && rawIdempotency.trim().length > 0
        ? `manual:${config.id}:${rawIdempotency.trim()}`
        : `manual:${config.id}:${Date.now()}`;

    // Run sync in background — don't block the HTTP response
    syncEngine
      .syncIntegration(config, {
        runType: "MANUAL",
        idempotencyKey,
      })
      .catch((err) => {
      logger.error(`On-demand sync failed for ${provider}`, { error: err });
    });
    await auditLogs.record({
      organizationId,
      actorUserId: (req as { userId?: string }).userId,
      category: "INTEGRATION",
      action: "INTEGRATION_SYNC_TRIGGERED",
      targetType: "integration_config",
      targetId: config.id,
      severity: "WARN",
      metadata: { provider, trigger: "manual", idempotency_key: idempotencyKey },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    sendSuccess(res, {
      message: `Sync started for ${provider}. Check status via GET /api/integrations/${provider.toLowerCase()}`,
    });
  });

  // ── Integration Run Ledger / Dead-Letter Replay ─────────────────────

  router.get("/ops/runs", async (req: Request, res: Response) => {
    const organizationId = resolveOrgId(req, res);
    if (!organizationId) return;
    const status = (req.query.status as string | undefined)?.trim();
    const provider = resolveProviderFilter(req.query.provider, res);
    if (provider === null) return;
    const limit = parseBoundedLimit(req.query.limit, {
      fallback: PAGINATION_LIMITS.INTEGRATION_DEFAULT,
      max: PAGINATION_LIMITS.INTEGRATION_MAX,
    });

    const runs = await integrationService.listRuns(
      organizationId,
      {
        status,
        provider: provider as IntegrationProvider | undefined,
      },
      limit
    );

    sendSuccess(res, {
      runs: runs.map((r) => ({
        id: r.id,
        provider: r.provider,
        run_type: r.runType,
        status: r.status,
        idempotency_key: r.idempotencyKey,
        started_at: r.startedAt.toISOString(),
        finished_at: r.finishedAt?.toISOString() ?? null,
        processed_count: r.processedCount,
        success_count: r.successCount,
        failure_count: r.failureCount,
        error_message: r.errorMessage,
      })),
    });
  });

  router.post("/ops/runs/:runId/replay", async (req: Request, res: Response) => {
    const organizationId = resolveOrgId(req, res);
    if (!organizationId) return;
    const runId = Array.isArray(req.params.runId)
      ? (req.params.runId[0] ?? "")
      : (req.params.runId ?? "");
    try {
      const replay = await syncEngine.replayFailedRun(runId, organizationId);
      await auditLogs.record({
        organizationId,
        actorUserId: (req as { userId?: string }).userId,
        category: "INTEGRATION",
        action: "INTEGRATION_RUN_REPLAY_TRIGGERED",
        targetType: "integration_run",
        targetId: runId,
        severity: "CRITICAL",
        metadata: {
          replay_run_id: replay.replayRunId,
          replay_attempt: replay.replayAttempt,
          replay_attempt_cap: replay.replayAttemptCap,
          replay_window_hours: replay.replayWindowHours,
          source_run_age_hours: replay.sourceRunAgeHours,
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
      sendSuccess(res, {
        replaying: true,
        run_id: runId,
        replay_run_id: replay.replayRunId,
        replay_attempt: replay.replayAttempt,
        replay_attempt_cap: replay.replayAttemptCap,
        replay_window_hours: replay.replayWindowHours,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to replay integration run";
      sendBadRequest(res, message);
    }
  });

  router.get("/ops/dead-letter", async (req: Request, res: Response) => {
    const organizationId = resolveOrgId(req, res);
    if (!organizationId) return;
    const provider = resolveProviderFilter(req.query.provider, res);
    if (provider === null) return;
    const limit = parseBoundedLimit(req.query.limit, {
      fallback: PAGINATION_LIMITS.INTEGRATION_DEFAULT,
      max: PAGINATION_LIMITS.INTEGRATION_MAX,
    });

    const failedRuns = await integrationService.listFailedRuns(
      organizationId,
      provider as IntegrationProvider | undefined,
      limit
    );

    sendSuccess(res, {
      failed_runs: failedRuns.map((r) => ({
        id: r.id,
        provider: r.provider,
        run_type: r.runType,
        started_at: r.startedAt.toISOString(),
        finished_at: r.finishedAt?.toISOString() ?? null,
        processed_count: r.processedCount,
        success_count: r.successCount,
        failure_count: r.failureCount,
        error_message: r.errorMessage,
        idempotency_key: r.idempotencyKey,
      })),
      total_failed: failedRuns.length,
    });
  });

  router.post("/ops/dead-letter/:runId/replay", async (req: Request, res: Response) => {
    const organizationId = resolveOrgId(req, res);
    if (!organizationId) return;
    const runId = Array.isArray(req.params.runId)
      ? (req.params.runId[0] ?? "")
      : (req.params.runId ?? "");
    try {
      const replay = await syncEngine.replayFailedRun(runId, organizationId);
      await auditLogs.record({
        organizationId,
        actorUserId: (req as { userId?: string }).userId,
        category: "INTEGRATION",
        action: "DEAD_LETTER_RUN_REPLAY_TRIGGERED",
        targetType: "integration_run",
        targetId: runId,
        severity: "CRITICAL",
        metadata: {
          replay_run_id: replay.replayRunId,
          replay_attempt: replay.replayAttempt,
          replay_attempt_cap: replay.replayAttemptCap,
          replay_window_hours: replay.replayWindowHours,
          source_run_age_hours: replay.sourceRunAgeHours,
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
      sendSuccess(res, {
        replaying: true,
        run_id: runId,
        replay_run_id: replay.replayRunId,
        replay_attempt: replay.replayAttempt,
        replay_attempt_cap: replay.replayAttemptCap,
        replay_window_hours: replay.replayWindowHours,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to replay dead-letter run";
      sendBadRequest(res, message);
    }
  });

  // ── Backfill Jobs (range/cursor based) ─────────────────────────────

  router.get("/ops/backfills", async (req: Request, res: Response) => {
    const organizationId = resolveOrgId(req, res);
    if (!organizationId) return;
    const provider = resolveProviderFilter(req.query.provider, res);
    if (provider === null) return;
    const limit = parseBoundedLimit(req.query.limit, {
      fallback: PAGINATION_LIMITS.INTEGRATION_DEFAULT,
      max: PAGINATION_LIMITS.INTEGRATION_MAX,
    });

    const runs = await integrationService.listBackfillRuns(
      organizationId,
      provider as IntegrationProvider | undefined,
      limit
    );

    sendSuccess(res, {
      backfills: runs.map((r) => ({
        id: r.id,
        provider: r.provider,
        status: r.status,
        idempotency_key: r.idempotencyKey,
        started_at: r.startedAt.toISOString(),
        finished_at: r.finishedAt?.toISOString() ?? null,
        processed_count: r.processedCount,
        success_count: r.successCount,
        failure_count: r.failureCount,
        error_message: r.errorMessage,
      })),
    });
  });

  router.post("/ops/backfills", async (req: Request, res: Response) => {
    const organizationId = resolveOrgId(req, res);
    if (!organizationId) return;
    const parsed = backfillSchema.safeParse(req.body);
    if (!parsed.success) {
      sendBadRequest(res, "validation_error", parsed.error.issues);
      return;
    }

    const provider = parsed.data.provider as IntegrationProvider;
    const config = await integrationService.getConfig(organizationId, provider);
    if (!config) {
      sendNotFound(res, "Integration not configured");
      return;
    }

    const sinceOverride = parsed.data.start_date
      ? new Date(parsed.data.start_date)
      : null;
    const rawIdempotency =
      parsed.data.idempotency_key ??
      `backfill:${config.id}:${parsed.data.start_date ?? "none"}:${parsed.data.cursor ?? "none"}:${Date.now()}`;
    const idempotencyKey = `backfill:${config.id}:${rawIdempotency}`;

    syncEngine
      .syncIntegration(config, {
        runType: "BACKFILL",
        idempotencyKey,
        sinceOverride,
        cursorOverride: parsed.data.cursor ?? null,
      })
      .catch((err) => {
        logger.error(`Backfill failed for ${provider}`, { error: err });
      });

    await auditLogs.record({
      organizationId,
      actorUserId: (req as { userId?: string }).userId,
      category: "INTEGRATION",
      action: "INTEGRATION_BACKFILL_TRIGGERED",
      targetType: "integration_config",
      targetId: config.id,
      severity: "CRITICAL",
      metadata: {
        provider,
        idempotency_key: idempotencyKey,
        start_date: parsed.data.start_date ?? null,
        end_date: parsed.data.end_date ?? null,
        cursor: parsed.data.cursor ?? null,
      },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    sendSuccess(res, {
      started: true,
      provider,
      idempotency_key: idempotencyKey,
      message: "Backfill run started. Track via GET /api/integrations/ops/backfills",
    }, 202);
  });

  return router;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Redacts sensitive fields from credentials before sending to the client.
 * Shows the first 2 chars of API keys/tokens so the user can identify them.
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
        value.length > 2 ? `${value.slice(0, 2)}${"*".repeat(12)}` : "****";
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}
