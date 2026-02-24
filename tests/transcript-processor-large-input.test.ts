import { describe, expect, it } from "vitest";
import { chunkTranscript } from "../src/services/transcript-processor.js";

describe("transcript-processor large transcript handling", () => {
  it("chunks very large transcripts into bounded non-empty segments", () => {
    const sentence =
      "Customer reported a 37 percent drop in onboarding time after rollout. ";
    const largeTranscript = sentence.repeat(60_000); // ~4MB text

    const chunks = chunkTranscript(largeTranscript);

    expect(chunks.length).toBeGreaterThan(100);
    expect(chunks.every((chunk) => chunk.text.trim().length > 0)).toBe(true);
    expect(chunks.every((chunk) => chunk.text.length <= 1_800)).toBe(true);
  });

  it("handles long punctuation-free text without dropping content", () => {
    const raw = "word ".repeat(20_000);
    const chunks = chunkTranscript(raw);

    const reconstructed = chunks.map((chunk) => chunk.text).join(" ");
    expect(chunks.length).toBeGreaterThan(0);
    expect(reconstructed.length).toBeGreaterThan(raw.length * 0.8);
  });
});
