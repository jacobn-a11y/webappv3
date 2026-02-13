/**
 * WorkOS Authentication Middleware
 *
 * Verifies JWT access tokens issued by WorkOS and populates
 * req.organizationId, req.userId, and req.userRole for downstream handlers.
 *
 * Tokens are expected in the Authorization header as: Bearer <accessToken>
 * The access token is a JWT signed by WorkOS, verified against their JWKS endpoint.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { WorkOS } from "@workos-inc/node";
import type { Request, Response, NextFunction } from "express";
import type { PrismaClient, UserRole } from "@prisma/client";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuthenticatedRequest extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

interface WorkOSJWTPayload extends JWTPayload {
  sub: string;
}

// ─── Middleware Factory ─────────────────────────────────────────────────────

/**
 * Creates Express middleware that verifies WorkOS access tokens and attaches
 * the local User's organizationId, userId, and userRole to the request.
 *
 * Place this middleware AFTER public routes so it only runs on protected paths.
 */
export function createAuthMiddleware(prisma: PrismaClient, workos: WorkOS) {
  const clientId = process.env.WORKOS_CLIENT_ID ?? "";
  const jwksUrl = workos.userManagement.getJwksUrl(clientId);
  const JWKS = createRemoteJWKSet(new URL(jwksUrl));

  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      res
        .status(401)
        .json({ error: "Missing or malformed authorization header" });
      return;
    }

    const token = authHeader.slice(7);

    let payload: WorkOSJWTPayload;
    try {
      const result = await jwtVerify(token, JWKS);
      payload = result.payload as WorkOSJWTPayload;
    } catch {
      res.status(401).json({ error: "Invalid or expired access token" });
      return;
    }

    const workosUserId = payload.sub;
    if (!workosUserId) {
      res.status(401).json({ error: "Invalid token: missing subject" });
      return;
    }

    // Look up local user by WorkOS ID
    const user = await prisma.user.findUnique({
      where: { workosUserId },
    });

    if (!user) {
      res
        .status(401)
        .json({ error: "User not found. Complete sign-up first." });
      return;
    }

    req.organizationId = user.organizationId;
    req.userId = user.id;
    req.userRole = user.role;

    next();
  };
}
