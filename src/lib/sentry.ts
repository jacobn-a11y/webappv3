/**
 * Sentry Error Tracking
 *
 * Initializes Sentry for error tracking and performance monitoring.
 * Captures unhandled exceptions, unhandled promise rejections, and
 * Express request errors with full context (request ID, user, org).
 */

import * as Sentry from "@sentry/node";
import type { Request } from "express";
import logger from "./logger.js";

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.info("Sentry DSN not configured, error tracking disabled");
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    release: `storyengine@0.1.0`,
    tracesSampleRate: parseFloat(
      process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"
    ),
    integrations: [Sentry.httpIntegration(), Sentry.expressIntegration()],
    beforeSend(event) {
      // Strip PII from breadcrumbs if present
      if (event.breadcrumbs) {
        for (const crumb of event.breadcrumbs) {
          if (crumb.data?.url) {
            // Remove query params that might contain sensitive data
            try {
              const url = new URL(crumb.data.url as string);
              url.search = "";
              crumb.data.url = url.toString();
            } catch {
              // not a valid URL, leave as-is
            }
          }
        }
      }
      return event;
    },
  });

  logger.info("Sentry error tracking initialized");
}

/**
 * Sets Sentry user/org context from an Express request.
 * Call this in middleware after auth has resolved.
 */
export function setSentryRequestContext(req: Request): void {
  const authReq = req as unknown as Record<string, unknown>;

  Sentry.setUser({
    id: authReq.userId as string | undefined,
  });

  Sentry.setTag("organizationId", authReq.organizationId as string | undefined);
  Sentry.setTag(
    "requestId",
    (req.headers["x-request-id"] as string) ?? undefined
  );
}

export { Sentry };
