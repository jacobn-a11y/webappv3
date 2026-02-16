/**
 * API Key Authentication Middleware
 *
 * Authenticates third-party consumers of the public RAG endpoint using
 * API keys passed via the Authorization header (Bearer scheme) or X-API-Key.
 *
 * Keys are stored hashed (SHA-256) in the database and scoped to an organization.
 * Supports key rotation with a grace period where both old and new keys work.
 */

import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { PrismaClient } from "@prisma/client";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ApiKeyAuthRequest extends Request {
  apiKeyId?: string;
  organizationId?: string;
  apiKeyScopes?: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Hash a raw API key to match against the stored hash. */
export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

/** Generate a new API key with a recognizable prefix. */
export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const random = crypto.randomBytes(32).toString("base64url");
  const raw = `se_live_${random}`;
  const hash = hashApiKey(raw);
  const prefix = raw.slice(0, 12); // "se_live_XXXX"
  return { raw, hash, prefix };
}

/** Extract the API key from request headers. */
function extractKey(req: Request): string | null {
  // Check Authorization: Bearer <key>
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // Check X-API-Key header
  const xApiKey = req.headers["x-api-key"];
  if (typeof xApiKey === "string" && xApiKey.length > 0) {
    return xApiKey;
  }

  return null;
}

// ─── Middleware Factory ──────────────────────────────────────────────────────

/**
 * Creates middleware that authenticates requests using API keys.
 * Attaches `apiKeyId`, `organizationId`, and `apiKeyScopes` to the request
 * on success.
 */
export function createApiKeyAuth(prisma: PrismaClient) {
  return async (
    req: ApiKeyAuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const rawKey = extractKey(req);

    if (!rawKey) {
      res.status(401).json({
        error: "api_key_required",
        message:
          "API key is required. Pass it via Authorization: Bearer <key> or X-API-Key header.",
      });
      return;
    }

    const keyHash = hashApiKey(rawKey);

    const apiKey = await prisma.apiKey.findUnique({
      where: { keyHash },
      include: { organization: { select: { id: true, name: true, plan: true } } },
    });

    if (!apiKey) {
      res.status(401).json({
        error: "invalid_api_key",
        message: "The provided API key is not valid.",
      });
      return;
    }

    // Check if key has been revoked
    if (apiKey.revokedAt) {
      // If this key was rotated (replaced by a new key), check if we're still
      // within the grace period.
      if (apiKey.gracePeriodEndsAt && new Date() < apiKey.gracePeriodEndsAt) {
        // Grace period active — allow the old key through
      } else {
        res.status(401).json({
          error: "api_key_revoked",
          message: "This API key has been revoked.",
        });
        return;
      }
    }

    // Check expiration
    if (apiKey.expiresAt && new Date() > apiKey.expiresAt) {
      res.status(401).json({
        error: "api_key_expired",
        message: "This API key has expired.",
      });
      return;
    }

    // Attach identity to request
    req.apiKeyId = apiKey.id;
    req.organizationId = apiKey.organizationId;
    req.apiKeyScopes = apiKey.scopes;

    // Update lastUsedAt (fire-and-forget, don't block the request)
    prisma.apiKey
      .update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {
        // Non-critical — swallow errors
      });

    next();
  };
}

/**
 * Middleware that checks if the authenticated API key has a required scope.
 */
export function requireScope(scope: string) {
  return (
    req: ApiKeyAuthRequest,
    res: Response,
    next: NextFunction
  ): void => {
    if (!req.apiKeyScopes || !req.apiKeyScopes.includes(scope)) {
      res.status(403).json({
        error: "insufficient_scope",
        message: `This API key does not have the required scope: ${scope}`,
      });
      return;
    }
    next();
  };
}
