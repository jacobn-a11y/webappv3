# Sales Adoption Fast Path Progress (T62-T73)

Date: March 3, 2026

## Implemented

- `T62` Global new-story entry point:
  - Existing app-level `New Story` launch points remain in desktop and mobile shells.
- `T63` Deal-stage presets:
  - Added stage presets in `StoryGeneratorModal` for Discovery, Evaluation, Business Case, Negotiation, Expansion.
  - Presets auto-apply stage/topic/format defaults.
- `T64` Guided quick flow:
  - Added guided controls for `Deal Stage`, `Audience`, and `Anonymization Mode`.
  - Advanced controls remain hidden until expanded.
- `T65` Explicit Anonymous vs Named mode:
  - Added explicit mode toggle in story generation flow.
  - Named mode now requires a customer-permission confirmation gate before generation and landing-page creation.
- `T66` Generate + Package:
  - Primary CTA updated to `Generate + Package`.
  - Packaging actions available in preview toolbar (`Copy`, `Markdown`, `PDF`, `DOCX`, `Edit as Landing Page`).
- `T67` Story library seller cards:
  - Added card-first view with lifecycle badges, confidence/safe-to-share indicators, rendered previews, proof-quote surfacing, and direct actions (`Share`, `Copy`, `Create/Edit Page`, `PDF`, `DOCX`, `CRM note`, `Comments`).
- `T68` CRM-first share actions:
  - Added `Copy CRM Note` and `Push CRM Note` actions to Story Library cards/rows.
- `T69` rapid iteration controls:
  - Added quick regenerate variants in preview toolbar: `Shorter`, `More Executive`, `More Proof`.
- `T70` stage-matched packaging templates:
  - Added `Executive Recap`, `Champion Forward`, and `ROI Proof` package templates in preview with one-click copy actions for anonymous and named flows.
- `T71` trust indicators:
  - Added quote confidence chips and a preview-level `Safe to Share` indicator driven by average quote confidence plus named-mode governance state.
- `T72` first-run onboarding sprint:
  - Expanded onboarding into a 60-second checklist (preset/visibility/generate/share) with timer and auto-completion on first share action.
- `T73` seller adoption telemetry:
  - Added backend telemetry endpoints (`/api/dashboard/seller-adoption/events`, `/api/dashboard/seller-adoption/metrics`), frontend event tracking in generation/package/library actions, and admin metrics surfacing in Ops Diagnostics.

## Remaining for Phase 8

- No remaining tasks in `T62-T73`.
