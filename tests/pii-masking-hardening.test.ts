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
});
