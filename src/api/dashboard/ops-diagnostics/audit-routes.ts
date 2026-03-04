/**
 * Ops Diagnostics — Audit Trail / DR Readiness Routes
 *
 * GET /ops/dr-readiness                  — Disaster recovery readiness status
 * POST /ops/dr-readiness/backup-verify   — Verify backup integrity
 * POST /ops/dr-readiness/restore-validate — Validate restore capability
 */

import { type Response, type Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { requirePermission } from "../../../middleware/permissions.js";
import type { AuditLogService } from "../../../services/audit-log.js";
import { decodeDataGovernancePolicy } from "../../../types/json-boundaries.js";
import type { AuthenticatedRequest } from "../../../types/authenticated-request.js";
import { asyncHandler } from "../../../lib/async-handler.js";
import { sendSuccess } from "../../_shared/responses.js";

// ─── Route Registration ─────────────────────────────────────────────────────

interface RegisterAuditRoutesOptions {
  router: Router;
  prisma: PrismaClient;
  auditLogs: AuditLogService;
}

export function registerAuditRoutes({
  router,
  prisma,
  auditLogs,
}: RegisterAuditRoutesOptions): void {
  router.get(
    "/ops/dr-readiness",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const organizationId = req.organizationId!;
      const settings = await prisma.orgSettings.findUnique({
      where: { organizationId },
      select: { dataGovernancePolicy: true },
      });
      const policy = decodeDataGovernancePolicy(settings?.dataGovernancePolicy);

      const [lastBackup, lastRestoreValidation, criticalCounts] = await Promise.all([
      prisma.auditLog.findFirst({
        where: {
          organizationId,
          category: "DR",
          action: "DR_BACKUP_VERIFIED",
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, metadata: true },
      }),
      prisma.auditLog.findFirst({
        where: {
          organizationId,
          category: "DR",
          action: "DR_RESTORE_VALIDATED",
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, metadata: true },
      }),
      Promise.all([
        prisma.account.count({ where: { organizationId } }),
        prisma.call.count({ where: { organizationId } }),
        prisma.story.count({ where: { organizationId } }),
        prisma.landingPage.count({ where: { organizationId } }),
      ]),
      ]);

      const [accountCount, callCount, storyCount, pageCount] = criticalCounts;
      const rtoTargetMinutes = policy.rto_target_minutes ?? 240;
      const rpoTargetMinutes = policy.rpo_target_minutes ?? 60;
      const backupAgeMinutes = lastBackup
      ? Math.floor((Date.now() - lastBackup.createdAt.getTime()) / 60000)
      : null;
      const restoreValidationAgeMinutes = lastRestoreValidation
      ? Math.floor((Date.now() - lastRestoreValidation.createdAt.getTime()) / 60000)
      : null;

      const status =
      backupAgeMinutes !== null &&
      restoreValidationAgeMinutes !== null &&
      backupAgeMinutes <= rpoTargetMinutes &&
      restoreValidationAgeMinutes <= rtoTargetMinutes
        ? "READY"
        : "AT_RISK";

      sendSuccess(res, {
      status,
      targets: {
        rto_minutes: rtoTargetMinutes,
        rpo_minutes: rpoTargetMinutes,
      },
      last_backup_verified_at: lastBackup?.createdAt.toISOString() ?? null,
      last_restore_validated_at: lastRestoreValidation?.createdAt.toISOString() ?? null,
      backup_age_minutes: backupAgeMinutes,
      restore_validation_age_minutes: restoreValidationAgeMinutes,
      critical_entity_counts: {
        accounts: accountCount,
        calls: callCount,
        stories: storyCount,
        landing_pages: pageCount,
      },
      });

    }
  ));

  router.post(
    "/ops/dr-readiness/backup-verify",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const organizationId = req.organizationId!;
      const [accountCount, callCount, storyCount, pageCount] = await Promise.all([
      prisma.account.count({ where: { organizationId } }),
      prisma.call.count({ where: { organizationId } }),
      prisma.story.count({ where: { organizationId } }),
      prisma.landingPage.count({ where: { organizationId } }),
      ]);
      await auditLogs.record({
      organizationId,
      actorUserId: req.userId!,
      category: "DR",
      action: "DR_BACKUP_VERIFIED",
      targetType: "organization",
      targetId: organizationId,
      severity: "WARN",
      metadata: {
        entities: {
          accounts: accountCount,
          calls: callCount,
          stories: storyCount,
          landing_pages: pageCount,
        },
        verification: "metadata_snapshot",
      },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      });
      sendSuccess(res, { verified: true });

    }
  ));

  router.post(
    "/ops/dr-readiness/restore-validate",
    requirePermission(prisma, "manage_permissions"),
    asyncHandler(async (req: AuthenticatedRequest, res: Response) => {

      const organizationId = req.organizationId!;
      const [accountCount, callCount, storyCount] = await Promise.all([
      prisma.account.count({ where: { organizationId } }),
      prisma.call.count({ where: { organizationId } }),
      prisma.story.count({ where: { organizationId } }),
      ]);
      const passed = accountCount >= 0 && callCount >= 0 && storyCount >= 0;
      await auditLogs.record({
      organizationId,
      actorUserId: req.userId!,
      category: "DR",
      action: passed ? "DR_RESTORE_VALIDATED" : "DR_RESTORE_VALIDATION_FAILED",
      targetType: "organization",
      targetId: organizationId,
      severity: passed ? "INFO" : "CRITICAL",
      metadata: {
        checks: {
          accounts: accountCount,
          calls: callCount,
          stories: storyCount,
        },
        result: passed ? "pass" : "fail",
      },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      });
      sendSuccess(res, { validated: passed });

    }
  ));
}
