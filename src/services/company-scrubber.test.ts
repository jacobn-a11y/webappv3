import { describe, it, expect, vi, beforeEach } from "vitest";
import { CompanyScrubber, type ScrubConfig } from "./company-scrubber.js";

// ─── Mock Prisma Factory ─────────────────────────────────────────────────────

interface MockAccountData {
  id?: string;
  name: string;
  normalizedName: string;
  domain: string | null;
  domainAliases?: Array<{ domain: string }>;
  contacts?: Array<{
    name: string | null;
    title: string | null;
    email: string;
    emailDomain: string;
  }>;
  orgSettings?: { companyNameReplacements: Record<string, string> } | null;
}

function createMockPrisma(accountData: MockAccountData) {
  return {
    account: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: accountData.id ?? "acct_1",
        name: accountData.name,
        normalizedName: accountData.normalizedName,
        domain: accountData.domain,
        domainAliases: accountData.domainAliases ?? [],
        contacts: accountData.contacts ?? [],
        organization: {
          orgSettings: accountData.orgSettings ?? null,
        },
      }),
    },
  } as any;
}

// ─── Default Account Fixture ─────────────────────────────────────────────────

const DEFAULT_ACCOUNT: MockAccountData = {
  name: "Acme Corporation",
  normalizedName: "acme",
  domain: "acme.com",
  domainAliases: [{ domain: "acme.io" }],
  contacts: [],
  orgSettings: null,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("CompanyScrubber", () => {
  // ── Company Name Removal ─────────────────────────────────────────────

  describe("company name removal", () => {
    it("removes the exact company name", async () => {
      const prisma = createMockPrisma(DEFAULT_ACCOUNT);
      const scrubber = new CompanyScrubber(prisma);

      const result = await scrubber.scrubForAccount(
        "acct_1",
        "We partnered with Acme Corporation to deliver results."
      );

      expect(result.scrubbedText).toBe(
        "We partnered with the client to deliver results."
      );
      expect(result.replacementsMade).toBeGreaterThan(0);
    });

    it("removes case-insensitive variations", async () => {
      const prisma = createMockPrisma(DEFAULT_ACCOUNT);
      const scrubber = new CompanyScrubber(prisma);

      const result = await scrubber.scrubForAccount(
        "acct_1",
        "acme corporation helped us. ACME CORPORATION is great."
      );

      expect(result.scrubbedText).not.toContain("acme");
      expect(result.scrubbedText).not.toContain("ACME");
    });

    it("removes the normalized name variation", async () => {
      const prisma = createMockPrisma({
        ...DEFAULT_ACCOUNT,
        name: "TechCorp Inc.",
        normalizedName: "techcorp",
        domain: "techcorp.com",
      });
      const scrubber = new CompanyScrubber(prisma);

      const result = await scrubber.scrubForAccount(
        "acct_1",
        "Working with TechCorp has been great."
      );

      expect(result.scrubbedText).not.toContain("TechCorp");
    });

    it("removes acronyms for multi-word company names (case-sensitive for short acronyms)", async () => {
      const prisma = createMockPrisma({
        ...DEFAULT_ACCOUNT,
        name: "Amazon Web Services",
        normalizedName: "amazon web services",
        domain: "aws.amazon.com",
      });
      const scrubber = new CompanyScrubber(prisma);

      // ALL-CAPS acronym should be scrubbed
      const result = await scrubber.scrubForAccount(
        "acct_1",
        "AWS provides cloud infrastructure. Amazon Web Services is the leader."
      );

      expect(result.scrubbedText).not.toContain("AWS");
      expect(result.scrubbedText).not.toContain("Amazon Web Services");
    });

    it("does NOT scrub lowercase matches of short acronyms", async () => {
      const prisma = createMockPrisma({
        ...DEFAULT_ACCOUNT,
        name: "Amazon Web Services",
        normalizedName: "amazon web services",
        domain: "aws.amazon.com",
      });
      const scrubber = new CompanyScrubber(prisma);

      // "aws" in lowercase should NOT be matched (short acronym is case-sensitive)
      const result = await scrubber.scrubForAccount(
        "acct_1",
        "The word aws in lowercase should be safe."
      );

      expect(result.scrubbedText).toContain("aws");
    });

    it("handles possessive forms like Acme's", async () => {
      const prisma = createMockPrisma(DEFAULT_ACCOUNT);
      const scrubber = new CompanyScrubber(prisma);

      const result = await scrubber.scrubForAccount(
        "acct_1",
        "Acme's platform is industry-leading."
      );

      expect(result.scrubbedText).not.toContain("Acme");
    });

    it("handles hyphenated compound forms like Acme-powered", async () => {
      const prisma = createMockPrisma(DEFAULT_ACCOUNT);
      const scrubber = new CompanyScrubber(prisma);

      const result = await scrubber.scrubForAccount(
        "acct_1",
        "Their Acme-powered solution scales well."
      );

      expect(result.scrubbedText).not.toContain("Acme");
    });

    it("does not match substrings (word boundary enforcement)", async () => {
      const prisma = createMockPrisma({
        ...DEFAULT_ACCOUNT,
        name: "Arc Systems",
        normalizedName: "arc systems",
        domain: "arcsystems.com",
      });
      const scrubber = new CompanyScrubber(prisma);

      const result = await scrubber.scrubForAccount(
        "acct_1",
        "The architecture review was great."
      );

      // "architecture" contains "arc" but should not be scrubbed
      expect(result.scrubbedText).toContain("architecture");
    });

    it("uses custom placeholder when provided", async () => {
      const prisma = createMockPrisma(DEFAULT_ACCOUNT);
      const scrubber = new CompanyScrubber(prisma);

      const result = await scrubber.scrubForAccount("acct_1", "Acme Corporation rocks.", {
        placeholder: "[REDACTED]",
      });

      expect(result.scrubbedText).toBe("[REDACTED] rocks.");
    });

    it("applies org-level custom mappings from orgSettings", async () => {
      const prisma = createMockPrisma({
        ...DEFAULT_ACCOUNT,
        orgSettings: {
          companyNameReplacements: {
            "Project Phoenix": "an internal initiative",
          },
        },
      });
      const scrubber = new CompanyScrubber(prisma);

      const result = await scrubber.scrubForAccount(
        "acct_1",
        "Project Phoenix is a huge success at Acme Corporation."
      );

      expect(result.scrubbedText).toContain("an internal initiative");
      expect(result.scrubbedText).not.toContain("Project Phoenix");
      expect(result.scrubbedText).not.toContain("Acme Corporation");
    });

    it("reports all replaced terms in the result", async () => {
      const prisma = createMockPrisma(DEFAULT_ACCOUNT);
      const scrubber = new CompanyScrubber(prisma);

      const result = await scrubber.scrubForAccount(
        "acct_1",
        "Acme Corporation and Acme are the same company."
      );

      expect(result.termsReplaced.length).toBeGreaterThan(0);
      expect(result.replacementsMade).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Contact "Name, Title" Pattern Scrubbing ──────────────────────────

  describe("contact 'Name, Title' pattern scrubbing", () => {
    const accountWithContacts: MockAccountData = {
      ...DEFAULT_ACCOUNT,
      contacts: [
        {
          name: "Jeff Bezos",
          title: "CEO",
          email: "jeff@acme.com",
          emailDomain: "acme.com",
        },
      ],
    };

    it("scrubs 'Name, Title' pattern", async () => {
      const prisma = createMockPrisma(accountWithContacts);
      const scrubber = new CompanyScrubber(prisma);

      const result = await scrubber.scrubForAccount(
        "acct_1",
        'As Jeff Bezos, CEO mentioned in the call.'
      );

      expect(result.scrubbedText).not.toContain("Jeff Bezos");
      expect(result.scrubbedText).not.toContain("CEO");
      expect(result.scrubbedText).toContain("a senior executive at the client");
    });

    it("scrubs 'Name (Title)' pattern", async () => {
      const prisma = createMockPrisma(accountWithContacts);
      const scrubber = new CompanyScrubber(prisma);

      const result = await scrubber.scrubForAccount(
        "acct_1",
        "Jeff Bezos (CEO) said the rollout was smooth."
      );

      expect(result.scrubbedText).not.toContain("Jeff Bezos");
      expect(result.scrubbedText).toContain("a senior executive at the client");
    });

    it("scrubs 'Name, Title of Company' pattern", async () => {
      const prisma = createMockPrisma(accountWithContacts);
      const scrubber = new CompanyScrubber(prisma);

      const result = await scrubber.scrubForAccount(
        "acct_1",
        "Jeff Bezos, CEO of Acme said results were impressive."
      );

      expect(result.scrubbedText).not.toContain("Jeff Bezos");
      expect(result.scrubbedText).toContain("a senior executive at the client");
    });

    it("scrubs bare contact names that appear without titles", async () => {
      const prisma = createMockPrisma(accountWithContacts);
      const scrubber = new CompanyScrubber(prisma);

      const result = await scrubber.scrubForAccount(
        "acct_1",
        "Later, Jeff Bezos confirmed the deployment."
      );

      expect(result.scrubbedText).not.toContain("Jeff Bezos");
    });

    it("scrubs multiple contacts in the same text", async () => {
      const prisma = createMockPrisma({
        ...DEFAULT_ACCOUNT,
        contacts: [
          {
            name: "Jeff Bezos",
            title: "CEO",
            email: "jeff@acme.com",
            emailDomain: "acme.com",
          },
          {
            name: "Jane Smith",
            title: "VP of Engineering",
            email: "jane@acme.com",
            emailDomain: "acme.com",
          },
        ],
      });
      const scrubber = new CompanyScrubber(prisma);

      const result = await scrubber.scrubForAccount(
        "acct_1",
        "Jeff Bezos, CEO and Jane Smith, VP of Engineering both agreed."
      );

      expect(result.scrubbedText).not.toContain("Jeff Bezos");
      expect(result.scrubbedText).not.toContain("Jane Smith");
    });

    it("skips contacts with no name", async () => {
      const prisma = createMockPrisma({
        ...DEFAULT_ACCOUNT,
        contacts: [
          {
            name: null,
            title: "CEO",
            email: "ceo@acme.com",
            emailDomain: "acme.com",
          },
        ],
      });
      const scrubber = new CompanyScrubber(prisma);

      const result = await scrubber.scrubForAccount(
        "acct_1",
        "The CEO of the company spoke at the event."
      );

      // "CEO" should remain since there's no named contact to match
      expect(result.scrubbedText).toContain("CEO");
    });
  });

  // ── Title Anonymization ──────────────────────────────────────────────

  describe("title anonymization", () => {
    function testTitleAnonymization(
      title: string,
      expectedFragment: string
    ) {
      it(`anonymizes "${title}" to contain "${expectedFragment}"`, async () => {
        const prisma = createMockPrisma({
          ...DEFAULT_ACCOUNT,
          contacts: [
            {
              name: "John Doe",
              title,
              email: "john@acme.com",
              emailDomain: "acme.com",
            },
          ],
        });
        const scrubber = new CompanyScrubber(prisma);

        const result = await scrubber.scrubForAccount(
          "acct_1",
          `John Doe, ${title} confirmed it.`
        );

        expect(result.scrubbedText).toContain(expectedFragment);
        expect(result.scrubbedText).not.toContain("John Doe");
      });
    }

    testTitleAnonymization("CEO", "a senior executive at the client");
    testTitleAnonymization("Chief Executive Officer", "a senior executive at the client");
    testTitleAnonymization("Founder", "a senior executive at the client");
    testTitleAnonymization("Co-Founder", "a senior executive at the client");
    testTitleAnonymization("President", "a senior executive at the client");

    testTitleAnonymization("CFO", "a finance leader at the client");
    testTitleAnonymization("Chief Financial Officer", "a finance leader at the client");

    testTitleAnonymization("CTO", "a technology leader at the client");
    testTitleAnonymization("Chief Technology Officer", "a technology leader at the client");
    testTitleAnonymization("CIO", "a technology leader at the client");

    testTitleAnonymization("CMO", "a marketing leader at the client");

    testTitleAnonymization("COO", "an operations leader at the client");

    testTitleAnonymization("CRO", "a revenue leader at the client");

    testTitleAnonymization("CISO", "a security leader at the client");

    testTitleAnonymization("SVP", "a senior leader at the client");
    testTitleAnonymization("Senior Vice President", "a senior leader at the client");
    testTitleAnonymization("EVP", "a senior leader at the client");

    testTitleAnonymization("VP", "a VP at the client");
    testTitleAnonymization("Vice President", "a VP at the client");

    testTitleAnonymization("Director", "a director at the client");

    testTitleAnonymization("Head of Product", "a department head at the client");

    testTitleAnonymization("Manager", "a manager at the client");
    testTitleAnonymization("Senior Manager", "a manager at the client");

    testTitleAnonymization("Engineer", "a technical team member at the client");
    testTitleAnonymization("Developer", "a technical team member at the client");
    testTitleAnonymization("Architect", "a technical team member at the client");

    it("falls back to 'a team member at the client' for unknown titles", async () => {
      const prisma = createMockPrisma({
        ...DEFAULT_ACCOUNT,
        contacts: [
          {
            name: "John Doe",
            title: "Receptionist",
            email: "john@acme.com",
            emailDomain: "acme.com",
          },
        ],
      });
      const scrubber = new CompanyScrubber(prisma);

      const result = await scrubber.scrubForAccount(
        "acct_1",
        "John Doe, Receptionist handled the front desk."
      );

      expect(result.scrubbedText).toContain("a team member at the client");
    });

    it("falls back to 'a team member at <placeholder>' when contact has no title", async () => {
      const prisma = createMockPrisma({
        ...DEFAULT_ACCOUNT,
        contacts: [
          {
            name: "John Doe",
            title: null,
            email: "john@acme.com",
            emailDomain: "acme.com",
          },
        ],
      });
      const scrubber = new CompanyScrubber(prisma);

      const result = await scrubber.scrubForAccount(
        "acct_1",
        "John Doe confirmed the timeline."
      );

      expect(result.scrubbedText).not.toContain("John Doe");
      expect(result.scrubbedText).toContain("a team member at the client");
    });
  });

  // ── Email Domain Scrubbing ───────────────────────────────────────────

  describe("email domain scrubbing", () => {
    it("replaces the primary company domain with [client-domain]", async () => {
      const prisma = createMockPrisma(DEFAULT_ACCOUNT);
      const scrubber = new CompanyScrubber(prisma);

      const result = await scrubber.scrubForAccount(
        "acct_1",
        "Please reach out to support@acme.com for help."
      );

      expect(result.scrubbedText).not.toContain("acme.com");
      expect(result.scrubbedText).toContain("[client-domain]");
    });

    it("replaces domain alias domains with [client-domain]", async () => {
      const prisma = createMockPrisma(DEFAULT_ACCOUNT);
      const scrubber = new CompanyScrubber(prisma);

      const result = await scrubber.scrubForAccount(
        "acct_1",
        "Also check docs.acme.io for documentation."
      );

      expect(result.scrubbedText).not.toContain("acme.io");
      expect(result.scrubbedText).toContain("[client-domain]");
    });

    it("replaces all occurrences of domains", async () => {
      const prisma = createMockPrisma(DEFAULT_ACCOUNT);
      const scrubber = new CompanyScrubber(prisma);

      const result = await scrubber.scrubForAccount(
        "acct_1",
        "Visit acme.com or acme.io for more info. Email us at hello@acme.com."
      );

      expect(result.scrubbedText).not.toContain("acme.com");
      expect(result.scrubbedText).not.toContain("acme.io");
    });

    it("is case-insensitive for domain scrubbing", async () => {
      const prisma = createMockPrisma(DEFAULT_ACCOUNT);
      const scrubber = new CompanyScrubber(prisma);

      const result = await scrubber.scrubForAccount(
        "acct_1",
        "Send mail to info@ACME.COM for details."
      );

      expect(result.scrubbedText).not.toMatch(/acme\.com/i);
      expect(result.scrubbedText).toContain("[client-domain]");
    });
  });

  // ── formatAttribution ────────────────────────────────────────────────

  describe("formatAttribution", () => {
    describe("named mode (includeCompanyName = true)", () => {
      it("returns 'Name, Title, Company' when all fields present", () => {
        const result = CompanyScrubber.formatAttribution(
          "Jeff Bezos",
          "CEO",
          true,
          "Amazon"
        );
        expect(result).toBe("Jeff Bezos, CEO, Amazon");
      });

      it("returns 'Name, Title' when company is null", () => {
        const result = CompanyScrubber.formatAttribution(
          "Jeff Bezos",
          "CEO",
          true,
          null
        );
        expect(result).toBe("Jeff Bezos, CEO");
      });

      it("returns 'Name, Company' when title is null", () => {
        const result = CompanyScrubber.formatAttribution(
          "Jeff Bezos",
          null,
          true,
          "Amazon"
        );
        expect(result).toBe("Jeff Bezos, Amazon");
      });

      it("returns just 'Name' when title and company are null", () => {
        const result = CompanyScrubber.formatAttribution(
          "Jeff Bezos",
          null,
          true,
          null
        );
        expect(result).toBe("Jeff Bezos");
      });
    });

    describe("scrubbed mode (includeCompanyName = false)", () => {
      it("returns anonymized title when title is provided", () => {
        const result = CompanyScrubber.formatAttribution(
          "Jeff Bezos",
          "CEO",
          false,
          "Amazon"
        );
        expect(result).toBe("a senior executive at the client");
      });

      it("returns VP anonymization for VP title", () => {
        const result = CompanyScrubber.formatAttribution(
          "Jane Smith",
          "VP of Sales",
          false
        );
        expect(result).toBe("a VP at the client");
      });

      it("returns 'a team member at the client' when no title", () => {
        const result = CompanyScrubber.formatAttribution(
          "Jeff Bezos",
          null,
          false
        );
        expect(result).toBe("a team member at the client");
      });

      it("returns 'a team member at the client' when name is null and no title", () => {
        const result = CompanyScrubber.formatAttribution(
          null,
          null,
          false
        );
        expect(result).toBe("a team member at the client");
      });

      it("falls back to scrubbed mode when name is null even if includeCompanyName is true", () => {
        const result = CompanyScrubber.formatAttribution(
          null,
          "CTO",
          true,
          "Amazon"
        );
        expect(result).toBe("a technology leader at the client");
      });
    });
  });

  // ── formatInlineAttribution ──────────────────────────────────────────

  describe("formatInlineAttribution", () => {
    it("returns 'Title, Company' in named mode", () => {
      const result = CompanyScrubber.formatInlineAttribution(
        "CEO",
        true,
        "Amazon"
      );
      expect(result).toBe("CEO, Amazon");
    });

    it("returns just title in named mode when no company", () => {
      const result = CompanyScrubber.formatInlineAttribution(
        "CEO",
        true,
        null
      );
      expect(result).toBe("CEO");
    });

    it("returns anonymized title in scrubbed mode", () => {
      const result = CompanyScrubber.formatInlineAttribution(
        "CEO",
        false,
        "Amazon"
      );
      expect(result).toBe("a senior executive at the client");
    });

    it("returns 'a team member at the client' when no title in scrubbed mode", () => {
      const result = CompanyScrubber.formatInlineAttribution(
        null,
        false
      );
      expect(result).toBe("a team member at the client");
    });

    it("returns 'a team member at the client' when no title in named mode", () => {
      const result = CompanyScrubber.formatInlineAttribution(
        null,
        true,
        "Amazon"
      );
      expect(result).toBe("a team member at the client");
    });
  });

  // ── skipScrub Config ─────────────────────────────────────────────────

  describe("skipScrub config", () => {
    it("passes text through unchanged when skipScrub is true", async () => {
      const prisma = createMockPrisma(DEFAULT_ACCOUNT);
      const scrubber = new CompanyScrubber(prisma);

      const originalText =
        "Acme Corporation's CEO Jeff Bezos said it at jeff@acme.com.";

      const result = await scrubber.scrubForAccount("acct_1", originalText, {
        skipScrub: true,
      });

      expect(result.scrubbedText).toBe(originalText);
      expect(result.replacementsMade).toBe(0);
      expect(result.termsReplaced).toEqual([]);
    });

    it("does not call prisma when skipScrub is true", async () => {
      const prisma = createMockPrisma(DEFAULT_ACCOUNT);
      const scrubber = new CompanyScrubber(prisma);

      await scrubber.scrubForAccount("acct_1", "Acme Corporation text.", {
        skipScrub: true,
      });

      expect(prisma.account.findUniqueOrThrow).not.toHaveBeenCalled();
    });
  });

  // ── CRM Contacts with Salesforce Titles ──────────────────────────────

  describe("CRM contacts with Salesforce titles", () => {
    const salesforceContacts: MockAccountData = {
      ...DEFAULT_ACCOUNT,
      name: "Globex Corporation",
      normalizedName: "globex",
      domain: "globex.com",
      domainAliases: [],
      contacts: [
        {
          name: "Hank Scorpio",
          title: "Chief Executive Officer",
          email: "hank.scorpio@globex.com",
          emailDomain: "globex.com",
        },
        {
          name: "Sarah Connor",
          title: "Senior Vice President of Engineering",
          email: "sarah.connor@globex.com",
          emailDomain: "globex.com",
        },
        {
          name: "Marcus Webb",
          title: "Director of Product Management",
          email: "marcus.webb@globex.com",
          emailDomain: "globex.com",
        },
        {
          name: "Li Zhang",
          title: "Head of Data Science",
          email: "li.zhang@globex.com",
          emailDomain: "globex.com",
        },
        {
          name: "Priya Patel",
          title: "Senior Software Engineer",
          email: "priya.patel@globex.com",
          emailDomain: "globex.com",
        },
      ],
    };

    it("scrubs C-suite contacts from Salesforce with full title", async () => {
      const prisma = createMockPrisma(salesforceContacts);
      const scrubber = new CompanyScrubber(prisma);

      const result = await scrubber.scrubForAccount(
        "acct_1",
        "Hank Scorpio, Chief Executive Officer praised the integration."
      );

      expect(result.scrubbedText).not.toContain("Hank Scorpio");
      expect(result.scrubbedText).not.toContain("Chief Executive Officer");
      expect(result.scrubbedText).toContain("a senior executive at the client");
    });

    it("scrubs SVP-level contacts from Salesforce", async () => {
      const prisma = createMockPrisma(salesforceContacts);
      const scrubber = new CompanyScrubber(prisma);

      const result = await scrubber.scrubForAccount(
        "acct_1",
        "Sarah Connor, Senior Vice President of Engineering led the effort."
      );

      expect(result.scrubbedText).not.toContain("Sarah Connor");
      expect(result.scrubbedText).toContain("a senior leader at the client");
    });

    it("scrubs Director-level contacts from Salesforce", async () => {
      const prisma = createMockPrisma(salesforceContacts);
      const scrubber = new CompanyScrubber(prisma);

      const result = await scrubber.scrubForAccount(
        "acct_1",
        "Marcus Webb, Director of Product Management oversaw the launch."
      );

      expect(result.scrubbedText).not.toContain("Marcus Webb");
      expect(result.scrubbedText).toContain("a director at the client");
    });

    it("scrubs 'Head of' contacts from Salesforce", async () => {
      const prisma = createMockPrisma(salesforceContacts);
      const scrubber = new CompanyScrubber(prisma);

      const result = await scrubber.scrubForAccount(
        "acct_1",
        "Li Zhang, Head of Data Science built the ML pipeline."
      );

      expect(result.scrubbedText).not.toContain("Li Zhang");
      expect(result.scrubbedText).toContain("a department head at the client");
    });

    it("scrubs Engineer-level contacts from Salesforce", async () => {
      const prisma = createMockPrisma(salesforceContacts);
      const scrubber = new CompanyScrubber(prisma);

      const result = await scrubber.scrubForAccount(
        "acct_1",
        "Priya Patel, Senior Software Engineer implemented the feature."
      );

      expect(result.scrubbedText).not.toContain("Priya Patel");
    });

    it("scrubs a realistic paragraph with multiple Salesforce contacts and company references", async () => {
      const prisma = createMockPrisma(salesforceContacts);
      const scrubber = new CompanyScrubber(prisma);

      const paragraph = [
        "Globex Corporation adopted our platform in Q3.",
        "Hank Scorpio, Chief Executive Officer personally championed the initiative.",
        "Sarah Connor led the technical evaluation.",
        "The team at globex.com reported 40% efficiency gains.",
        "Marcus Webb, Director of Product Management confirmed the ROI.",
      ].join(" ");

      const result = await scrubber.scrubForAccount("acct_1", paragraph);

      expect(result.scrubbedText).not.toContain("Globex");
      expect(result.scrubbedText).not.toContain("Hank Scorpio");
      expect(result.scrubbedText).not.toContain("Sarah Connor");
      expect(result.scrubbedText).not.toContain("Marcus Webb");
      expect(result.scrubbedText).not.toContain("globex.com");
      expect(result.replacementsMade).toBeGreaterThanOrEqual(5);
    });
  });

  // ── scrubWithTerms (quick preview mode) ──────────────────────────────

  describe("scrubWithTerms", () => {
    it("replaces provided company name terms", () => {
      const prisma = createMockPrisma(DEFAULT_ACCOUNT);
      const scrubber = new CompanyScrubber(prisma);

      const result = scrubber.scrubWithTerms(
        "Acme is a great company. We love Acme.",
        ["Acme"],
        "the client"
      );

      expect(result.scrubbedText).toBe(
        "the client is a great company. We love the client."
      );
      expect(result.replacementsMade).toBe(2);
      expect(result.termsReplaced).toContain("Acme");
    });

    it("processes longest terms first to avoid partial matches", () => {
      const prisma = createMockPrisma(DEFAULT_ACCOUNT);
      const scrubber = new CompanyScrubber(prisma);

      const result = scrubber.scrubWithTerms(
        "Acme Corporation is also known as Acme.",
        ["Acme Corporation", "Acme"],
        "the client"
      );

      expect(result.scrubbedText).toBe(
        "the client is also known as the client."
      );
    });

    it("skips terms shorter than 2 characters", () => {
      const prisma = createMockPrisma(DEFAULT_ACCOUNT);
      const scrubber = new CompanyScrubber(prisma);

      const result = scrubber.scrubWithTerms(
        "A is a letter. Acme is a company.",
        ["A", "Acme"],
        "the client"
      );

      // "A" should be skipped, "Acme" should be replaced
      expect(result.scrubbedText).toContain("A is a letter");
      expect(result.scrubbedText).not.toMatch(/\bAcme\b/);
    });

    it("uses default placeholder when none provided", () => {
      const prisma = createMockPrisma(DEFAULT_ACCOUNT);
      const scrubber = new CompanyScrubber(prisma);

      const result = scrubber.scrubWithTerms("Acme rocks.", ["Acme"]);

      expect(result.scrubbedText).toBe("the client rocks.");
    });

    it("returns zero replacements when no terms match", () => {
      const prisma = createMockPrisma(DEFAULT_ACCOUNT);
      const scrubber = new CompanyScrubber(prisma);

      const result = scrubber.scrubWithTerms(
        "Nothing to scrub here.",
        ["Nonexistent Corp"]
      );

      expect(result.scrubbedText).toBe("Nothing to scrub here.");
      expect(result.replacementsMade).toBe(0);
      expect(result.termsReplaced).toEqual([]);
    });
  });
});
