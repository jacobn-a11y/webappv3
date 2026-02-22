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
Added indexes for heavy read paths:
- `stories(organizationId, generatedAt DESC)`
- `high_value_quotes(storyId, metricType)`
- `transcript_chunks(transcriptId, startMs)`
- `landing_pages(organizationId, updatedAt DESC)`
- `integration_runs(organizationId, runType, startedAt DESC)`

## Perf Budgets
Budgets in `scripts/perf/perf-budget.config.json`:
- Main frontend JS max: `850KB`
- Main frontend CSS max: `120KB`
- API latency budget for load profiles:
  - p95: `750ms`
  - p99: `1500ms`

## Tooling
- `npm run perf:budget`
  - Validates built frontend bundle sizes against configured budgets.
- `npm run perf:load`
  - Runs load profiles for tenant sizes (`100`, `500`, `2000`) and checks p95/p99 budgets.
