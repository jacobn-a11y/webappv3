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
import { generateApiKey, hashApiKey } from "../middleware/api-key-auth.js";
import { getOrganizationIdOrThrow, TenantGuardError } from "../lib/tenant-guard.js";
import { AuditLogService } from "../services/audit-log.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AuthenticatedRequest extends Request {
  organizationId?: string;
  userId?: string;
}

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
  router.post("/", async (req: AuthenticatedRequest, res: Response) => {
    const orgId = resolveOrgId(req, res);
    if (!orgId) return;

    const parseResult = CreateKeySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: "validation_error",
        details: parseResult.error.issues,
      });
      return;
    }

    const { label, scopes, expires_in_days } = parseResult.data;
    const { raw, hash, prefix } = generateApiKey();

    const expiresAt = expires_in_days
      ? new Date(Date.now() + expires_in_days * 24 * 60 * 60 * 1000)
      : null;

    try {
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

      res.status(201).json({
        id: apiKey.id,
        key: raw, // Only returned on creation
        prefix: apiKey.keyPrefix,
        label: apiKey.label,
        scopes: apiKey.scopes,
        expires_at: apiKey.expiresAt,
        created_at: apiKey.createdAt,
      });
    } catch (err) {
      console.error("Failed to create API key:", err);
      res.status(500).json({ error: "Failed to create API key" });
    }
  });

  /**
   * GET /api/keys
   *
   * List all API keys for the organization. Does not return the raw key.
   */
  router.get("/", async (req: AuthenticatedRequest, res: Response) => {
    const orgId = resolveOrgId(req, res);
    if (!orgId) return;

    try {
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

      res.json({
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
    } catch (err) {
      console.error("Failed to list API keys:", err);
      res.status(500).json({ error: "Failed to list API keys" });
    }
  });

  /**
   * POST /api/keys/:keyId/rotate
   *
   * Rotate an API key. Creates a new key and marks the old one as revoked
   * with a grace period. Both keys work during the grace period.
   */
  router.post(
    "/:keyId/rotate",
    async (req: AuthenticatedRequest, res: Response) => {
      const orgId = resolveOrgId(req, res);
      if (!orgId) return;

      const parseResult = RotateKeySchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: "validation_error",
          details: parseResult.error.issues,
        });
        return;
      }

      const { grace_period_hours } = parseResult.data;
      const keyId = req.params.keyId as string;

      try {
        const existingKey = await prisma.apiKey.findFirst({
          where: { id: keyId, organizationId: orgId },
        });

        if (!existingKey) {
          res.status(404).json({ error: "API key not found" });
          return;
        }

        if (existingKey.revokedAt) {
          res.status(409).json({
            error: "key_already_revoked",
            message: "Cannot rotate an already-revoked key.",
          });
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

        res.status(201).json({
          new_key: {
            id: newKey.id,
            key: raw, // Only returned on creation
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
      } catch (err) {
        console.error("Failed to rotate API key:", err);
        res.status(500).json({ error: "Failed to rotate API key" });
      }
    }
  );

  /**
   * DELETE /api/keys/:keyId
   *
   * Immediately revoke an API key. It will stop working at once
   * (no grace period).
   */
  router.delete(
    "/:keyId",
    async (req: AuthenticatedRequest, res: Response) => {
      const orgId = resolveOrgId(req, res);
      if (!orgId) return;

      const keyId = req.params.keyId as string;

      try {
        const existingKey = await prisma.apiKey.findFirst({
          where: { id: keyId, organizationId: orgId },
        });

        if (!existingKey) {
          res.status(404).json({ error: "API key not found" });
          return;
        }

        if (existingKey.revokedAt) {
          res.status(409).json({ error: "API key already revoked" });
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

        res.json({
          revoked: true,
          id: keyId,
          message: "API key has been revoked immediately.",
        });
      } catch (err) {
        console.error("Failed to revoke API key:", err);
        res.status(500).json({ error: "Failed to revoke API key" });
      }
    }
  );

  /**
   * GET /api/keys/:keyId/usage
   *
   * Get usage statistics for an API key, useful for billing review.
   */
  router.get(
    "/:keyId/usage",
    async (req: AuthenticatedRequest, res: Response) => {
      const orgId = resolveOrgId(req, res);
      if (!orgId) return;

      const keyId = req.params.keyId as string;
      const since = req.query.since
        ? new Date(req.query.since as string)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // default: last 30 days

      try {
        const key = await prisma.apiKey.findFirst({
          where: { id: keyId, organizationId: orgId },
          select: { id: true, keyPrefix: true, label: true },
        });

        if (!key) {
          res.status(404).json({ error: "API key not found" });
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

        res.json({
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
      } catch (err) {
        console.error("Failed to fetch API key usage:", err);
        res.status(500).json({ error: "Failed to fetch usage data" });
      }
    }
  );

  return router;
}
