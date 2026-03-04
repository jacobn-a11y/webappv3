/**
 * RAG API Routes
 *
 * Exposes the RAG engine as an HTTP API that third-party chatbots can query.
 * Supports both direct queries and streaming responses.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { AuthenticatedRequest } from "../types/authenticated-request.js";
import type { RAGEngine } from "../services/rag-engine.js";
import { AccountAccessService } from "../services/account-access.js";
import { sendSuccess, sendUnauthorized, sendBadRequest, sendError } from "./_shared/responses.js";
import { asyncHandler } from "../lib/async-handler.js";

// ─── Validation ──────────────────────────────────────────────────────────────

const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
});

const ChatSchema = z.object({
  query: z
    .string()
    .min(3, "Query must be at least 3 characters")
    .max(1000, "Query must be under 1000 characters"),
  account_id: z.string().min(1).nullable(),
  history: z.array(ChatMessageSchema).max(50).default([]),
  top_k: z.number().int().min(1).max(20).optional(),
  funnel_stages: z.array(z.string()).optional(),
});

const QuerySchema = z.object({
  query: z
    .string()
    .min(3, "Query must be at least 3 characters")
    .max(1000, "Query must be under 1000 characters"),
  account_id: z.string().min(1),
  // Optional for backwards compatibility; request org context comes from auth.
  organization_id: z.string().min(1).optional(),
  top_k: z.number().int().min(1).max(20).optional(),
  funnel_stages: z.array(z.string()).optional(),
});

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createRAGRoutes(ragEngine: RAGEngine, prisma: PrismaClient): Router {
  const router = Router();
  const accessService = new AccountAccessService(prisma);

  /**
   * POST /api/rag/query
   *
   * Query the RAG engine with a natural language question about an account.
   *
   * Request body:
   *   {
   *     "query": "How was the onboarding for Account X?",
   *     "account_id": "clx123...",
   *     "organization_id": "clx456...",
   *     "top_k": 8,                   // optional, default 8
   *     "funnel_stages": ["MOFU"]     // optional filter
   *   }
   *
   * Response:
   *   {
   *     "answer": "Based on the call transcripts...",
   *     "sources": [
   *       {
   *         "chunk_id": "...",
   *         "call_id": "...",
   *         "call_title": "Onboarding Kickoff",
   *         "call_date": "2024-03-15",
   *         "text": "...",
   *         "speaker": "John Smith",
   *         "relevance_score": 0.92
   *       }
   *     ],
   *     "tokens_used": 1234
   *   }
   */
  router.post(
    "/query",
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const orgId = req.organizationId!;
      if (!orgId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const parseResult = QuerySchema.safeParse(req.body);
      if (!parseResult.success) {
        sendBadRequest(res, "validation_error", parseResult.error.issues);
        return;
      }

      const { query, account_id, organization_id, top_k, funnel_stages } = parseResult.data;

      if (organization_id && organization_id !== orgId) {
        sendError(
          res,
          403,
          "organization_mismatch",
          "organization_id does not match the authenticated tenant."
        );
        return;
      }

      if (req.userId!) {
        const canAccessAccount = await accessService.canAccessAccount(
          req.userId!,
          orgId,
          account_id,
          req.userRole
        );
        if (!canAccessAccount) {
          sendError(res, 403, "permission_denied", "You do not have access to this account.");
          return;
        }
      }

      const result = await ragEngine.query({
        query,
        accountId: account_id,
        organizationId: orgId,
        topK: top_k,
        funnelStages: funnel_stages,
      });

      sendSuccess(res, {
        answer: result.answer,
        sources: result.sources.map((s) => ({
          chunk_id: s.chunkId,
          call_id: s.callId,
          call_title: s.callTitle,
          call_date: s.callDate,
          text: s.text,
          speaker: s.speaker,
          relevance_score: s.relevanceScore,
        })),
        tokens_used: result.tokensUsed,
      });
    })
  );

  /**
   * POST /api/rag/chat
   *
   * Conversation-aware chat endpoint. Carries message history so
   * follow-up questions are resolved with context.
   */
  router.post(
    "/chat",
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const orgId = req.organizationId!;
      if (!orgId) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const parseResult = ChatSchema.safeParse(req.body);
      if (!parseResult.success) {
        sendBadRequest(res, "validation_error", parseResult.error.issues);
        return;
      }

      const { query, account_id, history, top_k, funnel_stages } = parseResult.data;

      if (req.userId!) {
        const canAccessAccount = await accessService.canAccessAccount(
          req.userId!,
          orgId,
          account_id,
          req.userRole
        );
        if (!canAccessAccount) {
          sendError(res, 403, "permission_denied", "You do not have access to this account.");
          return;
        }
      }

      const result = await ragEngine.chat({
        query,
        accountId: account_id,
        organizationId: orgId,
        history,
        topK: top_k,
        funnelStages: funnel_stages,
      });

      sendSuccess(res, {
        answer: result.answer,
        sources: result.sources.map((s) => ({
          chunk_id: s.chunkId,
          call_id: s.callId,
          call_title: s.callTitle,
          call_date: s.callDate,
          text: s.text,
          speaker: s.speaker,
          relevance_score: s.relevanceScore,
        })),
        tokens_used: result.tokensUsed,
      });
    })
  );

  /**
   * GET /api/rag/accounts
   *
   * Returns accounts the current user has access to, for the account
   * context selector in the chat UI.
   * Query params: search (optional text filter)
   */
  router.get(
    "/accounts",
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const orgId = req.organizationId!;
      if (!orgId || !req.userId!) {
        sendUnauthorized(res, "Authentication required");
        return;
      }

      const accessibleIds = await accessService.getAccessibleAccountIds(
        req.userId!,
        orgId,
        req.userRole
      );

      const search = (req.query.search as string | undefined)?.trim();

      const where: Record<string, unknown> = { organizationId: orgId };
      if (accessibleIds !== null) {
        where.id = { in: accessibleIds };
      }
      if (search) {
        where.name = { contains: search, mode: "insensitive" };
      }

      const accounts = await prisma.account.findMany({
        where,
        select: {
          id: true,
          name: true,
          domain: true,
          industry: true,
          _count: { select: { calls: true } },
        },
        orderBy: { name: "asc" },
        take: 100,
      });

      sendSuccess(res, {
        accounts: accounts.map((a) => ({
          id: a.id,
          name: a.name,
          domain: a.domain,
          industry: a.industry,
          call_count: a._count.calls,
        })),
      });
    })
  );

  /**
   * GET /api/rag/health
   *
   * Health check for the RAG service.
   */
  router.get("/health", (_req: Request, res: Response) => {
    sendSuccess(res, { status: "ok", service: "rag-engine" });
  });

  return router;
}
