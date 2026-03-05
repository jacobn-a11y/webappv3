/**
 * Landing Page Editor Service
 *
 * Manages the full lifecycle of a landing page:
 *   1. CREATE — generate from a Story, pre-populate editable Markdown
 *   2. EDIT — rep modifies the content on screen (auto-saves, edit history)
 *   3. SCRUB — company name removal before publishing
 *   4. PUBLISH — push to a public URL with noindex, floating badge, callouts
 *   5. SHARE — toggle visibility, generate/revoke share links
 *   6. ARCHIVE — soft-delete, remove from public
 */

import type { PrismaClient, PageVisibility } from "@prisma/client";
import { CompanyScrubber } from "./company-scrubber.js";
import { hashPagePassword, verifyPagePassword } from "../lib/page-password.js";
import { decodeCalloutBoxes, encodeJsonValue } from "../types/json-boundaries.js";
import type { PublishedBrandingSettings } from "../types/story-generation.js";
import type {
  ArtifactVersionSummary,
  CalloutBox,
  LandingPageSummary,
} from "./landing-page-editor-types.js";
import {
  buildDefaultCalloutBoxes,
  createArtifactVersion,
  detectScrubLeakage,
  generateUniqueSlug,
  getPagePresentationSettings,
  syncStoryPublishedAtFromLandingPages,
  type PublishValidationIssue,
  validatePublishSnapshot,
} from "./landing-page-editor-helpers.js";
import {
  createPublishApprovalRequest as createPublishApprovalRequestCore,
  deleteLandingPage as deleteLandingPageCore,
  findPageForOrg as findPageForOrgCore,
  findPendingPublishApproval as findPendingPublishApprovalCore,
  findPublishApprovalRequest as findPublishApprovalRequestCore,
  findStoryForOrg as findStoryForOrgCore,
  getLandingPageDashboardStats,
  listLandingPageArtifactVersions,
  listLandingPagesForOrg,
  listPublishApprovalRequests as listPublishApprovalRequestsCore,
  rollbackLandingPageToVersion,
  updatePublishApprovalRequest as updatePublishApprovalRequestCore,
} from "./landing-page-editor-admin.js";
export type {
  ArtifactVersionSummary,
  CalloutBox,
  LandingPageSummary,
} from "./landing-page-editor-types.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CreateLandingPageInput {
  storyId: string;
  organizationId: string;
  createdById: string;
  title: string;
  subtitle?: string;
  heroImageUrl?: string;
  calloutBoxes?: CalloutBox[];
  /** Admin-only: include the real company name instead of scrubbing. */
  includeCompanyName?: boolean;
}

export interface UpdateLandingPageInput {
  title?: string;
  subtitle?: string;
  editableBody?: string;
  heroImageUrl?: string;
  calloutBoxes?: CalloutBox[];
  customCss?: string;
  editSummary?: string;
  expectedUpdatedAt?: Date;
}

export interface PublishOptions {
  visibility: PageVisibility;
  password?: string;
  expiresAt?: Date;
  /** Set at creation time, not changeable during publish. */
  includeCompanyName?: boolean;
  publishedByUserId?: string;
  approvalRequestId?: string;
  releaseNotes?: string;
  provenance?: Record<string, unknown>;
}

export class ScrubValidationError extends Error {
  leakedTerms: string[];

  constructor(leakedTerms: string[]) {
    super(
      `Scrub validation failed: detected unsanitized account identifiers (${leakedTerms.join(", ")})`
    );
    this.name = "ScrubValidationError";
    this.leakedTerms = leakedTerms;
  }
}

export class PublishValidationError extends Error {
  issues: PublishValidationIssue[];

  constructor(issues: PublishValidationIssue[]) {
    super("Publish validation failed");
    this.name = "PublishValidationError";
    this.issues = issues;
  }
}

export class ConcurrencyConflictError extends Error {
  expectedUpdatedAt: Date;
  currentUpdatedAt: Date;
  currentEditableBody: string;

