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
 * Uses deterministic local detection (regex + contextual heuristics)
 * so PII never leaves the server.
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
  | "date_of_birth"
  | "person_name"
  | "account_identifier";

// ─── Patterns ────────────────────────────────────────────────────────────────

const PII_PATTERNS: Array<{
  type: Extract<
    PIIType,
    | "email"
    | "phone"
    | "ssn"
    | "credit_card"
    | "ip_address"
    | "street_address"
    | "date_of_birth"
  >;
  regex: RegExp;
  replacement: string;
  priority: number;
}> = [
  {
    type: "email",
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: "[EMAIL_REDACTED]",
    priority: 120,
  },
  {
    type: "ssn",
    // SSN: 123-45-6789 or 123 45 6789 (with consistent delimiters and valid ranges)
    regex: /\b(?!000|666|9\d{2})\d{3}([-\s])(?!00)\d{2}\1(?!0000)\d{4}\b/g,
    replacement: "[SSN_REDACTED]",
    priority: 115,
  },
  {
    type: "credit_card",
    // Credit card: 16 digits optionally separated by spaces or dashes
    regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    replacement: "[CC_REDACTED]",
    priority: 110,
  },
  {
    type: "phone",
    // US phone: (555) 123-4567, 555-123-4567, +1-555-123-4567, etc.
    regex: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    replacement: "[PHONE_REDACTED]",
    priority: 100,
  },
  {
    type: "ip_address",
    regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: "[IP_REDACTED]",
    priority: 95,
  },
  {
    type: "street_address",
    regex:
      /\b\d{1,6}\s+[A-Za-z0-9.\-'\s]{2,40}\s(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl)\b(?:,\s*[A-Za-z .'-]{2,30})?(?:,\s*[A-Z]{2})?(?:\s+\d{5}(?:-\d{4})?)?/gi,
    replacement: "[ADDRESS_REDACTED]",
    priority: 92,
  },
  {
    type: "date_of_birth",
    // Common DOB patterns: "date of birth" or "born on" followed by a date
    regex:
      /(?:date of birth|DOB|born on)[:\s]+\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/gi,
    replacement: "[DOB_REDACTED]",
    priority: 90,
  },
];

// ─── Core Masking Function ───────────────────────────────────────────────────

/**
 * Masks PII in the given text and returns the masked text + detection details.
 * Apply this to ALL transcript text before sending to OpenAI.
 */
export function maskPII(text: string): MaskingResult {
  const detections = collectPIIDetections(text);
  if (detections.length === 0) {
    return { maskedText: text, detections: [] };
  }

  let maskedText = text;
  const descending = [...detections].sort((a, b) => b.startIndex - a.startIndex);
  for (const detection of descending) {
    maskedText =
      maskedText.slice(0, detection.startIndex) +
      detection.replacement +
      maskedText.slice(detection.endIndex);
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
  return collectPIIDetections(text).length > 0;
}

interface DetectionCandidate extends PIIDetection {
  priority: number;
}

function collectPIIDetections(text: string): PIIDetection[] {
  const candidates: DetectionCandidate[] = [
    ...collectRegexCandidates(text),
    ...collectHeuristicCandidates(text),
  ];
  if (candidates.length === 0) return [];

  // Highest-confidence candidates win; overlap is collapsed to one detection.
  const prioritized = [...candidates].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const aLen = a.endIndex - a.startIndex;
    const bLen = b.endIndex - b.startIndex;
    if (bLen !== aLen) return bLen - aLen;
    return a.startIndex - b.startIndex;
  });

  const selected: DetectionCandidate[] = [];
  for (const candidate of prioritized) {
    const overlaps = selected.some((existing) =>
      rangesOverlap(
        candidate.startIndex,
        candidate.endIndex,
        existing.startIndex,
        existing.endIndex
      )
    );
    if (!overlaps) {
      selected.push(candidate);
    }
  }

  return selected
    .sort((a, b) => a.startIndex - b.startIndex)
    .map(({ priority: _priority, ...detection }) => detection);
}

function collectRegexCandidates(text: string): DetectionCandidate[] {
  const detections: DetectionCandidate[] = [];
  for (const pattern of PII_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(text)) !== null) {
      const value = match[0];
      detections.push({
        type: pattern.type,
        original: value,
        replacement: pattern.replacement,
        startIndex: match.index,
        endIndex: match.index + value.length,
        priority: pattern.priority,
      });
    }
  }
  return detections;
}

function collectHeuristicCandidates(text: string): DetectionCandidate[] {
  const detections: DetectionCandidate[] = [];

  const nameRegex =
    /\b(?:my name is|name is|this is|i am|i'm|spoke with|met with|contact is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/gi;
  let nameMatch: RegExpExecArray | null;
  while ((nameMatch = nameRegex.exec(text)) !== null) {
    const full = nameMatch[0];
    const captured = nameMatch[1];
    if (!captured) continue;
    const start = nameMatch.index + full.indexOf(captured);
    detections.push({
      type: "person_name",
      original: captured,
      replacement: "[NAME_REDACTED]",
      startIndex: start,
      endIndex: start + captured.length,
      priority: 86,
    });
  }

  const idRegex =
    /\b(?:customer|employee|member|account|case|ticket)\s*(?:id|identifier)[:#\s-]*([A-Z0-9][A-Z0-9\-]{5,})\b/gi;
  let idMatch: RegExpExecArray | null;
  while ((idMatch = idRegex.exec(text)) !== null) {
    const full = idMatch[0];
    const captured = idMatch[1];
    if (!captured) continue;
    const start = idMatch.index + full.toLowerCase().lastIndexOf(captured.toLowerCase());
    detections.push({
      type: "account_identifier",
      original: captured,
      replacement: "[ID_REDACTED]",
      startIndex: start,
      endIndex: start + captured.length,
      priority: 84,
    });
  }

  return detections;
}

function rangesOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number
): boolean {
  return startA < endB && startB < endA;
}
