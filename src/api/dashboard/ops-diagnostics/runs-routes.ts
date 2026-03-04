/**
 * Ops Diagnostics — Integration Runs & Pipeline Routes
 *
 * GET /ops/pipeline-status      — Pipeline execution status (24h window)
 * GET /ops/replay-observability — Replay observability with dead-letter queue
 */

import { type Response, type Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { requirePermission } from "../../../middleware/permissions.js";
import { parsePaginationParams } from "../../_shared/pagination.js";
import type { AuthenticatedRequest } from "../../../types/authenticated-request.js";
import { asyncHandler } from "../../../lib/async-handler.js";
import { sendSuccess } from "../../_shared/responses.js";
import type { OpsDiagnosticsService } from "../../../services/ops-diagnostics.js";

// ─── Shared constants & helpers ─────────────────────────────────────────────

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

// ─── Route Registration ─────────────────────────────────────────────────────

interface RegisterRunsRoutesOptions {
  router: Router;
  prisma: PrismaClient;
  service: OpsDiagnosticsService;
}

export function registerRunsRoutes({
  router,
  prisma,
  service,
}: RegisterRunsRoutesOptions): void {
  router.get(
    "/ops/pipeline-status",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const organizationId = req.organizationId;

      const { runs, pendingApprovals, failedBackfills } =
        await service.getPipelineStatusData(organizationId);

      const stages = {
      sync: runs.filter((r) => r.runType === "SYNC"),
      backfill: runs.filter((r) => r.runType === "BACKFILL"),
      replay: runs.filter((r) => r.runType === "REPLAY"),
      };
      const summarize = (items: typeof runs) => ({
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
      pending_approvals: pendingApprovals,
      failed_backfills: failedBackfills,
      latest_runs: runs.slice(0, 25).map((r) => ({
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

      const replayAuditLogs = await service.getReplayAuditLogs(
        organizationId,
        since,
        REPLAY_AUDIT_ACTIONS,
        operatorUserId,
        logTake,
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
      const runs = await service.getIntegrationRunsByIds(organizationId, allRunIds);
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
      const operatorUsers = await service.getOperatorUsers(organizationId, operatorIds);
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
}
