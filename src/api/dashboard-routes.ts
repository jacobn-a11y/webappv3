/**
 * Landing Page Dashboard & Admin Routes
 *
 * Provides:
 *   - Dashboard overview (stats, page list with filters)
 *   - Admin permission management (grant/revoke, org settings)
 */

import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { LandingPageEditor } from "../services/landing-page-editor.js";
import { PermissionManager } from "../middleware/permissions.js";
import { RoleProfileService } from "../services/role-profiles.js";
import { AuditLogService } from "../services/audit-log.js";
import { FeatureFlagService } from "../services/feature-flags.js";
import { ResponseCache } from "../lib/response-cache.js";
import {
  applySupportImpersonation,
  requireImpersonationWriteScope,
} from "../middleware/support-impersonation.js";
import { registerAdminSettingsRoutes } from "./dashboard/admin-settings-routes.js";
import { registerDashboardOverviewRoutes } from "./dashboard/overview-routes.js";
import { registerTenantSupportRoutes } from "./dashboard/tenant-support-routes.js";
import { registerSecurityRoutes } from "./dashboard/security-routes.js";
import { registerSupportImpersonationRoutes } from "./dashboard/support-impersonation-routes.js";
import { registerAdminOpsRoutes } from "./dashboard/admin-ops-routes.js";
import { registerAccessControlRoutes } from "./dashboard/access-control-routes.js";
import { registerCollaborationRoutes } from "./dashboard/collaboration-routes.js";
import { registerWritebackRoutes } from "./dashboard/writeback-routes.js";
import { registerAutomationRoutes } from "./dashboard/automation-routes.js";
import { registerAccountAccessRoutes } from "./dashboard/account-access-routes.js";
import { registerBillingReadinessRoutes } from "./dashboard/billing-readiness-routes.js";
import { registerAccountReportingRoutes } from "./dashboard/account-reporting-routes.js";
import { registerArtifactGovernanceRoutes } from "./dashboard/artifact-governance-routes.js";
import { registerDataQualityRoutes } from "./dashboard/data-quality-routes.js";
import { registerSellerAdoptionRoutes } from "./dashboard/seller-adoption-routes.js";
import type { RAGEngine } from "../services/rag-engine.js";
import { OpsDiagnosticsService } from "../services/ops-diagnostics.js";
import { registerHealthRoutes } from "./dashboard/ops-diagnostics/health-routes.js";
import { registerRunsRoutes } from "./dashboard/ops-diagnostics/runs-routes.js";
import { registerAuditRoutes } from "./dashboard/ops-diagnostics/audit-routes.js";

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createDashboardRoutes(
  prisma: PrismaClient,
  ragEngine?: RAGEngine
): Router {
  const router = Router();
  const editor = new LandingPageEditor(prisma);
  const permManager = new PermissionManager(prisma);
  const roleProfiles = new RoleProfileService(prisma);
  const auditLogs = new AuditLogService(prisma);
  const featureFlags = new FeatureFlagService(prisma);
  const homeCache = new ResponseCache<Record<string, unknown>>(30_000);

  // Support impersonation can apply target-user context with audited guardrails.
  router.use(applySupportImpersonation(prisma));
  router.use(requireImpersonationWriteScope);

  const deleteGovernedTarget = async (
    organizationId: string,
    targetType: "CALL" | "STORY" | "LANDING_PAGE",
    targetId: string
  ): Promise<boolean> => {
    if (targetType === "CALL") {
      if (ragEngine) {
        await ragEngine.pruneVectorsForCall({
          organizationId,
          callId: targetId,
        });
      }
      const result = await prisma.call.deleteMany({
        where: { id: targetId, organizationId },
      });
      return result.count > 0;
    }
    if (targetType === "STORY") {
      const result = await prisma.story.deleteMany({
        where: {
          id: targetId,
          organizationId,
          landingPages: { none: {} },
        },
      });
      return result.count > 0;
    }
    const result = await prisma.landingPage.deleteMany({
      where: { id: targetId, organizationId },
    });
    return result.count > 0;
  };

  registerDashboardOverviewRoutes({
    router,
    prisma,
    editor,
    homeCache,
  });

  registerAdminSettingsRoutes({
    router,
    prisma,
    permManager,
    auditLogs,
    deleteGovernedTarget,
  });

  registerArtifactGovernanceRoutes({
    router,
    prisma,
    auditLogs,
  });

  registerDataQualityRoutes({
    router,
    prisma,
    auditLogs,
  });

  registerSecurityRoutes({
    router,
    prisma,
    auditLogs,
  });

  registerSupportImpersonationRoutes({
    router,
    prisma,
    auditLogs,
  });

  registerAdminOpsRoutes({
    router,
    prisma,
    auditLogs,
    featureFlags,
  });

  registerAccessControlRoutes({
    router,
    prisma,
    permManager,
    roleProfiles,
    auditLogs,
  });

  registerCollaborationRoutes({
    router,
    prisma,
    auditLogs,
  });

  registerWritebackRoutes({
    router,
    prisma,
    auditLogs,
  });

  registerAutomationRoutes({
    router,
    prisma,
    auditLogs,
  });

  registerAccountAccessRoutes({
    router,
    prisma,
    auditLogs,
  });

  const opsDiagnostics = new OpsDiagnosticsService(prisma);
  registerHealthRoutes({ router, prisma, service: opsDiagnostics });
  registerRunsRoutes({ router, prisma, service: opsDiagnostics });
  registerAuditRoutes({ router, prisma, auditLogs });

  registerBillingReadinessRoutes({
    router,
    prisma,
    auditLogs,
    featureFlags,
  });

  registerAccountReportingRoutes({
    router,
    prisma,
  });

  registerTenantSupportRoutes({
    router,
    prisma,
  });

  registerSellerAdoptionRoutes({
    router,
    prisma,
    auditLogs,
  });

  return router;
}
