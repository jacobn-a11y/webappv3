import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  extractEmailDomain,
  normalizeCompanyName,
  EntityResolver,
} from "./entity-resolution.js";
import type { ResolvedEntity } from "./entity-resolution.js";

// ─── Prisma Mock ────────────────────────────────────────────────────────────

function createMockPrisma() {
  return {
    account: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    accountDomain: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    contact: {
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    call: {
      update: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const ORG_ID = "org-001";

function acct(id: string, name: string, domain: string | null = null) {
  return {
    id,
    name,
    normalizedName: normalizeCompanyName(name),
    domain,
  };
}

// ─── extractEmailDomain ─────────────────────────────────────────────────────

describe("extractEmailDomain", () => {
  it("extracts a corporate domain", () => {
    expect(extractEmailDomain("john@bigtech.com")).toBe("bigtech.com");
  });

  it("lowercases and trims the input", () => {
    expect(extractEmailDomain("  ALICE@Acme.IO  ")).toBe("acme.io");
  });

  it("returns null for invalid email (no @ sign)", () => {
    expect(extractEmailDomain("not-an-email")).toBeNull();
  });

  it("returns null for multiple @ signs", () => {
    expect(extractEmailDomain("a@b@c.com")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractEmailDomain("")).toBeNull();
  });

  describe("free email domain filtering", () => {
    const freeProviders = [
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
    ];

    for (const provider of freeProviders) {
      it(`filters out ${provider}`, () => {
        expect(extractEmailDomain(`user@${provider}`)).toBeNull();
      });
    }

    it("does not filter a non-free domain", () => {
      expect(extractEmailDomain("ceo@stripe.com")).toBe("stripe.com");
    });

    it("does not filter a subdomain of a free provider", () => {
      expect(extractEmailDomain("user@corp.gmail.com")).toBe("corp.gmail.com");
    });
  });
});

// ─── normalizeCompanyName ───────────────────────────────────────────────────

describe("normalizeCompanyName", () => {
  it("lowercases the name", () => {
    expect(normalizeCompanyName("ACME")).toBe("acme");
  });

  it("strips 'Inc' suffix", () => {
    expect(normalizeCompanyName("Amazon Inc")).toBe("amazon");
  });

  it("strips 'Inc.' suffix (with period)", () => {
    expect(normalizeCompanyName("Amazon Inc.")).toBe("amazon");
  });

  it("strips 'Incorporated' suffix", () => {
    expect(normalizeCompanyName("Amazon Incorporated")).toBe("amazon");
  });

  it("strips 'Corp' suffix", () => {
    expect(normalizeCompanyName("Tesla Corp")).toBe("tesla");
  });

  it("strips 'Corp.' suffix (with period)", () => {
    expect(normalizeCompanyName("Tesla Corp.")).toBe("tesla");
  });

  it("strips 'Corporation' suffix", () => {
    expect(normalizeCompanyName("Microsoft Corporation")).toBe("microsoft");
  });

  it("strips 'LLC' suffix", () => {
    expect(normalizeCompanyName("Google LLC")).toBe("google");
  });

  it("strips 'Ltd' suffix", () => {
    expect(normalizeCompanyName("DeepMind Ltd")).toBe("deepmind");
  });

  it("strips 'Ltd.' suffix (with period)", () => {
    expect(normalizeCompanyName("DeepMind Ltd.")).toBe("deepmind");
  });

  it("strips 'Limited' suffix", () => {
    expect(normalizeCompanyName("Barclays Limited")).toBe("barclays");
  });

  it("strips 'Co' suffix", () => {
    expect(normalizeCompanyName("Ford Motor Co")).toBe("ford motor");
  });

  it("strips 'Co.' suffix (with period)", () => {
    expect(normalizeCompanyName("Ford Motor Co.")).toBe("ford motor");
  });

  it("strips 'Company' suffix", () => {
    expect(normalizeCompanyName("Ford Motor Company")).toBe("ford motor");
  });

  it("strips 'Group' suffix", () => {
    expect(normalizeCompanyName("Alibaba Group")).toBe("alibaba");
  });

  it("strips 'Holdings' suffix", () => {
    expect(normalizeCompanyName("Alphabet Holdings")).toBe("alphabet");
  });

  it("strips 'PLC' suffix", () => {
    expect(normalizeCompanyName("BP PLC")).toBe("bp");
  });

  it("strips 'GmbH' suffix", () => {
    expect(normalizeCompanyName("SAP GmbH")).toBe("sap");
  });

  it("strips 'SA' suffix", () => {
    expect(normalizeCompanyName("LVMH SA")).toBe("lvmh");
  });

  it("strips 'AG' suffix", () => {
    expect(normalizeCompanyName("Siemens AG")).toBe("siemens");
  });

  it("strips multiple suffixes at once", () => {
    expect(normalizeCompanyName("Acme Corp. Holdings Inc.")).toBe("acme");
  });

  it("replaces punctuation with spaces", () => {
    expect(normalizeCompanyName("Ben-Gurion (Tech)")).toBe("ben gurion tech");
  });

  it("collapses multiple spaces", () => {
    expect(normalizeCompanyName("  Big   Tech   Inc.  ")).toBe("big tech");
  });

  it("handles a name that is only a suffix", () => {
    expect(normalizeCompanyName("LLC")).toBe("");
  });

  it("leaves a plain name untouched after lowercasing", () => {
    expect(normalizeCompanyName("Stripe")).toBe("stripe");
  });
});

// ─── EntityResolver.resolve — Email Domain Matching ─────────────────────────

describe("EntityResolver.resolve — email domain matching", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let resolver: EntityResolver;

  beforeEach(() => {
    prisma = createMockPrisma();
    resolver = new EntityResolver(prisma);
  });

  it("matches via primary domain on Account (confidence 0.95)", async () => {
    const account = acct("a1", "BigTech", "bigtech.com");
    (prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(account);

    const result = await resolver.resolve(ORG_ID, [
      { email: "john@bigtech.com", name: "John" },
    ]);

    expect(result).toEqual<ResolvedEntity>({
      accountId: "a1",
      accountName: "BigTech",
      confidence: 0.95,
      matchMethod: "email_domain",
    });

    expect(prisma.account.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        domain: { in: ["bigtech.com"] },
      },
    });
  });

  it("matches via alias domain on AccountDomain (confidence 0.9)", async () => {
    // Primary lookup returns nothing
    (prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    // Alias lookup succeeds
    (prisma.accountDomain.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      domain: "bigtech.io",
      accountId: "a1",
      account: { id: "a1", name: "BigTech" },
    });

    const result = await resolver.resolve(ORG_ID, [
      { email: "jane@bigtech.io" },
    ]);

    expect(result).toEqual<ResolvedEntity>({
      accountId: "a1",
      accountName: "BigTech",
      confidence: 0.9,
      matchMethod: "email_domain",
    });

    expect(prisma.accountDomain.findFirst).toHaveBeenCalledWith({
      where: {
        domain: { in: ["bigtech.io"] },
        account: { organizationId: ORG_ID },
      },
      include: { account: true },
    });
  });

  it("matches via contact-level email domain (confidence 0.85)", async () => {
    (prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.accountDomain.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.contact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      emailDomain: "bigtech.com",
      account: { id: "a1", name: "BigTech" },
    });

    const result = await resolver.resolve(ORG_ID, [
      { email: "bob@bigtech.com" },
    ]);

    expect(result).toEqual<ResolvedEntity>({
      accountId: "a1",
      accountName: "BigTech",
      confidence: 0.85,
      matchMethod: "email_domain",
    });

    expect(prisma.contact.findFirst).toHaveBeenCalledWith({
      where: {
        emailDomain: { in: ["bigtech.com"] },
        account: { organizationId: ORG_ID },
      },
      include: { account: true },
    });
  });

  it("prefers primary domain over alias when primary matches", async () => {
    const account = acct("a1", "BigTech", "bigtech.com");
    (prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(account);

    const result = await resolver.resolve(ORG_ID, [
      { email: "user@bigtech.com" },
    ]);

    expect(result.confidence).toBe(0.95);
    // alias and contact lookup should not be called
    expect(prisma.accountDomain.findFirst).not.toHaveBeenCalled();
    expect(prisma.contact.findFirst).not.toHaveBeenCalled();
  });

  it("deduplicates domains across multiple participants", async () => {
    (prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      acct("a1", "Acme", "acme.com")
    );

    await resolver.resolve(ORG_ID, [
      { email: "alice@acme.com" },
      { email: "bob@acme.com" },
    ]);

    // Should query with a single deduplicated domain
    expect(prisma.account.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        domain: { in: ["acme.com"] },
      },
    });
  });

  it("collects domains from multiple participants", async () => {
    (prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      acct("a1", "Acme", "acme.com")
    );

    await resolver.resolve(ORG_ID, [
      { email: "alice@acme.com" },
      { email: "bob@partner.io" },
    ]);

    const call = (prisma.account.findFirst as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.where.domain.in).toEqual(
      expect.arrayContaining(["acme.com", "partner.io"])
    );
  });

  it("skips email matching when all participants have free-provider emails", async () => {
    await resolver.resolve(ORG_ID, [
      { email: "alice@gmail.com", name: "a" },
      { email: "bob@yahoo.com", name: "b" },
    ]);

    // Should skip straight to fuzzy or none — no email domain queries
    expect(prisma.account.findFirst).not.toHaveBeenCalled();
    expect(prisma.accountDomain.findFirst).not.toHaveBeenCalled();
  });

  it("skips email matching when no participants have emails", async () => {
    await resolver.resolve(ORG_ID, [{ name: "Alice" }]);

    expect(prisma.account.findFirst).not.toHaveBeenCalled();
  });
});

