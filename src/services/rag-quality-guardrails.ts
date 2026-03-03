import type { RAGSource } from "./rag-engine.js";

const SOURCE_CITATION_PATTERN = /\[Source\s+\d+\]/i;

export function filterGroundedSources(
  sources: RAGSource[],
  minRelevanceScore: number
): RAGSource[] {
  if (sources.length === 0) return [];
  const threshold = Number.isFinite(minRelevanceScore)
    ? Math.min(1, Math.max(0, minRelevanceScore))
    : 0.55;
  return sources.filter((source) => source.relevanceScore >= threshold);
}

export function hasSourceCitation(answer: string): boolean {
  return SOURCE_CITATION_PATTERN.test(answer);
}

export function ensureGroundedCitations(
  answer: string,
  sourceCount: number
): string {
  if (sourceCount <= 0) return answer;
  if (hasSourceCitation(answer)) return answer;
  const refs = Array.from({ length: sourceCount }, (_, index) => `[Source ${index + 1}]`);
  return `${answer}\n\nSources: ${refs.join(", ")}`;
}
