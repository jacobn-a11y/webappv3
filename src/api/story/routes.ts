/**
 * Story Builder API Routes
 *
 * Endpoints for generating and retrieving Markdown case studies.
 *
 * Composes:
 *   - build-routes.ts
 *   - library-routes.ts
 *   - export-routes.ts
 */

import { Router } from "express";
import type { StoryBuilder } from "../../services/story-builder.js";
import type { PrismaClient, UserRole } from "@prisma/client";
import { AccountAccessService } from "../../services/account-access.js";
import { RoleProfileService } from "../../services/role-profiles.js";
import { StoryQueryService } from "../../services/story-query.js";
import { AIConfigService } from "../../services/ai-config.js";
import { AIUsageTracker, TrackedAIClient } from "../../services/ai-usage-tracker.js";
import { FailoverAIClient } from "../../services/ai-resilience.js";
import { dispatchOutboundWebhookEvent } from "../../services/outbound-webhooks.js";
import type { RAGEngine } from "../../services/rag-engine.js";
import logger from "../../lib/logger.js";
import { registerBuildRoutes } from "./build-routes.js";
import { registerLibraryRoutes } from "./library-routes.js";
import { registerExportRoutes } from "./export-routes.js";

export function createStoryRoutes(
  storyBuilder: StoryBuilder,
  prisma: PrismaClient,
  aiConfigService: AIConfigService,
  aiUsageTracker: AIUsageTracker,
  ragEngine?: RAGEngine
): Router {
  const router = Router();
  const accessService = new AccountAccessService(prisma);
  const roleProfiles = new RoleProfileService(prisma);
  const storyQuery = new StoryQueryService(prisma);

  const normalizeRole = (role: unknown): UserRole => {
    if (
      role === "OWNER" ||
      role === "ADMIN" ||
      role === "MEMBER" ||
      role === "VIEWER"
    ) {
      return role;
    }
    return "MEMBER";
  };

  const resolveStoryAIClient = async (input: {
    organizationId: string;
    userId: string;
    userRole: UserRole;
    provider?: "openai" | "anthropic" | "google";
    model?: string;
  }) => {
    const resolved = await aiConfigService.resolveClientWithFailover(
      input.organizationId,
      input.userId,
      input.userRole,
      {
        operation: "STORY_GENERATION",
        provider: input.provider,
        model: input.model,
      }
    );

    const primaryTracked = new TrackedAIClient(
      resolved.primary.client,
      aiUsageTracker,
      {
        organizationId: input.organizationId,
        userId: input.userId,
        operation: "STORY_GENERATION",
      },
      resolved.primary.isPlatformBilled
    );

    const fallbackTracked = resolved.fallback
      ? new TrackedAIClient(
          resolved.fallback.client,
          aiUsageTracker,
          {
            organizationId: input.organizationId,
            userId: input.userId,
            operation: "STORY_GENERATION",
          },
          resolved.fallback.isPlatformBilled
        )
      : null;

    const client = new FailoverAIClient(primaryTracked, fallbackTracked, {
      failureThreshold: 3,
      cooldownMs: 60_000,
      maxAttempts: resolved.retryBudget,
      circuitKey: `story:${input.organizationId}:${resolved.primary.provider}`,
    });

    return { client, retryBudget: resolved.retryBudget };
  };

  const dispatchStoryEvent = async (
    input: {
      organizationId: string;
      eventType: "story_generated" | "story_generation_failed";
      payload: Record<string, unknown>;
    }
  ): Promise<void> => {
    await dispatchOutboundWebhookEvent(prisma, input).catch((err) => {
      logger.warn("Story outbound webhook dispatch failed", { error: err });
    });
  };

  const sharedDeps = {
    router,
    prisma,
    storyQuery,
    accessService,
    roleProfiles,
  };

  registerBuildRoutes({
    ...sharedDeps,
    storyBuilder,
    normalizeRole,
    resolveStoryAIClient,
    dispatchStoryEvent,
  });

  registerLibraryRoutes({
    ...sharedDeps,
    ragEngine,
  });

  registerExportRoutes({
    ...sharedDeps,
    ragEngine,
  });

  return router;
}
