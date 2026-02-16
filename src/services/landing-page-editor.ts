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
import type { PrismaClient, PageVisibility, PageStatus } from "@prisma/client";
import { CompanyScrubber } from "./company-scrubber.js";

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
   * Publishes a landing page. Scrubs the company name and sets it live.
   */
  async publish(
    pageId: string,
    options: PublishOptions
  ): Promise<{ slug: string; url: string }> {
    const page = await this.prisma.landingPage.findUniqueOrThrow({
      where: { id: pageId },
      include: { story: { select: { accountId: true } } },
    });

    // Named pages (admin-only) skip scrubbing entirely
    const skipScrub = page.includeCompanyName;
    const scrubOpts = { skipScrub };

    // Scrub company name from the body (or pass-through for named pages)
    const scrubResult = await this.scrubber.scrubForAccount(
      page.story.accountId,
      page.editableBody,
      scrubOpts
    );

    // Also scrub the title and subtitle
    const titleScrub = await this.scrubber.scrubForAccount(
      page.story.accountId,
      page.title,
      scrubOpts
    );
    const subtitleScrub = page.subtitle
      ? await this.scrubber.scrubForAccount(
          page.story.accountId,
          page.subtitle,
          scrubOpts
        )
      : null;

    // Also scrub callout boxes
    let scrubbedCallouts = page.calloutBoxes;
    if (page.calloutBoxes && Array.isArray(page.calloutBoxes)) {
      const callouts = page.calloutBoxes as unknown as CalloutBox[];
      const scrubbedArray: CalloutBox[] = [];
      for (const box of callouts) {
        const bodyScrub = await this.scrubber.scrubForAccount(
          page.story.accountId,
          box.body,
          scrubOpts
        );
        const titleScrub2 = await this.scrubber.scrubForAccount(
          page.story.accountId,
          box.title,
          scrubOpts
        );
        scrubbedArray.push({
          ...box,
          title: titleScrub2.scrubbedText,
          body: bodyScrub.scrubbedText,
        });
      }
      scrubbedCallouts = scrubbedArray as unknown as typeof page.calloutBoxes;
    }

    await this.prisma.landingPage.update({
      where: { id: pageId },
      data: {
        scrubbedBody: scrubResult.scrubbedText,
        calloutBoxes: scrubbedCallouts ?? undefined,
        status: "PUBLISHED",
        visibility: options.visibility,
        password: options.password ?? null,
        expiresAt: options.expiresAt ?? null,
        publishedAt: new Date(),
        noIndex: true, // always noindex
      },
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
   * Fetches the public (scrubbed) landing page by slug.
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
    if (page.password && page.password !== password) return null;

    // Increment view count
    await this.prisma.landingPage.update({
      where: { id: page.id },
      data: { viewCount: { increment: 1 } },
    });

    return {
      title: page.scrubbedBody ? await this.getScrubbed(page, "title") : page.title,
      subtitle: page.subtitle,
      body: page.scrubbedBody || page.editableBody,
      calloutBoxes: (page.calloutBoxes as unknown as CalloutBox[]) ?? [],
      totalCallHours: page.totalCallHours,
      heroImageUrl: page.heroImageUrl,
      customCss: page.customCss,
      publishedAt: page.publishedAt,
    };
  }

  /**
   * Generates a preview of the landing page as it would appear publicly.
   * Runs the company scrubber on the current editable content (title,
   * subtitle, body, callout boxes) and returns the result in the same
   * shape consumed by `renderLandingPageHtml`.
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

    const skipScrub = page.includeCompanyName;
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

  // ─── Private ──────────────────────────────────────────────────────

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

  private async getScrubbed(
    page: { title: string; storyId: string },
    _field: string
  ): Promise<string> {
    // Title was already scrubbed during publish, but this is a fallback
    const story = await this.prisma.story.findUnique({
      where: { id: page.storyId },
      select: { accountId: true },
    });
    if (!story) return page.title;

    const result = await this.scrubber.scrubForAccount(
      story.accountId,
      page.title
    );
    return result.scrubbedText;
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
