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

export class AuditLogService {
  constructor(private prisma: PrismaClient) {}

  async record(input: AuditLogInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId ?? null,
          category: input.category,
          action: input.action,
          targetType: input.targetType ?? null,
          targetId: input.targetId ?? null,
          severity: input.severity ?? "INFO",
          metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
      });
    } catch (err) {
      // Never block primary actions due to logging errors.
      console.error("Audit log write failed:", err);
    }
  }
}
