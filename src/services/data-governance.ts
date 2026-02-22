import type { PrismaClient } from "@prisma/client";

export interface DataGovernancePolicy {
  retention_days?: number;
  audit_log_retention_days?: number;
  legal_hold_enabled?: boolean;
  pii_export_enabled?: boolean;
  deletion_requires_approval?: boolean;
  allow_named_story_exports?: boolean;
}

export async function getDataGovernancePolicy(
  prisma: PrismaClient,
  organizationId: string
): Promise<DataGovernancePolicy> {
  const settings = await prisma.orgSettings.findUnique({
    where: { organizationId },
    select: { dataGovernancePolicy: true },
  });
  const raw = settings?.dataGovernancePolicy;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  return raw as DataGovernancePolicy;
}

export async function isLegalHoldEnabled(
  prisma: PrismaClient,
  organizationId: string
): Promise<boolean> {
  const policy = await getDataGovernancePolicy(prisma, organizationId);
  return policy.legal_hold_enabled === true;
}
