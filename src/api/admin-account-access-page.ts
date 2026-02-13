/**
 * Admin Account Access Page
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

import { Router, type Request, type Response } from "express";
import type { PrismaClient, UserRole } from "@prisma/client";
import { requirePermission } from "../middleware/permissions.js";

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createAdminAccountAccessPage(prisma: PrismaClient): Router {
  const router = Router();

  /**
   * GET /admin/account-access
   *
   * Serves the admin account access management page.
   */
  router.get(
    "/",
    requirePermission(prisma, "manage_permissions"),
    async (_req: AuthReq, res: Response) => {
      res.setHeader("Cache-Control", "private, no-cache");
      res.send(renderAccountAccessPage());
    }
  );

  return router;
}

// ─── HTML Template ───────────────────────────────────────────────────────────

function renderAccountAccessPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>Account Access Management — StoryEngine Admin</title>
  <style>
    /* ─── Reset & Base ──────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --color-bg: #f8f9fb;
      --color-surface: #ffffff;
      --color-text: #1a1a2e;
      --color-text-secondary: #555770;
      --color-text-muted: #8b8da3;
      --color-accent: #4f46e5;
      --color-accent-hover: #4338ca;
      --color-accent-light: #eef2ff;
      --color-border: #e5e7eb;
      --color-border-light: #f0f0f5;
      --color-green: #059669;
      --color-green-bg: #ecfdf5;
      --color-green-border: #a7f3d0;
      --color-red: #dc2626;
      --color-red-bg: #fef2f2;
      --color-red-hover: #b91c1c;
      --color-orange: #d97706;
      --color-orange-bg: #fffbeb;
      --color-blue: #2563eb;
      --color-blue-bg: #eff6ff;
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --radius: 8px;
      --radius-lg: 12px;
      --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
      --shadow-md: 0 4px 12px rgba(0,0,0,0.08);
      --shadow-lg: 0 8px 30px rgba(0,0,0,0.12);
    }

    body {
      font-family: var(--font-sans);
      background: var(--color-bg);
      color: var(--color-text);
      line-height: 1.6;
      font-size: 14px;
      -webkit-font-smoothing: antialiased;
    }

    /* ─── Layout ────────────────────────────────────────────────── */
    .page-container {
      max-width: 1080px;
      margin: 0 auto;
      padding: 2rem 1.5rem 4rem;
    }

    .page-header {
      margin-bottom: 2rem;
    }
    .page-header h1 {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--color-text);
      margin-bottom: 0.25rem;
    }
    .page-header p {
      color: var(--color-text-secondary);
      font-size: 0.9rem;
    }

    /* ─── Loading / Error ───────────────────────────────────────── */
    .loading-state, .error-state {
      text-align: center;
      padding: 4rem 1rem;
      color: var(--color-text-secondary);
    }
    .loading-spinner {
      display: inline-block;
      width: 24px;
      height: 24px;
      border: 3px solid var(--color-border);
      border-top-color: var(--color-accent);
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      margin-bottom: 0.75rem;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .error-state { color: var(--color-red); }
    .error-state button {
      margin-top: 1rem;
      background: var(--color-accent);
      color: white;
      border: none;
      padding: 0.5rem 1.25rem;
      border-radius: var(--radius);
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 500;
    }

    /* ─── User Cards ────────────────────────────────────────────── */
    .user-list { display: flex; flex-direction: column; gap: 1rem; }

    .user-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-sm);
      overflow: hidden;
    }

    .user-card__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--color-border-light);
      gap: 1rem;
    }

    .user-card__info {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-width: 0;
    }

    .user-card__avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: var(--color-accent-light);
      color: var(--color-accent);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 0.85rem;
      flex-shrink: 0;
    }

    .user-card__name {
      font-weight: 600;
      font-size: 0.95rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .user-card__email {
      color: var(--color-text-secondary);
      font-size: 0.8rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .user-card__role {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      flex-shrink: 0;
    }
    .role--owner, .role--admin {
      background: var(--color-accent-light);
      color: var(--color-accent);
    }
    .role--member {
      background: var(--color-blue-bg);
      color: var(--color-blue);
    }
    .role--viewer {
      background: #f5f5f5;
      color: var(--color-text-secondary);
    }

    .user-card__actions {
      display: flex;
      gap: 0.5rem;
      flex-shrink: 0;
    }

    /* ─── Grants Section ────────────────────────────────────────── */
    .user-card__grants {
      padding: 1rem 1.25rem;
    }

    .grants-empty {
      color: var(--color-text-muted);
      font-size: 0.85rem;
      font-style: italic;
      padding: 0.5rem 0;
    }

    .grant-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.6rem 0.75rem;
      margin: 0.35rem 0;
      border-radius: var(--radius);
      background: var(--color-bg);
      gap: 0.75rem;
    }

    .grant-row__info {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      min-width: 0;
      flex: 1;
    }

    /* ─── Scope Badges ──────────────────────────────────────────── */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.78rem;
      font-weight: 600;
      padding: 0.25rem 0.65rem;
      border-radius: 20px;
      white-space: nowrap;
    }

    .badge--all {
      background: var(--color-green-bg);
      color: var(--color-green);
      border: 1px solid var(--color-green-border);
    }
    .badge--all::before {
      content: '';
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--color-green);
    }

    .badge--account {
      background: var(--color-blue-bg);
      color: var(--color-blue);
      border: 1px solid #bfdbfe;
    }

    .badge--list {
      background: var(--color-orange-bg);
      color: var(--color-orange);
      border: 1px solid #fde68a;
    }

    .badge--crm {
      background: #f5f3ff;
      color: #7c3aed;
      border: 1px solid #ddd6fe;
    }

    .grant-row__meta {
      font-size: 0.78rem;
      color: var(--color-text-muted);
      white-space: nowrap;
    }

    .grant-row__accounts {
      font-size: 0.82rem;
      color: var(--color-text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .crm-sync-info {
      font-size: 0.78rem;
      color: var(--color-text-muted);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    /* ─── Buttons ───────────────────────────────────────────────── */
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-family: var(--font-sans);
      font-size: 0.8rem;
      font-weight: 500;
      padding: 0.4rem 0.85rem;
      border-radius: var(--radius);
      border: 1px solid var(--color-border);
      background: var(--color-surface);
      color: var(--color-text);
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s;
    }
    .btn:hover {
      background: var(--color-bg);
      border-color: #d1d5db;
    }

    .btn--primary {
      background: var(--color-accent);
      color: white;
      border-color: var(--color-accent);
    }
    .btn--primary:hover {
      background: var(--color-accent-hover);
      border-color: var(--color-accent-hover);
    }

    .btn--danger {
      color: var(--color-red);
      border-color: transparent;
      background: transparent;
      padding: 0.3rem 0.5rem;
      font-size: 0.75rem;
    }
    .btn--danger:hover {
      background: var(--color-red-bg);
    }

    .btn--sync {
      color: var(--color-accent);
      border-color: transparent;
      background: transparent;
      padding: 0.3rem 0.5rem;
      font-size: 0.75rem;
    }
    .btn--sync:hover {
      background: var(--color-accent-light);
    }

    .btn--sm {
      font-size: 0.75rem;
      padding: 0.3rem 0.65rem;
    }

    .btn svg {
      width: 14px;
      height: 14px;
    }

    /* ─── Modal ─────────────────────────────────────────────────── */
    .modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.4);
      z-index: 1000;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .modal-overlay.active { display: flex; }

    .modal {
      background: var(--color-surface);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      width: 100%;
      max-width: 520px;
      max-height: 85vh;
      overflow-y: auto;
    }

    .modal__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid var(--color-border);
    }
    .modal__header h2 {
      font-size: 1.1rem;
      font-weight: 600;
    }
    .modal__close {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--color-text-secondary);
      padding: 0.25rem;
      border-radius: 4px;
      display: flex;
    }
    .modal__close:hover { background: var(--color-bg); }

    .modal__body { padding: 1.5rem; }

    .modal__footer {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      padding: 1rem 1.5rem;
      border-top: 1px solid var(--color-border);
    }

    /* ─── Tabs ──────────────────────────────────────────────────── */
    .tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid var(--color-border);
      margin-bottom: 1.25rem;
    }
    .tab {
      padding: 0.6rem 1rem;
      font-size: 0.82rem;
      font-weight: 500;
      color: var(--color-text-secondary);
      cursor: pointer;
      border: none;
      background: none;
      border-bottom: 2px solid transparent;
      transition: all 0.15s;
      font-family: var(--font-sans);
    }
    .tab:hover { color: var(--color-text); }
    .tab.active {
      color: var(--color-accent);
      border-bottom-color: var(--color-accent);
    }

    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    /* ─── Form Elements ─────────────────────────────────────────── */
    .form-group { margin-bottom: 1rem; }
    .form-group label {
      display: block;
      font-size: 0.82rem;
      font-weight: 500;
      margin-bottom: 0.35rem;
      color: var(--color-text);
    }
    .form-group .hint {
      font-size: 0.75rem;
      color: var(--color-text-muted);
      margin-top: 0.25rem;
    }

    .search-input-wrap {
      position: relative;
    }
    .search-input-wrap svg {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      width: 16px;
      height: 16px;
      color: var(--color-text-muted);
      pointer-events: none;
    }

    input[type="text"], input[type="search"], select {
      width: 100%;
      padding: 0.55rem 0.75rem;
      font-family: var(--font-sans);
      font-size: 0.85rem;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      background: var(--color-surface);
      color: var(--color-text);
      outline: none;
      transition: border-color 0.15s;
    }
    input:focus, select:focus {
      border-color: var(--color-accent);
      box-shadow: 0 0 0 3px rgba(79,70,229,0.1);
    }
    .search-input-wrap input {
      padding-left: 2rem;
    }

    /* ─── Account Search Results ─────────────────────────────────── */
    .search-results {
      border: 1px solid var(--color-border);
      border-top: none;
      border-radius: 0 0 var(--radius) var(--radius);
      max-height: 200px;
      overflow-y: auto;
      display: none;
    }
    .search-results.active { display: block; }

    .search-result-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0.75rem;
      cursor: pointer;
      font-size: 0.85rem;
      transition: background 0.1s;
    }
    .search-result-item:hover { background: var(--color-accent-light); }
    .search-result-item__name { font-weight: 500; }
    .search-result-item__domain {
      font-size: 0.75rem;
      color: var(--color-text-muted);
    }

    /* ─── Selected Accounts (multi-select) ──────────────────────── */
    .selected-accounts {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      margin-top: 0.5rem;
      min-height: 32px;
    }
    .selected-tag {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      background: var(--color-accent-light);
      color: var(--color-accent);
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-size: 0.78rem;
      font-weight: 500;
    }
    .selected-tag button {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--color-accent);
      padding: 0;
      font-size: 1rem;
      line-height: 1;
      display: flex;
    }
    .selected-tag button:hover { color: var(--color-red); }

    /* ─── CRM Report Section ────────────────────────────────────── */
    .provider-toggle {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .provider-btn {
      flex: 1;
      padding: 0.6rem;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      background: var(--color-surface);
      font-family: var(--font-sans);
      font-size: 0.82rem;
      font-weight: 500;
      cursor: pointer;
      text-align: center;
      transition: all 0.15s;
    }
    .provider-btn:hover { border-color: var(--color-accent); }
    .provider-btn.active {
      border-color: var(--color-accent);
      background: var(--color-accent-light);
      color: var(--color-accent);
    }

    .reports-loading, .reports-empty {
      text-align: center;
      padding: 1.5rem;
      color: var(--color-text-muted);
      font-size: 0.85rem;
    }

    /* ─── Toast Notifications ───────────────────────────────────── */
    .toast-container {
      position: fixed;
      top: 1rem;
      right: 1rem;
      z-index: 2000;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .toast {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 0.75rem 1rem;
      box-shadow: var(--shadow-md);
      font-size: 0.85rem;
      animation: toast-in 0.3s ease-out;
      max-width: 360px;
    }
    .toast--success { border-left: 3px solid var(--color-green); }
    .toast--error { border-left: 3px solid var(--color-red); }
    @keyframes toast-in {
      from { opacity: 0; transform: translateX(20px); }
      to { opacity: 1; transform: translateX(0); }
    }

    /* ─── Responsive ────────────────────────────────────────────── */
    @media (max-width: 640px) {
      .page-container { padding: 1.25rem 1rem 3rem; }
      .user-card__header { flex-wrap: wrap; }
      .user-card__actions { width: 100%; justify-content: flex-end; }
      .grant-row { flex-wrap: wrap; }
      .grant-row__meta { width: 100%; }
    }
  </style>
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
  <script>
    const API_BASE = '/api/dashboard';
    let usersData = [];
    let currentModalUserId = null;
    let currentModalUserName = null;

    // Single account picker state
    let singleSelectedAccount = null;
    let singleSearchDebounce = null;

    // List account picker state
    let listSelectedAccounts = new Map();
    let listSearchDebounce = null;

    // CRM state
    let crmProvider = 'SALESFORCE';
    let crmReports = [];

    // ─── Load Users ──────────────────────────────────────────────

    async function loadUsers() {
      document.getElementById('app-loading').style.display = '';
      document.getElementById('app-error').style.display = 'none';
      document.getElementById('user-list').innerHTML = '';

      try {
        const res = await fetch(API_BASE + '/access');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        usersData = data.users;
        renderUsers();
      } catch (err) {
        document.getElementById('app-loading').style.display = 'none';
        document.getElementById('app-error').style.display = '';
        document.getElementById('error-message').textContent =
          'Failed to load users: ' + err.message;
      }
    }

    function renderUsers() {
      document.getElementById('app-loading').style.display = 'none';
      const container = document.getElementById('user-list');
      container.innerHTML = '';

      for (const user of usersData) {
        container.innerHTML += renderUserCard(user);
      }
    }

    function renderUserCard(user) {
      const initials = getInitials(user.user_name || user.user_email);
      const displayName = user.user_name || user.user_email.split('@')[0];
      const roleClass = 'role--' + user.role.toLowerCase();
      const isAdmin = user.role === 'OWNER' || user.role === 'ADMIN';

      let grantsHtml = '';

      if (isAdmin && user.grants.length === 0) {
        grantsHtml = '<div class="grant-row"><div class="grant-row__info">' +
          '<span class="badge badge--all">All Accounts</span>' +
          '<span class="grant-row__accounts">Implicit via ' + esc(user.role) + ' role</span>' +
          '</div></div>';
      } else if (user.grants.length === 0) {
        grantsHtml = '<div class="grants-empty">No account access granted</div>';
      } else {
        for (const grant of user.grants) {
          grantsHtml += renderGrantRow(grant, user.user_id);
        }
      }

      return '<div class="user-card" id="user-' + esc(user.user_id) + '">' +
        '<div class="user-card__header">' +
          '<div class="user-card__info">' +
            '<div class="user-card__avatar">' + esc(initials) + '</div>' +
            '<div>' +
              '<div class="user-card__name">' + esc(displayName) + '</div>' +
              '<div class="user-card__email">' + esc(user.user_email) + '</div>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:0.75rem;">' +
            '<span class="user-card__role ' + roleClass + '">' + esc(user.role) + '</span>' +
            '<div class="user-card__actions">' +
              '<button class="btn btn--primary btn--sm" onclick="openGrantModal(\\'' + esc(user.user_id) + '\\', \\'' + esc(displayName) + '\\')">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>' +
                'Grant Access' +
              '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="user-card__grants">' + grantsHtml + '</div>' +
      '</div>';
    }

    function renderGrantRow(grant, userId) {
      let badgeHtml = '';
      let detailHtml = '';
      let actionsHtml = '';

      switch (grant.scope_type) {
        case 'ALL_ACCOUNTS':
          badgeHtml = '<span class="badge badge--all">All Accounts</span>';
          break;

        case 'SINGLE_ACCOUNT':
          badgeHtml = '<span class="badge badge--account">Single Account</span>';
          if (grant.account) {
            detailHtml = '<span class="grant-row__accounts">' +
              esc(grant.account.name) +
              (grant.account.domain ? ' <span style="color:var(--color-text-muted)">(' + esc(grant.account.domain) + ')</span>' : '') +
              '</span>';
          }
          break;

        case 'ACCOUNT_LIST':
          badgeHtml = '<span class="badge badge--list">Specific Accounts</span>';
          detailHtml = '<span class="grant-row__accounts">' +
            grant.cached_account_count + ' account' +
            (grant.cached_account_count !== 1 ? 's' : '') +
            '</span>';
          break;

        case 'CRM_REPORT':
          badgeHtml = '<span class="badge badge--crm">CRM Report</span>';
          detailHtml = '<span class="grant-row__accounts">' +
            esc(grant.crm_report_name || grant.crm_report_id || 'Unknown') +
            '</span>' +
            '<span class="crm-sync-info">' +
              (grant.crm_provider ? esc(grant.crm_provider) : '') +
              ' &middot; ' + grant.cached_account_count + ' account' +
              (grant.cached_account_count !== 1 ? 's' : '') +
              (grant.last_synced_at
                ? ' &middot; Synced ' + formatRelativeTime(grant.last_synced_at)
                : ' &middot; Never synced') +
            '</span>';
          actionsHtml += '<button class="btn btn--sync" onclick="syncGrant(\\'' + esc(grant.id) + '\\')" title="Sync Now">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>' +
            ' Sync' +
          '</button>';
          break;
      }

      actionsHtml += '<button class="btn btn--danger" onclick="revokeGrant(\\'' + esc(grant.id) + '\\', \\'' + esc(userId) + '\\')" title="Revoke">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
        ' Revoke' +
      '</button>';

      return '<div class="grant-row" id="grant-' + esc(grant.id) + '">' +
        '<div class="grant-row__info">' + badgeHtml + detailHtml + '</div>' +
        '<div style="display:flex;align-items:center;gap:0.25rem;">' + actionsHtml + '</div>' +
      '</div>';
    }

    // ─── Modal ──────────────────────────────────────────────────

    function openGrantModal(userId, userName) {
      currentModalUserId = userId;
      currentModalUserName = userName;
      document.getElementById('modal-user-label').textContent =
        'Granting access to: ' + userName;

      // Reset state
      singleSelectedAccount = null;
      listSelectedAccounts = new Map();
      document.getElementById('single-account-search').value = '';
      document.getElementById('single-search-results').innerHTML = '';
      document.getElementById('single-search-results').classList.remove('active');
      document.getElementById('single-selected').style.display = 'none';
      document.getElementById('list-account-search').value = '';
      document.getElementById('list-search-results').innerHTML = '';
      document.getElementById('list-search-results').classList.remove('active');
      document.getElementById('list-selected-accounts').innerHTML = '';
      document.getElementById('list-selected-count').textContent = '0 accounts selected';

      // Reset tabs to first
      switchTab(document.querySelector('.tab[data-tab="tab-all"]'));

      // Load CRM reports
      loadCrmReports();

      document.getElementById('grant-modal').classList.add('active');
    }

    function closeModal() {
      document.getElementById('grant-modal').classList.remove('active');
      currentModalUserId = null;
    }

    function switchTab(tabEl) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tabEl.classList.add('active');
      document.getElementById(tabEl.dataset.tab).classList.add('active');
    }

    // ─── Single Account Search ──────────────────────────────────

    function onSingleAccountSearch(query) {
      clearTimeout(singleSearchDebounce);
      const resultsEl = document.getElementById('single-search-results');

      if (query.length < 1) {
        resultsEl.classList.remove('active');
        resultsEl.innerHTML = '';
        return;
      }

      singleSearchDebounce = setTimeout(async () => {
        try {
          const res = await fetch(API_BASE + '/accounts/search?q=' + encodeURIComponent(query));
          const data = await res.json();
          renderSingleSearchResults(data.accounts);
        } catch { /* ignore */ }
      }, 250);
    }

    function renderSingleSearchResults(accounts) {
      const el = document.getElementById('single-search-results');
      if (accounts.length === 0) {
        el.innerHTML = '<div class="search-result-item" style="color:var(--color-text-muted);cursor:default;">No accounts found</div>';
        el.classList.add('active');
        return;
      }
      el.innerHTML = accounts.map(a =>
        '<div class="search-result-item" onclick="selectSingleAccount(\\''+esc(a.id)+'\\', \\''+esc(a.name)+'\\', \\''+esc(a.domain || '')+'\\')">'+
          '<span class="search-result-item__name">' + esc(a.name) + '</span>' +
          (a.domain ? '<span class="search-result-item__domain">' + esc(a.domain) + '</span>' : '') +
        '</div>'
      ).join('');
      el.classList.add('active');
    }

    function selectSingleAccount(id, name, domain) {
      singleSelectedAccount = { id, name, domain };
      document.getElementById('single-search-results').classList.remove('active');
      document.getElementById('single-account-search').value = '';
      document.getElementById('single-selected').style.display = '';
      document.getElementById('single-selected-name').textContent =
        name + (domain ? ' (' + domain + ')' : '');
    }

    // ─── List Account Search (Multi-select) ─────────────────────

    function onListAccountSearch(query) {
      clearTimeout(listSearchDebounce);
      const resultsEl = document.getElementById('list-search-results');

      if (query.length < 1) {
        resultsEl.classList.remove('active');
        resultsEl.innerHTML = '';
        return;
      }

      listSearchDebounce = setTimeout(async () => {
        try {
          const res = await fetch(API_BASE + '/accounts/search?q=' + encodeURIComponent(query));
          const data = await res.json();
          renderListSearchResults(data.accounts);
        } catch { /* ignore */ }
      }, 250);
    }

    function renderListSearchResults(accounts) {
      const el = document.getElementById('list-search-results');
      const filtered = accounts.filter(a => !listSelectedAccounts.has(a.id));
      if (filtered.length === 0) {
        el.innerHTML = '<div class="search-result-item" style="color:var(--color-text-muted);cursor:default;">No more accounts found</div>';
        el.classList.add('active');
        return;
      }
      el.innerHTML = filtered.map(a =>
        '<div class="search-result-item" onclick="addListAccount(\\''+esc(a.id)+'\\', \\''+esc(a.name)+'\\')">'+
          '<span class="search-result-item__name">' + esc(a.name) + '</span>' +
          (a.domain ? '<span class="search-result-item__domain">' + esc(a.domain) + '</span>' : '') +
        '</div>'
      ).join('');
      el.classList.add('active');
    }

    function addListAccount(id, name) {
      listSelectedAccounts.set(id, name);
      document.getElementById('list-search-results').classList.remove('active');
      document.getElementById('list-account-search').value = '';
      renderListSelected();
    }

    function removeListAccount(id) {
      listSelectedAccounts.delete(id);
      renderListSelected();
    }

    function renderListSelected() {
      const el = document.getElementById('list-selected-accounts');
      let html = '';
      for (const [id, name] of listSelectedAccounts) {
        html += '<span class="selected-tag">' +
          esc(name) +
          '<button onclick="removeListAccount(\\'' + esc(id) + '\\')" title="Remove">&times;</button>' +
        '</span>';
      }
      el.innerHTML = html;
      document.getElementById('list-selected-count').textContent =
        listSelectedAccounts.size + ' account' + (listSelectedAccounts.size !== 1 ? 's' : '') + ' selected';
    }

    // ─── CRM Report ─────────────────────────────────────────────

    function selectProvider(btn) {
      document.querySelectorAll('.provider-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      crmProvider = btn.dataset.provider;

      const label = crmProvider === 'SALESFORCE' ? 'Select a Salesforce Report' : 'Select a HubSpot List';
      document.getElementById('crm-report-label').textContent = label;

      loadCrmReports();
    }

    async function loadCrmReports() {
      const select = document.getElementById('crm-report-select');
      const loading = document.getElementById('crm-reports-loading');
      const empty = document.getElementById('crm-reports-empty');

      select.disabled = true;
      select.innerHTML = '<option value="">Loading&hellip;</option>';
      loading.style.display = '';
      empty.style.display = 'none';

      try {
        const res = await fetch(API_BASE + '/crm-reports?provider=' + crmProvider);
        const data = await res.json();
        crmReports = data.reports || [];

        loading.style.display = 'none';

        if (crmReports.length === 0) {
          empty.style.display = '';
          select.innerHTML = '<option value="">No reports available</option>';
          return;
        }

        select.innerHTML = '<option value="">Choose a report&hellip;</option>' +
          crmReports.map(r =>
            '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>'
          ).join('');
        select.disabled = false;
      } catch {
        loading.style.display = 'none';
        select.innerHTML = '<option value="">Failed to load reports</option>';
      }
    }

    // ─── Submit Grant ──────────────────────────────────────────

    async function submitGrant() {
      const activeTab = document.querySelector('.tab-panel.active').id;
      const btn = document.getElementById('grant-submit-btn');
      btn.disabled = true;
      btn.textContent = 'Granting\u2026';

      let body = { user_id: currentModalUserId };

      switch (activeTab) {
        case 'tab-all':
          body.scope_type = 'ALL_ACCOUNTS';
          break;

        case 'tab-single':
          if (!singleSelectedAccount) {
            showToast('Please select an account first.', 'error');
            btn.disabled = false;
            btn.textContent = 'Grant Access';
            return;
          }
          body.scope_type = 'SINGLE_ACCOUNT';
          body.account_id = singleSelectedAccount.id;
          break;

        case 'tab-list':
          if (listSelectedAccounts.size === 0) {
            showToast('Please select at least one account.', 'error');
            btn.disabled = false;
            btn.textContent = 'Grant Access';
            return;
          }
          body.scope_type = 'ACCOUNT_LIST';
          body.account_ids = Array.from(listSelectedAccounts.keys());
          break;

        case 'tab-crm': {
          const reportId = document.getElementById('crm-report-select').value;
          if (!reportId) {
            showToast('Please select a CRM report.', 'error');
            btn.disabled = false;
            btn.textContent = 'Grant Access';
            return;
          }
          const report = crmReports.find(r => r.id === reportId);
          body.scope_type = 'CRM_REPORT';
          body.crm_report_id = reportId;
          body.crm_provider = crmProvider;
          body.crm_report_name = report ? report.name : reportId;
          break;
        }
      }

      try {
        const res = await fetch(API_BASE + '/access/grant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed');
        }

        showToast('Access granted to ' + currentModalUserName, 'success');
        closeModal();
        await loadUsers();
      } catch (err) {
        showToast('Failed to grant access: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Grant Access';
      }
    }

    // ─── Revoke ─────────────────────────────────────────────────

    async function revokeGrant(grantId, userId) {
      if (!confirm('Revoke this access grant?')) return;

      try {
        const res = await fetch(API_BASE + '/access/' + grantId, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);

        showToast('Access revoked.', 'success');
        await loadUsers();
      } catch (err) {
        showToast('Failed to revoke: ' + err.message, 'error');
      }
    }

    // ─── Sync CRM Grant ─────────────────────────────────────────

    async function syncGrant(grantId) {
      try {
        const res = await fetch(API_BASE + '/access/' + grantId + '/sync', {
          method: 'POST',
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);

        const data = await res.json();
        showToast('Synced ' + data.account_count + ' accounts.', 'success');
        await loadUsers();
      } catch (err) {
        showToast('Sync failed: ' + err.message, 'error');
      }
    }

    // ─── Utilities ──────────────────────────────────────────────

    function esc(str) {
      if (!str) return '';
      const div = document.createElement('div');
      div.textContent = String(str);
      return div.innerHTML;
    }

    function getInitials(name) {
      if (!name) return '?';
      const parts = name.split(/[\\s@]+/);
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
      return parts[0].substring(0, 2).toUpperCase();
    }

    function formatRelativeTime(dateStr) {
      const d = new Date(dateStr);
      const now = new Date();
      const diffMs = now - d;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'just now';
      if (diffMins < 60) return diffMins + 'm ago';
      if (diffHours < 24) return diffHours + 'h ago';
      if (diffDays < 7) return diffDays + 'd ago';
      return d.toLocaleDateString();
    }

    function showToast(message, type) {
      const container = document.getElementById('toast-container');
      const toast = document.createElement('div');
      toast.className = 'toast toast--' + type;
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
      }, 3500);
    }

    // Close modal on outside click
    document.getElementById('grant-modal').addEventListener('click', function(e) {
      if (e.target === this) closeModal();
    });

    // Close search results when clicking outside
    document.addEventListener('click', function(e) {
      if (!e.target.closest('#single-account-search') && !e.target.closest('#single-search-results')) {
        document.getElementById('single-search-results').classList.remove('active');
      }
      if (!e.target.closest('#list-account-search') && !e.target.closest('#list-search-results')) {
        document.getElementById('list-search-results').classList.remove('active');
      }
    });

    // ─── Initialize ─────────────────────────────────────────────

    loadUsers();
  </script>
</body>
</html>`;
}