// ─── EntityResolver.resolve — Fuzzy Name Matching ───────────────────────────

describe("EntityResolver.resolve — fuzzy name matching", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let resolver: EntityResolver;

  beforeEach(() => {
    prisma = createMockPrisma();
    resolver = new EntityResolver(prisma);

    // Email domain matching returns nothing for all tests in this block
    (prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.accountDomain.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.contact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  });

  it("matches an exact normalized name from call title", async () => {
    (prisma.account.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      acct("a1", "Acme Corp", "acme.com"),
    ]);

    const result = await resolver.resolve(
      ORG_ID,
      [{ name: "John" }],
      "Acme Corp"
    );

    expect(result.matchMethod).toBe("fuzzy_name");
    expect(result.accountId).toBe("a1");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(0.75);
  });

  it("matches a close but imperfect name (e.g. typo)", async () => {
    (prisma.account.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      acct("a1", "Stripe Inc.", "stripe.com"),
    ]);

    // "Stripes" is close to "stripe"
    const result = await resolver.resolve(
      ORG_ID,
      [{ name: "John" }],
      "Stripes"
    );

    expect(result.matchMethod).toBe("fuzzy_name");
    expect(result.accountId).toBe("a1");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(0.75);
  });

  it("caps fuzzy confidence at 0.75 even for perfect match", async () => {
    (prisma.account.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      acct("a1", "Acme", null),
    ]);

    const result = await resolver.resolve(
      ORG_ID,
      [{ name: "John" }],
      "Acme"
    );

    expect(result.confidence).toBeLessThanOrEqual(0.75);
    expect(result.matchMethod).toBe("fuzzy_name");
  });

  it("rejects a name that is too far from any account", async () => {
    (prisma.account.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      acct("a1", "Acme Corp", null),
    ]);

    const result = await resolver.resolve(
      ORG_ID,
      [{ name: "John" }],
      "Completely Unrelated Name XYZ"
    );

    expect(result.matchMethod).toBe("none");
    expect(result.confidence).toBe(0);
    expect(result.accountId).toBe("");
  });

  it("uses participant names as fuzzy candidates", async () => {
    (prisma.account.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      acct("a1", "Acme Corp", null),
    ]);

    // Participant name matches the account
    const result = await resolver.resolve(ORG_ID, [
      { name: "Acme Corp" },
    ]);

    expect(result.matchMethod).toBe("fuzzy_name");
    expect(result.accountId).toBe("a1");
  });

  it("picks the best match among multiple candidates", async () => {
    (prisma.account.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      acct("a1", "Acme Corp", null),
      acct("a2", "Stripe Inc", null),
    ]);

    // "Stripe" (from call title) will match a2's normalizedName "stripe"
    // "Acmee" (typo in participant name) will match a1 but less well
    const result = await resolver.resolve(
      ORG_ID,
      [{ name: "Acmee" }],
      "Stripe"
    );

    expect(result.matchMethod).toBe("fuzzy_name");
    // "stripe" is a perfect match vs "acmee" being a fuzzy match, so a2 wins
    expect(result.accountId).toBe("a2");
  });

  it("returns none when there are no accounts at all", async () => {
    (prisma.account.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await resolver.resolve(
      ORG_ID,
      [{ name: "Anyone" }],
      "Some Meeting"
    );

    expect(result.matchMethod).toBe("none");
    expect(result.confidence).toBe(0);
  });

  it("filters out candidate names shorter than 2 characters", async () => {
    (prisma.account.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      acct("a1", "X", null),
    ]);

    // Single-char participant name and single-char call title after normalization
    const result = await resolver.resolve(
      ORG_ID,
      [{ name: "A" }],
      "B"
    );

    // "a" and "b" are length 1 after normalization, filtered out
    // With no candidates, fuzzy match can't fire — should fall to "none"
    expect(result.matchMethod).toBe("none");
  });
});

