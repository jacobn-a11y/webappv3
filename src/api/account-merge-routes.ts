/**
 * Account Merge Routes
 *
 * Provides the API surface for the Account Merge tool:
 *
 *   GET  /api/accounts/duplicates           — list potential duplicate pairs
 *   GET  /api/accounts/merge/preview        — side-by-side comparison of two accounts
 *   POST /api/accounts/merge                — execute the merge
 *
 * All endpoints require MANAGE_PERMISSIONS (admin-only) since merging is
 * a destructive, org-wide operation.
 */

import { Router, type Response } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { AuthenticatedRequest } from "../types/authenticated-request.js";
import { AccountMergeService } from "../services/account-merge.js";
import { requirePermission } from "../middleware/permissions.js";
import logger from "../lib/logger.js";
import { asyncHandler } from "../lib/async-handler.js";
import { sendSuccess, sendBadRequest, sendUnauthorized, sendNotFound, sendConflict, sendError } from "./_shared/responses.js";

// ─── Validation ──────────────────────────────────────────────────────────────

const MergePreviewSchema = z.object({
  primary_account_id: z.string().min(1),
  secondary_account_id: z.string().min(1),
});

const ExecuteMergeSchema = z.object({
  primary_account_id: z.string().min(1),
  secondary_account_id: z.string().min(1),
  notes: z.string().max(1000).optional(),
});

const ReviewMergeRequestSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  notes: z.string().max(1000).optional(),
});

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createAccountMergeRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const mergeService = new AccountMergeService(prisma);

  /**
   * GET /api/accounts/duplicates
   *
   * Scans the organization's accounts for potential duplicates using
   * normalized-name fuzzy matching and overlapping email domains.
   *
   * Returns an array of candidate pairs sorted by similarity (highest first).
   */
  router.get(
    "/duplicates",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

        const candidates = await mergeService.findDuplicates(
          req.organizationId
        );

        sendSuccess(res, {
          duplicates: candidates.map((c) => ({
            account_a: c.accountA,
            account_b: c.accountB,
            similarity: c.similarity,
            match_reason: c.matchReason,
          })),
          total: candidates.length,
        });
      
    }
  ));

  /**
   * GET /api/accounts/merge/preview?primary_account_id=...&secondary_account_id=...
   *
   * Returns a side-by-side preview of both accounts with their child records:
   * contacts, calls, stories, and landing pages.
   *
   * The user selects which account becomes the primary (surviving) record
   * before proceeding to merge.
   */
  router.get(
    "/merge/preview",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const parse = MergePreviewSchema.safeParse({
        primary_account_id: req.query.primary_account_id,
        secondary_account_id: req.query.secondary_account_id,
      });

      if (!parse.success) {
        sendBadRequest(res, "Both primary_account_id and secondary_account_id query params are required", parse.error.issues);
        return;
      }

      if (parse.data.primary_account_id === parse.data.secondary_account_id) {
        sendBadRequest(res, "Primary and secondary accounts must be different");
        return;
      }

      try {
        const preview = await mergeService.previewMerge(
          req.organizationId,
          parse.data.primary_account_id,
          parse.data.secondary_account_id
        );

        sendSuccess(res, {
          primary: formatAccountPreview(preview.primary),
          secondary: formatAccountPreview(preview.secondary),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        if (message.includes("not found")) {
          sendNotFound(res, message);
          return;
        }
        logger.error("Merge preview error", { error: err });
        sendError(res, 500, "internal_error", "Failed to load merge preview");
      }
    }
  ));

  /**
   * POST /api/accounts/merge
   *
   * Executes the merge operation:
   *   - All child records (contacts, calls, stories) move to the primary
   *   - Secondary's domain becomes a domain alias on the primary
   *   - CRM identifiers are preserved where the primary lacks them
   *   - The secondary account is deleted
   *
   * This operation is atomic (wrapped in a database transaction).
   */
  router.post(
    "/merge/request",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId || !req.userId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const parse = ExecuteMergeSchema.safeParse(req.body);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }
      if (parse.data.primary_account_id === parse.data.secondary_account_id) {
        sendBadRequest(res, "Cannot merge an account with itself");
        return;
      }

      try {
        const preview = await mergeService.previewMerge(
          req.organizationId,
          parse.data.primary_account_id,
          parse.data.secondary_account_id
        );

        const request = await mergeService.createMergeRequest(
          req.organizationId,
          parse.data.primary_account_id,
          parse.data.secondary_account_id,
          req.userId,
          parse.data.notes ?? null,
          preview
        );

        res.status(202).json({
          queued_for_approval: true,
          request_id: request.id,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        if (message.includes("not found")) {
          sendNotFound(res, message);
          return;
        }
        logger.error("Merge request error", { error: err });
        sendError(res, 500, "internal_error", "Failed to create merge approval request");
      }
    }
  ));

  router.get(
    "/merge/requests",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }
      const status = typeof req.query.status === "string" ? req.query.status : "PENDING";

      const rows = await mergeService.listMergeRequests(
      req.organizationId,
      status
      );
      sendSuccess(res, {
      requests: rows.map((r) => ({
        id: r.id,
        status: r.status,
        target_id: r.targetId,
        request_payload: r.requestPayload,
        requested_by: r.requestedBy,
        reviewer: r.reviewer,
        created_at: r.createdAt.toISOString(),
        reviewed_at: r.reviewedAt?.toISOString() ?? null,
      })),
      });
      
    }
  ));

  router.post(
    "/merge/requests/:requestId/review",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId || !req.userId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const parse = ReviewMergeRequestSchema.safeParse(req.body);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }

      try {
        const request = await mergeService.findMergeRequest(
          req.params.requestId as string,
          req.organizationId
        );
        if (!request) {
          sendNotFound(res, "Merge request not found");
          return;
        }
        if (request.status !== "PENDING") {
          sendConflict(res, "Merge request is already finalized");
          return;
        }

        if (parse.data.decision === "REJECT") {
          await mergeService.rejectMergeRequest(
            request.id,
            req.userId,
            parse.data.notes ?? null
          );
          sendSuccess(res, { status: "REJECTED" });
          return;
        }

        const payload =
          request.requestPayload && typeof request.requestPayload === "object"
            ? (request.requestPayload as unknown as {
                primary_account_id: string;
                secondary_account_id: string;
                notes?: string | null;
              })
            : null;
        if (!payload) {
          sendBadRequest(res, "request_payload_invalid");
          return;
        }

        const result = await mergeService.executeMerge(
          req.organizationId,
          payload.primary_account_id,
          payload.secondary_account_id,
          request.requestedByUserId,
          payload.notes ?? undefined
        );

        await mergeService.approveMergeRequest(
          request.id,
          req.userId,
          parse.data.notes ?? null
        );

        sendSuccess(res, {
          status: "APPROVED",
          merged: true,
          merge_run_id: result.mergeRunId,
          primary_account_id: result.primaryAccountId,
          deleted_account_id: result.deletedAccountId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        if (message.includes("not found")) {
          sendNotFound(res, message);
          return;
        }
        logger.error("Review merge request error", { error: err });
        sendError(res, 500, "internal_error", "Failed to review merge request");
      }
    }
  ));

  router.post(
    "/merge",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const parse = ExecuteMergeSchema.safeParse(req.body);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }

      if (parse.data.primary_account_id === parse.data.secondary_account_id) {
        sendBadRequest(res, "Cannot merge an account with itself");
        return;
      }

      try {
        const result = await mergeService.executeMerge(
          req.organizationId,
          parse.data.primary_account_id,
          parse.data.secondary_account_id,
          req.userId,
          parse.data.notes
        );

        sendSuccess(res, {
          merged: true,
          merge_run_id: result.mergeRunId,
          primary_account_id: result.primaryAccountId,
          deleted_account_id: result.deletedAccountId,
          records_moved: {
            contacts: result.contactsMoved,
            calls: result.callsMoved,
            stories: result.storiesMoved,
            landing_pages: result.landingPagesMoved,
          },
          domain_aliases_added: result.domainAliasesAdded,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        if (message.includes("not found")) {
          sendNotFound(res, message);
          return;
        }
        logger.error("Merge execution error", { error: err });
        sendError(res, 500, "internal_error", "Failed to merge accounts");
      }
    }
  ));

  router.get(
    "/merge/runs",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const runs = await mergeService.listMergeRuns(req.organizationId);
      sendSuccess(res, {
      runs: runs.map((run) => ({
        id: run.id,
        primary_account_id: run.primaryAccountId,
        secondary_account_id: run.secondaryAccountId,
        status: run.status,
        created_at: run.createdAt.toISOString(),
        undone_at: run.undoneAt?.toISOString() ?? null,
        moved_counts: {
          contacts: run.movedCounts.contacts,
          calls: run.movedCounts.calls,
          stories: run.movedCounts.stories,
          landing_pages: run.movedCounts.landingPages,
        },
      })),
      });
      
    }
  ));

  router.post(
    "/merge/runs/:runId/undo",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }
      try {
        const result = await mergeService.undoMerge(
          req.organizationId,
          req.params.runId as string,
          req.userId
        );
        sendSuccess(res, {
          undone: true,
          merge_run_id: result.mergeRunId,
          restored_secondary_account_id: result.restoredSecondaryAccountId,
          restored_records: {
            contacts: result.restoredContacts,
            calls: result.restoredCalls,
            stories: result.restoredStories,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        if (message.includes("not found")) {
          sendNotFound(res, message);
          return;
        }
        logger.error("Undo merge run error", { error: err });
        sendError(res, 500, "internal_error", "Failed to undo merge run");
      }
    }
  ));

  return router;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatAccountPreview(preview: {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
  annualRevenue: number | null;
  domainAliases: string[];
  contactCount: number;
  callCount: number;
  storyCount: number;
  landingPageCount: number;
  contacts: Array<{ id: string; name: string | null; email: string; title: string | null }>;
  calls: Array<{ id: string; title: string | null; provider: string; occurredAt: Date; duration: number | null }>;
  stories: Array<{ id: string; title: string; storyType: string; generatedAt: Date }>;
  landingPages: Array<{ id: string; title: string; slug: string; status: string }>;
}) {
  return {
    id: preview.id,
    name: preview.name,
    domain: preview.domain,
    industry: preview.industry,
    employee_count: preview.employeeCount,
    annual_revenue: preview.annualRevenue,
    domain_aliases: preview.domainAliases,
    summary: {
      contacts: preview.contactCount,
      calls: preview.callCount,
      stories: preview.storyCount,
      landing_pages: preview.landingPageCount,
    },
    contacts: preview.contacts.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      title: c.title,
    })),
    calls: preview.calls.map((c) => ({
      id: c.id,
      title: c.title,
      provider: c.provider,
      occurred_at: c.occurredAt,
      duration: c.duration,
    })),
    stories: preview.stories.map((s) => ({
      id: s.id,
      title: s.title,
      story_type: s.storyType,
      generated_at: s.generatedAt,
    })),
    landing_pages: preview.landingPages.map((p) => ({
      id: p.id,
      title: p.title,
      slug: p.slug,
      status: p.status,
    })),
  };
}
