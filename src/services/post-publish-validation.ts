import type { PrismaClient } from "@prisma/client";
import { decodeCalloutBoxes, decodeProvenance, encodeJsonValue } from "../types/json-boundaries.js";
import { collectLinkCandidates, validateLinkSyntax } from "./publish-link-utils.js";
import { assertSafeOutboundUrl, parseHostAllowlist } from "../lib/url-security.js";

export interface PostPublishValidationJobData {
  organizationId: string;
  pageId: string;
  publishedByUserId?: string;
}

export interface BrokenLinkResult {
  field: string;
  url: string;
  statusCode: number | null;
  reason: string;
}

export interface PublishValidationSnapshot {
  status: "PASS" | "FAIL";
  checked_at: string;
  links_checked: number;
  broken_links: BrokenLinkResult[];
  warnings: string[];
}

interface LinkCheckResult {
  statusCode: number | null;
  broken: boolean;
  reason: string;
}

const LINK_CHECK_TIMEOUT_MS = 6000;
const MAX_LINKS_PER_PAGE = 30;
const LINK_CHECK_HOST_ALLOWLIST = parseHostAllowlist(
  process.env.POST_PUBLISH_VALIDATION_HOST_ALLOWLIST
);

export class PostPublishValidationService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async runAndPersist(
    input: PostPublishValidationJobData
  ): Promise<PublishValidationSnapshot | null> {
    const page = await this.prisma.landingPage.findFirst({
      where: {
        id: input.pageId,
        organizationId: input.organizationId,
        status: "PUBLISHED",
      },
      select: {
        id: true,
        organizationId: true,
        title: true,
        subtitle: true,
        editableBody: true,
        scrubbedBody: true,
        calloutBoxes: true,
        scrubbedCalloutBoxes: true,
      },
    });

    if (!page) {
      return null;
    }

    const callouts = decodeCalloutBoxes(page.scrubbedCalloutBoxes);
    const fallbackCallouts =
      callouts.length > 0 ? callouts : decodeCalloutBoxes(page.calloutBoxes);
    const candidates = collectLinkCandidates([
      { field: "title", text: page.title },
      { field: "subtitle", text: page.subtitle },
      { field: "body", text: page.scrubbedBody || page.editableBody },
      ...fallbackCallouts.flatMap((box, index) => [
        { field: `callout_boxes.${index}.title`, text: box.title },
        { field: `callout_boxes.${index}.body`, text: box.body },
      ]),
    ]);

    const syntaxIssues = validateLinkSyntax(candidates);
    const warnings: string[] = [];
    if (candidates.length > MAX_LINKS_PER_PAGE) {
      warnings.push(
        `Link validation capped at ${MAX_LINKS_PER_PAGE} links (found ${candidates.length}).`
      );
    }

    const checkTargets = candidates
      .slice(0, MAX_LINKS_PER_PAGE)
      .filter((item) => this.toCheckUrl(item.url) !== null);

    const checked = await Promise.all(
      checkTargets.map(async (candidate) => {
        const checkUrl = this.toCheckUrl(candidate.url);
        if (!checkUrl) {
          return null;
        }
        const result = await this.checkUrl(checkUrl);
        if (!result.broken) {
          return null;
        }
        return {
          field: candidate.field,
          url: candidate.url,
          statusCode: result.statusCode,
          reason: result.reason,
        } satisfies BrokenLinkResult;
      })
    );

    const brokenLinks: BrokenLinkResult[] = [];
    for (const issue of syntaxIssues) {
      brokenLinks.push({
        field: issue.field,
        url: issue.url,
        statusCode: null,
        reason: issue.message,
      });
    }
    for (const item of checked) {
      if (item) {
        brokenLinks.push(item);
      }
    }

    const snapshot: PublishValidationSnapshot = {
      status: brokenLinks.length > 0 ? "FAIL" : "PASS",
      checked_at: new Date().toISOString(),
      links_checked: checkTargets.length,
      broken_links: brokenLinks,
      warnings,
    };

    const activeVersion = await this.prisma.publishedArtifactVersion.findFirst({
      where: {
        landingPageId: page.id,
        organizationId: page.organizationId,
        status: "ACTIVE",
      },
      orderBy: { versionNumber: "desc" },
      select: { id: true, provenance: true },
    });

    if (!activeVersion) {
      return snapshot;
    }

    const existingProvenance = decodeProvenance(activeVersion.provenance);
    await this.prisma.publishedArtifactVersion.update({
      where: { id: activeVersion.id },
      data: {
        provenance: encodeJsonValue({
          ...existingProvenance,
          post_publish_validation: snapshot,
        }),
      },
    });

    return snapshot;
  }

  private toCheckUrl(rawUrl: string): string | null {
    if (/^(?:mailto|tel):/i.test(rawUrl) || rawUrl.startsWith("#")) {
      return null;
    }
    if (/^https?:/i.test(rawUrl)) {
      return rawUrl;
    }
    if (rawUrl.startsWith("/") || rawUrl.startsWith("./") || rawUrl.startsWith("../")) {
      const appUrl = process.env.APP_URL ?? "http://localhost:3000";
      return new URL(rawUrl, appUrl).toString();
    }
    return null;
  }

  private async checkUrl(url: string): Promise<LinkCheckResult> {
    const headResult = await this.fetchStatus(url, "HEAD");
    if (headResult.statusCode === 405 || headResult.statusCode === 501) {
      return this.fetchStatus(url, "GET");
    }
    return headResult;
  }

  private async fetchStatus(
    url: string,
    method: "HEAD" | "GET"
  ): Promise<LinkCheckResult> {
    try {
      await assertSafeOutboundUrl(url, {
        allowHttp: true,
        allowHttps: true,
        denyPrivateNetworks: true,
        allowlistHosts: LINK_CHECK_HOST_ALLOWLIST,
      });
    } catch {
      return {
        statusCode: null,
        broken: true,
        reason: `${method} blocked by outbound URL policy`,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LINK_CHECK_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method,
        redirect: "follow",
        signal: controller.signal,
      });
      if (response.status >= 200 && response.status < 400) {
        return { statusCode: response.status, broken: false, reason: "ok" };
      }
      return {
        statusCode: response.status,
        broken: true,
        reason: `${method} returned HTTP ${response.status}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "network error";
      return { statusCode: null, broken: true, reason: `${method} failed: ${message}` };
    } finally {
      clearTimeout(timer);
    }
  }
}
