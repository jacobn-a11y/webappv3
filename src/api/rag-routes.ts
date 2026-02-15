/**
 * RAG API Routes
 *
 * Exposes the RAG engine as an HTTP API that third-party chatbots can query.
 * Supports both direct queries and streaming responses.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { RAGEngine } from "../services/rag-engine.js";
import logger from "../lib/logger.js";
import { metrics } from "../lib/metrics.js";
import { Sentry } from "../lib/sentry.js";

// ─── Validation ──────────────────────────────────────────────────────────────

const QuerySchema = z.object({
  query: z
    .string()
    .min(3, "Query must be at least 3 characters")
    .max(1000, "Query must be under 1000 characters"),
  account_id: z.string().min(1),
  organization_id: z.string().min(1),
  top_k: z.number().int().min(1).max(20).optional(),
  funnel_stages: z.array(z.string()).optional(),
});

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createRAGRoutes(ragEngine: RAGEngine): Router {
  const router = Router();

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
  router.post("/query", async (req: Request, res: Response) => {
    const parseResult = QuerySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: "validation_error",
        details: parseResult.error.issues,
      });
      return;
    }

    const { query, account_id, organization_id, top_k, funnel_stages } =
      parseResult.data;

    try {
      const result = await ragEngine.query({
        query,
        accountId: account_id,
        organizationId: organization_id,
        topK: top_k,
        funnelStages: funnel_stages,
      });

      metrics.incrementRAGQueriesServed();

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
      logger.error("RAG query error", { error: err });
      Sentry.captureException(err);
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
