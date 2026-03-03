import { type Request, type Response, type Router } from "express";
import { z } from "zod";
import type { PrismaClient, UserRole } from "@prisma/client";
import crypto from "crypto";
import type { AuditLogService } from "../../services/audit-log.js";
import logger from "../../lib/logger.js";
import { parseRequestBody } from "../_shared/validators.js";

const StartSupportImpersonationSchema = z.object({
  target_user_id: z.string().min(1),
  reason: z.string().min(8).max(1000),
  ttl_minutes: z.number().int().min(5).max(240).optional(),
  scope: z.array(z.enum(["READ_ONLY", "WRITE"])).max(5).optional(),
});

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
  impersonation?: {
    sessionId: string;
    actorUserId: string;
    targetUserId: string;
    scope: string[];
    reason: string;
    expiresAt: string;
  };
}

function hashImpersonationToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function canManageSupportImpersonation(
  prisma: PrismaClient,
  req: AuthReq
): Promise<boolean> {
  if (!req.userId) return false;
  if (req.userRole === "OWNER" || req.userRole === "ADMIN") return true;
  const grant = await prisma.userPermission.findUnique({
    where: {
      userId_permission: {
        userId: req.userId,
        permission: "MANAGE_PERMISSIONS",
      },
    },
    select: { id: true },
  });
  return !!grant;
}

interface RegisterSupportImpersonationRoutesOptions {
  router: Router;
  prisma: PrismaClient;
  auditLogs: AuditLogService;
}

