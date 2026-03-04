import type { PrismaClient } from "@prisma/client";
import type {
  StoryContextSettings,
  StoryPromptDefaults,
} from "../types/story-generation.js";
import { decodeDataGovernancePolicy } from "../types/json-boundaries.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StoryContextPayload {
  company_overview?: string;
  products?: string[];
  target_personas?: string[];
  target_industries?: string[];
  differentiators?: string[];
  proof_points?: string[];
  banned_claims?: string[];
  writing_style_guide?: string;
  approved_terminology?: string[];
  published_branding?: {
    brand_name?: string;
    logo_url?: string;
    primary_color?: string;
    accent_color?: string;
    surface_color?: string;
  };
  default_story_length?: string;
  default_story_outline?: string;
  default_story_format?: string;
  default_story_type?: string;
}

export interface DataGovernancePayload {
  retention_days?: number;
  audit_log_retention_days?: number;
  legal_hold_enabled?: boolean;
  pii_export_enabled?: boolean;
  deletion_requires_approval?: boolean;
  allow_named_story_exports?: boolean;
  rto_target_minutes?: number;
  rpo_target_minutes?: number;
}

export interface DeletionRequestRow {
  id: string;
  status: string;
  targetType: string;
  targetId: string;
  requestPayload: unknown;
  requestedByUserId: string;
  reviewerUserId: string | null;
  reviewNotes: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApprovalRequestRecord {
  id: string;
  status: string;
  targetType: string;
  targetId: string;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class AdminSettingsService {
  constructor(private prisma: PrismaClient) {}

  // ─── Org Settings ────────────────────────────────────────────────────

  async getOrgSettings(organizationId: string) {
    return this.prisma.orgSettings.findUnique({
      where: { organizationId },
    });
  }

  // ─── Story Context ───────────────────────────────────────────────────

  async getStoryContext(organizationId: string): Promise<{
    context: StoryContextSettings;
    defaults: StoryPromptDefaults;
  }> {
    const settings = await this.prisma.orgSettings.findUnique({
      where: { organizationId },
      select: { storyContext: true, storyPromptDefaults: true },
    });

    const context = (settings?.storyContext ?? {}) as StoryContextSettings;
    const defaults = (settings?.storyPromptDefaults ?? {}) as StoryPromptDefaults;
    return { context, defaults };
  }

  async upsertStoryContext(
    organizationId: string,
    d: StoryContextPayload
  ): Promise<void> {
    const storyContext = {
      companyOverview: d.company_overview ?? "",
      products: d.products ?? [],
      targetPersonas: d.target_personas ?? [],
      targetIndustries: d.target_industries ?? [],
      differentiators: d.differentiators ?? [],
      proofPoints: d.proof_points ?? [],
      bannedClaims: d.banned_claims ?? [],
      writingStyleGuide: d.writing_style_guide ?? "",
      approvedTerminology: d.approved_terminology ?? [],
      publishedBranding: {
        brandName: d.published_branding?.brand_name?.trim() || undefined,
        logoUrl: d.published_branding?.logo_url?.trim() || undefined,
        primaryColor: d.published_branding?.primary_color || undefined,
        accentColor: d.published_branding?.accent_color || undefined,
        surfaceColor: d.published_branding?.surface_color || undefined,
      },
    };
    const storyPromptDefaults = {
      storyLength: d.default_story_length ?? "MEDIUM",
      storyOutline: d.default_story_outline ?? "CHRONOLOGICAL_JOURNEY",
      storyFormat: d.default_story_format ?? null,
      storyType: d.default_story_type ?? "FULL_ACCOUNT_JOURNEY",
    };

    await this.prisma.orgSettings.upsert({
      where: { organizationId },
      create: { organizationId, storyContext, storyPromptDefaults },
      update: { storyContext, storyPromptDefaults },
    });
  }

  // ─── Data Governance ─────────────────────────────────────────────────

  async getDataGovernancePolicy(organizationId: string) {
    const settings = await this.prisma.orgSettings.findUnique({
      where: { organizationId },
      select: { dataGovernancePolicy: true },
    });
    return decodeDataGovernancePolicy(settings?.dataGovernancePolicy);
  }

  async upsertDataGovernancePolicy(
    organizationId: string,
    d: DataGovernancePayload
  ): Promise<void> {
    const dataGovernancePolicy = {
      retention_days: d.retention_days ?? 365,
      audit_log_retention_days: d.audit_log_retention_days ?? 365,
      legal_hold_enabled: d.legal_hold_enabled ?? false,
      pii_export_enabled: d.pii_export_enabled ?? true,
      deletion_requires_approval: d.deletion_requires_approval ?? true,
      allow_named_story_exports: d.allow_named_story_exports ?? false,
      rto_target_minutes: d.rto_target_minutes ?? 240,
      rpo_target_minutes: d.rpo_target_minutes ?? 60,
    };

    await this.prisma.orgSettings.upsert({
      where: { organizationId },
      create: { organizationId, dataGovernancePolicy },
      update: { dataGovernancePolicy },
    });
  }

  // ─── Deletion Requests ───────────────────────────────────────────────

  async listDeletionRequests(
    organizationId: string,
    status?: string
  ): Promise<DeletionRequestRow[]> {
    const isKnownStatus =
      status === "PENDING" ||
      status === "APPROVED" ||
      status === "REJECTED" ||
      status === "COMPLETED";

    return this.prisma.approvalRequest.findMany({
      where: isKnownStatus
        ? { organizationId, requestType: "DATA_DELETION", status }
        : { organizationId, requestType: "DATA_DELETION" },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        status: true,
        targetType: true,
        targetId: true,
        requestPayload: true,
        requestedByUserId: true,
        reviewerUserId: true,
        reviewNotes: true,
        reviewedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async createDeletionRequest(
    organizationId: string,
    targetType: string,
    targetId: string,
    requestedByUserId: string,
    reason: string | null
  ): Promise<ApprovalRequestRecord> {
    return this.prisma.approvalRequest.create({
      data: {
        organizationId,
        requestType: "DATA_DELETION",
        targetType,
        targetId,
        requestedByUserId,
        status: "PENDING",
        requestPayload: { reason },
      },
    });
  }

  async findDeletionRequest(
    requestId: string,
    organizationId: string
  ) {
    return this.prisma.approvalRequest.findFirst({
      where: {
        id: requestId,
        organizationId,
        requestType: "DATA_DELETION",
      },
    });
  }

  async rejectDeletionRequest(
    requestId: string,
    reviewerUserId: string,
    reviewNotes: string | null
  ): Promise<ApprovalRequestRecord> {
    return this.prisma.approvalRequest.update({
      where: { id: requestId },
      data: {
        status: "REJECTED",
        reviewerUserId,
        reviewNotes,
        reviewedAt: new Date(),
      },
    });
  }

  async completeDeletionRequest(
    requestId: string,
    reviewerUserId: string,
    reviewNotes: string | null
  ): Promise<ApprovalRequestRecord> {
    return this.prisma.approvalRequest.update({
      where: { id: requestId },
      data: {
        status: "COMPLETED",
        reviewerUserId,
        reviewNotes,
        reviewedAt: new Date(),
      },
    });
  }
}
