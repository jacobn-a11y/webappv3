/**
 * Entity Resolution Queue Service
 *
 * Manages the review queue for unresolved or low-confidence call-to-account
 * matches. Provides:
 *   - Queue listing with filters (matchMethod=NONE or confidence < 0.7)
 *   - Top-3 fuzzy match suggestions per call
 *   - Manual resolution (assign call to account + update domain aliases)
 *   - Bulk actions: merge accounts, create account from call, dismiss
 */

import Fuse from "fuse.js";
import type { PrismaClient } from "@prisma/client";
import { normalizeCompanyName, extractEmailDomain } from "./entity-resolution.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QueuedCall {
  id: string;
  title: string | null;
  provider: string;
  occurredAt: string;
  duration: number | null;
  matchMethod: string;
  matchConfidence: number;
  participants: Array<{
    id: string;
    email: string | null;
    name: string | null;
    isHost: boolean;
  }>;
  suggestedMatches: SuggestedMatch[];
}

export interface SuggestedMatch {
  accountId: string;
  accountName: string;
  domain: string | null;
  confidence: number;
  matchReason: string;
}

export interface QueueListResult {
  calls: QueuedCall[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class EntityResolutionQueueService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Lists calls that need manual entity resolution review.
   * Criteria: matchMethod=NONE or matchConfidence < 0.7, not dismissed.
   */
  async listQueue(
    organizationId: string,
    options: {
      page?: number;
      pageSize?: number;
      search?: string;
      sortBy?: "occurredAt" | "matchConfidence";
      sortOrder?: "asc" | "desc";
    } = {}
  ): Promise<QueueListResult> {
    const page = options.page ?? 1;
    const pageSize = Math.min(options.pageSize ?? 25, 100);
    const sortBy = options.sortBy ?? "occurredAt";
    const sortOrder = options.sortOrder ?? "desc";

    const where = {
      organizationId,
      dismissedAt: null,
      OR: [
        { matchMethod: "NONE" as const },
        { matchConfidence: { lt: 0.7 } },
      ],
      ...(options.search
        ? {
            OR: [
              { matchMethod: "NONE" as const, title: { contains: options.search, mode: "insensitive" as const } },
              { matchConfidence: { lt: 0.7 }, title: { contains: options.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    // Build search filter
    const searchFilter = options.search
      ? {
          organizationId,
          dismissedAt: null,
          title: { contains: options.search, mode: "insensitive" as const },
          OR: [
            { matchMethod: "NONE" as const },
            { matchConfidence: { lt: 0.7 } },
          ],
        }
      : where;

    const [calls, total] = await Promise.all([
      this.prisma.call.findMany({
        where: searchFilter,
        include: {
          participants: {
            select: { id: true, email: true, name: true, isHost: true },
          },
        },
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.call.count({ where: searchFilter }),
    ]);

    // Load all accounts for suggestion generation
    const accounts = await this.prisma.account.findMany({
      where: { organizationId },
      select: { id: true, name: true, normalizedName: true, domain: true },
    });

    // Load domain aliases for richer matching
    const domainAliases = await this.prisma.accountDomain.findMany({
      where: { account: { organizationId } },
      include: { account: { select: { id: true, name: true } } },
    });

    // Build domain-to-account lookup
    const domainToAccount = new Map<string, { id: string; name: string; domain: string | null }>();
    for (const acct of accounts) {
      if (acct.domain) {
        domainToAccount.set(acct.domain, { id: acct.id, name: acct.name, domain: acct.domain });
      }
    }
    for (const alias of domainAliases) {
      domainToAccount.set(alias.domain, {
        id: alias.account.id,
        name: alias.account.name,
        domain: alias.domain,
      });
    }

    // Build Fuse index for fuzzy suggestions
    const fuse = new Fuse(accounts, {
      keys: ["normalizedName"],
      threshold: 0.5, // more lenient than production resolution to surface suggestions
      includeScore: true,
    });

    const queuedCalls: QueuedCall[] = calls.map((call) => {
      const suggestions = this.generateSuggestions(
        call,
        fuse,
        accounts,
        domainToAccount
      );

      return {
        id: call.id,
        title: call.title,
        provider: call.provider,
        occurredAt: call.occurredAt.toISOString(),
        duration: call.duration,
        matchMethod: call.matchMethod,
        matchConfidence: call.matchConfidence,
        participants: call.participants,
        suggestedMatches: suggestions,
      };
    });

    return { calls: queuedCalls, total, page, pageSize };
  }

  /**
   * Manually assigns a call to an account. Updates domain aliases for
   * future auto-resolution.
   */
  async resolveCall(
    callId: string,
    accountId: string,
    organizationId: string
  ): Promise<void> {
    // Verify call belongs to org
    const call = await this.prisma.call.findFirst({
      where: { id: callId, organizationId },
      include: { participants: true },
    });

    if (!call) {
      throw new Error("Call not found");
    }

    // Verify account belongs to org
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, organizationId },
    });

    if (!account) {
      throw new Error("Account not found");
    }

    // Update call with manual resolution
    await this.prisma.call.update({
      where: { id: callId },
      data: {
        accountId,
        matchMethod: "MANUAL",
        matchConfidence: 1.0,
      },
    });

    // Extract participant email domains and add as account domain aliases
    // so future calls with these domains auto-resolve
    const newDomains = new Set<string>();
    for (const p of call.participants) {
      if (p.email) {
        const domain = extractEmailDomain(p.email);
        if (domain && domain !== account.domain) {
          newDomains.add(domain);
        }
      }
    }

    for (const domain of newDomains) {
      // Check if domain is already associated with any account
      const existingPrimary = await this.prisma.account.findFirst({
        where: { organizationId, domain },
      });
      const existingAlias = await this.prisma.accountDomain.findFirst({
        where: { domain, account: { organizationId } },
      });

      if (!existingPrimary && !existingAlias) {
        await this.prisma.accountDomain.create({
          data: { accountId, domain },
        });
      }
    }

    // Upsert contacts for participants with emails
    for (const p of call.participants) {
      if (!p.email) continue;
      const domain = extractEmailDomain(p.email);
      if (!domain) continue;

      await this.prisma.contact.upsert({
        where: {
          accountId_email: {
            accountId,
            email: p.email.toLowerCase(),
          },
        },
        create: {
          accountId,
          email: p.email.toLowerCase(),
          emailDomain: domain,
          name: p.name ?? null,
        },
        update: {
          name: p.name ?? undefined,
        },
      });
    }
  }

  /**
   * Bulk resolve: assign multiple calls to a single account.
   */
  async bulkResolve(
    callIds: string[],
    accountId: string,
    organizationId: string
  ): Promise<{ resolved: number }> {
    let resolved = 0;
    for (const callId of callIds) {
      try {
        await this.resolveCall(callId, accountId, organizationId);
        resolved++;
      } catch {
        // Skip calls that fail (e.g., not found)
      }
    }
    return { resolved };
  }

  /**
   * Dismiss calls from the review queue without resolving them.
   */
  async dismissCalls(
    callIds: string[],
    organizationId: string
  ): Promise<{ dismissed: number }> {
    const result = await this.prisma.call.updateMany({
      where: {
        id: { in: callIds },
        organizationId,
      },
      data: { dismissedAt: new Date() },
    });

    return { dismissed: result.count };
  }

  /**
   * Creates a new account from call participant data and assigns the call.
   */
  async createAccountFromCall(
    callId: string,
    organizationId: string,
    accountData: { name: string; domain?: string }
  ): Promise<{ accountId: string }> {
    const call = await this.prisma.call.findFirst({
      where: { id: callId, organizationId },
      include: { participants: true },
    });

    if (!call) {
      throw new Error("Call not found");
    }

    // Determine domain from provided data or participant emails
    let domain = accountData.domain ?? null;
    if (!domain) {
      for (const p of call.participants) {
        if (p.email) {
          const d = extractEmailDomain(p.email);
          if (d) {
            domain = d;
            break;
          }
        }
      }
    }

    // Check for domain uniqueness within org if domain is provided
    if (domain) {
      const existing = await this.prisma.account.findFirst({
        where: { organizationId, domain },
      });
      if (existing) {
        throw new Error(`An account with domain "${domain}" already exists: ${existing.name}`);
      }
    }

    const account = await this.prisma.account.create({
      data: {
        organizationId,
        name: accountData.name,
        normalizedName: normalizeCompanyName(accountData.name),
        domain,
      },
    });

    // Now resolve the call to this new account
    await this.resolveCall(callId, account.id, organizationId);

    return { accountId: account.id };
  }

  /**
   * Merges a source account into a target account. Moves all calls,
   * contacts, domain aliases, and stories. Deletes the source account.
   */
  async mergeAccounts(
    sourceAccountId: string,
    targetAccountId: string,
    organizationId: string
  ): Promise<void> {
    // Verify both accounts belong to org
    const [source, target] = await Promise.all([
      this.prisma.account.findFirst({
        where: { id: sourceAccountId, organizationId },
      }),
      this.prisma.account.findFirst({
        where: { id: targetAccountId, organizationId },
      }),
    ]);

    if (!source) throw new Error("Source account not found");
    if (!target) throw new Error("Target account not found");
    if (sourceAccountId === targetAccountId) {
      throw new Error("Cannot merge an account into itself");
    }

    // Move calls
    await this.prisma.call.updateMany({
      where: { accountId: sourceAccountId },
      data: { accountId: targetAccountId },
    });

    // Move contacts (skip duplicates by email)
    const sourceContacts = await this.prisma.contact.findMany({
      where: { accountId: sourceAccountId },
    });

    for (const contact of sourceContacts) {
      const existing = await this.prisma.contact.findFirst({
        where: {
          accountId: targetAccountId,
          email: contact.email,
        },
      });

      if (existing) {
        // Update participant links to point to existing contact
        await this.prisma.callParticipant.updateMany({
          where: { contactId: contact.id },
          data: { contactId: existing.id },
        });
        await this.prisma.contact.delete({ where: { id: contact.id } });
      } else {
        await this.prisma.contact.update({
          where: { id: contact.id },
          data: { accountId: targetAccountId },
        });
      }
    }

    // Move domain aliases (add source's domain and aliases to target)
    if (source.domain && source.domain !== target.domain) {
      const aliasExists = await this.prisma.accountDomain.findFirst({
        where: { accountId: targetAccountId, domain: source.domain },
      });
      if (!aliasExists) {
        await this.prisma.accountDomain.create({
          data: { accountId: targetAccountId, domain: source.domain },
        });
      }
    }

    const sourceAliases = await this.prisma.accountDomain.findMany({
      where: { accountId: sourceAccountId },
    });

    for (const alias of sourceAliases) {
      const exists = await this.prisma.accountDomain.findFirst({
        where: { accountId: targetAccountId, domain: alias.domain },
      });
      if (!exists && alias.domain !== target.domain) {
        await this.prisma.accountDomain.create({
          data: { accountId: targetAccountId, domain: alias.domain },
        });
      }
    }

    // Delete source domain aliases (will be cascade-deleted, but be explicit)
    await this.prisma.accountDomain.deleteMany({
      where: { accountId: sourceAccountId },
    });

    // Move stories
    await this.prisma.story.updateMany({
      where: { accountId: sourceAccountId },
      data: { accountId: targetAccountId },
    });

    // Move Salesforce events
    await this.prisma.salesforceEvent.updateMany({
      where: { accountId: sourceAccountId },
      data: { accountId: targetAccountId },
    });

    // Move user account access grants
    await this.prisma.userAccountAccess.updateMany({
      where: { accountId: sourceAccountId },
      data: { accountId: targetAccountId },
    });

    // Delete the source account
    await this.prisma.account.delete({
      where: { id: sourceAccountId },
    });
  }

  /**
   * Searches accounts by name or domain for the "Assign to Account" dropdown.
   */
  async searchAccounts(
    organizationId: string,
    query: string,
    limit: number = 20
  ): Promise<Array<{ id: string; name: string; domain: string | null }>> {
    if (!query || query.length < 1) {
      return this.prisma.account.findMany({
        where: { organizationId },
        select: { id: true, name: true, domain: true },
        orderBy: { name: "asc" },
        take: limit,
      });
    }

    return this.prisma.account.findMany({
      where: {
        organizationId,
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { domain: { contains: query, mode: "insensitive" } },
          { normalizedName: { contains: query.toLowerCase(), mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, domain: true },
      orderBy: { name: "asc" },
      take: limit,
    });
  }

  /**
   * Returns summary stats for the entity resolution queue.
   */
  async getQueueStats(organizationId: string): Promise<{
    totalUnresolved: number;
    noMatch: number;
    lowConfidence: number;
    resolvedToday: number;
  }> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [noMatch, lowConfidence, resolvedToday] = await Promise.all([
      this.prisma.call.count({
        where: {
          organizationId,
          matchMethod: "NONE",
          dismissedAt: null,
        },
      }),
      this.prisma.call.count({
        where: {
          organizationId,
          matchMethod: { not: "NONE" },
          matchConfidence: { lt: 0.7 },
          dismissedAt: null,
        },
      }),
      this.prisma.call.count({
        where: {
          organizationId,
          matchMethod: "MANUAL",
          updatedAt: { gte: todayStart },
        },
      }),
    ]);

    return {
      totalUnresolved: noMatch + lowConfidence,
      noMatch,
      lowConfidence,
      resolvedToday,
    };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────

  private generateSuggestions(
    call: {
      title: string | null;
      participants: Array<{ email: string | null; name: string | null }>;
    },
    fuse: Fuse<{ id: string; name: string; normalizedName: string; domain: string | null }>,
    _accounts: Array<{ id: string; name: string; normalizedName: string; domain: string | null }>,
    domainToAccount: Map<string, { id: string; name: string; domain: string | null }>
  ): SuggestedMatch[] {
    const suggestions = new Map<string, SuggestedMatch>();

    // 1. Check participant email domains against known account domains
    for (const p of call.participants) {
      if (p.email) {
        const domain = extractEmailDomain(p.email);
        if (domain) {
          const match = domainToAccount.get(domain);
          if (match && !suggestions.has(match.id)) {
            suggestions.set(match.id, {
              accountId: match.id,
              accountName: match.name,
              domain: match.domain,
              confidence: 0.85,
              matchReason: `Email domain match: ${domain}`,
            });
          }
        }
      }
    }

    // 2. Fuzzy match on call title and participant names
    const candidateNames: string[] = [];
    if (call.title) candidateNames.push(normalizeCompanyName(call.title));
    for (const p of call.participants) {
      if (p.name) candidateNames.push(normalizeCompanyName(p.name));
    }

    for (const candidate of candidateNames) {
      if (candidate.length < 2) continue;
      const results = fuse.search(candidate, { limit: 5 });
      for (const result of results) {
        if (!suggestions.has(result.item.id)) {
          const confidence = Math.round((1 - (result.score ?? 1)) * 100) / 100;
          suggestions.set(result.item.id, {
            accountId: result.item.id,
            accountName: result.item.name,
            domain: result.item.domain,
            confidence: Math.min(confidence, 0.75),
            matchReason: `Fuzzy name match: "${candidate}"`,
          });
        }
      }
    }

    // Sort by confidence descending, return top 3
    return Array.from(suggestions.values())
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);
  }
}
