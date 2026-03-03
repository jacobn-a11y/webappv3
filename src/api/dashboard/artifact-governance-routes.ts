import { type Request, type Response, type Router } from "express";
import { z } from "zod";
import type { PrismaClient, UserRole } from "@prisma/client";
import { requirePermission } from "../../middleware/permissions.js";
import type { AuditLogService } from "../../services/audit-log.js";
import logger from "../../lib/logger.js";
import { parseRequestBody } from "../_shared/validators.js";

const ArtifactGovernancePolicySchema = z.object({
  approval_chain_enabled: z.boolean().optional(),
  max_expiration_days: z.number().int().min(1).max(3650).nullable().optional(),
  require_provenance: z.boolean().optional(),
});

const ArtifactApprovalStepSchema = z.object({
  step_order: z.number().int().min(1).max(50),
  min_approvals: z.number().int().min(1).max(20).default(1),
  required_role_profile_key: z.string().min(1).max(64).optional(),
  required_user_role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]).optional(),
  approver_scope_type: z
    .enum(["ROLE_PROFILE", "TEAM", "USER", "GROUP", "SELF"])
    .default("ROLE_PROFILE"),
  approver_scope_value: z.string().min(1).max(128).optional(),
  allow_self_approval: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

const UpsertArtifactApprovalStepsSchema = z.object({
  steps: z.array(ArtifactApprovalStepSchema).max(50),
});

const CreateApprovalGroupSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
});

const AddApprovalGroupMemberSchema = z.object({
  user_id: z.string().min(1),
});

const ReplaceTeamApprovalScopesSchema = z.object({
  team_keys: z.array(z.string().min(1).max(64)).max(50),
});

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

interface RegisterArtifactGovernanceRoutesOptions {
  router: Router;
  prisma: PrismaClient;
  auditLogs: AuditLogService;
}

