# Gong Ingest Payload Contract (Exporter 4 Parity)

This contract defines the required processing payload fields shared between Gong ingest flows and the call-processing queue.

## Required fields (Exporter 4)

1. `callId` (string): internal call identifier to process.
2. `organizationId` (string): tenant boundary for the call.
3. `accountId` (`string | null`): resolved account, nullable when unresolved.
4. `hasTranscript` (boolean): whether transcript text exists at enqueue time.

These fields are enforced by:
- `src/contracts/process-call-ingest-payload.ts` (runtime schema)
- `tests/contracts/ingest-payload-parity.contract.test.ts` (CI contract test)

## Producers covered by this contract

- `src/webhooks/gong-webhook.ts`
- `src/webhooks/merge-webhook.ts`
- `src/services/merge-api-client.ts`
- `src/services/transcript-fetcher.ts`
- `src/lib/queue-policy.ts` (enqueue-time runtime validation)

## Compatibility rule

Until roadmap task `T57` is complete:
- do not rename, remove, or change required field semantics
- only additive optional fields are allowed
- every contract change requires updating this doc and parity tests
