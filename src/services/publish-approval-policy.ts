import type { ApprovalPolicy, PrismaClient } from "@prisma/client";

export function resolveApprovalPolicyFromSettings(input: {
  approvalPolicy?: ApprovalPolicy | null;
  requireApprovalToPublish?: boolean | null;
}): ApprovalPolicy {
  if (input.approvalPolicy) {
    return input.approvalPolicy;
  }
  return input.requireApprovalToPublish ? "ALL_REQUIRED" : "ALL_NO_APPROVAL";
}

export function requiresPublishApproval(
  approvalPolicy: ApprovalPolicy,
  isNamedStory: boolean
): boolean {
  if (approvalPolicy === "ALL_REQUIRED") {
    return true;
  }
  if (approvalPolicy === "ALL_NO_APPROVAL") {
    return false;
  }
  if (approvalPolicy === "ANON_NO_APPROVAL") {
    return isNamedStory;
  }
  // NAMED_NO_APPROVAL
  return !isNamedStory;
}

export class PublishApprovalPolicyService {
  constructor(private prisma: PrismaClient) {}

  async getOrgApprovalPolicy(organizationId: string): Promise<ApprovalPolicy> {
    const settings = await this.prisma.orgSettings.findUnique({
      where: { organizationId },
      select: {
        approvalPolicy: true,
        requireApprovalToPublish: true,
      },
    });
    return resolveApprovalPolicyFromSettings({
      approvalPolicy: settings?.approvalPolicy ?? null,
      requireApprovalToPublish: settings?.requireApprovalToPublish ?? null,
    });
  }

  async requiresApproval(
    organizationId: string,
    isNamedStory: boolean
  ): Promise<{ approvalPolicy: ApprovalPolicy; required: boolean }> {
    const approvalPolicy = await this.getOrgApprovalPolicy(organizationId);
    return {
      approvalPolicy,
      required: requiresPublishApproval(approvalPolicy, isNamedStory),
    };
  }
}
