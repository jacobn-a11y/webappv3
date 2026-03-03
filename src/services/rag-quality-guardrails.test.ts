import { describe, expect, it } from "vitest";
import {
  ensureGroundedCitations,
  filterGroundedSources,
  hasSourceCitation,
} from "./rag-quality-guardrails.js";

describe("rag-quality-guardrails", () => {
  it("filters low-relevance sources below threshold", () => {
    const filtered = filterGroundedSources(
      [
        {
          chunkId: "c1",
          callId: "call-1",
          callTitle: "Call 1",
          callDate: "2026-03-01",
          text: "high relevance",
          speaker: "Rep",
          relevanceScore: 0.9,
        },
        {
          chunkId: "c2",
          callId: "call-2",
          callTitle: "Call 2",
          callDate: "2026-03-01",
          text: "low relevance",
          speaker: "Rep",
          relevanceScore: 0.3,
        },
      ],
      0.55
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.chunkId).toBe("c1");
  });

  it("detects existing source citations", () => {
    expect(hasSourceCitation("The result improved by 20% [Source 1].")).toBe(true);
    expect(hasSourceCitation("No citation here.")).toBe(false);
  });

  it("appends source citations when missing", () => {
    const answer = ensureGroundedCitations("Revenue improved after onboarding.", 2);
    expect(answer).toContain("Sources:");
    expect(answer).toContain("[Source 1]");
    expect(answer).toContain("[Source 2]");
  });

  it("does not append duplicate citation blocks", () => {
    const answer = ensureGroundedCitations(
      "Revenue improved after onboarding [Source 1].",
      2
    );
    expect(answer).toBe("Revenue improved after onboarding [Source 1].");
  });
});
