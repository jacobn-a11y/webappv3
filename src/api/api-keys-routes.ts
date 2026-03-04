/**
 * API Keys Routes — RAG Chatbot Connector API Keys
 *
 * Provides endpoints for managing API keys used to authenticate
 * third-party chatbot integrations against the RAG query API:
 *   - List active keys (showing only prefix, not full key)
 *   - Generate a new key (full key shown only once)
 *   - Revoke an existing key
 */

import { Router, type Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { requirePermission } from "../middleware/permissions.js";
import logger from "../lib/logger.js";
import type { AuthenticatedRequest } from "../types/authenticated-request.js";
import { asyncHandler } from "../lib/async-handler.js";
import { sendUnauthorized, sendSuccess, sendBadRequest, sendCreated, sendNotFound } from "./_shared/responses.js";

// ─── Validation ──────────────────────────────────────────────────────────────

const CreateApiKeySchema = z.object({
  label: z
    .string()
    .min(1, "Label is required")
    .max(100, "Label must be under 100 characters"),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateApiKey(): string {
  const random = crypto.randomBytes(32).toString("base64url");
  return `se_live_${random}`;
}

function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createApiKeysRoutes(prisma: PrismaClient): Router {
  const router = Router();

  // ── List API Keys ────────────────────────────────────────────────────

  /**
   * GET /api/settings/api-keys
   *
   * Returns all API keys for the organization.
   * Only the key prefix is returned — the full key is never stored.
   */
  router.get(
    "/",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

        const keys = await prisma.apiKey.findMany({
          where: {
            organizationId: req.organizationId,
            revokedAt: null,
          },
          select: {
            id: true,
            label: true,
            keyPrefix: true,
            lastUsedAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        });

        sendSuccess(res, { api_keys: keys.map((k) => ({
          id: k.id,
          label: k.label,
          key_prefix: k.keyPrefix,
          last_used_at: k.lastUsedAt,
          created_at: k.createdAt,
        })) });
      
    }
  ));

  // ── Generate API Key ─────────────────────────────────────────────────

  /**
   * POST /api/settings/api-keys
   *
   * Generates a new API key. The full key is returned only in this
   * response — it is hashed before storage and can never be retrieved again.
   */
  router.post(
    "/",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const parse = CreateApiKeySchema.safeParse(req.body);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }

        const rawKey = generateApiKey();
        const keyHash = hashApiKey(rawKey);
        const keyPrefix = rawKey.slice(0, 12) + "...";

        const apiKey = await prisma.apiKey.create({
          data: {
            organizationId: req.organizationId,
            label: parse.data.label,
            keyHash,
            keyPrefix,
          },
        });

        // Return the full key — this is the only time it's visible
        sendCreated(res, {
          api_key: {
            id: apiKey.id,
            label: apiKey.label,
            key: rawKey,
            key_prefix: keyPrefix,
            created_at: apiKey.createdAt,
          },
          warning: "Store this key securely. It will not be shown again.",
        });
      
    }
  ));

  // ── Revoke API Key ───────────────────────────────────────────────────

  /**
   * DELETE /api/settings/api-keys/:keyId
   *
   * Soft-revokes an API key by setting revokedAt timestamp.
   * The key immediately stops working for authentication.
   */
  router.delete(
    "/:keyId",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const apiKey = await prisma.apiKey.findFirst({
      where: {
        id: req.params.keyId as string,
        organizationId: req.organizationId,
        revokedAt: null,
      },
      });

      if (!apiKey) {
      sendNotFound(res, "API key not found");
      return;
      }

      await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { revokedAt: new Date() },
      });

      sendSuccess(res, { revoked: true });
      
    }
  ));

  return router;
}
