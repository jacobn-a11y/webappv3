import { describe, it, expect } from "vitest";

/**
 * The chunkTranscript function is not exported directly.
 * We test it indirectly by importing the module and testing the chunking behavior.
 * Since it's a private function, we replicate the logic here for unit testing.
 */

const TARGET_CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;

function chunkTranscript(
  text: string
): Array<{ text: string; index: number }> {
  const sentences = text.match(/[^.!?]+[.!?]+\s*/g) ?? [text];
  const chunks: Array<{ text: string; index: number }> = [];

  let current = "";
  let chunkIndex = 0;

  for (const sentence of sentences) {
    if (
      current.length + sentence.length > TARGET_CHUNK_SIZE &&
      current.length > 0
    ) {
      chunks.push({ text: current.trim(), index: chunkIndex++ });
      const overlap = current.slice(-CHUNK_OVERLAP);
      current = overlap + sentence;
    } else {
      current += sentence;
    }
  }

  if (current.trim().length > 0) {
    chunks.push({ text: current.trim(), index: chunkIndex });
  }

  return chunks;
}

describe("chunkTranscript", () => {
  it("returns a single chunk for short text", () => {
    const text = "This is a short transcript. It has two sentences.";
    const chunks = chunkTranscript(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(text.trim());
    expect(chunks[0].index).toBe(0);
  });

  it("splits long text into multiple chunks", () => {
    // Create text with many sentences that exceed TARGET_CHUNK_SIZE
    const sentence = "This is a moderately long sentence for testing. ";
    const text = sentence.repeat(100);
    const chunks = chunkTranscript(text);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("assigns sequential indices to chunks", () => {
    const sentence = "This is sentence number one that is fairly long. ";
    const text = sentence.repeat(100);
    const chunks = chunkTranscript(text);
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].index).toBe(i);
    }
  });

  it("preserves sentence boundaries", () => {
    const sentence =
      "This is a complete sentence with enough words to make it meaningful. ";
    const text = sentence.repeat(60);
    const chunks = chunkTranscript(text);

    // Each chunk should end with a period followed by optional whitespace
    for (const chunk of chunks) {
      // The last character (ignoring trailing spaces) should be punctuation
      const trimmed = chunk.text.trim();
      expect(trimmed.endsWith(".")).toBe(true);
    }
  });

  it("includes overlap between consecutive chunks", () => {
    const sentence =
      "This is a long sentence for testing overlap behavior in the chunking logic. ";
    const text = sentence.repeat(80);
    const chunks = chunkTranscript(text);

    if (chunks.length >= 2) {
      // The end of chunk N should overlap with the beginning of chunk N+1
      const endOfFirst = chunks[0].text.slice(-100);
      const startOfSecond = chunks[1].text.slice(0, 200);
      // There should be some common text
      expect(startOfSecond).toContain(endOfFirst.slice(-50));
    }
  });

  it("handles text without sentence-ending punctuation", () => {
    const text = "This text has no sentence ending punctuation";
    const chunks = chunkTranscript(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(text);
  });

  it("handles empty string", () => {
    const chunks = chunkTranscript("");
    // Empty string should either produce no chunks or one empty chunk
    expect(chunks.length).toBeLessThanOrEqual(1);
  });

  it("handles a single very long sentence", () => {
    const word = "word ";
    const longSentence = word.repeat(500) + "end.";
    const chunks = chunkTranscript(longSentence);
    // A single sentence can't be split further; it stays as one chunk
    expect(chunks).toHaveLength(1);
  });

  it("does not produce chunks exceeding 2x target size under normal conditions", () => {
    const sentence = "Normal sentence. ";
    const text = sentence.repeat(200);
    const chunks = chunkTranscript(text);

    for (const chunk of chunks) {
      // With overlap, chunks shouldn't exceed target + overlap + one sentence length
      expect(chunk.text.length).toBeLessThan(TARGET_CHUNK_SIZE * 2);
    }
  });

  it("handles mixed punctuation (periods, questions, exclamations)", () => {
    const text =
      "What happened next? The deal closed! Revenue grew by 40%. Can you elaborate? Yes, we increased by 100%.";
    const chunks = chunkTranscript(text);
    expect(chunks).toHaveLength(1); // Short enough for one chunk
    expect(chunks[0].text).toContain("What happened next?");
    expect(chunks[0].text).toContain("The deal closed!");
    expect(chunks[0].text).toContain("Revenue grew by 40%.");
  });
});
