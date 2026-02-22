/**
 * Entity Resolution Service
 *
 * The "killer feature" of StoryEngine. Resolves call participants to CRM
 * Account records despite inconsistent naming across providers.
 *
 * Strategy (priority order):
 *   1. Email Domain Match — if john@bigtech.com is on a call and Salesforce
 *      has a contact at @bigtech.com, they belong together regardless of
 *      whether the call title says "Big Tech" or "Meeting with John."
 *   2. Fuzzy Name Match — falls back to Fuse.js fuzzy matching on the
 *      normalized account name (stripped of Inc/Corp/LLC suffixes).
 *   3. Manual Review Queue — if neither strategy yields a high-confidence
 *      match, the call is flagged for human review.
 */

import Fuse, { type FuseResult } from "fuse.js";
import type { PrismaClient } from "@prisma/client";
import logger from "../lib/logger.js";
import { metrics } from "../lib/metrics.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CallParticipantInput {
  email?: string;
  name?: string;
}

export interface ResolvedEntity {
  accountId: string;
  accountName: string;
  confidence: number; // 0.0–1.0
  matchMethod: "email_domain" | "fuzzy_name" | "none";
}

interface AccountRecord {
  id: string;
  name: string;
  normalizedName: string;
  domain: string | null;
}

interface _DomainRecord {
  domain: string;
  accountId: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extracts the domain from an email address, lowercased. */
export function extractEmailDomain(email: string): string | null {
  const parts = email.toLowerCase().trim().split("@");
  if (parts.length !== 2) return null;
  const domain = parts[1];
  // Ignore common free email providers — these don't identify a company
  if (FREE_EMAIL_DOMAINS.has(domain)) return null;
  return domain;
}

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "aol.com",
  "icloud.com",
  "mail.com",
  "protonmail.com",
  "proton.me",
  "live.com",
  "msn.com",
  "yandex.com",
  "zoho.com",
  "fastmail.com",
  "tutanota.com",
  "hey.com",
]);

