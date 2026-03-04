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
  registerHealthRoutes({ router, prisma });
  registerRunsRoutes({ router, prisma });
  registerAuditRoutes({ router, prisma, auditLogs });
}
