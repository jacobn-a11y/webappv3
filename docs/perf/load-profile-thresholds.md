# Sustained Load Profiles: Thresholds And Failure Behavior

Date: March 3, 2026

Configuration source:
- `scripts/perf/load-profile.config.json`

Execution:
- `npm run perf:load`

## Profiles

- `dashboard-sustained`
  - Weighted traffic across:
    - `GET /api/dashboard/home`
    - `GET /api/analytics`
    - `GET /api/dashboard/ops/diagnostics`
- `story-sustained`
  - Weighted traffic across:
    - `POST /api/stories/build`
    - `GET /api/stories/library`

## Published Thresholds

- Global p95 budget: `750ms`
- Global p99 budget: `1500ms`
- Max failure rate per profile: `5%`

## Failure Behavior

- Abort-status set: `500`, `502`, `503`, `504`
- If abort-statuses occur consecutively for `15` requests, profile run is marked aborted and fails.
- Non-2xx statuses count as failures unless explicitly allowed (`401`, `402`, `403`) for unauthenticated/stubbed runs.
- Any of the following fails the run:
  - profile aborted due to repeated abort-statuses
  - p95 above threshold
  - p99 above threshold
  - failure rate above threshold
