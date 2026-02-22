import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";

export function createStatusRoutes(prisma: PrismaClient): Router {
  const router = Router();

  router.get("/incidents", async (req: Request, res: Response) => {
    try {
      const orgIdRaw = req.query.organization_id;
      const organizationId = Array.isArray(orgIdRaw)
        ? (orgIdRaw[0] ?? "")
        : (orgIdRaw ?? "");
      if (!organizationId || typeof organizationId !== "string") {
        res.status(400).json({
          error: "organization_id_required",
          message: "Pass ?organization_id=<org-id> to fetch status incidents.",
        });
        return;
      }

      const incidents = await prisma.incident.findMany({
        where: {
          organizationId,
          status: { in: ["OPEN", "MONITORING"] },
        },
        include: {
          updates: {
            orderBy: { createdAt: "desc" },
            take: 10,
          },
        },
        orderBy: { startedAt: "desc" },
        take: 20,
      });

      res.json({
        incidents: incidents.map((i) => ({
          id: i.id,
          title: i.title,
          summary: i.summary,
          severity: i.severity,
          status: i.status,
          started_at: i.startedAt.toISOString(),
          updated_at: i.updatedAt.toISOString(),
          updates: i.updates.map((u) => ({
            id: u.id,
            message: u.message,
            status: u.status,
            created_at: u.createdAt.toISOString(),
          })),
        })),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "status_error" });
    }
  });

  return router;
}
