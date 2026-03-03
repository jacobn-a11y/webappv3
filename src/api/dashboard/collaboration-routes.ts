import { type Response, type Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { AuditLogService } from "../../services/audit-log.js";
import logger from "../../lib/logger.js";
import { sendUnauthorized, sendSuccess, sendCreated, sendNotFound, sendForbidden, sendBadRequest } from "../_shared/responses.js";
import { parseRequestBody } from "../_shared/validators.js";
import type { AuthenticatedRequest } from "../../types/authenticated-request.js";
import { asyncHandler } from "../../lib/async-handler.js";

const WorkspaceTeamSchema = z.enum(["REVOPS", "MARKETING", "SALES", "CS"]);
const WorkspaceVisibilitySchema = z.enum(["PRIVATE", "TEAM", "ORG"]);

const UpsertWorkspaceSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  team: WorkspaceTeamSchema,
  visibility: WorkspaceVisibilitySchema,
  allowed_role_profile_keys: z.array(z.string().min(1).max(64)).optional(),
  saved_view_config: z.record(z.string(), z.unknown()).optional(),
});

const UpsertSharedAssetSchema = z.object({
  workspace_id: z.string().optional(),
  asset_type: z.enum(["STORY", "PAGE", "REPORT", "PLAYBOOK", "TEMPLATE"]),
  title: z.string().min(2).max(160),
  description: z.string().max(500).optional(),
  source_story_id: z.string().optional(),
  source_page_id: z.string().optional(),
  source_account_id: z.string().optional(),
  visibility: WorkspaceVisibilitySchema,
  allowed_role_profile_keys: z.array(z.string().min(1).max(64)).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

interface RegisterCollaborationRoutesOptions {
  router: Router;
  prisma: PrismaClient;
  auditLogs: AuditLogService;
}

export function registerCollaborationRoutes({
  router,
  prisma,
  auditLogs,
}: RegisterCollaborationRoutesOptions): void {
  // ── Team Workspaces ────────────────────────────────────────────────

  router.get("/workspaces", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.organizationId || !req.userId) {
      sendUnauthorized(res);
      return;
    }

    const [assignment, user] = await Promise.all([
    prisma.userRoleAssignment.findUnique({
      where: { userId: req.userId },
      include: { roleProfile: true },
    }),
    prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true },
    }),
    ]);
    const roleKey = assignment?.roleProfile?.key ?? null;
    const team =
    roleKey === "SALES"
      ? "SALES"
      : roleKey === "CS"
        ? "CS"
        : roleKey === "EXEC"
          ? "REVOPS"
          : user?.role === "OWNER" || user?.role === "ADMIN"
            ? "REVOPS"
            : "MARKETING";

    const workspaces = await prisma.teamWorkspace.findMany({
    where: {
      organizationId: req.organizationId,
      OR: [
        { ownerUserId: req.userId },
        { visibility: "ORG" },
        { visibility: "TEAM", team: team as "REVOPS" | "MARKETING" | "SALES" | "CS" },
        ...(roleKey ? [{ allowedRoleProfileKeys: { has: roleKey } }] : []),
      ],
    },
    orderBy: { updatedAt: "desc" },
    });
    sendSuccess(res, {
    workspaces: workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
      team: w.team,
      visibility: w.visibility,
      owner_user_id: w.ownerUserId,
      saved_view_config: w.savedViewConfig,
      allowed_role_profile_keys: w.allowedRoleProfileKeys,
      created_at: w.createdAt.toISOString(),
      updated_at: w.updatedAt.toISOString(),
    })),
    });
    
  }));

  router.post("/workspaces", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.organizationId || !req.userId) {
      sendUnauthorized(res);
      return;
    }
    const payload = parseRequestBody(UpsertWorkspaceSchema, req.body, res);
    if (!payload) {
      return;
    }

    const d = payload;
    const workspace = await prisma.teamWorkspace.create({
    data: {
      organizationId: req.organizationId,
      ownerUserId: req.userId,
      name: d.name,
      description: d.description,
      team: d.team,
      visibility: d.visibility,
      allowedRoleProfileKeys: d.allowed_role_profile_keys ?? [],
      savedViewConfig: (d.saved_view_config ?? undefined) as
        | Prisma.InputJsonValue
        | undefined,
    },
    });
    await auditLogs.record({
    organizationId: req.organizationId,
    actorUserId: req.userId,
    category: "WORKSPACE",
    action: "WORKSPACE_CREATED",
    targetType: "workspace",
    targetId: workspace.id,
    severity: "INFO",
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    });
    sendCreated(res, { id: workspace.id });
    
  }));

  router.patch("/workspaces/:workspaceId", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.organizationId || !req.userId) {
      sendUnauthorized(res);
      return;
    }
    const payload = parseRequestBody(UpsertWorkspaceSchema, req.body, res);
    if (!payload) {
      return;
    }

    const workspaceId = String(req.params.workspaceId);
    const existing = await prisma.teamWorkspace.findFirst({
    where: { id: workspaceId, organizationId: req.organizationId },
    });
    if (!existing) {
    sendNotFound(res, "Workspace not found");
    return;
    }
    const isOwner = existing.ownerUserId === req.userId;
    const isAdmin = req.userRole === "OWNER" || req.userRole === "ADMIN";
    if (!isOwner && !isAdmin) {
    sendForbidden(res, "permission_denied");
    return;
    }

    const d = payload;
    await prisma.teamWorkspace.update({
    where: { id: existing.id },
    data: {
      name: d.name,
      description: d.description,
      team: d.team,
      visibility: d.visibility,
      allowedRoleProfileKeys: d.allowed_role_profile_keys ?? [],
      savedViewConfig: (d.saved_view_config ?? undefined) as
        | Prisma.InputJsonValue
        | undefined,
    },
    });
    await auditLogs.record({
    organizationId: req.organizationId,
    actorUserId: req.userId,
    category: "WORKSPACE",
    action: "WORKSPACE_UPDATED",
    targetType: "workspace",
    targetId: existing.id,
    severity: "WARN",
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    });
    sendSuccess(res, { updated: true });
    
  }));

  router.delete("/workspaces/:workspaceId", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.organizationId || !req.userId) {
      sendUnauthorized(res);
      return;
    }

    const workspaceId = String(req.params.workspaceId);
    const existing = await prisma.teamWorkspace.findFirst({
    where: { id: workspaceId, organizationId: req.organizationId },
    });
    if (!existing) {
    sendNotFound(res, "Workspace not found");
    return;
    }
    const isOwner = existing.ownerUserId === req.userId;
    const isAdmin = req.userRole === "OWNER" || req.userRole === "ADMIN";
    if (!isOwner && !isAdmin) {
    sendForbidden(res, "permission_denied");
    return;
    }
    await prisma.teamWorkspace.delete({ where: { id: existing.id } });
    await auditLogs.record({
    organizationId: req.organizationId,
    actorUserId: req.userId,
    category: "WORKSPACE",
    action: "WORKSPACE_DELETED",
    targetType: "workspace",
    targetId: existing.id,
    severity: "WARN",
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    });
    sendSuccess(res, { deleted: true });
    
  }));

  // ── Shared Asset Library ───────────────────────────────────────────

  router.get("/assets", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.organizationId || !req.userId) {
      sendUnauthorized(res);
      return;
    }

    const workspaceId = (req.query.workspace_id as string | undefined)?.trim();
    const assignment = await prisma.userRoleAssignment.findUnique({
    where: { userId: req.userId },
    include: { roleProfile: true },
    });
    const roleKey = assignment?.roleProfile?.key ?? null;

    const assets = await prisma.sharedAsset.findMany({
    where: {
      organizationId: req.organizationId,
      ...(workspaceId ? { workspaceId } : {}),
      OR: [
        { ownerUserId: req.userId },
        { visibility: "ORG" },
        ...(roleKey ? [{ allowedRoleProfileKeys: { has: roleKey } }] : []),
      ],
    },
    orderBy: { updatedAt: "desc" },
    });
    sendSuccess(res, {
    assets: assets.map((a) => ({
      id: a.id,
      workspace_id: a.workspaceId,
      asset_type: a.assetType,
      title: a.title,
      description: a.description,
      source_story_id: a.sourceStoryId,
      source_page_id: a.sourcePageId,
      source_account_id: a.sourceAccountId,
      visibility: a.visibility,
      owner_user_id: a.ownerUserId,
      allowed_role_profile_keys: a.allowedRoleProfileKeys,
      metadata: a.metadata,
      created_at: a.createdAt.toISOString(),
      updated_at: a.updatedAt.toISOString(),
    })),
    });
    
  }));

  router.post("/assets", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.organizationId || !req.userId) {
      sendUnauthorized(res);
      return;
    }
    const payload = parseRequestBody(UpsertSharedAssetSchema, req.body, res);
    if (!payload) {
      return;
    }

    const d = payload;
    if (d.workspace_id) {
    const workspace = await prisma.teamWorkspace.findFirst({
      where: { id: d.workspace_id, organizationId: req.organizationId },
    });
    if (!workspace) {
      sendBadRequest(res, "workspace_not_found");
      return;
    }
    }
    const asset = await prisma.sharedAsset.create({
    data: {
      organizationId: req.organizationId,
      workspaceId: d.workspace_id ?? null,
      ownerUserId: req.userId,
      assetType: d.asset_type,
      title: d.title,
      description: d.description,
      sourceStoryId: d.source_story_id,
      sourcePageId: d.source_page_id,
      sourceAccountId: d.source_account_id,
      visibility: d.visibility,
      allowedRoleProfileKeys: d.allowed_role_profile_keys ?? [],
      metadata: (d.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
    });
    await auditLogs.record({
    organizationId: req.organizationId,
    actorUserId: req.userId,
    category: "WORKSPACE",
    action: "SHARED_ASSET_CREATED",
    targetType: "shared_asset",
    targetId: asset.id,
    severity: "INFO",
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    });
    sendCreated(res, { id: asset.id });
    
  }));

  router.patch("/assets/:assetId", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.organizationId || !req.userId) {
      sendUnauthorized(res);
      return;
    }
    const payload = parseRequestBody(UpsertSharedAssetSchema, req.body, res);
    if (!payload) {
      return;
    }

    const assetId = String(req.params.assetId);
    const existing = await prisma.sharedAsset.findFirst({
    where: { id: assetId, organizationId: req.organizationId },
    });
    if (!existing) {
    sendNotFound(res, "Asset not found");
    return;
    }
    const isOwner = existing.ownerUserId === req.userId;
    const isAdmin = req.userRole === "OWNER" || req.userRole === "ADMIN";
    if (!isOwner && !isAdmin) {
    sendForbidden(res, "permission_denied");
    return;
    }
    const d = payload;
    await prisma.sharedAsset.update({
    where: { id: existing.id },
    data: {
      workspaceId: d.workspace_id ?? null,
      assetType: d.asset_type,
      title: d.title,
      description: d.description,
      sourceStoryId: d.source_story_id,
      sourcePageId: d.source_page_id,
      sourceAccountId: d.source_account_id,
      visibility: d.visibility,
      allowedRoleProfileKeys: d.allowed_role_profile_keys ?? [],
      metadata: (d.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
    });
    sendSuccess(res, { updated: true });
    
  }));

  router.delete("/assets/:assetId", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.organizationId || !req.userId) {
      sendUnauthorized(res);
      return;
    }

    const assetId = String(req.params.assetId);
    const existing = await prisma.sharedAsset.findFirst({
    where: { id: assetId, organizationId: req.organizationId },
    });
    if (!existing) {
    sendNotFound(res, "Asset not found");
    return;
    }
    const isOwner = existing.ownerUserId === req.userId;
    const isAdmin = req.userRole === "OWNER" || req.userRole === "ADMIN";
    if (!isOwner && !isAdmin) {
    sendForbidden(res, "permission_denied");
    return;
    }
    await prisma.sharedAsset.delete({ where: { id: existing.id } });
    sendSuccess(res, { deleted: true });
    
  }));
}
