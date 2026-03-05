import crypto from "crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { normalizeCompanyName } from "./entity-resolution.js";
import { collectLinkCandidates, validateLinkSyntax } from "./publish-link-utils.js";
import type { CalloutBox } from "./landing-page-editor-types.js";
import type { PublishedBrandingSettings, StoryContextSettings } from "../types/story-generation.js";

export interface PublishValidationIssue {
  field: string;
  code: string;
  message: string;
}

export function formatMetricTitle(metricType: string): string {
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

export async function getPagePresentationSettings(
  prisma: PrismaClient,
  organizationId: string
): Promise<{
  anonymizationEnabled: boolean;
  publishedBranding: PublishedBrandingSettings | null;
}> {
  const settings = await prisma.orgSettings.findUnique({
    where: { organizationId },
    select: { anonymizationEnabled: true, storyContext: true },
  });
  const storyContext = (settings?.storyContext ?? {}) as StoryContextSettings;
  return {
    anonymizationEnabled: settings?.anonymizationEnabled ?? true,
    publishedBranding: storyContext.publishedBranding ?? null,
  };
}

export async function syncStoryPublishedAtFromLandingPages(
  prisma: PrismaClient,
  storyId: string
): Promise<void> {
  const latestPublished = await prisma.landingPage.findFirst({
    where: {
      storyId,
      status: "PUBLISHED",
      publishedAt: { not: null },
    },
    select: { publishedAt: true },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
  });

  await prisma.story.update({
    where: { id: storyId },
    data: { publishedAt: latestPublished?.publishedAt ?? null },
  });
}

export async function generateUniqueSlug(
  prisma: PrismaClient,
  title: string
): Promise<string> {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

  const suffix = crypto.randomBytes(4).toString("hex");
  const slug = `${base}-${suffix}`;

  const existing = await prisma.landingPage.findUnique({
    where: { slug },
  });
  if (existing) {
    return `${base}-${crypto.randomBytes(6).toString("hex")}`;
  }

  return slug;
}

export async function createArtifactVersion(
  prisma: PrismaClient,
  pageId: string,
  input: {
    releaseNotes?: string;
    approvalRequestId?: string;
    publishedByUserId?: string;
    provenance?: Record<string, unknown>;
    publishedAt: Date;
  }
): Promise<void> {
  await prisma.$transaction(async (tx) => {
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

export async function detectScrubLeakage(
  prisma: PrismaClient,
  accountId: string,
  textFragments: string[]
): Promise<string[]> {
  const account = await prisma.account.findUniqueOrThrow({
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

export function validatePublishSnapshot(input: {
  title: string | null;
  body: string | null;
  subtitle?: string | null;
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
      field: input.fieldPrefix === "editable" ? "editable_body" : "scrubbed_body",
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
        field: input.fieldPrefix === "editable" ? "editable_body" : "scrubbed_body",
        code: "body_too_short",
        message: "Body content is too short to publish. Add more narrative context.",
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

  const bodyField = input.fieldPrefix === "editable" ? "editable_body" : "scrubbed_body";
  const titleField = input.fieldPrefix === "editable" ? "title" : "scrubbed_title";
  const subtitleField = input.fieldPrefix === "editable" ? "subtitle" : "scrubbed_subtitle";
  const linkCandidates = collectLinkCandidates([
    { field: titleField, text: input.title },
    { field: subtitleField, text: input.subtitle },
    { field: bodyField, text: input.body },
    ...input.calloutBoxes.flatMap((box, index) => [
      { field: `callout_boxes.${index}.title`, text: box.title },
      { field: `callout_boxes.${index}.body`, text: box.body },
    ]),
  ]);
  for (const issue of validateLinkSyntax(linkCandidates)) {
    issues.push({
      field: issue.field || bodyField,
      code: issue.code,
      message: issue.message,
    });
  }

  return issues;
}

export function buildDefaultCalloutBoxes(
  quotes: Array<{ metricType: string | null; metricValue: string | null; quoteText: string }>,
  calloutBoxes?: CalloutBox[]
): CalloutBox[] {
  if (calloutBoxes) {
    return calloutBoxes;
  }
  return quotes.slice(0, 3).map((quote) => ({
    title: quote.metricType ? formatMetricTitle(quote.metricType) : "Key Insight",
    body: quote.metricValue ? `**${quote.metricValue}** — ${quote.quoteText}` : quote.quoteText,
    icon: quote.metricValue ? ("metric" as const) : ("quote" as const),
  }));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
