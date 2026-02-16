import { describe, it, expect } from "vitest";
import {
  maskPII,
  maskTranscriptChunks,
  containsPII,
  type MaskingResult,
} from "./pii-masker.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Assert that the masked text contains the redaction tag and no trace of the original value */
function expectRedacted(
  result: MaskingResult,
  original: string,
  replacement: string,
) {
  expect(result.maskedText).toContain(replacement);
  expect(result.maskedText).not.toContain(original);

  const detection = result.detections.find((d) => d.original === original);
  expect(detection).toBeDefined();
  expect(detection!.replacement).toBe(replacement);
}

// ─── Email ──────────────────────────────────────────────────────────────────

describe("maskPII – email", () => {
  it("masks a simple email address", () => {
    const result = maskPII("Contact me at alice@example.com for details.");
    expectRedacted(result, "alice@example.com", "[EMAIL_REDACTED]");
    expect(result.maskedText).toBe(
      "Contact me at [EMAIL_REDACTED] for details.",
    );
  });

  it("masks emails with subdomains", () => {
    const result = maskPII("bob@mail.corp.example.org");
    expectRedacted(result, "bob@mail.corp.example.org", "[EMAIL_REDACTED]");
  });

  it("masks emails with plus-addressing", () => {
    const result = maskPII("Send to user+tag@gmail.com");
    expectRedacted(result, "user+tag@gmail.com", "[EMAIL_REDACTED]");
  });

  it("masks multiple emails in the same text", () => {
    const text = "CC: a@b.co and c@d.io";
    const result = maskPII(text);
    expect(result.detections.filter((d) => d.type === "email")).toHaveLength(2);
    expect(result.maskedText).toBe(
      "CC: [EMAIL_REDACTED] and [EMAIL_REDACTED]",
    );
  });
});

// ─── Phone (US & International) ─────────────────────────────────────────────

describe("maskPII – phone", () => {
  it("masks (555) 123-4567 format", () => {
    const result = maskPII("Call (555) 123-4567 now.");
    expectRedacted(result, "(555) 123-4567", "[PHONE_REDACTED]");
  });

  it("masks 555-123-4567 format", () => {
    const result = maskPII("Phone: 555-123-4567");
    expectRedacted(result, "555-123-4567", "[PHONE_REDACTED]");
  });

  it("masks +1-555-123-4567 international format", () => {
    const result = maskPII("Reach me at +1-555-123-4567.");
    expectRedacted(result, "+1-555-123-4567", "[PHONE_REDACTED]");
  });

  it("masks phone with dot separators", () => {
    const result = maskPII("555.123.4567 is my number");
    expectRedacted(result, "555.123.4567", "[PHONE_REDACTED]");
  });

  it("masks phone with spaces", () => {
    const result = maskPII("Call 555 123 4567 please");
    expectRedacted(result, "555 123 4567", "[PHONE_REDACTED]");
  });
});

// ─── SSN ────────────────────────────────────────────────────────────────────

describe("maskPII – SSN", () => {
  it("masks SSN with dashes: 123-45-6789", () => {
    const result = maskPII("SSN: 123-45-6789");
    expectRedacted(result, "123-45-6789", "[SSN_REDACTED]");
  });

  it("masks SSN with spaces: 123 45 6789", () => {
    const result = maskPII("SSN is 123 45 6789.");
    expectRedacted(result, "123 45 6789", "[SSN_REDACTED]");
  });

  it("masks SSN without separators: 123456789", () => {
    const result = maskPII("SSN: 123456789");
    expectRedacted(result, "123456789", "[SSN_REDACTED]");
  });
});

// ─── Credit Card ────────────────────────────────────────────────────────────

describe("maskPII – credit card", () => {
  it("masks credit card with dashes", () => {
    const result = maskPII("Card: 4111-1111-1111-1111");
    expectRedacted(result, "4111-1111-1111-1111", "[CC_REDACTED]");
  });

  it("masks credit card with spaces", () => {
    const result = maskPII("CC: 4111 1111 1111 1111");
    expectRedacted(result, "4111 1111 1111 1111", "[CC_REDACTED]");
  });

  it("masks credit card as a contiguous number", () => {
    const result = maskPII("Card number 4111111111111111 on file.");
    expectRedacted(result, "4111111111111111", "[CC_REDACTED]");
  });
});

// ─── IP Address ─────────────────────────────────────────────────────────────

describe("maskPII – IP address", () => {
  it("masks a standard IPv4 address", () => {
    const result = maskPII("Server at 192.168.1.100 responded.");
    expectRedacted(result, "192.168.1.100", "[IP_REDACTED]");
  });

  it("masks loopback address", () => {
    const result = maskPII("Running on 127.0.0.1");
    expectRedacted(result, "127.0.0.1", "[IP_REDACTED]");
  });

  it("masks multiple IPs", () => {
    const text = "From 10.0.0.1 to 10.0.0.2";
    const result = maskPII(text);
    expect(result.detections.filter((d) => d.type === "ip_address")).toHaveLength(2);
  });
});

