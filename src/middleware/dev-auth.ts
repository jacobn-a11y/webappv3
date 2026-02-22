import type { NextFunction, Request, Response } from "express";
import type { PrismaClient, UserRole } from "@prisma/client";

interface AuthRequest extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

export function createDevAuthBypass(prisma: PrismaClient) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (process.env.NODE_ENV !== "development") {
      next();
      return;
    }

    if (process.env.DEV_AUTH_BYPASS !== "true") {
      next();
      return;
    }

    const authReq = req as AuthRequest;
    if (authReq.organizationId && authReq.userId) {
      next();
      return;
    }

    const defaultUserId = process.env.DEV_USER_ID ?? "usr_alice";
    const user = await prisma.user.findUnique({
      where: { id: defaultUserId },
      select: { id: true, organizationId: true, role: true },
    });

    if (user) {
      authReq.userId = user.id;
      authReq.organizationId = user.organizationId;
      authReq.userRole = user.role;
    }

    next();
  };
}
