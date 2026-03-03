import { type Response, type Router } from "express";
import { z } from "zod";
import type {
  AccountScopeType,
  PermissionType,
  PrismaClient,
} from "@prisma/client";
import {
  requirePermission,
  type PermissionManager,
} from "../../middleware/permissions.js";
import type { RoleProfileService } from "../../services/role-profiles.js";
import type { AuditLogService } from "../../services/audit-log.js";
import logger from "../../lib/logger.js";
import { parseRequestBody } from "../_shared/validators.js";
import { sendSuccess, sendCreated, sendNotFound, sendBadRequest } from "../_shared/responses.js";
import type { AuthenticatedRequest } from "../../types/authenticated-request.js";
import { asyncHandler } from "../../lib/async-handler.js";

const RolePermissionEnum = z.enum([
  "CREATE_LANDING_PAGE",
  "PUBLISH_LANDING_PAGE",
  "PUBLISH_NAMED_LANDING_PAGE",
  "EDIT_ANY_LANDING_PAGE",
  "DELETE_ANY_LANDING_PAGE",
  "MANAGE_PERMISSIONS",
  "VIEW_ANALYTICS",
  "MANAGE_ENTITY_RESOLUTION",
  "MANAGE_AI_SETTINGS",
]);

const UpsertRoleProfileSchema = z.object({
  key: z.string().min(2).max(64).regex(/^[A-Z0-9_]+$/),
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  permissions: z.array(RolePermissionEnum),
  can_access_anonymous_stories: z.boolean(),
  can_generate_anonymous_stories: z.boolean(),
  can_access_named_stories: z.boolean(),
  can_generate_named_stories: z.boolean(),
  default_account_scope_type: z.enum([
    "ALL_ACCOUNTS",
    "SINGLE_ACCOUNT",
    "ACCOUNT_LIST",
    "CRM_REPORT",
  ]),
  default_account_ids: z.array(z.string()).optional(),
  max_tokens_per_day: z.number().int().min(0).nullable().optional(),
  max_tokens_per_month: z.number().int().min(0).nullable().optional(),
  max_requests_per_day: z.number().int().min(0).nullable().optional(),
  max_requests_per_month: z.number().int().min(0).nullable().optional(),
  max_stories_per_month: z.number().int().min(0).nullable().optional(),
});

const AssignRoleSchema = z.object({
  user_id: z.string().min(1),
  role_profile_id: z.string().min(1),
});

const GrantPermissionSchema = z.object({
  user_id: z.string().min(1),
  permission: z.enum([
    "CREATE_LANDING_PAGE",
    "PUBLISH_LANDING_PAGE",
    "PUBLISH_NAMED_LANDING_PAGE",
    "EDIT_ANY_LANDING_PAGE",
    "DELETE_ANY_LANDING_PAGE",
    "MANAGE_PERMISSIONS",
    "VIEW_ANALYTICS",
  ]),
});

interface RegisterAccessControlRoutesOptions {
  router: Router;
  prisma: PrismaClient;
  permManager: PermissionManager;
  roleProfiles: RoleProfileService;
  auditLogs: AuditLogService;
}

