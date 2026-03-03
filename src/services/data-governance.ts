import type { PrismaClient } from "@prisma/client";
import {
  decodeDataGovernancePolicy,
  type DataGovernancePolicyBoundary,
} from "../types/json-boundaries.js";

export type DataGovernancePolicy = DataGovernancePolicyBoundary;

export async function getDataGovernancePolicy(
  prisma: PrismaClient,
  organizationId: string
): Promise<DataGovernancePolicy> {
  const settings = await prisma.orgSettings.findUnique({
    where: { organizationId },
    select: { dataGovernancePolicy: true },
  });
  return decodeDataGovernancePolicy(settings?.dataGovernancePolicy);
}

export async function isLegalHoldEnabled(
  prisma: PrismaClient,
  organizationId: string
): Promise<boolean> {
  const policy = await getDataGovernancePolicy(prisma, organizationId);
  return policy.legal_hold_enabled === true;
}
