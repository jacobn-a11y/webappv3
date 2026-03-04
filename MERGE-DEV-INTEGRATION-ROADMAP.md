# Merge.dev Integration Roadmap

Roadmap for integrating Merge.dev setup into a dedicated Settings section (admin/owner only) and the Setup Wizard, with the ability for users to update connections later.

---

## 1. Overview

### Current State
- **Backend API exists**: `/api/settings/integrations` — list, link-token, complete-link, sync, disconnect, polling toggle
- **No frontend UI** for Merge Link OAuth flow
- **Setup Wizard** has steps for Recording Provider and CRM (Merge.dev) but uses MVP quickstart with direct Gong keys instead of Merge Link
- **Merge.dev categories**: CRM (Salesforce, HubSpot), Filestorage (recordings — Gong, Chorus, Zoom via Merge's recording integrations; verify category with Merge docs)

### Goals
1. **Settings → Integrations** — Dedicated page for admins/owners to connect, manage, and update Merge.dev integrations
2. **Setup Wizard** — Optional Merge.dev path in steps 1–2 (Recording Provider, CRM) for first-run onboarding
3. **Update flow** — Users can add, reconnect, or disconnect integrations anytime from Settings

---

## 2. Access Control

| Route / Feature | Visible To | Permission |
|-----------------|------------|------------|
| `/admin/settings/integrations` or `/settings/integrations` | OWNER, ADMIN | `manage_permissions` (or new `manage_integrations`) |
| Setup Wizard Merge steps | OWNER, ADMIN | Same as setup wizard |
| View connected integrations (read-only) | OWNER, ADMIN | `manage_permissions` |

**Recommendation**: Use existing `manage_permissions` for consistency with `/api/settings/integrations`, or add `manage_integrations` if you want finer-grained control.

---

## 3. Settings → Integrations Page (New)

### 3.1 Route & Navigation
- **Path**: `/admin/settings/integrations` or `/settings/integrations`
- **Nav**: Under Administration group, add "Integrations" (or "Connections") — only for OWNER/ADMIN
- **Alternative**: Under existing "Setup" with a sub-link "Manage Integrations"

### 3.2 Page Structure

```
┌─────────────────────────────────────────────────────────────────┐
│  Integrations                                                    │
│  Connect your CRM and call recording providers via Merge.dev     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  CRM (Salesforce, HubSpot)                                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  [Connected] Salesforce — Acme Corp                       │  │
│  │  Last synced: 2 hours ago    [Sync] [Pause] [Disconnect]  │  │
│  └──────────────────────────────────────────────────────────┘  │
│  [+ Connect CRM]                                                 │
│                                                                  │
│  Call Recordings (Gong, Chorus, Zoom, etc.)                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  [Connected] Gong — Acme Corp                             │  │
│  │  Last synced: 1 hour ago     [Sync] [Pause] [Disconnect]  │  │
│  └──────────────────────────────────────────────────────────┘  │
│  [+ Connect Recording Provider]                                 │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│  Merge.dev not configured? Contact your administrator.           │
│  (Show when MERGE_API_KEY is not set)                            │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 Components to Build

| Component | Description |
|-----------|-------------|
| `IntegrationsSettingsPage` | Main page; fetches `/api/settings/integrations`, renders connected list + connect buttons |
| `MergeLinkModal` or `MergeLinkEmbed` | Wrapper for Merge Link SDK; receives `link_token`, shows Merge UI, calls `onSuccess(public_token)` |
| `IntegrationCard` | Card for each connected integration: name, status, last sync, actions (Sync, Pause, Disconnect) |
| `ConnectButton` | Opens Merge Link flow for a given category (CRM or RECORDING) |

### 3.4 API Usage (Existing)

| Action | API Call |
|--------|----------|
| List integrations | `GET /api/settings/integrations` |
| Start connect flow | `POST /api/settings/integrations/link-token` (body: `{ category: "crm" \| "filestorage" }`) |
| Complete connect | `POST /api/settings/integrations/complete-link` (body: `{ public_token }`) |
| Manual sync | `POST /api/settings/integrations/:id/sync` |
| Toggle polling | `PATCH /api/settings/integrations/:id/polling` (body: `{ enabled: boolean }`) |
| Disconnect | `DELETE /api/settings/integrations/:id` |

### 3.5 Backend Changes Required

1. **Link token endpoint** — Accept `category` in request body to request CRM vs Recording token:
   - `categories: ["crm"]` for CRM
   - `categories: ["filestorage"]` for recordings (verify with Merge docs — Gong/Chorus may use different category)
2. **Complete-link** — Map Merge response `integration.categories` to our `LinkedAccount.category` (CRM | RECORDING)
3. **Fix integrations-routes** — Current link-token uses `categories: ["crm", "ats"]`; change to support single-category flows so user connects one at a time with correct provider list

---

## 4. Setup Wizard — Merge.dev Steps

### 4.1 Wizard Steps (Current)

1. **RECORDING_PROVIDER** — Connect call recording (Gong, Grain, etc.)
2. **CRM** — Connect Salesforce or HubSpot
3. **ACCOUNT_SYNC** — Review entity resolution, fix mismatches
4. **PLAN** — Choose billing plan
5. **PERMISSIONS** — Configure landing page permissions
6. **COMPLETED**

### 4.2 Merge.dev Path for Steps 1 & 2

**Option A: Replace MVP Quickstart**
- Remove or deprioritize direct Gong API key flow
- Use Merge Link for both Recording and CRM in wizard
- Single source of truth: LinkedAccount table

**Option B: Dual Path (Recommended)**
- **Path 1 (Merge)**: "Connect via Merge.dev" → Opens Merge Link for CRM + Recording
- **Path 2 (Direct)**: "Quickstart with Gong" → Existing MVP flow with Gong API keys
- User chooses path; wizard records which path was used

### 4.3 Step 1: Recording Provider (Merge Path)

```
┌─────────────────────────────────────────────────────────────────┐
│  Step 1: Connect Your Call Recording Provider                    │
├─────────────────────────────────────────────────────────────────┤
│  StoryEngine works with Gong, Chorus, Zoom, and more.              │
│                                                                  │
│  [Connect via Merge.dev]  —  One-click OAuth for 10+ providers   │
│                                                                  │
│  — or —                                                          │
│                                                                  │
│  [Quickstart with Gong]  —  Enter API keys directly              │
└─────────────────────────────────────────────────────────────────┘
```

- If "Connect via Merge.dev": Call `POST /api/settings/integrations/link-token` with `category: "filestorage"` (or correct Merge category for recordings)
- Open Merge Link modal; on success, call `complete-link`, then advance to Step 2
- If "Quickstart with Gong": Keep existing MVP flow; advance to Step 2 (skip CRM if they only need Gong)

### 4.4 Step 2: CRM (Merge Path)

```
┌─────────────────────────────────────────────────────────────────┐
│  Step 2: Connect Your CRM                                        │
├─────────────────────────────────────────────────────────────────┤
│  Connect Salesforce or HubSpot to sync accounts and contacts.     │
│  This powers entity resolution and account journey views.         │
│                                                                  │
│  [Connect Salesforce or HubSpot]                                 │
│                                                                  │
│  [Skip for now]  —  You can connect later in Settings            │
└─────────────────────────────────────────────────────────────────┘
```

- Call link-token with `category: "crm"`
- Open Merge Link; on success, complete-link, advance to Step 3
- Skip: Advance to Step 3 without CRM; show "Connect CRM later in Settings → Integrations"

### 4.5 Step 3: Account Sync (Unchanged)
- Preview resolved vs unresolved calls
- Link to Entity Resolution queue (when UI exists) or at least show counts
- "Mark as reviewed" to advance

### 4.6 Persist Wizard State
- `SetupWizard.mergeLinkedAccountId` — Recording provider LinkedAccount id
- `SetupWizard.crmMergeLinkedAccountId` — CRM LinkedAccount id
- When user completes Merge Link, create LinkedAccount and store id in wizard
- If user later adds another integration from Settings, wizard state is unchanged (Settings writes to LinkedAccount directly)

---

## 5. Merge Link Frontend Integration

### 5.1 Merge Link SDK
- **React**: Use `@mergeapi/merge-link-react` or Merge's script tag + `MergeLink.initialize()`
- **Docs**: https://docs.merge.dev/get-started/link/

### 5.2 Flow
1. User clicks "Connect CRM" or "Connect Recording Provider"
2. Frontend calls `POST /api/settings/integrations/link-token` with `{ category: "crm" | "filestorage" }`
3. Backend returns `{ link_token }`
4. Frontend opens Merge Link with `linkToken`, `onSuccess`, `onExit`
5. User completes OAuth in Merge's iframe/modal
6. Merge calls `onSuccess({ public_token })`
7. Frontend calls `POST /api/settings/integrations/complete-link` with `{ public_token }`
8. Backend exchanges token, creates LinkedAccount, triggers initial sync
9. Frontend refreshes list, shows success toast

### 5.3 Error Handling
- Link token expired → Refresh and retry
- User exits without connecting → `onExit` callback, no error
- Complete-link fails → Show error, allow retry

---

## 6. Update Flow (Later)

Users who connected during setup can return to Settings → Integrations to:
- **Add** another integration (e.g., add HubSpot when they had only Salesforce)
- **Reconnect** if token was revoked (Merge may support re-auth; otherwise disconnect + reconnect)
- **Disconnect** — Removes LinkedAccount; data already synced remains until retention policy
- **Pause/Resume** — Toggle polling for CRM integrations

---

## 7. Implementation Phases

### Phase 1: Settings Page (Priority)
| Task | Effort | Notes |
|------|--------|-------|
| Create `IntegrationsSettingsPage` route | 2h | Add to routes, nav |
| Add Merge Link SDK dependency | 1h | `@mergeapi/merge-link-react` or script |
| Build `MergeLinkModal` component | 3h | Token → Modal → onSuccess → complete-link |
| Build `IntegrationCard` + list UI | 2h | List, Sync, Pause, Disconnect |
| Update link-token API to accept category | 1h | Single category per request |
| Wire complete-link to create LinkedAccount correctly | 2h | Verify Merge response shape, map to our schema |

### Phase 2: Setup Wizard Integration
| Task | Effort | Notes |
|------|--------|-------|
| Add Merge path to Step 1 (Recording) | 2h | "Connect via Merge" button, reuse MergeLinkModal |
| Add Merge path to Step 2 (CRM) | 2h | Same modal, category=crm |
| Persist LinkedAccount ids in SetupWizard | 1h | recording + crm merge linked account ids |
| Add "Skip" for CRM step | 0.5h | |
| Add "Connect later in Settings" CTA | 0.5h | When skipped |

### Phase 3: Polish
| Task | Effort | Notes |
|------|--------|-------|
| Verify Merge categories for recordings | 1h | filestorage vs other; Gong/Chorus/Zoom |
| Add loading states, error toasts | 1h | |
| Add "Merge not configured" empty state | 0.5h | When MERGE_API_KEY unset |
| Document env vars for operators | 0.5h | MERGE_API_KEY, MERGE_WEBHOOK_SECRET |

---

## 8. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MERGE_API_KEY` | Yes (for Merge path) | Production or test API key |
| `MERGE_WEBHOOK_SECRET` | Yes (for webhooks) | Verify Merge webhook signatures |

---

## 9. Merge.dev Categories Reference

From Merge docs, Link supports:
- `crm` — Salesforce, HubSpot, Pipedrive, etc.
- `filestorage` — Box, Dropbox, Google Drive, OneDrive, SharePoint
- `hris`, `ats`, `accounting`, `ticketing`, `knowledgebase`, `chat`

**Note**: Gong, Chorus, Zoom as *recording* providers may be under a different Merge product or category. Verify with Merge support/docs. If recordings are under `filestorage` or a custom category, adjust the link-token request accordingly.

---

## 10. Files to Create/Modify

### New Files
- `frontend/src/pages/IntegrationsSettingsPage.tsx`
- `frontend/src/components/MergeLinkModal.tsx` (or `MergeLinkEmbed.tsx`)
- `frontend/src/lib/api/integrations-settings.ts` (client for `/api/settings/integrations`)

### Modified Files
- `frontend/src/app/routes.tsx` — Add `/admin/settings/integrations` route
- `frontend/src/app/nav-config.tsx` — Add Integrations nav item (admin only)
- `frontend/src/lib/api/integrations.ts` — Add settings endpoints or new file
- `src/api/integrations-routes.ts` — Accept `category` in link-token, fix categories array
- `frontend/src/pages/AdminSetupWizardPage.tsx` — Add Merge path to steps 1 & 2

---

## 11. Testing Checklist

- [ ] Admin can open Settings → Integrations
- [ ] Non-admin cannot access (403 or nav hidden)
- [ ] Connect CRM opens Merge Link, completes OAuth, creates LinkedAccount
- [ ] Connect Recording opens Merge Link, completes OAuth, creates LinkedAccount
- [ ] List shows connected integrations with correct category
- [ ] Sync button triggers manual sync
- [ ] Pause/Resume toggles polling
- [ ] Disconnect removes LinkedAccount
- [ ] Setup Wizard Merge path advances steps correctly
- [ ] Setup Wizard Skip CRM works
- [ ] "Connect later in Settings" links to Integrations page
