import type { ApprovalRequest } from "@prisma/client";

export type LifecycleStage = "DRAFT" | "IN_REVIEW" | "APPROVED" | "PUBLISHED";
export type ApprovalReviewStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface LifecycleStageInput {
  publishedAt: Date | null;
  latestApprovalStatus?: string | null;
}

export function normalizeApprovalStatus(
  status: string | null | undefined
): ApprovalReviewStatus | null {
  if (status === "PENDING" || status === "APPROVED" || status === "REJECTED") {
    return status;
  }
  return null;
}

export function resolveLifecycleStage(input: LifecycleStageInput): LifecycleStage {
  if (input.publishedAt) {
    return "PUBLISHED";
  }
  const latest = normalizeApprovalStatus(input.latestApprovalStatus);
  if (latest === "PENDING") {
    return "IN_REVIEW";
  }
  if (latest === "APPROVED") {
    return "APPROVED";
  }
  return "DRAFT";
}

export function compareApprovalRecency(
  a: Pick<ApprovalRequest, "createdAt" | "id">,
  b: Pick<ApprovalRequest, "createdAt" | "id">
): number {
  const dateCmp = b.createdAt.getTime() - a.createdAt.getTime();
  if (dateCmp !== 0) {
    return dateCmp;
  }
  return b.id.localeCompare(a.id);
}

export function pickLatestApproval<T extends Pick<ApprovalRequest, "createdAt" | "id">>(
  requests: T[]
): T | null {
  if (requests.length === 0) {
    return null;
  }
  return [...requests].sort(compareApprovalRecency)[0] ?? null;
}

export function isPublishedWithinUtcWindow(
  publishedAt: Date | null,
  nowUtc: Date,
  days: number
): boolean {
  if (!publishedAt) {
    return false;
  }
  const lowerBound = new Date(nowUtc.getTime() - days * 24 * 60 * 60 * 1000);
  return publishedAt.getTime() >= lowerBound.getTime();
}
