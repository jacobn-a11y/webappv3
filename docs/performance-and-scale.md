# Performance And Scale Controls

## Caching Strategy
- Hot read endpoints use short-lived in-memory TTL caches (`30s`) for:
  - `GET /api/dashboard/home`
  - `GET /api/analytics`
  - `GET /api/analytics/revops-kpis`
- Invalidation policy:
  - Time-based expiry only (TTL) to avoid stale long-lived cache risk.
  - Cache keys are tenant-aware and include user context where required.

## Pagination And Export Limits
Standardized limit bounds:
- List endpoints: default `100`, max `200`
- Integration ops lists: default `100`, max `500`
- Search endpoints: default `20`, max `50`
- Export endpoints: default `5000`, max `10000`

## Query/Index Optimizations
Existing indexes for heavy read paths:
- `stories(organizationId, accountId)`, `stories(organizationId, generatedById)`
- `high_value_quotes(storyId)`, `high_value_quotes(storyId, tier, createdAt)`
- `transcript_chunks(transcriptId, chunkIndex)` (unique)
- `landing_pages(organizationId, status)`, `landing_pages(slug)`
- `integration_runs(organizationId, provider, startedAt)`, `integration_runs(organizationId, status, startedAt)`

## Vector Retention Controls
- Data retention sweep now prunes stale Pinecone vectors before deleting old records.
- Enforcement path:
  - `src/services/data-retention.ts` runs org retention policy and calls `ragEngine.pruneVectors(...)`.
  - `src/services/rag-engine.ts` deletes vectors in bounded batches and clears `embeddingId` links.
- Runtime controls:
  - `RAG_VECTOR_RETENTION_DELETE_LIMIT` (default `1000`) caps vectors removed per org sweep run.
  - Existing retention policy window (`retention_days`) determines age cutoff.
- Safety behavior:
  - Vector deletions are scoped by `organizationId`.
  - Deletions run in batches to avoid large one-shot API calls.

## Perf Budgets
Budgets in `scripts/perf/perf-budget.config.json`:
- Main frontend JS max: `920KB`
- Main frontend CSS max: `126KB`
- Endpoint latency budgets (CI-enforced via `tests/perf-endpoint-load-budget.test.ts`):
  - `POST /api/rag/query`: p95 `250ms`, p99 `450ms`
  - `POST /api/rag/chat`: p95 `250ms`, p99 `450ms`
  - `POST /api/stories/build`: p95 `300ms`, p99 `550ms`
- Sustained load threshold budgets:
  - p95: `750ms`
  - p99: `1500ms`
  - max failure rate: `5%`

## Tooling
- `npm run perf:budget`
  - Validates built frontend bundle sizes and endpoint p95/p99 budgets.
- `npm run perf:load`
  - Runs sustained load profiles (`dashboard-sustained`, `story-sustained`) and checks p95/p99 and failure-rate thresholds.
  - Profile config source: `scripts/perf/load-profile.config.json`.
