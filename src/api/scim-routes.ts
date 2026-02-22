import { Router, type Request, type Response } from "express";
import type { PrismaClient, UserRole } from "@prisma/client";
import { z } from "zod";
import crypto from "crypto";

interface ScimAuthContext {
  organizationId: string;
  provisioningId: string;
}

const ScimCreateUserSchema = z.object({
  externalId: z.string().min(1),
  userName: z.string().email(),
  active: z.boolean().optional().default(true),
  name: z
    .object({
      givenName: z.string().optional(),
      familyName: z.string().optional(),
    })
    .optional(),
});

const ScimPatchSchema = z.object({
  active: z.boolean().optional(),
  name: z
    .object({
      givenName: z.string().optional(),
      familyName: z.string().optional(),
    })
    .optional(),
});

function hashScimToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createScimRoutes(prisma: PrismaClient): Router {
  const router = Router();

  async function authenticate(req: Request): Promise<ScimAuthContext | null> {
    const auth = req.headers.authorization;
    if (!auth || !auth.toLowerCase().startsWith("bearer ")) return null;
    const token = auth.slice("bearer ".length).trim();
    if (!token) return null;
    const tokenHash = hashScimToken(token);
    const provisioning = await prisma.scimProvisioning.findFirst({
      where: { tokenHash, enabled: true },
      select: { id: true, organizationId: true },
    });
    if (!provisioning) return null;
    return {
      organizationId: provisioning.organizationId,
      provisioningId: provisioning.id,
    };
  }

  router.get("/ServiceProviderConfig", (_req, res) => {
    res.json({
      patch: { supported: true },
      bulk: { supported: false },
      filter: { supported: false },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: "oauthbearertoken",
          name: "Bearer Token",
          description: "Use SCIM bearer token configured in admin dashboard.",
        },
      ],
    });
  });

  router.post("/Users", async (req: Request, res: Response) => {
    const auth = await authenticate(req);
    if (!auth) {
      res.status(401).json({ detail: "Invalid SCIM bearer token." });
      return;
    }

    const parsed = ScimCreateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ detail: "Invalid SCIM payload." });
      return;
    }

    const { externalId, userName, active, name } = parsed.data;
    const fullName =
      [name?.givenName, name?.familyName].filter(Boolean).join(" ") || null;

    const normalizedEmail = userName.toLowerCase();
    const existingByEmail = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, organizationId: true },
    });
    if (existingByEmail && existingByEmail.organizationId !== auth.organizationId) {
      res.status(409).json({
        detail:
          "A user with this email exists in a different organization. SCIM create denied.",
      });
      return;
    }
    const user =
      existingByEmail && existingByEmail.organizationId === auth.organizationId
        ? await prisma.user.update({
            where: { id: existingByEmail.id },
            data: { name: fullName },
          })
        : await prisma.user.create({
            data: {
              email: normalizedEmail,
              name: fullName,
              organizationId: auth.organizationId,
              role: "MEMBER" as UserRole,
            },
          });

    await prisma.scimIdentity.upsert({
      where: { userId: user.id },
      create: {
        organizationId: auth.organizationId,
        userId: user.id,
        externalId,
        active,
        lastSyncedAt: new Date(),
      },
      update: {
        externalId,
        active,
        lastSyncedAt: new Date(),
      },
    });

    await prisma.scimProvisioning.updateMany({
      where: { id: auth.provisioningId },
      data: { lastSyncAt: new Date() },
    });

    res.status(201).json({
      id: user.id,
      externalId,
      userName: user.email,
      active,
    });
  });

  router.patch("/Users/:userId", async (req: Request, res: Response) => {
    const auth = await authenticate(req);
    if (!auth) {
      res.status(401).json({ detail: "Invalid SCIM bearer token." });
      return;
    }
    const parsed = ScimPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ detail: "Invalid SCIM payload." });
      return;
    }

    const scopedUserId = Array.isArray(req.params.userId)
      ? (req.params.userId[0] ?? "")
      : (req.params.userId ?? "");

    const scimIdentity = await prisma.scimIdentity.findFirst({
      where: {
        organizationId: auth.organizationId,
        OR: [{ externalId: scopedUserId }, { userId: scopedUserId }],
      },
    });
    if (!scimIdentity) {
      res.status(404).json({ detail: "SCIM identity not found." });
      return;
    }

    const localUser = await prisma.user.findUnique({
      where: { id: scimIdentity.userId },
      select: { name: true },
    });

    const updatedName =
      parsed.data.name &&
      [parsed.data.name.givenName, parsed.data.name.familyName]
        .filter(Boolean)
        .join(" ");

    await prisma.$transaction([
      prisma.scimIdentity.update({
        where: { id: scimIdentity.id },
        data: {
          active: parsed.data.active ?? scimIdentity.active,
          lastSyncedAt: new Date(),
        },
      }),
      prisma.user.update({
        where: { id: scimIdentity.userId },
        data: {
          name: updatedName ? updatedName : localUser?.name ?? null,
        },
      }),
    ]);

    await prisma.scimProvisioning.updateMany({
      where: { id: auth.provisioningId },
      data: { lastSyncAt: new Date() },
    });

    res.json({
      id: scimIdentity.userId,
      externalId: scimIdentity.externalId,
      active: parsed.data.active ?? scimIdentity.active,
    });
  });

  router.delete("/Users/:userId", async (req: Request, res: Response) => {
    const auth = await authenticate(req);
    if (!auth) {
      res.status(401).json({ detail: "Invalid SCIM bearer token." });
      return;
    }
    const scopedUserId = Array.isArray(req.params.userId)
      ? (req.params.userId[0] ?? "")
      : (req.params.userId ?? "");
    const scimIdentity = await prisma.scimIdentity.findFirst({
      where: {
        organizationId: auth.organizationId,
        OR: [{ externalId: scopedUserId }, { userId: scopedUserId }],
      },
    });
    if (!scimIdentity) {
      res.status(204).send();
      return;
    }

    await prisma.scimIdentity.update({
      where: { id: scimIdentity.id },
      data: { active: false, lastSyncedAt: new Date() },
    });

    await prisma.scimProvisioning.updateMany({
      where: { id: auth.provisioningId },
      data: { lastSyncAt: new Date() },
    });

    res.status(204).send();
  });

  return router;
}
