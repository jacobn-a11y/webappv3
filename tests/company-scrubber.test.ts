import { describe, it, expect } from "vitest";
import { CompanyScrubber } from "../src/services/company-scrubber.js";

// We test the non-DB methods: scrubWithTerms, formatAttribution, formatInlineAttribution
// The DB-dependent scrubForAccount is tested separately in integration tests.

describe("CompanyScrubber.scrubWithTerms", () => {
  // scrubWithTerms doesn't need DB, just takes a list of company names
  const scrubber = new CompanyScrubber(null as never); // prisma not used for this method

  it("scrubs a single company name", () => {
    const result = scrubber.scrubWithTerms(
      "We worked with Acme Corp to improve their pipeline.",
      ["Acme Corp"]
    );
    expect(result.scrubbedText).toBe(
      "We worked with the client to improve their pipeline."
    );
    expect(result.replacementsMade).toBe(1);
    expect(result.termsReplaced).toContain("Acme Corp");
  });

  it("scrubs multiple occurrences of the same name", () => {
    const result = scrubber.scrubWithTerms(
      "Acme Corp signed the deal. Acme Corp then expanded.",
      ["Acme Corp"]
    );
    expect(result.scrubbedText).toBe(
      "the client signed the deal. the client then expanded."
    );
    expect(result.replacementsMade).toBe(2);
  });

  it("scrubs case-insensitively", () => {
    const result = scrubber.scrubWithTerms(
      "ACME CORP and acme corp are the same.",
      ["Acme Corp"]
    );
    expect(result.scrubbedText).toBe(
      "the client and the client are the same."
    );
  });

  it("uses custom placeholder", () => {
    const result = scrubber.scrubWithTerms(
      "Acme Corp is a great company.",
      ["Acme Corp"],
      "[REDACTED]"
    );
    expect(result.scrubbedText).toBe("[REDACTED] is a great company.");
  });

  it("scrubs longest match first to avoid partial clobbering", () => {
    const result = scrubber.scrubWithTerms(
      "Amazon Web Services powers our infrastructure.",
      ["Amazon Web Services", "Amazon"]
    );
    // Should replace "Amazon Web Services" first
    expect(result.scrubbedText).toBe(
      "the client powers our infrastructure."
    );
  });

  it("respects word boundaries", () => {
    const result = scrubber.scrubWithTerms(
      "Acme is great but AcmeBot is a tool.",
      ["Acme"]
    );
    // "Acme" should be replaced but not "AcmeBot" (word boundary)
    expect(result.scrubbedText).toContain("the client is great");
  });

  it("skips terms shorter than 2 characters", () => {
    const result = scrubber.scrubWithTerms("A is a letter.", ["A"]);
    expect(result.scrubbedText).toBe("A is a letter.");
    expect(result.replacementsMade).toBe(0);
  });

  it("handles empty company names list", () => {
    const text = "No companies to scrub here.";
    const result = scrubber.scrubWithTerms(text, []);
    expect(result.scrubbedText).toBe(text);
    expect(result.replacementsMade).toBe(0);
  });

  it("handles empty text", () => {
    const result = scrubber.scrubWithTerms("", ["Acme"]);
    expect(result.scrubbedText).toBe("");
    expect(result.replacementsMade).toBe(0);
  });

  it("scrubs possessive forms", () => {
    const result = scrubber.scrubWithTerms(
      "Acme's platform is excellent.",
      ["Acme"]
    );
    expect(result.scrubbedText).not.toContain("Acme");
  });
});

describe("CompanyScrubber.formatAttribution", () => {
  it("returns named attribution with full details", () => {
    const result = CompanyScrubber.formatAttribution(
      "Jeff Bezos",
      "CEO",
      true,
      "Amazon"
    );
    expect(result).toBe("Jeff Bezos, CEO, Amazon");
  });

  it("returns named attribution without company", () => {
    const result = CompanyScrubber.formatAttribution(
      "Jeff Bezos",
      "CEO",
      true,
      null
    );
    expect(result).toBe("Jeff Bezos, CEO");
  });

  it("returns named attribution with name only", () => {
    const result = CompanyScrubber.formatAttribution(
      "Jeff Bezos",
      null,
      true,
      "Amazon"
    );
    expect(result).toBe("Jeff Bezos, Amazon");
  });

  it("returns anonymized attribution when includeCompanyName is false", () => {
    const result = CompanyScrubber.formatAttribution(
      "Jeff Bezos",
      "CEO",
      false
    );
    expect(result).toBe("a senior executive at the client");
  });

  it("returns generic anonymized when no title", () => {
    const result = CompanyScrubber.formatAttribution(
      "Jeff Bezos",
      null,
      false
    );
    expect(result).toBe("a team member at the client");
  });

  it("anonymizes CTO title", () => {
    const result = CompanyScrubber.formatAttribution(
      "Jane Doe",
      "CTO",
      false
    );
    expect(result).toBe("a technology leader at the client");
  });

  it("anonymizes VP title", () => {
    const result = CompanyScrubber.formatAttribution(
      "Jane Doe",
      "VP of Sales",
      false
    );
    expect(result).toBe("a VP at the client");
  });

  it("anonymizes Director title", () => {
    const result = CompanyScrubber.formatAttribution(
      "Jane Doe",
      "Director of Engineering",
      false
    );
    expect(result).toBe("a director at the client");
  });

  it("anonymizes Engineer title", () => {
    const result = CompanyScrubber.formatAttribution(
      "Jane Doe",
      "Senior Software Engineer",
      false
    );
    expect(result).toBe("a technical team member at the client");
  });
});

describe("CompanyScrubber.formatInlineAttribution", () => {
  it("returns title with company for named mode", () => {
    const result = CompanyScrubber.formatInlineAttribution(
      "CEO",
      true,
      "Amazon"
    );
    expect(result).toBe("CEO, Amazon");
  });

  it("returns title only for named mode without company", () => {
    const result = CompanyScrubber.formatInlineAttribution("CEO", true, null);
    expect(result).toBe("CEO");
  });

  it("returns anonymized for scrubbed mode", () => {
    const result = CompanyScrubber.formatInlineAttribution("CEO", false);
    expect(result).toBe("a senior executive at the client");
  });

  it("returns generic for no title in scrubbed mode", () => {
    const result = CompanyScrubber.formatInlineAttribution(null, false);
    expect(result).toBe("a team member at the client");
  });
});
