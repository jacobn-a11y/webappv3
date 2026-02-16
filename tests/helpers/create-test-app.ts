/**
 * Test App Factory
 *
 * Builds a minimal Express app mirroring production route wiring,
 * but with injectable mocks for PrismaClient, RAGEngine, StoryBuilder,
 * and a fake auth layer that sets req.organizationId.
 */

import express, { type Request, type Response, type NextFunction } from "express";
import { createRAGRoutes } from "../../src/api/rag-routes.js";
import { createStoryRoutes } from "../../src/api/story-routes.js";
import { createTrialGate } from "../../src/middleware/billing.js";
import type { RAGEngine } from "../../src/services/rag-engine.js";
import type { StoryBuilder } from "../../src/services/story-builder.js";
import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

export interface TestAppOptions {
  /** Prisma mock — must implement organization.findUnique at minimum */
  prisma: unknown;
  /** RAGEngine mock — must implement query() */
  ragEngine: unknown;
  /** StoryBuilder mock — must implement buildStory() */
  storyBuilder: unknown;
  /**
   * Organization ID to inject via fake auth middleware.
   * Set to `null` to simulate an unauthenticated request.
   */
  organizationId?: string | null;
}

/**
 * Creates a test Express app with the same middleware + route structure as
 * production, but backed by mocks.
 */
export function createTestApp(options: TestAppOptions) {
  const {
    prisma,
    ragEngine,
    storyBuilder,
    organizationId = "org-test-active",
  } = options;

  const app = express();
  app.use(express.json());

  // ─── Fake auth middleware ────────────────────────────────────────────────
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (organizationId !== null) {
      (req as Record<string, unknown>).organizationId = organizationId;
    }
    next();
  });

  // ─── Trial gate (uses real middleware with our mock prisma) ──────────────
  const trialGate = createTrialGate(
    prisma as PrismaClient,
    {} as Stripe
  );

  // ─── Routes ─────────────────────────────────────────────────────────────
  app.use("/api/rag", trialGate, createRAGRoutes(ragEngine as RAGEngine));
  app.use(
    "/api/stories",
    trialGate,
    createStoryRoutes(storyBuilder as StoryBuilder, prisma as PrismaClient)
  );

  return app;
}
