/**
 * Entity Resolution Review Queue Routes
 *
 * Provides the API for the manual review queue where admins resolve
 * unmatched or low-confidence call-to-account matches.
 *
 * Endpoints:
 *   GET    /api/entity-resolution/queue       — List unresolved calls
 *   GET    /api/entity-resolution/stats       — Queue summary stats
 *   GET    /api/entity-resolution/accounts    — Search accounts (for dropdown)
 *   POST   /api/entity-resolution/resolve     — Assign call to account
 *   POST   /api/entity-resolution/bulk-resolve — Assign multiple calls to account
 *   POST   /api/entity-resolution/dismiss     — Dismiss calls from queue
 *   POST   /api/entity-resolution/create-account — Create account from call
 *   POST   /api/entity-resolution/merge       — Merge two accounts
 */

import { Router, type Response } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { AuthenticatedRequest } from "../types/authenticated-request.js";
import { EntityResolutionQueueService } from "../services/entity-resolution-queue.js";
import { parseBoundedLimit, PAGINATION_LIMITS } from "../lib/pagination.js";
import { requirePermission } from "../middleware/permissions.js";
import logger from "../lib/logger.js";
import { asyncHandler } from "../lib/async-handler.js";
import { sendSuccess, sendBadRequest, sendUnauthorized } from "./_shared/responses.js";

// ─── Validation ──────────────────────────────────────────────────────────────

const ResolveCallSchema = z.object({
  call_id: z.string().min(1),
  account_id: z.string().min(1),
});

const BulkResolveSchema = z.object({
  call_ids: z.array(z.string().min(1)).min(1).max(100),
  account_id: z.string().min(1),
});

const DismissCallsSchema = z.object({
  call_ids: z.array(z.string().min(1)).min(1).max(100),
});

const CreateAccountFromCallSchema = z.object({
  call_id: z.string().min(1),
  account_name: z.string().min(1).max(255),
  domain: z.string().optional(),
});

const MergeAccountsSchema = z.object({
  source_account_id: z.string().min(1),
  target_account_id: z.string().min(1),
});

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createEntityResolutionRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const queueService = new EntityResolutionQueueService(prisma);

  const resolvePermission = requirePermission(prisma, "manage_entity_resolution");

  // ── Queue Listing ──────────────────────────────────────────────────

  /**
   * GET /api/entity-resolution/queue
   *
   * Returns paginated list of calls needing entity resolution review.
   * Includes participants, suggested matches, and confidence scores.
   *
   * Query params:
   *   page      — Page number (default: 1)
   *   page_size — Items per page (default: 25, max: 100)
   *   search    — Search by call title
   *   sort_by   — Sort field: "occurredAt" | "matchConfidence"
   *   sort_order — "asc" | "desc" (default: "desc")
   */
  router.get(
    "/queue",
    resolvePermission,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

        const result = await queueService.listQueue(req.organizationId, {
          page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
          pageSize: req.query.page_size ? parseInt(req.query.page_size as string, 10) : undefined,
          search: req.query.search as string | undefined,
          sortBy: req.query.sort_by as "occurredAt" | "matchConfidence" | undefined,
          sortOrder: req.query.sort_order as "asc" | "desc" | undefined,
        });

        sendSuccess(res, result);
      
    }
  ));

  // ── Queue Stats ────────────────────────────────────────────────────

  /**
   * GET /api/entity-resolution/stats
   *
   * Returns summary statistics for the resolution queue.
   */
  router.get(
    "/stats",
    resolvePermission,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

        const stats = await queueService.getQueueStats(req.organizationId);
        sendSuccess(res, stats);
      
    }
  ));

  // ── Account Search (for Assign dropdown) ───────────────────────────

  /**
   * GET /api/entity-resolution/accounts
   *
   * Searches accounts by name or domain for the "Assign to Account" dropdown.
   * Query params: q (search query), limit (max results, default: 20)
   */
  router.get(
    "/accounts",
    resolvePermission,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

        const query = (req.query.q as string) ?? "";
        const limit = parseBoundedLimit(req.query.limit, {
          fallback: PAGINATION_LIMITS.SEARCH_DEFAULT,
          max: PAGINATION_LIMITS.SEARCH_MAX,
        });

        const accounts = await queueService.searchAccounts(
          req.organizationId,
          query,
          limit
        );

        sendSuccess(res, { accounts });
      
    }
  ));

  // ── Manual Resolution ──────────────────────────────────────────────

  /**
   * POST /api/entity-resolution/resolve
   *
   * Manually assigns a call to an account. Also:
   *   - Creates domain aliases from participant emails for future auto-resolution
   *   - Upserts contacts for participants with emails
   */
  router.post(
    "/resolve",
    resolvePermission,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const parse = ResolveCallSchema.safeParse(req.body);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }

      try {
        await queueService.resolveCall(
          parse.data.call_id,
          parse.data.account_id,
          req.organizationId
        );

        sendSuccess(res, { resolved: true, call_id: parse.data.call_id, account_id: parse.data.account_id });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to resolve call";
        logger.error("Resolve call error", { error: err });
        sendBadRequest(res, message);
      }
    }
  ));

  // ── Bulk Resolution ────────────────────────────────────────────────

  /**
   * POST /api/entity-resolution/bulk-resolve
   *
   * Assigns multiple calls to a single account.
   */
  router.post(
    "/bulk-resolve",
    resolvePermission,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const parse = BulkResolveSchema.safeParse(req.body);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }

        const result = await queueService.bulkResolve(
          parse.data.call_ids,
          parse.data.account_id,
          req.organizationId
        );

        sendSuccess(res, result);
      
    }
  ));

  // ── Dismiss ────────────────────────────────────────────────────────

  /**
   * POST /api/entity-resolution/dismiss
   *
   * Dismisses calls from the review queue without resolving them.
   * Dismissed calls won't appear in the queue but remain unresolved.
   */
  router.post(
    "/dismiss",
    resolvePermission,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const parse = DismissCallsSchema.safeParse(req.body);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }

        const result = await queueService.dismissCalls(
          parse.data.call_ids,
          req.organizationId
        );

        sendSuccess(res, result);
      
    }
  ));

  // ── Create Account from Call ───────────────────────────────────────

  /**
   * POST /api/entity-resolution/create-account
   *
   * Creates a new CRM account from call participant data and resolves
   * the call to the new account.
   */
  router.post(
    "/create-account",
    resolvePermission,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const parse = CreateAccountFromCallSchema.safeParse(req.body);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }

      try {
        const result = await queueService.createAccountFromCall(
          parse.data.call_id,
          req.organizationId,
          {
            name: parse.data.account_name,
            domain: parse.data.domain,
          }
        );

        sendSuccess(res, { created: true, ...result });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create account";
        logger.error("Create account from call error", { error: err });
        sendBadRequest(res, message);
      }
    }
  ));

  // ── Merge Accounts ─────────────────────────────────────────────────

  /**
   * POST /api/entity-resolution/merge
   *
   * Merges source account into target account. Moves all related data
   * (calls, contacts, domain aliases, stories, events) to the target
   * and deletes the source.
   */
  router.post(
    "/merge",
    resolvePermission,
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const parse = MergeAccountsSchema.safeParse(req.body);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }

      try {
        await queueService.mergeAccounts(
          parse.data.source_account_id,
          parse.data.target_account_id,
          req.organizationId
        );

        sendSuccess(res, {
          merged: true,
          source_account_id: parse.data.source_account_id,
          target_account_id: parse.data.target_account_id,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to merge accounts";
        logger.error("Merge accounts error", { error: err });
        sendBadRequest(res, message);
      }
    }
  ));

  return router;
}
