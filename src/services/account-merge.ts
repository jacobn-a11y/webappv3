/**
 * Account Merge Service
 *
 * When entity resolution surfaces duplicate accounts (e.g., "Ace Corp" and
 * "Acme, Inc" as separate records), this service provides:
 *
 *   1. Duplicate detection — scans all accounts in an org using normalized-name
 *      similarity (Fuse.js) and overlapping email domains.
 *   2. Side-by-side preview — loads both accounts with their child records
 *      (calls, contacts, stories, landing pages) for comparison.
 *   3. Merge execution — reassigns all child records from the secondary account
 *      to the primary, adds the secondary's domain as a domain alias, and
 *      deletes the secondary account.
 */

import Fuse from "fuse.js";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { normalizeCompanyName } from "./entity-resolution.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DuplicateCandidate {
  accountA: { id: string; name: string; domain: string | null };
  accountB: { id: string; name: string; domain: string | null };
  similarity: number; // 0.0–1.0 (1 = identical)
  matchReason: "normalized_name" | "shared_domain";
}

export interface AccountPreview {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
  annualRevenue: number | null;
  domainAliases: string[];
  contactCount: number;
  callCount: number;
  storyCount: number;
  landingPageCount: number;
  contacts: Array<{
    id: string;
    name: string | null;
    email: string;
    title: string | null;
  }>;
  calls: Array<{
    id: string;
    title: string | null;
    provider: string;
    occurredAt: Date;
    duration: number | null;
  }>;
  stories: Array<{
    id: string;
    title: string;
    storyType: string;
    generatedAt: Date;
  }>;
  landingPages: Array<{
    id: string;
    title: string;
    slug: string;
    status: string;
  }>;
}

export interface MergePreview {
  primary: AccountPreview;
  secondary: AccountPreview;
}

