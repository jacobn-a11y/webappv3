# Release Policy: Phase 6-7 Roadmap Block

Date: March 3, 2026

## Scope

Roadmap tasks covered in this block:

- `T43` scheduled reporting exports
- `T44` org branding/theming for published surfaces
- `T45` template gallery + reusable presets
- `T46` scheduled publishing controls
- `T47` user preferences/profile center
- `T48` outbound webhook/event API
- `T49` i18n groundwork
- `T50-T56` accessibility end-pass

## Required PR Template Sections

- Scope
- API changes
- Migration impact
- Tests run
- Rollback note

## Rollback Policy

- Backend route changes:
  - Revert feature-specific route files and queue wiring, then redeploy.
- Frontend UX changes:
  - Revert affected page/components and API client bindings.
- Data safety:
  - No destructive migrations introduced in this block.
  - Scheduled publish and outbound webhook configs are soft-state in existing JSON settings and can be disabled by configuration rollback.

## Gate Requirements

- `npm run lint`
- `npm run build`
- `npm test`
- `npm --prefix frontend run test`
- `npm run test:security`
- `npm run test:reliability`