  constructor(input: {
    expectedUpdatedAt: Date;
    currentUpdatedAt: Date;
    currentEditableBody: string;
  }) {
    super("Landing page was modified by another user.");
    this.name = "ConcurrencyConflictError";
    this.expectedUpdatedAt = input.expectedUpdatedAt;
    this.currentUpdatedAt = input.currentUpdatedAt;
    this.currentEditableBody = input.currentEditableBody;
  }
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class LandingPageEditor {
  private prisma: PrismaClient;
  private scrubber: CompanyScrubber;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.scrubber = new CompanyScrubber(prisma);
  }

  /**
   * Creates a new landing page from an existing Story.
   * Pre-populates the editable body with the story's Markdown.
   */
  async create(input: CreateLandingPageInput): Promise<string> {
    const story = await this.prisma.story.findUniqueOrThrow({
      where: { id: input.storyId },
      include: {
        account: { select: { id: true, name: true } },
        quotes: true,
      },
    });

    // Calculate total call hours for the badge
    const calls = await this.prisma.call.findMany({
      where: { accountId: story.accountId },
      select: { duration: true },
    });
    const totalSeconds = calls.reduce((sum, c) => sum + (c.duration ?? 0), 0);
    const totalHours = Math.round((totalSeconds / 3600) * 10) / 10;

    const slug = await generateUniqueSlug(this.prisma, input.title);
    const defaultCallouts = buildDefaultCalloutBoxes(story.quotes, input.calloutBoxes);

    const page = await this.prisma.landingPage.create({
      data: {
        organizationId: input.organizationId,
        storyId: input.storyId,
        createdById: input.createdById,
        slug,
        title: input.title,
        subtitle: input.subtitle ?? null,
        editableBody: story.markdownBody,
        scrubbedBody: "", // will be populated on publish
        heroImageUrl: input.heroImageUrl ?? null,
        calloutBoxes: encodeJsonValue(defaultCallouts),
        totalCallHours: totalHours,
        includeCompanyName: input.includeCompanyName ?? false,
        status: "DRAFT",
        visibility: "PRIVATE",
      },
    });

    return page.id;
  }

  /**
   * Saves edits to a landing page. Records edit history for audit trail.
   */
  async update(
    pageId: string,
    userId: string,
    input: UpdateLandingPageInput
  ): Promise<{ updatedAt: Date }> {
    const existing = await this.prisma.landingPage.findUniqueOrThrow({
      where: { id: pageId },
      select: {
        id: true,
        editableBody: true,
        updatedAt: true,
      },
    });

    if (
      input.expectedUpdatedAt &&
      existing.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
    ) {
      throw new ConcurrencyConflictError({
        expectedUpdatedAt: input.expectedUpdatedAt,
        currentUpdatedAt: existing.updatedAt,
        currentEditableBody: existing.editableBody,
      });
    }

    const bodyChanged =
      input.editableBody !== undefined && input.editableBody !== existing.editableBody;
    const pageUpdateData = {
      title: input.title,
      subtitle: input.subtitle,
      editableBody: input.editableBody,
      heroImageUrl: input.heroImageUrl,
      calloutBoxes: input.calloutBoxes ? encodeJsonValue(input.calloutBoxes) : undefined,
      customCss: input.customCss,
    };

    if (input.expectedUpdatedAt) {
      const updateResult = await this.prisma.landingPage.updateMany({
        where: {
          id: pageId,
          updatedAt: input.expectedUpdatedAt,
        },
        data: pageUpdateData,
      });

      if (updateResult.count === 0) {
        const latest = await this.prisma.landingPage.findUniqueOrThrow({
          where: { id: pageId },
          select: { updatedAt: true, editableBody: true },
        });
        throw new ConcurrencyConflictError({
          expectedUpdatedAt: input.expectedUpdatedAt,
          currentUpdatedAt: latest.updatedAt,
          currentEditableBody: latest.editableBody,
        });
      }

      const updated = await this.prisma.landingPage.findUniqueOrThrow({
        where: { id: pageId },
        select: { updatedAt: true },
      });

      if (bodyChanged) {
        await this.prisma.landingPageEdit.create({
          data: {
            landingPageId: pageId,
            editedById: userId,
            previousBody: existing.editableBody,
            newBody: input.editableBody!,
            editSummary: input.editSummary ?? null,
          },
        });
      }

      return { updatedAt: updated.updatedAt };
    }

    const updated = await this.prisma.landingPage.update({
      where: { id: pageId },
      data: pageUpdateData,
      select: { updatedAt: true },
    });

    if (bodyChanged) {
      await this.prisma.landingPageEdit.create({
        data: {
          landingPageId: pageId,
          editedById: userId,
          previousBody: existing.editableBody,
          newBody: input.editableBody!,
          editSummary: input.editSummary ?? null,
        },
      });
    }

    return { updatedAt: updated.updatedAt };
  }

