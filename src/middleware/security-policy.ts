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

const policyCache = new Map<string, { policy: SecurityPolicy; expiresAt: number }>();
const ipAllowlistCache = new Map<string, { entries: string[]; expiresAt: number }>();
const CACHE_TTL_MS = resolvePositiveInt(process.env.SECURITY_POLICY_CACHE_TTL_SECONDS, 60) * 1000;

function requestIp(req: Request): string {
  // Rely on Express req.ip (honors trust proxy when configured).
  return req.ip ?? req.socket.remoteAddress ?? "";
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

function ipToLong(ip: string): number {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return -1;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function ipMatchesAllowlist(ip: string, value: string): boolean {
  const entry = value.trim();
  if (!entry) return false;

  // Exact match (no CIDR notation)
  if (!entry.includes("/")) return ip === entry;

  const [network, prefixStr] = entry.split("/");
  const prefix = parseInt(prefixStr, 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;

  const ipLong = ipToLong(ip);
  const networkLong = ipToLong(network);
  if (ipLong === -1 || networkLong === -1) return false;

  // Build subnet mask from prefix length
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipLong & mask) === (networkLong & mask);
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

    const policy = await getOrgSecurityPolicy(prisma, organizationId);

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
      const dbAllowlist = await getOrgIpAllowlist(prisma, organizationId);
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

async function getOrgSecurityPolicy(
  prisma: PrismaClient,
  organizationId: string
): Promise<SecurityPolicy> {
  const now = Date.now();
  const cached = policyCache.get(organizationId);
  if (cached && cached.expiresAt > now) {
    return cached.policy;
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
  policyCache.set(organizationId, { policy, expiresAt: now + CACHE_TTL_MS });
  return policy;
}

async function getOrgIpAllowlist(
  prisma: PrismaClient,
  organizationId: string
): Promise<string[]> {
  const now = Date.now();
  const cached = ipAllowlistCache.get(organizationId);
  if (cached && cached.expiresAt > now) {
    return cached.entries;
  }

  const entries = await prisma.orgIpAllowlistEntry.findMany({
    where: { organizationId, enabled: true },
    select: { cidr: true },
  });
  const allowlist = entries.map((e) => e.cidr).filter(Boolean);
  ipAllowlistCache.set(organizationId, {
    entries: allowlist,
    expiresAt: now + CACHE_TTL_MS,
  });
  return allowlist;
}

function resolvePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export function __resetSecurityPolicyCacheForTests(): void {
  policyCache.clear();
  ipAllowlistCache.clear();
}
