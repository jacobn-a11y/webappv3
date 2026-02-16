/**
 * Weekly Story Regeneration Service
 *
 * Scheduled via BullMQ repeatable job. For every organization, finds
 * accounts that received new calls since the last FULL_JOURNEY story
 * was generated, rebuilds the story, diffs against the previous version,
 * and compiles results so an email digest can be sent to org admins.
 */

import type { PrismaClient } from "@prisma/client";
import { diffLines } from "diff";
import { StoryBuilder } from "./story-builder.js";
import { EmailService, type AccountChange } from "./email.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface EligibleAccount {
  accountId: string;
  accountName: string;
  organizationId: string;
  /** Most recent FULL_JOURNEY story for this account, or null if none */
  lastStoryId: string | null;
  lastStoryMarkdown: string | null;
  lastStoryGeneratedAt: Date | null;
  /** Number of new calls since lastStoryGeneratedAt */
  newCallCount: number;
}

interface RegenResult {
  accountId: string;
  accountName: string;
  organizationId: string;
  previousStoryId: string | null;
  newStoryId: string;
  newCallCount: number;
  change: AccountChange;
}

export interface WeeklyRegenJobData {
  /** Optionally restrict to a single org (useful for testing). */
  organizationId?: string;
}

// ─── Section Parsing ─────────────────────────────────────────────────────────

interface MarkdownSection {
  heading: string;
  content: string;
}

/**
 * Parses a markdown document into sections by ## headings.
 */
function parseSections(markdown: string): MarkdownSection[] {
  const lines = markdown.split("\n");
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      if (current) sections.push(current);
      current = { heading: headingMatch[1].trim(), content: "" };
    } else if (current) {
      current.content += line + "\n";
    }
  }
  if (current) sections.push(current);

  return sections;
}

// ─── Diff Logic ──────────────────────────────────────────────────────────────

interface StoryDiff {
  /** Human-readable summary sentence */
  summary: string;
  sectionsAdded: string[];
  sectionsRemoved: string[];
  sectionsModified: string[];
  linesAdded: number;
  linesRemoved: number;
}

/**
 * Computes a structured diff between two markdown story versions.
 */
