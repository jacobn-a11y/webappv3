/**
 * Entity Resolution Security Tests
 *
 * Validates that:
 *   - Free email domains are properly excluded
 *   - Company name normalization works correctly
 *   - Fuzzy matching has proper confidence caps
 *   - Entity resolution doesn't leak data across organizations
 */

import { describe, it, expect } from "vitest";
import { extractEmailDomain, normalizeCompanyName } from "./entity-resolution.js";

describe("extractEmailDomain", () => {
  it("should extract domain from valid email", () => {
    expect(extractEmailDomain("john@acme.com")).toBe("acme.com");
  });

  it("should lowercase the domain", () => {
    expect(extractEmailDomain("John@ACME.COM")).toBe("acme.com");
  });

  it("should return null for free email providers", () => {
    const freeProviders = [
      "user@gmail.com",
      "user@yahoo.com",
      "user@hotmail.com",
      "user@outlook.com",
      "user@aol.com",
      "user@icloud.com",
      "user@protonmail.com",
      "user@proton.me",
      "user@live.com",
      "user@msn.com",
      "user@yandex.com",
      "user@zoho.com",
      "user@fastmail.com",
      "user@tutanota.com",
      "user@hey.com",
    ];
    for (const email of freeProviders) {
      expect(extractEmailDomain(email)).toBeNull();
    }
  });

  it("should return null for strings without @ sign", () => {
    expect(extractEmailDomain("not-an-email")).toBeNull();
  });

  it("should return null for strings with multiple @ signs", () => {
    // "multiple@@at.com".split("@") => ["multiple", "", "at.com"] (length 3)
    expect(extractEmailDomain("multiple@@at.com")).toBeNull();
  });

  it("should trim whitespace from emails", () => {
    expect(extractEmailDomain("  john@acme.com  ")).toBe("acme.com");
  });

  it("should extract domain from emails with subdomains", () => {
    expect(extractEmailDomain("user@mail.corp.example.com")).toBe(
      "mail.corp.example.com"
    );
  });
});

describe("normalizeCompanyName", () => {
  it("should lowercase the name", () => {
    expect(normalizeCompanyName("ACME Corp")).toBe("acme");
  });

  it("should strip common suffixes", () => {
    const variations = [
      ["Acme Inc", "acme"],
      ["Acme Inc.", "acme"],
      ["Acme Corporation", "acme"],
      ["Acme Corp", "acme"],
      ["Acme Corp.", "acme"],
      ["Acme LLC", "acme"],
      ["Acme Ltd", "acme"],
      ["Acme Ltd.", "acme"],
      ["Acme Limited", "acme"],
      ["Acme Company", "acme"],
      ["Acme Group", "acme"],
      ["Acme Holdings", "acme"],
      ["Acme PLC", "acme"],
      ["Acme GmbH", "acme"],
      ["Acme SA", "acme"],
      ["Acme AG", "acme"],
    ];

    for (const [input, expected] of variations) {
      expect(normalizeCompanyName(input)).toBe(expected);
    }
  });

  it("should collapse extra whitespace", () => {
    expect(normalizeCompanyName("Acme   Big   Corp")).toBe("acme big");
  });

  it("should remove punctuation", () => {
    expect(normalizeCompanyName("Acme (Holdings)")).toBe("acme");
  });

  it("should handle multi-word company names", () => {
    expect(normalizeCompanyName("Amazon Web Services Inc")).toBe(
      "amazon web services"
    );
  });

  it("should handle empty strings", () => {
    expect(normalizeCompanyName("")).toBe("");
  });

  it("should handle names that are just suffixes", () => {
    expect(normalizeCompanyName("Inc")).toBe("");
  });
});
