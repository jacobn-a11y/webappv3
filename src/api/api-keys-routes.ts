/**
 * API Keys Routes — RAG Chatbot Connector API Keys
 *
 * Provides endpoints for managing API keys used to authenticate
 * third-party chatbot integrations against the RAG query API:
 *   - List active keys (showing only prefix, not full key)
 *   - Generate a new key (full key shown only once)
 *   - Revoke an existing key
 */

import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import type { PrismaClient, UserRole } from "@prisma/client";
import { requirePermission } from "../middleware/permissions.js";

// ─── Validation ──────────────────────────────────────────────────────────────

const CreateApiKeySchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be under 100 characters"),
});

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

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
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        const keys = await prisma.apiKey.findMany({
          where: {
            organizationId: req.organizationId,
            revokedAt: null,
          },
          select: {
            id: true,
            name: true,
            keyPrefix: true,
            lastUsedAt: true,
            createdById: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        });

        res.json({ api_keys: keys.map((k) => ({
          id: k.id,
          name: k.name,
          key_prefix: k.keyPrefix,
          last_used_at: k.lastUsedAt,
          created_by: k.createdById,
          created_at: k.createdAt,
        })) });
      } catch (err) {
        console.error("List API keys error:", err);
        res.status(500).json({ error: "Failed to load API keys" });
      }
    }
  );

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
    async (req: AuthReq, res: Response) => {
      const parse = CreateApiKeySchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: "validation_error", details: parse.error.issues });
        return;
      }

      try {
        const rawKey = generateApiKey();
        const keyHash = hashApiKey(rawKey);
        const keyPrefix = rawKey.slice(0, 12) + "...";

        const apiKey = await prisma.apiKey.create({
          data: {
            organizationId: req.organizationId!,
            name: parse.data.name,
            keyHash,
            keyPrefix,
            createdById: req.userId!,
          },
        });

        // Return the full key — this is the only time it's visible
        res.status(201).json({
          api_key: {
            id: apiKey.id,
            name: apiKey.name,
            key: rawKey,
            key_prefix: keyPrefix,
            created_at: apiKey.createdAt,
          },
          warning: "Store this key securely. It will not be shown again.",
        });
      } catch (err) {
        console.error("Generate API key error:", err);
        res.status(500).json({ error: "Failed to generate API key" });
      }
    }
  );

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
    async (req: AuthReq, res: Response) => {
      try {
        const apiKey = await prisma.apiKey.findFirst({
          where: {
            id: req.params.keyId,
            organizationId: req.organizationId!,
            revokedAt: null,
          },
        });

        if (!apiKey) {
          res.status(404).json({ error: "API key not found" });
          return;
        }

        await prisma.apiKey.update({
          where: { id: apiKey.id },
          data: { revokedAt: new Date() },
        });

        res.json({ revoked: true });
      } catch (err) {
        console.error("Revoke API key error:", err);
        res.status(500).json({ error: "Failed to revoke API key" });
      }
    }
  );

  return router;
}
