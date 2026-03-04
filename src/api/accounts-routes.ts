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

import { Router, type Response } from "express";
import { z } from "zod";
import type { PrismaClient, FunnelStage } from "@prisma/client";
import { AccountsListService } from "../services/accounts-list.js";
import logger from "../lib/logger.js";
import type { AuthenticatedRequest } from "../types/authenticated-request.js";
import { asyncHandler } from "../lib/async-handler.js";
import { sendUnauthorized, sendBadRequest, sendSuccess } from "./_shared/responses.js";

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
  router.get("/", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.organizationId! || !req.userId!) {
      sendUnauthorized(res, "Authentication required");
      return;
    }

    const parse = AccountListQuerySchema.safeParse(req.query);
    if (!parse.success) {
      sendBadRequest(res, "validation_error", parse.error.issues);
      return;
    }

      const result = await accountsService.listAccounts(
        req.organizationId!,
        req.userId!,
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

      sendSuccess(res, result);
    
  }));

  /**
   * GET /api/accounts/stages
   *
   * Returns the available funnel stages with their labels for the quick-filter bar.
   * This is a static endpoint — no auth scoping needed beyond org membership.
   */
  router.get("/stages", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.organizationId!) {
      sendUnauthorized(res, "Authentication required");
      return;
    }

    sendSuccess(res, {
      stages: [
        { value: "TOFU", label: "Top of Funnel" },
        { value: "MOFU", label: "Mid-Funnel" },
        { value: "BOFU", label: "Bottom of Funnel" },
        { value: "POST_SALE", label: "Post-Sale" },
        { value: "INTERNAL", label: "Internal" },
        { value: "VERTICAL", label: "Vertical" },
      ],
    });
  }));

  return router;
}