// ─── Street Address ─────────────────────────────────────────────────────────
// Note: The current implementation does NOT include a street address regex in
// PII_PATTERNS (only 6 patterns are defined). These tests document the current
// behavior — street addresses are NOT masked.

describe("maskPII – street address", () => {
  it("does not mask a street address (not currently implemented)", () => {
    const text = "I live at 123 Main Street, Springfield, IL 62704";
    const result = maskPII(text);
    // No street_address pattern in PII_PATTERNS, so no detection expected
    expect(
      result.detections.filter((d) => d.type === "street_address"),
    ).toHaveLength(0);
  });
});

// ─── Date of Birth ──────────────────────────────────────────────────────────

describe("maskPII – date of birth", () => {
  it("masks 'date of birth: MM/DD/YYYY'", () => {
    const result = maskPII("date of birth: 01/15/1990");
    expectRedacted(result, "date of birth: 01/15/1990", "[DOB_REDACTED]");
  });

  it("masks 'DOB: MM-DD-YY'", () => {
    const result = maskPII("DOB: 03-22-85");
    expectRedacted(result, "DOB: 03-22-85", "[DOB_REDACTED]");
  });

  it("masks 'born on DD/MM/YYYY'", () => {
    const result = maskPII("She was born on 15/01/1990.");
    expectRedacted(result, "born on 15/01/1990", "[DOB_REDACTED]");
  });

  it("is case-insensitive for the keyword", () => {
    const result = maskPII("Date Of Birth: 12/25/2000");
    expectRedacted(result, "Date Of Birth: 12/25/2000", "[DOB_REDACTED]");
  });

  it("does not mask bare dates without a DOB keyword", () => {
    const result = maskPII("The meeting is on 01/15/2024.");
    expect(
      result.detections.filter((d) => d.type === "date_of_birth"),
    ).toHaveLength(0);
  });
});

// ─── Non-PII Preservation ───────────────────────────────────────────────────

describe("maskPII – non-PII content preserved", () => {
  it("returns identical text when no PII is present", () => {
    const text =
      "This is a regular business transcript about quarterly revenue.";
    const result = maskPII(text);
    expect(result.maskedText).toBe(text);
    expect(result.detections).toHaveLength(0);
  });

  it("preserves surrounding text while only masking PII", () => {
    const text = "Hello, my email is test@example.com and I like cats.";
    const result = maskPII(text);
    expect(result.maskedText).toBe(
      "Hello, my email is [EMAIL_REDACTED] and I like cats.",
    );
  });

  it("handles empty string", () => {
    const result = maskPII("");
    expect(result.maskedText).toBe("");
    expect(result.detections).toHaveLength(0);
  });

  it("handles text with special characters but no PII", () => {
    const text = "Revenue was $1.5M (up 25%) — great Q4!";
    const result = maskPII(text);
    expect(result.maskedText).toBe(text);
    expect(result.detections).toHaveLength(0);
  });
});

// ─── Overlapping / Adjacent Patterns ────────────────────────────────────────

