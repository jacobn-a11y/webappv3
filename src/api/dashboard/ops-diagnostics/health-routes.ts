/**
 * Ops Diagnostics — Health Routes
 *
 * GET /integrations/health    — Integration health overview
 * GET /ops/diagnostics        — Full system health overview
 * GET /ops/queue-slo          — Queue SLO metrics
 * GET /ops/synthetic-health   — Synthetic health checks
 */

import { type Response, type Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { requirePermission } from "../../../middleware/permissions.js";
import type { AuthenticatedRequest } from "../../../types/authenticated-request.js";
import { asyncHandler } from "../../../lib/async-handler.js";
import { sendSuccess } from "../../_shared/responses.js";
import type { OpsDiagnosticsService } from "../../../services/ops-diagnostics.js";

// ─── Route Registration ─────────────────────────────────────────────────────

interface RegisterHealthRoutesOptions {
  router: Router;
  prisma: PrismaClient;
  service: OpsDiagnosticsService;
}

export function registerHealthRoutes({
  router,
  prisma,
  service,
}: RegisterHealthRoutesOptions): void {
  router.get(
    "/integrations/health",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const organizationId = req.organizationId!;
      const runAgg = await service.getIntegrationHealth(organizationId);

      sendSuccess(res, { integrations: runAgg });

    }
  ));

  router.get(
    "/ops/diagnostics",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const organizationId = req.organizationId!;

      const snapshot = await service.getDiagnosticsSnapshot(organizationId);

      const failedIntegrations = snapshot.integrationConfigs.filter(
      (i) => i.status === "ERROR" || !!i.lastError
      );

      sendSuccess(res, {
      timestamp: new Date().toISOString(),
      tenant: {
        organization_id: organizationId,
        totals: {
          accounts: snapshot.accountCount,
          calls: snapshot.callCount,
          stories: snapshot.storyCount,
          landing_pages: snapshot.pageCount,
        },
      },
      integrations: {
        total: snapshot.integrationConfigs.length,
        enabled: snapshot.integrationConfigs.filter((i) => i.enabled).length,
        failed: failedIntegrations.length,
        providers: snapshot.integrationConfigs.map((i) => ({
          id: i.id,
          provider: i.provider,
          enabled: i.enabled,
          status: i.status,
          last_sync_at: i.lastSyncAt,
          last_error: i.lastError,
          updated_at: i.updatedAt,
        })),
      },
      alerts: {
        unresolved_notifications: snapshot.unresolvedNotifications.map((n) => ({
          id: n.id,
          type: n.type,
          severity: "INFO",
          created_at: n.createdAt,
        })),
      },
      recent_audit_events: snapshot.recentAuditLogs.map((a) => ({
        id: a.id,
        created_at: a.createdAt,
        category: a.category,
        action: a.action,
        severity: a.severity,
      })),
      recent_usage: snapshot.recentUsageRecords.map((u) => ({
        id: u.id,
        metric: u.metric,
        quantity: u.quantity,
        occurred_at: u.periodStart,
      })),
      });

    }
  ));

  router.get(
    "/ops/queue-slo",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const organizationId = req.organizationId!;

      const { runs24h, failedByProvider, configs } = await service.getQueueSloData(organizationId);

      const totalRuns = runs24h.length;
      const failedRuns = runs24h.filter((r) => r.status === "FAILED").length;
      const failureRate = totalRuns === 0 ? 0 : failedRuns / totalRuns;
      const staleIntegrations = configs.filter((c) => {
      if (!c.lastSyncAt) return true;
      const lagMinutes = Math.floor((Date.now() - c.lastSyncAt.getTime()) / 60000);
      return lagMinutes > 90;
      }).length;

      const alerts: Array<{ severity: "WARN" | "CRITICAL"; code: string; message: string }> =
      [];
      if (failureRate >= 0.2) {
      alerts.push({
        severity: "CRITICAL",
        code: "INTEGRATION_FAILURE_RATE",
        message: `Integration run failure rate in last 24h is ${(failureRate * 100).toFixed(1)}%.`,
      });
      } else if (failureRate >= 0.1) {
      alerts.push({
        severity: "WARN",
        code: "INTEGRATION_FAILURE_RATE",
        message: `Integration run failure rate in last 24h is ${(failureRate * 100).toFixed(1)}%.`,
      });
      }
      if (staleIntegrations > 0) {
      alerts.push({
        severity: staleIntegrations >= 3 ? "CRITICAL" : "WARN",
        code: "INTEGRATION_STALENESS",
        message: `${staleIntegrations} enabled integration(s) are stale (>90 min since sync).`,
      });
      }

      sendSuccess(res, {
      window_hours: 24,
      total_runs: totalRuns,
      failed_runs: failedRuns,
      failure_rate: Number((failureRate * 100).toFixed(2)),
      stale_integrations: staleIntegrations,
      failed_runs_by_provider: failedByProvider.map((p) => ({
        provider: p.provider,
        failed_runs: p._count._all,
        failure_events: p._sum.failureCount ?? 0,
      })),
      alerts,
      });

    }
  ));

  router.get(
    "/ops/synthetic-health",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
      const timeoutFetch = async (url: string, timeoutMs: number): Promise<boolean> => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const resp = await fetch(url, { method: "HEAD", signal: controller.signal });
          return resp.ok || (resp.status >= 200 && resp.status < 500);
        } catch {
          return false;
        } finally {
          clearTimeout(timeout);
        }
      };

        const dbHealthy = await service.checkDatabaseHealth();
        const [openaiReachable, stripeReachable] = await Promise.all([
          timeoutFetch("https://api.openai.com/v1/models", 2500),
          timeoutFetch("https://api.stripe.com/v1/charges", 2500),
        ]);

        const checks = [
          { dependency: "database", healthy: dbHealthy, detail: dbHealthy ? "Prisma query succeeded" : "Prisma query failed" },
          {
            dependency: "openai_api",
            healthy: openaiReachable && Boolean(process.env.OPENAI_API_KEY),
            detail: openaiReachable
              ? "OpenAI endpoint reachable"
              : "OpenAI endpoint not reachable",
          },
          {
            dependency: "stripe_api",
            healthy: stripeReachable && Boolean(process.env.STRIPE_SECRET_KEY),
            detail: stripeReachable
              ? "Stripe endpoint reachable"
              : "Stripe endpoint not reachable",
          },
          {
            dependency: "redis_url",
            healthy: Boolean(process.env.REDIS_URL),
            detail: process.env.REDIS_URL ? "Redis URL configured" : "Missing REDIS_URL",
          },
        ];

        const degraded = checks.filter((c) => !c.healthy).length;
        sendSuccess(res, {
          status: degraded === 0 ? "HEALTHY" : degraded >= 2 ? "CRITICAL" : "DEGRADED",
          checked_at: new Date().toISOString(),
          checks,
        });

    }
  ));
}