  /**
   * Publishes a landing page. For named pages (includeCompanyName=true),
   * scrubbing is skipped — the company name is preserved in all fields.
   * For anonymous pages, scrubs and stores anonymized versions in dedicated
   * fields (scrubbedBody, scrubbedTitle, etc.) while preserving the originals.
   */
  async publish(pageId: string, options: PublishOptions): Promise<{ slug: string; url: string }> {
    const page = await this.prisma.landingPage.findUniqueOrThrow({
      where: { id: pageId },
      include: { story: { select: { id: true, accountId: true } } },
    });

    let scrubbedBody: string;
    let scrubbedTitle: string;
    let scrubbedSubtitle: string | null;
    let scrubbedCallouts: CalloutBox[] | null = null;

    const prePublishIssues = validatePublishSnapshot({
      title: page.title,
      subtitle: page.subtitle,
      body: page.editableBody,
      calloutBoxes: decodeCalloutBoxes(page.calloutBoxes).map((box) => ({
        title: box.title,
        body: box.body,
      })),
      fieldPrefix: "editable",
    });
    if (prePublishIssues.length > 0) {
      throw new PublishValidationError(prePublishIssues);
    }

    if (page.includeCompanyName) {
      scrubbedBody = page.editableBody;
      scrubbedTitle = page.title;
      scrubbedSubtitle = page.subtitle;
    } else {
      const scrubResult = await this.scrubber.scrubForAccount(
        page.story.accountId,
        page.editableBody
      );
      scrubbedBody = scrubResult.scrubbedText;

      const titleScrub = await this.scrubber.scrubForAccount(page.story.accountId, page.title);
      scrubbedTitle = titleScrub.scrubbedText;

      const subtitleScrub = page.subtitle
        ? await this.scrubber.scrubForAccount(page.story.accountId, page.subtitle)
        : null;
      scrubbedSubtitle = subtitleScrub?.scrubbedText ?? null;

      if (page.calloutBoxes && Array.isArray(page.calloutBoxes)) {
        const callouts = decodeCalloutBoxes(page.calloutBoxes);
        scrubbedCallouts = [];
        for (const box of callouts) {
          const bodyScrub = await this.scrubber.scrubForAccount(page.story.accountId, box.body);
          const boxTitleScrub = await this.scrubber.scrubForAccount(
            page.story.accountId,
            box.title
          );
          scrubbedCallouts.push({
            ...box,
            title: boxTitleScrub.scrubbedText,
            body: bodyScrub.scrubbedText,
          });
        }
      }
    }

    if (!page.includeCompanyName) {
      const leakageTerms = await detectScrubLeakage(this.prisma, page.story.accountId, [
        scrubbedBody,
        scrubbedTitle,
        scrubbedSubtitle ?? "",
        ...(scrubbedCallouts ?? []).flatMap((box) => [box.title, box.body]),
      ]);
      if (leakageTerms.length > 0) {
        throw new ScrubValidationError(leakageTerms);
      }
    }

    const postScrubIssues = validatePublishSnapshot({
      title: scrubbedTitle,
      subtitle: scrubbedSubtitle,
      body: scrubbedBody,
      calloutBoxes: (scrubbedCallouts ?? []).map((box) => ({
        title: box.title,
        body: box.body,
      })),
      fieldPrefix: "scrubbed",
    });
    if (postScrubIssues.length > 0) {
      throw new PublishValidationError(postScrubIssues);
    }

    const publishedAt = new Date();

    await this.prisma.landingPage.update({
      where: { id: pageId },
      data: {
        scrubbedBody,
        scrubbedTitle,
        scrubbedSubtitle,
        scrubbedCalloutBoxes: scrubbedCallouts ? encodeJsonValue(scrubbedCallouts) : undefined,
        status: "PUBLISHED",
        visibility: options.visibility,
        password: options.password ? hashPagePassword(options.password) : null,
        expiresAt: options.expiresAt ?? null,
        publishedAt,
        noIndex: true,
      },
    });
    try {
      await syncStoryPublishedAtFromLandingPages(this.prisma, page.story.id);
    } catch {
      // Non-critical: story publishedAt sync failure should not block publishing
    }

    await this.createArtifactVersion(page.id, {
      releaseNotes: options.releaseNotes,
      approvalRequestId: options.approvalRequestId,
      publishedByUserId: options.publishedByUserId,
      provenance: options.provenance,
      publishedAt,
    });

    const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
    return {
      slug: page.slug,
      url: `${baseUrl}/s/${page.slug}`,
    };
  }