// ─── Priority Ordering ─────────────────────────────────────────────────────

describe("EntityResolver.resolve — priority ordering", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let resolver: EntityResolver;

  beforeEach(() => {
    prisma = createMockPrisma();
    resolver = new EntityResolver(prisma);
  });

  it("email domain match wins over fuzzy name match", async () => {
    // Email domain will match account a1
    (prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      acct("a1", "BigTech", "bigtech.com")
    );
    // Fuzzy would match a different account a2
    (prisma.account.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      acct("a2", "Acme Corp", null),
    ]);

    const result = await resolver.resolve(
      ORG_ID,
      [{ email: "john@bigtech.com", name: "Acme Corp" }],
      "Acme Corp"
    );

    expect(result.matchMethod).toBe("email_domain");
    expect(result.accountId).toBe("a1");
    // findMany for fuzzy should NOT have been called
    expect(prisma.account.findMany).not.toHaveBeenCalled();
  });

  it("falls back to fuzzy when email domain does not match", async () => {
    // All email domain lookups return null
    (prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.accountDomain.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.contact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    // Fuzzy will match
    (prisma.account.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      acct("a2", "Acme Corp", null),
    ]);

    const result = await resolver.resolve(
      ORG_ID,
      [{ email: "john@unknown-domain.com", name: "Acme Corp" }],
      "Acme quarterly review"
    );

    expect(result.matchMethod).toBe("fuzzy_name");
    expect(result.accountId).toBe("a2");
  });

  it("returns none when both email and fuzzy fail", async () => {
    (prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.accountDomain.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.contact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.account.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      acct("a1", "Acme Corp", null),
    ]);

    const result = await resolver.resolve(
      ORG_ID,
      [{ email: "john@unknown-domain.com" }],
      "Totally Unrelated Meeting Title XYZ 999"
    );

    expect(result).toEqual<ResolvedEntity>({
      accountId: "",
      accountName: "",
      confidence: 0,
      matchMethod: "none",
    });
  });

  it("email > fuzzy > none confidence ordering is respected", async () => {
    // Run three separate resolutions for each tier

    // Email match
    const prisma1 = createMockPrisma();
    (prisma1.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      acct("a1", "BigTech", "bigtech.com")
    );
    const r1 = await new EntityResolver(prisma1).resolve(ORG_ID, [
      { email: "john@bigtech.com" },
    ]);

    // Fuzzy match
    const prisma2 = createMockPrisma();
    (prisma2.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma2.accountDomain.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma2.contact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma2.account.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      acct("a2", "Acme Corp", null),
    ]);
    const r2 = await new EntityResolver(prisma2).resolve(
      ORG_ID,
      [{ name: "Acme Corp" }],
      "Acme Corp"
    );

    // No match
    const prisma3 = createMockPrisma();
    (prisma3.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma3.accountDomain.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma3.contact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma3.account.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const r3 = await new EntityResolver(prisma3).resolve(ORG_ID, [
      { name: "Nobody" },
    ]);

    // Verify descending confidence: email > fuzzy > none
    expect(r1.confidence).toBeGreaterThan(r2.confidence);
    expect(r2.confidence).toBeGreaterThan(r3.confidence);
    expect(r3.confidence).toBe(0);
  });
});

