import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ScimService } from "../services/scim.js";
import { sendSuccess, sendCreated, sendNoContent } from "./_shared/responses.js";

// ─── Validation Schemas ─────────────────────────────────────────────────────

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

// ─── Route Factory ──────────────────────────────────────────────────────────

export function createScimRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const scimService = new ScimService(prisma);

  async function extractBearerToken(req: Request): Promise<string | null> {
    const auth = req.headers.authorization;
    if (!auth || !auth.toLowerCase().startsWith("bearer ")) return null;
    const token = auth.slice("bearer ".length).trim();
    if (!token) return null;
    return token;
  }

  router.get("/ServiceProviderConfig", (_req, res) => {
    sendSuccess(res, {
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
    const bearerToken = await extractBearerToken(req);
    if (!bearerToken) {
      res.status(401).json({ detail: "Invalid SCIM bearer token." });
      return;
    }
    const auth = await scimService.authenticateToken(bearerToken);
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

    try {
      const result = await scimService.createOrUpdateUser(auth, {
        externalId,
        email: userName,
        fullName,
        active,
      });

      sendCreated(res, {
        id: result.id,
        externalId: result.externalId,
        userName: result.userName,
        active: result.active,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "SCIM create failed";
      if (message.includes("different organization")) {
        res.status(409).json({ detail: message });
      } else {
        res.status(400).json({ detail: message });
      }
    }
  });

  router.patch("/Users/:userId", async (req: Request, res: Response) => {
    const bearerToken = await extractBearerToken(req);
    if (!bearerToken) {
      res.status(401).json({ detail: "Invalid SCIM bearer token." });
      return;
    }
    const auth = await scimService.authenticateToken(bearerToken);
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

    const updatedName =
      parsed.data.name &&
      [parsed.data.name.givenName, parsed.data.name.familyName]
        .filter(Boolean)
        .join(" ");

    try {
      const result = await scimService.patchUser(auth, scopedUserId, {
        active: parsed.data.active,
        name: updatedName || undefined,
      });

      sendSuccess(res, {
        id: result.id,
        externalId: result.externalId,
        active: result.active,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "SCIM patch failed";
      if (message.includes("not found")) {
        res.status(404).json({ detail: message });
      } else {
        res.status(400).json({ detail: message });
      }
    }
  });

  router.delete("/Users/:userId", async (req: Request, res: Response) => {
    const bearerToken = await extractBearerToken(req);
    if (!bearerToken) {
      res.status(401).json({ detail: "Invalid SCIM bearer token." });
      return;
    }
    const auth = await scimService.authenticateToken(bearerToken);
    if (!auth) {
      res.status(401).json({ detail: "Invalid SCIM bearer token." });
      return;
    }
    const scopedUserId = Array.isArray(req.params.userId)
      ? (req.params.userId[0] ?? "")
      : (req.params.userId ?? "");

    await scimService.deactivateUser(auth, scopedUserId);
    sendNoContent(res);
  });

  return router;
}
