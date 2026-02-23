# Phase 5 Security + Reliability Pass - 2026-02-23

Scope audited:

- `src/middleware/`
- `src/webhooks/`
- `src/queues.ts`
- logging standardization around `src/lib/logger.ts`

## High-Severity Findings and Fixes

1. IP allowlist spoofing risk in org security policy
- Finding: policy checks parsed `x-forwarded-for` directly, allowing header spoof bypass in non-trusted proxy environments.
- Fix: use Express `req.ip`/socket source of truth only.
- File: `src/middleware/security-policy.ts`

2. Merge webhook tenant resolution trusted payload org claim
- Finding: org routing used client payload `linked_account.organization`, enabling potential cross-tenant injection if a signed payload carried mismatched org metadata.
- Fix: resolve org from `linked_accounts.mergeLinkedAccountId` ownership and reject mismatched payload org claim.
- File: `src/webhooks/merge-webhook.ts`

3. Webhook processing queue lacked stable idempotency key
- Finding: duplicate webhook deliveries could enqueue duplicate `process-call` jobs.
- Fix: set stable `jobId` (`process-call:<callId>`) for Merge/Gong/Grain queue adds.
- Files:
  - `src/webhooks/merge-webhook.ts`
  - `src/webhooks/gong-webhook.ts`
  - `src/webhooks/grain-webhook.ts`

## Logging Standardization

Within audited scope, `console.*` usage was removed and standardized to `logger.ts`.

- Updated files:
  - `src/middleware/permissions.ts`
  - `src/middleware/api-usage-logger.ts`
  - `src/middleware/billing.ts`
  - `src/middleware/audit-logger.ts`
  - `src/webhooks/gong-webhook.ts`
  - `src/webhooks/grain-webhook.ts`

## Added Regression Tests

- `tests/unit/security-policy-ip.test.ts`
- `tests/unit/merge-webhook-security.test.ts`
- updated: `src/middleware/audit-logger.test.ts`

## Verification

- `npm run build`
- `npx vitest run src/middleware/audit-logger.test.ts tests/billing-handlers.test.ts tests/unit/security-policy-ip.test.ts tests/unit/webhook-signature-enforcement.test.ts tests/unit/merge-webhook-security.test.ts tests/unit/auth-middleware.test.ts tests/unit/session-auth.test.ts tests/unit/platform-routes.test.ts`
- `npm run test:security`
- `npm run test:reliability`
- `npm run test:release`

## Exit Status

No unresolved high-severity security/reliability findings remain in audited Phase 5 scope.
