import { type Response, type Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { requirePermission } from "../../middleware/permissions.js";
import type { AuditLogService } from "../../services/audit-log.js";
import { parseRequestBody } from "../_shared/validators.js";
import logger from "../../lib/logger.js";
import type { AuthenticatedRequest } from "../../types/authenticated-request.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { sendUnauthorized, sendBadRequest, sendSuccess } from "../_shared/responses.js";

const SellerAdoptionEventSchema = z.object({
  event_type: z
    .enum([
      "modal_open",
      "preset_selected",
      "visibility_mode_selected",
      "generation_started",
      "story_generated",
      "generation_failed",
      "share_action",
      "library_action",
    ])
    .default("modal_open"),
  flow_id: z.string().min(1).max(120),
  step: z.string().min(1).max(120).optional(),
  account_id: z.string().min(1).max(120).optional(),
  story_id: z.string().min(1).max(120).optional(),
  stage_preset: z.string().min(1).max(120).optional(),
  visibility_mode: z.enum(["ANONYMOUS", "NAMED"]).optional(),
  action_name: z.string().min(1).max(120).optional(),
  duration_ms: z.number().int().min(0).max(86_400_000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const SellerAdoptionMetricsQuerySchema = z.object({
  window_days: z.coerce.number().int().min(1).max(365).default(30),
});

interface RegisterSellerAdoptionRoutesOptions {
  router: Router;
  prisma: PrismaClient;
  auditLogs: AuditLogService;
}

interface SellerEventRow {
  flowId: string;
  actorUserId: string | null;
  createdAt: Date;
  eventType: string;
  stagePreset: string | null;
  visibilityMode: string | null;
  actionName: string | null;
  durationMs: number | null;
  metadata: Record<string, unknown>;
}

function parseEventMetadata(metadata: unknown): SellerEventRow["metadata"] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  return metadata as Record<string, unknown>;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  }
  return sorted[middle] ?? null;
}

export function registerSellerAdoptionRoutes({
  router,
  prisma,
  auditLogs,
}: RegisterSellerAdoptionRoutesOptions): void {
  router.post(
    "/seller-adoption/events",
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId! || !req.userId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }
      const payload = parseRequestBody(SellerAdoptionEventSchema, req.body, res);
      if (!payload) {
        return;
      }

      await auditLogs.record({
      organizationId: req.organizationId!,
      actorUserId: req.userId!,
      category: "SELLER_ADOPTION",
      action: "FLOW_EVENT",
      targetType: "seller_flow",
      targetId: payload.flow_id,
      severity: "INFO",
      metadata: {
        event_type: payload.event_type,
        flow_id: payload.flow_id,
        step: payload.step ?? null,
        account_id: payload.account_id ?? null,
        story_id: payload.story_id ?? null,
        stage_preset: payload.stage_preset ?? null,
        visibility_mode: payload.visibility_mode ?? null,
        action_name: payload.action_name ?? null,
        duration_ms: payload.duration_ms ?? null,
        ...(payload.metadata ?? {}),
      },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      });
      res.status(202).json({ accepted: true });
      
    }
  ));

  router.get(
    "/seller-adoption/metrics",
    requirePermission(prisma, "view_analytics"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const query = SellerAdoptionMetricsQuerySchema.safeParse(req.query);
      if (!query.success) {
        sendBadRequest(res, "validation_error", query.error.issues);
        return;
      }
      if (!req.organizationId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const windowDays = query.data.window_days;
      const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

        const logs = await prisma.auditLog.findMany({
          where: {
            organizationId: req.organizationId!,
            category: "SELLER_ADOPTION",
            action: "FLOW_EVENT",
            createdAt: { gte: windowStart },
          },
          select: {
            actorUserId: true,
            createdAt: true,
            metadata: true,
          },
          orderBy: { createdAt: "asc" },
          take: 5000,
        });

        const events: SellerEventRow[] = logs
          .map((log) => {
            const metadata = parseEventMetadata(log.metadata);
            const flowId =
              typeof metadata.flow_id === "string"
                ? metadata.flow_id
                : `${log.actorUserId ?? "anon"}:${log.createdAt.toISOString()}`;
            const eventType =
              typeof metadata.event_type === "string" ? metadata.event_type : "modal_open";
            const stagePreset =
              typeof metadata.stage_preset === "string" ? metadata.stage_preset : null;
            const visibilityMode =
              typeof metadata.visibility_mode === "string"
                ? metadata.visibility_mode
                : null;
            const actionName =
              typeof metadata.action_name === "string" ? metadata.action_name : null;
            const durationMs =
              typeof metadata.duration_ms === "number" ? metadata.duration_ms : null;

            return {
              flowId,
              actorUserId: log.actorUserId,
              createdAt: log.createdAt,
              eventType,
              stagePreset,
              visibilityMode,
              actionName,
              durationMs,
              metadata,
            };
          })
          .filter((row) => row.flowId.length > 0);

        const flowMap = new Map<
          string,
          {
            actorUserId: string | null;
            openedAt?: Date;
            generatedAt?: Date;
            sharedAt?: Date;
            reachedSteps: Set<string>;
          }
        >();
        const stagePresetUsage = new Map<string, number>();
        const visibilityUsage = new Map<string, number>();

        for (const event of events) {
          if (event.stagePreset) {
            stagePresetUsage.set(
              event.stagePreset,
              (stagePresetUsage.get(event.stagePreset) ?? 0) + 1
            );
          }
          if (event.visibilityMode) {
            visibilityUsage.set(
              event.visibilityMode,
              (visibilityUsage.get(event.visibilityMode) ?? 0) + 1
            );
          }

          const existing = flowMap.get(event.flowId) ?? {
            actorUserId: event.actorUserId,
            reachedSteps: new Set<string>(),
          };
          existing.reachedSteps.add(event.eventType);
          if (event.eventType === "modal_open" && !existing.openedAt) {
            existing.openedAt = event.createdAt;
          }
          if (event.eventType === "story_generated" && !existing.generatedAt) {
            existing.generatedAt = event.createdAt;
          }
          if (event.eventType === "share_action" && !existing.sharedAt) {
            existing.sharedAt = event.createdAt;
          }
          flowMap.set(event.flowId, existing);
        }

        const timeToFirstStory: number[] = [];
        const timeToShare: number[] = [];
        for (const flow of flowMap.values()) {
          if (flow.openedAt && flow.generatedAt) {
            timeToFirstStory.push(flow.generatedAt.getTime() - flow.openedAt.getTime());
          }
          if (flow.generatedAt && flow.sharedAt) {
            timeToShare.push(flow.sharedAt.getTime() - flow.generatedAt.getTime());
          }
        }

        const flowIds = [...flowMap.keys()];
        const stepOrder = [
          "modal_open",
          "preset_selected",
          "generation_started",
          "story_generated",
          "share_action",
        ];
        const flowsPerStep = stepOrder.map((step) => {
          const count = flowIds.reduce((acc, flowId) => {
            const flow = flowMap.get(flowId);
            return flow?.reachedSteps.has(step) ? acc + 1 : acc;
          }, 0);
          return {
            step,
            flows: count,
            conversion_from_start:
              flowIds.length > 0 ? Number((count / flowIds.length).toFixed(3)) : 0,
          };
        });
        const dropOff = stepOrder.slice(1).map((step, index) => {
          const previous = flowsPerStep[index]?.flows ?? 0;
          const current = flowsPerStep[index + 1]?.flows ?? 0;
          return {
            from_step: stepOrder[index],
            to_step: step,
            previous_flows: previous,
            current_flows: current,
            drop_off_rate:
              previous > 0 ? Number(((previous - current) / previous).toFixed(3)) : 0,
          };
        });

        const uniqueUsers = new Set(
          events.map((event) => event.actorUserId).filter((id): id is string => !!id)
        );

        sendSuccess(res, {
          window_days: windowDays,
          totals: {
            event_count: events.length,
            flow_count: flowMap.size,
            user_count: uniqueUsers.size,
          },
          kpis: {
            median_time_to_first_story_ms: median(timeToFirstStory),
            median_time_to_share_ms: median(timeToShare),
          },
          usage: {
            stage_presets: [...stagePresetUsage.entries()]
              .map(([preset, count]) => ({ preset, count }))
              .sort((a, b) => b.count - a.count),
            visibility_modes: [...visibilityUsage.entries()]
              .map(([mode, count]) => ({ mode, count }))
              .sort((a, b) => b.count - a.count),
          },
          funnel: {
            steps: flowsPerStep,
            drop_off: dropOff,
          },
          recent_events: events.slice(-50).map((event) => ({
            flow_id: event.flowId,
            actor_user_id: event.actorUserId,
            event_type: event.eventType,
            stage_preset: event.stagePreset,
            visibility_mode: event.visibilityMode,
            action_name: event.actionName,
            duration_ms: event.durationMs,
            created_at: event.createdAt.toISOString(),
          })),
        });
      
    }
  ));
}
