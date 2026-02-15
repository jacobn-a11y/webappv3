/**
 * RAG API Routes
 *
 * Exposes the RAG engine as an HTTP API that third-party chatbots can query.
 * Supports both direct queries and streaming responses.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { RAGEngine } from "../services/rag-engine.js";
import { VALID_FUNNEL_STAGES } from "../types/taxonomy.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface AuthenticatedRequest extends Request {
  organizationId?: string;
  userId?: string;
}

// ─── Validation ──────────────────────────────────────────────────────────────

const QuerySchema = z.object({
  query: z
    .string()
    .min(3, "Query must be at least 3 characters")
    .max(1000, "Query must be under 1000 characters"),
  account_id: z.string().min(1),
  top_k: z.number().int().min(1).max(20).optional(),
  funnel_stages: z.array(z.enum(VALID_FUNNEL_STAGES as unknown as [string, ...string[]])).optional(),
});

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createRAGRoutes(ragEngine: RAGEngine): Router {
  const router = Router();

  /**
   * POST /api/rag/query
   *
   * Query the RAG engine with a natural language question about an account.
   * Organization ID is taken from the authenticated session (not from body)
   * to prevent cross-org data access.
   *
   * Request body:
   *   {
   *     "query": "How was the onboarding for Account X?",
   *     "account_id": "clx123...",
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
  router.post("/query", async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;

    // SECURITY: Always use org ID from authenticated session, never from request body
    const organizationId = authReq.organizationId;
    if (!organizationId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const parseResult = QuerySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: "validation_error",
        details: parseResult.error.issues,
      });
      return;
    }

    const { query, account_id, top_k, funnel_stages } =
      parseResult.data;

    try {
      const result = await ragEngine.query({
        query,
        accountId: account_id,
        organizationId, // From auth, not request body
        topK: top_k,
        funnelStages: funnel_stages,
      });

      res.json({
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
    } catch (err) {
      console.error("RAG query error:", err);
      res.status(500).json({ error: "Failed to process query" });
    }
  });

  /**
   * GET /api/rag/health
   *
   * Health check for the RAG service.
   */
  router.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", service: "rag-engine" });
  });

  return router;
}