export function registerAccessControlRoutes({
  router,
  prisma,
  permManager,
  roleProfiles,
  auditLogs,
}: RegisterAccessControlRoutesOptions): void {
  // ── Admin: User Permissions ─────────────────────────────────────────

  /**
   * GET /api/dashboard/permissions
   *
   * Returns the full permission matrix for the org.
   */
  router.get(
    "/permissions",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const matrix = await permManager.getOrgPermissionMatrix(
      req.organizationId
      );
      sendSuccess(res, { users: matrix });
      
    }
  ));

  // ── Admin: Team/Role Profiles ────────────────────────────────────────

  router.get(
    "/roles",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      await roleProfiles.ensurePresetRoles(req.organizationId);

      const [roles, users] = await Promise.all([
      prisma.roleProfile.findMany({
        where: { organizationId: req.organizationId },
        orderBy: [{ isPreset: "desc" }, { name: "asc" }],
        include: {
          assignments: {
            select: {
              userId: true,
              user: { select: { name: true, email: true } },
            },
          },
        },
      }),
      prisma.user.findMany({
        where: { organizationId: req.organizationId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          roleAssignment: { select: { roleProfileId: true } },
        },
        orderBy: { email: "asc" },
      }),
      ]);

      sendSuccess(res, {
      roles,
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        base_role: u.role,
        role_profile_id: u.roleAssignment?.roleProfileId ?? null,
      })),
      });
      
    }
  ));

  router.post(
    "/roles",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const payload = parseRequestBody(UpsertRoleProfileSchema, req.body, res);
      if (!payload) {
        return;
      }

        const d = payload;
        const role = await prisma.roleProfile.create({
          data: {
            organizationId: req.organizationId,
            key: d.key,
            name: d.name,
            description: d.description,
            isPreset: false,
            permissions: d.permissions as PermissionType[],
            canAccessAnonymousStories: d.can_access_anonymous_stories,
            canGenerateAnonymousStories: d.can_generate_anonymous_stories,
            canAccessNamedStories: d.can_access_named_stories,
            canGenerateNamedStories: d.can_generate_named_stories,
            defaultAccountScopeType: d.default_account_scope_type as AccountScopeType,
            defaultAccountIds: d.default_account_ids ?? [],
            maxTokensPerDay: d.max_tokens_per_day ?? null,
            maxTokensPerMonth: d.max_tokens_per_month ?? null,
            maxRequestsPerDay: d.max_requests_per_day ?? null,
            maxRequestsPerMonth: d.max_requests_per_month ?? null,
            maxStoriesPerMonth: d.max_stories_per_month ?? null,
          },
        });
        sendCreated(res, { role });
      
    }
  ));

  router.patch(
    "/roles/:roleId",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const payload = parseRequestBody(UpsertRoleProfileSchema, req.body, res);
      if (!payload) {
        return;
      }

        const existing = await prisma.roleProfile.findFirst({
          where: { id: req.params.roleId as string, organizationId: req.organizationId },
        });
        if (!existing) {
          sendNotFound(res, "Role profile not found");
          return;
        }

        if (existing.isPreset && existing.key !== payload.key) {
          sendBadRequest(res, "Preset role keys cannot be changed");
          return;
        }

        const d = payload;
        const role = await prisma.roleProfile.update({
          where: { id: existing.id },
          data: {
            key: d.key,
            name: d.name,
            description: d.description,
            permissions: d.permissions as PermissionType[],
            canAccessAnonymousStories: d.can_access_anonymous_stories,
            canGenerateAnonymousStories: d.can_generate_anonymous_stories,
            canAccessNamedStories: d.can_access_named_stories,
            canGenerateNamedStories: d.can_generate_named_stories,
            defaultAccountScopeType: d.default_account_scope_type as AccountScopeType,
            defaultAccountIds: d.default_account_ids ?? [],
            maxTokensPerDay: d.max_tokens_per_day ?? null,
            maxTokensPerMonth: d.max_tokens_per_month ?? null,
            maxRequestsPerDay: d.max_requests_per_day ?? null,
            maxRequestsPerMonth: d.max_requests_per_month ?? null,
            maxStoriesPerMonth: d.max_stories_per_month ?? null,
          },
        });
        sendSuccess(res, { role });
      
    }
  ));

  router.delete(
    "/roles/:roleId",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const role = await prisma.roleProfile.findFirst({
      where: { id: req.params.roleId as string, organizationId: req.organizationId },
      });
      if (!role) {
      sendNotFound(res, "Role profile not found");
      return;
      }
      if (role.isPreset) {
      sendBadRequest(res, "Preset roles cannot be deleted");
      return;
      }

      await prisma.userRoleAssignment.deleteMany({
      where: { roleProfileId: role.id },
      });
      await prisma.roleProfile.delete({ where: { id: role.id } });
      sendSuccess(res, { deleted: true });
      
    }
  ));

  router.post(
    "/roles/assign",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const payload = parseRequestBody(AssignRoleSchema, req.body, res);
      if (!payload) {
        return;
      }

      try {
        await roleProfiles.assignRoleToUser(
          req.organizationId,
          payload.user_id,
          payload.role_profile_id,
          req.userId
        );
        await auditLogs.record({
          organizationId: req.organizationId,
          actorUserId: req.userId,
          category: "PERMISSION",
          action: "ROLE_PROFILE_ASSIGNED",
          targetType: "user",
          targetId: payload.user_id,
          severity: "WARN",
          metadata: { role_profile_id: payload.role_profile_id },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        sendSuccess(res, { assigned: true });
      } catch (err) {
        logger.error("Assign role profile error", { error: err });
        sendBadRequest(res, err instanceof Error ? err.message : "Failed to assign role profile");
      }
    }
  ));

  /**
   * POST /api/dashboard/permissions/grant
   *
   * Grants a specific permission to a user.
   */
  router.post(
    "/permissions/grant",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const payload = parseRequestBody(GrantPermissionSchema, req.body, res);
      if (!payload) {
        return;
      }

        await permManager.grantPermission(
          payload.user_id,
          payload.permission as PermissionType,
          req.userId
        );
        await auditLogs.record({
          organizationId: req.organizationId,
          actorUserId: req.userId,
          category: "PERMISSION",
          action: "USER_PERMISSION_GRANTED",
          targetType: "user",
          targetId: payload.user_id,
          severity: "WARN",
          metadata: { permission: payload.permission },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        sendSuccess(res, { granted: true });
      
    }
  ));

  /**
   * POST /api/dashboard/permissions/revoke
   *
   * Revokes a specific permission from a user.
   */
  router.post(
    "/permissions/revoke",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
      const payload = parseRequestBody(GrantPermissionSchema, req.body, res);
      if (!payload) {
        return;
      }

        await permManager.revokePermission(
          payload.user_id,
          payload.permission as PermissionType
        );
        await auditLogs.record({
          organizationId: req.organizationId,
          actorUserId: req.userId,
          category: "PERMISSION",
          action: "USER_PERMISSION_REVOKED",
          targetType: "user",
          targetId: payload.user_id,
          severity: "WARN",
          metadata: { permission: payload.permission },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        sendSuccess(res, { revoked: true });
      
    }
  ));
}
