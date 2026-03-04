import type { PrismaClient, UserRole } from "@prisma/client";
import crypto from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScimAuthContext {
  organizationId: string;
  provisioningId: string;
}

export interface ScimUserResult {
  id: string;
  externalId: string;
  userName: string;
  active: boolean;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class ScimService {
  constructor(private prisma: PrismaClient) {}

  async authenticateToken(bearerToken: string): Promise<ScimAuthContext | null> {
    const tokenHash = crypto.createHash("sha256").update(bearerToken).digest("hex");
    const provisioning = await this.prisma.scimProvisioning.findFirst({
      where: { tokenHash, enabled: true },
      select: { id: true, organizationId: true },
    });
    if (!provisioning) return null;
    return {
      organizationId: provisioning.organizationId,
      provisioningId: provisioning.id,
    };
  }

  async createOrUpdateUser(
    auth: ScimAuthContext,
    params: {
      externalId: string;
      email: string;
      fullName: string | null;
      active: boolean;
    }
  ): Promise<ScimUserResult> {
    const normalizedEmail = params.email.toLowerCase();

    const existingByEmail = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, organizationId: true },
    });

    if (existingByEmail && existingByEmail.organizationId !== auth.organizationId) {
      throw new Error(
        "A user with this email exists in a different organization. SCIM create denied."
      );
    }

    const user =
      existingByEmail && existingByEmail.organizationId === auth.organizationId
        ? await this.prisma.user.update({
            where: { id: existingByEmail.id },
            data: { name: params.fullName },
          })
        : await this.prisma.user.create({
            data: {
              email: normalizedEmail,
              name: params.fullName,
              organizationId: auth.organizationId,
              role: "MEMBER" as UserRole,
            },
          });

    await this.prisma.scimIdentity.upsert({
      where: { userId: user.id },
      create: {
        organizationId: auth.organizationId,
        userId: user.id,
        externalId: params.externalId,
        active: params.active,
        lastSyncedAt: new Date(),
      },
      update: {
        externalId: params.externalId,
        active: params.active,
        lastSyncedAt: new Date(),
      },
    });

    await this.prisma.scimProvisioning.updateMany({
      where: { id: auth.provisioningId },
      data: { lastSyncAt: new Date() },
    });

    return {
      id: user.id,
      externalId: params.externalId,
      userName: user.email,
      active: params.active,
    };
  }

  async patchUser(
    auth: ScimAuthContext,
    scopedUserId: string,
    patch: {
      active?: boolean;
      name?: string | false;
    }
  ): Promise<ScimUserResult> {
    const scimIdentity = await this.prisma.scimIdentity.findFirst({
      where: {
        organizationId: auth.organizationId,
        OR: [{ externalId: scopedUserId }, { userId: scopedUserId }],
      },
    });
    if (!scimIdentity) {
      throw new Error("SCIM identity not found.");
    }

    const localUser = await this.prisma.user.findUnique({
      where: { id: scimIdentity.userId },
      select: { name: true },
    });

    const updatedName = patch.name !== undefined && patch.name !== false ? patch.name : null;

    await this.prisma.$transaction([
      this.prisma.scimIdentity.update({
        where: { id: scimIdentity.id },
        data: {
          active: patch.active ?? scimIdentity.active,
          lastSyncedAt: new Date(),
        },
      }),
      this.prisma.user.update({
        where: { id: scimIdentity.userId },
        data: {
          name: updatedName ? updatedName : localUser?.name ?? null,
        },
      }),
    ]);

    if (patch.active === false) {
      await this.prisma.userSession.updateMany({
        where: { userId: scimIdentity.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await this.prisma.scimProvisioning.updateMany({
      where: { id: auth.provisioningId },
      data: { lastSyncAt: new Date() },
    });

    return {
      id: scimIdentity.userId,
      externalId: scimIdentity.externalId,
      active: patch.active ?? scimIdentity.active,
      userName: "",
    };
  }

  async deactivateUser(auth: ScimAuthContext, scopedUserId: string): Promise<boolean> {
    const scimIdentity = await this.prisma.scimIdentity.findFirst({
      where: {
        organizationId: auth.organizationId,
        OR: [{ externalId: scopedUserId }, { userId: scopedUserId }],
      },
    });
    if (!scimIdentity) {
      return false;
    }

    await this.prisma.scimIdentity.update({
      where: { id: scimIdentity.id },
      data: { active: false, lastSyncedAt: new Date() },
    });

    await this.prisma.userSession.updateMany({
      where: { userId: scimIdentity.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.prisma.scimProvisioning.updateMany({
      where: { id: auth.provisioningId },
      data: { lastSyncAt: new Date() },
    });

    return true;
  }
}
