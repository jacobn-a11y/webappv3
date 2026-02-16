/**
 * RAG API Routes
 *
 * Exposes the RAG engine as an HTTP API that third-party chatbots can query.
 * Now supports provider/model selection with per-user usage tracking.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { UserRole } from "@prisma/client";
import type { RAGEngine } from "../services/rag-engine.js";
import { AIConfigService, AIAccessDeniedError } from "../services/ai-config.js";
import {
  AIUsageTracker,
  TrackedAIClient,
  UsageLimitExceededError,
  InsufficientBalanceError,
} from "../services/ai-usage-tracker.js";
import type { AIProviderName } from "../services/ai-client.js";

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
  provider: z.enum(["openai", "anthropic", "google"]).optional(),
  model: z.string().optional(),
});

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createRAGRoutes(
  ragEngine: RAGEngine,
  configService: AIConfigService,
  usageTracker: AIUsageTracker
): Router {
  const router = Router();

  /**
   * POST /api/rag/query
   *
   * Query the RAG engine with a natural language question about an account.
   */
  router.post("/query", async (req: AuthReq, res: Response) => {
    const parseResult = QuerySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: "validation_error",
        details: parseResult.error.issues,
      });
      return;
    }

    const { userId, userRole } = req;
    const {
      query,
      account_id,
      organization_id,
      top_k,
      funnel_stages,
      provider,
      model,
    } = parseResult.data;

    // Use authenticated org if available, otherwise use request body
    const organizationId = req.organizationId ?? organization_id;

    if (!userId || !userRole) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      // Resolve AI client for this user
      const { client, isPlatformBilled } = await configService.resolveClient(
        organizationId,
        userId,
        userRole,
        { provider: provider as AIProviderName | undefined, model }
      );

      // Wrap with usage tracking
      const trackedClient = new TrackedAIClient(
        client,
        usageTracker,
        { organizationId, userId, operation: "RAG_QUERY" },
        isPlatformBilled
      );

      const result = await ragEngine.query(
        {
          query,
          accountId: account_id,
          organizationId,
          topK: top_k,
          funnelStages: funnel_stages,
        },
        trackedClient
      );

      res.json({
        answer: result.answer,
        ai_provider: client.providerName,
        ai_model: client.modelName,
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
      if (err instanceof AIAccessDeniedError) {
        res.status(403).json({ error: "ai_access_denied", message: err.message });
        return;
      }
      if (err instanceof UsageLimitExceededError) {
        res.status(429).json({ error: "usage_limit_exceeded", message: err.message });
        return;
      }
      if (err instanceof InsufficientBalanceError) {
        res.status(402).json({ error: "insufficient_balance", message: err.message });
        return;
      }
      console.error("RAG query error:", err);
      res.status(500).json({ error: "Failed to process query" });
    }
  });

  /**
   * GET /api/rag/health
   */
  router.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", service: "rag-engine" });
  });

  return router;
}