// ─── EntityResolver.resolveAndLinkContacts ──────────────────────────────────

describe("EntityResolver.resolveAndLinkContacts", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let resolver: EntityResolver;

  beforeEach(() => {
    prisma = createMockPrisma();
    resolver = new EntityResolver(prisma);
  });

  it("upserts contacts and links the call when match is found", async () => {
    (prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      acct("a1", "BigTech", "bigtech.com")
    );

    const result = await resolver.resolveAndLinkContacts(
      ORG_ID,
      "call-001",
      [
        { email: "john@bigtech.com", name: "John Doe" },
        { email: "jane@bigtech.com", name: "Jane Smith" },
      ]
    );

    expect(result.matchMethod).toBe("email_domain");

    // Verify contacts were upserted
    expect(prisma.contact.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.contact.upsert).toHaveBeenCalledWith({
      where: {
        accountId_email: {
          accountId: "a1",
          email: "john@bigtech.com",
        },
      },
      create: {
        accountId: "a1",
        email: "john@bigtech.com",
        emailDomain: "bigtech.com",
        name: "John Doe",
      },
      update: {
        name: "John Doe",
      },
    });

    // Verify call was linked
    expect(prisma.call.update).toHaveBeenCalledWith({
      where: { id: "call-001" },
      data: { accountId: "a1" },
    });
  });

  it("skips contact upsert for participants without email", async () => {
    (prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      acct("a1", "BigTech", "bigtech.com")
    );

    await resolver.resolveAndLinkContacts(ORG_ID, "call-001", [
      { email: "john@bigtech.com", name: "John" },
      { name: "No Email Person" }, // no email
    ]);

    expect(prisma.contact.upsert).toHaveBeenCalledTimes(1);
  });

  it("skips contact upsert for free email domains", async () => {
    (prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      acct("a1", "BigTech", "bigtech.com")
    );

    await resolver.resolveAndLinkContacts(ORG_ID, "call-001", [
      { email: "john@bigtech.com", name: "John" },
      { email: "personal@gmail.com", name: "Personal" },
    ]);

    // Only the corporate email should produce a contact upsert
    expect(prisma.contact.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.contact.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ email: "john@bigtech.com" }),
      })
    );
  });

  it("does not upsert contacts or link call when match is none", async () => {
    // All lookups return nothing
    (prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.accountDomain.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.contact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.account.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await resolver.resolveAndLinkContacts(
      ORG_ID,
      "call-001",
      [{ email: "john@unknown.com" }]
    );

    expect(result.matchMethod).toBe("none");
    expect(prisma.contact.upsert).not.toHaveBeenCalled();
    expect(prisma.call.update).not.toHaveBeenCalled();
  });

  it("passes null for name when participant has no name", async () => {
    (prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      acct("a1", "BigTech", "bigtech.com")
    );

    await resolver.resolveAndLinkContacts(ORG_ID, "call-001", [
      { email: "anon@bigtech.com" }, // no name
    ]);

    expect(prisma.contact.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ name: null }),
        update: expect.objectContaining({ name: undefined }),
      })
    );
  });
});
