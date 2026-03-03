import { type Request, type Response, type Router } from "express";
import { z } from "zod";
import type {
  AccountScopeType,
  CRMProvider,
  PrismaClient,
  UserRole,
} from "@prisma/client";
import { PAGINATION_LIMITS } from "../../lib/pagination.js";
import { requirePermission } from "../../middleware/permissions.js";
import { AccountAccessService } from "../../services/account-access.js";
import type { AuditLogService } from "../../services/audit-log.js";
import logger from "../../lib/logger.js";
import { decodeDataGovernancePolicy } from "../../types/json-boundaries.js";
import { parsePaginationParams } from "../_shared/pagination.js";
import { parseRequestBody } from "../_shared/validators.js";

const GrantAccountAccessSchema = z.object({
  user_id: z.string().min(1),
  scope_type: z.enum(["ALL_ACCOUNTS", "SINGLE_ACCOUNT", "ACCOUNT_LIST", "CRM_REPORT"]),
  /** For SINGLE_ACCOUNT: the account ID */
  account_id: z.string().optional(),
  /** For ACCOUNT_LIST: array of account IDs */
  account_ids: z.array(z.string()).optional(),
  /** For CRM_REPORT: the report/list ID from Salesforce or HubSpot */
  crm_report_id: z.string().optional(),
  crm_provider: z.enum(["SALESFORCE", "HUBSPOT"]).optional(),
  crm_report_name: z.string().optional(),
});

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

interface RegisterAccountAccessRoutesOptions {
  router: Router;
  prisma: PrismaClient;
  auditLogs: AuditLogService;
}

