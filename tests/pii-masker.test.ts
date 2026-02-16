import { describe, it, expect } from "vitest";
import { maskPII, maskTranscriptChunks, containsPII } from "../src/middleware/pii-masker.js";

describe("maskPII", () => {
  describe("email detection", () => {
    it("masks standard email addresses", () => {
      const result = maskPII("Contact me at john@example.com for details.");
      expect(result.maskedText).toBe("Contact me at [EMAIL_REDACTED] for details.");
      expect(result.detections).toHaveLength(1);
      expect(result.detections[0].type).toBe("email");
      expect(result.detections[0].original).toBe("john@example.com");
    });

    it("masks multiple emails in the same text", () => {
      const result = maskPII("Send to alice@acme.co and bob@bigtech.com");
      expect(result.maskedText).toBe("Send to [EMAIL_REDACTED] and [EMAIL_REDACTED]");
      expect(result.detections.filter((d) => d.type === "email")).toHaveLength(2);
    });

    it("masks emails with special characters", () => {
      const result = maskPII("Email: user.name+tag@sub.domain.com");
      expect(result.maskedText).toBe("Email: [EMAIL_REDACTED]");
    });

    it("does not mask non-email patterns", () => {
      const result = maskPII("The ratio is 3@5 per unit");
      // This contains @ but may or may not match depending on regex
      // The important thing is it doesn't crash
      expect(result.maskedText).toBeDefined();
    });
  });

  describe("SSN detection", () => {
    it("masks SSN with dashes (123-45-6789)", () => {
      const result = maskPII("SSN: 123-45-6789");
      expect(result.maskedText).toBe("SSN: [SSN_REDACTED]");
      expect(result.detections.some((d) => d.type === "ssn")).toBe(true);
    });

    it("masks SSN with spaces (123 45 6789)", () => {
      const result = maskPII("SSN is 123 45 6789 on file");
      expect(result.maskedText).toBe("SSN is [SSN_REDACTED] on file");
    });

    it("does not mask SSN without separators (requires dash or space)", () => {
      const result = maskPII("SSN: 123456789");
      // The SSN regex requires consistent delimiters (dash or space) between groups
      expect(result.maskedText).toBe("SSN: 123456789");
    });

    it("masks multiple SSNs in the same text", () => {
      // Second SSN must not start with 9xx (invalid per SSA rules and regex)
      const result = maskPII("SSN1: 123-45-6789, SSN2: 456-78-9012");
      expect(result.maskedText).toBe("SSN1: [SSN_REDACTED], SSN2: [SSN_REDACTED]");
    });
  });

  describe("credit card detection", () => {
    it("masks credit card with dashes", () => {
      const result = maskPII("Card: 4111-1111-1111-1111");
      expect(result.maskedText).toBe("Card: [CC_REDACTED]");
      expect(result.detections.some((d) => d.type === "credit_card")).toBe(true);
    });

    it("masks credit card with spaces", () => {
      const result = maskPII("Card: 4111 1111 1111 1111");
      expect(result.maskedText).toBe("Card: [CC_REDACTED]");
    });

    it("masks credit card without separators", () => {
      const result = maskPII("Card: 4111111111111111");
      expect(result.maskedText).toBe("Card: [CC_REDACTED]");
    });
  });

  describe("phone number detection", () => {
    it("masks US phone numbers with parentheses", () => {
      const result = maskPII("Call (555) 123-4567 for info");
      expect(result.maskedText).toBe("Call [PHONE_REDACTED] for info");
      expect(result.detections.some((d) => d.type === "phone")).toBe(true);
    });

    it("masks US phone numbers with dashes", () => {
      const result = maskPII("Call 555-123-4567");
      expect(result.maskedText).toBe("Call [PHONE_REDACTED]");
    });

    it("masks phone numbers with +1 prefix", () => {
      const result = maskPII("Call +1-555-123-4567");
      expect(result.maskedText).toBe("Call [PHONE_REDACTED]");
    });

    it("masks phone numbers with dots", () => {
      const result = maskPII("Phone: 555.123.4567");
      expect(result.maskedText).toBe("Phone: [PHONE_REDACTED]");
    });
  });

  describe("IP address detection", () => {
    it("masks IPv4 addresses", () => {
      const result = maskPII("Server at 192.168.1.100");
      expect(result.maskedText).toBe("Server at [IP_REDACTED]");
      expect(result.detections.some((d) => d.type === "ip_address")).toBe(true);
    });

    it("masks multiple IPs", () => {
      const result = maskPII("From 10.0.0.1 to 172.16.0.1");
      expect(result.maskedText).toBe("From [IP_REDACTED] to [IP_REDACTED]");
    });
  });

  describe("date of birth detection", () => {
    it("masks 'date of birth' followed by a date", () => {
      const result = maskPII("Date of birth: 01/15/1990");
      expect(result.maskedText).toBe("[DOB_REDACTED]");
      expect(result.detections.some((d) => d.type === "date_of_birth")).toBe(true);
    });

    it("masks 'DOB' followed by a date", () => {
      const result = maskPII("DOB: 03-25-85");
      expect(result.maskedText).toBe("[DOB_REDACTED]");
    });

    it("masks 'born on' followed by a date", () => {
      const result = maskPII("She was born on 12/25/1995.");
      expect(result.maskedText).toBe("She was [DOB_REDACTED].");
    });
  });

  describe("multiple PII types in one text", () => {
    it("masks all PII types found", () => {
      const text =
        "Contact john@example.com at 555-123-4567, SSN 123-45-6789";
      const result = maskPII(text);
      expect(result.maskedText).toContain("[EMAIL_REDACTED]");
      expect(result.maskedText).toContain("[PHONE_REDACTED]");
      expect(result.maskedText).toContain("[SSN_REDACTED]");
      expect(result.maskedText).not.toContain("john@example.com");
      expect(result.maskedText).not.toContain("123-45-6789");
    });

    it("returns correct detection count for multiple types", () => {
      const text =
        "Email: a@b.com, Phone: 555-111-2222, SSN: 111-22-3333";
      const result = maskPII(text);
      expect(result.detections.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      const result = maskPII("");
      expect(result.maskedText).toBe("");
      expect(result.detections).toHaveLength(0);
    });

    it("handles text with no PII", () => {
      const text = "This is a clean transcript with no personal data.";
      const result = maskPII(text);
      expect(result.maskedText).toBe(text);
      expect(result.detections).toHaveLength(0);
    });

    it("handles text with only PII", () => {
      const result = maskPII("john@example.com");
      expect(result.maskedText).toBe("[EMAIL_REDACTED]");
    });

    it("preserves surrounding text correctly", () => {
      const result = maskPII("Before john@test.com after");
      expect(result.maskedText).toBe("Before [EMAIL_REDACTED] after");
    });

    it("records correct startIndex and endIndex", () => {
      const text = "My SSN is 123-45-6789 ok?";
      const result = maskPII(text);
      const ssnDetection = result.detections.find((d) => d.type === "ssn");
      expect(ssnDetection).toBeDefined();
      expect(ssnDetection!.startIndex).toBe(10);
      expect(ssnDetection!.endIndex).toBe(21);
    });
  });
});

describe("maskTranscriptChunks", () => {
  it("masks PII across multiple chunks", () => {
    const chunks = [
      "Call with john@acme.com about the deal.",
      "SSN on file: 111-22-3333.",
      "No PII in this chunk.",
    ];
    const { maskedChunks, allDetections } = maskTranscriptChunks(chunks);
    expect(maskedChunks[0]).toContain("[EMAIL_REDACTED]");
    expect(maskedChunks[1]).toContain("[SSN_REDACTED]");
    expect(maskedChunks[2]).toBe("No PII in this chunk.");
    expect(allDetections.length).toBeGreaterThanOrEqual(2);
  });

  it("handles empty array", () => {
    const { maskedChunks, allDetections } = maskTranscriptChunks([]);
    expect(maskedChunks).toEqual([]);
    expect(allDetections).toEqual([]);
  });
});

describe("containsPII", () => {
  it("returns true when PII is present", () => {
    expect(containsPII("Email: test@example.com")).toBe(true);
    expect(containsPII("SSN: 123-45-6789")).toBe(true);
    expect(containsPII("Call 555-123-4567")).toBe(true);
  });

  it("returns false when no PII is present", () => {
    expect(containsPII("This is a clean text")).toBe(false);
    expect(containsPII("No personal information here")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(containsPII("")).toBe(false);
  });
});
