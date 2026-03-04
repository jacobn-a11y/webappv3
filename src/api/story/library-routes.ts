/**
 * Story Library Routes
 *
 * GET /library     — List stories with search/filter/pagination
 * GET /:accountId  — List stories for a specific account
 */

import { type Request, type Response, type Router } from "express";
import type { AuthenticatedRequest } from "../../types/authenticated-request.js";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { AccountAccessService } from "../../services/account-access.js";
import type { RoleProfileService } from "../../services/role-profiles.js";
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
  prisma: PrismaClient;
  accessService: AccountAccessService;
  roleProfiles: RoleProfileService;
}

export function registerLibraryRoutes({
  router,
  prisma,
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

      const limit = parse.data.limit ?? 25;
      const page = parse.data.page ?? 1;
      const where: Record<string, unknown> = {
        organizationId,
      };

      if (accessibleIds !== null) {
        where.accountId = { in: accessibleIds };
      }

      if (parse.data.story_type) {
        where.storyType = parse.data.story_type;
      }

      if (parse.data.status) {
        if (parse.data.status === "DRAFT") {
          where.landingPages = { none: {} };
        }
        if (parse.data.status === "PAGE_CREATED") {
          where.landingPages = { some: { status: "DRAFT" } };
        }
        if (parse.data.status === "PUBLISHED") {
          where.landingPages = { some: { status: "PUBLISHED" } };
        }
        if (parse.data.status === "ARCHIVED") {
          where.landingPages = { some: { status: "ARCHIVED" } };
        }
      }

      if (parse.data.search && parse.data.search.trim().length > 0) {
        const needle = parse.data.search.trim();
        where.OR = [
          { title: { contains: needle, mode: "insensitive" } },
          { markdownBody: { contains: needle, mode: "insensitive" } },
          { account: { name: { contains: needle, mode: "insensitive" } } },
          { account: { domain: { contains: needle, mode: "insensitive" } } },
          {
            quotes: {
              some: {
                quoteText: { contains: needle, mode: "insensitive" },
              },
            },
          },
          {
            quotes: {
              some: {
                metricValue: { contains: needle, mode: "insensitive" },
              },
            },
          },
          {
            quotes: {
              some: {
                metricType: { contains: needle, mode: "insensitive" },
              },
            },
          },
        ];
      }

      const [totalCount, stories] = await Promise.all([
        prisma.story.count({ where }),
        prisma.story.findMany({
          where,
          include: {
            account: {
              select: {
                id: true,
                name: true,
                domain: true,
              },
            },
            quotes: true,
            landingPages: {
              select: {
                id: true,
                slug: true,
                status: true,
                publishedAt: true,
                createdAt: true,
              },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
          orderBy: { generatedAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);

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

      const stories = await prisma.story.findMany({
        where: {
          accountId: req.params.accountId as string,
          organizationId,
        },
        include: {
          quotes: true,
          landingPages: {
            select: {
              id: true,
              slug: true,
              status: true,
              publishedAt: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
        orderBy: { generatedAt: "desc" },
      });

      sendSuccess(res, {
        stories: stories.map((s) => mapStorySummary(s)),
      });

  }));
}
