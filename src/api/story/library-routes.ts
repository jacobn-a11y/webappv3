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
import { mapStorySummary } from "../../services/story-mappers.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { sendSuccess, sendBadRequest, sendUnauthorized, sendForbidden } from "../_shared/responses.js";

// ─── Validation ──────────────────────────────────────────────────────────────

const StoryLibraryQuerySchema = z.object({
  search: z.string().max(200).optional(),
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
  status: z.enum(["DRAFT", "PAGE_CREATED", "PUBLISHED", "ARCHIVED"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// ─── Route Registration ─────────────────────────────────────────────────────

interface RegisterLibraryRoutesOptions {
  router: Router;
  storyQuery: StoryQueryService;
  accessService: AccountAccessService;
  roleProfiles: RoleProfileService;
}

export function registerLibraryRoutes({
  router,
  storyQuery,
  accessService,
  roleProfiles,
}: RegisterLibraryRoutesOptions): void {
  router.get("/library", asyncHandler(async (req: Request, res: Response) => {
    const parse = StoryLibraryQuerySchema.safeParse(req.query);
    if (!parse.success) {
      sendBadRequest(res, "validation_error", parse.error.issues);
      return;
    }

    const authReq = req as AuthenticatedRequest;
    const organizationId = authReq.organizationId;
    const userId = authReq.userId;
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

      const { stories, totalCount, page, limit } = await storyQuery.getLibrary({
        organizationId,
        accessibleAccountIds: accessibleIds,
        storyType: parse.data.story_type,
        status: parse.data.status,
        search: parse.data.search,
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
      });

  }));

  router.get("/:accountId", asyncHandler(async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const organizationId = authReq.organizationId;
    const userId = authReq.userId;
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
