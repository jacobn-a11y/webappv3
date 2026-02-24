# Call-Processing Dead-Letter Runbook

This runbook defines operator actions for `call-processing` BullMQ failed jobs.

## Scope

- Queue: `call-processing`
- Job: `process-call`
- Failure bucket: BullMQ `failed` jobs after configured attempts are exhausted.

## Failure Classes

- Auto-replay eligible:
  - transient provider/server errors (`5xx`, `service unavailable`, `gateway timeout`)
  - rate limits (`429`, `rate limit`, `quota exceeded`)
  - infrastructure/network issues (`redis`, `timeout`, `connection reset`)
- Manual-review required:
  - validation/schema failures
  - data corruption/unsupported payloads
  - explicit non-retryable business logic errors

## Automated Replay Policy

- Scheduler: `CALL_PROCESSING_DEAD_LETTER_AUTO_REPLAY_CRON` (default `*/10 * * * *`, UTC)
- Batch cap: `CALL_PROCESSING_DEAD_LETTER_REPLAY_BATCH_SIZE` (default `50`, max `200`)
- Disable switch: `CALL_PROCESSING_DEAD_LETTER_AUTO_REPLAY_ENABLED=false`
- Idempotency guard: replay retries failed jobs directly (`job.retry()`), so already-retried jobs are removed from failed state and are not replayed again on subsequent runs.

## Operator Diagnostics

1. Check queue counts and enqueue diagnostics:
   - `GET /api/admin/queues`
   - `GET /api/admin/metrics`
2. Inspect failed jobs in Redis/BullMQ tooling for root-cause patterns.
3. Confirm audit evidence exists for replay actions under category `QUEUE`.

## Manual Replay Procedure

Use this only when immediate replay is needed before the next scheduled run.

1. Trigger bounded replay for the authenticated org:
   - `POST /api/admin/queues/call-processing/dead-letter/replay`
   - optional body: `{ "limit": 25 }`
2. Verify response:
   - `replayed` > 0 means jobs were moved back to waiting
   - `skipped.non_retryable` indicates manual triage is still needed
3. Validate downstream recovery:
   - queue `failed` count trends down
   - transcript/story processing resumes
   - no repeated failures for the same call IDs

## Escalation

- If replayed jobs fail repeatedly with the same error:
  - pause auto replay via env flag
  - raise incident and assign engineering owner
  - capture example call IDs + failed reasons + timestamps
- If Redis instability is suspected:
  - validate Redis health/latency
  - verify worker availability and restarts
  - resume auto replay after infrastructure stabilizes
