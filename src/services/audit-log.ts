import { Prisma, type PrismaClient } from "@prisma/client";

export interface AuditLogInput {
  organizationId: string;
  actorUserId?: string | null;
  category: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  severity?: "INFO" | "WARN" | "CRITICAL";
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const AUDIT_LOG_SCHEMA_VERSION = 1;
const DEFAULT_AUDIT_RETENTION_DAYS = 365;
const MAX_AUDIT_RETENTION_DAYS = 3650;

export class AuditLogService {
  constructor(private prisma: PrismaClient) {}

  private async resolveRetentionDays(organizationId: string): Promise<number> {
    const settings = await this.prisma.orgSettings.findUnique({
      where: { organizationId },
      select: { dataGovernancePolicy: true },
    });
    const rawPolicy = settings?.dataGovernancePolicy;
    const policy =
      rawPolicy && typeof rawPolicy === "object" && !Array.isArray(rawPolicy)
        ? (rawPolicy as Record<string, unknown>)
        : {};
    const configured = policy.audit_log_retention_days;
    if (typeof configured !== "number" || !Number.isFinite(configured)) {
      return DEFAULT_AUDIT_RETENTION_DAYS;
    }
    const rounded = Math.floor(configured);
    return Math.max(30, Math.min(MAX_AUDIT_RETENTION_DAYS, rounded));
  }

  async record(input: AuditLogInput): Promise<void> {
    try {
      const retentionDays = await this.resolveRetentionDays(input.organizationId);
      const expiresAt = new Date(
        Date.now() + retentionDays * 24 * 60 * 60 * 1000
      );

      await this.prisma.auditLog.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId ?? null,
          category: input.category,
          action: input.action,
          schemaVersion: AUDIT_LOG_SCHEMA_VERSION,
          targetType: input.targetType ?? null,
          targetId: input.targetId ?? null,
          severity: input.severity ?? "INFO",
          metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          expiresAt,
        },
      });
    } catch (err) {
      // Never block primary actions due to logging errors.
      console.error("Audit log write failed:", err);
    }
  }

  async purgeExpired(params?: { organizationId?: string }): Promise<number> {
    const where = params?.organizationId
      ? {
          organizationId: params.organizationId,
          expiresAt: { lte: new Date() },
        }
      : {
          expiresAt: { lte: new Date() },
        };
    const result = await this.prisma.auditLog.deleteMany({ where });
    return result.count;
  }
}
