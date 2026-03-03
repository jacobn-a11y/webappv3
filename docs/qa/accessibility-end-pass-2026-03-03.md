# Accessibility End-Pass (T50-T56)

Date: March 3, 2026

## Coverage Summary

- `T50` Global landmarks/lang:
  - Root HTML lang is managed by locale provider (`I18nProvider` sets `document.documentElement.lang`).
  - Authenticated/public shells expose `main`, skip links, and labeled navigation regions.
- `T51` Route-change + modal focus:
  - Route focus logic maintained in `frontend/src/App.tsx` for public and authenticated shells.
  - Modal/dialog focus trap and Escape handling retained for command palette and story picker.
- `T52` Labeling + heading hierarchy:
  - Existing heading contract tests (`frontend/src/heading-contract.test.ts`) remain green.
  - Sidebar/icon buttons include accessible labels.
- `T53` Live regions:
  - Route and command announcements use `aria-live="polite"` status regions.
  - Async loading states include status/live announcements.
- `T54` Contrast mode:
  - High-contrast toggle remains available globally and persisted.
- `T55` Automated axe in CI:
  - Blocking CI job `frontend_a11y` runs `npm --prefix frontend run -s test:a11y`.
- `T56` Manual keyboard/screen-reader verification:
  - Manual checklist completed for critical flows (below).

## Manual Verification Checklist (Critical Flows)

- Login/auth page:
  - Tab order reaches form controls and submit action correctly.
  - Screen reader announces heading and error states.
- Sidebar + navigation:
  - Skip link moves focus to main content.
  - Collapsible groups are keyboard-operable and expose expanded state.
- Story picker modal:
  - Dialog announced as modal.
  - Escape closes modal, focus restores to invoking control.
- Command palette modal:
  - Search input receives focus on open.
  - Escape closes modal and focus restores.
- Landing page editor:
  - Primary action buttons and status updates are keyboard reachable/announced.

## Evidence

- Automated:
  - `frontend/src/a11y.test.tsx`
  - `frontend/src/pages/AdminAccountAccessPage.a11y.test.tsx`
- CI:
  - `.github/workflows/ci-cd.yml` (`frontend_a11y` blocking job)
