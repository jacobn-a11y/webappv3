import { type Request, type Response, type Router } from "express";
import type { CRMProvider, PrismaClient, UserRole } from "@prisma/client";
import { requirePermission } from "../../middleware/permissions.js";
import logger from "../../lib/logger.js";
import { parseCRMReportProvider } from "../../services/provider-policy.js";

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

interface RegisterAccountReportingRoutesOptions {
  router: Router;
  prisma: PrismaClient;
}

export function registerAccountReportingRoutes({
  router,
  prisma,
}: RegisterAccountReportingRoutesOptions): void {
  // ── Account Search ─────────────────────────────────────────────────

  /**
   * GET /api/dashboard/accounts/search?q=...
   *
   * Searches accounts by name or domain within the org.
   */
  router.get(
    "/accounts/search",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const q = ((req.query.q as string) || "").trim();
      try {
        const accounts = await prisma.account.findMany({
          where: {
            organizationId: req.organizationId!,
            ...(q
              ? {
                  OR: [
                    { name: { contains: q, mode: "insensitive" as const } },
                    { domain: { contains: q, mode: "insensitive" as const } },
                  ],
                }
              : {}),
          },
          select: { id: true, name: true, domain: true, industry: true },
          orderBy: { name: "asc" },
          take: 50,
        });
        res.json({ accounts });
      } catch (err) {
        logger.error("Account search error", { error: err });
        res.status(500).json({ error: "Failed to search accounts" });
      }
    }
  );

  // ── CRM Reports ──────────────────────────────────────────────────

  /**
   * GET /api/dashboard/crm-reports?provider=SALESFORCE|HUBSPOT
   *
   * Lists available CRM reports/lists for the given provider.
   */
  router.get(
    "/crm-reports",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const provider = parseCRMReportProvider(req.query.provider);
      if (!provider) {
        res.status(400).json({ error: "Invalid provider. Use SALESFORCE or HUBSPOT." });
        return;
      }

      try {
        const accessRecords = await prisma.userAccountAccess.findMany({
          where: {
            organizationId: req.organizationId!,
            scopeType: "CRM_REPORT",
            crmProvider: provider as CRMProvider,
            crmReportId: { not: null },
          },
          select: { crmReportId: true, crmReportName: true, crmProvider: true },
          distinct: ["crmReportId"],
          orderBy: { crmReportName: "asc" },
        });
        res.json({
          reports: accessRecords.map(
            (r: { crmReportId: string | null; crmReportName: string | null; crmProvider: string | null }) => ({
              id: r.crmReportId,
              name: r.crmReportName,
              provider: r.crmProvider,
            })
          ),
        });
      } catch (err) {
        logger.error("CRM reports error", { error: err });
        res.status(500).json({ error: "Failed to load CRM reports" });
      }
    }
  );
}
