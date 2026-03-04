import { type Response, type Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { requirePermission } from "../../middleware/permissions.js";
import type { AuditLogService } from "../../services/audit-log.js";
import type { FeatureFlagService } from "../../services/feature-flags.js";
import logger from "../../lib/logger.js";
import { parseRequestBody } from "../_shared/validators.js";
import { sendSuccess, sendCreated, sendNotFound } from "../_shared/responses.js";
import type { AuthenticatedRequest } from "../../types/authenticated-request.js";
import { asyncHandler } from "../../lib/async-handler.js";

const ScimProvisioningSchema = z.object({
  enabled: z.boolean(),
});

const UpsertFeatureFlagSchema = z.object({
  key: z.string().min(2).max(120).regex(/^[a-z0-9_]+$/),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const CreateIncidentSchema = z.object({
  title: z.string().min(3).max(200),
  summary: z.string().min(5).max(5000),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  started_at: z.string().datetime().optional(),
});

const AddIncidentUpdateSchema = z.object({
  message: z.string().min(3).max(5000),
  status: z.enum(["OPEN", "MONITORING", "RESOLVED"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function hashScimToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

interface RegisterAdminOpsRoutesOptions {
  router: Router;
  prisma: PrismaClient;
  auditLogs: AuditLogService;
  featureFlags: FeatureFlagService;
}

export function registerAdminOpsRoutes({
  router,
  prisma,
  auditLogs,
  featureFlags,
}: RegisterAdminOpsRoutesOptions): void {
  // ── Admin: Incident Management / Status Process ─────────────────────

  router.get(
    "/ops/incidents",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const incidents = await prisma.incident.findMany({
      where: { organizationId: req.organizationId! },
      include: {
        updates: {
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
      orderBy: { startedAt: "desc" },
      take: 100,
      });
      sendSuccess(res, {
      incidents: incidents.map((i) => ({
        id: i.id,
        title: i.title,
        summary: i.summary,
        severity: i.severity,
        status: i.status,
        started_at: i.startedAt.toISOString(),
        resolved_at: i.resolvedAt?.toISOString() ?? null,
        created_by_user_id: i.createdByUserId,
        created_at: i.createdAt.toISOString(),
        updated_at: i.updatedAt.toISOString(),
        updates: i.updates.map((u) => ({
          id: u.id,
          message: u.message,
          status: u.status,
          metadata: u.metadata ?? null,
          created_by_user_id: u.createdByUserId,
          created_at: u.createdAt.toISOString(),
        })),
      })),
      });
      
    }
  ));

  router.post(
    "/ops/incidents",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const payload = parseRequestBody(CreateIncidentSchema, req.body, res);
      if (!payload) {
        return;
      }

      const incident = await prisma.incident.create({
      data: {
        organizationId: req.organizationId!,
        title: payload.title,
        summary: payload.summary,
        severity: payload.severity ?? "MEDIUM",
        status: "OPEN",
        startedAt: payload.started_at
          ? new Date(payload.started_at)
          : new Date(),
        createdByUserId: req.userId! ?? null,
        updates: {
          create: {
            organizationId: req.organizationId!,
            message: "Incident opened.",
            status: "OPEN",
            createdByUserId: req.userId! ?? null,
          },
        },
      },
      });
      await auditLogs.record({
      organizationId: req.organizationId!,
      actorUserId: req.userId!,
      category: "OPS",
      action: "INCIDENT_CREATED",
      targetType: "incident",
      targetId: incident.id,
      severity: "CRITICAL",
      metadata: {
        title: incident.title,
        severity: incident.severity,
      },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      });
      sendCreated(res, {
      id: incident.id,
      status: incident.status,
      created_at: incident.createdAt.toISOString(),
      });
      
    }
  ));

  router.post(
    "/ops/incidents/:incidentId/updates",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const payload = parseRequestBody(AddIncidentUpdateSchema, req.body, res);
      if (!payload) {
        return;
      }

      const incidentId = Array.isArray(req.params.incidentId)
      ? (req.params.incidentId[0] ?? "")
      : (req.params.incidentId ?? "");
      const existing = await prisma.incident.findFirst({
      where: {
        id: incidentId,
        organizationId: req.organizationId!,
      },
      select: { id: true, status: true },
      });
      if (!existing) {
      sendNotFound(res, "incident_not_found");
      return;
      }

      const status = payload.status;
      const [update] = await prisma.$transaction([
      prisma.incidentUpdate.create({
        data: {
          incidentId,
          organizationId: req.organizationId!,
          message: payload.message,
          status: status ?? null,
          metadata: (payload.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          createdByUserId: req.userId! ?? null,
        },
      }),
      prisma.incident.update({
        where: { id: incidentId },
        data: {
          status: status ?? undefined,
          resolvedAt:
            status === "RESOLVED"
              ? new Date()
              : status === "OPEN" || status === "MONITORING"
                ? null
                : undefined,
        },
      }),
      ]);

      await auditLogs.record({
      organizationId: req.organizationId!,
      actorUserId: req.userId!,
      category: "OPS",
      action: "INCIDENT_UPDATED",
      targetType: "incident",
      targetId: incidentId,
      severity: "WARN",
      metadata: {
        status: status ?? existing.status,
        update_message: payload.message,
      },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      });
      sendCreated(res, {
      id: update.id,
      status: status ?? existing.status,
      created_at: update.createdAt.toISOString(),
      });
      
    }
  ));

  // ── Admin: Session Inventory ───────────────────────────────────────

  router.get(
    "/security/sessions",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const sessions = await prisma.userSession.findMany({
      where: { organizationId: req.organizationId! },
      include: {
        user: {
          select: { id: true, email: true, name: true, role: true },
        },
      },
      orderBy: { lastSeenAt: "desc" },
      take: 200,
      });
      sendSuccess(res, {
      sessions: sessions.map((s) => ({
        id: s.id,
        user_id: s.userId,
        user_email: s.user.email,
        user_name: s.user.name,
        user_role: s.user.role,
        device_label: s.deviceLabel,
        ip_address: s.ipAddress,
        user_agent: s.userAgent,
        last_seen_at: s.lastSeenAt.toISOString(),
        created_at: s.createdAt.toISOString(),
        expires_at: s.expiresAt.toISOString(),
        revoked_at: s.revokedAt?.toISOString() ?? null,
      })),
      });
      
    }
  ));

  router.post(
    "/security/sessions/:sessionId/revoke",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const sessionId = Array.isArray(req.params.sessionId)
      ? (req.params.sessionId[0] ?? "")
      : (req.params.sessionId ?? "");
      const result = await prisma.userSession.updateMany({
      where: {
        id: sessionId,
        organizationId: req.organizationId!,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
      });
      if (result.count === 0) {
      sendNotFound(res, "session_not_found_or_already_revoked");
      return;
      }
      await auditLogs.record({
      organizationId: req.organizationId!,
      actorUserId: req.userId!,
      category: "SECURITY",
      action: "SESSION_REVOKED",
      targetType: "user_session",
      targetId: sessionId,
      severity: "CRITICAL",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      });
      sendSuccess(res, { revoked: true });
      
    }
  ));

  // ── Admin: SCIM Provisioning ───────────────────────────────────────

  router.get(
    "/scim-provisioning",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const config = await prisma.scimProvisioning.findUnique({
      where: { organizationId: req.organizationId! },
      });
      const count = await prisma.scimIdentity.count({
      where: { organizationId: req.organizationId! },
      });
      sendSuccess(res, {
      enabled: config?.enabled ?? false,
      endpoint_secret_hint: config?.endpointSecretHint ?? null,
      last_sync_at: config?.lastSyncAt?.toISOString() ?? null,
      identities_count: count,
      });
      
    }
  ));

  router.patch(
    "/scim-provisioning",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const payload = parseRequestBody(ScimProvisioningSchema, req.body, res);
      if (!payload) {
        return;
      }

      const cfg = await prisma.scimProvisioning.upsert({
      where: { organizationId: req.organizationId! },
      create: {
        organizationId: req.organizationId!,
        enabled: payload.enabled,
      },
      update: { enabled: payload.enabled },
      });
      await auditLogs.record({
      organizationId: req.organizationId!,
      actorUserId: req.userId!,
      category: "SECURITY",
      action: "SCIM_PROVISIONING_UPDATED",
      targetType: "scim_provisioning",
      targetId: cfg.id,
      severity: "CRITICAL",
      metadata: { enabled: cfg.enabled },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      });
      sendSuccess(res, { enabled: cfg.enabled, endpoint_secret_hint: cfg.endpointSecretHint ?? null });
      
    }
  ));

  router.post(
    "/scim-provisioning/rotate-token",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const raw = crypto.randomBytes(24).toString("hex");
      const hashed = hashScimToken(raw);
      const hint = `${raw.slice(0, 4)}...${raw.slice(-4)}`;
      const cfg = await prisma.scimProvisioning.upsert({
      where: { organizationId: req.organizationId! },
      create: {
        organizationId: req.organizationId!,
        enabled: true,
        tokenHash: hashed,
        endpointSecretHint: hint,
      },
      update: {
        enabled: true,
        tokenHash: hashed,
        endpointSecretHint: hint,
      },
      });
      await auditLogs.record({
      organizationId: req.organizationId!,
      actorUserId: req.userId!,
      category: "SECURITY",
      action: "SCIM_TOKEN_ROTATED",
      targetType: "scim_provisioning",
      targetId: cfg.id,
      severity: "CRITICAL",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      });
      sendSuccess(res, {
      token: raw,
      endpoint_secret_hint: hint,
      message:
        "Store this SCIM token securely now. It will not be shown again.",
      });
      
    }
  ));

  // ── Admin: Feature Flags ───────────────────────────────────────────

  router.get(
    "/feature-flags",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const flags = await featureFlags.listResolved(req.organizationId!);
      sendSuccess(res, {
      flags: flags.map((f: { id: string; key: string; enabled: boolean; resolvedEnabled: boolean; overrideSource: string | null; config: unknown; createdAt: Date; updatedAt: Date }) => ({
        id: f.id,
        key: f.key,
        enabled: f.enabled,
        resolved_enabled: f.resolvedEnabled,
        override_source: f.overrideSource,
        config: f.config,
        created_at: f.createdAt.toISOString(),
        updated_at: f.updatedAt.toISOString(),
      })),
      });
      
    }
  ));

  router.get(
    "/feature-flags/resolved",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const enabledKeys = await featureFlags.getResolvedEnabledKeys(req.organizationId!);
      sendSuccess(res, {
      environment: process.env.DEPLOY_ENV || process.env.NODE_ENV || "development",
      enabled_feature_flags: enabledKeys,
      });
      
    }
  ));

  router.patch(
    "/feature-flags",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const payload = parseRequestBody(UpsertFeatureFlagSchema, req.body, res);
      if (!payload) {
        return;
      }

        const flag = await featureFlags.upsert({
          organizationId: req.organizationId!,
          key: payload.key,
          enabled: payload.enabled,
          config: payload.config,
        });
        await auditLogs.record({
          organizationId: req.organizationId!,
          actorUserId: req.userId!,
          category: "POLICY",
          action: "FEATURE_FLAG_UPDATED",
          targetType: "feature_flag",
          targetId: flag.id,
          severity: "WARN",
          metadata: {
            key: flag.key,
            enabled: flag.enabled,
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        sendSuccess(res, {
          flag: {
            id: flag.id,
            key: flag.key,
            enabled: flag.enabled,
            config: flag.config,
          },
        });
      
    }
  ));
}
