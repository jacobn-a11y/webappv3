import type { PrismaClient, User, UserRole } from "@prisma/client";
import { generateSessionToken, hashSessionToken } from "../lib/session-token.js";
import {
  decodeSecurityPolicy,
  type SecurityPolicyBoundary,
} from "../types/json-boundaries.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SessionResult {
  token: string;
  expiresAt: Date;
}

export interface ActiveSession {
  user: User;
  expiresAt: Date;
  sessionId: string;
}

export interface InviteDetails {
  email: string;
  role: UserRole;
  organizationId: string;
  organizationName: string;
  expiresAt: Date;
  acceptedAt: Date | null;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class AuthService {
  constructor(private prisma: PrismaClient) {}

  async readOrgSecurityPolicy(organizationId: string): Promise<SecurityPolicyBoundary> {
    const settings = await this.prisma.orgSettings.findUnique({
      where: { organizationId },
      select: { securityPolicy: true },
    });
    return decodeSecurityPolicy(settings?.securityPolicy);
  }

  async enforcePasswordAuthAllowed(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { organizationId: true },
    });
    if (!user) return;
    const policy = await this.readOrgSecurityPolicy(user.organizationId);
    if (policy.sso_enforced) {
      throw new Error(
        "SSO is enforced for your organization. Use SSO login instead of password authentication."
      );
    }
  }

  async enforceSsoDomainMapping(user: User): Promise<void> {
    const policy = await this.readOrgSecurityPolicy(user.organizationId);
    const allowed = (policy.allowed_sso_domains ?? [])
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    if (allowed.length === 0) return;
    const domain = user.email.split("@")[1]?.toLowerCase() ?? "";
    if (!allowed.includes(domain)) {
      throw new Error("SSO domain is not allowed for this organization.");
    }
  }

  async createSessionForUser(
    user: User,
    reqMeta: { ipAddress?: string | null; userAgent?: string | null }
  ): Promise<SessionResult> {
    const policy = await this.readOrgSecurityPolicy(user.organizationId);
    const maxHours = Math.max(1, policy.max_session_age_hours ?? 24 * 30);
    const expiresAt = new Date(Date.now() + maxHours * 60 * 60 * 1000);
    const token = generateSessionToken();
    await this.prisma.userSession.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        sessionToken: token.hash,
        ipAddress: reqMeta.ipAddress ?? null,
        userAgent: reqMeta.userAgent ?? null,
        expiresAt,
      },
    });
    return { token: token.raw, expiresAt };
  }

  async findActiveSession(rawToken: string): Promise<ActiveSession | null> {
    const now = new Date();
    const hashed = hashSessionToken(rawToken);
    const session = await this.prisma.userSession.findFirst({
      where: {
        sessionToken: hashed,
        revokedAt: null,
      },
      include: {
        user: true,
      },
    });

    if (!session) return null;
    if (session.expiresAt <= now) {
      await this.prisma.userSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: now },
      });
      return null;
    }

    await this.prisma.userSession.updateMany({
      where: { id: session.id },
      data: { lastSeenAt: now },
    });
    return { user: session.user, expiresAt: session.expiresAt, sessionId: session.id };
  }

  async revokeSession(rawToken: string): Promise<void> {
    const hashed = hashSessionToken(rawToken);
    await this.prisma.userSession.updateMany({
      where: { sessionToken: hashed, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async findUserByWorkosId(workosUserId: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { workosUserId },
    });
  }

  async findUserByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async linkWorkosUser(userId: string, workosUserId: string, name: string | null, role?: UserRole): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        workosUserId,
        ...(name ? { name } : {}),
        ...(role ? { role } : {}),
      },
    });
  }

  async createUserWithOrg(params: {
    email: string;
    name: string | null;
    workosUserId: string;
    organizationName?: string;
  }): Promise<User> {
    const emailDomain = params.email.split("@")[1];
    const org = await this.prisma.organization.create({
      data: {
        name: params.organizationName ?? emailDomain,
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    });

    return this.prisma.user.create({
      data: {
        email: params.email,
        name: params.name,
        workosUserId: params.workosUserId,
        organizationId: org.id,
        role: "OWNER",
      },
    });
  }

  async createUserInOrg(params: {
    email: string;
    name: string | null;
    workosUserId: string;
    organizationId: string;
    role: UserRole;
  }): Promise<User> {
    const org = await this.prisma.organization.findUnique({
      where: { id: params.organizationId },
      select: { id: true },
    });
    if (!org) {
      throw new Error("Invitation organization no longer exists.");
    }

    return this.prisma.user.create({
      data: {
        email: params.email,
        name: params.name,
        workosUserId: params.workosUserId,
        organizationId: params.organizationId,
        role: params.role,
      },
    });
  }

  async updateUserName(userId: string, name: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { name },
    });
  }

  async getInviteByToken(token: string): Promise<InviteDetails | null> {
    const invite = await this.prisma.orgInvite.findUnique({
      where: { token },
      include: {
        organization: {
          select: { id: true, name: true },
        },
      },
    });

    if (!invite) return null;

    return {
      email: invite.email,
      role: invite.role,
      organizationId: invite.organization.id,
      organizationName: invite.organization.name,
      expiresAt: invite.expiresAt,
      acceptedAt: invite.acceptedAt,
    };
  }

  async getInviteRaw(token: string) {
    return this.prisma.orgInvite.findUnique({
      where: { token },
    });
  }

  async markInviteAccepted(inviteId: string): Promise<void> {
    await this.prisma.orgInvite.update({
      where: { id: inviteId },
      data: { acceptedAt: new Date() },
    });
  }
}
