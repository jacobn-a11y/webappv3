/**
 * Company Name Scrubber
 *
 * Removes all traces of the client's company name AND contact identities
 * from landing page content before it's published publicly.
 *
 * Strategy:
 *   1. Load the Account record + all known aliases (name, normalizedName, domain, aliases)
 *   2. Load all Contacts with titles (pulled from Salesforce/HubSpot via Merge.dev)
 *   3. Replace "Name, Title" patterns (e.g., "Jeff Bezos, CEO") with anonymized versions
 *   4. Build a replacement map from org-level custom mappings + auto-generated variations
 *   5. Apply case-insensitive replacement with word boundaries across the entire body
 *   6. Scrub email domains
 *
 * Safety mechanisms:
 *   - Word boundary enforcement (\b) on all replacements to avoid substring matches
 *   - Minimum length thresholds: 4 chars for auto-generated terms, 2 for custom mappings
 *   - Short acronyms (<=4 chars) only match when ALL-CAPS in source text
 *   - Possessives/compounds handled: "Acme's platform", "Acme-powered"
 *   - Longest-first ordering prevents partial match clobbering
 */

import type { PrismaClient } from "@prisma/client";
import { normalizeCompanyName } from "./entity-resolution.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScrubResult {
  scrubbedText: string;
  replacementsMade: number;
  termsReplaced: string[];
}

export interface ScrubConfig {
  /** The placeholder to use for the company name. Defaults to "the client". */
  placeholder: string;
  /** Additional custom replacement mappings from org settings. */
  customMappings: Record<string, string>;
  /** If true, skip scrubbing (for named/admin pages). */
  skipScrub: boolean;
}

interface ContactInfo {
  name: string | null;
  title: string | null;
  email: string;
  emailDomain: string;
}

interface ReplacementTerm {
  regex: RegExp;
  replacement: string;
  label: string; // human-readable for the report
}

// ─── Default Placeholders ────────────────────────────────────────────────────

const DEFAULT_PLACEHOLDER = "the client";
const DOMAIN_PLACEHOLDER = "[client-domain]";

/** Minimum character length for auto-generated scrub terms. */
const MIN_AUTO_TERM_LENGTH = 4;

/** Acronyms this short or shorter only match ALL-CAPS (case-sensitive). */
const ACRONYM_CASE_SENSITIVE_THRESHOLD = 4;

/**
 * Maps CRM titles to anonymized descriptors.
 * We preserve the seniority level for context without revealing identity.
 */
const TITLE_ANONYMIZER: Array<{ pattern: RegExp; replacement: string }> = [
  // Multi-word VP/President titles must come before the bare "President" rule
  // to avoid \bPresident\b matching "Senior Vice President" prematurely.
  { pattern: /\b(SVP|Senior Vice President|EVP|Executive Vice President)\b/i, replacement: "a senior leader at the client" },
  { pattern: /\b(VP|Vice President)\b/i, replacement: "a VP at the client" },
  { pattern: /\b(CEO|Chief Executive Officer|Founder|Co-Founder|President)\b/i, replacement: "a senior executive at the client" },
  { pattern: /\b(CFO|Chief Financial Officer)\b/i, replacement: "a finance leader at the client" },
  { pattern: /\b(CTO|Chief Technology Officer|CIO|Chief Information Officer)\b/i, replacement: "a technology leader at the client" },
  { pattern: /\b(CMO|Chief Marketing Officer)\b/i, replacement: "a marketing leader at the client" },
  { pattern: /\b(COO|Chief Operating Officer)\b/i, replacement: "an operations leader at the client" },
  { pattern: /\b(CRO|Chief Revenue Officer)\b/i, replacement: "a revenue leader at the client" },
  { pattern: /\b(CISO|Chief Information Security Officer)\b/i, replacement: "a security leader at the client" },
  { pattern: /\b(Director)\b/i, replacement: "a director at the client" },
  { pattern: /\b(Head of)\b/i, replacement: "a department head at the client" },
  { pattern: /\b(Manager|Senior Manager)\b/i, replacement: "a manager at the client" },
  { pattern: /\b(Engineer|Developer|Architect)\b/i, replacement: "a technical team member at the client" },
];

