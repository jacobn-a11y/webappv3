import { describe, expect, it } from "vitest";
import { containsPII, maskPII } from "../src/middleware/pii-masker.js";

describe("PII masking hardening", () => {
  it("masks street addresses", () => {
    const result = maskPII("Ship contract to 2211 Market Street, San Francisco, CA 94114.");
    expect(result.maskedText).toContain("[ADDRESS_REDACTED]");
    expect(result.detections.some((d) => d.type === "street_address")).toBe(true);
  });

  it("masks names introduced by identity context", () => {
    const result = maskPII("This is Jane Doe from customer success.");
    expect(result.maskedText).toContain("[NAME_REDACTED]");
    expect(result.maskedText).not.toContain("Jane Doe");
    expect(result.detections.some((d) => d.type === "person_name")).toBe(true);
  });

  it("masks account identifiers tied to ID labels", () => {
    const result = maskPII("Customer ID: CUST-77AA90 should be migrated.");
    expect(result.maskedText).toContain("[ID_REDACTED]");
    expect(result.maskedText).not.toContain("CUST-77AA90");
    expect(result.detections.some((d) => d.type === "account_identifier")).toBe(
      true
    );
  });

  it("does not flag non-PII operational numbers", () => {
    const text = "Revenue was 42000 in Q3 and ticket volume was 112.";
    expect(containsPII(text)).toBe(false);
  });

  it("masks a false-negative-heavy transcript corpus", () => {
    const corpus: Array<{
      text: string;
      expectedTokens: string[];
      forbiddenSnippets: string[];
    }> = [
      {
        text: "Champion email is sarah.connor+west@acme-security.co.uk and direct line is +1 (415) 555-0199.",
        expectedTokens: ["[EMAIL_REDACTED]", "[PHONE_REDACTED]"],
        forbiddenSnippets: ["sarah.connor+west@acme-security.co.uk", "+1 (415) 555-0199"],
      },
      {
        text: "Please mail NDA to 742 Evergreen Terrace, Springfield, IL 62704 before kickoff.",
        expectedTokens: ["[ADDRESS_REDACTED]"],
        forbiddenSnippets: ["742 Evergreen Terrace, Springfield, IL 62704"],
      },
      {
        text: "Spoke with Jane Smith and customer identifier: DEAL-9X7A3C for procurement.",
        expectedTokens: ["[NAME_REDACTED]", "[ID_REDACTED]"],
        forbiddenSnippets: ["Jane Smith", "DEAL-9X7A3C"],
      },
      {
        text: "DOB: 03/09/1987, backup SSN is 444-22-6789 for legal verification only.",
        expectedTokens: ["[DOB_REDACTED]", "[SSN_REDACTED]"],
        forbiddenSnippets: ["DOB: 03/09/1987", "444-22-6789"],
      },
      {
        text: "This is Robert Brown joining from host 10.44.0.18 on the secure segment.",
        expectedTokens: ["[NAME_REDACTED]", "[IP_REDACTED]"],
        forbiddenSnippets: ["Robert Brown", "10.44.0.18"],
      },
    ];

    for (const sample of corpus) {
      const result = maskPII(sample.text);
      for (const token of sample.expectedTokens) {
        expect(result.maskedText).toContain(token);
      }
      for (const forbidden of sample.forbiddenSnippets) {
        expect(result.maskedText).not.toContain(forbidden);
      }
      expect(result.detections.length).toBeGreaterThanOrEqual(
        sample.expectedTokens.length
      );
    }
  });

  it("does not over-redact unlabeled business codes and metrics", () => {
    const text =
      "Pipeline code DEALFLOW-2026 and scorecard 88-77-66 are internal metrics, not customer IDs.";
    const result = maskPII(text);
    expect(result.maskedText).toBe(text);
    expect(result.detections).toHaveLength(0);
  });
});
