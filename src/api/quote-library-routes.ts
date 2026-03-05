import { Router, type Response } from "express";
import type { PrismaClient, QuoteTier } from "@prisma/client";
import type { AuthenticatedRequest } from "../types/authenticated-request.js";
import type { AccountAccessService } from "../services/account-access.js";
import type { RoleProfileService } from "../services/role-profiles.js";
import { QuoteLibraryService } from "../services/quote-library.js";
import { CompanyScrubber } from "../services/company-scrubber.js";
import { maskPII } from "../middleware/pii-masker.js";
import { asyncHandler } from "../lib/async-handler.js";
import {
  sendBadRequest,
  sendForbidden,
  sendNotFound,
  sendSuccess,
  sendUnauthorized,
} from "./_shared/responses.js";
import {
  AttributionSchema,
  CurationSchema,
  QuoteListQuerySchema,
  SaveQuoteFromTranscriptSchema,
} from "./quote-library-schemas.js";

export function createQuoteLibraryRoutes(
  prisma: PrismaClient,
  accessService: AccountAccessService,
  roleProfiles: RoleProfileService
): Router {
  const router = Router();
  const quotes = new QuoteLibraryService(prisma);
  const scrubber = new CompanyScrubber(prisma);

  const canViewRawTranscripts = async (
    req: AuthenticatedRequest
  ): Promise<boolean> => {
    if (!req.organizationId! || !req.userId!) return false;
    if (req.userRole === "OWNER" || req.userRole === "ADMIN") return true;

    const rolePolicy = await roleProfiles.getEffectivePolicy(
      req.organizationId!,
      req.userId!,
      req.userRole
    );
    if (rolePolicy.permissions.includes("VIEW_RAW_TRANSCRIPTS")) {
      return true;
    }

    const explicit = await prisma.userPermission.findUnique({
      where: {
        userId_permission: {
          userId: req.userId!,
          permission: "VIEW_RAW_TRANSCRIPTS",
        },
      },
    });
    return !!explicit;
  };

  const normalizeDate = (value?: string): Date | undefined => {
    if (!value) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return parsed;
  };

  router.get(
    "/quotes",
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const parse = QuoteListQuerySchema.safeParse(req.query);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }
      if (!req.organizationId! || !req.userId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const accessibleIds = await accessService.getAccessibleAccountIds(
        req.userId!,
        req.organizationId!,
        req.userRole
      );
      if (accessibleIds !== null && accessibleIds.length === 0) {
        sendSuccess(res, { quotes: [] });
        return;
      }

      if (
        parse.data.account_id &&
        accessibleIds !== null &&
        !accessibleIds.includes(parse.data.account_id)
      ) {
        sendForbidden(res, "permission_denied");
        return;
      }

      const [attributionDisplay, rawAllowed, rows] = await Promise.all([
        quotes.getAttributionDisplay(req.organizationId!, req.userId!),
        canViewRawTranscripts(req),
        quotes.listQuotes({
          organizationId: req.organizationId!,
          userId: req.userId!,
          accessibleAccountIds: accessibleIds,
          search: parse.data.q,
          accountId: parse.data.account_id,
          tier: parse.data.tier,
          dateFrom: normalizeDate(parse.data.date_from),
          dateTo: normalizeDate(parse.data.date_to),
          starredOnly: parse.data.starred === "true",
          limit: parse.data.limit,
          offset: parse.data.offset,
        }),
      ]);

      sendSuccess(res, {
        attribution_display: attributionDisplay,
        quotes: rows.map((row) => {
          const sourceViaProxy =
            attributionDisplay === "OBFUSCATED" || !rawAllowed;
          const canViewSource = !!row.sourceChunkId;
          return {
            id: row.id,
            tier: row.tier,
            quote_text: row.quoteText,
            confidence_score: row.confidenceScore,
            created_at: row.createdAt.toISOString(),
            curated_at: row.curatedAt?.toISOString() ?? null,
            curation_note: row.curationNote,
            account: sourceViaProxy
              ? null
              : {
                  id: row.account.id,
                  name: row.account.name,
                },
            call: sourceViaProxy
              ? null
              : {
                  id: row.call.id,
                  title: row.call.title,
                  occurred_at: row.call.occurredAt.toISOString(),
                },
            is_starred: row.isStarred,
            curated_by:
              attributionDisplay === "OBFUSCATED"
                ? null
                : row.curatedBy
                  ? {
                      id: row.curatedBy.id,
                      name: row.curatedBy.name,
                      email: row.curatedBy.email,
                    }
                  : null,
            source: {
              available: canViewSource,
              mode:
                sourceViaProxy || attributionDisplay === "HIDDEN"
                  ? "PROXY"
                  : "RAW",
              url: canViewSource
                ? sourceViaProxy || attributionDisplay === "HIDDEN"
                  ? `/quotes/source/${row.id}`
                  : `/calls/${row.callId}/transcript?chunk=${encodeURIComponent(row.sourceChunkId)}`
                : null,
            },
          };
        }),
      });
    })
  );

  router.get(
    "/quotes/settings/attribution",
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId! || !req.userId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }
      const display = await quotes.getAttributionDisplay(
        req.organizationId!,
        req.userId!
      );
      sendSuccess(res, { display });
    })
  );

  router.put(
    "/quotes/settings/attribution",
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const parse = AttributionSchema.safeParse(req.body);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }
      if (!req.organizationId! || !req.userId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      await quotes.setAttributionDisplay(
        req.organizationId!,
        req.userId!,
        parse.data.display
      );
      sendSuccess(res, { saved: true, display: parse.data.display });
    })
  );

  router.post(
    "/quotes/from-transcript",
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const parse = SaveQuoteFromTranscriptSchema.safeParse(req.body);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }
      if (!req.organizationId! || !req.userId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const call = await prisma.call.findFirst({
        where: {
          id: parse.data.call_id,
          organizationId: req.organizationId!,
        },
        select: {
          id: true,
          accountId: true,
        },
      });
      if (!call?.accountId) {
        sendNotFound(res, "Call not found");
        return;
      }

      const allowed = await accessService.canAccessAccount(
        req.userId!,
        req.organizationId!,
        call.accountId,
        req.userRole
      );
      if (!allowed) {
        sendForbidden(res, "permission_denied");
        return;
      }

      const quote = await quotes.createCuratedFromTranscript({
        organizationId: req.organizationId!,
        userId: req.userId!,
        callId: parse.data.call_id,
        sourceChunkId: parse.data.source_chunk_id,
        quoteText: parse.data.quote_text,
        curationNote: parse.data.curation_note,
      });

      sendSuccess(res, {
        id: quote.id,
        tier: quote.tier,
      });
    })
  );

  router.post(
    "/quotes/:id/promote",
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const parse = CurationSchema.safeParse(req.body);
      if (!parse.success) {
        sendBadRequest(res, "validation_error", parse.error.issues);
        return;
      }
      if (!req.organizationId! || !req.userId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const updated = await quotes.updateTier({
        organizationId: req.organizationId!,
        userId: req.userId!,
        quoteId: req.params.id as string,
        nextTier: "CURATED",
        curationNote: parse.data.curation_note,
      });

      sendSuccess(res, { id: updated.id, tier: updated.tier });
    })
  );

  router.post(
    "/quotes/:id/demote",
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId! || !req.userId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const rolePolicy = await roleProfiles.getEffectivePolicy(
        req.organizationId!,
        req.userId!,
        req.userRole
      );

      const current = await prisma.quote.findFirst({
        where: {
          id: req.params.id as string,
          organizationId: req.organizationId!,
        },
        select: {
          id: true,
          tier: true,
          curatedByUserId: true,
          accountId: true,
        },
      });

      if (!current) {
        sendNotFound(res, "Quote not found");
        return;
      }

      const canManage =
        req.userRole === "OWNER" ||
        req.userRole === "ADMIN" ||
        rolePolicy.permissions.includes("MANAGE_PERMISSIONS");
      const canDemote = canManage || current.curatedByUserId === req.userId!;
      if (!canDemote) {
        sendForbidden(res, "permission_denied");
        return;
      }

      if (
        current.accountId &&
        !(await accessService.canAccessAccount(
          req.userId!,
          req.organizationId!,
          current.accountId,
          req.userRole
        ))
      ) {
        sendForbidden(res, "permission_denied");
        return;
      }

      const updated = await quotes.updateTier({
        organizationId: req.organizationId!,
        userId: req.userId!,
        quoteId: current.id,
        nextTier: "AUTO",
      });
      sendSuccess(res, { id: updated.id, tier: updated.tier });
    })
  );

  router.post(
    "/quotes/:id/star",
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId! || !req.userId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }
      await quotes.setStar({
        organizationId: req.organizationId!,
        userId: req.userId!,
        quoteId: req.params.id as string,
        starred: true,
      });
      sendSuccess(res, { starred: true });
    })
  );

  router.delete(
    "/quotes/:id/star",
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId! || !req.userId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }
      await quotes.setStar({
        organizationId: req.organizationId!,
        userId: req.userId!,
        quoteId: req.params.id as string,
        starred: false,
      });
      sendSuccess(res, { starred: false });
    })
  );

  router.get(
    "/quotes/:id/source-segment",
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      if (!req.organizationId! || !req.userId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const quote = await prisma.quote.findFirst({
        where: {
          id: req.params.id as string,
          organizationId: req.organizationId!,
        },
        include: {
          call: {
            select: {
              id: true,
              accountId: true,
              title: true,
              occurredAt: true,
            },
          },
        },
      });
      if (!quote) {
        sendNotFound(res, "Quote not found");
        return;
      }

      const hasAccess = await accessService.canAccessAccount(
        req.userId!,
        req.organizationId!,
        quote.accountId,
        req.userRole
      );
      if (!hasAccess) {
        sendForbidden(res, "permission_denied");
        return;
      }

      const [attributionDisplay, rawAllowed, chunk] = await Promise.all([
        quotes.getAttributionDisplay(req.organizationId!, req.userId!),
        canViewRawTranscripts(req),
        prisma.transcriptChunk.findFirst({
          where: {
            id: quote.sourceChunkId,
            transcript: {
              callId: quote.callId,
            },
          },
          select: {
            id: true,
            text: true,
            startMs: true,
            endMs: true,
          },
        }),
      ]);

      if (!chunk) {
        sendNotFound(res, "Source segment unavailable");
        return;
      }

      let text = chunk.text;
      let mode: "RAW" | "SCRUBBED" = "RAW";
      const restrictedAttribution =
        !rawAllowed || attributionDisplay === "OBFUSCATED";
      if (restrictedAttribution) {
        const piiMasked = maskPII(chunk.text).maskedText;
        const scrubbed = await scrubber.scrubForAccount(quote.accountId, piiMasked);
        text = scrubbed.scrubbedText;
        mode = "SCRUBBED";
      }

      sendSuccess(res, {
        quote_id: quote.id,
        mode,
        call: rawAllowed && attributionDisplay !== "OBFUSCATED"
          ? {
              id: quote.call.id,
              title: quote.call.title,
              occurred_at: quote.call.occurredAt.toISOString(),
            }
          : null,
        source: {
          chunk_id: restrictedAttribution ? null : chunk.id,
          start_ms: restrictedAttribution ? null : chunk.startMs,
          end_ms: restrictedAttribution ? null : chunk.endMs,
          text,
        },
        transcript_url:
          rawAllowed && attributionDisplay !== "HIDDEN" && attributionDisplay !== "OBFUSCATED"
            ? `/calls/${quote.call.id}/transcript?chunk=${encodeURIComponent(chunk.id)}`
            : null,
      });
    })
  );

  return router;
}
