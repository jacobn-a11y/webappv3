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

import crypto from "crypto";
import { Prisma } from "@prisma/client";
import type { PrismaClient, PageVisibility, PageStatus } from "@prisma/client";
import { CompanyScrubber } from "./company-scrubber.js";
import { normalizeCompanyName } from "./entity-resolution.js";
import { hashPagePassword, verifyPagePassword } from "../lib/page-password.js";

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

export interface CalloutBox {
  title: string;
  body: string;
  icon?: "metric" | "quote" | "insight" | "timeline" | "warning" | "success";
}

export interface UpdateLandingPageInput {
  title?: string;
  subtitle?: string;
  editableBody?: string;
  heroImageUrl?: string;
  calloutBoxes?: CalloutBox[];
  customCss?: string;
  editSummary?: string;
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
  visibility: PageVisibility;
  viewCount: number;
  createdByName: string | null;
  createdByEmail: string;
  accountName: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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

export interface PublishValidationIssue {
  field: string;
  code: string;
  message: string;
}

export class PublishValidationError extends Error {
  issues: PublishValidationIssue[];

  constructor(issues: PublishValidationIssue[]) {
    super("Publish validation failed");
    this.name = "PublishValidationError";
    this.issues = issues;
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

    // Generate a unique slug
    const slug = await this.generateUniqueSlug(input.title);

    // Build default callout boxes from high-value quotes
    const defaultCallouts: CalloutBox[] =
      input.calloutBoxes ??
      story.quotes.slice(0, 3).map((q) => ({
        title: q.metricType
          ? formatMetricTitle(q.metricType)
          : "Key Insight",
        body: q.metricValue
          ? `**${q.metricValue}** — ${q.quoteText}`
          : q.quoteText,
        icon: q.metricValue ? ("metric" as const) : ("quote" as const),
      }));

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
        calloutBoxes: defaultCallouts as unknown as object[],
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
  ): Promise<void> {
    const existing = await this.prisma.landingPage.findUniqueOrThrow({
      where: { id: pageId },
    });

    // If body changed, record the edit
    if (input.editableBody && input.editableBody !== existing.editableBody) {
      await this.prisma.landingPageEdit.create({
        data: {
          landingPageId: pageId,
          editedById: userId,
          previousBody: existing.editableBody,
          newBody: input.editableBody,
          editSummary: input.editSummary ?? null,
        },
      });
    }

    await this.prisma.landingPage.update({
      where: { id: pageId },
      data: {
        title: input.title,
        subtitle: input.subtitle,
        editableBody: input.editableBody,
        heroImageUrl: input.heroImageUrl,
        calloutBoxes: input.calloutBoxes
          ? (input.calloutBoxes as unknown as object[])
          : undefined,
        customCss: input.customCss,
      },
    });
  }

