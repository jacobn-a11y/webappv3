/**
 * API Key Management Routes
 *
 * Allows organization admins to create, list, rotate, and revoke API keys
 * for third-party RAG endpoint consumers.
 *
 * Key rotation supports a configurable grace period (default: 24 hours)
 * during which both old and new keys are accepted.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { generateApiKey, hashApiKey as _hashApiKey } from "../middleware/api-key-auth.js";
import { getOrganizationIdOrThrow, TenantGuardError } from "../lib/tenant-guard.js";
import { AuditLogService } from "../services/audit-log.js";
import type { AuthenticatedRequest } from "../types/authenticated-request.js";
import logger from "../lib/logger.js";
import { asyncHandler } from "../lib/async-handler.js";
import { sendSuccess, sendCreated, sendNotFound, sendBadRequest, sendConflict } from "./_shared/responses.js";

// ─── Validation ──────────────────────────────────────────────────────────────

const CreateKeySchema = z.object({
  label: z
    .string()
    .min(1, "Label is required")
    .max(100, "Label must be under 100 characters"),
  scopes: z
    .array(z.string())
    .min(1, "At least one scope is required")
    .optional(),
  expires_in_days: z.number().int().min(1).max(365).optional(),
});

const RotateKeySchema = z.object({
  grace_period_hours: z
    .number()
    .int()
    .min(0)
    .max(168) // max 7 days
    .optional()
    .default(24),
});

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createApiKeyRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const auditLogs = new AuditLogService(prisma);
  const resolveOrgId = (req: Request, res: Response): string | null => {
    try {
      return getOrganizationIdOrThrow(req);
    } catch (error) {
      if (error instanceof TenantGuardError) {
        res.status(error.statusCode).json({ error: error.message });
        return null;
      }
      throw error;
    }
  };

  /**
   * POST /api/keys
   *
   * Create a new API key for the organization.
   * Returns the raw key only once — it cannot be retrieved later.
   */
  router.post("/", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const orgId = resolveOrgId(req, res);
    if (!orgId) return;

    const parseResult = CreateKeySchema.safeParse(req.body);
    if (!parseResult.success) {
      sendBadRequest(res, "validation_error", parseResult.error.issues);
      return;
    }

    const { label, scopes, expires_in_days } = parseResult.data;
    const { raw, hash, prefix } = generateApiKey();

    const expiresAt = expires_in_days
      ? new Date(Date.now() + expires_in_days * 24 * 60 * 60 * 1000)
      : null;

      const apiKey = await prisma.apiKey.create({
        data: {
          organizationId: orgId,
          keyHash: hash,
          keyPrefix: prefix,
          label,
          scopes: scopes ?? ["rag:query"],
          expiresAt,
        },
      });
      await auditLogs.record({
        organizationId: orgId,
        actorUserId: req.userId,
        category: "ADMIN",
        action: "API_KEY_CREATED",
        targetType: "api_key",
        targetId: apiKey.id,
        severity: "CRITICAL",
        metadata: { scopes: apiKey.scopes, expires_at: apiKey.expiresAt },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      sendCreated(res, {
        id: apiKey.id,
        key: raw,
        prefix: apiKey.keyPrefix,
        label: apiKey.label,
        scopes: apiKey.scopes,
        expires_at: apiKey.expiresAt,
        created_at: apiKey.createdAt,
      });
    
  }));

  /**
   * GET /api/keys
   *
   * List all API keys for the organization. Does not return the raw key.
   */
  router.get("/", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const orgId = resolveOrgId(req, res);
    if (!orgId) return;

      const keys = await prisma.apiKey.findMany({
        where: { organizationId: orgId },
        select: {
          id: true,
          keyPrefix: true,
          label: true,
          scopes: true,
          expiresAt: true,
          revokedAt: true,
          lastUsedAt: true,
          replacedByKeyId: true,
          gracePeriodEndsAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      });

      sendSuccess(res, {
        keys: keys.map((k) => ({
          id: k.id,
          prefix: k.keyPrefix,
          label: k.label,
          scopes: k.scopes,
          expires_at: k.expiresAt,
          revoked_at: k.revokedAt,
          last_used_at: k.lastUsedAt,
          replaced_by_key_id: k.replacedByKeyId,
          grace_period_ends_at: k.gracePeriodEndsAt,
          created_at: k.createdAt,
          status: k.revokedAt
            ? k.gracePeriodEndsAt && new Date() < k.gracePeriodEndsAt
              ? "rotating"
              : "revoked"
            : k.expiresAt && new Date() > k.expiresAt
              ? "expired"
              : "active",
        })),
      });
    
  }));

  /**
   * POST /api/keys/:keyId/rotate
   *
   * Rotate an API key. Creates a new key and marks the old one as revoked
   * with a grace period. Both keys work during the grace period.
   */
  router.post(
    "/:keyId/rotate",
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const orgId = resolveOrgId(req, res);
      if (!orgId) return;

      const parseResult = RotateKeySchema.safeParse(req.body);
      if (!parseResult.success) {
        sendBadRequest(res, "validation_error", parseResult.error.issues);
        return;
      }

      const { grace_period_hours } = parseResult.data;
      const keyId = req.params.keyId as string;

        const existingKey = await prisma.apiKey.findFirst({
          where: { id: keyId, organizationId: orgId },
        });

        if (!existingKey) {
          sendNotFound(res, "API key not found");
          return;
        }

        if (existingKey.revokedAt) {
          sendConflict(res, "Cannot rotate an already-revoked key.");
          return;
        }

        // Generate new key
        const { raw, hash, prefix } = generateApiKey();
        const gracePeriodEndsAt = new Date(
          Date.now() + grace_period_hours * 60 * 60 * 1000
        );

        // Create new key and revoke old one in a transaction
        const [newKey] = await prisma.$transaction([
          prisma.apiKey.create({
            data: {
              organizationId: orgId,
              keyHash: hash,
              keyPrefix: prefix,
              label: existingKey.label,
              scopes: existingKey.scopes,
              expiresAt: existingKey.expiresAt,
            },
          }),
          prisma.apiKey.updateMany({
            where: { id: keyId, organizationId: orgId },
            data: {
              revokedAt: new Date(),
              gracePeriodEndsAt,
              replacedByKeyId: undefined, // will be set below
            },
          }),
        ]);

        // Link old key → new key
        await prisma.apiKey.updateMany({
          where: { id: keyId, organizationId: orgId },
          data: { replacedByKeyId: newKey.id },
        });
        await auditLogs.record({
          organizationId: orgId,
          actorUserId: req.userId,
          category: "ADMIN",
          action: "API_KEY_ROTATED",
          targetType: "api_key",
          targetId: keyId,
          severity: "CRITICAL",
          metadata: {
            new_key_id: newKey.id,
            grace_period_ends_at: gracePeriodEndsAt,
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });

        sendCreated(res, {
          new_key: {
            id: newKey.id,
            key: raw,
            prefix: newKey.keyPrefix,
            label: newKey.label,
            scopes: newKey.scopes,
            expires_at: newKey.expiresAt,
            created_at: newKey.createdAt,
          },
          old_key: {
            id: existingKey.id,
            prefix: existingKey.keyPrefix,
            grace_period_ends_at: gracePeriodEndsAt,
          },
          message: `Old key will continue to work until ${gracePeriodEndsAt.toISOString()}. Update your integration to use the new key before then.`,
        });
      
    }
  ));

  /**
   * DELETE /api/keys/:keyId
   *
   * Immediately revoke an API key. It will stop working at once
   * (no grace period).
   */
  router.delete(
    "/:keyId",
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const orgId = resolveOrgId(req, res);
      if (!orgId) return;

      const keyId = req.params.keyId as string;

        const existingKey = await prisma.apiKey.findFirst({
          where: { id: keyId, organizationId: orgId },
        });

        if (!existingKey) {
          sendNotFound(res, "API key not found");
          return;
        }

        if (existingKey.revokedAt) {
          sendConflict(res, "API key already revoked");
          return;
        }

        await prisma.apiKey.updateMany({
          where: { id: keyId, organizationId: orgId },
          data: { revokedAt: new Date(), gracePeriodEndsAt: null },
        });
        await auditLogs.record({
          organizationId: orgId,
          actorUserId: req.userId,
          category: "ADMIN",
          action: "API_KEY_REVOKED",
          targetType: "api_key",
          targetId: keyId,
          severity: "CRITICAL",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });

        sendSuccess(res, {
          revoked: true,
          id: keyId,
          message: "API key has been revoked immediately.",
        });
      
    }
  ));

  /**
   * GET /api/keys/:keyId/usage
   *
   * Get usage statistics for an API key, useful for billing review.
   */
  router.get(
    "/:keyId/usage",
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const orgId = resolveOrgId(req, res);
      if (!orgId) return;

      const keyId = req.params.keyId as string;
      const since = req.query.since
        ? new Date(req.query.since as string)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // default: last 30 days

        const key = await prisma.apiKey.findFirst({
          where: { id: keyId, organizationId: orgId },
          select: { id: true, keyPrefix: true, label: true },
        });

        if (!key) {
          sendNotFound(res, "API key not found");
          return;
        }

        const [totalRequests, totalTokens, recentLogs] = await Promise.all([
          prisma.apiUsageLog.count({
            where: {
              apiKeyId: keyId,
              organizationId: orgId,
              createdAt: { gte: since },
            },
          }),
          prisma.apiUsageLog.aggregate({
            where: {
              apiKeyId: keyId,
              organizationId: orgId,
              createdAt: { gte: since },
              tokensUsed: { not: null },
            },
            _sum: { tokensUsed: true },
          }),
          prisma.apiUsageLog.findMany({
            where: {
              apiKeyId: keyId,
              organizationId: orgId,
              createdAt: { gte: since },
            },
            orderBy: { createdAt: "desc" },
            take: 100,
            select: {
              endpoint: true,
              method: true,
              statusCode: true,
              tokensUsed: true,
              responseTimeMs: true,
              createdAt: true,
            },
          }),
        ]);

        sendSuccess(res, {
          key_id: key.id,
          prefix: key.keyPrefix,
          label: key.label,
          since: since.toISOString(),
          total_requests: totalRequests,
          total_tokens_used: totalTokens._sum?.tokensUsed ?? 0,
          recent_logs: recentLogs.map((l) => ({
            endpoint: l.endpoint,
            method: l.method,
            status_code: l.statusCode,
            tokens_used: l.tokensUsed,
            response_time_ms: l.responseTimeMs,
            timestamp: l.createdAt,
          })),
        });
      
    }
  ));

  return router;
}
