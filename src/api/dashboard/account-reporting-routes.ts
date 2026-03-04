import { type Response, type Router } from "express";
import type { CRMProvider, PrismaClient } from "@prisma/client";
import { requirePermission } from "../../middleware/permissions.js";
import { parseCRMReportProvider } from "../../services/provider-policy.js";
import type { AuthenticatedRequest } from "../../types/authenticated-request.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { sendSuccess, sendError } from "../_shared/responses.js";

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
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const q = ((req.query.q as string) || "").trim();

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
      sendSuccess(res, { accounts });
    })
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
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const provider = parseCRMReportProvider(req.query.provider);
      if (!provider) {
        sendError(res, 400, "Invalid provider. Use SALESFORCE or HUBSPOT.");
        return;
      }

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
      sendSuccess(res, {
        reports: accessRecords.map(
          (r: {
            crmReportId: string | null;
            crmReportName: string | null;
            crmProvider: string | null;
          }) => ({
            id: r.crmReportId,
            name: r.crmReportName,
            provider: r.crmProvider,
          })
        ),
      });
    })
  );
}