export function registerSupportImpersonationRoutes({
  router,
  prisma,
  auditLogs,
}: RegisterSupportImpersonationRoutesOptions): void {
  // ── Admin: Support Impersonation ────────────────────────────────────

  router.get(
    "/support/impersonation/sessions",
    async (req: AuthReq, res: Response) => {
      try {
        if (!req.organizationId || !req.userId) {
          res.status(401).json({ error: "authentication_required" });
          return;
        }
        const allowed = await canManageSupportImpersonation(prisma, req);
        if (!allowed) {
          res.status(403).json({ error: "permission_denied" });
          return;
        }

        const sessions = await prisma.supportImpersonationSession.findMany({
          where: { organizationId: req.organizationId },
          include: {
            actorUser: { select: { id: true, email: true, name: true, role: true } },
            targetUser: { select: { id: true, email: true, name: true, role: true } },
            revokedByUser: { select: { id: true, email: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 100,
        });

        res.json({
          sessions: sessions.map((s) => ({
            id: s.id,
            actor_user_id: s.actorUserId,
            target_user_id: s.targetUserId,
            actor_user_email: s.actorUser.email,
            target_user_email: s.targetUser.email,
            actor_user_name: s.actorUser.name,
            target_user_name: s.targetUser.name,
            actor_user_role: s.actorUser.role,
            target_user_role: s.targetUser.role,
            reason: s.reason,
            scope: Array.isArray(s.scope) ? s.scope : ["READ_ONLY"],
            started_at: s.startedAt.toISOString(),
            last_used_at: s.lastUsedAt?.toISOString() ?? null,
            expires_at: s.expiresAt.toISOString(),
            revoked_at: s.revokedAt?.toISOString() ?? null,
            revoked_by_user_id: s.revokedByUserId,
            revoked_by_user_email: s.revokedByUser?.email ?? null,
          })),
        });
      } catch (err) {
        logger.error("Support impersonation session list error", { error: err });
        res.status(500).json({ error: "Failed to load support impersonation sessions" });
      }
    }
  );

  router.post(
    "/support/impersonation/start",
    async (req: AuthReq, res: Response) => {
      const payload = parseRequestBody(StartSupportImpersonationSchema, req.body, res);
      if (!payload) {
        return;
      }
      try {
        if (!req.organizationId || !req.userId) {
          res.status(401).json({ error: "authentication_required" });
          return;
        }
        if (req.impersonation) {
          res.status(400).json({
            error: "impersonation_chain_not_allowed",
            message: "End the current support impersonation session before starting a new one.",
          });
          return;
        }
        const allowed = await canManageSupportImpersonation(prisma, req);
        if (!allowed) {
          res.status(403).json({ error: "permission_denied" });
          return;
        }

        const target = await prisma.user.findFirst({
          where: {
            id: payload.target_user_id,
            organizationId: req.organizationId,
          },
          select: { id: true, role: true, email: true },
        });
        if (!target) {
          res.status(404).json({ error: "target_user_not_found" });
          return;
        }

        if (
          req.userRole !== "OWNER" &&
          target.role === "OWNER"
        ) {
          res.status(403).json({
            error: "owner_impersonation_restricted",
            message: "Only organization owners can impersonate owner accounts.",
          });
          return;
        }

        const ttlMinutes = payload.ttl_minutes ?? 30;
        const scope = payload.scope && payload.scope.length > 0
          ? Array.from(new Set(payload.scope))
          : (["READ_ONLY"] as string[]);
        const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
        const rawToken = crypto.randomBytes(32).toString("hex");
        const sessionTokenHash = hashImpersonationToken(rawToken);

        const session = await prisma.supportImpersonationSession.create({
          data: {
            organizationId: req.organizationId,
            actorUserId: req.userId,
            targetUserId: target.id,
            reason: payload.reason.trim(),
            scope,
            sessionTokenHash,
            expiresAt,
          },
        });

        await auditLogs.record({
          organizationId: req.organizationId,
          actorUserId: req.userId,
          category: "SUPPORT",
          action: "SUPPORT_IMPERSONATION_STARTED",
          targetType: "user",
          targetId: target.id,
          severity: "CRITICAL",
          metadata: {
            session_id: session.id,
            scope,
            ttl_minutes: ttlMinutes,
            reason: payload.reason.trim(),
            target_user_email: target.email,
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });

        res.status(201).json({
          id: session.id,
          support_impersonation_token: rawToken,
          actor_user_id: session.actorUserId,
          target_user_id: session.targetUserId,
          scope,
          expires_at: session.expiresAt.toISOString(),
          reason: session.reason,
        });
      } catch (err) {
        logger.error("Start support impersonation error", { error: err });
        res.status(500).json({ error: "Failed to start support impersonation" });
      }
    }
  );

  router.post(
    "/support/impersonation/:sessionId/revoke",
    async (req: AuthReq, res: Response) => {
      try {
        if (!req.organizationId || !req.userId) {
          res.status(401).json({ error: "authentication_required" });
          return;
        }
        const allowed = await canManageSupportImpersonation(prisma, req);
        if (!allowed) {
          res.status(403).json({ error: "permission_denied" });
          return;
        }
        const sessionId = Array.isArray(req.params.sessionId)
          ? (req.params.sessionId[0] ?? "")
          : (req.params.sessionId ?? "");
        const existing = await prisma.supportImpersonationSession.findFirst({
          where: {
            id: sessionId,
            organizationId: req.organizationId,
          },
          select: {
            id: true,
            targetUserId: true,
            revokedAt: true,
          },
        });
        if (!existing) {
          res.status(404).json({ error: "session_not_found" });
          return;
        }
        if (existing.revokedAt) {
          res.status(400).json({ error: "session_already_revoked" });
          return;
        }

        const revokedAt = new Date();
        await prisma.supportImpersonationSession.update({
          where: { id: sessionId },
          data: {
            revokedAt,
            revokedByUserId: req.userId,
          },
        });

        await auditLogs.record({
          organizationId: req.organizationId,
          actorUserId: req.userId,
          category: "SUPPORT",
          action: "SUPPORT_IMPERSONATION_REVOKED",
          targetType: "user",
          targetId: existing.targetUserId,
          severity: "CRITICAL",
          metadata: { session_id: sessionId },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });

        res.json({ revoked: true, revoked_at: revokedAt.toISOString() });
      } catch (err) {
        logger.error("Revoke support impersonation error", { error: err });
        res.status(500).json({ error: "Failed to revoke support impersonation session" });
      }
    }
  );
}
