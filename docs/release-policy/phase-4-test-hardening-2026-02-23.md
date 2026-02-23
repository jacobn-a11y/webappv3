# Phase 4 Test Hardening - 2026-02-23

Scope hardened first: auth, permissions, billing, publish flow, platform routes.

## Release Suite

- Config: `vitest.release.config.ts`
- Command: `npm run test:release`
- Stability check (flake guard): `npm run test:release:stability` (3 consecutive runs)

## Coverage Gate (Agreed)

Applied on release suite critical files:

- Statements: `>= 52%`
- Lines: `>= 54%`
- Functions: `>= 47%`
- Branches: `>= 43%`

Files gated:

- `src/middleware/auth.ts`
- `src/middleware/session-auth.ts`
- `src/middleware/permissions.ts`
- `src/middleware/billing.ts`
- `src/services/landing-page-editor.ts`
- `src/api/public-page-renderer.ts`
- `src/api/platform-routes.ts`

Coverage command:

- `npm run test:release:coverage`
