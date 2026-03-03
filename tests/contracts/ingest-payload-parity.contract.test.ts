import { describe, expect, it } from "vitest";
import {
  EXPORTER4_REQUIRED_INGEST_FIELDS,
  ProcessCallIngestPayloadSchema,
  parseProcessCallIngestPayload,
} from "../../src/contracts/process-call-ingest-payload.js";

describe("ingest payload parity contract", () => {
  it("preserves Exporter 4 required field set", () => {
    expect(EXPORTER4_REQUIRED_INGEST_FIELDS).toEqual([
      "callId",
      "organizationId",
      "accountId",
      "hasTranscript",
    ]);
  });

  it("accepts canonical ingest payload shape", () => {
    const payload = parseProcessCallIngestPayload({
      callId: "call_123",
      organizationId: "org_123",
      accountId: "acct_123",
      hasTranscript: true,
    });

    expect(payload).toEqual({
      callId: "call_123",
      organizationId: "org_123",
      accountId: "acct_123",
      hasTranscript: true,
    });
  });

  it("allows null accountId for unresolved ingest", () => {
    const payload = parseProcessCallIngestPayload({
      callId: "call_456",
      organizationId: "org_456",
      accountId: null,
      hasTranscript: false,
    });

    expect(payload.accountId).toBeNull();
  });

  it("rejects payloads missing required fields", () => {
    const result = ProcessCallIngestPayloadSchema.safeParse({
      callId: "call_789",
      organizationId: "org_789",
    });
    expect(result.success).toBe(false);
  });
});