export function registerArtifactGovernanceRoutes({
  router,
  prisma,
  auditLogs,
}: RegisterArtifactGovernanceRoutesOptions): void {
  // ── Admin: Artifact Governance (Publish Lifecycle) ────────────────

  router.get(
    "/artifact-governance",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const policy = await prisma.artifactGovernancePolicy.findUnique({
          where: { organizationId: req.organizationId },
          include: {
            approvalSteps: {
              orderBy: { stepOrder: "asc" },
            },
          },
        });

        if (!policy) {
          res.json({
            approval_chain_enabled: false,
            max_expiration_days: null,
            require_provenance: true,
            steps: [],
          });
          return;
        }

        res.json({
          approval_chain_enabled: policy.approvalChainEnabled,
          max_expiration_days: policy.maxExpirationDays,
          require_provenance: policy.requireProvenance,
          steps: policy.approvalSteps.map((s) => ({
            id: s.id,
            step_order: s.stepOrder,
            min_approvals: s.minApprovals,
            required_role_profile_key: s.requiredRoleProfileKey,
            required_user_role: s.requiredUserRole,
            approver_scope_type: s.approverScopeType,
            approver_scope_value: s.approverScopeValue,
            allow_self_approval: s.allowSelfApproval,
            enabled: s.enabled,
          })),
        });
      } catch (err) {
        logger.error("Get artifact governance policy error", { error: err });
        res.status(500).json({ error: "Failed to load artifact governance policy" });
      }
    }
  );

  router.patch(
    "/artifact-governance",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const payload = parseRequestBody(ArtifactGovernancePolicySchema, req.body, res);
      if (!payload) {
        return;
      }

      try {
        const d = payload;
        const policy = await prisma.artifactGovernancePolicy.upsert({
          where: { organizationId: req.organizationId },
          create: {
            organizationId: req.organizationId,
            artifactType: "LANDING_PAGE",
            approvalChainEnabled: d.approval_chain_enabled ?? false,
            maxExpirationDays: d.max_expiration_days ?? null,
            requireProvenance: d.require_provenance ?? true,
          },
          update: {
            approvalChainEnabled: d.approval_chain_enabled,
            maxExpirationDays: d.max_expiration_days,
            requireProvenance: d.require_provenance,
          },
        });

        await auditLogs.record({
          organizationId: req.organizationId,
          actorUserId: req.userId,
          category: "POLICY",
          action: "ARTIFACT_GOVERNANCE_POLICY_UPDATED",
          targetType: "artifact_governance_policy",
          targetId: policy.id,
          severity: "WARN",
          metadata: {
            approval_chain_enabled: policy.approvalChainEnabled,
            max_expiration_days: policy.maxExpirationDays,
            require_provenance: policy.requireProvenance,
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });

        res.json({ updated: true });
      } catch (err) {
        logger.error("Update artifact governance policy error", { error: err });
        res.status(500).json({ error: "Failed to update artifact governance policy" });
      }
    }
  );

  router.put(
    "/artifact-governance/steps",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const payload = parseRequestBody(UpsertArtifactApprovalStepsSchema, req.body, res);
      if (!payload) {
        return;
      }

      const orgId = req.organizationId;

      try {
        const duplicateOrders = new Set<number>();
        const seenOrders = new Set<number>();
        for (const step of payload.steps) {
          if (seenOrders.has(step.step_order)) {
            duplicateOrders.add(step.step_order);
          }
          seenOrders.add(step.step_order);
        }
        if (duplicateOrders.size > 0) {
          res.status(400).json({
            error: "validation_error",
            message: "Each approval step_order must be unique.",
          });
          return;
        }

        const policy = await prisma.artifactGovernancePolicy.upsert({
          where: { organizationId: orgId },
          create: {
            organizationId: orgId,
            artifactType: "LANDING_PAGE",
            approvalChainEnabled: true,
            requireProvenance: true,
          },
          update: {},
        });

        await prisma.$transaction(async (tx) => {
          await tx.artifactApprovalStep.deleteMany({
            where: { governancePolicyId: policy.id },
          });

          if (payload.steps.length > 0) {
            await tx.artifactApprovalStep.createMany({
              data: payload.steps.map((step) => ({
                governancePolicyId: policy.id,
                organizationId: orgId,
                stepOrder: step.step_order,
                minApprovals: step.min_approvals,
                requiredRoleProfileKey: step.required_role_profile_key ?? null,
                requiredUserRole: step.required_user_role ?? null,
                approverScopeType: step.approver_scope_type,
                approverScopeValue: step.approver_scope_value ?? null,
                allowSelfApproval: step.allow_self_approval,
                enabled: step.enabled,
              })),
            });
          }
        });

        await auditLogs.record({
          organizationId: orgId,
          actorUserId: req.userId,
          category: "POLICY",
          action: "ARTIFACT_APPROVAL_STEPS_UPDATED",
          targetType: "artifact_governance_policy",
          targetId: policy.id,
          severity: "WARN",
          metadata: { step_count: payload.steps.length },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });

        res.json({ updated: true, steps_count: payload.steps.length });
      } catch (err) {
        logger.error("Upsert artifact approval steps error", { error: err });
        res.status(500).json({ error: "Failed to update artifact approval steps" });
      }
    }
  );

  router.get(
    "/approval-groups",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const groups = await prisma.approvalGroup.findMany({
          where: { organizationId: req.organizationId },
          include: {
            members: {
              include: {
                user: { select: { id: true, name: true, email: true, role: true } },
              },
            },
            owner: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: "desc" },
        });

        res.json({
          groups: groups.map((g) => ({
            id: g.id,
            name: g.name,
            description: g.description,
            owner: g.owner,
            members: g.members.map((m) => ({
              id: m.user.id,
              name: m.user.name,
              email: m.user.email,
              role: m.user.role,
            })),
            created_at: g.createdAt.toISOString(),
            updated_at: g.updatedAt.toISOString(),
          })),
        });
      } catch (err) {
        logger.error("List approval groups error", { error: err });
        res.status(500).json({ error: "Failed to load approval groups" });
      }
    }
  );

  router.post(
    "/approval-groups",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const payload = parseRequestBody(CreateApprovalGroupSchema, req.body, res);
      if (!payload) {
        return;
      }
      try {
        const group = await prisma.approvalGroup.create({
          data: {
            organizationId: req.organizationId,
            name: payload.name.trim(),
            description: payload.description?.trim() || null,
            ownerUserId: req.userId ?? null,
          },
        });
        res.status(201).json({
          id: group.id,
          name: group.name,
          description: group.description,
        });
      } catch (err) {
        logger.error("Create approval group error", { error: err });
        res.status(500).json({ error: "Failed to create approval group" });
      }
    }
  );

  router.post(
    "/approval-groups/:groupId/members",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const payload = parseRequestBody(AddApprovalGroupMemberSchema, req.body, res);
      if (!payload) {
        return;
      }
      try {
        const group = await prisma.approvalGroup.findFirst({
          where: { id: req.params.groupId as string, organizationId: req.organizationId },
        });
        if (!group) {
          res.status(404).json({ error: "Approval group not found" });
          return;
        }
        const user = await prisma.user.findFirst({
          where: { id: payload.user_id, organizationId: req.organizationId },
        });
        if (!user) {
          res.status(404).json({ error: "User not found" });
          return;
        }

        await prisma.approvalGroupMember.upsert({
          where: {
            groupId_userId: {
              groupId: group.id,
              userId: user.id,
            },
          },
          create: {
            organizationId: req.organizationId,
            groupId: group.id,
            userId: user.id,
          },
          update: {},
        });

        res.json({ added: true });
      } catch (err) {
        logger.error("Add approval group member error", { error: err });
        res.status(500).json({ error: "Failed to add group member" });
      }
    }
  );

  router.delete(
    "/approval-groups/:groupId/members/:userId",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const deleted = await prisma.approvalGroupMember.deleteMany({
          where: {
            organizationId: req.organizationId,
            groupId: req.params.groupId as string,
            userId: req.params.userId as string,
          },
        });
        res.json({ removed: deleted.count > 0 });
      } catch (err) {
        logger.error("Remove approval group member error", { error: err });
        res.status(500).json({ error: "Failed to remove group member" });
      }
    }
  );

  router.get(
    "/approval-admin-scopes",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const rows = await prisma.teamApprovalAdminScope.findMany({
          where: { organizationId: req.organizationId },
          include: { user: { select: { id: true, name: true, email: true } } },
          orderBy: [{ userId: "asc" }, { teamKey: "asc" }],
        });
        const grouped = new Map<
          string,
          { user: { id: string; name: string | null; email: string }; team_keys: string[] }
        >();
        for (const row of rows) {
          const existing = grouped.get(row.userId);
          if (existing) {
            existing.team_keys.push(row.teamKey);
          } else {
            grouped.set(row.userId, {
              user: row.user,
              team_keys: [row.teamKey],
            });
          }
        }
        res.json({ scopes: Array.from(grouped.values()) });
      } catch (err) {
        logger.error("List team approval admin scopes error", { error: err });
        res.status(500).json({ error: "Failed to load team approval admin scopes" });
      }
    }
  );

  router.put(
    "/approval-admin-scopes/:userId",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const payload = parseRequestBody(ReplaceTeamApprovalScopesSchema, req.body, res);
      if (!payload) {
        return;
      }
      try {
        const userId = req.params.userId as string;
        const user = await prisma.user.findFirst({
          where: { id: userId, organizationId: req.organizationId },
        });
        if (!user) {
          res.status(404).json({ error: "User not found" });
          return;
        }
        await prisma.$transaction(async (tx) => {
          await tx.teamApprovalAdminScope.deleteMany({
            where: { organizationId: req.organizationId, userId },
          });
          if (payload.team_keys.length > 0) {
            await tx.teamApprovalAdminScope.createMany({
              data: payload.team_keys.map((teamKey) => ({
                organizationId: req.organizationId,
                userId,
                teamKey,
              })),
            });
          }
        });
        res.json({ updated: true, team_keys: payload.team_keys });
      } catch (err) {
        logger.error("Replace team approval admin scopes error", { error: err });
        res.status(500).json({ error: "Failed to update team approval admin scopes" });
      }
    }
  );
}
