/**
 * API Usage Logger Middleware
 *
 * Logs every authenticated API request for billing and analytics.
 * Captures endpoint, method, status code, response time, and token usage
 * (when available in the response body).
 *
 * Writes are non-blocking: the response is sent before the log is persisted.
 */

import type { Response, NextFunction } from "express";
import type { PrismaClient } from "@prisma/client";
import type { ApiKeyAuthRequest } from "./api-key-auth.js";
import logger from "../lib/logger.js";

// ─── Middleware Factory ──────────────────────────────────────────────────────

export function createApiUsageLogger(prisma: PrismaClient) {
  return (
    req: ApiKeyAuthRequest,
    res: Response,
    next: NextFunction
  ): void => {
    if (!req.apiKeyId || !req.organizationId) {
      next();
      return;
    }

    const startTime = Date.now();
    const apiKeyId = req.apiKeyId;
    const organizationId = req.organizationId;
    const endpoint = req.originalUrl;
    const method = req.method;

    // Intercept res.json to capture tokens_used from response body
    const originalJson = res.json.bind(res);
    let tokensUsed: number | undefined;

    res.json = function (body: unknown) {
      if (body && typeof body === "object" && "tokens_used" in body) {
        const val = (body as Record<string, unknown>).tokens_used;
        if (typeof val === "number") {
          tokensUsed = val;
        }
      }
      return originalJson(body);
    };

    // Log after the response is finished
    res.on("finish", () => {
      const responseTimeMs = Date.now() - startTime;

      prisma.apiUsageLog
        .create({
          data: {
            apiKeyId,
            organizationId,
            endpoint,
            method,
            statusCode: res.statusCode,
            tokensUsed: tokensUsed ?? null,
            responseTimeMs,
          },
        })
        .catch((err) => {
          logger.warn("Failed to log API usage", { error: err });
        });
    });

    next();
  };
}