  /**
   * Unpublishes (archives) a landing page.
   */
  async archive(pageId: string): Promise<void> {
    const page = await this.prisma.landingPage.update({
      where: { id: pageId },
      data: { status: "ARCHIVED" },
      select: { storyId: true },
    });
    await syncStoryPublishedAtFromLandingPages(this.prisma, page.storyId);
  }

  /**
   * Reverts to draft status (unpublishes without archiving).
   */
  async unpublish(pageId: string): Promise<void> {
    const page = await this.prisma.landingPage.update({
      where: { id: pageId },
      data: { status: "DRAFT", publishedAt: null },
      select: { storyId: true },
    });
    await syncStoryPublishedAtFromLandingPages(this.prisma, page.storyId);
  }

  /**
   * Fetches the full landing page for editing (internal, unscrubbed).
   */
  async getForEditing(pageId: string) {
    return this.prisma.landingPage.findUniqueOrThrow({
      where: { id: pageId },
      include: {
        story: {
          include: {
            account: { select: { id: true, name: true } },
            quotes: true,
          },
        },
        createdBy: { select: { id: true, name: true, email: true } },
        edits: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: {
            editedBy: { select: { name: true, email: true } },
          },
        },
      },
    });
  }

  /**
   * Fetches the public landing page by slug. Checks the org's
   * anonymizationEnabled setting to decide whether to serve the
   * original (identifiable) or scrubbed (anonymized) content.
   * Returns null if not published, expired, or private.
   */
  async getPublicBySlug(
    slug: string,
    password?: string
  ): Promise<{
    title: string;
    subtitle: string | null;
    body: string;
    calloutBoxes: CalloutBox[];
    totalCallHours: number;
    heroImageUrl: string | null;
    customCss: string | null;
    branding: PublishedBrandingSettings | null;
    publishedAt: Date | null;
  } | null> {
    const page = await this.prisma.landingPage.findUnique({
      where: { slug },
    });

    if (!page || page.status !== "PUBLISHED") return null;

    // Check expiration
    if (page.expiresAt && new Date() > page.expiresAt) return null;

    // Check visibility
    if (page.visibility === "PRIVATE") return null;

    // Check password
    if (page.password) {
      if (!password || !verifyPagePassword(password, page.password)) return null;
    }

    // Increment view count
    await this.prisma.landingPage.update({
      where: { id: page.id },
      data: { viewCount: { increment: 1 } },
    });

    // Check org-level anonymization + branding settings
    const pagePresentation = await getPagePresentationSettings(this.prisma, page.organizationId);
    const shouldAnonymize = pagePresentation.anonymizationEnabled;

    // When anonymization is off, or the page was explicitly set to include
    // company names, serve the original identifiable content.
    const useOriginal = !shouldAnonymize || page.includeCompanyName;

    return {
      title: useOriginal ? page.title : (page.scrubbedTitle ?? page.title),
      subtitle: useOriginal ? page.subtitle : (page.scrubbedSubtitle ?? page.subtitle),
      body: useOriginal ? page.editableBody : page.scrubbedBody || page.editableBody,
      calloutBoxes: useOriginal
        ? decodeCalloutBoxes(page.calloutBoxes)
        : decodeCalloutBoxes(page.scrubbedCalloutBoxes).length > 0
          ? decodeCalloutBoxes(page.scrubbedCalloutBoxes)
          : decodeCalloutBoxes(page.calloutBoxes),
      totalCallHours: page.totalCallHours,
      heroImageUrl: page.heroImageUrl,
      customCss: page.customCss,
      branding: pagePresentation.publishedBranding,
      publishedAt: page.publishedAt,
    };
  }

  /**
   * Generates a preview of the landing page as it would appear publicly.
   * Respects the org's anonymizationEnabled setting and the per-page
   * includeCompanyName flag to decide whether to scrub or show originals.
   */
  async getPreview(pageId: string): Promise<{
    title: string;
    subtitle: string | null;
    body: string;
    calloutBoxes: CalloutBox[];
    totalCallHours: number;
    heroImageUrl: string | null;
    customCss: string | null;
    branding: PublishedBrandingSettings | null;
  }> {
    const page = await this.prisma.landingPage.findUniqueOrThrow({
      where: { id: pageId },
      include: { story: { select: { accountId: true } } },
    });

    const pagePresentation = await getPagePresentationSettings(this.prisma, page.organizationId);
    const shouldAnonymize = pagePresentation.anonymizationEnabled;
    const skipScrub = !shouldAnonymize || page.includeCompanyName;
    const scrubOpts = { skipScrub };

    // Scrub body
    const bodyScrub = await this.scrubber.scrubForAccount(
      page.story.accountId,
      page.editableBody,
      scrubOpts
    );

    // Scrub title
    const titleScrub = await this.scrubber.scrubForAccount(
      page.story.accountId,
      page.title,
      scrubOpts
    );

    // Scrub subtitle
    const subtitleScrub = page.subtitle
      ? await this.scrubber.scrubForAccount(page.story.accountId, page.subtitle, scrubOpts)
      : null;

    // Scrub callout boxes
    const previewCallouts: CalloutBox[] = [];
    if (page.calloutBoxes && Array.isArray(page.calloutBoxes)) {
      const callouts = decodeCalloutBoxes(page.calloutBoxes);
      for (const box of callouts) {
        const boxBody = await this.scrubber.scrubForAccount(
          page.story.accountId,
          box.body,
          scrubOpts
        );
        const boxTitle = await this.scrubber.scrubForAccount(
          page.story.accountId,
          box.title,
          scrubOpts
        );
        previewCallouts.push({
          ...box,
          title: boxTitle.scrubbedText,
          body: boxBody.scrubbedText,
        });
      }
    }

    return {
      title: titleScrub.scrubbedText,
      subtitle: subtitleScrub?.scrubbedText ?? null,
      body: bodyScrub.scrubbedText,
      calloutBoxes: previewCallouts,
      totalCallHours: page.totalCallHours,
      heroImageUrl: page.heroImageUrl,
      customCss: page.customCss,
      branding: pagePresentation.publishedBranding,
    };
  }

  /**
   * Dashboard: list all landing pages for an org.
   */
  async listForOrg(
    organizationId: string,
    filters?: {
      status?: "DRAFT" | "IN_REVIEW" | "APPROVED" | "PUBLISHED";
      includeArchived?: boolean;
      createdById?: string;
      search?: string;
    }
  ): Promise<LandingPageSummary[]> {
    return listLandingPagesForOrg(this.prisma, organizationId, filters);
  }

  /**
   * Dashboard: aggregate stats.
   */
  async getDashboardStats(organizationId: string): Promise<{
    totalPages: number;
    publishedPages: number;
    draftPages: number;
    totalViews: number;
    pagesByUser: Array<{ userId: string; name: string | null; count: number }>;
  }> {
    return getLandingPageDashboardStats(this.prisma, organizationId);
  }

  async listArtifactVersions(
    pageId: string,
    organizationId: string
  ): Promise<ArtifactVersionSummary[]> {
    return listLandingPageArtifactVersions(this.prisma, pageId, organizationId);
  }

  async rollbackToVersion(pageId: string, versionId: string, actorUserId: string): Promise<void> {
    return rollbackLandingPageToVersion(this.prisma, pageId, versionId, actorUserId);
  }

  // ─── Story / Page lookups (used by route-level validation) ────────

  /**
   * Finds a story by ID scoped to an organization.
   * Returns null if not found.
   */
  async findStoryForOrg(
    storyId: string,
    organizationId: string
  ): Promise<{ id: string; accountId: string } | null> {
    return findStoryForOrgCore(this.prisma, storyId, organizationId);
  }

  /**
   * Finds a landing page by ID scoped to an organization.
   * Returns null if not found.
   */
  async findPageForOrg(pageId: string, organizationId: string): Promise<{ id: string } | null> {
    return findPageForOrgCore(this.prisma, pageId, organizationId);
  }

  /**
   * Hard-deletes a landing page by ID.
   */
  async deletePage(pageId: string): Promise<void> {
    return deleteLandingPageCore(this.prisma, pageId);
  }

  // ─── Approval workflow ──────────────────────────────────────────────

  /**
   * Finds a pending publish-approval request for a given page.
   */
  async findPendingPublishApproval(
    organizationId: string,
    pageId: string
  ): Promise<{ id: string } | null> {
    return findPendingPublishApprovalCore(this.prisma, organizationId, pageId);
  }

  /**
   * Creates a new approval request for publishing a landing page.
   */
  async createPublishApprovalRequest(data: {
    organizationId: string;
    targetId: string;
    requestedByUserId: string;
    targetType?: string;
    requestType?: string;
    requestPayload: Record<string, unknown>;
  }): Promise<{ id: string }> {
    return createPublishApprovalRequestCore(this.prisma, data);
  }

  /**
   * Lists publish-approval requests for an organization filtered by status.
   */
  async listPublishApprovalRequests(
    organizationId: string,
    status: string,
    options?: {
      requestTypes?: string[];
      targetTypes?: string[];
    }
  ) {
    return listPublishApprovalRequestsCore(this.prisma, organizationId, status, options);
  }

  /**
   * Finds a publish-approval request by ID scoped to an organization.
   */
  async findPublishApprovalRequest(
    requestId: string,
    organizationId: string,
    options?: {
      requestTypes?: string[];
    }
  ) {
    return findPublishApprovalRequestCore(this.prisma, requestId, organizationId, options);
  }

  /**
   * Updates a publish-approval request (approve, reject, advance step).
   */
  async updateApprovalRequest(
    requestId: string,
    data: {
      status?: string;
      reviewerUserId?: string;
      reviewNotes?: string | null;
      reviewedAt?: Date;
      requestPayload?: Record<string, unknown>;
    }
  ) {
    return updatePublishApprovalRequestCore(this.prisma, requestId, data);
  }

  // Kept as a method for test seam compatibility.
  private async createArtifactVersion(
    pageId: string,
    input: {
      releaseNotes?: string;
      approvalRequestId?: string;
      publishedByUserId?: string;
      provenance?: Record<string, unknown>;
      publishedAt: Date;
    }
  ): Promise<void> {
    await createArtifactVersion(this.prisma, pageId, input);
  }
}
