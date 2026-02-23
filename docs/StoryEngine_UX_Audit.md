# StoryEngine UX & Usability Audit

## Executive Summary

This audit evaluates StoryEngine's UI from the perspective of each user role (OWNER, ADMIN, MEMBER, VIEWER) and persona (REVOPS_ADMIN, MARKETING_ANALYST, SALES_MANAGER, CSM, EXEC). Three critical categories of issues were found:

1. **Permission Visibility Failures** — Users see nav links and full page UIs for areas they cannot access
2. **Persona Assignment Bug** — The default persona is `REVOPS_ADMIN` (most privileged), so any user without a role profile assigned gets full admin navigation
3. **Workflow Friction** — Core workflows (story generation, sharing, page editing) lack clear entry points and require too many clicks

---

## CRITICAL ISSUE #1: Broken Persona Assignment (Root Cause)

### The Bug
In `src/api/dashboard-routes.ts` (lines 468–479), the persona assignment logic defaults to the **most privileged persona** when no role profile is assigned:

```typescript
let persona: "REVOPS_ADMIN" | "MARKETING_ANALYST" | "SALES_MANAGER" | "CSM" | "EXEC" =
  "REVOPS_ADMIN"; // ← DEFAULT IS ADMIN

if (roleKey === "EXEC" || baseRole === "VIEWER") persona = "EXEC";
else if (roleKey === "SALES") persona = "SALES_MANAGER";
else if (roleKey === "CS") persona = "CSM";
else if (assignment?.roleProfile?.permissions.includes("VIEW_ANALYTICS")) {
  persona = "MARKETING_ANALYST";
}
```

### Evidence
Carol (`usr_carol`, role=MEMBER, role_profile_key=null) receives `persona: "REVOPS_ADMIN"` from the API. The `/api/dashboard/home` response:
```json
{
  "user": { "id": "usr_carol", "role": "MEMBER", "role_profile_key": null },
  "persona": "REVOPS_ADMIN"  // ← WRONG for a MEMBER
}
```

### Fix
Default persona should derive from `baseRole`, not default to admin:

```typescript
// FIXED: Default persona based on base role
let persona: PersonaType = "REVOPS_ADMIN";

// First, map base role to safe default
if (baseRole === "VIEWER") persona = "EXEC";
else if (baseRole === "MEMBER") persona = "MARKETING_ANALYST"; // Safe default for members

// Then, override with role profile if assigned
if (roleKey === "EXEC") persona = "EXEC";
else if (roleKey === "SALES") persona = "SALES_MANAGER";
else if (roleKey === "CS") persona = "CSM";
else if (roleKey === "REVOPS" || baseRole === "OWNER" || baseRole === "ADMIN") {
  persona = "REVOPS_ADMIN";
} else if (assignment?.roleProfile?.permissions.includes("VIEW_ANALYTICS")) {
  persona = "MARKETING_ANALYST";
}
```

---

## CRITICAL ISSUE #2: No Frontend Route Guards

### The Bug
In `frontend/src/App.tsx`, ALL routes are registered identically for all authenticated users — there are zero frontend route guards:

```tsx
<Routes>
  <Route path="/" element={<HomePage />} />
  {/* ... core routes ... */}
  <Route path="/admin/permissions" element={<AdminPermissionsPage />} />
  <Route path="/admin/security" element={<AdminSecurityPolicyPage />} />
  <Route path="/admin/governance" element={<AdminDataGovernancePage />} />
  {/* ALL admin routes accessible to ALL users */}
</Routes>
```

### Evidence
As Carol (MEMBER), navigating directly to:
- `/admin/permissions` → Shows page with "permission_denied" banner, but page title/structure visible
- `/admin/security` → Shows "permission_denied" but **renders the entire security settings form** with real data (MFA settings, IP allowlists, session config)
- `/admin/governance` → Shows "permission_denied" but **renders data retention settings, legal hold toggles, and Save buttons**
- `/admin/audit-logs` → Shows "permission_denied" but renders full filter UI and Export CSV/JSON buttons
- `/automations` → Shows "permission_denied" but renders the entire Create Rule form

### Fix: Add a `<ProtectedRoute>` wrapper

