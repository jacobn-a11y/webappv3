import type { NextFunction, Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { hashSessionToken } from "../lib/session-token.js";

interface SecurityPolicy {
  enforce_mfa_for_admin_actions?: boolean;
  ip_allowlist_enabled?: boolean;
  ip_allowlist?: string[]; // legacy fallback
  session_controls_enabled?: boolean;
  max_session_age_hours?: number;
  reauth_interval_minutes?: number;
}

interface EnforceOptions {
  requireMfaIfConfigured?: boolean;
  enforceIpAllowlistIfConfigured?: boolean;
  requireSessionIfConfigured?: boolean;
  requireRecentAuthIfConfigured?: boolean;
}

interface AuthenticatedRequest extends Request {
  organizationId?: string;
  userId?: string;
  mfaVerified?: boolean;
  authContext?: { amr?: string[] };
  sessionId?: string;
}

function requestIp(req: Request): string {
  const fallbackIp = req.ip ?? "";
  const forwarded = req.headers["x-forwarded-for"];
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].split(",")[0]?.trim() ?? fallbackIp;
  }
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]?.trim() ?? fallbackIp;
  }
  return fallbackIp;
}

function hasMfa(req: Request): boolean {
  const header = req.headers["x-mfa-verified"];
  if (Array.isArray(header)) {
    if (header.some((h) => h.toLowerCase() === "true")) return true;
  } else if (typeof header === "string" && header.toLowerCase() === "true") {
    return true;
  }

  const authReq = req as AuthenticatedRequest;
  if (authReq.mfaVerified === true) return true;

  const authContext = authReq.authContext;
  if (authContext?.amr?.includes("mfa")) return true;

  return false;
}

function ipMatchesAllowlist(ip: string, value: string): boolean {
  const entry = value.trim();
  if (!entry) return false;
  if (!entry.includes("/")) return ip === entry;
  // Minimal CIDR handling for explicit host match.
  if (entry.endsWith("/32")) {
    return ip === entry.replace("/32", "");
  }
  return false;
}

export function requireOrgSecurityPolicy(
  prisma: PrismaClient,
  options: EnforceOptions
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    const organizationId = authReq.organizationId;
    const userId = authReq.userId;
    if (!organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const settings = await prisma.orgSettings.findUnique({
      where: { organizationId },
      select: { securityPolicy: true },
    });
    const rawPolicy = settings?.securityPolicy;
    const policy =
      rawPolicy && typeof rawPolicy === "object" && !Array.isArray(rawPolicy)
        ? (rawPolicy as SecurityPolicy)
        : {};

    if (
      options.requireMfaIfConfigured &&
      policy.enforce_mfa_for_admin_actions
    ) {
      if (!hasMfa(req)) {
        res.status(403).json({
          error: "mfa_required",
          message:
            "This action requires multi-factor authentication per organization policy.",
        });
        return;
      }
    }

    if (
      options.enforceIpAllowlistIfConfigured &&
      policy.ip_allowlist_enabled
    ) {
      const entries = await prisma.orgIpAllowlistEntry.findMany({
        where: { organizationId, enabled: true },
        select: { cidr: true },
      });
      const dbAllowlist = entries.map((e) => e.cidr).filter(Boolean);
      const allowlist =
        dbAllowlist.length > 0
          ? dbAllowlist
          : (policy.ip_allowlist ?? []).filter(Boolean);
      if (allowlist.length > 0) {
        const ip = requestIp(req);
        if (!allowlist.some((entry) => ipMatchesAllowlist(ip, entry))) {
          res.status(403).json({
            error: "ip_restricted",
            message:
              "Access denied by organization IP allowlist policy.",
          });
          return;
        }
      }
    }

    if (options.requireSessionIfConfigured && policy.session_controls_enabled) {
      if (!userId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      const tokenHeader = req.headers["x-session-token"];
      const rawToken = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
      if (!rawToken || typeof rawToken !== "string") {
        res.status(401).json({
          error: "session_required",
          message: "This organization requires an active session token.",
        });
        return;
      }

      const hashedToken = hashSessionToken(rawToken.trim());
      const session = await prisma.userSession.findFirst({
        where: {
          organizationId,
          userId,
          sessionToken: hashedToken,
          revokedAt: null,
        },
        select: { id: true, createdAt: true, expiresAt: true },
      });
      if (!session) {
        res.status(401).json({ error: "invalid_session" });
        return;
      }

      const now = Date.now();
      if (session.expiresAt.getTime() <= now) {
        await prisma.userSession.updateMany({
          where: { id: session.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        res.status(401).json({ error: "session_expired" });
        return;
      }

      const maxHours = policy.max_session_age_hours;
      if (
        typeof maxHours === "number" &&
        maxHours > 0 &&
        session.createdAt.getTime() + maxHours * 60 * 60 * 1000 <= now
      ) {
        await prisma.userSession.updateMany({
          where: { id: session.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        res.status(401).json({ error: "session_max_age_exceeded" });
        return;
      }

      if (
        options.requireRecentAuthIfConfigured &&
        typeof policy.reauth_interval_minutes === "number" &&
        policy.reauth_interval_minutes > 0
      ) {
        const cutoff = now - policy.reauth_interval_minutes * 60 * 1000;
        if (session.createdAt.getTime() < cutoff) {
          res.status(403).json({
            error: "recent_reauth_required",
            message:
              "Recent re-authentication is required for this sensitive action.",
          });
          return;
        }
      }

      authReq.sessionId = session.id;
      await prisma.userSession.updateMany({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      });
    }

    next();
  };
}
