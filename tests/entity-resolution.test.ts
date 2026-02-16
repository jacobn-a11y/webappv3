import { describe, it, expect } from "vitest";
import {
  extractEmailDomain,
  normalizeCompanyName,
} from "../src/services/entity-resolution.js";

describe("extractEmailDomain", () => {
  it("extracts domain from a standard email", () => {
    expect(extractEmailDomain("john@bigtech.com")).toBe("bigtech.com");
  });

  it("lowercases the domain", () => {
    expect(extractEmailDomain("John@BigTech.COM")).toBe("bigtech.com");
  });

  it("trims whitespace", () => {
    expect(extractEmailDomain("  john@bigtech.com  ")).toBe("bigtech.com");
  });

  it("returns null for free email providers", () => {
    expect(extractEmailDomain("user@gmail.com")).toBeNull();
    expect(extractEmailDomain("user@yahoo.com")).toBeNull();
    expect(extractEmailDomain("user@hotmail.com")).toBeNull();
    expect(extractEmailDomain("user@outlook.com")).toBeNull();
    expect(extractEmailDomain("user@aol.com")).toBeNull();
    expect(extractEmailDomain("user@icloud.com")).toBeNull();
    expect(extractEmailDomain("user@protonmail.com")).toBeNull();
    expect(extractEmailDomain("user@proton.me")).toBeNull();
    expect(extractEmailDomain("user@live.com")).toBeNull();
    expect(extractEmailDomain("user@hey.com")).toBeNull();
  });

  it("returns domain for non-free email providers", () => {
    expect(extractEmailDomain("jane@acme.com")).toBe("acme.com");
    expect(extractEmailDomain("bob@megacorp.io")).toBe("megacorp.io");
  });

  it("returns null for invalid emails (no @)", () => {
    expect(extractEmailDomain("notanemail")).toBeNull();
  });

  it("returns null for emails with multiple @", () => {
    expect(extractEmailDomain("a@b@c.com")).toBeNull();
  });

  it("handles subdomains", () => {
    expect(extractEmailDomain("user@mail.company.co.uk")).toBe(
      "mail.company.co.uk"
    );
  });
});

describe("normalizeCompanyName", () => {
  it("lowercases company names", () => {
    expect(normalizeCompanyName("Acme")).toBe("acme");
  });

  it("strips 'Inc' suffix", () => {
    expect(normalizeCompanyName("Acme Inc")).toBe("acme");
    expect(normalizeCompanyName("Acme Inc.")).toBe("acme");
  });

  it("strips 'Corp' suffix", () => {
    expect(normalizeCompanyName("BigTech Corp")).toBe("bigtech");
    expect(normalizeCompanyName("BigTech Corp.")).toBe("bigtech");
  });

  it("strips 'Corporation' suffix", () => {
    expect(normalizeCompanyName("BigTech Corporation")).toBe("bigtech");
  });

  it("strips 'LLC' suffix", () => {
    expect(normalizeCompanyName("Startup LLC")).toBe("startup");
  });

  it("strips 'Ltd' suffix", () => {
    expect(normalizeCompanyName("British Ltd")).toBe("british");
    expect(normalizeCompanyName("British Ltd.")).toBe("british");
  });

  it("strips 'Limited' suffix", () => {
    expect(normalizeCompanyName("British Limited")).toBe("british");
  });

  it("strips 'GmbH' suffix", () => {
    expect(normalizeCompanyName("Deutsche GmbH")).toBe("deutsche");
  });

  it("strips multiple suffixes", () => {
    expect(normalizeCompanyName("Acme Corp Inc")).toBe("acme");
  });

  it("removes punctuation", () => {
    expect(normalizeCompanyName("Acme, Inc.")).toBe("acme");
  });

  it("collapses whitespace", () => {
    expect(normalizeCompanyName("Acme   Web   Services")).toBe(
      "acme web services"
    );
  });

  it("handles hyphens", () => {
    expect(normalizeCompanyName("Hewlett-Packard")).toBe("hewlett packard");
  });

  it("handles complex names", () => {
    expect(normalizeCompanyName("Amazon Web Services, Inc.")).toBe(
      "amazon web services"
    );
  });

  it("handles empty string", () => {
    expect(normalizeCompanyName("")).toBe("");
  });

  it("handles name that is just a suffix", () => {
    expect(normalizeCompanyName("LLC")).toBe("");
  });

  it("preserves non-suffix words", () => {
    expect(normalizeCompanyName("Incredible Technologies")).toBe(
      "incredible technologies"
    );
  });
});
