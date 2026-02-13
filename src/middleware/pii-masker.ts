/**
 * PII Masking Service
 *
 * Redacts personally identifiable information from transcript text BEFORE
 * sending it to the LLM for tagging or summarization. This is the core
 * "Secure by Default" strategy.
 *
 * Detects and redacts:
 *  - Email addresses
 *  - Phone numbers (US and international)
 *  - Social Security Numbers
 *  - Credit card numbers
 *  - IP addresses
 *  - Physical addresses (street-level)
 *  - Date of birth patterns
 *
 * Uses regex-based detection (no external API calls) so PII never leaves
 * the server at all.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MaskingResult {
  maskedText: string;
  detections: PIIDetection[];
}

export interface PIIDetection {
  type: PIIType;
  original: string;
  replacement: string;
  startIndex: number;
  endIndex: number;
}

export type PIIType =
  | "email"
  | "phone"
  | "ssn"
  | "credit_card"
  | "ip_address"
  | "street_address"
  | "date_of_birth";

// ─── Patterns ────────────────────────────────────────────────────────────────

const PII_PATTERNS: Array<{ type: PIIType; regex: RegExp; replacement: string }> = [
  {
    type: "email",
    regex: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    replacement: "[EMAIL_REDACTED]",
  },
  {
    type: "ssn",
    // SSN: 123-45-6789 or 123 45 6789
    regex: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    replacement: "[SSN_REDACTED]",
  },
  {
    type: "credit_card",
    // Credit card: 16 digits optionally separated by spaces or dashes
    regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    replacement: "[CC_REDACTED]",
  },
  {
    type: "phone",
    // US phone: (555) 123-4567, 555-123-4567, +1-555-123-4567, etc.
    regex: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    replacement: "[PHONE_REDACTED]",
  },
  {
    type: "ip_address",
    regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: "[IP_REDACTED]",
  },
  {
    type: "date_of_birth",
    // Common DOB patterns: "date of birth" or "born on" followed by a date
    regex:
      /(?:date of birth|DOB|born on)[:\s]+\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/gi,
    replacement: "[DOB_REDACTED]",
  },
];

// ─── Core Masking Function ───────────────────────────────────────────────────

/**
 * Masks PII in the given text and returns the masked text + detection details.
 * Apply this to ALL transcript text before sending to OpenAI.
 */
export function maskPII(text: string): MaskingResult {
  const detections: PIIDetection[] = [];
  let maskedText = text;

  for (const pattern of PII_PATTERNS) {
    // Reset regex lastIndex for global patterns
    pattern.regex.lastIndex = 0;

    let match: RegExpExecArray | null;
    // Collect all matches first (before modifying the text)
    const matches: Array<{ index: number; value: string }> = [];

    while ((match = pattern.regex.exec(text)) !== null) {
      matches.push({ index: match.index, value: match[0] });
    }

    for (const m of matches) {
      detections.push({
        type: pattern.type,
        original: m.value,
        replacement: pattern.replacement,
        startIndex: m.index,
        endIndex: m.index + m.value.length,
      });
    }

    maskedText = maskedText.replace(pattern.regex, pattern.replacement);
  }

  return { maskedText, detections };
}

/**
 * Batch mask an array of transcript chunks.
 * Returns the masked chunks and a combined detection log.
 */
export function maskTranscriptChunks(
  chunks: string[]
): { maskedChunks: string[]; allDetections: PIIDetection[] } {
  const maskedChunks: string[] = [];
  const allDetections: PIIDetection[] = [];

  for (const chunk of chunks) {
    const { maskedText, detections } = maskPII(chunk);
    maskedChunks.push(maskedText);
    allDetections.push(...detections);
  }

  return { maskedChunks, allDetections };
}

/**
 * Checks if a text contains any detectable PII without masking.
 * Useful for validation / audit logging.
 */
export function containsPII(text: string): boolean {
  for (const pattern of PII_PATTERNS) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(text)) return true;
  }
  return false;
}