  /**
   * Publishes a landing page. For named pages (includeCompanyName=true),
   * scrubbing is skipped — the company name is preserved in all fields.
   * For anonymous pages, scrubs and stores anonymized versions in dedicated
   * fields (scrubbedBody, scrubbedTitle, etc.) while preserving the originals.
   */
  async publish(
    pageId: string,
    options: PublishOptions
  ): Promise<{ slug: string; url: string }> {
    const page = await this.prisma.landingPage.findUniqueOrThrow({
      where: { id: pageId },
      include: { story: { select: { accountId: true } } },
    });

    let scrubbedBody: string;
    let scrubbedTitle: string;
    let scrubbedSubtitle: string | null;
    let scrubbedCallouts: CalloutBox[] | null = null;

    const prePublishIssues = this.validatePublishSnapshot({
      title: page.title,
      body: page.editableBody,
      calloutBoxes:
        ((page.calloutBoxes as unknown as CalloutBox[] | null) ?? []).map((box) => ({
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

      const titleScrub = await this.scrubber.scrubForAccount(
        page.story.accountId,
        page.title
      );
      scrubbedTitle = titleScrub.scrubbedText;

      const subtitleScrub = page.subtitle
        ? await this.scrubber.scrubForAccount(
            page.story.accountId,
            page.subtitle
          )
        : null;
      scrubbedSubtitle = subtitleScrub?.scrubbedText ?? null;

      if (page.calloutBoxes && Array.isArray(page.calloutBoxes)) {
        const callouts = page.calloutBoxes as unknown as CalloutBox[];
        scrubbedCallouts = [];
        for (const box of callouts) {
          const bodyScrub = await this.scrubber.scrubForAccount(
            page.story.accountId,
            box.body
          );
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
      const leakageTerms = await this.detectScrubLeakage(
        page.story.accountId,
        [
          scrubbedBody,
          scrubbedTitle,
          scrubbedSubtitle ?? "",
          ...(scrubbedCallouts ?? []).flatMap((box) => [box.title, box.body]),
        ]
      );
      if (leakageTerms.length > 0) {
        throw new ScrubValidationError(leakageTerms);
      }
    }

    const postScrubIssues = this.validatePublishSnapshot({
      title: scrubbedTitle,
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
        scrubbedCalloutBoxes: scrubbedCallouts
          ? (scrubbedCallouts as unknown as object[])
          : undefined,
        status: "PUBLISHED",
        visibility: options.visibility,
        password: options.password ? hashPagePassword(options.password) : null,
        expiresAt: options.expiresAt ?? null,
        publishedAt,
        noIndex: true,
      },
    });

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
    await this.prisma.landingPage.update({
      where: { id: pageId },
      data: { status: "ARCHIVED" },
    });
  }

  /**
   * Reverts to draft status (unpublishes without archiving).
   */
  async unpublish(pageId: string): Promise<void> {
    await this.prisma.landingPage.update({
      where: { id: pageId },
      data: { status: "DRAFT", publishedAt: null },
    });
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

    // Check org-level anonymization setting
    const shouldAnonymize = await this.isAnonymizationEnabled(page.organizationId);

    // When anonymization is off, or the page was explicitly set to include
    // company names, serve the original identifiable content.
    const useOriginal = !shouldAnonymize || page.includeCompanyName;

    return {
      title: useOriginal
        ? page.title
        : (page.scrubbedTitle ?? page.title),
      subtitle: useOriginal
        ? page.subtitle
        : (page.scrubbedSubtitle ?? page.subtitle),
      body: useOriginal
        ? page.editableBody
        : (page.scrubbedBody || page.editableBody),
      calloutBoxes: useOriginal
        ? ((page.calloutBoxes as unknown as CalloutBox[]) ?? [])
        : ((page.scrubbedCalloutBoxes as unknown as CalloutBox[])
            ?? (page.calloutBoxes as unknown as CalloutBox[])
            ?? []),
      totalCallHours: page.totalCallHours,
      heroImageUrl: page.heroImageUrl,
      customCss: page.customCss,
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
  }> {
    const page = await this.prisma.landingPage.findUniqueOrThrow({
      where: { id: pageId },
      include: { story: { select: { accountId: true } } },
    });

    const shouldAnonymize = await this.isAnonymizationEnabled(page.organizationId);
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
      ? await this.scrubber.scrubForAccount(
          page.story.accountId,
          page.subtitle,
          scrubOpts
        )
      : null;

    // Scrub callout boxes
    const previewCallouts: CalloutBox[] = [];
    if (page.calloutBoxes && Array.isArray(page.calloutBoxes)) {
      const callouts = page.calloutBoxes as unknown as CalloutBox[];
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
    };
  }

  /**
   * Dashboard: list all landing pages for an org.
   */
  async listForOrg(
    organizationId: string,
    filters?: {
      status?: PageStatus;
      createdById?: string;
      search?: string;
    }
  ): Promise<LandingPageSummary[]> {
    const where: Record<string, unknown> = { organizationId };
    if (filters?.status) where.status = filters.status;
    if (filters?.createdById) where.createdById = filters.createdById;
    if (filters?.search) {
      where.title = { contains: filters.search, mode: "insensitive" };
    }

    const pages = await this.prisma.landingPage.findMany({
      where,
      include: {
        createdBy: { select: { name: true, email: true } },
        story: {
          include: { account: { select: { name: true } } },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    return pages.map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      subtitle: p.subtitle,
      status: p.status,
      visibility: p.visibility,
      viewCount: p.viewCount,
      createdByName: p.createdBy.name,
      createdByEmail: p.createdBy.email,
      accountName: p.story.account.name,
      publishedAt: p.publishedAt,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
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
    const [total, published, drafts, viewsAgg, byUser] = await Promise.all([
      this.prisma.landingPage.count({ where: { organizationId } }),
      this.prisma.landingPage.count({
        where: { organizationId, status: "PUBLISHED" },
      }),
      this.prisma.landingPage.count({
        where: { organizationId, status: "DRAFT" },
      }),
      this.prisma.landingPage.aggregate({
        where: { organizationId },
        _sum: { viewCount: true },
      }),
      this.prisma.landingPage.groupBy({
        by: ["createdById"],
        where: { organizationId },
        _count: true,
      }),
    ]);

    // Hydrate user names
    const userIds = byUser.map((b) => b.createdById);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u.name]));

    return {
      totalPages: total,
      publishedPages: published,
      draftPages: drafts,
      totalViews: viewsAgg._sum.viewCount ?? 0,
      pagesByUser: byUser.map((b) => ({
        userId: b.createdById,
        name: userMap.get(b.createdById) ?? null,
        count: b._count,
      })),
    };
  }

  async listArtifactVersions(
    pageId: string,
    organizationId: string
  ): Promise<ArtifactVersionSummary[]> {
    const versions = await this.prisma.publishedArtifactVersion.findMany({
      where: {
        landingPageId: pageId,
        organizationId,
      },
      orderBy: { versionNumber: "desc" },
      include: {
        publishedBy: { select: { id: true, name: true, email: true } },
      },
    });

    return versions.map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      status: v.status,
      releaseNotes: v.releaseNotes,
      visibility: v.visibilitySnapshot,
      expiresAt: v.expiresAtSnapshot,
      publishedAt: v.publishedAtSnapshot,
      createdAt: v.createdAt,
      createdBy: v.publishedBy
        ? {
            id: v.publishedBy.id,
            name: v.publishedBy.name,
            email: v.publishedBy.email,
          }
        : null,
      provenance:
        v.provenance && typeof v.provenance === "object" && !Array.isArray(v.provenance)
          ? (v.provenance as Record<string, unknown>)
          : null,
    }));
  }

  async rollbackToVersion(
    pageId: string,
    versionId: string,
    actorUserId: string
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const page = await tx.landingPage.findUniqueOrThrow({
        where: { id: pageId },
      });

      const version = await tx.publishedArtifactVersion.findFirst({
        where: {
          id: versionId,
          landingPageId: pageId,
          organizationId: page.organizationId,
        },
      });
      if (!version) {
        throw new Error("Version not found for this landing page");
      }

      await tx.landingPage.update({
        where: { id: pageId },
        data: {
          title: version.titleSnapshot,
          subtitle: version.subtitleSnapshot,
          editableBody: version.bodySnapshot,
          calloutBoxes: version.calloutBoxesSnapshot as Prisma.InputJsonValue,
          visibility: version.visibilitySnapshot,
          expiresAt: version.expiresAtSnapshot,
          status: "PUBLISHED",
          publishedAt: new Date(),
        },
      });

      await tx.publishedArtifactVersion.updateMany({
        where: {
          landingPageId: pageId,
          organizationId: page.organizationId,
          status: "ACTIVE",
        },
        data: { status: "ROLLED_BACK" },
      });

      const maxVersion = await tx.publishedArtifactVersion.aggregate({
        where: {
          landingPageId: pageId,
          organizationId: page.organizationId,
        },
        _max: { versionNumber: true },
      });

      await tx.publishedArtifactVersion.create({
        data: {
          organizationId: page.organizationId,
          landingPageId: pageId,
          artifactType: "LANDING_PAGE",
          versionNumber: (maxVersion._max.versionNumber ?? 0) + 1,
          status: "ACTIVE",
          releaseNotes: `Rollback to version ${version.versionNumber}`,
          titleSnapshot: version.titleSnapshot,
          subtitleSnapshot: version.subtitleSnapshot,
          bodySnapshot: version.bodySnapshot,
          calloutBoxesSnapshot: version.calloutBoxesSnapshot ?? Prisma.JsonNull,
          visibilitySnapshot: version.visibilitySnapshot,
          expiresAtSnapshot: version.expiresAtSnapshot,
          publishedAtSnapshot: new Date(),
          sourceEditId: version.sourceEditId,
          publishedByUserId: actorUserId,
          rolledBackFromVersionId: version.id,
          provenance: {
            action: "rollback",
            source_version_id: version.id,
            source_version_number: version.versionNumber,
            rolled_back_at: new Date().toISOString(),
            rolled_back_by_user_id: actorUserId,
          },
        },
      });
    });
  }

  // ─── Private ──────────────────────────────────────────────────────

  /**
   * Checks the org's anonymizationEnabled setting. Defaults to true
   * (anonymized) when no OrgSettings record exists.
   */
  private async isAnonymizationEnabled(organizationId: string): Promise<boolean> {
    const settings = await this.prisma.orgSettings.findUnique({
      where: { organizationId },
      select: { anonymizationEnabled: true },
    });
    // Default to true (anonymize) if no settings record exists
    return settings?.anonymizationEnabled ?? true;
  }

  private async generateUniqueSlug(title: string): Promise<string> {
    const base = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);

    const suffix = crypto.randomBytes(4).toString("hex");
    const slug = `${base}-${suffix}`;

    // Verify uniqueness (collision nearly impossible but be safe)
    const existing = await this.prisma.landingPage.findUnique({
      where: { slug },
    });
    if (existing) {
      return `${base}-${crypto.randomBytes(6).toString("hex")}`;
    }

    return slug;
  }

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
    await this.prisma.$transaction(async (tx) => {
      const page = await tx.landingPage.findUniqueOrThrow({
        where: { id: pageId },
        select: {
          id: true,
          organizationId: true,
          title: true,
          subtitle: true,
          editableBody: true,
          calloutBoxes: true,
          visibility: true,
          expiresAt: true,
          edits: {
            select: { id: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

      await tx.publishedArtifactVersion.updateMany({
        where: {
          landingPageId: page.id,
          organizationId: page.organizationId,
          status: "ACTIVE",
        },
        data: { status: "SUPERSEDED" },
      });

      const maxVersion = await tx.publishedArtifactVersion.aggregate({
        where: {
          landingPageId: page.id,
          organizationId: page.organizationId,
        },
        _max: { versionNumber: true },
      });

      await tx.publishedArtifactVersion.create({
        data: {
          organizationId: page.organizationId,
          landingPageId: page.id,
          artifactType: "LANDING_PAGE",
          versionNumber: (maxVersion._max.versionNumber ?? 0) + 1,
          status: "ACTIVE",
          releaseNotes: input.releaseNotes ?? null,
          titleSnapshot: page.title,
          subtitleSnapshot: page.subtitle,
          bodySnapshot: page.editableBody,
          calloutBoxesSnapshot: page.calloutBoxes ?? Prisma.JsonNull,
          visibilitySnapshot: page.visibility,
          expiresAtSnapshot: page.expiresAt,
          publishedAtSnapshot: input.publishedAt,
          sourceEditId: page.edits[0]?.id ?? null,
          publishedByUserId: input.publishedByUserId ?? null,
          approvalRequestId: input.approvalRequestId ?? null,
          provenance: (input.provenance ?? {}) as Prisma.InputJsonValue,
        },
      });
    });
  }

  private async detectScrubLeakage(
    accountId: string,
    textFragments: string[]
  ): Promise<string[]> {
    const account = await this.prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      include: {
        domainAliases: { select: { domain: true } },
      },
    });

    const combined = textFragments.join("\n").toLowerCase();
    const candidates = new Set<string>();

    if (account.name) {
      candidates.add(account.name.trim());
      const normalized = normalizeCompanyName(account.name);
      if (normalized) candidates.add(normalized);
    }
    if (account.domain) candidates.add(account.domain.trim());
    for (const alias of account.domainAliases) {
      if (alias.domain) candidates.add(alias.domain.trim());
    }

    const leaked: string[] = [];
    for (const rawCandidate of candidates) {
      const candidate = rawCandidate.toLowerCase();
      if (candidate.length < 3) continue;
      const regex = candidate.includes(".")
        ? new RegExp(escapeRegex(candidate), "i")
        : new RegExp(`\\b${escapeRegex(candidate)}\\b`, "i");
      if (regex.test(combined)) {
        leaked.push(rawCandidate);
      }
    }

    return leaked.slice(0, 10);
  }

  private validatePublishSnapshot(input: {
    title: string | null;
    body: string | null;
    calloutBoxes: Array<{ title?: string | null; body?: string | null }>;
    fieldPrefix: "editable" | "scrubbed";
  }): PublishValidationIssue[] {
    const issues: PublishValidationIssue[] = [];
    const title = (input.title ?? "").trim();
    const body = (input.body ?? "").trim();

    if (title.length < 3) {
      issues.push({
        field: input.fieldPrefix === "editable" ? "title" : "scrubbed_title",
        code: "title_too_short",
        message: "Title must be at least 3 characters before publish.",
      });
    }

    if (!body) {
      issues.push({
        field:
          input.fieldPrefix === "editable" ? "editable_body" : "scrubbed_body",
        code: "body_required",
        message: "Body content is required before publish.",
      });
    } else {
      const plainText = body
        .replace(/[`*_#>|[\]()!~-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const words = plainText.length > 0 ? plainText.split(" ") : [];
      if (plainText.length < 40 || words.length < 8) {
        issues.push({
          field:
            input.fieldPrefix === "editable" ? "editable_body" : "scrubbed_body",
          code: "body_too_short",
          message:
            "Body content is too short to publish. Add more narrative context.",
        });
      }
    }

    input.calloutBoxes.forEach((box, index) => {
      const titleValue = (box.title ?? "").trim();
      const bodyValue = (box.body ?? "").trim();
      if (!titleValue) {
        issues.push({
          field: `callout_boxes.${index}.title`,
          code: "callout_title_required",
          message: `Callout ${index + 1} needs a title before publish.`,
        });
      }
      if (!bodyValue) {
        issues.push({
          field: `callout_boxes.${index}.body`,
          code: "callout_body_required",
          message: `Callout ${index + 1} needs body text before publish.`,
        });
      }
    });

    return issues;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMetricTitle(metricType: string): string {
  const labels: Record<string, string> = {
    cost_savings: "Cost Savings",
    revenue: "Revenue Impact",
    time_saved: "Time Saved",
    efficiency: "Efficiency Gain",
    error_reduction: "Error Reduction",
    adoption: "Adoption Rate",
    scale: "Scale Achieved",
    roi: "Return on Investment",
  };
  return labels[metricType] ?? "Key Metric";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
