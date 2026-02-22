import type { NextFunction, Request, Response } from "express";
import type { PrismaClient, UserRole } from "@prisma/client";
import { hashSessionToken } from "../lib/session-token.js";

interface SessionAuthRequest extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
  sessionId?: string;
}

function readSessionToken(req: Request): string | null {
  const tokenHeader = req.headers["x-session-token"];
  const rawFromHeader = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
  if (typeof rawFromHeader === "string" && rawFromHeader.trim().length > 0) {
    return rawFromHeader.trim();
  }

  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (token.length > 0) return token;
  }

  return null;
}

/**
 * Resolves application sessions into request auth context.
 *
 * This middleware is intentionally permissive: when no valid session token is
 * present, it does not reject and simply lets downstream guards enforce auth.
 */
export function createSessionAuth(prisma: PrismaClient) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const authReq = req as SessionAuthRequest;

      if (authReq.organizationId && authReq.userId) {
        next();
        return;
      }

      const rawToken = readSessionToken(req);
      if (!rawToken) {
        next();
        return;
      }

      const now = new Date();
      const hashedToken = hashSessionToken(rawToken);

      const session = await prisma.userSession.findFirst({
        where: {
          sessionToken: hashedToken,
          revokedAt: null,
        },
        select: {
          id: true,
          expiresAt: true,
          user: {
            select: {
              id: true,
              organizationId: true,
              role: true,
            },
          },
        },
      });

      if (!session) {
        next();
        return;
      }

      if (session.expiresAt <= now) {
        await prisma.userSession.updateMany({
          where: { id: session.id, revokedAt: null },
          data: { revokedAt: now },
        });
        next();
        return;
      }

      if (!session.user?.id || !session.user.organizationId) {
        next();
        return;
      }

      authReq.sessionId = session.id;
      authReq.userId = session.user.id;
      authReq.organizationId = session.user.organizationId;
      authReq.userRole = session.user.role;

      prisma.userSession
        .updateMany({
          where: { id: session.id },
          data: { lastSeenAt: now },
        })
        .catch(() => {
          // lastSeenAt updates are non-critical
        });

      next();
    } catch (error) {
      console.error("Session auth middleware error:", error);
      next();
    }
  };
}
