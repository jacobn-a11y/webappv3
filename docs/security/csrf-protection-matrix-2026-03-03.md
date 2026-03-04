# CSRF Protection Matrix (Post-Refactor)

Date: March 3, 2026  
Owner: Platform Security

## Middleware placement verification

In `/src/app.ts`, `createCsrfProtection()` is mounted after:
- `createSessionAuth(prisma)`

and before:
- `/api/platform`
- `/api/setup`
- all authenticated app routes (`/api/billing`, `/api/keys`, `/api/rag`, `/api/stories`, `/api/pages`, `/api/dashboard`, `/api/admin/*`, `/api/merge`, `/api/integrations`, `/api/ai`, `/api/notifications`, `/api/analytics`, `/api/accounts`, `/api/account-journey`, `/api/account-merge`, `/chat`)

This confirms CSRF is evaluated before state-changing session-authenticated app endpoints.

## Enforcement rule (current)

`createCsrfProtection()` enforces CSRF only for non-safe methods when `x-session-token` is present:
- `x-csrf-token` must match `x-session-token`
- `Origin`/`Referer` (if provided) must be in allowlist (`CSRF_ALLOWED_ORIGINS`, `APP_URL`, `FRONTEND_URL`, localhost defaults)

## Explicitly unprotected surfaces

These routes are intentionally outside CSRF scope (signature/token/auth model differs):
- `/api/webhooks/*` (Stripe/Merge/Gong/Grain): webhook signature verification
- `/api/v1/rag/*`: API-key authentication for third-party callers
- `/api/auth/*`: public auth/session bootstrap
- `/api/scim/v2/*`: bearer-token SCIM provisioning
- `/api/health`, `/api/status/*`, `/s/:slug`: public/read-only surfaces

## Validation matrix rerun

Executed test suite:
- `npm run test:security`

CSRF-specific checks (from `tests/csrf-protection-middleware.test.ts`):
- Safe method (`GET`) without CSRF token: allowed
- Write with no session token: allowed (non-session clients)
- Write with session token + missing CSRF token: blocked (`403 csrf_validation_failed`)
- Write with matching session/CSRF token + trusted origin: allowed
- Write with matching tokens + untrusted origin: blocked (`403 csrf_origin_rejected`)

Result: matrix passed after route refactors; no regressions detected in CSRF gate behavior.