/**
 * Normalizes a company name for fuzzy comparison:
 *  - Lowercased
 *  - Common suffixes stripped (Inc, Corp, LLC, Ltd, etc.)
 *  - Extra whitespace collapsed
 */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(
      /\b(inc\.?|incorporated|corp\.?|corporation|llc|ltd\.?|limited|co\.?|company|group|holdings|plc|gmbh|sa|ag)\b/gi,
      ""
    )
    .replace(/[.,\-()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Core Resolution Logic ──────────────────────────────────────────────────

export class EntityResolver {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Resolves a list of call participants to a CRM Account.
   * Returns the best match or a "none" result for the manual review queue.
   */
  async resolve(
    organizationId: string,
    participants: CallParticipantInput[],
    callTitle?: string
  ): Promise<ResolvedEntity> {
    // ── Step 1: Try Email Domain Match (highest confidence) ──────────
    const domains = this.extractParticipantDomains(participants);

    if (domains.length > 0) {
      const domainMatch = await this.matchByEmailDomain(
        organizationId,
        domains
      );
      if (domainMatch) {
        metrics.recordEntityResolution(domainMatch.matchMethod, domainMatch.confidence);
        logger.debug("Entity resolved via email domain", {
          accountId: domainMatch.accountId,
          confidence: domainMatch.confidence,
        });
        return domainMatch;
      }
    }

    // ── Step 2: Try Fuzzy Name Match on participant names + call title ─
    const candidateNames = this.buildCandidateNames(participants, callTitle);

    if (candidateNames.length > 0) {
      const fuzzyMatch = await this.matchByFuzzyName(
        organizationId,
        candidateNames
      );
      if (fuzzyMatch) {
        metrics.recordEntityResolution(fuzzyMatch.matchMethod, fuzzyMatch.confidence);
        logger.debug("Entity resolved via fuzzy name", {
          accountId: fuzzyMatch.accountId,
          confidence: fuzzyMatch.confidence,
        });
        return fuzzyMatch;
      }
    }

    // ── Step 3: No match — route to manual review ────────────────────
    metrics.recordEntityResolution("none", 0);
    logger.debug("Entity resolution failed, routing to manual review", {
      organizationId,
      participantCount: participants.length,
    });
    return {
      accountId: "",
      accountName: "",
      confidence: 0,
      matchMethod: "none",
    };
  }

  /**
   * Also creates or links Contact records for resolved participants.
   */
  async resolveAndLinkContacts(
    organizationId: string,
    callId: string,
    participants: CallParticipantInput[]
  ): Promise<ResolvedEntity> {
    const resolution = await this.resolve(organizationId, participants);

    if (resolution.matchMethod === "none") return resolution;

    // Upsert contacts for participants that have emails
    for (const p of participants) {
      if (!p.email) continue;
      const domain = extractEmailDomain(p.email);
      if (!domain) continue;

      await this.prisma.contact.upsert({
        where: {
          accountId_email: {
            accountId: resolution.accountId,
            email: p.email.toLowerCase(),
          },
        },
        create: {
          accountId: resolution.accountId,
          email: p.email.toLowerCase(),
          emailDomain: domain,
          name: p.name ?? null,
        },
        update: {
          name: p.name ?? undefined,
        },
      });
    }

    // Link the call to the resolved account
    await this.prisma.call.update({
      where: { id: callId },
      data: { accountId: resolution.accountId },
    });

    return resolution;
  }

  // ─── Private Methods ────────────────────────────────────────────────

  private extractParticipantDomains(
    participants: CallParticipantInput[]
  ): string[] {
    const domains = new Set<string>();
    for (const p of participants) {
      if (p.email) {
        const d = extractEmailDomain(p.email);
        if (d) domains.add(d);
      }
    }
    return Array.from(domains);
  }

  private async matchByEmailDomain(
    organizationId: string,
    domains: string[]
  ): Promise<ResolvedEntity | null> {
    // Check primary domain on Account
    const primaryMatch = await this.prisma.account.findFirst({
      where: {
        organizationId,
        domain: { in: domains },
      },
    });

    if (primaryMatch) {
      return {
        accountId: primaryMatch.id,
        accountName: primaryMatch.name,
        confidence: 0.95,
        matchMethod: "email_domain",
      };
    }

    // Check AccountDomain aliases
    const aliasMatch = await this.prisma.accountDomain.findFirst({
      where: { domain: { in: domains }, account: { organizationId } },
      include: { account: true },
    });

    if (aliasMatch) {
      return {
        accountId: aliasMatch.account.id,
        accountName: aliasMatch.account.name,
        confidence: 0.9,
        matchMethod: "email_domain",
      };
    }

    // Check Contact email domains
    const contactMatch = await this.prisma.contact.findFirst({
      where: {
        emailDomain: { in: domains },
        account: { organizationId },
      },
      include: { account: true },
    });

    if (contactMatch) {
      return {
        accountId: contactMatch.account.id,
        accountName: contactMatch.account.name,
        confidence: 0.85,
        matchMethod: "email_domain",
      };
    }

    return null;
  }

  private buildCandidateNames(
    participants: CallParticipantInput[],
    callTitle?: string
  ): string[] {
    const names: string[] = [];
    // Call title often contains the account name
    if (callTitle) {
      names.push(normalizeCompanyName(callTitle));
    }
    // Participant names might contain company info
    for (const p of participants) {
      if (p.name) names.push(normalizeCompanyName(p.name));
    }
    return names.filter((n) => n.length > 1);
  }

  private async matchByFuzzyName(
    organizationId: string,
    candidateNames: string[]
  ): Promise<ResolvedEntity | null> {
    const accounts = await this.prisma.account.findMany({
      where: { organizationId },
      select: { id: true, name: true, normalizedName: true, domain: true },
    });

    if (accounts.length === 0) return null;

    const fuse = new Fuse(accounts, {
      keys: ["normalizedName"],
      threshold: 0.3, // lower = stricter; 0.3 is a good balance
      includeScore: true,
    });

    let bestMatch: FuseResult<AccountRecord> | null = null;

    for (const candidate of candidateNames) {
      const results = fuse.search(candidate);
      if (results.length > 0) {
        const top = results[0];
        if (!bestMatch || (top.score ?? 1) < (bestMatch.score ?? 1)) {
          bestMatch = top;
        }
      }
    }

    if (bestMatch && bestMatch.score !== undefined && bestMatch.score < 0.3) {
      // Convert Fuse score (0 = perfect) to confidence (1 = perfect)
      const confidence = Math.round((1 - bestMatch.score) * 100) / 100;
      return {
        accountId: bestMatch.item.id,
        accountName: bestMatch.item.name,
        confidence: Math.min(confidence, 0.75), // cap fuzzy match at 0.75
        matchMethod: "fuzzy_name",
      };
    }

    return null;
  }
}
