/**
 * Admin Account Access Page — HTML Template
 *
 * Server-rendered HTML page that shows all users with their current account
 * access scope and provides actions to grant/revoke access.
 *
 * Visual indicators:
 *   - ALL_ACCOUNTS: green badge
 *   - SINGLE_ACCOUNT / ACCOUNT_LIST: list of account names
 *   - CRM_REPORT: report name + last sync time + account count
 *
 * Actions:
 *   - Grant ALL access
 *   - Add a single account (searchable picker)
 *   - Add a list of accounts (multi-select)
 *   - Connect a CRM report (dropdown of Salesforce reports / HubSpot lists)
 *   - Revoke any individual grant
 */

import { getAccountAccessStyles } from "./admin-account-access-styles.js";
import { getAccountAccessScripts } from "./admin-account-access-scripts.js";

export function renderAccountAccessPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>Account Access Management — StoryEngine Admin</title>
  <style>${getAccountAccessStyles()}</style>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body>
  <div class="page-container">
    <header class="page-header">
      <h1>Account Access</h1>
      <p>Manage which accounts each team member can access for landing page creation.</p>
    </header>

    <div id="app-loading" class="loading-state">
      <div class="loading-spinner"></div>
      <p>Loading users&hellip;</p>
    </div>

    <div id="app-error" class="error-state" style="display:none">
      <p id="error-message">Failed to load data.</p>
      <button onclick="loadUsers()">Retry</button>
    </div>

    <div id="user-list" class="user-list"></div>
  </div>

  <!-- ─── Grant Access Modal ─────────────────────────────────────── -->
  <div id="grant-modal" class="modal-overlay">
    <div class="modal">
      <div class="modal__header">
        <h2>Grant Account Access</h2>
        <button class="modal__close" onclick="closeModal()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>

      <div class="modal__body">
        <p id="modal-user-label" style="font-size:0.85rem;color:var(--color-text-secondary);margin-bottom:1rem;"></p>

        <div class="tabs">
          <button class="tab active" data-tab="tab-all" onclick="switchTab(this)">All Accounts</button>
          <button class="tab" data-tab="tab-single" onclick="switchTab(this)">Single Account</button>
          <button class="tab" data-tab="tab-list" onclick="switchTab(this)">Account List</button>
          <button class="tab" data-tab="tab-crm" onclick="switchTab(this)">CRM Report</button>
        </div>

        <!-- Tab: All Accounts -->
        <div id="tab-all" class="tab-panel active">
          <p style="font-size:0.85rem;color:var(--color-text-secondary);margin-bottom:0.75rem;">
            Grant unrestricted access to all current and future accounts.
          </p>
          <div style="background:var(--color-green-bg);border:1px solid var(--color-green-border);border-radius:var(--radius);padding:0.75rem 1rem;font-size:0.85rem;color:var(--color-green);display:flex;align-items:center;gap:0.5rem;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg>
            This user will be able to access all accounts.
          </div>
        </div>

        <!-- Tab: Single Account -->
        <div id="tab-single" class="tab-panel">
          <div class="form-group">
            <label>Search for an account</label>
            <div class="search-input-wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <input type="search" id="single-account-search" placeholder="Type account name or domain&hellip;" oninput="onSingleAccountSearch(this.value)" autocomplete="off" />
            </div>
            <div id="single-search-results" class="search-results"></div>
          </div>
          <div id="single-selected" style="display:none;margin-top:0.5rem;">
            <div style="font-size:0.82rem;font-weight:500;margin-bottom:0.25rem;color:var(--color-text-secondary);">Selected:</div>
            <div id="single-selected-name" class="badge badge--account"></div>
          </div>
        </div>

        <!-- Tab: Account List -->
        <div id="tab-list" class="tab-panel">
          <div class="form-group">
            <label>Search and add accounts</label>
            <div class="search-input-wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <input type="search" id="list-account-search" placeholder="Type to search accounts&hellip;" oninput="onListAccountSearch(this.value)" autocomplete="off" />
            </div>
            <div id="list-search-results" class="search-results"></div>
          </div>
          <div class="selected-accounts" id="list-selected-accounts"></div>
          <p class="hint" id="list-selected-count" style="margin-top:0.5rem;">0 accounts selected</p>
        </div>

        <!-- Tab: CRM Report -->
        <div id="tab-crm" class="tab-panel">
          <div class="form-group">
            <label>CRM Provider</label>
            <div class="provider-toggle">
              <button class="provider-btn active" data-provider="SALESFORCE" onclick="selectProvider(this)">Salesforce Reports</button>
              <button class="provider-btn" data-provider="HUBSPOT" onclick="selectProvider(this)">HubSpot Lists</button>
            </div>
          </div>

          <div class="form-group">
            <label id="crm-report-label">Select a Salesforce Report</label>
            <select id="crm-report-select" disabled>
              <option value="">Loading reports&hellip;</option>
            </select>
            <p class="hint">Account access will be synced from this report. You can refresh the sync at any time.</p>
          </div>

          <div id="crm-reports-loading" class="reports-loading" style="display:none;">
            <div class="loading-spinner" style="width:20px;height:20px;border-width:2px;"></div>
            <p>Fetching reports&hellip;</p>
          </div>
          <div id="crm-reports-empty" class="reports-empty" style="display:none;">
            No reports found. Make sure your CRM is connected via Merge.dev.
          </div>
        </div>
      </div>

      <div class="modal__footer">
        <button class="btn" onclick="closeModal()">Cancel</button>
        <button class="btn btn--primary" id="grant-submit-btn" onclick="submitGrant()">Grant Access</button>
      </div>
    </div>
  </div>

  <!-- ─── Toast Container ────────────────────────────────────────── -->
  <div class="toast-container" id="toast-container"></div>

  <!-- ─── Application Logic ──────────────────────────────────────── -->
  <script>${getAccountAccessScripts()}</script>
</body>
</html>`;
}