export function registerAccountAccessRoutes({
  router,
  prisma,
  auditLogs,
}: RegisterAccountAccessRoutesOptions): void {
  // ── Admin: Account Access Control ──────────────────────────────────

  const accessService = new AccountAccessService(prisma);

  /**
   * GET /api/dashboard/access
   *
   * Lists all org users with their account access grants.
   */
  router.get(
    "/access",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const orgUsers = await prisma.user.findMany({
          where: { organizationId: req.organizationId },
          select: { id: true, name: true, email: true, role: true },
        });

        const users = await Promise.all(
          orgUsers.map(async (m: { id: string; name: string | null; email: string; role: string }) => {
            const grants = await accessService.listUserAccess(
              m.id,
              req.organizationId
            );
            return {
              user_id: m.id,
              user_name: m.name,
              user_email: m.email,
              role: m.role,
              grants: grants.map((g) => ({
                id: g.id,
                scope_type: g.scopeType,
                account: g.account
                  ? { id: g.account.id, name: g.account.name, domain: g.account.domain }
                  : null,
                cached_account_count: g.cachedAccountIds.length,
                crm_report_id: g.crmReportId,
                crm_provider: g.crmProvider,
                crm_report_name: g.crmReportName,
                last_synced_at: g.lastSyncedAt,
              })),
            };
          })
        );

        res.json({ users });
      } catch (err) {
        logger.error("Get all access error", { error: err });
        res.status(500).json({ error: "Failed to load access grants" });
      }
    }
  );

  /**
   * GET /api/dashboard/access/:userId
   *
   * Lists all account access grants for a specific user.
   */
  router.get(
    "/access/:userId",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const grants = await accessService.listUserAccess(
          req.params.userId as string,
          req.organizationId
        );
        res.json({
          grants: grants.map((g) => ({
            id: g.id,
            scope_type: g.scopeType,
            account: g.account
              ? { id: g.account.id, name: g.account.name, domain: g.account.domain }
              : null,
            cached_account_count: g.cachedAccountIds.length,
            crm_report_id: g.crmReportId,
            crm_provider: g.crmProvider,
            crm_report_name: g.crmReportName,
            last_synced_at: g.lastSyncedAt,
            created_at: g.createdAt,
          })),
        });
      } catch (err) {
        logger.error("Get access error", { error: err });
        res.status(500).json({ error: "Failed to load access grants" });
      }
    }
  );

  /**
   * POST /api/dashboard/access/grant
   *
   * Grants account access to a user. Supports:
   *   - ALL_ACCOUNTS: unrestricted
   *   - SINGLE_ACCOUNT: one account by ID
   *   - ACCOUNT_LIST: a manually curated set of account IDs
   *   - CRM_REPORT: a Salesforce report or HubSpot list
   */
  router.post(
    "/access/grant",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      const payload = parseRequestBody(GrantAccountAccessSchema, req.body, res);
      if (!payload) {
        return;
      }

      try {
        const grantId = await accessService.grantAccess({
          userId: payload.user_id,
          organizationId: req.organizationId,
          scopeType: payload.scope_type as AccountScopeType,
          accountId: payload.account_id,
          accountIds: payload.account_ids,
          crmReportId: payload.crm_report_id,
          crmProvider: payload.crm_provider as CRMProvider | undefined,
          crmReportName: payload.crm_report_name,
          grantedById: req.userId,
        });

        await auditLogs.record({
          organizationId: req.organizationId,
          actorUserId: req.userId,
          category: "ACCESS_CONTROL",
          action: "ACCOUNT_ACCESS_GRANTED",
          targetType: "user",
          targetId: payload.user_id,
          severity: "WARN",
          metadata: {
            grant_id: grantId,
            scope_type: payload.scope_type,
            account_id: payload.account_id,
            account_ids_count: payload.account_ids?.length ?? 0,
            crm_report_id: payload.crm_report_id,
            crm_provider: payload.crm_provider,
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });

        // If CRM_REPORT, trigger an initial sync
        if (payload.scope_type === "CRM_REPORT") {
          try {
            const syncResult = await accessService.syncCrmReportGrant(grantId);
            res.json({ granted: true, grant_id: grantId, synced_accounts: syncResult.accountCount });
            return;
          } catch {
            // Sync failed but grant was created — user can retry sync later
          }
        }

        res.json({ granted: true, grant_id: grantId });
      } catch (err) {
        logger.error("Grant access error", { error: err });
        res.status(500).json({ error: "Failed to grant account access" });
      }
    }
  );

  /**
   * DELETE /api/dashboard/access/:grantId
   *
   * Revokes a specific account access grant.
   */
  router.delete(
    "/access/:grantId",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const grant = await prisma.userAccountAccess.findFirst({
          where: {
            id: req.params.grantId as string,
            organizationId: req.organizationId,
          },
          select: { id: true, userId: true, scopeType: true },
        });
        if (!grant) {
          res.status(404).json({ error: "Access grant not found" });
          return;
        }

        await accessService.revokeAccess(req.params.grantId as string);
        await auditLogs.record({
          organizationId: req.organizationId,
          actorUserId: req.userId,
          category: "ACCESS_CONTROL",
          action: "ACCOUNT_ACCESS_REVOKED",
          targetType: "access_grant",
          targetId: grant.id,
          severity: "WARN",
          metadata: { target_user_id: grant.userId, scope_type: grant.scopeType },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        });
        res.json({ revoked: true });
      } catch (err) {
        logger.error("Revoke access error", { error: err });
        res.status(500).json({ error: "Failed to revoke access" });
      }
    }
  );

  /**
   * POST /api/dashboard/access/:grantId/sync
   *
   * Manually triggers a CRM report sync for a grant.
   */
  router.post(
    "/access/:grantId/sync",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const result = await accessService.syncCrmReportGrant(req.params.grantId as string);
        res.json({ synced: true, account_count: result.accountCount });
      } catch (err) {
        logger.error("Sync CRM report error", { error: err });
        res.status(500).json({ error: "Failed to sync CRM report" });
      }
    }
  );

  router.get(
    "/audit-logs",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const { limit } = parsePaginationParams(
          {
            limit: req.query.limit,
          },
          {
            limit: PAGINATION_LIMITS.LIST_DEFAULT,
            maxLimit: PAGINATION_LIMITS.LIST_MAX,
          }
        );
        const category = (req.query.category as string | undefined)?.trim();
        const actorUserId = (req.query.actor_user_id as string | undefined)?.trim();
        const action = (req.query.action as string | undefined)?.trim();
        const severity = (req.query.severity as string | undefined)?.trim();
        const targetType = (req.query.target_type as string | undefined)?.trim();
        const targetId = (req.query.target_id as string | undefined)?.trim();
        const before = (req.query.before as string | undefined)?.trim();
        const cursorCreatedAt = before ? new Date(before) : null;
        const hasCursor = !!cursorCreatedAt && !Number.isNaN(cursorCreatedAt.getTime());

        const logs = await prisma.auditLog.findMany({
          where: {
            organizationId: req.organizationId,
            ...(category ? { category } : {}),
            ...(actorUserId ? { actorUserId } : {}),
            ...(action ? { action } : {}),
            ...(severity ? { severity } : {}),
            ...(targetType ? { targetType } : {}),
            ...(targetId ? { targetId } : {}),
            ...(hasCursor ? { createdAt: { lt: cursorCreatedAt! } } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: limit + 1,
        });

        const hasMore = logs.length > limit;
        const page = hasMore ? logs.slice(0, limit) : logs;
        const nextCursor = hasMore
          ? page[page.length - 1]?.createdAt.toISOString() ?? null
          : null;

        res.json({
          logs: page.map((l) => ({
            id: l.id,
            created_at: l.createdAt.toISOString(),
            actor_user_id: l.actorUserId,
            category: l.category,
            action: l.action,
            schema_version: l.schemaVersion,
            target_type: l.targetType,
            target_id: l.targetId,
            severity: l.severity,
            metadata: l.metadata,
            ip_address: l.ipAddress,
            user_agent: l.userAgent,
            expires_at: l.expiresAt?.toISOString() ?? null,
          })),
          page: {
            has_more: hasMore,
            next_cursor: nextCursor,
          },
        });
      } catch (err) {
        logger.error("Get audit logs error", { error: err });
        res.status(500).json({ error: "Failed to load audit logs" });
      }
    }
  );

  router.get(
    "/audit-logs/export",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const settings = await prisma.orgSettings.findUnique({
          where: { organizationId: req.organizationId },
          select: { dataGovernancePolicy: true },
        });
        const policy = decodeDataGovernancePolicy(settings?.dataGovernancePolicy);
        if (policy.pii_export_enabled === false) {
          res.status(403).json({
            error: "policy_denied",
            message: "Exports are disabled by your organization's data governance policy.",
          });
          return;
        }

        const format = ((req.query.format as string | undefined) ?? "csv").toLowerCase();
        const { limit } = parsePaginationParams(
          {
            limit: req.query.limit,
          },
          {
            limit: PAGINATION_LIMITS.EXPORT_DEFAULT,
            maxLimit: PAGINATION_LIMITS.EXPORT_MAX,
          }
        );
        const category = (req.query.category as string | undefined)?.trim();
        const actorUserId = (req.query.actor_user_id as string | undefined)?.trim();
        const action = (req.query.action as string | undefined)?.trim();
        const severity = (req.query.severity as string | undefined)?.trim();
        const targetType = (req.query.target_type as string | undefined)?.trim();
        const targetId = (req.query.target_id as string | undefined)?.trim();

        const logs = await prisma.auditLog.findMany({
          where: {
            organizationId: req.organizationId,
            ...(category ? { category } : {}),
            ...(actorUserId ? { actorUserId } : {}),
            ...(action ? { action } : {}),
            ...(severity ? { severity } : {}),
            ...(targetType ? { targetType } : {}),
            ...(targetId ? { targetId } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: limit,
        });

        if (format === "json") {
          res.setHeader("Content-Type", "application/json");
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="audit-logs-${new Date().toISOString().slice(0, 10)}.json"`
          );
          res.send(
            JSON.stringify(
              logs.map((l) => ({
                id: l.id,
                created_at: l.createdAt.toISOString(),
                actor_user_id: l.actorUserId,
                category: l.category,
                action: l.action,
                schema_version: l.schemaVersion,
                target_type: l.targetType,
                target_id: l.targetId,
                severity: l.severity,
                metadata: l.metadata,
                ip_address: l.ipAddress,
                user_agent: l.userAgent,
                expires_at: l.expiresAt?.toISOString() ?? null,
              })),
              null,
              2
            )
          );
          return;
        }

        const csvEscape = (value: unknown): string => {
          const raw = value == null ? "" : String(value);
          const escaped = raw.replace(/"/g, '""');
          return `"${escaped}"`;
        };
        const header = [
          "id",
          "created_at",
          "actor_user_id",
          "category",
          "action",
          "schema_version",
          "target_type",
          "target_id",
          "severity",
          "metadata",
          "ip_address",
          "user_agent",
          "expires_at",
        ];
        const rows = logs.map((l) =>
          [
            l.id,
            l.createdAt.toISOString(),
            l.actorUserId,
            l.category,
            l.action,
            l.schemaVersion,
            l.targetType,
            l.targetId,
            l.severity,
            JSON.stringify(l.metadata ?? {}),
            l.ipAddress,
            l.userAgent,
            l.expiresAt?.toISOString() ?? "",
          ]
            .map(csvEscape)
            .join(",")
        );

        const csv = [header.join(","), ...rows].join("\n");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="audit-logs-${new Date().toISOString().slice(0, 10)}.csv"`
        );
        res.send(csv);
      } catch (err) {
        logger.error("Export audit logs error", { error: err });
        res.status(500).json({ error: "Failed to export audit logs" });
      }
    }
  );

  router.get(
    "/audit-logs/actor/:actorUserId",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const organizationId = req.organizationId;
        const rawActorUserId = req.params.actorUserId;
        const actorUserId = (
          Array.isArray(rawActorUserId)
            ? (rawActorUserId[0] ?? "")
            : (rawActorUserId ?? "")
        ).trim();
        if (!actorUserId) {
          res.status(400).json({ error: "actor_user_id_required" });
          return;
        }

        const [actor, totalEvents, recentEvents] = await Promise.all([
          prisma.user.findFirst({
            where: { id: actorUserId, organizationId },
            select: { id: true, name: true, email: true, role: true },
          }),
          prisma.auditLog.count({
            where: { organizationId, actorUserId },
          }),
          prisma.auditLog.findMany({
            where: { organizationId, actorUserId },
            select: {
              id: true,
              createdAt: true,
              category: true,
              action: true,
              targetType: true,
              targetId: true,
              severity: true,
            },
            orderBy: { createdAt: "desc" },
            take: 20,
          }),
        ]);

        res.json({
          actor: actor
            ? {
                id: actor.id,
                name: actor.name,
                email: actor.email,
                role: actor.role,
              }
            : { id: actorUserId, name: null, email: null, role: null },
          total_events: totalEvents,
          recent_events: recentEvents.map((e) => ({
            id: e.id,
            created_at: e.createdAt.toISOString(),
            category: e.category,
            action: e.action,
            target_type: e.targetType,
            target_id: e.targetId,
            severity: e.severity,
          })),
        });
      } catch (err) {
        logger.error("Get audit actor drilldown error", { error: err });
        res.status(500).json({ error: "Failed to load actor drilldown" });
      }
    }
  );

  router.get(
    "/audit-logs/resource",
    requirePermission(prisma, "manage_permissions"),
    async (req: AuthReq, res: Response) => {
      try {
        const organizationId = req.organizationId;
        const targetType = (req.query.target_type as string | undefined)?.trim();
        const targetId = (req.query.target_id as string | undefined)?.trim();
        if (!targetType || !targetId) {
          res.status(400).json({ error: "target_type_and_target_id_required" });
          return;
        }

        const [totalEvents, recentEvents] = await Promise.all([
          prisma.auditLog.count({
            where: { organizationId, targetType, targetId },
          }),
          prisma.auditLog.findMany({
            where: { organizationId, targetType, targetId },
            select: {
              id: true,
              createdAt: true,
              actorUserId: true,
              category: true,
              action: true,
              severity: true,
            },
            orderBy: { createdAt: "desc" },
            take: 20,
          }),
        ]);

        res.json({
          resource: {
            target_type: targetType,
            target_id: targetId,
          },
          total_events: totalEvents,
          recent_events: recentEvents.map((e) => ({
            id: e.id,
            created_at: e.createdAt.toISOString(),
            actor_user_id: e.actorUserId,
            category: e.category,
            action: e.action,
            severity: e.severity,
          })),
        });
      } catch (err) {
        logger.error("Get audit resource drilldown error", { error: err });
        res.status(500).json({ error: "Failed to load resource drilldown" });
      }
    }
  );
}
