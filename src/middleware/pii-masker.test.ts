/**
 * PII Masker Security Tests
 *
 * Validates that all PII types are properly detected and redacted
 * before transcript data is sent to external services (OpenAI, Pinecone).
 * This is critical for protecting customer call recording data.
 */

import { describe, it, expect } from "vitest";
import { maskPII, maskTranscriptChunks, containsPII } from "./pii-masker.js";

describe("PII Masker", () => {
  describe("maskPII", () => {
    it("should redact email addresses", () => {
      const input = "Contact john.doe@example.com for more details";
      const result = maskPII(input);
      expect(result.maskedText).toBe(
        "Contact [EMAIL_REDACTED] for more details"
      );
      expect(result.detections).toHaveLength(1);
      expect(result.detections[0].type).toBe("email");
      expect(result.detections[0].original).toBe("john.doe@example.com");
    });

    it("should redact multiple email addresses", () => {
      const input = "Send to alice@corp.io and bob@test.org";
      const result = maskPII(input);
      expect(result.maskedText).toBe(
        "Send to [EMAIL_REDACTED] and [EMAIL_REDACTED]"
      );
      expect(result.detections).toHaveLength(2);
    });

    it("should redact SSNs with dashes", () => {
      const input = "My SSN is 123-45-6789";
      const result = maskPII(input);
      expect(result.maskedText).toBe("My SSN is [SSN_REDACTED]");
      expect(result.detections[0].type).toBe("ssn");
    });

    it("should redact SSNs with spaces", () => {
      const input = "SSN: 123 45 6789";
      const result = maskPII(input);
      expect(result.maskedText).toBe("SSN: [SSN_REDACTED]");
    });

    it("should redact credit card numbers", () => {
      const input = "Card: 4111-1111-1111-1111";
      const result = maskPII(input);
      expect(result.maskedText).toBe("Card: [CC_REDACTED]");
      expect(result.detections[0].type).toBe("credit_card");
    });

    it("should redact credit card numbers with spaces", () => {
      const input = "My card is 4111 1111 1111 1111";
      const result = maskPII(input);
      expect(result.maskedText).toBe("My card is [CC_REDACTED]");
    });

    it("should redact US phone numbers", () => {
      const input = "Call me at (555) 123-4567";
      const result = maskPII(input);
      expect(result.maskedText).toBe("Call me at [PHONE_REDACTED]");
      expect(result.detections[0].type).toBe("phone");
    });

    it("should redact international phone numbers", () => {
      const input = "Reach out at +1-555-123-4567";
      const result = maskPII(input);
      expect(result.maskedText).toBe("Reach out at [PHONE_REDACTED]");
    });

    it("should redact IP addresses", () => {
      const input = "Server at 192.168.1.100";
      const result = maskPII(input);
      expect(result.maskedText).toBe("Server at [IP_REDACTED]");
      expect(result.detections[0].type).toBe("ip_address");
    });

    it("should redact date of birth patterns", () => {
      const input = "date of birth: 03/15/1990";
      const result = maskPII(input);
      expect(result.maskedText).toBe("[DOB_REDACTED]");
      expect(result.detections[0].type).toBe("date_of_birth");
    });

    it("should redact 'born on' patterns", () => {
      const input = "born on 3/15/1990";
      const result = maskPII(input);
      expect(result.maskedText).toBe("[DOB_REDACTED]");
    });

    it("should handle multiple PII types in one text", () => {
      const input =
        "Email john@test.com, call (555) 123-4567, SSN 123-45-6789";
      const result = maskPII(input);
      expect(result.maskedText).not.toContain("john@test.com");
      expect(result.maskedText).not.toContain("555");
      expect(result.maskedText).not.toContain("123-45-6789");
      expect(result.detections.length).toBeGreaterThanOrEqual(3);
    });

    it("should return empty detections for clean text", () => {
      const input = "This is a normal business conversation about ROI";
      const result = maskPII(input);
      expect(result.maskedText).toBe(input);
      expect(result.detections).toHaveLength(0);
    });

    it("should preserve non-PII content unchanged", () => {
      const input =
        "We saw a 45% improvement in efficiency after implementing the solution";
      const result = maskPII(input);
      expect(result.maskedText).toBe(input);
    });
  });

  describe("maskTranscriptChunks", () => {
    it("should mask PII across multiple chunks", () => {
      const chunks = [
        "Contact john@test.com for info",
        "Call (555) 123-4567 to follow up",
        "No PII in this chunk",
      ];
      const result = maskTranscriptChunks(chunks);
      expect(result.maskedChunks[0]).toBe(
        "Contact [EMAIL_REDACTED] for info"
      );
      expect(result.maskedChunks[1]).toBe(
        "Call [PHONE_REDACTED] to follow up"
      );
      expect(result.maskedChunks[2]).toBe("No PII in this chunk");
      expect(result.allDetections.length).toBeGreaterThanOrEqual(2);
    });

    it("should handle empty chunk arrays", () => {
      const result = maskTranscriptChunks([]);
      expect(result.maskedChunks).toHaveLength(0);
      expect(result.allDetections).toHaveLength(0);
    });
  });

  describe("containsPII", () => {
    it("should detect emails", () => {
      expect(containsPII("john@test.com")).toBe(true);
    });

    it("should detect phone numbers", () => {
      expect(containsPII("Call (555) 123-4567")).toBe(true);
    });

    it("should detect SSNs", () => {
      expect(containsPII("SSN: 123-45-6789")).toBe(true);
    });

    it("should return false for clean text", () => {
      expect(containsPII("Normal business text")).toBe(false);
    });
  });
});
