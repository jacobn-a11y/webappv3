# RAG Quality Guardrails

Date: March 3, 2026

## Goal

Prevent relevance/grounding regressions while optimizing performance.

## Runtime Guardrails

- Minimum relevance filter:
  - `RAG_MIN_RELEVANCE_SCORE` (default `0.55`)
  - Sources below threshold are excluded before answer generation.
- Grounding fallback:
  - If no source survives relevance filtering, API returns a "no sufficiently relevant evidence" response.
- Citation enforcement:
  - If generated answer lacks `[Source N]` references, citations are appended automatically using returned sources.

## Files

- Guardrail logic: `src/services/rag-quality-guardrails.ts`
- RAG runtime integration: `src/services/rag-engine.ts`
- Guardrail tests: `src/services/rag-quality-guardrails.test.ts`

## Validation

- Unit tests cover:
  - low-relevance filtering
  - citation detection
  - citation auto-append
  - duplicate-citation prevention
