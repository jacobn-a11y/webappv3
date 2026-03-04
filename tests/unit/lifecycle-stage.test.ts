import { describe, expect, it } from "vitest";
import {
  pickLatestApproval,
  resolveLifecycleStage,
} from "../../src/services/lifecycle-stage.js";

describe("resolveLifecycleStage", () => {
  it("returns PUBLISHED when publishedAt exists regardless of approval status", () => {
    const stage = resolveLifecycleStage({
      publishedAt: new Date("2026-03-01T00:00:00.000Z"),
      latestApprovalStatus: "PENDING",
    });
    expect(stage).toBe("PUBLISHED");
  });

  it("returns IN_REVIEW when latest approval is pending", () => {
    const stage = resolveLifecycleStage({
      publishedAt: null,
      latestApprovalStatus: "PENDING",
    });
    expect(stage).toBe("IN_REVIEW");
  });

  it("returns APPROVED when latest approval is approved and not published", () => {
    const stage = resolveLifecycleStage({
      publishedAt: null,
      latestApprovalStatus: "APPROVED",
    });
    expect(stage).toBe("APPROVED");
  });

  it("returns DRAFT when no approval request exists", () => {
    const stage = resolveLifecycleStage({
      publishedAt: null,
      latestApprovalStatus: null,
    });
    expect(stage).toBe("DRAFT");
  });
});

describe("pickLatestApproval", () => {
  it("uses createdAt desc then id desc tie-break", () => {
    const latest = pickLatestApproval([
      {
        id: "a-1",
        createdAt: new Date("2026-03-02T10:00:00.000Z"),
      },
      {
        id: "b-9",
        createdAt: new Date("2026-03-02T10:00:00.000Z"),
      },
      {
        id: "z-1",
        createdAt: new Date("2026-03-01T10:00:00.000Z"),
      },
    ]);
    expect(latest?.id).toBe("b-9");
  });
});
