/**
 * Accounts List Routes
 *
 * Provides a searchable, filterable, paginated list of CRM accounts with
 * aggregated metrics. Respects UserAccountAccess scoping — non-admin users
 * only see accounts they have been granted access to.
 *
 * Endpoints:
 *   GET /api/accounts          — Paginated account list with filters
 *   GET /api/accounts/stages   — Available funnel stages for the filter bar
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { PrismaClient, UserRole, FunnelStage } from "@prisma/client";
import { AccountsListService } from "../services/accounts-list.js";

// ─── Validation ──────────────────────────────────────────────────────────────

const FUNNEL_STAGES: [string, ...string[]] = [
  "TOFU",
  "MOFU",
  "BOFU",
  "POST_SALE",
  "INTERNAL",
  "VERTICAL",
];

const SORT_FIELDS: [string, ...string[]] = [
  "name",
  "domain",
  "totalCalls",
  "lastCallDate",
  "storyCount",
  "landingPageCount",
  "createdAt",
];

const AccountListQuerySchema = z.object({
  search: z.string().max(200).optional(),
  funnel_stage: z.enum(FUNNEL_STAGES).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sort_by: z.enum(SORT_FIELDS).optional(),
  sort_order: z.enum(["asc", "desc"]).optional(),
});

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createAccountsRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const accountsService = new AccountsListService(prisma);

  /**
   * GET /api/accounts
   *
   * Returns a paginated, filterable list of CRM accounts with metrics.
   *
   * Query params:
   *   search       — Filter by account name or domain (case-insensitive)
   *   funnel_stage — Filter to accounts with calls tagged in this stage
   *   page         — Page number (default: 1)
   *   limit        — Results per page (default: 25, max: 100)
   *   sort_by      — Sort column (default: name)
   *   sort_order   — asc or desc (default: asc)
   *
   * Response:
   *   {
   *     accounts: AccountListItem[],
   *     pagination: { page, limit, totalCount, totalPages }
   *   }
   *
   * Access:
   *   OWNER/ADMIN see all org accounts.
   *   MEMBER/VIEWER see only accounts they've been granted access to.
   */
  router.get("/", async (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const parse = AccountListQuerySchema.safeParse(req.query);
    if (!parse.success) {
      res
        .status(400)
        .json({ error: "validation_error", details: parse.error.issues });
      return;
    }

    try {
      const result = await accountsService.listAccounts(
        req.organizationId,
        req.userId,
        req.userRole,
        {
          search: parse.data.search,
          funnelStage: parse.data.funnel_stage as FunnelStage | undefined,
          page: parse.data.page,
          limit: parse.data.limit,
          sortBy: parse.data.sort_by as
            | "name"
            | "domain"
            | "totalCalls"
            | "lastCallDate"
            | "storyCount"
            | "landingPageCount"
            | "createdAt"
            | undefined,
          sortOrder: parse.data.sort_order,
        }
      );

      res.json(result);
    } catch (err) {
      console.error("Accounts list error:", err);
      res.status(500).json({ error: "Failed to load accounts" });
    }
  });

  /**
   * GET /api/accounts/stages
   *
   * Returns the available funnel stages with their labels for the quick-filter bar.
   * This is a static endpoint — no auth scoping needed beyond org membership.
   */
  router.get("/stages", async (req: AuthReq, res: Response) => {
    if (!req.organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    res.json({
      stages: [
        { value: "TOFU", label: "Top of Funnel" },
        { value: "MOFU", label: "Mid-Funnel" },
        { value: "BOFU", label: "Bottom of Funnel" },
        { value: "POST_SALE", label: "Post-Sale" },
        { value: "INTERNAL", label: "Internal" },
        { value: "VERTICAL", label: "Vertical" },
      ],
    });
  });

  return router;
}