function computeStoryDiff(
  oldMarkdown: string,
  newMarkdown: string
): StoryDiff {
  const oldSections = parseSections(oldMarkdown);
  const newSections = parseSections(newMarkdown);

  const oldHeadings = new Map(oldSections.map((s) => [s.heading, s.content]));
  const newHeadings = new Map(newSections.map((s) => [s.heading, s.content]));

  const sectionsAdded: string[] = [];
  const sectionsRemoved: string[] = [];
  const sectionsModified: string[] = [];

  // Check for added and modified sections
  for (const [heading, content] of newHeadings) {
    if (!oldHeadings.has(heading)) {
      sectionsAdded.push(heading);
    } else if (oldHeadings.get(heading)!.trim() !== content.trim()) {
      sectionsModified.push(heading);
    }
  }

  // Check for removed sections
  for (const heading of oldHeadings.keys()) {
    if (!newHeadings.has(heading)) {
      sectionsRemoved.push(heading);
    }
  }

  // Line-level diff for counts
  const lineDiff = diffLines(oldMarkdown, newMarkdown);
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const part of lineDiff) {
    if (part.added) linesAdded += part.count ?? 0;
    if (part.removed) linesRemoved += part.count ?? 0;
  }

  // Build summary sentence
  const parts: string[] = [];
  if (sectionsAdded.length > 0) {
    parts.push(
      `${sectionsAdded.length} section${sectionsAdded.length > 1 ? "s" : ""} added`
    );
  }
  if (sectionsModified.length > 0) {
    parts.push(
      `${sectionsModified.length} section${sectionsModified.length > 1 ? "s" : ""} updated`
    );
  }
  if (sectionsRemoved.length > 0) {
    parts.push(
      `${sectionsRemoved.length} section${sectionsRemoved.length > 1 ? "s" : ""} removed`
    );
  }
  if (parts.length === 0) {
    parts.push("minor wording changes");
  }

  const summary =
    `Story regenerated with ${linesAdded} line${linesAdded === 1 ? "" : "s"} added and ${linesRemoved} removed — ${parts.join(", ")}.`;

  return {
    summary,
    sectionsAdded,
    sectionsRemoved,
    sectionsModified,
    linesAdded,
    linesRemoved,
  };
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class WeeklyStoryRegeneration {
  private prisma: PrismaClient;
  private storyBuilder: StoryBuilder;
  private emailService: EmailService;

  constructor(
    prisma: PrismaClient,
    storyBuilder: StoryBuilder,
    emailService: EmailService
  ) {
    this.prisma = prisma;
    this.storyBuilder = storyBuilder;
    this.emailService = emailService;
  }

  /**
   * Main entry point — called by the BullMQ worker.
   *
   * 1. Find all accounts across orgs with new calls since their last FULL_JOURNEY story
   * 2. Regenerate the story for each account
   * 3. Diff against the previous version
   * 4. Group results by org and email the digest to admins
   */
  async run(data: WeeklyRegenJobData = {}): Promise<{
    accountsProcessed: number;
    orgsNotified: number;
    errors: string[];
  }> {
    const runDate = new Date();
    const errors: string[] = [];

    // Step 1: Find eligible accounts
    const eligible = await this.findEligibleAccounts(data.organizationId);
    console.log(
      `[story-regen] Found ${eligible.length} account(s) with new calls`
    );

    if (eligible.length === 0) {
      return { accountsProcessed: 0, orgsNotified: 0, errors };
    }

    // Step 2: Regenerate stories and compute diffs
    const results: RegenResult[] = [];

    for (const account of eligible) {
      try {
        const result = await this.regenerateAccountStory(account);
        results.push(result);
      } catch (err) {
        const msg = `Failed to regenerate story for account ${account.accountName} (${account.accountId}): ${(err as Error).message}`;
        console.error(`[story-regen] ${msg}`);
        errors.push(msg);
      }
    }

    // Step 3: Group by org and send digest emails
    const byOrg = new Map<string, RegenResult[]>();
    for (const result of results) {
      const existing = byOrg.get(result.organizationId) ?? [];
      existing.push(result);
      byOrg.set(result.organizationId, existing);
    }

    let orgsNotified = 0;

    for (const [orgId, orgResults] of byOrg) {
      try {
        await this.sendOrgDigest(orgId, orgResults, runDate);
        orgsNotified++;
      } catch (err) {
        const msg = `Failed to send digest for org ${orgId}: ${(err as Error).message}`;
        console.error(`[story-regen] ${msg}`);
        errors.push(msg);
      }
    }

    console.log(
      `[story-regen] Complete: ${results.length} account(s) processed, ${orgsNotified} org(s) notified`
    );

    return {
      accountsProcessed: results.length,
      orgsNotified,
      errors,
    };
  }

  // ─── Step 1: Find Eligible Accounts ──────────────────────────────

  /**
   * Finds accounts that have new calls since their last FULL_JOURNEY story.
   *
   * An account is eligible if:
   *  - It has at least one call with a processed transcript (has chunks)
   *  - AND either:
   *    a) It has never had a FULL_JOURNEY story generated, OR
   *    b) It has calls with `createdAt` after the latest FULL_JOURNEY story's `generatedAt`
   */
  private async findEligibleAccounts(
    orgId?: string
  ): Promise<EligibleAccount[]> {
    // Get all organizations (or a specific one)
    const orgs = await this.prisma.organization.findMany({
      where: orgId ? { id: orgId } : undefined,
      select: { id: true },
    });

    const eligible: EligibleAccount[] = [];

    for (const org of orgs) {
      // Get all accounts for this org that have at least one call with a transcript
      const accounts = await this.prisma.account.findMany({
        where: {
          organizationId: org.id,
          calls: {
            some: {
              transcript: { isNot: null },
            },
          },
        },
        select: {
          id: true,
          name: true,
          organizationId: true,
        },
      });

      for (const account of accounts) {
        // Find the latest FULL_JOURNEY story for this account
        const latestStory = await this.prisma.story.findFirst({
          where: {
            accountId: account.id,
            organizationId: org.id,
            storyType: "FULL_JOURNEY",
          },
          orderBy: { generatedAt: "desc" },
          select: {
            id: true,
            markdownBody: true,
            generatedAt: true,
          },
        });

        // Count calls that arrived after the last story was generated
        const newCallCount = await this.prisma.call.count({
          where: {
            accountId: account.id,
            organizationId: org.id,
            transcript: { isNot: null },
            ...(latestStory
              ? { createdAt: { gt: latestStory.generatedAt } }
              : {}),
          },
        });

        if (newCallCount > 0) {
          eligible.push({
            accountId: account.id,
            accountName: account.name,
            organizationId: org.id,
            lastStoryId: latestStory?.id ?? null,
            lastStoryMarkdown: latestStory?.markdownBody ?? null,
            lastStoryGeneratedAt: latestStory?.generatedAt ?? null,
            newCallCount,
          });
        }
      }
    }

    return eligible;
  }

  // ─── Step 2: Regenerate Story & Diff ─────────────────────────────

  private async regenerateAccountStory(
    account: EligibleAccount
  ): Promise<RegenResult> {
    console.log(
      `[story-regen] Regenerating FULL_JOURNEY for ${account.accountName} (${account.newCallCount} new calls)`
    );

    // Build a new FULL_JOURNEY story (no funnel stage or topic filters = full journey)
    const result = await this.storyBuilder.buildStory({
      accountId: account.accountId,
      organizationId: account.organizationId,
    });

    // Find the newly created story record (most recent for this account)
    const newStory = await this.prisma.story.findFirst({
      where: {
        accountId: account.accountId,
        organizationId: account.organizationId,
        storyType: "FULL_JOURNEY",
      },
      orderBy: { generatedAt: "desc" },
      select: { id: true },
    });

    if (!newStory) {
      throw new Error("Story was built but could not be found in the database");
    }

    // Compute diff
    const isFirstStory = account.lastStoryMarkdown === null;
    let change: AccountChange;

    if (isFirstStory) {
      const sections = parseSections(result.markdownBody);
      change = {
        accountName: account.accountName,
        accountId: account.accountId,
        newCallCount: account.newCallCount,
        diffSummary: `First Full Journey story generated from ${account.newCallCount} call${account.newCallCount === 1 ? "" : "s"}.`,
        sectionsAdded: sections.map((s) => s.heading),
        sectionsRemoved: [],
        sectionsModified: [],
        isFirstStory: true,
      };
    } else {
      const diff = computeStoryDiff(
        account.lastStoryMarkdown!,
        result.markdownBody
      );
      change = {
        accountName: account.accountName,
        accountId: account.accountId,
        newCallCount: account.newCallCount,
        diffSummary: diff.summary,
        sectionsAdded: diff.sectionsAdded,
        sectionsRemoved: diff.sectionsRemoved,
        sectionsModified: diff.sectionsModified,
        isFirstStory: false,
      };
    }

    // Log the regeneration
    await this.prisma.storyRegenLog.create({
      data: {
        organizationId: account.organizationId,
        accountId: account.accountId,
        previousStoryId: account.lastStoryId,
        newStoryId: newStory.id,
        callsProcessed: account.newCallCount,
        diffSummary: change.diffSummary,
      },
    });

    return {
      accountId: account.accountId,
      accountName: account.accountName,
      organizationId: account.organizationId,
      previousStoryId: account.lastStoryId,
      newStoryId: newStory.id,
      newCallCount: account.newCallCount,
      change,
    };
  }

  // ─── Step 3: Send Digest ─────────────────────────────────────────

  private async sendOrgDigest(
    orgId: string,
    results: RegenResult[],
    runDate: Date
  ): Promise<void> {
    // Get org details and admin emails
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { name: true },
    });

    const admins = await this.prisma.user.findMany({
      where: {
        organizationId: orgId,
        role: { in: ["OWNER", "ADMIN"] },
      },
      select: { email: true },
    });

    const adminEmails = admins.map((a) => a.email);

    if (adminEmails.length === 0) {
      console.log(`[story-regen] No admins found for org ${orgId}, skipping email`);
      return;
    }

    console.log(
      `[story-regen] Sending digest for ${org.name} to ${adminEmails.length} admin(s)`
    );

    await this.emailService.sendWeeklyDigest({
      to: adminEmails,
      orgName: org.name,
      accountChanges: results.map((r) => r.change),
      runDate,
    });
  }
}
