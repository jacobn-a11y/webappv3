/**
 * Story Library Routes
 *
 * GET /library     — List stories with search/filter/pagination
 * GET /:accountId  — List stories for a specific account
 */

import { type Request, type Response, type Router } from "express";
import type { AuthenticatedRequest } from "../../types/authenticated-request.js";
import { z } from "zod";
import type { AccountAccessService } from "../../services/account-access.js";
import type { RoleProfileService } from "../../services/role-profiles.js";
import type { StoryQueryService } from "../../services/story-query.js";
import type { RAGEngine } from "../../services/rag-engine.js";
import { mapStorySummary } from "../../services/story-mappers.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { sendSuccess, sendBadRequest, sendUnauthorized, sendForbidden } from "../_shared/responses.js";

// ─── Validation ──────────────────────────────────────────────────────────────

const StoryLibraryQuerySchema = z.object({
  search: z.string().max(200).optional(),
  search_mode: z.enum(["keyword", "semantic"]).optional(),
  story_type: z
    .enum([
      "FULL_JOURNEY",
      "ONBOARDING",
      "ROI_ANALYSIS",
      "COMPETITIVE_WIN",
      "EXPANSION",
      "CUSTOM",
    ])
    .optional(),
  status: z.enum(["DRAFT", "IN_REVIEW", "APPROVED", "PUBLISHED"]).optional(),
  funnel_stage: z
    .union([z.string(), z.array(z.string())])
    .optional(),
  topic: z
    .union([z.string(), z.array(z.string())])
    .optional(),
  include_archived: z
    .union([z.literal("true"), z.literal("false")])
    .optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// ─── Route Registration ─────────────────────────────────────────────────────

interface RegisterLibraryRoutesOptions {
  router: Router;
  storyQuery: StoryQueryService;
  accessService: AccountAccessService;
  roleProfiles: RoleProfileService;
  ragEngine?: RAGEngine;
}

export function registerLibraryRoutes({
  router,
  storyQuery,
  accessService,
  roleProfiles,
  ragEngine,
}: RegisterLibraryRoutesOptions): void {
  const parseMultiValue = (value?: string | string[]): string[] | undefined => {
    if (value == null) return undefined;
    const rawValues = Array.isArray(value) ? value : [value];
    const values = rawValues
      .flatMap((part) => part.split(","))
      .map((item) => item.trim())
      .filter(Boolean);
    return values.length > 0 ? Array.from(new Set(values)) : undefined;
  };

  router.get("/library", asyncHandler(async (req: Request, res: Response) => {
    const parse = StoryLibraryQuerySchema.safeParse(req.query);
    if (!parse.success) {
      sendBadRequest(res, "validation_error", parse.error.issues);
      return;
    }

    const authReq = req as AuthenticatedRequest;
    const organizationId = authReq.organizationId!;
    const userId = authReq.userId!;
    const userRole = authReq.userRole;

    if (!organizationId) {
      sendUnauthorized(res, "Authentication required");
      return;
    }

      const policy = await roleProfiles.getEffectivePolicy(organizationId, userId, userRole);
      if (!policy.canAccessAnonymousStories) {
        sendForbidden(res, "Your role cannot access stories.");
        return;
      }

      const accessibleIds = await accessService.getAccessibleAccountIds(
        userId,
        organizationId,
        userRole
      );

      if (accessibleIds !== null && accessibleIds.length === 0) {
        sendSuccess(res, {
          stories: [],
          pagination: { page: 1, limit: 25, totalCount: 0, totalPages: 0 },
        });
        return;
      }

      const requestedSearchMode = parse.data.search_mode ?? "keyword";
      const search = parse.data.search?.trim();
      const funnelStages = parseMultiValue(parse.data.funnel_stage);
      const topics = parseMultiValue(parse.data.topic);

      let searchMode: "keyword" | "semantic" = requestedSearchMode;
      let semanticAccountIds: string[] | undefined;
      if (requestedSearchMode === "semantic" && search && ragEngine) {
        semanticAccountIds = await storyQuery.rankSemanticSearchAccounts({
          ragEngine,
          organizationId,
          query: search,
          accessibleAccountIds: accessibleIds,
          funnelStages,
        });
        if (semanticAccountIds.length === 0) {
          searchMode = "keyword";
        }
      }

      const { stories, totalCount, page, limit } = await storyQuery.getLibrary({
        organizationId,
        accessibleAccountIds: accessibleIds,
        storyType: parse.data.story_type,
        status: parse.data.status,
        funnelStages,
        topics,
        includeArchived: parse.data.include_archived === "true",
        search,
        searchMode,
        semanticAccountIds,
        page: parse.data.page,
        limit: parse.data.limit,
      });

      const totalPages = Math.ceil(totalCount / limit);

      sendSuccess(res, {
        stories: stories.map((s) => ({
          ...mapStorySummary(s),
          account: {
            id: s.account.id,
            name: s.account.name,
            domain: s.account.domain,
          },
        })),
        pagination: {
          page,
          limit,
          totalCount,
          totalPages,
        },
        search_mode: searchMode,
      });

  }));

  router.get("/library/taxonomy", asyncHandler(async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const organizationId = authReq.organizationId!;
    const userId = authReq.userId!;
    const userRole = authReq.userRole;

    if (!organizationId) {
      sendUnauthorized(res, "Authentication required");
      return;
    }

    const policy = await roleProfiles.getEffectivePolicy(
      organizationId,
      userId,
      userRole
    );
    if (!policy.canAccessAnonymousStories) {
      sendForbidden(res, "Your role cannot access stories.");
      return;
    }

    const accessibleIds = await accessService.getAccessibleAccountIds(
      userId,
      organizationId,
      userRole
    );
    if (accessibleIds !== null && accessibleIds.length === 0) {
      sendSuccess(res, { funnel_stage_counts: {}, topic_counts: {} });
      return;
    }

    const counts = await storyQuery.getLibraryTaxonomyCounts({
      organizationId,
      accessibleAccountIds: accessibleIds,
    });

    sendSuccess(res, {
      funnel_stage_counts: counts.funnelStageCounts,
      topic_counts: counts.topicCounts,
    });
  }));

  router.get("/:accountId", asyncHandler(async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const organizationId = authReq.organizationId!;
    const userId = authReq.userId!;
    const userRole = authReq.userRole;
    if (!organizationId) {
      sendUnauthorized(res, "Authentication required");
      return;
    }

      const [policy, canAccessAccount] = await Promise.all([
        roleProfiles.getEffectivePolicy(organizationId, userId, userRole),
        accessService.canAccessAccount(
          userId,
          organizationId,
          req.params.accountId as string,
          userRole
        ),
      ]);

      if (!policy.canAccessAnonymousStories) {
        sendForbidden(res, "Your role cannot access stories.");
        return;
      }

      if (!canAccessAccount) {
        sendForbidden(res, "You do not have access to this account.");
        return;
      }

      const stories = await storyQuery.getStoriesByAccount(
        req.params.accountId as string,
        organizationId
      );

      sendSuccess(res, {
        stories: stories.map((s) => mapStorySummary(s)),
      });

  }));
}
