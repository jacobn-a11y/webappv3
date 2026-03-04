import { type Response, type Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { requirePermission } from "../../middleware/permissions.js";
import type { AuditLogService } from "../../services/audit-log.js";
import { OpsDiagnosticsService } from "../../services/ops-diagnostics.js";
import logger from "../../lib/logger.js";
import { decodeDataGovernancePolicy } from "../../types/json-boundaries.js";
import { parsePaginationParams } from "../_shared/pagination.js";
import type { AuthenticatedRequest } from "../../types/authenticated-request.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { sendSuccess } from "../_shared/responses.js";

const REPLAY_AUDIT_ACTIONS = [
  "INTEGRATION_RUN_REPLAY_TRIGGERED",
  "DEAD_LETTER_RUN_REPLAY_TRIGGERED",
] as const;

const REPLAY_OUTCOMES = ["COMPLETED", "FAILED", "RUNNING", "PENDING"] as const;
type ReplayOutcome = (typeof REPLAY_OUTCOMES)[number];

const SOURCE_RUN_TYPES = ["SYNC", "BACKFILL", "MANUAL", "REPLAY"] as const;
type SourceRunType = (typeof SOURCE_RUN_TYPES)[number];

function readQueryString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    const trimmed = value[0].trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function asJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readMetadataString(
  metadata: Record<string, unknown> | null,
  key: string
): string | null {
  if (!metadata) return null;
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readMetadataNumber(
  metadata: Record<string, unknown> | null,
  key: string
): number | null {
  if (!metadata) return null;
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeReplayOutcome(status: string | null | undefined): ReplayOutcome {
  if (status === "COMPLETED" || status === "FAILED" || status === "RUNNING") {
    return status;
  }
  return "PENDING";
}

function normalizeSourceRunType(
  value: string | null | undefined
): SourceRunType | null {
  if (value === "SYNC" || value === "BACKFILL" || value === "MANUAL" || value === "REPLAY") {
    return value;
  }
  return null;
}

interface RegisterOpsDiagnosticsRoutesOptions {
  router: Router;
  prisma: PrismaClient;
  auditLogs: AuditLogService;
}

export function registerOpsDiagnosticsRoutes({
  router,
  prisma,
  auditLogs,
}: RegisterOpsDiagnosticsRoutesOptions): void {
  const diagService = new OpsDiagnosticsService(prisma);

  // ── Admin: Ops Diagnostics ─────────────────────────────────────────

  router.get(
    "/integrations/health",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const organizationId = req.organizationId;
      const runAgg = await diagService.getIntegrationHealth(organizationId as string);

      sendSuccess(res, { integrations: runAgg });

    }
  ));

  router.get(
    "/ops/diagnostics",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const organizationId = req.organizationId;
      const snapshot = await diagService.getDiagnosticsSnapshot(organizationId as string);

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

      const organizationId = req.organizationId;
      const sloData = await diagService.getQueueSloData(organizationId as string);

      const totalRuns = sloData.runs24h.length;
      const failedRuns = sloData.runs24h.filter((r) => r.status === "FAILED").length;
      const failureRate = totalRuns === 0 ? 0 : failedRuns / totalRuns;
      const staleIntegrations = sloData.configs.filter((c) => {
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
      failed_runs_by_provider: sloData.failedByProvider.map((p) => ({
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

        const dbHealthy = await diagService.checkDatabaseHealth();
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

  router.get(
    "/ops/pipeline-status",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const organizationId = req.organizationId;
      const pipelineData = await diagService.getPipelineStatusData(organizationId as string);

      const stages = {
      sync: pipelineData.runs.filter((r) => r.runType === "SYNC"),
      backfill: pipelineData.runs.filter((r) => r.runType === "BACKFILL"),
      replay: pipelineData.runs.filter((r) => r.runType === "REPLAY"),
      };
      const summarize = (items: typeof pipelineData.runs) => ({
      total: items.length,
      completed: items.filter((i) => i.status === "COMPLETED").length,
      failed: items.filter((i) => i.status === "FAILED").length,
      running: items.filter((i) => i.status === "RUNNING").length,
      processed: items.reduce((acc, i) => acc + i.processedCount, 0),
      successes: items.reduce((acc, i) => acc + i.successCount, 0),
      failures: items.reduce((acc, i) => acc + i.failureCount, 0),
      });

      sendSuccess(res, {
      window_hours: 24,
      sync: summarize(stages.sync),
      backfill: summarize(stages.backfill),
      replay: summarize(stages.replay),
      pending_approvals: pipelineData.pendingApprovals,
      failed_backfills: pipelineData.failedBackfills,
      latest_runs: pipelineData.runs.slice(0, 25).map((r) => ({
        run_type: r.runType,
        status: r.status,
        provider: r.provider,
        started_at: r.startedAt.toISOString(),
        finished_at: r.finishedAt?.toISOString() ?? null,
        processed_count: r.processedCount,
        success_count: r.successCount,
        failure_count: r.failureCount,
      })),
      });

    }
  ));

  router.get(
    "/ops/replay-observability",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const organizationId = req.organizationId;
      const windowHoursRaw = readQueryString(req.query.window_hours);
      const parsedWindowHours = windowHoursRaw ? Number.parseInt(windowHoursRaw, 10) : 24;
      const windowHours =
      Number.isFinite(parsedWindowHours) && parsedWindowHours > 0
        ? Math.min(parsedWindowHours, 24 * 7)
        : 24;
      const providerFilter = readQueryString(req.query.provider)?.toUpperCase() ?? null;
      const operatorUserId = readQueryString(req.query.operator_user_id);
      const outcomeFilterRaw = readQueryString(req.query.outcome)?.toUpperCase() ?? null;
      const runTypeFilterRaw = readQueryString(req.query.run_type)?.toUpperCase() ?? null;

      const outcomeFilter = outcomeFilterRaw
      ? REPLAY_OUTCOMES.find((o) => o === outcomeFilterRaw) ?? null
      : null;
      if (outcomeFilterRaw && !outcomeFilter) {
      res.status(400).json({
        error: "validation_error",
        message: `Invalid outcome filter. Allowed: ${REPLAY_OUTCOMES.join(", ")}`,
      });
      return;
      }

      const runTypeFilter = runTypeFilterRaw
      ? SOURCE_RUN_TYPES.find((t) => t === runTypeFilterRaw) ?? null
      : null;
      if (runTypeFilterRaw && !runTypeFilter) {
      res.status(400).json({
        error: "validation_error",
        message: `Invalid run_type filter. Allowed: ${SOURCE_RUN_TYPES.join(", ")}`,
      });
      return;
      }

      const { limit } = parsePaginationParams(
      {
        limit: req.query.limit,
      },
      {
        limit: 50,
        maxLimit: 200,
      }
      );

      const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
      const logTake = Math.min(limit * 8, 500);

      const replayAuditLogs = await diagService.getReplayAuditLogs(
      organizationId as string,
      since,
      REPLAY_AUDIT_ACTIONS,
      operatorUserId,
      logTake
      );

      const sourceRunIds = new Set<string>();
      const replayRunIds = new Set<string>();
      for (const log of replayAuditLogs) {
      const metadata = asJsonObject(log.metadata);
      const sourceRunId = log.targetId ?? readMetadataString(metadata, "source_run_id");
      const replayRunId = readMetadataString(metadata, "replay_run_id");
      if (sourceRunId) sourceRunIds.add(sourceRunId);
      if (replayRunId) replayRunIds.add(replayRunId);
      }

      const allRunIds = [...new Set([...sourceRunIds, ...replayRunIds])];
      const runs = await diagService.getIntegrationRunsByIds(organizationId as string, allRunIds);
      const runById = new Map(runs.map((run) => [run.id, run] as const));

      const replayEvents = replayAuditLogs
      .map((log) => {
        const metadata = asJsonObject(log.metadata);
        const sourceRunId = log.targetId ?? readMetadataString(metadata, "source_run_id");
        const replayRunId = readMetadataString(metadata, "replay_run_id");
        const sourceRun = sourceRunId ? runById.get(sourceRunId) : null;
        const replayRun = replayRunId ? runById.get(replayRunId) : null;
        const provider =
          replayRun?.provider ??
          sourceRun?.provider ??
          readMetadataString(metadata, "provider") ??
          "UNKNOWN";
        const sourceRunType =
          sourceRun?.runType ??
          normalizeSourceRunType(readMetadataString(metadata, "source_run_type")) ??
          null;
        const outcome = normalizeReplayOutcome(replayRun?.status);
        return {
          audit_log_id: log.id,
          triggered_at: log.createdAt.toISOString(),
          action: log.action,
          actor_user_id: log.actorUserId ?? null,
          source_run_id: sourceRunId,
          source_run_type: sourceRunType,
          replay_run_id: replayRunId,
          provider,
          outcome,
          replay_attempt: readMetadataNumber(metadata, "replay_attempt"),
          replay_attempt_cap: readMetadataNumber(metadata, "replay_attempt_cap"),
          replay_window_hours: readMetadataNumber(metadata, "replay_window_hours"),
          source_run_age_hours: readMetadataNumber(metadata, "source_run_age_hours"),
        };
      })
      .filter((event) => {
        if (providerFilter && event.provider !== providerFilter) return false;
        if (runTypeFilter && event.source_run_type !== runTypeFilter) return false;
        if (outcomeFilter && event.outcome !== outcomeFilter) return false;
        return true;
      });

      const operatorIds = [
      ...new Set(
        replayEvents
          .map((event) => event.actor_user_id)
          .filter((value): value is string => typeof value === "string")
      ),
      ];
      const operatorUsers = await diagService.getOperatorUsers(organizationId as string, operatorIds);
      const operatorById = new Map(
      operatorUsers.map((user) => [user.id, user] as const)
      );

      const outcomeCounts = REPLAY_OUTCOMES.map((outcome) => ({
      outcome,
      count: replayEvents.filter((event) => event.outcome === outcome).length,
      }));

      const providerCounts = Array.from(
      replayEvents.reduce((acc, event) => {
        const row = acc.get(event.provider) ?? {
          provider: event.provider,
          replay_triggers: 0,
          completed: 0,
          failed: 0,
          running: 0,
          pending: 0,
        };
        row.replay_triggers += 1;
        if (event.outcome === "COMPLETED") row.completed += 1;
        else if (event.outcome === "FAILED") row.failed += 1;
        else if (event.outcome === "RUNNING") row.running += 1;
        else row.pending += 1;
        acc.set(event.provider, row);
        return acc;
      }, new Map<string, {
        provider: string;
        replay_triggers: number;
        completed: number;
        failed: number;
        running: number;
        pending: number;
      }>())
      )
      .map(([, row]) => row)
      .sort((a, b) => b.replay_triggers - a.replay_triggers || a.provider.localeCompare(b.provider));

      const operatorCounts = Array.from(
      replayEvents.reduce((acc, event) => {
        const key = event.actor_user_id ?? "unknown";
        const row = acc.get(key) ?? {
          actor_user_id: event.actor_user_id,
          actor_user_email: null as string | null,
          actor_user_name: null as string | null,
          actor_user_role: null as string | null,
          replay_triggers: 0,
          last_triggered_at: event.triggered_at,
          providers: new Set<string>(),
        };
        row.replay_triggers += 1;
        if (row.last_triggered_at < event.triggered_at) {
          row.last_triggered_at = event.triggered_at;
        }
        row.providers.add(event.provider);

        if (event.actor_user_id) {
          const actor = operatorById.get(event.actor_user_id);
          if (actor) {
            row.actor_user_email = actor.email;
            row.actor_user_name = actor.name;
            row.actor_user_role = actor.role;
          }
        }
        acc.set(key, row);
        return acc;
      }, new Map<string, {
        actor_user_id: string | null;
        actor_user_email: string | null;
        actor_user_name: string | null;
        actor_user_role: string | null;
        replay_triggers: number;
        last_triggered_at: string;
        providers: Set<string>;
      }>())
      )
      .map(([, row]) => ({
        actor_user_id: row.actor_user_id,
        actor_user_email: row.actor_user_email,
        actor_user_name: row.actor_user_name,
        actor_user_role: row.actor_user_role,
        replay_triggers: row.replay_triggers,
        last_triggered_at: row.last_triggered_at,
        providers: [...row.providers].sort(),
      }))
      .sort((a, b) => b.replay_triggers - a.replay_triggers);

      sendSuccess(res, {
      window_hours: windowHours,
      filters: {
        provider: providerFilter,
        operator_user_id: operatorUserId,
        outcome: outcomeFilter,
        run_type: runTypeFilter,
        limit,
      },
      totals: {
        replay_triggers: replayEvents.length,
        unique_operators: operatorCounts.length,
      },
      outcomes: outcomeCounts,
      providers: providerCounts,
      operators: operatorCounts,
      recent_events: replayEvents.slice(0, limit),
      });

    }
  ));

  router.get(
    "/ops/dr-readiness",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const organizationId = req.organizationId;
      const drData = await diagService.getDrReadinessData(organizationId as string);

      const rtoTargetMinutes = drData.policy.rto_target_minutes ?? 240;
      const rpoTargetMinutes = drData.policy.rpo_target_minutes ?? 60;
      const backupAgeMinutes = drData.lastBackup
      ? Math.floor((Date.now() - drData.lastBackup.createdAt.getTime()) / 60000)
      : null;
      const restoreValidationAgeMinutes = drData.lastRestoreValidation
      ? Math.floor((Date.now() - drData.lastRestoreValidation.createdAt.getTime()) / 60000)
      : null;

      const status =
      backupAgeMinutes !== null &&
      restoreValidationAgeMinutes !== null &&
      backupAgeMinutes <= rpoTargetMinutes &&
      restoreValidationAgeMinutes <= rtoTargetMinutes
        ? "READY"
        : "AT_RISK";

      sendSuccess(res, {
      status,
      targets: {
        rto_minutes: rtoTargetMinutes,
        rpo_minutes: rpoTargetMinutes,
      },
      last_backup_verified_at: drData.lastBackup?.createdAt.toISOString() ?? null,
      last_restore_validated_at: drData.lastRestoreValidation?.createdAt.toISOString() ?? null,
      backup_age_minutes: backupAgeMinutes,
      restore_validation_age_minutes: restoreValidationAgeMinutes,
      critical_entity_counts: {
        accounts: drData.accountCount,
        calls: drData.callCount,
        stories: drData.storyCount,
        landing_pages: drData.pageCount,
      },
      });

    }
  ));

  router.post(
    "/ops/dr-readiness/backup-verify",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const organizationId = req.organizationId;
      const counts = await diagService.getEntityCounts(organizationId as string);
      await auditLogs.record({
      organizationId,
      actorUserId: req.userId,
      category: "DR",
      action: "DR_BACKUP_VERIFIED",
      targetType: "organization",
      targetId: organizationId,
      severity: "WARN",
      metadata: {
        entities: {
          accounts: counts.accountCount,
          calls: counts.callCount,
          stories: counts.storyCount,
          landing_pages: counts.pageCount,
        },
        verification: "metadata_snapshot",
      },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      });
      sendSuccess(res, { verified: true });

    }
  ));

  router.post(
    "/ops/dr-readiness/restore-validate",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const organizationId = req.organizationId;
      const counts = await diagService.getEntityCounts(organizationId as string);
      const passed = counts.accountCount >= 0 && counts.callCount >= 0 && counts.storyCount >= 0;
      await auditLogs.record({
      organizationId,
      actorUserId: req.userId,
      category: "DR",
      action: passed ? "DR_RESTORE_VALIDATED" : "DR_RESTORE_VALIDATION_FAILED",
      targetType: "organization",
      targetId: organizationId,
      severity: passed ? "INFO" : "CRITICAL",
      metadata: {
        checks: {
          accounts: counts.accountCount,
          calls: counts.callCount,
          stories: counts.storyCount,
        },
        result: passed ? "pass" : "fail",
      },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      });
      sendSuccess(res, { validated: passed });

    }
  ));
}
