# i18n Foundation (T49)

Date: March 3, 2026

## Scope

This change establishes string-extraction and locale scaffolding in the frontend without breaking existing UX.

## Implemented

- Added locale catalogs:
  - `frontend/src/i18n/messages/en-US.ts`
  - `frontend/src/i18n/messages/es-ES.ts`
- Added shared provider and translator hook:
  - `frontend/src/i18n/index.tsx`
  - locale persistence key: `storyengine_locale`
- Wrapped app root with `I18nProvider` in `frontend/src/main.tsx`.
- Wired extracted strings for core shell surfaces:
  - Sidebar navigation labels and controls
  - Brand/loading strings
  - Profile center labels and preference options
- Added locale preference control in Profile Center (`en-US`, `es-ES`).

## Contract

- Adding a locale now requires:
  1. Add a new catalog file in `frontend/src/i18n/messages/`.
  2. Register it in `frontend/src/i18n/index.tsx`.
  3. Reuse existing translation keys where possible.

## Follow-up backlog

- Continue extraction from page-level hardcoded strings to catalogs.
- Add fallback linting rule for new hardcoded UI strings in future PRs.
