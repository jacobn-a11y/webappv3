/**
 * Ops Diagnostics Routes — Compatibility Shim
 *
 * Delegates to decomposed sub-modules:
 *   - ops-diagnostics/health-routes.ts
 *   - ops-diagnostics/runs-routes.ts
 *   - ops-diagnostics/audit-routes.ts
 */

import type { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import type { AuditLogService } from "../../services/audit-log.js";
import { OpsDiagnosticsService } from "../../services/ops-diagnostics.js";
import { registerHealthRoutes } from "./ops-diagnostics/health-routes.js";
import { registerRunsRoutes } from "./ops-diagnostics/runs-routes.js";
import { registerAuditRoutes } from "./ops-diagnostics/audit-routes.js";

interface RegisterOpsDiagnosticsRoutesOptions {
  router: Router;
  prisma: PrismaClient;
  auditLogs: AuditLogService;
}

export function registerOpsDiagnosticsRoutes({
  router,
  prisma,
  auditLogs,
}: RegisterOpsDiagnosticsRoutesOptions): void {
  const service = new OpsDiagnosticsService(prisma);
  registerHealthRoutes({ router, prisma, service });
  registerRunsRoutes({ router, prisma, service });
  registerAuditRoutes({ router, prisma, auditLogs });
}
