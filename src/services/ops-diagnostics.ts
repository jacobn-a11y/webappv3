import type { PrismaClient } from "@prisma/client";
import { decodeDataGovernancePolicy } from "../types/json-boundaries.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IntegrationHealthItem {
  id: string;
  provider: string;
  enabled: boolean;
  status: string;
  lag_minutes: number | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_failure_error: string | null;
  throughput_recent: number;
  failures_recent: number;
}

export interface DiagnosticsSnapshot {
  integrationConfigs: Array<{
    id: string;
    provider: string;
    enabled: boolean;
    status: string;
    lastSyncAt: Date | null;
    lastError: string | null;
    updatedAt: Date;
  }>;
  recentAuditLogs: Array<{
    id: string;
    createdAt: Date;
    category: string;
    action: string;
    severity: string;
  }>;
  unresolvedNotifications: Array<{
    id: string;
    type: string;
    createdAt: Date;
  }>;
  recentUsageRecords: Array<{
    id: string;
    metric: string;
    quantity: number;
    periodStart: Date;
  }>;
  storyCount: number;
  pageCount: number;
  accountCount: number;
  callCount: number;
}

export interface QueueSloData {
  runs24h: Array<{
    status: string;
    provider: string;
    failureCount: number;
    successCount: number;
  }>;
  failedByProvider: Array<{
    provider: string;
    _count: { _all: number };
    _sum: { failureCount: number | null };
  }>;
  configs: Array<{
    provider: string;
    lastSyncAt: Date | null;
    status: string;
  }>;
}

export interface PipelineStatusData {
  runs: Array<{
    runType: string;
    status: string;
    provider: string;
    startedAt: Date;
    finishedAt: Date | null;
    processedCount: number;
    successCount: number;
    failureCount: number;
  }>;
  pendingApprovals: number;
  failedBackfills: number;
}

export interface ReplayAuditLog {
  id: string;
  createdAt: Date;
  action: string;
  actorUserId: string | null;
  targetId: string | null;
  metadata: unknown;
}

export interface IntegrationRunRecord {
  id: string;
  provider: string;
  runType: string;
  status: string;
  startedAt: Date;
}

export interface OperatorUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

export interface DrReadinessData {
  policy: ReturnType<typeof decodeDataGovernancePolicy>;
  lastBackup: { createdAt: Date; metadata: unknown } | null;
  lastRestoreValidation: { createdAt: Date; metadata: unknown } | null;
  accountCount: number;
  callCount: number;
  storyCount: number;
  pageCount: number;
}

export interface EntityCounts {
  accountCount: number;
  callCount: number;
  storyCount: number;
  pageCount: number;
}

export interface SyntheticHealthCheck {
  dbHealthy: boolean;
  openaiReachable: boolean;
  stripeReachable: boolean;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class OpsDiagnosticsService {
  constructor(private prisma: PrismaClient) {}

  async getIntegrationHealth(organizationId: string): Promise<IntegrationHealthItem[]> {
    const configs = await this.prisma.integrationConfig.findMany({
      where: { organizationId },
      select: {
        id: true,
        provider: true,
        enabled: true,
        status: true,
        lastSyncAt: true,
        lastError: true,
        updatedAt: true,
      },
      orderBy: { provider: "asc" },
    });

    const runAgg = await Promise.all(
      configs.map(async (c) => {
        const [lastSuccess, lastFailure, recentRuns] = await Promise.all([
          this.prisma.integrationRun.findFirst({
            where: {
              organizationId,
              integrationConfigId: c.id,
              status: "COMPLETED",
            },
            orderBy: { startedAt: "desc" },
            select: { startedAt: true, finishedAt: true },
          }),
          this.prisma.integrationRun.findFirst({
            where: {
              organizationId,
              integrationConfigId: c.id,
              status: "FAILED",
            },
            orderBy: { startedAt: "desc" },
            select: { startedAt: true, errorMessage: true },
          }),
          this.prisma.integrationRun.findMany({
            where: { organizationId, integrationConfigId: c.id },
            orderBy: { startedAt: "desc" },
            take: 20,
            select: { processedCount: true, successCount: true, failureCount: true },
          }),
        ]);
        const throughput = recentRuns.reduce((acc, r) => acc + r.successCount, 0);
        const failures = recentRuns.reduce((acc, r) => acc + r.failureCount, 0);
        return {
          id: c.id,
          provider: c.provider,
          enabled: c.enabled,
          status: c.status,
          lag_minutes: c.lastSyncAt
            ? Math.max(0, Math.floor((Date.now() - c.lastSyncAt.getTime()) / 60000))
            : null,
          last_success_at: lastSuccess?.startedAt.toISOString() ?? null,
          last_failure_at: lastFailure?.startedAt.toISOString() ?? null,
          last_failure_error: lastFailure?.errorMessage ?? c.lastError ?? null,
          throughput_recent: throughput,
          failures_recent: failures,
        };
      })
    );

    return runAgg;
  }

  async getDiagnosticsSnapshot(organizationId: string): Promise<DiagnosticsSnapshot> {
    const [
      integrationConfigs,
      recentAuditLogs,
      unresolvedNotifications,
      recentUsageRecords,
      storyCount,
      pageCount,
      accountCount,
      callCount,
    ] = await Promise.all([
      this.prisma.integrationConfig.findMany({
        where: { organizationId },
        select: {
          id: true,
          provider: true,
          enabled: true,
          status: true,
          lastSyncAt: true,
          lastError: true,
          updatedAt: true,
        },
        orderBy: { provider: "asc" },
      }),
      this.prisma.auditLog.findMany({
        where: { organizationId },
        select: {
          id: true,
          createdAt: true,
          category: true,
          action: true,
          severity: true,
        },
        orderBy: { createdAt: "desc" },
        take: 25,
      }),
      this.prisma.notification.findMany({
        where: { organizationId, read: false },
        select: {
          id: true,
          type: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 25,
      }),
      this.prisma.usageRecord.findMany({
        where: { organizationId },
        select: {
          id: true,
          metric: true,
          quantity: true,
          periodStart: true,
        },
        orderBy: { periodStart: "desc" },
        take: 50,
      }),
      this.prisma.story.count({ where: { organizationId } }),
      this.prisma.landingPage.count({ where: { organizationId } }),
      this.prisma.account.count({ where: { organizationId } }),
      this.prisma.call.count({ where: { organizationId } }),
    ]);

    return {
      integrationConfigs,
      recentAuditLogs,
      unresolvedNotifications,
      recentUsageRecords,
      storyCount,
      pageCount,
      accountCount,
      callCount,
    };
  }

  async getQueueSloData(organizationId: string): Promise<QueueSloData> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [runs24h, failedByProvider, configs] = await Promise.all([
      this.prisma.integrationRun.findMany({
        where: { organizationId, startedAt: { gte: since } },
        select: {
          status: true,
          provider: true,
          failureCount: true,
          successCount: true,
        },
      }),
      this.prisma.integrationRun.groupBy({
        by: ["provider"],
        where: {
          organizationId,
          startedAt: { gte: since },
          status: "FAILED",
        },
        _count: { _all: true },
        _sum: { failureCount: true },
      }),
      this.prisma.integrationConfig.findMany({
        where: { organizationId, enabled: true },
        select: { provider: true, lastSyncAt: true, status: true },
      }),
    ]);

    return { runs24h, failedByProvider, configs };
  }

  async getPipelineStatusData(organizationId: string): Promise<PipelineStatusData> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [runs, pendingApprovals, failedBackfills] = await Promise.all([
      this.prisma.integrationRun.findMany({
        where: { organizationId, startedAt: { gte: since } },
        select: {
          runType: true,
          status: true,
          provider: true,
          startedAt: true,
          finishedAt: true,
          processedCount: true,
          successCount: true,
          failureCount: true,
        },
        orderBy: { startedAt: "desc" },
        take: 300,
      }),
      this.prisma.approvalRequest.count({
        where: {
          organizationId,
          status: "PENDING",
        },
      }),
      this.prisma.integrationRun.count({
        where: {
          organizationId,
          runType: "BACKFILL",
          status: "FAILED",
          startedAt: { gte: since },
        },
      }),
    ]);

    return { runs, pendingApprovals, failedBackfills };
  }

