import { describe, expect, it } from "vitest";
import {
  requiresPublishApproval,
  resolveApprovalPolicyFromSettings,
} from "../../src/services/publish-approval-policy.js";

describe("resolveApprovalPolicyFromSettings", () => {
  it("falls back to ALL_REQUIRED when legacy requireApprovalToPublish is true", () => {
    const policy = resolveApprovalPolicyFromSettings({
      approvalPolicy: null,
      requireApprovalToPublish: true,
    });
    expect(policy).toBe("ALL_REQUIRED");
  });

  it("falls back to ALL_NO_APPROVAL when legacy requireApprovalToPublish is false", () => {
    const policy = resolveApprovalPolicyFromSettings({
      approvalPolicy: null,
      requireApprovalToPublish: false,
    });
    expect(policy).toBe("ALL_NO_APPROVAL");
  });
});

describe("requiresPublishApproval", () => {
  it("enforces matrix for named vs anonymous stories", () => {
    expect(requiresPublishApproval("ALL_REQUIRED", true)).toBe(true);
    expect(requiresPublishApproval("ALL_REQUIRED", false)).toBe(true);

    expect(requiresPublishApproval("ANON_NO_APPROVAL", true)).toBe(true);
    expect(requiresPublishApproval("ANON_NO_APPROVAL", false)).toBe(false);

    expect(requiresPublishApproval("NAMED_NO_APPROVAL", true)).toBe(false);
    expect(requiresPublishApproval("NAMED_NO_APPROVAL", false)).toBe(true);

    expect(requiresPublishApproval("ALL_NO_APPROVAL", true)).toBe(false);
    expect(requiresPublishApproval("ALL_NO_APPROVAL", false)).toBe(false);
  });
});
