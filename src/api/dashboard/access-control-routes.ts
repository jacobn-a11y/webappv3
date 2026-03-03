import { type Request, type Response, type Router } from "express";
import { z } from "zod";
import type {
  AccountScopeType,
  PermissionType,
  PrismaClient,
  UserRole,
} from "@prisma/client";
import {
  requirePermission,
  type PermissionManager,
} from "../../middleware/permissions.js";
import type { RoleProfileService } from "../../services/role-profiles.js";
import type { AuditLogService } from "../../services/audit-log.js";
import logger from "../../lib/logger.js";
import { parseRequestBody } from "../_shared/validators.js";

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

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

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
    async (req: AuthReq, res: Response) => {
      try {
        const matrix = await permManager.getOrgPermissionMatrix(
          req.organizationId
        );
        res.json({ users: matrix });
      } catch (err) {
        logger.error("Get permissions error", { error: err });
        res.status(500).json({ error: "Failed to load permissions" });
      }
    }
  );

  // ── Admin: Team/Role Profiles ────────────────────────────────────────

  router.get(
    "/roles",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
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

        res.json({
          roles,
          users: users.map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            base_role: u.role,
            role_profile_id: u.roleAssignment?.roleProfileId ?? null,
          })),
        });
      } catch (err) {
        logger.error("Get role profiles error", { error: err });
        res.status(500).json({ error: "Failed to load role profiles" });
      }
    }
  );

  router.post(
    "/roles",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const payload = parseRequestBody(UpsertRoleProfileSchema, req.body, res);
      if (!payload) {
        return;
      }

      try {
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
        res.status(201).json({ role });
      } catch (err) {
        logger.error("Create role profile error", { error: err });
        res.status(500).json({ error: "Failed to create role profile" });
      }
    }
  );

  router.patch(
    "/roles/:roleId",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const payload = parseRequestBody(UpsertRoleProfileSchema, req.body, res);
      if (!payload) {
        return;
      }

      try {
        const existing = await prisma.roleProfile.findFirst({
          where: { id: req.params.roleId as string, organizationId: req.organizationId },
        });
        if (!existing) {
          res.status(404).json({ error: "Role profile not found" });
          return;
        }

        if (existing.isPreset && existing.key !== payload.key) {
          res.status(400).json({ error: "Preset role keys cannot be changed" });
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
        res.json({ role });
      } catch (err) {
        logger.error("Update role profile error", { error: err });
        res.status(500).json({ error: "Failed to update role profile" });
      }
    }
  );

  router.delete(
    "/roles/:roleId",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const role = await prisma.roleProfile.findFirst({
          where: { id: req.params.roleId as string, organizationId: req.organizationId },
        });
        if (!role) {
          res.status(404).json({ error: "Role profile not found" });
          return;
        }
        if (role.isPreset) {
          res.status(400).json({ error: "Preset roles cannot be deleted" });
          return;
        }

        await prisma.userRoleAssignment.deleteMany({
          where: { roleProfileId: role.id },
        });
        await prisma.roleProfile.delete({ where: { id: role.id } });
        res.json({ deleted: true });
      } catch (err) {
        logger.error("Delete role profile error", { error: err });
        res.status(500).json({ error: "Failed to delete role profile" });
      }
    }
  );

  router.post(
    "/roles/assign",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
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
        res.json({ assigned: true });
      } catch (err) {
        logger.error("Assign role profile error", { error: err });
        res.status(400).json({
          error: err instanceof Error ? err.message : "Failed to assign role profile",
        });
      }
    }
  );

  /**
   * POST /api/dashboard/permissions/grant
   *
   * Grants a specific permission to a user.
   */
  router.post(
    "/permissions/grant",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const payload = parseRequestBody(GrantPermissionSchema, req.body, res);
      if (!payload) {
        return;
      }

      try {
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
        res.json({ granted: true });
      } catch (err) {
        logger.error("Grant permission error", { error: err });
        res.status(500).json({ error: "Failed to grant permission" });
      }
    }
  );

  /**
   * POST /api/dashboard/permissions/revoke
   *
   * Revokes a specific permission from a user.
   */
  router.post(
    "/permissions/revoke",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const payload = parseRequestBody(GrantPermissionSchema, req.body, res);
      if (!payload) {
        return;
      }

      try {
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
        res.json({ revoked: true });
      } catch (err) {
        logger.error("Revoke permission error", { error: err });
        res.status(500).json({ error: "Failed to revoke permission" });
      }
    }
  );
}