  async getReplayAuditLogs(
    organizationId: string,
    since: Date,
    actions: readonly string[],
    operatorUserId: string | null,
    logTake: number
  ): Promise<ReplayAuditLog[]> {
    return this.prisma.auditLog.findMany({
      where: {
        organizationId,
        category: "INTEGRATION",
        action: { in: [...actions] },
        createdAt: { gte: since },
        ...(operatorUserId ? { actorUserId: operatorUserId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: logTake,
      select: {
        id: true,
        createdAt: true,
        action: true,
        actorUserId: true,
        targetId: true,
        metadata: true,
      },
    });
  }

  async getIntegrationRunsByIds(
    organizationId: string,
    runIds: string[]
  ): Promise<IntegrationRunRecord[]> {
    if (runIds.length === 0) return [];
    return this.prisma.integrationRun.findMany({
      where: {
        organizationId,
        id: { in: runIds },
      },
      select: {
        id: true,
        provider: true,
        runType: true,
        status: true,
        startedAt: true,
      },
    });
  }

  async getOperatorUsers(
    organizationId: string,
    userIds: string[]
  ): Promise<OperatorUser[]> {
    if (userIds.length === 0) return [];
    return this.prisma.user.findMany({
      where: {
        organizationId,
        id: { in: userIds },
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
    });
  }

  async getDrReadinessData(organizationId: string): Promise<DrReadinessData> {
    const settings = await this.prisma.orgSettings.findUnique({
      where: { organizationId },
      select: { dataGovernancePolicy: true },
    });
    const policy = decodeDataGovernancePolicy(settings?.dataGovernancePolicy);

    const [lastBackup, lastRestoreValidation, criticalCounts] = await Promise.all([
      this.prisma.auditLog.findFirst({
        where: {
          organizationId,
          category: "DR",
          action: "DR_BACKUP_VERIFIED",
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, metadata: true },
      }),
      this.prisma.auditLog.findFirst({
        where: {
          organizationId,
          category: "DR",
          action: "DR_RESTORE_VALIDATED",
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, metadata: true },
      }),
      Promise.all([
        this.prisma.account.count({ where: { organizationId } }),
        this.prisma.call.count({ where: { organizationId } }),
        this.prisma.story.count({ where: { organizationId } }),
        this.prisma.landingPage.count({ where: { organizationId } }),
      ]),
    ]);

    const [accountCount, callCount, storyCount, pageCount] = criticalCounts;

    return {
      policy,
      lastBackup,
      lastRestoreValidation,
      accountCount,
      callCount,
      storyCount,
      pageCount,
    };
  }

  async getEntityCounts(organizationId: string): Promise<EntityCounts> {
    const [accountCount, callCount, storyCount, pageCount] = await Promise.all([
      this.prisma.account.count({ where: { organizationId } }),
      this.prisma.call.count({ where: { organizationId } }),
      this.prisma.story.count({ where: { organizationId } }),
      this.prisma.landingPage.count({ where: { organizationId } }),
    ]);
    return { accountCount, callCount, storyCount, pageCount };
  }

  async checkDatabaseHealth(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
