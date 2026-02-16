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

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { PrismaClient, UserRole } from "@prisma/client";
import { AccountMergeService } from "../services/account-merge.js";
import { requirePermission } from "../middleware/permissions.js";

// ─── Validation ──────────────────────────────────────────────────────────────

const MergePreviewSchema = z.object({
  primary_account_id: z.string().min(1),
  secondary_account_id: z.string().min(1),
});

const ExecuteMergeSchema = z.object({
  primary_account_id: z.string().min(1),
  secondary_account_id: z.string().min(1),
});

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

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
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      try {
        const candidates = await mergeService.findDuplicates(
          req.organizationId
        );

        res.json({
          duplicates: candidates.map((c) => ({
            account_a: c.accountA,
            account_b: c.accountB,
            similarity: c.similarity,
            match_reason: c.matchReason,
          })),
          total: candidates.length,
        });
      } catch (err) {
        console.error("Find duplicates error:", err);
        res.status(500).json({ error: "Failed to scan for duplicate accounts" });
      }
    }
  );

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
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const parse = MergePreviewSchema.safeParse({
        primary_account_id: req.query.primary_account_id,
        secondary_account_id: req.query.secondary_account_id,
      });

      if (!parse.success) {
        res.status(400).json({
          error: "validation_error",
          message: "Both primary_account_id and secondary_account_id query params are required",
          details: parse.error.issues,
        });
        return;
      }

      if (parse.data.primary_account_id === parse.data.secondary_account_id) {
        res.status(400).json({
          error: "validation_error",
          message: "Primary and secondary accounts must be different",
        });
        return;
      }

      try {
        const preview = await mergeService.previewMerge(
          req.organizationId,
          parse.data.primary_account_id,
          parse.data.secondary_account_id
        );

        res.json({
          primary: formatAccountPreview(preview.primary),
          secondary: formatAccountPreview(preview.secondary),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        if (message.includes("not found")) {
          res.status(404).json({ error: "account_not_found", message });
          return;
        }
        console.error("Merge preview error:", err);
        res.status(500).json({ error: "Failed to load merge preview" });
      }
    }
  );

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
    "/merge",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      if (!req.organizationId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const parse = ExecuteMergeSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({
          error: "validation_error",
          details: parse.error.issues,
        });
        return;
      }

      if (parse.data.primary_account_id === parse.data.secondary_account_id) {
        res.status(400).json({
          error: "validation_error",
          message: "Cannot merge an account with itself",
        });
        return;
      }

      try {
        const result = await mergeService.executeMerge(
          req.organizationId,
          parse.data.primary_account_id,
          parse.data.secondary_account_id
        );

        res.json({
          merged: true,
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
          res.status(404).json({ error: "account_not_found", message });
          return;
        }
        console.error("Merge execution error:", err);
        res.status(500).json({ error: "Failed to merge accounts" });
      }
    }
  );

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
