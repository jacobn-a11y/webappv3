import type { PageStatus, PageVisibility } from "@prisma/client";

export interface CalloutBox {
  title: string;
  body: string;
  icon?: "metric" | "quote" | "insight" | "timeline" | "warning" | "success";
}

export interface ArtifactVersionSummary {
  id: string;
  versionNumber: number;
  status: string;
  releaseNotes: string | null;
  visibility: PageVisibility;
  expiresAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  createdBy: { id: string; name: string | null; email: string } | null;
  provenance: Record<string, unknown> | null;
}

export interface LandingPageSummary {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  status: PageStatus;
  lifecycleStage: "DRAFT" | "IN_REVIEW" | "APPROVED" | "PUBLISHED";
  visibility: PageVisibility;
  viewCount: number;
  createdByName: string | null;
  createdByEmail: string;
  accountName: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