function anonymizeTitle(title: string): string {
  for (const { pattern, replacement } of TITLE_ANONYMIZER) {
    if (pattern.test(title)) return replacement;
  }
  return "a team member at the client";
}

// ─── Core Scrubber ───────────────────────────────────────────────────────────

export class CompanyScrubber {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Scrubs all company-identifying information from the given text.
   * Loads the account, its aliases, contacts (with CRM titles), and
   * org-level custom mappings to build a comprehensive replacement list.
   */
  async scrubForAccount(
    accountId: string,
    text: string,
    configOverrides?: Partial<ScrubConfig>
  ): Promise<ScrubResult> {
    if (configOverrides?.skipScrub) {
      return { scrubbedText: text, replacementsMade: 0, termsReplaced: [] };
    }

    // ── Load account and all identifiers ──────────────────────────────
    const account = await this.prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      include: {
        domainAliases: true,
        contacts: {
          select: { name: true, title: true, email: true, emailDomain: true },
        },
        organization: {
          include: { orgSettings: true },
        },
      },
    });

    const orgSettings = account.organization.orgSettings;
    const customMappings =
      (configOverrides?.customMappings ??
        (orgSettings?.companyNameReplacements as Record<string, string> | null)) ??
      {};
    const placeholder = configOverrides?.placeholder ?? DEFAULT_PLACEHOLDER;

    let scrubbed = text;
    let count = 0;
    const replaced: string[] = [];

    // ── Step 1: Scrub "Name, Title" patterns from contacts ──────────
    // This MUST run before company name scrubbing, because contact names
    // might contain the company name and we want the full pattern matched.
    const contactScrubResult = this.scrubContactIdentities(
      scrubbed,
      account.contacts,
      placeholder
    );
    scrubbed = contactScrubResult.scrubbedText;
    count += contactScrubResult.replacementsMade;
    replaced.push(...contactScrubResult.termsReplaced);

    // ── Step 2: Scrub email domains ────────────────────────────────
    // This MUST run before company name scrubbing, because the company
    // name (e.g., "acme") can match inside domains (e.g., "acme.com")
    // and clobber them before the domain regex gets a chance to act.
    const domains = this.collectDomains(account);
    for (const domain of domains) {
      // Domains are always case-insensitive, bounded by non-word chars naturally
      const domainRegex = new RegExp(escapeRegex(domain), "gi");
      const domainMatches = scrubbed.match(domainRegex);
      if (domainMatches) {
        count += domainMatches.length;
        replaced.push(domain);
        scrubbed = scrubbed.replace(domainRegex, DOMAIN_PLACEHOLDER);
      }
    }

    // ── Step 3: Scrub company name and variations ────────────────────
    const terms = this.buildReplacementTerms(account, customMappings, placeholder);

    for (const term of terms) {
      term.regex.lastIndex = 0;
      const matches = scrubbed.match(term.regex);
      if (matches) {
        count += matches.length;
        replaced.push(term.label);
        scrubbed = scrubbed.replace(term.regex, term.replacement);
      }
    }

    // ── Step 4: Scrub remaining bare contact names ──────────────────
    // (in case a name appears without its title)
    for (const contact of account.contacts) {
      if (!contact.name || contact.name.length < 4) continue;
      const nameRegex = new RegExp(
        `\\b${escapeRegex(contact.name)}\\b`,
        "gi"
      );
      const nameMatches = scrubbed.match(nameRegex);
      if (nameMatches) {
        const anonLabel = contact.title
          ? anonymizeTitle(contact.title)
          : "a team member at " + placeholder;
        count += nameMatches.length;
        replaced.push(contact.name);
        scrubbed = scrubbed.replace(nameRegex, anonLabel);
      }
    }

    return {
      scrubbedText: scrubbed,
      replacementsMade: count,
      termsReplaced: [...new Set(replaced)],
    };
  }

  /**
   * Formats a contact attribution for use in stories/landing pages.
   *
   * Named mode (with company):   "Jeff Bezos, CEO, Amazon"
   * Named mode (no company):     "Jeff Bezos, CEO"
   * Scrubbed mode:                "a senior executive at the client"
   *
   * The taxonomy format for named pages is: NAME TITLE, COMPANY
   * e.g., "Jeff Bezos, CEO, Amazon" or for in-text: "CEO, Amazon"
   */
  static formatAttribution(
    name: string | null,
    title: string | null,
    includeCompanyName: boolean,
    companyName?: string | null
  ): string {
    if (includeCompanyName && name) {
      const parts = [name];
      if (title) parts.push(title);
      if (companyName) parts.push(companyName);
      return parts.join(", ");
    }
    // Anonymized
    if (title) return anonymizeTitle(title);
    return "a team member at the client";
  }

  /**
   * Formats a short attribution for inline quotes (no full name).
   *
   * Named mode:    "CEO, Amazon"
   * Scrubbed mode: "a senior executive at the client"
   */
  static formatInlineAttribution(
    title: string | null,
    includeCompanyName: boolean,
    companyName?: string | null
  ): string {
    if (includeCompanyName && title) {
      return companyName ? `${title}, ${companyName}` : title;
    }
    if (title) return anonymizeTitle(title);
    return "a team member at the client";
  }

  /**
   * Quick scrub for preview — doesn't load from DB, uses provided terms.
   */
  scrubWithTerms(
    text: string,
    companyNames: string[],
    placeholder = DEFAULT_PLACEHOLDER
  ): ScrubResult {
    const sorted = [...companyNames].sort((a, b) => b.length - a.length);

    let scrubbed = text;
    let count = 0;
    const replaced: string[] = [];

    for (const name of sorted) {
      if (name.length < 2) continue;
      const regex = buildWordBoundaryRegex(name);
      const matches = scrubbed.match(regex);
      if (matches) {
        count += matches.length;
        replaced.push(name);
        scrubbed = scrubbed.replace(regex, placeholder);
      }
    }

    return {
      scrubbedText: scrubbed,
      replacementsMade: count,
      termsReplaced: [...new Set(replaced)],
    };
  }

  // ─── Private ──────────────────────────────────────────────────────

  /**
   * Scrubs "Name, Title" attribution patterns from text.
   * Handles formats like:
   *   - "Jeff Bezos, CEO"          -> "a senior executive at the client"
   *   - "-- Jeff Bezos, CEO"       -> "-- a senior executive at the client"
   *   - "Jeff Bezos, CEO of Acme"  -> "a senior executive at the client"
   *   - "said Jeff Bezos (CEO)"    -> "said a senior executive at the client"
   */
  private scrubContactIdentities(
    text: string,
    contacts: ContactInfo[],
    _placeholder: string
  ): ScrubResult {
    let scrubbed = text;
    let count = 0;
    const replaced: string[] = [];

    for (const contact of contacts) {
      if (!contact.name) continue;
      const name = escapeRegex(contact.name);

      if (contact.title) {
        const title = escapeRegex(contact.title);
        const anonLabel = anonymizeTitle(contact.title);

        // Pattern: "Name, Title" or "Name, Title of Company"
        const commaPattern = new RegExp(
          `\\b${name},?\\s+${title}(?:\\s+(?:of|at)\\s+\\S+)?\\b`,
          "gi"
        );
        const commaMatches = scrubbed.match(commaPattern);
        if (commaMatches) {
          count += commaMatches.length;
          replaced.push(`${contact.name}, ${contact.title}`);
          scrubbed = scrubbed.replace(commaPattern, anonLabel);
        }

        // Pattern: "Name (Title)"
        const parenPattern = new RegExp(
          `\\b${name}\\s*\\(${title}\\)`,
          "gi"
        );
        const parenMatches = scrubbed.match(parenPattern);
        if (parenMatches) {
          count += parenMatches.length;
          replaced.push(`${contact.name} (${contact.title})`);
          scrubbed = scrubbed.replace(parenPattern, anonLabel);
        }
      }
    }

    return { scrubbedText: scrubbed, replacementsMade: count, termsReplaced: replaced };
  }

  private buildReplacementTerms(
    account: {
      name: string;
      normalizedName: string;
      domain: string | null;
      domainAliases: Array<{ domain: string }>;
    },
    customMappings: Record<string, string>,
    placeholder: string
  ): ReplacementTerm[] {
    const terms: ReplacementTerm[] = [];

    // Custom mappings first (highest priority) — no minimum length, user knows best
    for (const [pattern, replacement] of Object.entries(customMappings)) {
      if (pattern.length < 2) continue;
      terms.push({
        regex: buildWordBoundaryRegex(pattern),
        replacement,
        label: pattern,
      });
    }

    // Full company name and variations
    const nameVariations = this.generateNameVariations(account.name);
    for (const variation of nameVariations) {
      terms.push({
        regex: buildWordBoundaryRegex(variation),
        replacement: placeholder,
        label: variation,
      });
    }

    // Normalized name if different
    if (
      account.normalizedName !== account.name.toLowerCase() &&
      account.normalizedName.length >= MIN_AUTO_TERM_LENGTH
    ) {
      terms.push({
        regex: buildWordBoundaryRegex(account.normalizedName),
        replacement: placeholder,
        label: account.normalizedName,
      });
    }

    // Sort longest-first to avoid partial-match clobbering
    terms.sort((a, b) => b.label.length - a.label.length);

    return terms;
  }

  private generateNameVariations(name: string): string[] {
    const variations = new Set<string>();

    // Original full name — always safe to scrub
    variations.add(name);

    // Without common suffixes (e.g., "Amazon Web Services" -> "amazon web services")
    const normalized = normalizeCompanyName(name);
    if (normalized.length >= MIN_AUTO_TERM_LENGTH) {
      variations.add(normalized);
    }

    // Title case variation
    const titleCase = normalized
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    if (titleCase.length >= MIN_AUTO_TERM_LENGTH) {
      variations.add(titleCase);
    }

    const words = name.split(/\s+/);
    if (words.length >= 2) {
      // First two words (without suffix) — only if long enough
      const shortName = words.slice(0, 2).join(" ");
      if (shortName.length >= MIN_AUTO_TERM_LENGTH) {
        variations.add(shortName);
      }
    }

    // Acronyms handled separately via buildWordBoundaryRegex (case-sensitive)
    // Only generate if 3+ chars to avoid "AB" matching everywhere
    if (words.length >= 3) {
      const acronym = words
        .map((w) => w.charAt(0))
        .join("")
        .toUpperCase();
      if (acronym.length >= 3) {
        variations.add(acronym);
      }
    }

    return Array.from(variations).filter((v) => v.length >= 2);
  }

  private collectDomains(account: {
    domain: string | null;
    domainAliases: Array<{ domain: string }>;
  }): string[] {
    const domains: string[] = [];
    if (account.domain) domains.push(account.domain);
    for (const alias of account.domainAliases) {
      domains.push(alias.domain);
    }
    return domains;
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds a word-boundary-aware regex for a scrub term.
 *
 * Key safety behaviors:
 *  - Short ALL-CAPS terms (<=4 chars, e.g., "AWS", "SAP", "BOX") are matched
 *    case-sensitively to avoid scrubbing common words.
 *  - Longer terms are matched case-insensitively.
 *  - All terms use \b word boundaries to avoid substring matches.
 *  - Also matches possessive forms ("Acme's") and hyphenated compounds ("Acme-powered").
 *    The trailing 's or -word is consumed so the output reads naturally.
 */
function buildWordBoundaryRegex(term: string): RegExp {
  const escaped = escapeRegex(term);
  const isShortAcronym =
    term.length <= ACRONYM_CASE_SENSITIVE_THRESHOLD && term === term.toUpperCase();

  // Match the term + optional possessive ('s) or hyphenated suffix (-word)
  const pattern = `\\b${escaped}(?:'s|\\-\\w+)?\\b`;

  return new RegExp(pattern, isShortAcronym ? "g" : "gi");
}