describe("maskPII – overlapping patterns", () => {
  it("masks multiple PII types in the same text", () => {
    const text =
      "Email alice@test.com, phone 555-123-4567, SSN 123-45-6789.";
    const result = maskPII(text);

    expect(result.maskedText).toContain("[EMAIL_REDACTED]");
    expect(result.maskedText).toContain("[PHONE_REDACTED]");
    expect(result.maskedText).toContain("[SSN_REDACTED]");
    expect(result.detections).toHaveLength(3);
  });

  it("handles PII values adjacent to each other", () => {
    const text = "alice@test.com 555-123-4567";
    const result = maskPII(text);
    expect(result.maskedText).toBe("[EMAIL_REDACTED] [PHONE_REDACTED]");
  });

  it("correctly detects all types present", () => {
    const text = [
      "Email: user@example.com",
      "Phone: (800) 555-0199",
      "SSN: 999-88-7777",
      "Card: 4111-1111-1111-1111",
      "IP: 10.20.30.40",
      "DOB: 06/15/1985",
    ].join(", ");

    const result = maskPII(text);
    const types = new Set(result.detections.map((d) => d.type));

    expect(types).toContain("email");
    expect(types).toContain("phone");
    expect(types).toContain("ssn");
    expect(types).toContain("credit_card");
    expect(types).toContain("ip_address");
    expect(types).toContain("date_of_birth");
  });

  it("SSN regex may also trigger phone regex for 9-digit sequences", () => {
    // SSN "123-45-6789" — the SSN pattern matches first, but the phone regex
    // can also match the last 10 chars. This documents the current behavior.
    const text = "SSN: 123-45-6789";
    const result = maskPII(text);
    const ssnDetections = result.detections.filter((d) => d.type === "ssn");
    expect(ssnDetections.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Detection Metadata ─────────────────────────────────────────────────────

describe("maskPII – detection metadata", () => {
  it("provides correct startIndex and endIndex", () => {
    const text = "Email: test@example.com";
    const result = maskPII(text);
    const detection = result.detections.find((d) => d.type === "email");

    expect(detection).toBeDefined();
    expect(detection!.startIndex).toBe(7);
    expect(detection!.endIndex).toBe(23);
    expect(text.slice(detection!.startIndex, detection!.endIndex)).toBe(
      "test@example.com",
    );
  });

  it("stores the original value in each detection", () => {
    const result = maskPII("Phone: (555) 867-5309");
    const detection = result.detections.find((d) => d.type === "phone");
    expect(detection!.original).toBe("(555) 867-5309");
  });
});

// ─── maskTranscriptChunks (Batch) ───────────────────────────────────────────

describe("maskTranscriptChunks", () => {
  it("masks PII across multiple chunks", () => {
    const chunks = [
      "Contact alice@example.com for info.",
      "Call 555-123-4567 to schedule.",
      "No PII here.",
    ];

    const { maskedChunks, allDetections } = maskTranscriptChunks(chunks);

    expect(maskedChunks).toHaveLength(3);
    expect(maskedChunks[0]).toContain("[EMAIL_REDACTED]");
    expect(maskedChunks[1]).toContain("[PHONE_REDACTED]");
    expect(maskedChunks[2]).toBe("No PII here.");
    expect(allDetections).toHaveLength(2);
  });

  it("returns empty arrays for empty input", () => {
    const { maskedChunks, allDetections } = maskTranscriptChunks([]);
    expect(maskedChunks).toEqual([]);
    expect(allDetections).toEqual([]);
  });

  it("aggregates detections from all chunks", () => {
    const chunks = [
      "SSN: 111-22-3333",
      "Card: 4111-1111-1111-1111",
      "IP: 8.8.8.8",
    ];
    const { allDetections } = maskTranscriptChunks(chunks);
    const types = allDetections.map((d) => d.type);
    expect(types).toContain("ssn");
    expect(types).toContain("credit_card");
    expect(types).toContain("ip_address");
  });

  it("preserves chunk order", () => {
    const chunks = ["first chunk user@a.com", "second chunk 555-000-1234"];
    const { maskedChunks } = maskTranscriptChunks(chunks);
    expect(maskedChunks[0]).toMatch(/^first chunk/);
    expect(maskedChunks[1]).toMatch(/^second chunk/);
  });
});

// ─── containsPII ────────────────────────────────────────────────────────────

describe("containsPII", () => {
  it("returns true when email is present", () => {
    expect(containsPII("send to foo@bar.com")).toBe(true);
  });

  it("returns true when phone is present", () => {
    expect(containsPII("call 555-123-4567")).toBe(true);
  });

  it("returns true when SSN is present", () => {
    expect(containsPII("SSN 123-45-6789")).toBe(true);
  });

  it("returns true when credit card is present", () => {
    expect(containsPII("card 4111111111111111")).toBe(true);
  });

  it("returns true when IP address is present", () => {
    expect(containsPII("server 192.168.0.1")).toBe(true);
  });

  it("returns true when DOB pattern is present", () => {
    expect(containsPII("date of birth: 01/01/2000")).toBe(true);
  });

  it("returns false for clean text", () => {
    expect(containsPII("Just a normal business meeting summary.")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(containsPII("")).toBe(false);
  });

  it("returns false for text with numbers that are not PII", () => {
    expect(containsPII("Revenue was $42,000 in Q3 2024.")).toBe(false);
  });

  it("is consistent with maskPII detections", () => {
    const texts = [
      "email: a@b.com",
      "no pii here",
      "DOB: 05/12/1990",
      "",
      "IP: 1.2.3.4",
    ];
    for (const text of texts) {
      const hasPII = containsPII(text);
      const { detections } = maskPII(text);
      expect(hasPII).toBe(detections.length > 0);
    }
  });
});

// ─── Idempotency / Stability ────────────────────────────────────────────────

describe("maskPII – stability", () => {
  it("calling maskPII twice on the same input yields the same result", () => {
    const text = "My email is me@test.com and SSN is 111-22-3333.";
    const first = maskPII(text);
    const second = maskPII(text);
    expect(first.maskedText).toBe(second.maskedText);
    expect(first.detections).toEqual(second.detections);
  });

  it("masking already-masked text does not double-mask", () => {
    const text = "Email: user@example.com";
    const firstPass = maskPII(text);
    const secondPass = maskPII(firstPass.maskedText);
    // The redaction tag itself should not be detected as PII
    expect(secondPass.maskedText).toBe(firstPass.maskedText);
    expect(secondPass.detections).toHaveLength(0);
  });
});