```tsx
// New component: frontend/src/components/ProtectedRoute.tsx
function ProtectedRoute({
  children,
  requiredRole,
  requiredPersona,
  user,
  persona,
  fallback = <Navigate to="/" replace />
}: {
  children: React.ReactNode;
  requiredRole?: Array<"OWNER" | "ADMIN" | "MEMBER" | "VIEWER">;
  requiredPersona?: Array<string>;
  user: AuthUser;
  persona: string | null;
  fallback?: React.ReactNode;
}) {
  if (requiredRole && !requiredRole.includes(user.role)) return fallback;
  if (requiredPersona && persona && !requiredPersona.includes(persona)) return fallback;
  return <>{children}</>;
}

// Usage in routes:
<Route path="/admin/permissions" element={
  <ProtectedRoute requiredRole={["OWNER", "ADMIN"]} user={user} persona={persona}>
    <AdminPermissionsPage />
  </ProtectedRoute>
} />
```

### Fix: Pages should NOT render forms when permission is denied

Every admin page currently shows the full form UI even when the API returns `permission_denied`. Pages should check the error and render a proper access-denied state instead of the form:

```tsx
// Pattern for all admin pages:
if (error === "permission_denied") {
  return (
    <div className="access-denied">
      <IconLock />
      <h2>Access Restricted</h2>
      <p>You don't have permission to view this page. Contact your administrator.</p>
      <Link to="/">Return to Home</Link>
    </div>
  );
}
// Only render the form if no permission error
```

---

## CRITICAL ISSUE #3: Sidebar Shows Admin Links to Non-Admin Users

### The Bug
The `buildNav()` function in `App.tsx` (line 211) uses persona to determine nav visibility:

```typescript
const isAdmin = !persona || persona === "REVOPS_ADMIN";
```

