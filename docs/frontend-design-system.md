# Frontend Design Tokens And UI Patterns

Date: 2026-02-24

This document defines the shared frontend styling contract used in the Vite app.

## Theme Tokens

- Base tokens live in `frontend/src/index.css` under `:root`.
- Theme variants:
  - `.theme-light`: light surface and text token overrides.
  - `.theme-high-contrast`: high-contrast accessibility overrides.
- Runtime toggle classes are applied to `document.documentElement` in `frontend/src/App.tsx`.

## Core Token Groups

- Color: `--color-*` semantic usage (`bg`, `surface`, `text`, `accent`, `border`, `success`, `error`, `warning`, `info`).
- Spacing: `--space-*`.
- Radius: `--radius-*`.
- Motion: `--transition-*`.
- Typography: `--font-sans`.

## Shared Page Patterns

- Page shell:
  - `.page`
  - `.page__header`
  - `.page__title`
  - `.page__subtitle`
  - `.page__actions`
- Status and loading:
  - `.state-view`
  - `.state-view--error`
  - `.spinner`
- Data-heavy pages:
  - `.table-container`
  - `.data-table`
  - `.data-table__empty`
- List controls and pagination:
  - `.account-list-controls`
  - `.story-library__controls`
  - `.account-list-pagination`
  - `.story-library__pagination`

## Usage Rules

- Prefer semantic `--color-*` tokens over raw hex values.
- Prefer existing pattern classes before adding page-specific ad hoc containers.
- Keep page controls keyboard-focusable and consistent with shared `btn` and `form-field__input` variants.
- For new pages with large lists, include:
  - search/filter controls
  - page-size control
  - explicit range display (`x-y of total`)
  - pagination controls