export interface MergeResult {
  primaryAccountId: string;
  deletedAccountId: string;
  mergeRunId: string;
  contactsMoved: number;
  callsMoved: number;
  storiesMoved: number;
  landingPagesMoved: number;
  domainAliasesAdded: string[];
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class AccountMergeService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Scans all accounts in the organization for potential duplicates using
   * normalized-name fuzzy matching and overlapping email domains.
   */
  async findDuplicates(organizationId: string): Promise<DuplicateCandidate[]> {
    const accounts = await this.prisma.account.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        normalizedName: true,
        domain: true,
        domainAliases: { select: { domain: true } },
      },
      orderBy: { name: "asc" },
    });

    if (accounts.length < 2) return [];

    const candidates: DuplicateCandidate[] = [];
    const seenPairs = new Set<string>();

    // ── Strategy 1: Fuzzy name matching ─────────────────────────────

    const fuse = new Fuse(accounts, {
      keys: ["normalizedName"],
      threshold: 0.35,
      includeScore: true,
    });

    for (const account of accounts) {
      const results = fuse.search(account.normalizedName);
      for (const result of results) {
        if (result.item.id === account.id) continue;
        if (result.score === undefined || result.score >= 0.35) continue;

        const pairKey = [account.id, result.item.id].sort().join(":");
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);

        candidates.push({
          accountA: { id: account.id, name: account.name, domain: account.domain },
          accountB: { id: result.item.id, name: result.item.name, domain: result.item.domain },
          similarity: Math.round((1 - result.score) * 100) / 100,
          matchReason: "normalized_name",
        });
      }
    }

    // ── Strategy 2: Shared email domain ─────────────────────────────

    const domainMap = new Map<string, string[]>();
    for (const account of accounts) {
      const allDomains: string[] = [];
      if (account.domain) allDomains.push(account.domain);
      for (const alias of account.domainAliases) {
        allDomains.push(alias.domain);
      }
      for (const d of allDomains) {
        const existing = domainMap.get(d) ?? [];
        existing.push(account.id);
        domainMap.set(d, existing);
      }
    }

    for (const [, accountIds] of domainMap) {
      if (accountIds.length < 2) continue;
      for (let i = 0; i < accountIds.length; i++) {
        for (let j = i + 1; j < accountIds.length; j++) {
          const pairKey = [accountIds[i], accountIds[j]].sort().join(":");
          if (seenPairs.has(pairKey)) continue;
          seenPairs.add(pairKey);

          const acctA = accounts.find((a) => a.id === accountIds[i])!;
          const acctB = accounts.find((a) => a.id === accountIds[j])!;

          candidates.push({
            accountA: { id: acctA.id, name: acctA.name, domain: acctA.domain },
            accountB: { id: acctB.id, name: acctB.name, domain: acctB.domain },
            similarity: 0.95,
            matchReason: "shared_domain",
          });
        }
      }
    }

    // Sort by similarity descending
    candidates.sort((a, b) => b.similarity - a.similarity);

    return candidates;
  }

  /**
   * Loads both accounts with their full child-record details for side-by-side
   * comparison before merging.
   */
  async previewMerge(
    organizationId: string,
    primaryAccountId: string,
    secondaryAccountId: string
  ): Promise<MergePreview> {
    const [primary, secondary] = await Promise.all([
      this.loadAccountPreview(organizationId, primaryAccountId),
      this.loadAccountPreview(organizationId, secondaryAccountId),
    ]);

    return { primary, secondary };
  }

  /**
   * Executes the merge:
   *   1. Reassigns all contacts from secondary to primary (skip duplicates)
   *   2. Reassigns all calls from secondary to primary
   *   3. Reassigns all stories from secondary to primary
   *   4. Updates landing pages that reference moved stories
   *   5. Adds secondary's domain(s) as aliases on the primary
   *   6. Moves SalesforceEvents from secondary to primary
   *   7. Updates UserAccountAccess references
   *   8. Deletes the secondary account
   */
  async executeMerge(
    organizationId: string,
    primaryAccountId: string,
    secondaryAccountId: string,
    initiatedByUserId?: string,
    notes?: string
  ): Promise<MergeResult> {
    // Validate both accounts belong to the same org
    const [primary, secondary] = await Promise.all([
      this.prisma.account.findFirst({
        where: { id: primaryAccountId, organizationId },
      }),
      this.prisma.account.findFirst({
        where: { id: secondaryAccountId, organizationId },
      }),
    ]);

    if (!primary) {
      throw new Error(`Primary account ${primaryAccountId} not found in organization`);
    }
    if (!secondary) {
      throw new Error(`Secondary account ${secondaryAccountId} not found in organization`);
    }
    if (primaryAccountId === secondaryAccountId) {
      throw new Error("Cannot merge an account with itself");
    }

    // Run the merge inside a transaction for atomicity
    return this.prisma.$transaction(async (tx) => {
      const mergePreview = await this.previewMerge(
        organizationId,
        primaryAccountId,
        secondaryAccountId
      );

      // ── 1. Move contacts ─────────────────────────────────────────
      // Find contacts on the secondary that already exist on the primary (by email)
      const primaryContacts = await tx.contact.findMany({
        where: { accountId: primaryAccountId },
        select: { email: true },
      });
      const primaryEmails = new Set(primaryContacts.map((c) => c.email));

      const secondaryContacts = await tx.contact.findMany({
        where: { accountId: secondaryAccountId },
        select: { id: true, email: true },
      });

      let contactsMoved = 0;
      const movedContactIds: string[] = [];
      for (const contact of secondaryContacts) {
        if (primaryEmails.has(contact.email)) {
          // Duplicate email — reassign any call participant links, then delete
          await tx.callParticipant.updateMany({
            where: { contactId: contact.id },
            data: { contactId: null },
          });
          await tx.contact.delete({ where: { id: contact.id } });
        } else {
          await tx.contact.update({
            where: { id: contact.id },
            data: { accountId: primaryAccountId },
          });
          contactsMoved++;
          movedContactIds.push(contact.id);
        }
      }

      // ── 2. Move calls ────────────────────────────────────────────
      const secondaryCalls = await tx.call.findMany({
        where: { accountId: secondaryAccountId },
        select: { id: true },
      });
      const movedCallIds = secondaryCalls.map((c) => c.id);
      const callUpdate = await tx.call.updateMany({
        where: { accountId: secondaryAccountId },
        data: { accountId: primaryAccountId },
      });
      const callsMoved = callUpdate.count;

      // ── 3. Move stories ──────────────────────────────────────────
      const secondaryStories = await tx.story.findMany({
        where: { accountId: secondaryAccountId },
        select: { id: true },
      });
      const movedStoryIds = secondaryStories.map((s) => s.id);
      const storyUpdate = await tx.story.updateMany({
        where: { accountId: secondaryAccountId },
        data: { accountId: primaryAccountId },
      });
      const storiesMoved = storyUpdate.count;

      // ── 4. Move landing pages (via story relationship — already handled)
      // Landing pages reference storyId, not accountId directly.
      // However, they do have an organizationId. Stories were already moved.
      // Count the landing pages associated with the moved stories for reporting.
      const secondaryLandingPages = await tx.landingPage.findMany({
        where: {
          organizationId,
          storyId: { in: movedStoryIds },
        },
        select: { id: true },
      });
      const movedLandingPageIds = secondaryLandingPages.map((p) => p.id);
      const landingPagesMoved = movedLandingPageIds.length;

      // ── 5. Move SalesforceEvents ─────────────────────────────────
      await tx.salesforceEvent.updateMany({
        where: { accountId: secondaryAccountId },
        data: { accountId: primaryAccountId },
      });

      // ── 6. Update UserAccountAccess references ───────────────────
      await tx.userAccountAccess.updateMany({
        where: { accountId: secondaryAccountId },
        data: { accountId: primaryAccountId },
      });

      // ── 7. Add secondary's domain(s) as aliases on primary ───────
      const domainAliasesAdded: string[] = [];

      // Secondary's primary domain
      if (secondary.domain && secondary.domain !== primary.domain) {
        // Check if this domain already exists as an alias on the primary
        const existingAlias = await tx.accountDomain.findUnique({
          where: {
            accountId_domain: {
              accountId: primaryAccountId,
              domain: secondary.domain,
            },
          },
        });
        if (!existingAlias) {
          await tx.accountDomain.create({
            data: { accountId: primaryAccountId, domain: secondary.domain },
          });
          domainAliasesAdded.push(secondary.domain);
        }
      }

      // Secondary's existing domain aliases
      const secondaryAliases = await tx.accountDomain.findMany({
        where: { accountId: secondaryAccountId },
      });
      for (const alias of secondaryAliases) {
        if (alias.domain === primary.domain) {
          // Skip — already the primary's main domain
          await tx.accountDomain.delete({ where: { id: alias.id } });
          continue;
        }
        const existingOnPrimary = await tx.accountDomain.findUnique({
          where: {
            accountId_domain: {
              accountId: primaryAccountId,
              domain: alias.domain,
            },
          },
        });
        if (!existingOnPrimary) {
          // Re-assign the alias record to primary
          await tx.accountDomain.update({
            where: { id: alias.id },
            data: { accountId: primaryAccountId },
          });
          domainAliasesAdded.push(alias.domain);
        } else {
          // Already exists on primary — remove the duplicate
          await tx.accountDomain.delete({ where: { id: alias.id } });
        }
      }

      // ── 8. Merge CRM identifiers if primary is missing them ──────
      const crmUpdates: Record<string, string> = {};
      if (!primary.salesforceId && secondary.salesforceId) {
        crmUpdates.salesforceId = secondary.salesforceId;
      }
      if (!primary.hubspotId && secondary.hubspotId) {
        crmUpdates.hubspotId = secondary.hubspotId;
      }
      if (!primary.mergeAccountId && secondary.mergeAccountId) {
        crmUpdates.mergeAccountId = secondary.mergeAccountId;
      }
      if (!primary.industry && secondary.industry) {
        crmUpdates.industry = secondary.industry;
      }
      if (primary.employeeCount == null && secondary.employeeCount != null) {
        (crmUpdates as Record<string, unknown>).employeeCount = secondary.employeeCount;
      }
      if (primary.annualRevenue == null && secondary.annualRevenue != null) {
        (crmUpdates as Record<string, unknown>).annualRevenue = secondary.annualRevenue;
      }

      if (Object.keys(crmUpdates).length > 0) {
        await tx.account.update({
          where: { id: primaryAccountId },
          data: crmUpdates,
        });
      }

      // ── 9. Delete the secondary account ──────────────────────────
      await tx.account.delete({ where: { id: secondaryAccountId } });

      const mergeRun = await tx.accountMergeRun.create({
        data: {
          organizationId,
          primaryAccountId,
          secondaryAccountId,
          initiatedByUserId: initiatedByUserId ?? null,
          status: "COMPLETED",
          mergePreview: {
            primary: mergePreview.primary,
            secondary: mergePreview.secondary,
          } as unknown as Prisma.InputJsonValue,
          movedContactIds,
          movedCallIds,
          movedStoryIds,
          movedLandingPageIds,
          notes: notes ?? null,
        },
      });

      return {
        primaryAccountId,
        deletedAccountId: secondaryAccountId,
        mergeRunId: mergeRun.id,
        contactsMoved,
        callsMoved,
        storiesMoved,
        landingPagesMoved,
        domainAliasesAdded,
      };
    });
  }

  async undoMerge(
    organizationId: string,
    mergeRunId: string,
    undoneByUserId?: string
  ): Promise<{
    mergeRunId: string;
    restoredSecondaryAccountId: string;
    restoredContacts: number;
    restoredCalls: number;
    restoredStories: number;
  }> {
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.accountMergeRun.findFirst({
        where: { id: mergeRunId, organizationId },
      });
      if (!run) {
        throw new Error("Merge run not found");
      }
      if (run.status === "UNDONE") {
        throw new Error("Merge run already undone");
      }

      const preview =
        run.mergePreview && typeof run.mergePreview === "object"
          ? (run.mergePreview as unknown as {
              secondary?: {
                id: string;
                name: string;
                domain: string | null;
                industry: string | null;
                employeeCount: number | null;
                annualRevenue: number | null;
              };
            })
          : {};
      const secondary = preview.secondary;
      if (!secondary) {
        throw new Error("Merge run is missing secondary account snapshot");
      }

      const existingSecondary = await tx.account.findFirst({
        where: { id: secondary.id, organizationId },
      });
      if (!existingSecondary) {
        await tx.account.create({
          data: {
            id: secondary.id,
            organizationId,
            name: secondary.name,
            normalizedName: normalizeCompanyName(secondary.name),
            domain: secondary.domain ?? null,
            industry: secondary.industry ?? null,
            employeeCount: secondary.employeeCount ?? null,
            annualRevenue: secondary.annualRevenue ?? null,
          },
        });
      }

      const restoredContacts = (
        await tx.contact.updateMany({
          where: { id: { in: run.movedContactIds }, accountId: run.primaryAccountId },
          data: { accountId: run.secondaryAccountId },
        })
      ).count;
      const restoredCalls = (
        await tx.call.updateMany({
          where: { id: { in: run.movedCallIds }, accountId: run.primaryAccountId },
          data: { accountId: run.secondaryAccountId },
        })
      ).count;
      const restoredStories = (
        await tx.story.updateMany({
          where: { id: { in: run.movedStoryIds }, accountId: run.primaryAccountId },
          data: { accountId: run.secondaryAccountId },
        })
      ).count;

      await tx.accountMergeRun.update({
        where: { id: run.id },
        data: {
          status: "UNDONE",
          undoneByUserId: undoneByUserId ?? null,
          undoneAt: new Date(),
        },
      });

      return {
        mergeRunId: run.id,
        restoredSecondaryAccountId: run.secondaryAccountId,
        restoredContacts,
        restoredCalls,
        restoredStories,
      };
    });
  }

  async listMergeRuns(organizationId: string): Promise<
    Array<{
      id: string;
      primaryAccountId: string;
      secondaryAccountId: string;
      status: string;
      createdAt: Date;
      undoneAt: Date | null;
      movedCounts: {
        contacts: number;
        calls: number;
        stories: number;
        landingPages: number;
      };
    }>
  > {
    const runs = await this.prisma.accountMergeRun.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return runs.map((run) => ({
      id: run.id,
      primaryAccountId: run.primaryAccountId,
      secondaryAccountId: run.secondaryAccountId,
      status: run.status,
      createdAt: run.createdAt,
      undoneAt: run.undoneAt ?? null,
      movedCounts: {
        contacts: run.movedContactIds.length,
        calls: run.movedCallIds.length,
        stories: run.movedStoryIds.length,
        landingPages: run.movedLandingPageIds.length,
      },
    }));
  }

  // ─── Private ────────────────────────────────────────────────────────

  private async loadAccountPreview(
    organizationId: string,
    accountId: string
  ): Promise<AccountPreview> {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, organizationId },
      include: {
        domainAliases: { select: { domain: true } },
        contacts: {
          select: { id: true, name: true, email: true, title: true },
          orderBy: { createdAt: "desc" },
        },
        calls: {
          select: {
            id: true,
            title: true,
            provider: true,
            occurredAt: true,
            duration: true,
          },
          orderBy: { occurredAt: "desc" },
        },
        stories: {
          select: {
            id: true,
            title: true,
            storyType: true,
            generatedAt: true,
          },
          orderBy: { generatedAt: "desc" },
        },
      },
    });

    if (!account) {
      throw new Error(`Account ${accountId} not found in organization`);
    }

    // Landing pages are linked via stories
    const landingPages = await this.prisma.landingPage.findMany({
      where: {
        organizationId,
        storyId: { in: account.stories.map((s) => s.id) },
      },
      select: { id: true, title: true, slug: true, status: true },
      orderBy: { createdAt: "desc" },
    });

    return {
      id: account.id,
      name: account.name,
      domain: account.domain,
      industry: account.industry,
      employeeCount: account.employeeCount,
      annualRevenue: account.annualRevenue,
      domainAliases: account.domainAliases.map((a) => a.domain),
      contactCount: account.contacts.length,
      callCount: account.calls.length,
      storyCount: account.stories.length,
      landingPageCount: landingPages.length,
      contacts: account.contacts,
      calls: account.calls,
      stories: account.stories,
      landingPages,
    };
  }
}