When `persona` is `null` (loading/error) OR when persona defaults to `REVOPS_ADMIN` (the broken default from Issue #1), the sidebar shows ALL admin items.

### Fix: Also check user.role

```typescript
function buildNav(persona: RoleAwareHome["persona"] | null, userRole: AuthUser["role"]): NavEntry[] {
  const isAdminRole = userRole === "OWNER" || userRole === "ADMIN";
  const isAdmin = isAdminRole && (!persona || persona === "REVOPS_ADMIN");

  // ... rest of buildNav, using isAdmin for admin section visibility

  // Admin section — only show for actual admin roles
  if (isAdminRole) {
    if (isAdmin) {
      adminItems.push(/* full admin items */);
    }
  } else if (isMarketing) {
    adminItems.push({ to: "/admin/story-context", label: "Story Context", icon: IconBook });
  }
  // Non-admin roles: NO admin items at all
}
```

---

## Per-Persona UX Audit

### Persona 1: OWNER (usr_alice) — Organization Owner

**Expected Core Workflows:**
- Full administrative control
- User management, billing, security
- Story generation and publishing oversight

**Current Issues:**
- **Good:** Would see full admin nav (correct for OWNER)
- **Missing:** No quick-action dashboard widgets for "Invite User" or "Manage Billing"
- **Missing:** No breadcrumb navigation — deep pages like `/accounts/:id/journey` have no way to go back except browser back button
- **Missing:** No role indicator in sidebar (user only sees email, not their role)

**Recommended Fixes:**
1. Add role badge next to user email in sidebar footer (e.g., "alice@acmecorp.com · Owner")
2. Add "Quick Actions" section to home dashboard: Invite User, Manage Billing, Security Settings
3. Add breadcrumb component to all detail pages
4. Home dashboard "Recommended Next Actions" items should be clickable links, not plain text

---

### Persona 2: ADMIN (usr_bob) — Administrator

**Expected Core Workflows:**
- Admin configuration (permissions, roles, governance)
- Story oversight and approval
- Integration management

**Current Issues:**
- Same good admin access as OWNER
- **Missing:** No differentiation between OWNER and ADMIN capabilities in the UI
- **Missing:** ADMIN should not see Billing (typically OWNER-only)
- **Missing:** Approval queue count not visible in nav (badge/count indicator)

**Recommended Fixes:**
1. Hide Billing nav item for ADMIN role (keep for OWNER only)
2. Add notification badge on "Approvals" nav item showing pending count
3. Add pending approvals count to home dashboard "Recommended Actions" as clickable link

---

### Persona 3: MEMBER (usr_carol) — Content Creator / Story Generator

**Expected Core Workflows:**
- Generate stories from accounts
- Create and edit landing pages
- Share published stories via links
- View analytics on their content

**Current Issues (All Observed Live):**
1. **CRITICAL:** Carol sees full admin sidebar (11 admin items) due to persona bug
2. **CRITICAL:** Carol can navigate to admin pages and sees real configuration data
3. **No "Create Story" CTA on home page** — the primary workflow (story generation) requires navigating to Accounts → picking an account → clicking Generate Story. This is 3+ clicks for the #1 workflow
4. **No "Accounts" in nav** — Carol's persona should include Accounts link for story generation, but the buildNav logic only adds Accounts for SALES_MANAGER and CSM personas
5. **Landing Pages list lacks "Create New" button** — no clear CTA to create a new page
6. **Story sharing workflow unclear** — after generating a story, the only actions visible are "Copy MD" and "Preview" — no "Share" or "Publish" button
7. **No indication of story status** — stories don't show draft/published state clearly

**Recommended Fixes:**
1. Fix persona assignment (Issue #1 above)
2. Remove all admin nav items for MEMBER role
3. Add prominent "Generate Story" CTA button to home dashboard
4. Add "Accounts" to MEMBER nav (story generation starts from accounts)
5. Add "Create New Page" button to Landing Pages list
6. Add "Share" button to story cards with share link copy functionality
7. Show story status (Draft/Published/Shared) with color-coded badges
8. Add a "My Stories" or "Recent Stories" section to the home dashboard

---

### Persona 4: VIEWER (usr_dave) — Read-Only User

**Expected Core Workflows:**
- View published stories and landing pages
- View analytics (read-only)
- View account information (read-only)

**Current Issues:**
1. **CRITICAL:** Same persona bug — VIEWER would get `EXEC` persona (the only correct mapping), but if role_profile_key is null, defaults to REVOPS_ADMIN
2. **No clear read-only indicators** — forms/buttons should be disabled or hidden for viewers
3. **VIEWER sees "Generate Story" button** on Account Detail page — clicking it would fail with permission error
4. **VIEWER sees "Create Workspace" form** on Workspaces page
5. **VIEWER sees "Request Writeback" form** on Writebacks page

**Recommended Fixes:**
1. Fix persona assignment to always map VIEWER → EXEC (already correct in code for baseRole check)
2. Pass user role to all page components; hide action buttons for VIEWER
3. Add `disabled` prop or hide "Generate Story", "Create Workspace", "Request Writeback" for VIEWER
4. Show visual "Read Only" badge or banner when viewing as VIEWER
5. VIEWER nav should only contain: Home, Pages (read-only), Analytics (read-only), and Accounts (read-only)

---

### Persona 5: EXEC — Executive Viewer

**Expected Core Workflows:**
- View high-level analytics and KPIs
- Review customer success health
- View account journeys

**Current Issues:**
1. EXEC persona not clearly defined in sidebar nav — the buildNav function doesn't have an explicit EXEC branch
2. The `else` fallback gives EXEC users only Audit Logs in admin, which makes no sense for an executive
3. **Missing:** Executive summary dashboard should be the home view for EXEC, not the RevOps Admin dashboard

**Recommended Fixes:**
1. Add explicit EXEC case in `buildNav()`:
   ```typescript
   if (isExec) {
     coreItems.push(
       { to: "/analytics", label: "Analytics", icon: IconAnalytics },
       { to: "/accounts/acc_meridian", label: "Accounts", icon: IconAccounts },
     );
     // No admin items, no workspace items
   }
   ```
2. Create an exec-specific home dashboard with just KPIs and customer health
3. Remove admin section entirely for EXEC persona

---

## Page-by-Page UX Issues

### Home Page (`/`)
- **Good:** Shows role-aware greeting and summary stats
- **Issue:** "Recommended Next Actions" are plain text, not clickable
- **Issue:** Customer Success Health score (25) shown in red but no explanation of what's wrong
- **Fix:** Make recommended actions link to relevant pages; add tooltips on health scores

### Status Page (`/status`)
- **Issue:** Requires manually entering Organization ID — should auto-populate from user context
- **Fix:** Pre-fill org ID from authenticated user's organizationId

### Landing Pages (`/dashboard/pages`)
- **Good:** Clean table with search, filters, sort
- **Issue:** No "Create New Page" button visible above the fold
- **Issue:** "View" action exists but no "Edit" link (requires knowing the URL pattern)
- **Fix:** Add primary "Create Page" CTA; add "Edit" action button alongside "View"

### Analytics (`/analytics`)
- **Good:** Comprehensive KPI cards and executive summary
- **Issue:** "RESOLUTION RATE" label is truncated on smaller screens
- **Issue:** No date range picker — always shows "Last 90 Days"
- **Fix:** Add date range selector; ensure responsive text

### Chat (`/chat`)
- **Issue:** Account dropdown says "Select Account" but no accounts are pre-loaded
- **Issue:** Message input placeholder says "Select an account first..." but account selector is in a different visual region
- **Fix:** Combine account selector and chat input in one cohesive flow; pre-load account list

### Account Detail (`/accounts/:id`)
- **Good:** Shows generated stories with Copy MD and Preview actions
- **Issue:** "Generate Story" button has no indication of what data it uses or how long it takes
- **Issue:** No back navigation to accounts list
- **Fix:** Add breadcrumb; add loading indicator for story generation; add "Back to Accounts" link

### Account Journey (`/accounts/:id/journey`)
- **Good:** Beautiful timeline with call cards, funnel stages, CRM data
- **Issue:** No way to generate a story from this view (user must go back to account detail)
- **Issue:** No back navigation
- **Fix:** Add breadcrumb; add "Generate Story" CTA from journey context

### Workspaces (`/workspaces`)
- **Good:** Create workspace form is simple and clear
- **Issue:** "Delete" action has no confirmation dialog
- **Issue:** Shared Asset Library "Add Asset" form has no guidance on what asset types are supported
- **Fix:** Add confirmation dialog for delete; add help text for asset types

### Writebacks (`/writebacks`)
- **Issue:** Account ID field uses raw ID format ("acc_...") — should be account name selector
- **Fix:** Replace text input with account dropdown/search

### Automations (`/automations`)
- **Issue:** Shows permission_denied for MEMBER but renders the full form
- **Issue:** Metric field uses raw metric names ("failure_rate") — not user-friendly
- **Fix:** Replace with dropdown of available metrics; hide form when permission denied

### Admin: Security (`/admin/security`)
- **CRITICAL:** Shows real security configuration data even when permission denied
- **Fix:** Never render the form when permission is denied

### Admin: Governance (`/admin/governance`)
- **CRITICAL:** Shows real governance policies (retention periods, legal hold settings) even when permission denied
- **Fix:** Never render the form when permission is denied

### Admin: Audit Logs (`/admin/audit-logs`)
- **Issue:** Export CSV/JSON buttons visible even when permission denied
- **Issue:** Filter fields use raw enum values as placeholders
- **Fix:** Hide exports when denied; use human-readable filter labels

---

## Navigation & Information Architecture Issues

### Missing Navigation Patterns
1. **No breadcrumbs** — Deep pages (/accounts/:id/journey, /pages/:id/edit, /calls/:id/transcript) have no breadcrumb trail
2. **No "back" affordance** — Only browser back works
3. **No search** — No global search to find accounts, stories, or pages
4. **No notifications** — No bell icon or notification center for approvals, automation alerts
5. **No recent items** — No way to get back to recently viewed accounts or stories

### Sidebar Issues
1. **No role indicator** — Users can't see their own role/permissions
2. **No org name** — Only user email shown; no organization context
3. **Group sections always expanded on load** — Admin section takes up most of the sidebar, pushing workspace items below the fold
4. **Collapsed sidebar loses all context** — Icons only, no tooltips for group headers

### Mobile Experience
- **Good:** Hamburger menu exists
- **Issue:** Sidebar overlay has no close button (only tap outside)
- **Fix:** Add explicit close button in sidebar header on mobile

---

## Summary of Priority Fixes

### P0 — Security/Data Exposure (Fix Immediately)
1. **Fix persona default** — Change from REVOPS_ADMIN to least-privilege default based on baseRole
2. **Add frontend route guards** — Wrap admin routes in ProtectedRoute
3. **Never render forms when permission_denied** — All admin pages must check error before rendering
4. **Pass user.role to buildNav** — Don't rely solely on persona for nav visibility

### P1 — Core Workflow Improvements
5. Add "Generate Story" CTA to home dashboard for content creators
6. Add "Accounts" to MEMBER nav
7. Add "Create New Page" button to Landing Pages list
8. Add "Share" button and share link copy to story cards
9. Add breadcrumb navigation to all detail/edit pages
10. Pre-fill Organization ID on Status page

### P2 — UX Polish
11. Add role badge to sidebar footer
12. Add notification badges to nav items (Approvals count)
13. Make "Recommended Actions" clickable links
14. Add confirmation dialog for destructive actions (Delete)
15. Replace raw ID fields with search/dropdown selectors
16. Add global search
17. Add date range picker to Analytics

### P3 — Persona-Specific Dashboards
18. Create EXEC-specific home dashboard (KPIs only)
19. Create MEMBER-specific home dashboard (My Stories, Recent Pages)
20. Create CSM-specific home dashboard (Customer Health, Renewals)
