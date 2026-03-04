import { type Response, type Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { requirePermission } from "../../middleware/permissions.js";
import type { AuditLogService } from "../../services/audit-log.js";
import logger from "../../lib/logger.js";
import { decodeRequestPayload } from "../../types/json-boundaries.js";
import { parseRequestBody } from "../_shared/validators.js";
import type { AuthenticatedRequest } from "../../types/authenticated-request.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { sendSuccess, sendNotFound, sendConflict } from "../_shared/responses.js";

const CreateWritebackSchema = z.object({
  provider: z.enum(["SALESFORCE", "HUBSPOT"]).default("SALESFORCE"),
  action_type: z.enum(["TASK", "NOTE", "FIELD_UPDATE", "TIMELINE_EVENT"]),
  account_id: z.string().min(1),
  opportunity_id: z.string().optional(),
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(5000).optional(),
  field_name: z.string().max(120).optional(),
  field_value: z.string().max(2000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const ReviewWritebackSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  notes: z.string().max(1000).optional(),
});

interface RegisterWritebackRoutesOptions {
  router: Router;
  prisma: PrismaClient;
  auditLogs: AuditLogService;
}

export function registerWritebackRoutes({
  router,
  prisma,
  auditLogs,
}: RegisterWritebackRoutesOptions): void {
  // ── CRM Writeback + Approvals ─────────────────────────────────────

  router.get(
    "/writebacks",
    requirePermission(prisma, "view_analytics"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const requests = await prisma.approvalRequest.findMany({
      where: {
        organizationId: req.organizationId,
        requestType: "CRM_WRITEBACK",
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      });
      sendSuccess(res, {
      writebacks: requests.map((r) => ({
        id: r.id,
        status: r.status,
        target_type: r.targetType,
        target_id: r.targetId,
        request_payload: r.requestPayload,
        requested_by_user_id: r.requestedByUserId,
        reviewer_user_id: r.reviewerUserId,
        review_notes: r.reviewNotes,
        created_at: r.createdAt.toISOString(),
        reviewed_at: r.reviewedAt?.toISOString() ?? null,
      })),
      });
      
    }
  ));

  router.post(
    "/writebacks",
    requirePermission(prisma, "view_analytics"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const payload = parseRequestBody(CreateWritebackSchema, req.body, res);
      if (!payload) {
        return;
      }

      const account = await prisma.account.findFirst({
      where: { id: payload.account_id, organizationId: req.organizationId },
      select: { id: true },
      });
      if (!account) {
      sendNotFound(res, "account_not_found");
      return;
      }
      const request = await prisma.approvalRequest.create({
      data: {
        organizationId: req.organizationId,
        requestType: "CRM_WRITEBACK",
        targetType: "account",
        targetId: payload.account_id,
        requestedByUserId: req.userId,
        status: "PENDING",
        requestPayload: {
          provider: payload.provider,
          action_type: payload.action_type,
          opportunity_id: payload.opportunity_id ?? null,
          title: payload.title ?? null,
          body: payload.body ?? null,
          field_name: payload.field_name ?? null,
          field_value: payload.field_value ?? null,
          metadata: payload.metadata ?? {},
        } as Prisma.InputJsonValue,
      },
      });
      await auditLogs.record({
      organizationId: req.organizationId,
      actorUserId: req.userId,
      category: "WRITEBACK",
      action: "CRM_WRITEBACK_REQUESTED",
      targetType: "approval_request",
      targetId: request.id,
      severity: "WARN",
      metadata: { action_type: payload.action_type, provider: payload.provider },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      });
      res.status(202).json({ request_id: request.id, status: request.status });
      
    }
  ));

  router.post(
    "/writebacks/:requestId/review",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const payload = parseRequestBody(ReviewWritebackSchema, req.body, res);
      if (!payload) {
        return;
      }

      const request = await prisma.approvalRequest.findFirst({
      where: {
        id: String(req.params.requestId),
        organizationId: req.organizationId,
        requestType: "CRM_WRITEBACK",
      },
      });
      if (!request) {
      sendNotFound(res, "writeback_request_not_found");
      return;
      }
      if (request.status !== "PENDING") {
      sendConflict(res, "request_not_pending");
      return;
      }

      if (payload.decision === "REJECT") {
      await prisma.approvalRequest.update({
        where: { id: request.id },
        data: {
          status: "REJECTED",
          reviewerUserId: req.userId,
          reviewNotes: payload.notes ?? null,
          reviewedAt: new Date(),
        },
      });
      await auditLogs.record({
        organizationId: req.organizationId,
        actorUserId: req.userId,
        category: "WRITEBACK",
        action: "CRM_WRITEBACK_REJECTED",
        targetType: "approval_request",
        targetId: request.id,
        severity: "INFO",
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
      sendSuccess(res, { status: "REJECTED" });
      return;
      }

      const requestPayload = decodeRequestPayload(request.requestPayload);
      const actionType = String(requestPayload.action_type ?? "TASK");

      // Simulated CRM writeback execution by recording corresponding CRM events.
      const eventType =
      actionType === "NOTE"
        ? "NOTE_ADDED"
        : actionType === "TASK"
          ? "TASK_COMPLETED"
          : "OPPORTUNITY_STAGE_CHANGE";
      await prisma.salesforceEvent.create({
      data: {
        accountId: request.targetId,
        eventType:
          eventType as "NOTE_ADDED" | "TASK_COMPLETED" | "OPPORTUNITY_STAGE_CHANGE",
        stageName:
          actionType === "FIELD_UPDATE"
            ? String(requestPayload.field_value ?? "UPDATED")
            : null,
        opportunityId:
          typeof requestPayload.opportunity_id === "string"
            ? requestPayload.opportunity_id
            : null,
        description:
          typeof requestPayload.body === "string" && requestPayload.body.length > 0
            ? requestPayload.body
            : typeof requestPayload.title === "string"
              ? requestPayload.title
              : "Writeback action",
        rawPayload: requestPayload as Prisma.InputJsonValue,
      },
      });

      await prisma.approvalRequest.update({
      where: { id: request.id },
      data: {
        status: "COMPLETED",
        reviewerUserId: req.userId,
        reviewNotes: payload.notes ?? null,
        reviewedAt: new Date(),
      },
      });
      await auditLogs.record({
      organizationId: req.organizationId,
      actorUserId: req.userId,
      category: "WRITEBACK",
      action: "CRM_WRITEBACK_APPROVED_EXECUTED",
      targetType: "approval_request",
      targetId: request.id,
      severity: "WARN",
      metadata: { action_type: actionType },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      });
      sendSuccess(res, { status: "COMPLETED" });
      
    }
  ));

  router.post(
    "/writebacks/:requestId/rollback",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const request = await prisma.approvalRequest.findFirst({
      where: {
        id: String(req.params.requestId),
        organizationId: req.organizationId,
        requestType: "CRM_WRITEBACK",
        status: "COMPLETED",
      },
      });
      if (!request) {
      sendNotFound(res, "completed_writeback_not_found");
      return;
      }
      const payload = decodeRequestPayload(request.requestPayload);
      await prisma.salesforceEvent.create({
      data: {
        accountId: request.targetId,
        eventType: "NOTE_ADDED",
        description: `Rollback executed for writeback ${request.id}`,
        rawPayload: payload as Prisma.InputJsonValue,
      },
      });
      await prisma.approvalRequest.update({
      where: { id: request.id },
      data: {
        status: "ROLLED_BACK",
        reviewerUserId: req.userId,
        reviewNotes: "Rolled back by admin",
        reviewedAt: new Date(),
      },
      });
      await auditLogs.record({
      organizationId: req.organizationId,
      actorUserId: req.userId,
      category: "WRITEBACK",
      action: "CRM_WRITEBACK_ROLLED_BACK",
      targetType: "approval_request",
      targetId: request.id,
      severity: "CRITICAL",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      });
      sendSuccess(res, { status: "ROLLED_BACK" });
      
    }
  ));
}
