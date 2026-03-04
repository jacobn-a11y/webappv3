import type { PrismaClient, UserRole } from "@prisma/client";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OrgDetails {
  id: string;
  name: string;
  plan: string;
  memberCount: number;
  createdAt: Date;
}

export interface OrgMember {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: Date;
}

export interface OrgInviteRecord {
  id: string;
  email: string;
  role: UserRole;
  expiresAt: Date;
  createdAt: Date;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class OrgSettingsService {
  constructor(private prisma: PrismaClient) {}

  async getOrgDetails(organizationId: string): Promise<OrgDetails | null> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: { _count: { select: { users: true } } },
    });

    if (!org) return null;

    return {
      id: org.id,
      name: org.name,
      plan: org.plan,
      memberCount: org._count.users,
      createdAt: org.createdAt,
    };
  }

  async getAnonymizationSetting(organizationId: string): Promise<boolean> {
    const settings = await this.prisma.orgSettings.findUnique({
      where: { organizationId },
      select: { anonymizationEnabled: true },
    });
    return settings?.anonymizationEnabled ?? true;
  }

  async setAnonymizationSetting(organizationId: string, enabled: boolean): Promise<void> {
    await this.prisma.orgSettings.upsert({
      where: { organizationId },
      create: {
        organizationId,
        anonymizationEnabled: enabled,
      },
      update: {
        anonymizationEnabled: enabled,
      },
    });
  }

  async updateOrgName(organizationId: string, name: string): Promise<void> {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { name },
    });
  }

  async listMembers(organizationId: string): Promise<OrgMember[]> {
    return this.prisma.user.findMany({
      where: { organizationId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async findMember(memberId: string, organizationId: string) {
    return this.prisma.user.findFirst({
      where: { id: memberId, organizationId },
    });
  }

  async countOwners(organizationId: string): Promise<number> {
    return this.prisma.user.count({
      where: { organizationId, role: "OWNER" },
    });
  }

  async updateMemberRole(memberId: string, role: UserRole): Promise<void> {
    await this.prisma.user.update({
      where: { id: memberId },
      data: { role },
    });
  }

  async removeMember(memberId: string): Promise<void> {
    await this.prisma.user.delete({ where: { id: memberId } });
  }

  async findExistingUserByEmail(email: string, organizationId: string) {
    return this.prisma.user.findFirst({
      where: { email, organizationId },
    });
  }

  async upsertInvite(params: {
    organizationId: string;
    email: string;
    role: UserRole;
    invitedById: string;
    token: string;
    expiresAt: Date;
  }) {
    return this.prisma.orgInvite.upsert({
      where: {
        organizationId_email: {
          organizationId: params.organizationId,
          email: params.email,
        },
      },
      create: {
        organizationId: params.organizationId,
        email: params.email,
        role: params.role,
        invitedById: params.invitedById,
        token: params.token,
        expiresAt: params.expiresAt,
      },
      update: {
        role: params.role,
        invitedById: params.invitedById,
        token: params.token,
        expiresAt: params.expiresAt,
        acceptedAt: null,
      },
    });
  }

  async getOrgAndInviter(organizationId: string, inviterId: string) {
    const [org, inviter] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      }),
      this.prisma.user.findUnique({
        where: { id: inviterId },
        select: { name: true, email: true },
      }),
    ]);
    return { org, inviter };
  }

  async listPendingInvites(organizationId: string): Promise<OrgInviteRecord[]> {
    return this.prisma.orgInvite.findMany({
      where: {
        organizationId,
        acceptedAt: null,
      },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findInvite(inviteId: string, organizationId: string) {
    return this.prisma.orgInvite.findFirst({
      where: { id: inviteId, organizationId },
    });
  }

  async deleteInvite(inviteId: string): Promise<void> {
    await this.prisma.orgInvite.delete({ where: { id: inviteId } });
  }
}
