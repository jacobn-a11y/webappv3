import type { NextFunction, Request, Response } from "express";
import type { PrismaClient, UserRole } from "@prisma/client";
import { hashSessionToken } from "../lib/session-token.js";
import { AuditLogService } from "../services/audit-log.js";

interface AuthenticatedRequest extends Request {
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

const ADMIN_ROLES: UserRole[] = ["OWNER", "ADMIN"];
const SUPPORT_IMPERSONATION_HEADER = "x-support-impersonation-token";

async function actorCanImpersonate(prisma: PrismaClient, req: AuthenticatedRequest): Promise<boolean> {
  if (!req.userId) return false;
  if (req.userRole && ADMIN_ROLES.includes(req.userRole)) return true;
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

export function applySupportImpersonation(prisma: PrismaClient) {
  const auditLogs = new AuditLogService(prisma);

  return async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    const organizationId = authReq.organizationId;
    const actorUserId = authReq.userId;

    const tokenHeader = req.headers[SUPPORT_IMPERSONATION_HEADER];
    const rawToken = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;

    if (!rawToken || typeof rawToken !== "string") {
      next();
      return;
    }

    if (!organizationId || !actorUserId) {
      res.status(401).json({ error: "authentication_required" });
      return;
    }

    const isAllowedActor = await actorCanImpersonate(prisma, authReq);
    if (!isAllowedActor) {
      res.status(403).json({
        error: "support_impersonation_not_allowed",
        message: "You do not have permission to use support impersonation.",
      });
      return;
    }

    const sessionTokenHash = hashSessionToken(rawToken.trim());
    const now = new Date();
    const session = await prisma.supportImpersonationSession.findFirst({
      where: {
        organizationId,
        actorUserId,
        sessionTokenHash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      include: {
        targetUser: {
          select: { id: true, role: true },
        },
      },
    });

    if (!session) {
      res.status(401).json({ error: "invalid_support_impersonation_session" });
      return;
    }

    const scopeRaw = session.scope;
    const scope =
      scopeRaw && Array.isArray(scopeRaw)
        ? scopeRaw.filter((v): v is string => typeof v === "string")
        : ["READ_ONLY"];

    authReq.impersonation = {
      sessionId: session.id,
      actorUserId,
      targetUserId: session.targetUserId,
      scope,
      reason: session.reason,
      expiresAt: session.expiresAt.toISOString(),
    };

    // Apply effective context as target user while retaining actor in req.impersonation.
    authReq.userId = session.targetUserId;
    authReq.userRole = session.targetUser.role;

    await prisma.supportImpersonationSession.update({
      where: { id: session.id },
      data: { lastUsedAt: now },
    });

    await auditLogs.record({
      organizationId,
      actorUserId,
      category: "SUPPORT",
      action: "SUPPORT_IMPERSONATION_USED",
      targetType: "user",
      targetId: session.targetUserId,
      severity: "WARN",
      metadata: {
        session_id: session.id,
        method: req.method,
        path: req.path,
        scope,
      },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    next();
  };
}

export function requireImpersonationWriteScope(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.impersonation) {
    next();
    return;
  }

  const method = req.method.toUpperCase();
  const isReadMethod = method === "GET" || method === "HEAD" || method === "OPTIONS";
  if (isReadMethod) {
    next();
    return;
  }

  if (!authReq.impersonation.scope.includes("WRITE")) {
    res.status(403).json({
      error: "support_impersonation_read_only",
      message: "Current support impersonation session is read-only.",
    });
    return;
  }

  next();
}
